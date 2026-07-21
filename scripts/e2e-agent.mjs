// 에이전트 실제 왕복 확인 (수동 실행용)
//
//   node --experimental-strip-types scripts/e2e-agent.mjs
//
// 유닛 테스트는 가짜 모델로 루프 로직만 본다. 이 스크립트는 **진짜 모델**에
// 붙여서 "실제로 도구를 제대로 부르는가"를 확인한다. 이게 안 되면 나머지는
// 다 무의미하다.
//
// 주의: 실제 API 요금이 나간다. CI에 넣지 말 것.

import { runAgent } from "../src/lib/agent-loop.ts";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";

// ── 가짜 데이터 (실제 저장소 대신) ──
const sched = (over = {}) => ({
  startAt: new Date(2026, 6, 21),
  endAt: new Date(2026, 6, 21),
  allDay: true,
  recurrence: null,
  location: null,
  attendees: [],
  category: null,
  ...over,
});

const DATA = {
  nodes: [
    {
      id: "n_carrot",
      title: "당근 모임",
      description: "",
      status: "scheduled",
      aiMeta: null,
      capturedInputId: null,
      schedule: sched(),
    },
    {
      id: "n_lecture",
      title: "AX 강의를 위한 사전미팅",
      description: "",
      status: "scheduled",
      aiMeta: null,
      capturedInputId: null,
      schedule: sched({
        startAt: new Date(2026, 6, 24),
        endAt: new Date(2026, 6, 24),
      }),
    },
  ],
  people: [{ id: "p1", name: "강소희", org: "AX랩", phone: null, email: null }],
  topics: [],
  captures: [],
};

const SUMMARY = `## 현재 잡혀 있는 일정 (2건)
- 2026-07-21 종일 당근 모임 ← 오늘
- 2026-07-24 종일 AX 강의를 위한 사전미팅`;

const turn = async (messages) => {
  const r = await fetch(`${BASE}/api/ai/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, summary: SUMMARY }),
  });
  if (!r.ok) throw new Error(`agent API ${r.status}: ${await r.text()}`);
  return r.json();
};

const fmt = (id, content) => ({ role: "tool", tool_call_id: id, content });

const CASES = [
  {
    name: "수정 — 설명란에 추가",
    input: "오늘 당근 모임 설명란에 1.강사섭외 2.공동저작 내용을 추가해줘",
    expect: "pending(update_schedule)",
  },
  {
    name: "조회 — 오늘 일정",
    input: "오늘 일정 뭐 있어?",
    expect: "당근 모임이 있다고 답",
  },
  {
    name: "중복 — 이미 있는 일정을 또 등록",
    input: "오늘 당근 모임 잡아줘",
    expect: "이미 있다고 되물음 (staged 없음)",
  },
  {
    name: "신규 — 충돌 없는 일정",
    input: "다음달 3일 오후 2시에 치과 예약",
    expect: "staged (등록 카드로)",
  },
  {
    name: "대화 — 저장할 것 없음",
    input: "고마워",
    expect: "그냥 답변",
  },
];

for (const c of CASES) {
  console.log(`\n${"─".repeat(60)}\n▶ ${c.name}\n  입력: ${c.input}\n  기대: ${c.expect}`);
  try {
    const out = await runAgent(c.input, DATA, turn, fmt, {
      onStep: (s) =>
        console.log(`  · ${s.tool}(${JSON.stringify(s.args)})`),
    });
    console.log(`  답변: ${JSON.stringify((out.text || "").slice(0, 160))}`);
    if (out.pending)
      console.log(
        `  ✅ pending: ${out.pending.kind} → ${out.pending.targetTitle}`,
        JSON.stringify(out.pending.changes)
      );
    if (out.staged) console.log(`  ✅ staged: ${JSON.stringify(out.staged)}`);
    if (out.conflicts.length)
      console.log(`  ⚠ 충돌: ${out.conflicts.map((x) => x.reason).join(" / ")}`);
    if (out.truncated) console.log("  ⛔ 단계 상한에 걸림");
  } catch (err) {
    console.log(`  ❌ 실패: ${err.message}`);
  }
}
console.log();
