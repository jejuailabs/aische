// ==========================================
// 에이전트 루프 — 도구 호출을 반복해서 답에 도달한다
// ==========================================
//
// 흐름:
//
//   사용자 입력
//     → /api/ai/agent  (모델: "search_schedules 불러줘")
//     → 여기서 실행 (브라우저의 Zustand 데이터로)
//     → /api/ai/agent  (결과 첨부. 모델: "get_schedule 불러줘")
//     → 실행
//     → /api/ai/agent  (모델: "update_schedule 불러줘")
//     → 쓰기 도구 → **루프 중단**, 사용자 확인 대기
//
// 왜 클라이언트에서 도는가:
// 데이터가 브라우저에 있다. 서버가 직접 읽으려면 Firestore 관리자 키를
// 서버에 둬야 하는데, 그 키는 보안 규칙을 우회한다. 안 두는 쪽을 택했다.
//
// 왜 상한이 필요한가:
// 모델이 같은 도구를 무한히 반복하는 경우가 실제로 있다. 상한이 없으면
// API 요금이 계속 나가고 사용자는 로딩만 본다.

import { executeTool, type ToolData, type PendingChange } from "./tool-exec.ts";
import type { Conflict } from "./schedule-index.ts";
import { isMutating, parseToolArgs, type ToolCall } from "./tools.ts";

/** 한 번의 사용자 입력에 대해 도구를 몇 번까지 부를 수 있는지 */
export const MAX_STEPS = 6;

export interface AgentStep {
  /** 어떤 도구를 왜 불렀는지 — 화면에 진행 상황을 보여주려고 */
  tool: string;
  args: Record<string, any>;
}

export interface AgentOutcome {
  /** 사용자에게 보여줄 최종 답변 */
  text: string;
  /** 거쳐온 도구 호출들 */
  steps: AgentStep[];
  /** 확인이 필요한 변경 (있으면 UI가 확인 카드를 띄운다) */
  pending: PendingChange | null;
  /**
   * 등록 절차로 넘길 원문 (있으면 UI가 기존 추출 파이프라인을 돌려 계획 카드를 띄운다).
   * 새 일정 생성 경로는 하나만 유지한다 — 여기서 만들지 않는다.
   */
  staged: string | null;
  /**
   * 결정적으로 감지된 충돌. AI가 확인을 건너뛰어도 여기 담긴다 —
   * UI가 그대로 보여줘서 사용자가 판단할 수 있어야 한다.
   */
  conflicts: Conflict[];
  /** 상한에 걸려 중단됐는지 */
  truncated: boolean;
}

/** 서버 한 턴을 호출하는 함수 — 테스트에서 갈아끼운다 */
export type AgentTurnFn = (messages: any[]) => Promise<{
  text: string;
  toolCalls: { id: string; name: string; args: unknown }[];
  assistantTurn: any;
}>;

/** 도구 결과를 히스토리에 넣을 형태로 만드는 함수 (프로바이더별로 다름) */
export type FormatResultFn = (
  toolCallId: string,
  content: string
) => Record<string, unknown>;

export interface RunOptions {
  /** 진행 상황 알림 — "일정을 찾는 중…" 같은 표시용 */
  onStep?: (step: AgentStep) => void;
  maxSteps?: number;
}

/**
 * 도구 루프를 돌린다.
 *
 * @param userText   사용자 입력
 * @param data       조회 대상 데이터 (스토어에서 모아 넘긴다)
 * @param turn       서버 한 턴 호출
 * @param formatResult 도구 결과 포맷터
 */
export async function runAgent(
  userText: string,
  data: ToolData,
  turn: AgentTurnFn,
  formatResult: FormatResultFn,
  opts: RunOptions = {}
): Promise<AgentOutcome> {
  const maxSteps = opts.maxSteps ?? MAX_STEPS;

  const messages: any[] = [{ role: "user", content: userText }];
  const steps: AgentStep[] = [];
  const conflicts: Conflict[] = [];
  let lastText = "";

  for (let i = 0; i < maxSteps; i++) {
    const res = await turn(messages);

    // 모델이 말을 했으면 붙잡아 둔다. 마지막 턴에 도구만 부르고 끝나도
    // 직전에 한 설명이라도 보여줄 수 있어야 한다.
    if (res.text) lastText = res.text;

    // 도구 호출이 없으면 답이 나온 것이다.
    if (!res.toolCalls?.length) {
      return {
        text: res.text || lastText,
        steps,
        pending: null,
        staged: null,
        conflicts,
        truncated: false,
      };
    }

    // 모델의 턴을 히스토리에 그대로 넣는다.
    // (편집하면 프로바이더가 다음 턴에서 거부한다)
    messages.push(res.assistantTurn);

    for (const raw of res.toolCalls) {
      const call: ToolCall = {
        id: raw.id,
        name: raw.name,
        args: parseToolArgs(raw.args),
      };

      const step: AgentStep = { tool: call.name, args: call.args };
      steps.push(step);
      opts.onStep?.(step);

      const result = executeTool(call, data);
      messages.push(formatResult(call.id, result.content));

      // 충돌은 마지막 것만 남긴다 — 같은 등록을 재시도하면 같은 충돌이 또 온다.
      if (result.conflicts?.length) {
        conflicts.length = 0;
        conflicts.push(...result.conflicts);
      }

      // 쓰기 도구가 제안을 냈으면 여기서 멈춘다.
      //
      // 계속 돌리면 모델이 "수정했습니다"라고 말해버린다 — 실제로는
      // 아직 사용자 확인 전인데. 그건 거짓말이고, 예전에 실제로 그랬다.
      if (result.pending && isMutating(call.name)) {
        return {
          text: lastText || res.text || "",
          steps,
          pending: result.pending,
          staged: null,
          conflicts,
          truncated: false,
        };
      }

      // 등록 절차로 넘어갔으면 여기서 멈춘다.
      // 계속 돌리면 모델이 "등록했습니다"라고 말해버린다 — 아직 계획 카드도
      // 안 떴는데. 사용자가 저장 버튼을 눌러야 저장된다.
      if (result.staged) {
        return {
          text: lastText || res.text || "",
          steps,
          pending: null,
          staged: result.staged.text,
          conflicts,
          truncated: false,
        };
      }
    }
  }

  // 상한에 걸렸다. 조용히 빈 답을 주면 사용자는 왜 안 되는지 모른다.
  return {
    text:
      lastText ||
      "요청을 처리하다가 단계가 너무 많아져 중단했습니다. " +
        "조금 더 구체적으로 말씀해 주시겠어요?",
    steps,
    pending: null,
    staged: null,
    conflicts,
    truncated: true,
  };
}
