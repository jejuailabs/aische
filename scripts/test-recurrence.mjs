// 반복 일정 계산 검증
//   node --experimental-strip-types scripts/test-recurrence.mjs
import { occursOn, describeRecurrence, makeRecurrence } from "../src/lib/recurrence.ts";

let pass = 0;
const failures = [];
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const d = (y, m, day, h = 10, min = 0) => new Date(y, m - 1, day, h, min);
const fmt = (x) =>
  `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}(${DOW[x.getDay()]})`;

function sched(startAt, recurrence = null, endAt = null) {
  return {
    startAt,
    endAt: endAt ?? new Date(startAt.getTime() + 3600000),
    dueAt: null,
    allDay: false,
    category: "",
    location: null,
    attendees: [],
    reminders: [],
    recurrence,
  };
}

function check(name, actual, expected) {
  if (actual === expected) {
    console.log(`ok    ${name}`);
    pass++;
  } else {
    failures.push(`${name} — got ${actual}, expected ${expected}`);
  }
}

// 2026-07-21은 화요일
const TUE = d(2026, 7, 21);

// ── 반복 없음 ──
{
  const s = sched(TUE);
  check("단발: 당일", occursOn(s, d(2026, 7, 21)), true);
  check("단발: 다음날 아님", occursOn(s, d(2026, 7, 22)), false);
  check("단발: 다음주 아님", occursOn(s, d(2026, 7, 28)), false);
}

// ── 매주 ──
{
  const s = sched(TUE, makeRecurrence({ freq: "weekly" }));
  check("매주: 시작일", occursOn(s, d(2026, 7, 21)), true);
  check("매주: +7일", occursOn(s, d(2026, 7, 28)), true);
  check("매주: +14일", occursOn(s, d(2026, 8, 4)), true);
  check("매주: 다른 요일 아님", occursOn(s, d(2026, 7, 23)), false);
  check("매주: 시작 이전 아님", occursOn(s, d(2026, 7, 14)), false);
  check("매주: 한참 뒤에도 유효", occursOn(s, d(2027, 1, 5)), true);
}

// ── 격주 ──
{
  const s = sched(TUE, makeRecurrence({ freq: "weekly", interval: 2 }));
  check("격주: 시작일", occursOn(s, d(2026, 7, 21)), true);
  check("격주: +7일 아님", occursOn(s, d(2026, 7, 28)), false);
  check("격주: +14일", occursOn(s, d(2026, 8, 4)), true);
  check("격주: +21일 아님", occursOn(s, d(2026, 8, 11)), false);
}

// ── 매주 여러 요일 (월·수·금) ──
{
  const MON = d(2026, 7, 20);
  const s = sched(MON, makeRecurrence({ freq: "weekly", byWeekday: [1, 3, 5] }));
  check("월수금: 월", occursOn(s, d(2026, 7, 20)), true);
  check("월수금: 수", occursOn(s, d(2026, 7, 22)), true);
  check("월수금: 금", occursOn(s, d(2026, 7, 24)), true);
  check("월수금: 화 아님", occursOn(s, d(2026, 7, 21)), false);
  check("월수금: 다음주 수", occursOn(s, d(2026, 7, 29)), true);
}

// ── 종료일(until) ──
{
  const s = sched(TUE, makeRecurrence({ freq: "weekly", until: d(2026, 8, 4) }));
  check("until: 경계 당일 포함", occursOn(s, d(2026, 8, 4)), true);
  check("until: 이후 제외", occursOn(s, d(2026, 8, 11)), false);
}

// ── 횟수(count) 3회 ──
{
  const s = sched(TUE, makeRecurrence({ freq: "weekly", count: 3 }));
  check("count3: 1회차", occursOn(s, d(2026, 7, 21)), true);
  check("count3: 2회차", occursOn(s, d(2026, 7, 28)), true);
  check("count3: 3회차", occursOn(s, d(2026, 8, 4)), true);
  check("count3: 4회차 제외", occursOn(s, d(2026, 8, 11)), false);
}

// ── 예외일(exdates) ──
{
  const s = sched(TUE, makeRecurrence({ freq: "weekly", exdates: [d(2026, 7, 28)] }));
  check("exdate: 해당 회차 제외", occursOn(s, d(2026, 7, 28)), false);
  check("exdate: 다른 회차는 유지", occursOn(s, d(2026, 8, 4)), true);
}

// ── 매일 / 3일마다 ──
{
  const s = sched(TUE, makeRecurrence({ freq: "daily" }));
  check("매일: +1", occursOn(s, d(2026, 7, 22)), true);
  check("매일: +5", occursOn(s, d(2026, 7, 26)), true);
  const s3 = sched(TUE, makeRecurrence({ freq: "daily", interval: 3 }));
  check("3일마다: +3", occursOn(s3, d(2026, 7, 24)), true);
  check("3일마다: +1 아님", occursOn(s3, d(2026, 7, 22)), false);
}

// ── 매월 / 매년 ──
{
  const s = sched(d(2026, 7, 15), makeRecurrence({ freq: "monthly" }));
  check("매월: 다음달 같은 날", occursOn(s, d(2026, 8, 15)), true);
  check("매월: 다른 날 아님", occursOn(s, d(2026, 8, 16)), false);
  const y = sched(d(2026, 7, 15), makeRecurrence({ freq: "yearly" }));
  check("매년: 내년 같은 날", occursOn(y, d(2027, 7, 15)), true);
  check("매년: 내년 다른 날 아님", occursOn(y, d(2027, 7, 16)), false);
}

// ── DST/월말 경계 (연말 넘김) ──
{
  const s = sched(d(2026, 12, 29), makeRecurrence({ freq: "weekly" }));
  check("연말 넘김: +7일", occursOn(s, d(2027, 1, 5)), true);
  check("연말 넘김: +14일", occursOn(s, d(2027, 1, 12)), true);
}

// ── 설명 문구 ──
check("설명: 매주 화", describeRecurrence(makeRecurrence({ freq: "weekly", byWeekday: [2] })), "매주 화요일");
check("설명: 격주", describeRecurrence(makeRecurrence({ freq: "weekly", interval: 2 })), "격주");
check("설명: 매일", describeRecurrence(makeRecurrence({ freq: "daily" })), "매일");
check("설명: 월수금", describeRecurrence(makeRecurrence({ freq: "weekly", byWeekday: [1, 3, 5] })), "매주 월·수·금요일");
check("설명: 없음", describeRecurrence(null), "");

for (const f of failures) console.log(`FAIL  ${f}`);
console.log(`\n${pass} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
