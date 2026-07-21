// 일정 색인 / 충돌 감지 테스트
//
// 이 층이 존재하는 이유:
// 충돌 감지가 "AI가 search를 먼저 불러줄 것"에 의존하면 안 된다.
// 여기 있는 findConflicts는 **AI와 무관하게 항상** 돌아야 하고,
// 그래서 로직이 틀리면 같은 일정이 조용히 두 개 생긴다.

import {
  buildScheduleIndex,
  findByDate,
  findByTitle,
  findConflicts,
  tokenize,
  normalizeTitle,
  toDateKey,
} from "../src/lib/schedule-index.ts";

let passed = 0;
let failed = 0;

function check(name, cond, detail = "") {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}`);
  }
}

const NOW = new Date(2026, 6, 21, 14, 0); // 2026-07-21 (화)

const node = (over = {}) => ({
  id: "n1",
  title: "당근 모임",
  aiMeta: null,
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

const timed = (h, m, endH, over = {}) =>
  node({
    schedule: {
      startAt: new Date(2026, 6, 21, h, m),
      endAt: new Date(2026, 6, 21, endH, m),
      allDay: false,
      recurrence: null,
      location: null,
      attendees: [],
      category: null,
    },
    ...over,
  });

// ── 토큰화 ──
{
  const t = tokenize("당근 모임");
  check("공백 제거 형태를 포함", t.includes("당근모임"), t.join(","));
  check("단어도 포함", t.includes("당근") && t.includes("모임"), t.join(","));
  check("빈 제목은 빈 배열", tokenize("").length === 0);
  check("정규화는 공백 제거", normalizeTitle(" 당근 모임 ") === "당근모임");
}

// ── 날짜 색인 ──
{
  const idx = buildScheduleIndex([node()], NOW);
  check("날짜 칸에 들어간다", findByDate(idx, "2026-07-21").length === 1);
  check("다른 날은 비어있다", findByDate(idx, "2026-07-22").length === 0);
  check("size가 맞다", idx.size === 1);
}

// ── 대기함은 색인에서 빠진다 ──
{
  const idx = buildScheduleIndex([node({ aiMeta: { status: "draft" } })], NOW);
  check("draft는 색인에 없다", idx.size === 0);
}

// ── 반복 일정이 회차로 펼쳐진다 (핵심) ──
{
  // 매주 화요일. 2026-07-21이 화요일.
  const rec = node({
    id: "r1",
    title: "당근 정기 스터디",
    schedule: {
      startAt: new Date(2026, 2, 3),
      endAt: new Date(2026, 2, 3),
      allDay: true,
      recurrence: { freq: "weekly", interval: 1, byWeekday: [2] },
      location: null,
      attendees: [],
      category: null,
    },
  });
  const idx = buildScheduleIndex([rec], NOW);

  check("여러 회차로 펼쳐진다", idx.size > 10, `size=${idx.size}`);
  const onTue = findByDate(idx, "2026-07-21");
  check("오늘 회차가 날짜 칸에 있다", onTue.length === 1, JSON.stringify(onTue));
  check("반복 표시가 붙는다", onTue[0]?.isRecurring === true);
  check("화요일이 아닌 날엔 없다", findByDate(idx, "2026-07-22").length === 0);
}

// ── 제목 검색 ──
{
  const idx = buildScheduleIndex(
    [node({ id: "a", title: "당근 모임" }), node({ id: "b", title: "치과 예약" })],
    NOW
  );
  check("정확한 제목", findByTitle(idx, "당근 모임").length === 1);
  check("띄어쓰기 없이도", findByTitle(idx, "당근모임").length === 1);
  check("부분 문자열", findByTitle(idx, "당근").length === 1);
  check("없는 건 안 나온다", findByTitle(idx, "회식").length === 0);
  check("빈 질의는 빈 결과", findByTitle(idx, "").length === 0);
}

// ── 반복 일정 검색이 회차로 도배되지 않는다 ──
{
  const rec = node({
    id: "r1",
    title: "주간회의",
    schedule: {
      startAt: new Date(2026, 6, 21),
      endAt: new Date(2026, 6, 21),
      allDay: true,
      recurrence: { freq: "weekly", interval: 1, byWeekday: [2] },
      location: null,
      attendees: [],
      category: null,
    },
  });
  const idx = buildScheduleIndex([rec], NOW);
  const hits = findByTitle(idx, "주간회의");
  // 회차마다 하나씩 나오지만, 같은 (노드, 날짜) 조합이 중복되진 않아야 한다
  const keys = hits.map((h) => `${h.nodeId}|${h.date}`);
  check("같은 회차가 중복되지 않는다", new Set(keys).size === keys.length);
}

// ══════════ 충돌 감지 ══════════

// ── 완전 중복 ──
{
  const idx = buildScheduleIndex([node()], NOW);
  const c = findConflicts(idx, { title: "당근 모임", date: "2026-07-21" });
  check("같은 날 같은 제목 → duplicate", c[0]?.kind === "duplicate", JSON.stringify(c));
  check("이유가 설명된다", /이미/.test(c[0]?.reason ?? ""), c[0]?.reason);
}

// ── 띄어쓰기만 다른 경우도 중복으로 ──
{
  const idx = buildScheduleIndex([node()], NOW);
  const c = findConflicts(idx, { title: "당근모임", date: "2026-07-21" });
  check("띄어쓰기 차이도 중복으로 잡는다", c[0]?.kind === "duplicate", JSON.stringify(c));
}

// ── 반복 일정이 그 날을 덮는 경우 ──
{
  const rec = node({
    id: "r1",
    title: "당근 모임",
    schedule: {
      startAt: new Date(2026, 2, 3),
      endAt: new Date(2026, 2, 3),
      allDay: true,
      recurrence: { freq: "weekly", interval: 1, byWeekday: [2] },
      location: null,
      attendees: [],
      category: null,
    },
  });
  const idx = buildScheduleIndex([rec], NOW);
  const c = findConflicts(idx, { title: "당근 모임", date: "2026-07-21" });
  check("반복이 덮으면 recurring_covers", c[0]?.kind === "recurring_covers", JSON.stringify(c));
  check("반복이라고 설명한다", /반복/.test(c[0]?.reason ?? ""), c[0]?.reason);
}

// ── 다른 날이면 충돌 아님 ──
{
  const idx = buildScheduleIndex([node()], NOW);
  const c = findConflicts(idx, { title: "당근 모임", date: "2026-07-28" });
  check("날짜가 다르면 충돌 없음", c.length === 0, JSON.stringify(c));
}

// ── 비슷한 제목 ──
{
  const idx = buildScheduleIndex([node({ title: "당근 모임 바이브코딩" })], NOW);
  const c = findConflicts(idx, { title: "당근 모임", date: "2026-07-21" });
  check("포함 관계는 similar", c[0]?.kind === "similar", JSON.stringify(c));
  check("무엇과 비슷한지 밝힌다", /바이브코딩/.test(c[0]?.reason ?? ""), c[0]?.reason);
}

// ── 짧은 제목이 우연히 겹치는 걸 막는다 ──
{
  const idx = buildScheduleIndex([node({ title: "A" })], NOW);
  const c = findConflicts(idx, { title: "AB", date: "2026-07-21" });
  check("1글자 제목은 비슷함으로 안 친다", c.length === 0, JSON.stringify(c));
}

// ── 시간 겹침 (제목이 달라도 충돌) ──
{
  const idx = buildScheduleIndex([timed(14, 0, 15, { title: "치과" })], NOW);
  const c = findConflicts(idx, {
    title: "회의",
    date: "2026-07-21",
    startMin: 14 * 60 + 30,
    endMin: 15 * 60 + 30,
  });
  check("시간이 겹치면 time_overlap", c[0]?.kind === "time_overlap", JSON.stringify(c));
  check("무엇과 겹치는지 밝힌다", /치과/.test(c[0]?.reason ?? ""), c[0]?.reason);
}

// ── 시간이 안 겹치면 충돌 아님 ──
{
  const idx = buildScheduleIndex([timed(9, 0, 10, { title: "치과" })], NOW);
  const c = findConflicts(idx, {
    title: "회의",
    date: "2026-07-21",
    startMin: 14 * 60,
    endMin: 15 * 60,
  });
  check("시간이 안 겹치면 충돌 없음", c.length === 0, JSON.stringify(c));
}

// ── 종일 일정은 시간 충돌로 보지 않는다 ──
{
  const idx = buildScheduleIndex([node({ title: "휴가" })], NOW); // 종일
  const c = findConflicts(idx, {
    title: "회의",
    date: "2026-07-21",
    startMin: 14 * 60,
    endMin: 15 * 60,
  });
  check("종일 일정과는 시간 충돌 아님", c.length === 0, JSON.stringify(c));
}

// ── 심각한 순서로 정렬 ──
{
  const idx = buildScheduleIndex(
    [
      timed(14, 0, 15, { id: "a", title: "치과" }),
      node({ id: "b", title: "회의" }),
    ],
    NOW
  );
  const c = findConflicts(idx, {
    title: "회의",
    date: "2026-07-21",
    startMin: 14 * 60 + 10,
    endMin: 15 * 60,
  });
  check("중복이 시간겹침보다 먼저 온다", c[0]?.kind === "duplicate", JSON.stringify(c.map((x) => x.kind)));
}

// ── 아무것도 없으면 충돌 없음 ──
{
  const idx = buildScheduleIndex([], NOW);
  check("빈 색인에서 충돌 없음", findConflicts(idx, { title: "x", date: "2026-07-21" }).length === 0);
  check("빈 색인 크기 0", idx.size === 0);
}

// ── 날짜 키 헬퍼 ──
{
  check("toDateKey 형식", toDateKey(new Date(2026, 0, 5)) === "2026-01-05");
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
