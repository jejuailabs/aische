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

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const RAW_MODEL = process.env.OPENAI_TEXT_MODEL || "gpt-4o-mini";
const MODEL = RAW_MODEL === "gpt-5-mini" ? "gpt-4o-mini" : RAW_MODEL;

export type Intent = "chat" | "schedule" | "command" | "question";

interface Ctx {
  projects: { id: string; title: string }[];
  categories: { id: string; label: string }[];
  people: { id: string; name: string; org: string | null }[];
  organizations: { id: string; name: string }[];
  /** 최근/다가오는 일정 요약 — 질문 답변에 사용 */
  upcoming: { title: string; when: string; recurrence: string | null }[];
  counts: Record<string, number>;
}

interface Body {
  input: string;
  /** 직전 대화 (최근 6턴) */
  history: { role: "user" | "assistant"; content: string }[];
  ctx: Ctx;
  locale: string;
}

async function callOpenAI(
  system: string,
  messages: { role: string; content: string }[],
  json: boolean
) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "system", content: system }, ...messages],
      temperature: json ? 0.2 : 0.6,
      max_tokens: json ? 1600 : 700,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`OpenAI ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.choices?.[0]?.message?.content ?? "").trim();
}

function parseJson(raw: string): any {
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  return JSON.parse(cleaned);
}

function todayInfo() {
  const now = new Date();
  const dow = ["일", "월", "화", "수", "목", "금", "토"][now.getDay()];
  const str = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return { now, str, dow };
}

function ctxSummary(ctx: Ctx): string {
  const list = (arr: string[]) => (arr.length ? arr.join(", ") : "(없음)");
  return [
    `프로젝트: ${list(ctx.projects.map((p) => p.title))}`,
    `카테고리: ${list(ctx.categories.map((c) => c.label))}`,
    `등록된 인물: ${list(ctx.people.map((p) => p.name))}`,
    `조직: ${list(ctx.organizations.map((o) => o.name))}`,
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

// ─────────────────────────────────────────
// 1단계: 의도 분류
// ─────────────────────────────────────────

async function classify(
  input: string,
  history: Body["history"],
  ctx: Ctx
): Promise<{ intent: Intent; reason: string }> {
  const { str, dow } = todayInfo();
  const system = `너는 일정관리 앱의 라우터다. 사용자 입력이 무엇을 원하는지 분류만 한다.

오늘: ${str}(${dow})
${ctxSummary(ctx)}

분류:
- "schedule" : 새로운 일정/할일/목표를 등록하려는 입력. 날짜·사람·장소가 담긴 정보성 문장, 명함 텍스트 등.
    예) "다음주 화요일 3시 팀미팅", "매주 월요일 운동", "김철수 010-1234-5678 명함"
- "question" : 이미 저장된 자기 데이터에 대한 질의.
    예) "이번주 일정 뭐 있어?", "김철수 연락처 뭐였지?", "그 미팅 언제였지?"
- "command"  : 저장된 데이터를 바꾸거나 지우라는 지시.
    예) "그 일정 취소해줘", "매주로 바꿔줘", "미팅 3시로 옮겨"
- "chat"     : 그 외 대화. 질문·확인·잡담·앱 사용법·직전 답변에 대한 반문.
    예) "매주라고 했는데 그건 적용이 어렵나?", "고마워", "이거 어떻게 써?"

중요:
- **물음표로 끝나거나 되묻는 문장은 대부분 schedule이 아니다.** 새 일정을 만들라는 게 아니라 묻는 것이다.
- 직전 대화 맥락을 보고 판단하라. 앞서 일정을 만들었고 지금 그에 대해 되묻는다면 chat 또는 command다.
- 애매하면 schedule이 아니라 chat으로 보내라. 잘못 저장하는 것보다 되묻는 게 낫다.

JSON만 출력: {"intent":"chat|schedule|command|question","reason":"한 줄 근거"}`;

  const msgs = [
    ...history.slice(-6).map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: input },
  ];
  const raw = await callOpenAI(system, msgs, true);
  const p = parseJson(raw);
  const intent: Intent = ["chat", "schedule", "command", "question"].includes(
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
  const system = `너는 GoalFlow라는 일정관리 앱의 비서다. 한국어로 간결하게 대화한다.

오늘: ${str}(${dow})
현재 사용자 데이터:
${ctxSummary(ctx)}

지침:
- 2~4문장으로 짧게 답한다. 장황하게 굴지 마라.
- 앱이 할 수 있는 것: 일정/할일/목표 등록, 반복 일정(매일·매주·격주·매월), 인물·조직(명함) 저장,
  프로젝트 자동 분류, 만다라트 목표 관리, 데이터 수정·삭제.
