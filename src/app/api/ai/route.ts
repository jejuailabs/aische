// ==========================================
// AI 오케스트레이터
// ==========================================
//
// 문제: 이전에는 모든 입력을 "데이터 추출"로 처리해서,
//       "매주라고 했는데 그건 적용이 어렵나?" 같은 질문까지
//       메모 노드로 저장해버렸다.
//
// 해결: 입력을 먼저 분류(route)하고 담당 AI에게 넘긴다.
//
//   사용자 입력
//        │
//        ▼
//   [오케스트레이터]  ── 의도 분류
//        │
//   ┌────┴─────┬──────────┬───────────┐
//   ▼          ▼          ▼           ▼
//  chat     schedule   command     question
// (대화)    (일정등록)  (시스템조작)  (내 데이터 질의)
//
// 각 담당은 별도 프롬프트로 동작하며, 오케스트레이터는
// 시스템 상태(프로젝트/카테고리/인물/최근일정)를 요약해 전달한다.

import { NextRequest, NextResponse } from "next/server";
import { resolveDateExpr, toStartEnd } from "@/lib/date-expr";
import { parseRecurrence } from "@/lib/recurrence-expr";
import { chat, parseJson, todayInfo, getModel, OpenAIError } from "@/lib/llm";
import { composeSystem } from "@/lib/doctrine";
import { renderIndex, type IndexEntry } from "@/lib/memory-index";
import { renderAgenda, type AgendaItem } from "@/lib/agenda";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

export type Intent = "chat" | "schedule" | "note" | "expense" | "command" | "question";

interface Ctx {
  projects: { id: string; title: string }[];
  categories: { id: string; label: string }[];
  people: { id: string; name: string; org: string | null }[];
  organizations: { id: string; name: string }[];
  topics: { id: string; label: string }[];
  methods: { id: string; issuer: string; last4: string; label: string }[];
  /** 최근/다가오는 일정 요약 — 질문 답변에 사용 (구버전 호환) */
  upcoming: { title: string; when: string; recurrence: string | null }[];
  /**
   * 실제로 잡혀 있는 일정 목록.
   *
   * upcoming은 "오늘 0시 시작인 종일 일정"을 시각 비교로 떨어뜨리는 버그가
   * 있었다. 그래서 AI가 오늘 일정을 못 보고 "등록된 게 없다"고 답했다.
   * agenda는 날짜 기준으로 뽑고, 추출 쪽에도 넘겨 중복을 거르게 한다.
   */
  agenda?: AgendaItem[];
  counts: Record<string, number>;
  /**
   * 지금까지 저장된 입력들의 한 줄 인덱스.
   * 이름 목록만으로는 AI가 "무엇에 관한 것인지" 판단할 근거가 없어서,
   * 그럴듯한 걸 골라 붙이거나 없는 걸 지어냈다. 이게 그 근거다.
   */
  index?: IndexEntry[];
}

interface Body {
  input: string;
  /** 직전 대화 (최근 6턴) */
  history: { role: "user" | "assistant"; content: string }[];
  ctx: Ctx;
  locale: string;
}


function ctxSummary(ctx: Ctx): string {
  const list = (arr: string[]) => (arr.length ? arr.join(", ") : "(없음)");
  return [
    `프로젝트: ${list(ctx.projects.map((p) => p.title))}`,
    `카테고리: ${list(ctx.categories.map((c) => c.label))}`,
    `등록된 인물: ${list(ctx.people.map((p) => p.name))}`,
    `조직: ${list(ctx.organizations.map((o) => o.name))}`,
    `모으는 중인 주제: ${list(ctx.topics.map((t) => t.label))}`,
    `다가오는 일정: ${
      ctx.upcoming.length
        ? ctx.upcoming
            .map(
              (u) =>
                `${u.title}(${u.when}${u.recurrence ? `, ${u.recurrence}` : ""})`
            )
            .join(" / ")
        : "(없음)"
    }`,
  ].join("\n");
}

/**
 * 기억 인덱스 블록.
 *
 * 라우트마다 한도를 다르게 준다. 분류는 최근 맥락만 있으면 되고,
 * 추출은 기존 주제·인물과 대조해야 하므로 가장 많이 필요하다.
 */
function indexBlock(ctx: Ctx, limit: number): string {
  return renderIndex(ctx.index ?? [], { limit });
}

/** 실제 일정 목록 블록 — 대화·질의·추출 전부에 넣는다 */
function agendaBlock(ctx: Ctx): string {
  return renderAgenda(ctx.agenda ?? []);
}

