// ==========================================
// AI 도구 정의 — AI가 스스로 상황을 조회하고 고치게 하는 층
// ==========================================
//
// 왜 이게 필요한가:
//
// 이전 구조는 "의도 분류 → 정해진 담당자 → 정해진 JSON 스키마"였다.
// AI가 할 수 있는 일이 미리 짜둔 분기 안에만 있어서,
// "오늘 당근 모임 설명란에 내용 추가해줘" 같은 요청은 분기가 없어 못 했다.
// AI가 못 알아들은 게 아니라 손발이 없었다.
//
// 그리고 그 구조 때문에 컨텍스트를 계속 **미리 추측해서 통째로** 밀어넣어야 했다.
// (기억 인덱스, 일정 목록…) 추측이 빗나가면 AI는 없는 데이터를 근거로 답한다.
// 실제로 "오늘 당근 모임 있잖아"에 "등록된 일정이 없다"고 답한 사고가 그것이다.
//
// 도구를 주면 AI가 필요할 때 직접 찾는다. 미리 맞출 필요가 없다.
//
// 설계 원칙 세 가지:
//
// 1. **읽기는 자유, 쓰기는 확인.**
//    조회는 AI가 마음대로 한다. 생성·수정·삭제는 사용자가 확인해야 실행된다.
//    AI가 잘못 판단해서 지운 건 되돌릴 수 없다.
//
// 2. **계산은 여전히 코드가 한다.**
//    "다음주 화요일"을 AI가 날짜로 바꾸지 않는다. 표현을 그대로 넘기면
//    도구 실행 쪽(date-expr.ts)이 계산한다. AI는 언제 계산할지만 정한다.
//
// 3. **실행은 클라이언트에서.**
//    데이터가 브라우저(Zustand/Firestore)에 있다. 서버는 "다음에 뭘 할지"만
//    답하고, 조회·수정은 브라우저가 한다. 서버에 관리자 키를 둘 필요가 없다.

/** OpenAI/Anthropic 공통으로 쓸 수 있는 최소 형태의 도구 정의 */
export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** true면 실행 전에 사용자 확인이 필요하다 */
  mutating: boolean;
}

const str = (description: string) => ({ type: "string", description });
const optStr = (description: string) => ({
  type: ["string", "null"],
  description,
});

