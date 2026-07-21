// 도구 실행 테스트
//
// 검색이 틀리면 AI가 "그런 일정 없다"고 답한다. 오늘 실제로 터진 사고가 그거다.
// 그래서 검색 케이스를 촘촘히 본다.
//
// 그리고 쓰기 도구가 **적용하지 않고 제안만** 하는지 반드시 확인한다.
// 여기가 뚫리면 AI 판단만으로 데이터가 지워진다.

import { executeTool } from "../src/lib/tool-exec.ts";

let passed = 0;
let failed = 0;

function check(name, cond, detail = "") {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}`);
  }
}

const NOW = new Date(2026, 6, 21, 14, 32); // 2026-07-21(화) 14:32

const node = (over = {}) => ({
  id: "n1",
  title: "당근 모임",
  description: "",
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
  nodes: [],
  people: [],
  topics: [],
  captures: [],
  ...over,
});

const call = (name, args) => ({ id: "c1", name, args });
const parse = (r) => JSON.parse(r.content);

// ── 오늘 일정 검색 (원래 사고 케이스) ──
{
  const d = data({ nodes: [node()] });
  const r = executeTool(call("search_schedules", { dateExpr: "오늘" }), d, NOW);
  const out = parse(r);
  check("오늘 종일 일정을 찾는다", out.count === 1, JSON.stringify(out));
  check("id가 나온다", out.schedules?.[0]?.id === "n1");
  check("날짜가 맞다", out.schedules?.[0]?.date === "2026-07-21");
}

// ── 띄어쓰기 차이 ──
{
  const d = data({ nodes: [node()] });
  check(
    '"당근모임"으로도 "당근 모임"을 찾는다',
    parse(executeTool(call("search_schedules", { query: "당근모임" }), d, NOW)).count === 1
  );
  check(
    "부분 일치로 찾는다",
    parse(executeTool(call("search_schedules", { query: "당근" }), d, NOW)).count === 1
  );
}

// ── 못 찾았을 때 ──
{
  const d = data({ nodes: [node()] });
  const out = parse(executeTool(call("search_schedules", { query: "없는일정" }), d, NOW));
  check("없으면 count 0", out.count === 0);
  check("없다고 명시한다", /없습니다/.test(out.note ?? ""), out.note);
}

// ── 날짜 표현을 못 풀 때: 조용히 전체를 돌려주면 안 된다 ──
{
  const d = data({ nodes: [node()] });
  const out = parse(
    executeTool(call("search_schedules", { dateExpr: "ㅁㄴㅇㄹ" }), d, NOW)
  );
  check("해석 실패는 error로 알린다", !!out.error, JSON.stringify(out));
  check("전체 목록을 돌려주지 않는다", out.schedules === undefined);
}

// ── query + dateExpr는 AND ──
{
  const d = data({
    nodes: [
      node({ id: "a", title: "당근 모임" }),
      node({ id: "b", title: "다른 회의", schedule: { ...node().schedule } }),
      node({
        id: "c",
        title: "당근 모임",
        schedule: { ...node().schedule, startAt: new Date(2026, 6, 25), endAt: new Date(2026, 6, 25) },
      }),
    ],
  });
  const out = parse(
    executeTool(call("search_schedules", { query: "당근", dateExpr: "오늘" }), d, NOW)
  );
  check("두 조건을 모두 만족하는 것만", out.count === 1, JSON.stringify(out.schedules));
  check("맞는 걸 골랐다", out.schedules?.[0]?.id === "a");
}

// ── get_schedule ──
{
  const d = data({
    nodes: [node({ description: "커리큘럼 논의", capturedInputId: "cap1" })],
    captures: [{ id: "cap1", rawText: "강소희씨랑 만나서 커리큘럼 얘기" }],
  });
  const out = parse(executeTool(call("get_schedule", { id: "n1" }), d, NOW));
  check("설명이 나온다", out.description === "커리큘럼 논의");
  check("원본 입력이 나온다", /강소희/.test(out.originalInput ?? ""), out.originalInput);

  // 설명이 비어도 키가 있어야 한다 — 없으면 AI가 "설명 필드가 없다"고 오해한다
  const d2 = data({ nodes: [node()] });
  const out2 = parse(executeTool(call("get_schedule", { id: "n1" }), d2, NOW));
  check("빈 설명도 키로 존재한다", "description" in out2 && out2.description === "");

  const miss = parse(executeTool(call("get_schedule", { id: "없음" }), d, NOW));
  check("없는 id는 error", !!miss.error);
  check("어떻게 하라고 알려준다", /search_schedules/.test(miss.error), miss.error);
}

// ── 쓰기: 제안만 하고 적용하지 않는다 (가장 중요) ──
{
  const original = node({ description: "기존 내용" });
  const d = data({ nodes: [original] });

  const r = executeTool(
    call("update_schedule", { id: "n1", description: "기존 내용\n추가된 내용" }),
    d,
    NOW
  );
  const out = parse(r);

  check("pending이 돌아온다", !!r.pending);
  check("적용 안 됐다고 모델에게 알린다", /적용되지 않았/.test(out.message ?? ""), out.message);
  check(
    "모델에게 '했다고 말하지 말라'고 지시한다",
    /말하지 말/.test(out.message ?? ""),
    out.message
  );
  // 실제 데이터가 안 바뀌었는지 — 여기가 뚫리면 확인 게이트가 무의미하다
  check("원본 객체가 그대로다", original.description === "기존 내용", original.description);

  const ch = r.pending.changes;
  check("변경 필드가 하나", ch.length === 1);
  check("전 값이 담긴다", ch[0].before === "기존 내용");
  check("후 값이 담긴다", ch[0].after === "기존 내용\n추가된 내용");
  check("사람이 읽을 라벨이 있다", ch[0].label === "설명");
}

// ── 같은 값으로 수정하면 변경 아님 ──
{
  const d = data({ nodes: [node({ description: "그대로" })] });
  const out = parse(
    executeTool(call("update_schedule", { id: "n1", description: "그대로" }), d, NOW)
  );
  check("바뀌는 게 없으면 error", !!out.error, JSON.stringify(out));
}

// ── 삭제도 제안만 ──
{
  const d = data({ nodes: [node()] });
  const r = executeTool(call("delete_schedule", { id: "n1" }), d, NOW);
  check("삭제도 pending", r.pending?.kind === "delete_schedule");
  check("아직 안 지웠다고 알린다", /지워지지 않았/.test(parse(r).message ?? ""));
  check("노드가 그대로 있다", d.nodes.length === 1);
}

// ── 인물 검색 ──
{
  const d = data({
    people: [
      { id: "p1", name: "강소희", org: "AX랩", phone: "010-1234-5678", email: null },
      { id: "p2", name: "김철수", org: null, phone: null, email: null },
    ],
  });
  const byName = parse(executeTool(call("search_people", { query: "강소희" }), d, NOW));
  check("이름으로 찾는다", byName.count === 1 && byName.people[0].phone === "010-1234-5678");

  const byOrg = parse(executeTool(call("search_people", { query: "AX랩" }), d, NOW));
  check("소속으로도 찾는다", byOrg.count === 1);
}

// ── 방어: 잘못된 호출이 throw 하지 않아야 한다 ──
{
  const d = data({ nodes: [node()] });
  const unknown = parse(executeTool(call("rm_rf", {}), d, NOW));
  check("모르는 도구는 error로 (throw 아님)", !!unknown.error);

  const missing = parse(executeTool(call("get_schedule", {}), d, NOW));
  check("필수 인자 누락은 error로", !!missing.error);

  const broken = parse(
    executeTool({ id: "c", name: "search_schedules", args: "{깨진" }, d, NOW)
  );
  check("깨진 인자 JSON도 죽지 않는다", broken.count !== undefined || !!broken.error);
}

// ── draft는 검색에 안 나온다 ──
{
  const d = data({ nodes: [node({ aiMeta: { status: "draft" } })] });
  check(
    "대기함 항목은 잡혀있는 일정이 아니다",
    parse(executeTool(call("search_schedules", { query: "당근" }), d, NOW)).count === 0
  );
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