// ─────────────────────────────────────────
// 1단계: 의도 분류
// ─────────────────────────────────────────

async function classify(
  input: string,
  history: Body["history"],
  ctx: Ctx
): Promise<{ intent: Intent; reason: string }> {
  const { str, dow } = todayInfo();
  const system = composeSystem(
    `너는 일정관리 앱의 라우터다. 사용자 입력이 무엇을 원하는지 분류만 한다.

오늘: ${str}(${dow})
${ctxSummary(ctx)}

${agendaBlock(ctx)}

${indexBlock(ctx, 40)}`,
    ["UNCERTAIN"],
    `분류:
- "schedule" : 새로운 일정/할일/목표를 등록하려는 입력. 날짜·사람·장소가 담긴 정보성 문장, 명함 텍스트 등.
    예) "다음주 화요일 3시 팀미팅", "매주 월요일 운동", "김철수 010-1234-5678 명함"
- "question" : 이미 저장된 자기 데이터에 대한 질의.
    예) "이번주 일정 뭐 있어?", "김철수 연락처 뭐였지?", "그 미팅 언제였지?"
- "command"  : 저장된 데이터를 바꾸거나 지우라는 지시.
    예) "그 일정 취소해줘", "매주로 바꿔줘", "미팅 3시로 옮겨"
- "expense"  : **구독·고정비 등록.** 매달/매년 나가는 돈.
    예) "넷플릭스 매월 17일 13500원 신한카드", "헬스장 회비 7만원 매월 5일",
        "도메인 연간 12만원 3월 2일 결제"
- "note"     : **날짜도 할일도 없지만 기록해 둘 만한 내용.** 생각·정보·메모·알게 된 사실.
    예) "제주 이주 알아보다가 물류비가 생각보다 비싸네", "그 사람 예전에 스타트업 했었대",
        "AI모임 사람들 대부분 개발자 아님"
- "chat"     : 남길 내용이 없는 순수 대화. 질문·확인·잡담·앱 사용법·직전 답변에 대한 반문.
    예) "매주라고 했는데 그건 적용이 어렵나?", "고마워", "이거 어떻게 써?"

중요:
- **물음표로 끝나거나 되묻는 문장은 대부분 schedule이 아니다.** 새 일정을 만들라는 게 아니라 묻는 것이다.
- 직전 대화 맥락을 보고 판단하라. 앞서 일정을 만들었고 지금 그에 대해 되묻는다면 chat 또는 command다.
- 애매하면 schedule이 아니라 chat 또는 note로 보내라. 잘못된 일정을 만드는 것보다 낫다.
- **chat과 note의 차이**: 나중에 다시 보고 싶을 내용이면 note, 그 자리에서 끝나는 말이면 chat.

JSON만 출력: {"intent":"chat|schedule|note|expense|command|question","reason":"한 줄 근거"}`
  );

  const msgs = [
    ...history.slice(-6).map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: input },
  ];
  const raw = await chat({ system, messages: msgs, json: true, maxTokens: 400 });
  const p = parseJson(raw);
  const intent: Intent = ["chat", "schedule", "note", "expense", "command", "question"].includes(
    p.intent
  )
    ? p.intent
    : "chat";
  return { intent, reason: p.reason ?? "" };
}

// ─────────────────────────────────────────
// 2단계-A: 대화 담당
// ─────────────────────────────────────────

async function doChat(
  input: string,
  history: Body["history"],
  ctx: Ctx
): Promise<string> {
  const { str, dow } = todayInfo();
  const system = composeSystem(
    `너는 GoalFlow라는 일정관리 앱의 비서다. 한국어로 간결하게 대화한다.

오늘: ${str}(${dow})
현재 사용자 데이터:
${ctxSummary(ctx)}

${agendaBlock(ctx)}

${indexBlock(ctx, 120)}`,
    ["CONVERSE", "UNCERTAIN"],
    `## 이 앱에서 네가 할 수 있는 일 / 없는 일

할 수 있다:
- 사용자가 **새로 알려주는 내용**을 일정·할일·고정비·메모로 등록
  (사용자가 저장 버튼을 눌러야 확정된다)
- 저장된 데이터에 대해 답변

할 수 없다:
- **이미 저장된 항목을 수정·삭제·이동하는 것.** 아직 구현되지 않았다.

수정·삭제 요청을 받으면 사과만 하고 넘어가지 마라. 어디서 직접 할 수 있는지 알려줘라.
예) "저장된 일정은 아직 제가 고칠 수 없습니다. 캘린더에서 그 일정을 눌러 직접 수정하실 수 있어요."
예) "삭제는 캘린더에서 항목을 열고 휴지통 버튼을 누르시면 됩니다."

## 그 밖
- 새 일정을 만들어달라는 뜻이면 필요한 정보(날짜·시각)를 되물어라.
- 이미 저장된 내용을 물으면 위 "다가오는 일정"을 근거로 답하라.

JSON 금지. 평문으로만 답하라.`
  );

  const msgs = [
    ...history.slice(-6).map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: input },
  ];
  return chat({ system, messages: msgs, maxTokens: 700, temperature: 0.6 });
}