export const TOOLS: ToolDef[] = [
  // ─────────────── 읽기 ───────────────
  {
    name: "search_schedules",
    description:
      "등록된 일정을 찾는다. 무엇을 고칠지/이미 있는지 확인하려면 **먼저 이걸 호출하라.** " +
      "결과가 비면 그런 일정이 없는 것이다. 추측하지 말고 이 결과를 근거로 답하라.",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        query: optStr(
          "제목에서 찾을 말. 부분 일치. 전부 보려면 생략."
        ),
        dateExpr: optStr(
          "날짜 표현 원문. 예: \"오늘\", \"이번주\", \"7월 21일\". " +
            "**직접 날짜로 바꾸지 마라.** 사용자가 말한 표현을 그대로 넣어라. 서버가 계산한다."
        ),
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "get_schedule",
    description:
      "일정 하나의 전체 내용을 본다. 설명·장소·참석자·원본 입력까지 나온다. " +
      "수정하기 전에 지금 값이 뭔지 확인할 때 쓴다.",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        id: str("search_schedules가 돌려준 일정 id"),
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "search_notes",
    description:
      "저장된 메모·주제·일기를 찾는다. 일정이 아닌 기록을 물을 때 쓴다.",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        query: str("찾을 말"),
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "search_people",
    description: "등록된 인물을 찾는다. 연락처·소속을 물을 때 쓴다.",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        query: str("이름 또는 소속"),
      },
      required: ["query"],
      additionalProperties: false,
    },
  },

  // ─────────────── 등록으로 넘기기 ───────────────
  {
    name: "stage_new_entry",
    description:
      "사용자가 **새로 알려준 내용**을 등록 절차로 넘긴다. " +
      "일정·할일·메모·인물 등 저장할 만한 내용이면 이걸 호출하라. " +
      "네가 직접 만드는 게 아니라, 기존 등록 화면(계획 카드)이 뜬다. " +
      "\n\n" +
      "**호출 전에 search_schedules로 이미 있는지 반드시 확인하라.** " +
      "비슷한 게 있으면 넘기지 말고 사용자에게 먼저 물어라. " +
      "예: \"당근 모임은 이미 매주 화요일로 등록돼 있는데, 이번 건은 따로 추가할까요?\"",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        text: str(
          "등록할 내용. 사용자가 말한 원문을 그대로 넣어라. " +
            "여러 턴에 걸쳐 정보가 모였으면 합쳐서 한 문장으로."
        ),
        title: optStr(
          "일정의 핵심 제목만. 날짜·시각·조사를 뺀 이름. " +
            "예: \"오늘 당근 모임 잡아줘\" → \"당근 모임\". " +
            "**중복 판정에 쓰이므로 정확히 넣어라.** 없으면 text로 대충 판정한다."
        ),
      },
      required: ["text"],
      additionalProperties: false,
    },
  },

  // ─────────────── 쓰기 (확인 필요) ───────────────
  {
    name: "update_schedule",
    description:
      "일정의 내용을 고친다. **먼저 search_schedules로 대상을 확정한 뒤** 호출하라. " +
      "바꿀 필드만 넣어라. 안 넣은 필드는 그대로 둔다. " +
      "사용자 확인을 거쳐야 실제로 적용된다.",
    mutating: true,
    parameters: {
      type: "object",
      properties: {
        id: str("고칠 일정의 id"),
        title: optStr("새 제목"),
        description: optStr(
          "새 설명. **기존 내용에 덧붙이는 것이면 get_schedule로 현재 값을 읽어 " +
            "합친 전체 문자열을 넣어라.** 이 값이 통째로 대체된다."
        ),
        dateExpr: optStr(
          "새 날짜·시각 표현 원문. 예: \"내일 3시\". 직접 계산하지 마라."
        ),
        location: optStr("새 장소"),
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_schedule",
    description:
      "일정을 지운다. 되돌릴 수 없다. 사용자가 명확히 삭제를 요청했을 때만 쓴다. " +
      "사용자 확인을 거쳐야 실제로 적용된다.",
    mutating: true,
    parameters: {
      type: "object",
      properties: {
        id: str("지울 일정의 id"),
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
];

/** 이름으로 도구를 찾는다 */
export function findTool(name: string): ToolDef | null {
  return TOOLS.find((t) => t.name === name) ?? null;
}

/** 쓰기 도구인지 — 확인 게이트를 태울지 판단 */
export function isMutating(name: string): boolean {
  return findTool(name)?.mutating ?? false;
}

/** OpenAI Chat Completions 형식으로 변환 */
export function toOpenAITools() {
  return TOOLS.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/** Anthropic Messages 형식으로 변환 */
export function toAnthropicTools() {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

// ────────────────────── 실행 결과 ──────────────────────

export interface ToolCall {
  /** 모델이 준 호출 id — 결과를 되돌려줄 때 짝을 맞춘다 */
  id: string;
  name: string;
  args: Record<string, any>;
}

export interface ToolResult {
  id: string;
  name: string;
  /** 모델에게 돌려줄 내용 (JSON 문자열) */
  content: string;
}

/**
 * 도구 호출 인자를 안전하게 파싱한다.
 *
 * 모델이 JSON을 깨뜨려 보내는 일이 있다. 그때 throw 하면 대화 전체가 죽으므로,
 * 빈 객체로 떨어뜨리고 실행 쪽에서 "인자가 없다"고 응답하게 둔다.
 */
export function parseToolArgs(raw: unknown): Record<string, any> {
  if (raw && typeof raw === "object") return raw as Record<string, any>;
  if (typeof raw !== "string") return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/**
 * 도구 호출이 실행 가능한지 검사한다.
 *
 * 모르는 도구 이름, 필수 인자 누락을 여기서 잡아 **모델에게 되돌려준다.**
 * 조용히 무시하면 모델은 자기가 뭘 잘못했는지 모른 채 같은 걸 반복한다.
 */
export function validateToolCall(call: ToolCall): string | null {
  const def = findTool(call.name);
  if (!def) return `알 수 없는 도구: ${call.name}`;

  const required = (def.parameters as any)?.required ?? [];
  for (const key of required) {
    const v = call.args[key];
    if (v === undefined || v === null || v === "") {
      return `필수 인자 누락: ${key}`;
    }
  }
  return null;
}
