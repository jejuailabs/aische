// ==========================================
// 에이전트 — AI가 도구를 써서 스스로 조회·수정하는 경로
// ==========================================
//
// 기존 /api/ai 와의 차이:
//
//   /api/ai       분류 → 정해진 담당자 → 정해진 스키마
//                 (내가 짜둔 분기 안에서만 동작. "설명란에 추가해줘"는 분기가 없어 못 함)
//
//   /api/ai/agent 도구를 주고 모델이 알아서 호출
//                 (search → get → update 순서를 모델이 정한다)
//
// 이 라우트는 **한 턴만** 처리한다. 도구 실행은 브라우저가 한다 —
// 데이터가 Zustand/Firestore에 있고, 서버에 관리자 키를 두지 않기로 했다.
// 그래서 흐름이 이렇다:
//
//   브라우저 → (이 라우트) → 모델이 "search_schedules 불러줘"
//   브라우저가 실행 → (이 라우트) 결과 첨부 → 모델이 "update_schedule 불러줘"
//   브라우저가 확인 요청 → 사용자 확인 → 적용
//
// 루프 상한은 클라이언트가 건다. 여기선 한 번의 왕복만 책임진다.

import { NextRequest, NextResponse } from "next/server";
import {
  chatWithTools,
  todayInfo,
  getModel,
  getProvider,
  OpenAIError,
} from "@/lib/llm";
import { composeSystem } from "@/lib/doctrine";
import { toOpenAITools, toAnthropicTools } from "@/lib/tools";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

interface Body {
  /**
   * 대화 히스토리. assistant 턴과 tool 결과가 프로바이더 원본 형태로 섞여 있다.
   * 클라이언트가 그대로 누적해서 보낸다.
   */
  messages: { role: string; content: any; [k: string]: any }[];
  /** 화면에 이미 보이는 요약 — 매번 도구를 부르지 않아도 되게 */
  summary?: string;
}

export async function POST(req: NextRequest) {
  if (!OPENAI_API_KEY && !ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "AI API 키가 설정되지 않았습니다" },
      { status: 500 }
    );
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) {
    return NextResponse.json({ error: "messages가 비었습니다" }, { status: 400 });
  }

  const { str, dow } = todayInfo();

  const system = composeSystem(
    `너는 GoalFlow라는 일정관리 앱의 비서다. 한국어로 간결하게 대화한다.

오늘: ${str}(${dow})

${body.summary ?? ""}`,
    ["CONVERSE", "UNCERTAIN", "TIME_UNSPECIFIED"],
    `## 도구 사용

너는 도구로 **직접 조회하고 고칠 수 있다.** 추측하지 말고 도구를 써라.

1. **모르면 먼저 찾아라.**
   "오늘 당근 모임" 같은 말이 나오면 search_schedules를 호출해서 확인하라.
   기억이나 짐작으로 "그런 일정이 없다"고 답하지 마라.
   도구가 count 0을 돌려줬을 때만 없다고 말할 수 있다.

2. **고치기 전에 현재 값을 읽어라.**
   설명을 "추가"해 달라는 요청은 기존 내용을 지우라는 뜻이 아니다.
   get_schedule로 현재 description을 읽고, 거기에 덧붙인 **전체 문자열**을
   update_schedule에 넣어라. 그냥 새 내용만 넣으면 기존 내용이 사라진다.

3. **날짜는 네가 계산하지 마라.**
   dateExpr에 사용자가 말한 표현을 그대로 넣어라. 서버가 계산한다.

4. **쓰기 도구는 사용자 확인을 거친다.**
   update_schedule / delete_schedule을 호출해도 **아직 적용되지 않는다.**
   "수정했습니다", "삭제했습니다"라고 말하지 마라. 거짓이 된다.
   "이렇게 바꿀까요?"처럼 확인을 요청하는 문장으로 답하라.

5. **대상이 여러 개면 묻고, 없으면 없다고 말하라.**
   search 결과가 여러 건이면 어느 것인지 사용자에게 물어라.
   임의로 고르지 마라.

6. **새로 등록할 내용은 stage_new_entry로 넘겨라.**
   네가 직접 만드는 게 아니라 등록 카드가 뜬다. 저장은 사용자가 누른다.

## 등록 전 충돌 확인 — 이게 핵심이다

사용자가 새 일정처럼 말해도 **바로 넘기지 마라. 먼저 search_schedules로 확인하라.**
이미 있는 걸 또 만들면 캘린더에 같은 게 두 개 생긴다.

확인 결과에 따라:

- **똑같은 게 이미 있다** → 넘기지 말고 알려라.
  "그건 이미 7월 21일에 '당근 모임'으로 등록돼 있습니다. 그대로 두시겠어요?"

- **반복 일정으로 이미 잡혀 있다** → 이번 건이 그 회차인지 물어라.
  "당근 모임은 매주 화요일 반복으로 등록돼 있는데, 이번 건은 따로 추가할까요?"

- **비슷한데 확실치 않다** → 무엇과 헷갈리는지 밝히고 물어라.
  "'당근 모임 바이브코딩'이 25일에 있는데, 그것과 다른 일정인가요?"

- **없다** → stage_new_entry로 넘긴다.

**임의로 판단해서 넘기거나 버리지 마라.** 애매하면 사용자에게 묻는다.
사용자가 "그래도 추가해"라고 하면 그때 넘긴다.

평문으로 답하라. JSON을 쓰지 마라.`
  );

  const tools =
    getProvider() === "anthropic" ? toAnthropicTools() : toOpenAITools();

  try {
    const result = await chatWithTools({
      system,
      messages,
      tools,
      maxTokens: 900,
      temperature: 0.4,
    });

    return NextResponse.json({
      text: result.text,
      toolCalls: result.toolCalls,
      assistantTurn: result.assistantTurn,
      model: getModel(),
    });
  } catch (err: any) {
    console.error("[agent] error:", err);
    const status = err instanceof OpenAIError ? err.status : 500;
    return NextResponse.json(
      { error: err?.message ?? "Internal error" },
      { status }
    );
  }
}