// ─────────────────────────────────────────
// 2단계-B: 일정 담당 (층 분해 + 반복)
// ─────────────────────────────────────────

async function doSchedule(input: string, ctx: Ctx) {
  // input은 아래 날짜 보정에서도 쓰인다
  const { now, str, dow } = todayInfo();
  const fmt = (a: string[]) => (a.length ? a.join("\n") : "(없음)");

  // 공통 원칙은 doctrine.ts에서 온다. 여기엔 이 라우트에만 있는 것(출력
  // 스키마, 필드 매핑)만 쓴다. 원칙을 여기 다시 쓰면 다른 라우트와 어긋난다.
  const system = composeSystem(
    `너는 자연어를 **정보의 층으로 분해**하는 추출 엔진이다.

오늘: ${str}(${dow})

## 기존 데이터
### 프로젝트
${fmt(ctx.projects.map((p) => `- id:"${p.id}" title:"${p.title}"`))}
### 카테고리
${fmt(ctx.categories.map((c) => `- id:"${c.id}" label:"${c.label}"`))}
### 인물
${fmt(ctx.people.map((p) => `- id:"${p.id}" name:"${p.name}" org:"${p.org ?? ""}"`))}
### 조직
${fmt(ctx.organizations.map((o) => `- id:"${o.id}" name:"${o.name}"`))}
### 모으는 중인 주제
${fmt(ctx.topics.map((t) => `- id:"${t.id}" label:"${t.label}"`))}

${agendaBlock(ctx)}

${indexBlock(ctx, 200)}`,
    ["DECOMPOSE", "TIME_UNSPECIFIED", "UNCERTAIN", "TOPIC"],
    `## 출력 (JSON only)
{
  "summary": "한 줄 요약",
  "intent": "schedule|todo|goal|contact|note|mixed",
  "schedule": {
    "title": "날짜/장소 뺀 핵심 제목",
    "description": "제목에 안 담긴 내용 — 무슨 이야기를 하는 자리인지, 뭘 준비해야 하는지, 조건·배경. 없으면 빈 문자열",
    "dateExpr": "입력에 나온 날짜·시각 표현 원문 (예: \\"다음주 화요일 오후 2시\\") 없으면 null",
    "recurrenceExpr": "반복 표현 원문 (예: \\"매주\\", \\"격주 월수금\\", \\"매일\\") 없으면 null",
    "startAt": null, "endAt": null, "dueAt": null,
    "allDay": true, "location": null, "categoryId": null
  } | null,
  "people": [{"name":"","role":null,"org":null,"phone":null,"email":null,"matchedPersonId":null,"isNew":true}],
  "organizations": [{"name":"","orgType":null,"matchedOrgId":null,"isNew":true}],
  "project": {"matchedProjectId":null,"matchConfidence":0,"newProjectSuggestion":null} | null,
  "tasks": [{"title":"","kind":"task|project","dueExpr":null,"dueAt":null,"completionMode":"manual|deliverable|checklist"}],
  "notes": [],
  "topic": {"label":"이 입력이 무슨 주제에 관한 것인지","matchedTopicId":null,"isNew":true} | null,
  "duplicateOf": "위 '현재 잡혀 있는 일정'에 이미 같은 일정이 있으면 그 노드 id, 없으면 null"
}

## 중복 판정

위 **"현재 잡혀 있는 일정"** 목록과 대조하라. 같은 일정이면 새로 만들지 말고
duplicateOf에 그 id를 넣어라.

같은 일정으로 보는 기준 — **날짜가 같고 내용이 같은 일**:
- "7월 21일 당근 모임" + 목록에 [2026-07-21 당근 모임] → 중복. duplicateOf 채운다.
- 표현이 달라도 같은 일이면 중복이다. ("당근모임" / "당근 모임" / "당근 정기모임")

중복이 **아닌** 것:
- 날짜가 다르면 다른 일정이다. 반복 일정의 다른 회차도 마찬가지다.
- 제목이 비슷해도 하는 일이 다르면 다른 일정이다.
  ("당근 모임"과 "당근 모임 바이브코딩"은 별개일 수 있다)
- **확신이 없으면 null로 두라.** 멀쩡한 새 일정을 중복으로 묶는 것이
  중복을 놓치는 것보다 나쁘다. (원칙: 확신 없으면 비워라)

## 이 스키마에서의 필드 규칙

1. 날짜·시각 표현은 **dateExpr에 원문 그대로 복사**한다. (원칙 2)
   반복 표현은 **recurrenceExpr에 원문 그대로.**
   "매주", "매주 화요일", "격주", "매일", "매월 15일", "주 3회", "월수금" 등.
   반복이 아니면 null.

2. 사람은 people 층, 조직은 organizations 층으로.
   기존 인물·조직과 동일인/동일단체면 matched*Id를 채우고 isNew=false.

3. 프로젝트는 내용이 맞을 때만 matchedProjectId. confidence 30 미만이면 null.

4. **notes는 비우면 안 되는 경우가 있다.**
   일정도 실행항목도 없는 입력이면 그 내용을 반드시 notes에 담아라.
   notes가 비면 사용자가 적은 내용이 통째로 사라진다. (원칙 3)
   - "제주 이주 알아보다가 물류비가 비싸더라" → notes: ["제주 이주 시 물류비가 비쌈"]
   - 여러 사실이 섞여 있으면 사실 단위로 쪼개서 각각 넣어라.
   - summary는 요약일 뿐 저장되지 않는다. 남길 내용은 notes에 넣어야 한다.

5. **날짜가 여러 개일 때의 배치.** (원칙 3)
   schedule에는 **주된 일정 하나**만 담고, 나머지 날짜가 붙은 일들은 전부 tasks에.
   예) "7월 24일 미팅, 내용은 8월 5일에 있을 AX 강의 준비임"
       → schedule: 7월 24일 미팅
       → tasks: [{ title: "AX 강의", dueExpr: "8월 5일", kind: "task" }]

6. **description은 제목이 못 담은 내용을 담는 칸이다.**
   제목은 캘린더 한 칸에 들어가야 해서 짧다. 나머지를 여기 넣어라.
   비워두면 사용자가 왜 이 약속을 잡았는지 나중에 알 수 없다. (원칙 3)
   - "강소희씨랑 화요일 2시에 만나서 AX 강의 커리큘럼이랑 단가 얘기하기로 함"
     → title: "강소희 미팅"
     → description: "AX 강의 커리큘럼과 단가 논의"
   - 입력이 제목 한 줄뿐이면(예: "내일 3시 회의") 빈 문자열로 둬라.
     제목을 그대로 복사해 넣지 마라.

7. topic의 label은 너무 좁게 짓지 마라.
   ("7월 24일 강소희 미팅"❌ → "AX 강의 준비"⭕)
   인사말·감사 같은 잡담이면 topic 자체를 null로.

JSON만. 코드펜스 금지.`
  );

  const raw = await chat({ system, messages: [{ role: "user", content: input }], json: true });
  const p = parseJson(raw);

  // ── 날짜/반복은 코드로 계산 (LLM 산술 불신) ──
  let schedule = p.schedule ?? null;
  if (schedule) {
    const rec = schedule.recurrenceExpr
      ? parseRecurrence(schedule.recurrenceExpr, now)
      : null;

    // 날짜 표현이 있으면 그걸로, 없고 반복만 있으면("매주 월수금 아침 7시")
    // 원문에서 시각만이라도 뽑는다. 반복 일정은 날짜 없이 시각만 있는 게 정상이다.
    const dateSource = schedule.dateExpr || (rec ? input : null);
    if (dateSource) {
      const r = resolveDateExpr(dateSource, now);
      if (r) {
        const { startAt, endAt, allDay } = toStartEnd(r);
        schedule = { ...schedule, startAt, endAt, allDay };
      }
    }
    // 그래도 시작 시각을 못 정했으면 오늘 종일로 시작
    if (!schedule.startAt && rec) {
      const base = new Date(now);
      base.setHours(9, 0, 0, 0);
      const end = new Date(base);
      end.setHours(18, 0, 0, 0);
      schedule = {
        ...schedule,
        startAt: toLocalISO(base),
        endAt: toLocalISO(end),
        allDay: true,
      };
    }
    // 반복 요일이 지정됐으면 시작일을 그 요일로 맞춘다 ("매주 화요일")
    if (rec && rec.freq === "weekly" && rec.byWeekday.length > 0 && schedule.startAt) {
      const s = new Date(schedule.startAt);
      if (!isNaN(s.getTime()) && !rec.byWeekday.includes(s.getDay())) {
        const target = rec.byWeekday.slice().sort((a: number, b: number) => a - b)[0];
        const shift = (target - s.getDay() + 7) % 7;
        s.setDate(s.getDate() + shift);
        const dur =
          new Date(schedule.endAt).getTime() - new Date(schedule.startAt).getTime();
        schedule = {
          ...schedule,
          startAt: toLocalISO(s),
          endAt: toLocalISO(new Date(s.getTime() + (isNaN(dur) ? 3600000 : dur))),
        };
      }
    }
    schedule = { ...schedule, recurrence: rec };
  }

  const tasks = (Array.isArray(p.tasks) ? p.tasks : []).map((tk: any) => {
    if (!tk?.dueExpr) return tk;
    const r = resolveDateExpr(tk.dueExpr, now);
    return r ? { ...tk, dueAt: toStartEnd(r).startAt } : tk;
  });

  return {
    summary: p.summary ?? input.slice(0, 80),
    intent: p.intent ?? "note",
    schedule,
    people: Array.isArray(p.people) ? p.people : [],
    organizations: Array.isArray(p.organizations) ? p.organizations : [],
    project: p.project ?? null,
    tasks,
    notes: Array.isArray(p.notes) ? p.notes : [],
    topic: p.topic ?? null,
    // AI가 없는 id를 지어낼 수 있으므로 실제 목록에 있는지 확인한다.
    // 지어낸 id를 그대로 흘리면 화면이 존재하지 않는 일정을 가리키게 된다.
    duplicateOf:
      p.duplicateOf &&
      (ctx.agenda ?? []).some((a) => a.id === p.duplicateOf)
        ? String(p.duplicateOf)
        : null,
  };
}

function toLocalISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

// ─────────────────────────────────────────
// 2단계-B2: 고정비 담당
// ─────────────────────────────────────────

async function doExpense(input: string, ctx: Ctx) {
  const { str, dow } = todayInfo();
  const fmt = (a: string[]) => (a.length ? a.join("\n") : "(없음)");

  const system = composeSystem(
    `너는 구독·고정비 정보를 뽑는 추출 엔진이다.

오늘: ${str}(${dow})

## 등록된 결제수단
${fmt(ctx.methods.map((m) => `- id:"${m.id}" ${m.issuer} ****${m.last4} (${m.label})`))}
## 카테고리
${fmt(ctx.categories.map((c) => `- id:"${c.id}" label:"${c.label}"`))}`,
    ["UNCERTAIN"],
    `## 출력 (JSON only)
{
  "items": [
    {
      "title": "서비스·항목명 (예: 넷플릭스, 헬스장)",
      "amount": 숫자만 (원 단위),
      "currency": "KRW",
      "cycle": "monthly" | "yearly",
      "paymentDay": 1~31,
      "paymentMonth": cycle이 yearly일 때 1~12, 아니면 null,
      "matchedMethodId": "위 결제수단 중 맞는 id 또는 null",
      "methodHint": "입력에 나온 카드 표현 원문 (예: \\"신한카드\\") 또는 null",
      "categoryId": "위 카테고리 id 또는 null",
      "memo": ""
    }
  ]
}

## 이 스키마에서의 필드 규칙

1. **금액은 숫자만.** "13,500원"→13500, "7만원"→70000, "1만 3천원"→13000.
   (이건 단위 변환이지 산술이 아니다. 결제일 전개는 서버가 한다.)
2. 결제일: "매월 17일"→17. 날짜를 못 찾으면 paymentDay는 1로 두되
   memo에 "결제일 확인 필요"를 남겨라. (원칙: 모르면 밝혀라)
3. "연간"·"매년"이면 cycle="yearly"이고 paymentMonth를 채워라.
4. 카드 이름이 나오면 위 목록에서 카드사가 일치하는 id를 matchedMethodId에.
   목록에 없으면 null로 두고 methodHint에 원문을 남겨라. (원칙 1)
5. 한 문장에 여러 건이 있으면 items에 전부 담아라. (원칙 3)
6. **카드번호는 절대 출력하지 마라.** 입력에 있어도 무시한다.
   뒤 4자리를 제외한 어떤 자리도 출력하지 않는다.

JSON만. 코드펜스 금지.`
  );

  const raw = await chat({ system, messages: [{ role: "user", content: input }], json: true });
  const p = parseJson(raw);

  const items = (Array.isArray(p.items) ? p.items : []).map((it: any) => ({
    title: String(it.title ?? "").slice(0, 80),
    amount: Number(it.amount) || 0,
    currency: it.currency ?? "KRW",
    cycle: it.cycle === "yearly" ? "yearly" : "monthly",
    paymentDay: Math.min(31, Math.max(1, Number(it.paymentDay) || 1)),
    paymentMonth:
      it.cycle === "yearly" && it.paymentMonth != null
        ? Math.min(12, Math.max(1, Number(it.paymentMonth)))
        : null,
    // 존재하지 않는 id를 지어냈으면 버린다
    matchedMethodId: ctx.methods.some((m) => m.id === it.matchedMethodId)
      ? it.matchedMethodId
      : null,
    methodHint: it.methodHint ?? null,
    categoryId: ctx.categories.some((c) => c.id === it.categoryId)
      ? it.categoryId
      : null,
    memo: String(it.memo ?? ""),
  }));

  return { items };
}

