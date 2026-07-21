// 일정 요약 테스트
//
// 이 테스트가 존재하는 이유(실제로 터진 버그):
//
// 이전 코드는 `s.startAt >= now`로 걸렀다. now는 현재 시각인데
// 종일 일정의 startAt은 그날 00:00이다. 그래서 **오늘 종일 일정이
// 자정 직후부터 목록에서 사라졌다.**
// 사용자가 "오늘 당근 모임 있잖아"라고 해도 AI는 "등록된 일정이 없다"고 답했다.
//
// 그래서 첫 번째 테스트가 그 케이스다.

import { buildAgenda, renderAgenda, renderAgendaItem } from "../src/lib/agenda.ts";

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
  title: "일정",
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

// 2026-07-21 오후 2시 32분 — 하루가 한참 지난 시점
const NOW = new Date(2026, 6, 21, 14, 32);

// ── 원래 버그: 오늘 종일 일정 ──
{
  const n = node({ title: "당근 모임", schedule: sched() });
  const a = buildAgenda([n], NOW);
  check("오늘 종일 일정이 목록에 있다 (원래 버그)", a.length === 1, `len=${a.length}`);
  check("오늘로 표시된다", a[0]?.isToday === true);
  check("종일이면 time은 null", a[0]?.time === null);
  check("날짜가 맞다", a[0]?.date === "2026-07-21", a[0]?.date);
}

// ── 오늘 시각 지정 일정 (이미 지난 시각이어도 남아야 한다) ──
{
  const n = node({
    title: "오전 회의",
    schedule: sched({ startAt: new Date(2026, 6, 21, 9, 0), allDay: false }),
  });
  const a = buildAgenda([n], NOW);
  check("오늘 오전에 이미 끝난 일정도 남는다", a.length === 1);
  check("시각이 나온다", a[0]?.time === "09:00", a[0]?.time);
}

// ── 창 범위 ──
{
  const mk = (dayOffset, title) =>
    node({
      id: title,
      title,
      schedule: sched({ startAt: new Date(2026, 6, 21 + dayOffset) }),
    });

  const a = buildAgenda(
    [mk(-3, "3일전"), mk(-30, "30일전"), mk(10, "10일후"), mk(200, "200일후")],
    NOW
  );
  const titles = a.map((x) => x.title);
  check("최근 지난 일정은 포함", titles.includes("3일전"), titles.join(","));
  check("너무 오래된 건 제외", !titles.includes("30일전"), titles.join(","));
  check("가까운 미래 포함", titles.includes("10일후"));
  check("먼 미래는 제외", !titles.includes("200일후"));
}

// ── 대기함(draft)은 제외 ──
{
  const n = node({ title: "초안", aiMeta: { status: "draft" } });
  check("draft는 목록에 안 들어간다", buildAgenda([n], NOW).length === 0);
}

// ── 반복 일정: 원래 시작일이 아니라 다음 발생일 ──
{
  // 3월 3일(화) 시작, 매주 화요일. 2026-07-21은 화요일이다.
  const n = node({
    title: "당근 정기 스터디",
    schedule: sched({
      startAt: new Date(2026, 2, 3),
      recurrence: { freq: "weekly", interval: 1, byWeekday: [2] },
    }),
  });
  const a = buildAgenda([n], NOW);
  check("반복 일정이 목록에 있다", a.length === 1, `len=${a.length}`);
  check(
    "몇 달 전 시작일이 아니라 다음 발생일을 보여준다",
    a[0]?.date !== "2026-03-03",
    a[0]?.date
  );
  check("반복 설명이 붙는다", !!a[0]?.recurrence, String(a[0]?.recurrence));
}

// ── 정렬 ──
{
  const mk = (d, h, title) =>
    node({
      id: title,
      title,
      schedule:
        h === null
          ? sched({ startAt: new Date(2026, 6, d) })
          : sched({ startAt: new Date(2026, 6, d, h), allDay: false }),
    });

  const a = buildAgenda([mk(23, 9, "23일9시"), mk(22, null, "22일종일"), mk(22, 15, "22일15시")], NOW);
  check(
    "날짜순 → 같은 날은 종일 먼저 → 시각순",
    a.map((x) => x.title).join(",") === "22일종일,22일15시,23일9시",
    a.map((x) => x.title).join(",")
  );
}

// ── 상한 ──
{
  const many = Array.from({ length: 100 }, (_, i) =>
    node({ id: `n${i}`, title: `t${i}`, schedule: sched({ startAt: new Date(2026, 6, 22) }) })
  );
  check("limit이 적용된다", buildAgenda(many, NOW, { limit: 5 }).length === 5);
}

// ── 렌더 ──
{
  const a = buildAgenda([node({ title: "당근 모임" })], NOW);
  const line = renderAgendaItem(a[0]);
  check("종일 표시", line.includes("종일"), line);
  check("오늘 표시", line.includes("오늘"), line);

  const block = renderAgenda(a);
  check("있다고 못 박는 문장이 들어간다", block.includes("없다고 말하지 마라"));

  const empty = renderAgenda([]);
  check("비어도 섹션이 남는다", empty.includes("현재 잡혀 있는 일정"));
  check("비었음을 명시", empty.includes("없음"));
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
