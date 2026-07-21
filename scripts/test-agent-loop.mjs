// 에이전트 루프 테스트
//
// 여기서 반드시 지켜야 하는 것:
//
// 1. 쓰기 도구가 나오면 **즉시 멈춘다.**
//    안 멈추면 모델이 이어서 "수정했습니다"라고 말한다. 아직 확인 전인데.
//    "처리했다고 거짓말한다"는 게 이 앱에서 실제로 반복된 사고다.
//
// 2. 무한 반복을 상한으로 끊는다. 안 끊으면 요금이 계속 나간다.
//
// 3. 도구 실행이 실패해도 루프가 죽지 않는다.

import { runAgent, MAX_STEPS } from "../src/lib/agent-loop.ts";

let passed = 0;
let failed = 0;

function check(name, cond, detail = "") {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}`);
  }
}

const node = (over = {}) => ({
  id: "n1",
  title: "당근 모임",
  description: "기존 내용",
  status: "scheduled",
  aiMeta: null,
  capturedInputId: null,
  schedule: {
    startAt: new Date(2026, 6, 21),
    endAt: new Date(2026, 6, 21),
    allDay: true,
    recurrence: null,
    location: null,
    attendees: [],
    category: null,
  },
  ...over,
});

const data = (over = {}) => ({
  nodes: [node()],
  people: [],
  topics: [],
  captures: [],
  ...over,
});

// OpenAI 형식 포맷터 (실제로 쓰는 것과 같은 모양)
const fmt = (id, content) => ({ role: "tool", tool_call_id: id, content });

/** 정해진 순서대로 응답하는 가짜 모델 */
function scriptedTurn(script) {
  let i = 0;
  const seen = [];
  const fn = async (messages) => {
    seen.push(JSON.parse(JSON.stringify(messages.length)));
    const step = script[Math.min(i, script.length - 1)];
    i++;
    return {
      text: step.text ?? "",
      toolCalls: step.toolCalls ?? [],
      assistantTurn: { role: "assistant", content: step.text ?? "" },
    };
  };
  fn.calls = () => i;
  fn.lengths = seen;
  return fn;
}

const tc = (name, args, id = "c" + Math.random().toString(36).slice(2, 6)) => ({
  id,
  name,
  args,
});

// ── 도구 없이 바로 답 ──
{
  const turn = scriptedTurn([{ text: "안녕하세요!" }]);
  const out = await runAgent("안녕", data(), turn, fmt);
  check("도구 없으면 한 번에 끝난다", turn.calls() === 1);
  check("답변이 그대로", out.text === "안녕하세요!");
  check("pending 없음", out.pending === null);
  check("잘리지 않음", out.truncated === false);
}

// ── 검색 → 답변 ──
{
  const turn = scriptedTurn([
    { text: "찾아볼게요", toolCalls: [tc("search_schedules", { dateExpr: "오늘" })] },
    { text: "오늘 당근 모임이 있습니다." },
  ]);
  const out = await runAgent("오늘 일정 뭐 있어?", data(), turn, fmt);
  check("두 번 왕복", turn.calls() === 2);
  check("검색 단계가 기록된다", out.steps[0]?.tool === "search_schedules");
  check("최종 답변이 나온다", out.text === "오늘 당근 모임이 있습니다.");
}

// ── 쓰기 도구가 나오면 즉시 멈춘다 (가장 중요) ──
{
  const turn = scriptedTurn([
    { toolCalls: [tc("search_schedules", { query: "당근" })] },
    { toolCalls: [tc("get_schedule", { id: "n1" })] },
    {
      text: "이렇게 바꿀까요?",
      toolCalls: [tc("update_schedule", { id: "n1", description: "기존 내용\n추가" })],
    },
    // 여기까지 오면 안 된다 — 오면 모델이 "수정했습니다"라고 말해버린다
    { text: "수정했습니다!" },
  ]);
  const out = await runAgent("설명 추가해줘", data(), turn, fmt);

  check("쓰기에서 멈춘다", turn.calls() === 3, `calls=${turn.calls()}`);
  check("'수정했습니다'까지 가지 않는다", out.text !== "수정했습니다!", out.text);
  check("pending이 돌아온다", out.pending?.kind === "update_schedule");
  check("대상이 담긴다", out.pending?.targetTitle === "당근 모임");
  check(
    "전/후가 담긴다",
    out.pending?.changes?.[0]?.before === "기존 내용" &&
      out.pending?.changes?.[0]?.after === "기존 내용\n추가"
  );
  check("실제 데이터는 안 바뀐다", data().nodes[0].description === "기존 내용");
}

// ── 삭제도 멈춘다 ──
{
  const turn = scriptedTurn([
    { toolCalls: [tc("delete_schedule", { id: "n1" })] },
    { text: "지웠습니다!" },
  ]);
  const out = await runAgent("지워줘", data(), turn, fmt);
  check("삭제에서 멈춘다", turn.calls() === 1);
  check("'지웠습니다'까지 안 간다", out.text !== "지웠습니다!");
  check("삭제 pending", out.pending?.kind === "delete_schedule");
}

// ── 무한 반복을 상한으로 끊는다 ──
{
  const turn = scriptedTurn([
    { toolCalls: [tc("search_schedules", { query: "당근" })] }, // 계속 반복됨
  ]);
  const out = await runAgent("반복", data(), turn, fmt, { maxSteps: 3 });
  check("상한만큼만 돈다", turn.calls() === 3, `calls=${turn.calls()}`);
  check("truncated 표시", out.truncated === true);
  check("빈 답을 주지 않는다", out.text.length > 0, out.text);
  check("기본 상한이 있다", MAX_STEPS > 0 && MAX_STEPS <= 10);
}

// ── 도구 실행 실패해도 루프가 계속된다 ──
{
  const turn = scriptedTurn([
    { toolCalls: [tc("get_schedule", { id: "없는id" })] },
    { text: "그런 일정을 찾지 못했습니다." },
  ]);
  const out = await runAgent("확인", data(), turn, fmt);
  check("실패해도 안 죽는다", turn.calls() === 2);
  check("모델이 실패를 받아 답한다", /찾지 못했/.test(out.text));
}

// ── 모르는 도구도 죽지 않는다 ──
{
  const turn = scriptedTurn([
    { toolCalls: [tc("rm_rf", {})] },
    { text: "그건 못 합니다." },
  ]);
  const out = await runAgent("삭제해", data(), turn, fmt);
  check("모르는 도구는 error로 전달되고 계속", turn.calls() === 2, out.text);
}

// ── 한 턴에 도구 여러 개 ──
{
  const turn = scriptedTurn([
    {
      toolCalls: [
        tc("search_schedules", { query: "당근" }, "a"),
        tc("search_people", { query: "강소희" }, "b"),
      ],
    },
    { text: "둘 다 확인했습니다." },
  ]);
  const out = await runAgent("둘 다 찾아줘", data(), turn, fmt);
  check("도구 두 개가 모두 기록된다", out.steps.length === 2, String(out.steps.length));
  check("결과가 모두 반영된 뒤 답한다", out.text === "둘 다 확인했습니다.");
}

// ── 진행 상황 콜백 ──
{
  const seen = [];
  const turn = scriptedTurn([
    { toolCalls: [tc("search_schedules", { query: "당근" })] },
    { text: "완료" },
  ]);
  await runAgent("찾아줘", data(), turn, fmt, { onStep: (s) => seen.push(s.tool) });
  check("단계마다 콜백이 온다", seen.join(",") === "search_schedules", seen.join(","));
}

// ── 마지막 턴에 도구만 부르고 끝나도 직전 설명은 남긴다 ──
{
  const turn = scriptedTurn([
    { text: "일정을 확인하고 있습니다", toolCalls: [tc("search_schedules", { query: "x" })] },
  ]);
  const out = await runAgent("확인", data(), turn, fmt, { maxSteps: 1 });
  check(
    "직전 설명이라도 보여준다",
    out.text === "일정을 확인하고 있습니다",
    out.text
  );
}

// ── 등록으로 넘기면 멈춘다 (계획 카드가 떠야 하므로) ──
{
  const turn = scriptedTurn([
    { toolCalls: [tc("search_schedules", { query: "회식" })] },
    { text: "등록할게요", toolCalls: [tc("stage_new_entry", { text: "내일 7시 회식" })] },
    { text: "등록했습니다!" }, // 여기 오면 안 된다
  ]);
  const out = await runAgent("내일 7시 회식", data(), turn, fmt);
  check("등록 넘김에서 멈춘다", turn.calls() === 2, `calls=${turn.calls()}`);
  check("'등록했습니다'까지 안 간다", out.text !== "등록했습니다!", out.text);
  check("staged에 원문이 담긴다", out.staged === "내일 7시 회식", String(out.staged));
  check("staged일 때 pending은 없다", out.pending === null);
}

// ── 충돌이 있으면 카드를 안 띄우고 되묻는다 (AI가 search를 안 불러도) ──
{
  // 모델이 확인 없이 곧장 등록을 시도하는 최악의 경우
  const turn = scriptedTurn([
    {
      toolCalls: [
        tc("stage_new_entry", { text: "오늘 당근 모임", title: "당근 모임" }),
      ],
    },
    { text: "이미 등록돼 있는데 그래도 추가할까요?" },
  ]);
  const out = await runAgent("오늘 당근 모임 잡아줘", data(), turn, fmt);

  check("충돌이 감지된다", out.conflicts.length > 0, JSON.stringify(out.conflicts));
  check("중복으로 분류된다", out.conflicts[0]?.kind === "duplicate", out.conflicts[0]?.kind);
  check("등록 카드를 띄우지 않는다", out.staged === null, String(out.staged));
  check("모델이 되묻는 턴까지 간다", turn.calls() === 2, `calls=${turn.calls()}`);

  // title을 안 줘도 차단은 된다 (분류만 similar로 흐려짐)
  const turn2 = scriptedTurn([
    { toolCalls: [tc("stage_new_entry", { text: "오늘 당근 모임" })] },
    { text: "이미 있는데요?" },
  ]);
  const out2 = await runAgent("오늘 당근 모임", data(), turn2, fmt);
  check("title 없어도 충돌은 잡는다", out2.conflicts.length > 0, JSON.stringify(out2.conflicts));
  check("title 없어도 카드는 안 뜬다", out2.staged === null);
}

// ── 충돌이 없으면 그대로 넘어간다 ──
{
  const turn = scriptedTurn([
    { toolCalls: [tc("stage_new_entry", { text: "다음달 15일 치과 예약" })] },
    { text: "등록 카드를 띄웠습니다" },
  ]);
  const out = await runAgent("치과 예약", data(), turn, fmt);
  check("충돌 없으면 conflicts 비어있음", out.conflicts.length === 0, JSON.stringify(out.conflicts));
  check("충돌 없으면 staged로 넘어간다", out.staged !== null, String(out.staged));
}

// ── 일반 경로에서는 staged가 null ──
{
  const turn = scriptedTurn([{ text: "안녕하세요" }]);
  const out = await runAgent("안녕", data(), turn, fmt);
  check("도구 없으면 staged null", out.staged === null);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