- 사용자가 기능 가능 여부를 물으면 위 목록을 근거로 사실대로 답한다. 되는 걸 안 된다고 하지 말고,
  안 되는 걸 된다고도 하지 마라.
- 일정을 만들어달라는 뜻으로 보이면, 필요한 정보(날짜·시각)를 되물어라.
- 이미 저장된 내용을 물으면 위 "다가오는 일정"을 근거로 답하라.

JSON 금지. 평문으로만 답하라.`;

  const msgs = [
    ...history.slice(-6).map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: input },
  ];
  return callOpenAI(system, msgs, false);
}

// ─────────────────────────────────────────
// 2단계-B: 일정 담당 (층 분해 + 반복)
// ─────────────────────────────────────────

async function doSchedule(input: string, ctx: Ctx) {
  // input은 아래 날짜 보정에서도 쓰인다
  const { now, str, dow } = todayInfo();
  const fmt = (a: string[]) => (a.length ? a.join("\n") : "(없음)");

  const system = `너는 자연어를 **정보의 층으로 분해**하는 추출 엔진이다.

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

## 출력 (JSON only)
{
  "summary": "한 줄 요약",
  "intent": "schedule|todo|goal|contact|note|mixed",
  "schedule": {
    "title": "날짜/장소 뺀 핵심 제목",
    "dateExpr": "입력에 나온 날짜·시각 표현 원문 (예: \\"다음주 화요일 오후 2시\\") 없으면 null",
    "recurrenceExpr": "반복 표현 원문 (예: \\"매주\\", \\"격주 월수금\\", \\"매일\\") 없으면 null",
    "startAt": null, "endAt": null, "dueAt": null,
    "allDay": true, "location": null, "categoryId": null
  } | null,
  "people": [{"name":"","role":null,"org":null,"phone":null,"email":null,"matchedPersonId":null,"isNew":true}],
  "organizations": [{"name":"","orgType":null,"matchedOrgId":null,"isNew":true}],
  "project": {"matchedProjectId":null,"matchConfidence":0,"newProjectSuggestion":null} | null,
  "tasks": [{"title":"","kind":"task|project","dueExpr":null,"dueAt":null,"completionMode":"manual|deliverable|checklist"}],
  "notes": []
}

## 규칙
1. **날짜는 계산하지 마라.** dateExpr에 원문을 그대로 복사만 해라. 서버가 계산한다.
2. **반복 표현은 recurrenceExpr에 원문 그대로.** "매주", "매주 화요일", "격주", "매일", "매월 15일",
   "주 3회", "월수금" 등. 반복이 아니면 null.
3. 사람 이름/직함/전화/이메일은 people 층으로. 기존 인물과 동일인이면 matchedPersonId 채우고 isNew=false.
4. 조직·단체명은 organizations 층으로.
5. 프로젝트는 내용이 맞을 때만 matchedProjectId. confidence 30 미만이면 null.
6. 정보가 없는 층은 빈 배열/null. 억지로 만들지 마라.

JSON만. 코드펜스 금지.`;

  const raw = await callOpenAI(system, [{ role: "user", content: input }], true);
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
  };
}

function toLocalISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
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
  const system = `너는 사용자의 일정 데이터에 대해 답하는 비서다.

오늘: ${str}(${dow})
${ctxSummary(ctx)}
저장 현황: ${Object.entries(ctx.counts)
    .map(([k, v]) => `${k} ${v}건`)
    .join(", ")}

위 데이터에만 근거해 한국어로 2~4문장으로 답하라.
데이터에 없는 내용은 지어내지 말고 "저장된 내역이 없다"고 말하라.
평문으로만 답하라.`;

  const msgs = [
    ...history.slice(-4).map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: input },
  ];
  return callOpenAI(system, msgs, false);
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
    upcoming: body.ctx?.upcoming ?? [],
    counts: body.ctx?.counts ?? {},
  };
  const history = Array.isArray(body.history) ? body.history : [];

  try {
    const { intent, reason } = await classify(input, history, ctx);
    console.log(`[AI] intent=${intent} (${reason}) input="${input.slice(0, 40)}"`);

    if (intent === "schedule") {
      const extraction = await doSchedule(input, ctx);
      return NextResponse.json({ intent, extraction });
    }
    if (intent === "question") {
      return NextResponse.json({
        intent,
        reply: await doQuestion(input, history, ctx),
      });
    }
    if (intent === "command") {
      // 시스템 조작은 아직 실행하지 않고, 무엇을 할지 대화로 확인만 한다.
      const reply = await doChat(input, history, ctx);
      return NextResponse.json({ intent, reply, needsConfirm: true });
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