// ─────────────────────────────────────────
// 2단계-C: 데이터 질의 담당
// ─────────────────────────────────────────

async function doQuestion(
  input: string,
  history: Body["history"],
  ctx: Ctx
): Promise<string> {
  const { str, dow } = todayInfo();
  const system = composeSystem(
    `너는 사용자의 일정 데이터에 대해 답하는 비서다.

오늘: ${str}(${dow})
${ctxSummary(ctx)}
저장 현황: ${Object.entries(ctx.counts)
      .map(([k, v]) => `${k} ${v}건`)
      .join(", ")}

${agendaBlock(ctx)}

${indexBlock(ctx, 150)}`,
    ["CONVERSE", "UNCERTAIN"],
    `위 데이터에만 근거해 한국어로 답하라.
데이터에 없는 내용은 지어내지 말고 "저장된 내역이 없다"고 말하라.
평문으로만 답하라.`
  );

  const msgs = [
    ...history.slice(-4).map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: input },
  ];
  return chat({ system, messages: msgs, maxTokens: 700, temperature: 0.6 });
}

// ─────────────────────────────────────────
// 라우트
// ─────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured" },
      { status: 500 }
    );
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const input = (body.input ?? "").trim();
  if (!input) return NextResponse.json({ error: "Empty input" }, { status: 400 });

  const ctx: Ctx = {
    projects: body.ctx?.projects ?? [],
    categories: body.ctx?.categories ?? [],
    people: body.ctx?.people ?? [],
    organizations: body.ctx?.organizations ?? [],
    topics: body.ctx?.topics ?? [],
    methods: body.ctx?.methods ?? [],
    upcoming: body.ctx?.upcoming ?? [],
    counts: body.ctx?.counts ?? {},
  };
  const history = Array.isArray(body.history) ? body.history : [];

  try {
    const { intent, reason } = await classify(input, history, ctx);
    console.log(`[AI] intent=${intent} (${reason}) input="${input.slice(0, 40)}"`);

    // note도 같은 추출기를 탄다. 일정이 없을 뿐 기록할 내용은 층으로 분해된다.
    if (intent === "schedule" || intent === "note") {
      const extraction = await doSchedule(input, ctx);
      return NextResponse.json({ intent, extraction });
    }
    if (intent === "expense") {
      return NextResponse.json({ intent, expense: await doExpense(input, ctx) });
    }
    if (intent === "question") {
      return NextResponse.json({
        intent,
        reply: await doQuestion(input, history, ctx),
      });
    }
    if (intent === "command") {
      // 저장된 데이터 수정·삭제는 아직 구현되지 않았다.
      // AI에게 맡기면 "처리하겠습니다"라고 답해놓고 아무것도 안 해서
      // 사용자를 속이게 되므로, 고정 문구로 사실대로 알린다.
      return NextResponse.json({
        intent,
        reply:
          "저장된 항목을 제가 직접 고치거나 지우는 기능은 아직 없습니다.\n" +
          "캘린더·투두에서 해당 항목을 눌러 직접 수정·삭제하실 수 있습니다.\n" +
          "새로 등록할 내용이라면 그대로 말씀해 주세요.",
        canExecute: false,
      });
    }
    return NextResponse.json({ intent, reply: await doChat(input, history, ctx) });
  } catch (err: any) {
    console.error("[AI] error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
