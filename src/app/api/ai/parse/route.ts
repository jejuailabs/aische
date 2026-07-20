import { NextRequest, NextResponse } from "next/server";
import { resolveDateExpr, toStartEnd } from "@/lib/date-expr";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const RAW_MODEL = process.env.OPENAI_TEXT_MODEL || "gpt-4o-mini";
const OPENAI_MODEL = RAW_MODEL === "gpt-5-mini" ? "gpt-4o-mini" : RAW_MODEL;

interface Ref {
  id: string;
  title: string;
}
interface PersonRef {
  id: string;
  name: string;
  org: string | null;
}
interface OrgRef {
  id: string;
  name: string;
}

interface RequestBody {
  input: string;
  projects: Ref[];
  categories: { id: string; label: string }[];
  people: PersonRef[];
  organizations: OrgRef[];
  locale: string;
}

export async function POST(req: NextRequest) {
  if (!OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured" },
      { status: 500 }
    );
  }

  const body: RequestBody = await req.json();
  const {
    input,
    projects = [],
    categories = [],
    people = [],
    organizations = [],
  } = body;

  if (!input?.trim()) {
    return NextResponse.json({ error: "Empty input" }, { status: 400 });
  }

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const dayOfWeek = ["일", "월", "화", "수", "목", "금", "토"][today.getDay()];

  const fmt = (arr: string[]) => (arr.length ? arr.join("\n") : "(없음)");

  const projectList = fmt(
    projects.map((p) => `- id:"${p.id}" title:"${p.title}"`)
  );
  const categoryList = fmt(
    categories.map((c) => `- id:"${c.id}" label:"${c.label}"`)
  );
  const peopleList = fmt(
    people.map((p) => `- id:"${p.id}" name:"${p.name}" org:"${p.org ?? ""}"`)
  );
  const orgList = fmt(organizations.map((o) => `- id:"${o.id}" name:"${o.name}"`));

  const systemPrompt = `너는 사용자의 자연어 입력을 **정보의 층(layer)으로 분해**하는 추출 엔진이다.
입력 한 줄에는 보통 여러 층의 정보가 섞여 있다. 이를 각 층으로 나눠 구조화하라.

오늘: ${todayStr} (${dayOfWeek}요일)

## 기존 데이터 (매칭에 사용)
### 프로젝트
${projectList}
### 카테고리
${categoryList}
### 등록된 인물
${peopleList}
### 등록된 조직
${orgList}

## 출력 형식 (JSON only)
{
  "summary": "입력 내용 한 줄 요약",
  "intent": "schedule" | "todo" | "goal" | "contact" | "note" | "mixed",
  "schedule": {
    "title": "일정 제목 (날짜/장소 표현 제거한 핵심만)",
    "dateExpr": "입력에 나온 날짜/시각 표현을 원문 그대로. 예: \\"다음주 화요일 오후 2시\\", \\"8월 5일\\", \\"내일 저녁 7시\\". 없으면 null",
    "startAt": "ISO 8601 또는 null (dateExpr 기반 네 추정치)",
    "endAt": "ISO 8601 또는 null",
    "dueAt": "ISO 8601 또는 null",
    "allDay": true|false,
    "location": "장소 또는 null",
    "categoryId": "위 카테고리 id 또는 null"
  } | null,
  "people": [
    {
      "name": "이름",
      "role": "직함/역할 또는 null",
      "org": "소속 조직명 또는 null",
      "phone": "전화번호 또는 null",
      "email": "이메일 또는 null",
      "matchedPersonId": "기존 인물 id (동일인이면) 또는 null",
      "isNew": true|false
    }
  ],
  "organizations": [
    {
      "name": "조직명",
      "orgType": "회사|협의회|학교|동호회|기관|기타 또는 null",
      "matchedOrgId": "기존 조직 id 또는 null",
      "isNew": true|false
    }
  ],
  "project": {
    "matchedProjectId": "기존 프로젝트 id 또는 null",
    "matchConfidence": 0-100,
    "newProjectSuggestion": "매칭 실패 시 제안할 새 프로젝트명 또는 null"
  } | null,
  "tasks": [
    {
      "title": "실행 항목",
      "kind": "task" | "project",
      "dueExpr": "마감 날짜 표현 원문 (예: \\"이번주 금요일\\") 또는 null",
      "dueAt": "ISO 8601 또는 null",
      "completionMode": "manual" | "deliverable" | "checklist"
    }
  ],
  "notes": ["어느 층에도 안 들어간 잔여 정보"]
}

## 추출 규칙
1. **날짜/시간** → schedule 층. 오늘은 ${todayStr}(${dayOfWeek})이다.
   - **가장 중요: \`dateExpr\`에 입력에 등장한 날짜·시각 표현을 원문 그대로 복사하라.**
     "다음주 화요일에 미팅" → dateExpr: "다음주 화요일"
     "8월 5일 오후 2시 강의" → dateExpr: "8월 5일 오후 2시"
     날짜 언급이 전혀 없으면 dateExpr: null.
     실제 날짜 계산은 서버가 하므로, 네가 startAt을 틀려도 dateExpr만 정확하면 된다.
   - startAt/endAt은 참고용 추정치로만 채워라.
   - 시각이 명시되면 allDay=false, 없으면 allDay=true.
2. **사람 이름** → people 층. "김대표", "박과장님", "이철수 팀장" 같은 표현에서 이름/직함 분리.
   - 기존 등록 인물과 같은 사람으로 보이면 matchedPersonId 채우고 isNew=false.
   - 전화번호(010-xxxx-xxxx), 이메일이 있으면 반드시 뽑는다. 명함 텍스트면 전부 추출.
3. **조직/단체명** → organizations 층. "마을만들기 협의회", "OO주식회사", "△△고등학교" 등.
4. **프로젝트 매칭** → 기존 프로젝트와 내용이 맞으면 matchedProjectId + confidence.
   - confidence 30 미만이면 matchedProjectId=null 로 두고, 반복될 만한 주제면 newProjectSuggestion 제안.
5. **실행 항목** → tasks 층.
   - kind: 한 번 실행하면 끝나면 "task", 여러 하위 작업이 필요하면 "project".
   - completionMode: 결과물 파일/문서가 나와야 하면 "deliverable", 여러 단계 확인이 필요하면 "checklist", 단순 체크면 "manual".
6. 해당 층에 정보가 없으면 빈 배열 [] 또는 null. 억지로 만들지 마라.

JSON만 출력. 마크다운 코드펜스 금지.`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: input },
        ],
        temperature: 0.2,
        max_tokens: 1600,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error("[AI parse] OpenAI error:", response.status, errBody);
      return NextResponse.json(
        { error: "OpenAI API error", detail: errBody, model: OPENAI_MODEL },
        { status: 502 }
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return NextResponse.json(
        { error: "Empty response from OpenAI" },
        { status: 502 }
      );
    }

    const cleaned = content
      .replace(/^```json\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    const parsed = JSON.parse(cleaned);

    // ── 날짜 재계산 ──
    // LLM의 날짜 산술은 신뢰할 수 없으므로, dateExpr를 코드로 다시 계산해
    // 성공하면 AI가 준 startAt/endAt을 덮어쓴다.
    let schedule = parsed.schedule ?? null;
    if (schedule?.dateExpr) {
      const resolved = resolveDateExpr(schedule.dateExpr, today);
      if (resolved) {
        const { startAt, endAt, allDay } = toStartEnd(resolved);
        schedule = { ...schedule, startAt, endAt, allDay };
        console.log(
          `[AI parse] 날짜 재계산: "${schedule.dateExpr}" → ${startAt} (${resolved.rule})`
        );
      }
    }

    // tasks의 dueAt도 동일하게 처리
    const tasks = (Array.isArray(parsed.tasks) ? parsed.tasks : []).map(
      (tk: any) => {
        if (!tk?.dueExpr) return tk;
        const r = resolveDateExpr(tk.dueExpr, today);
        return r ? { ...tk, dueAt: toStartEnd(r).startAt } : tk;
      }
    );

    // 방어적 정규화 — 누락 필드 채우기
    const result = {
      summary: parsed.summary ?? input.slice(0, 80),
      intent: parsed.intent ?? "note",
      schedule,
      people: Array.isArray(parsed.people) ? parsed.people : [],
      organizations: Array.isArray(parsed.organizations)
        ? parsed.organizations
        : [],
      project: parsed.project ?? null,
      tasks,
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
    };

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[AI parse] Error:", err);
    return NextResponse.json(
      { error: err.message || "Internal error" },
      { status: 500 }
    );
  }
}
