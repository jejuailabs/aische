// 한국어 반복 표현 파서 검증
//   node --experimental-strip-types scripts/test-recurrence-expr.mjs
import { parseRecurrence } from "../src/lib/recurrence-expr.ts";

const TODAY = new Date(2026, 6, 20); // 월요일
let pass = 0;
const failures = [];

// [입력, 기대 freq(null=반복아님), interval, byWeekday, count]
const cases = [
  ["매주", "weekly", 1, [], null],
  ["매주 화요일", "weekly", 1, [2], null],
  ["매주 월수금", "weekly", 1, [1, 3, 5], null],
  ["매주 월요일과 목요일", "weekly", 1, [1, 4], null],
  ["격주", "weekly", 2, [], null],
  ["격주 화요일", "weekly", 2, [2], null],
  ["3주마다", "weekly", 3, [], null],
  ["매일", "daily", 1, [], null],
  ["격일", "daily", 2, [], null],
  ["3일마다", "daily", 3, [], null],
  ["평일", "weekly", 1, [1, 2, 3, 4, 5], null],
  ["주말", "weekly", 1, [0, 6], null],
  ["매월", "monthly", 1, [], null],
  ["매달", "monthly", 1, [], null],
  ["격월", "monthly", 2, [], null],
  ["3개월마다", "monthly", 3, [], null],
  ["매년", "yearly", 1, [], null],
  ["매주 5회", "weekly", 1, [], 5],
  ["매주 화요일 10회", "weekly", 1, [2], 10],
  // 반복이 아닌 것
  ["내일", null, null, null, null],
  ["다음주 화요일", null, null, null, null],
  ["8월 5일", null, null, null, null],
  ["", null, null, null, null],
];

const eqArr = (a, b) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

for (const [expr, freq, interval, byWeekday, count] of cases) {
  const r = parseRecurrence(expr, TODAY);
  const label = expr || "(빈문자열)";
  if (freq === null) {
    if (r === null) {
      console.log(`ok    ${label.padEnd(18)} → 반복 아님`);
      pass++;
    } else {
      failures.push(`${label} → ${JSON.stringify(r)} (반복 아니어야 함)`);
    }
    continue;
  }
  if (!r) {
    failures.push(`${label} → null (기대: ${freq})`);
    continue;
  }
  const ok =
    r.freq === freq &&
    r.interval === interval &&
    eqArr(r.byWeekday, byWeekday) &&
    r.count === count;
  if (ok) {
    console.log(
      `ok    ${label.padEnd(18)} → ${r.freq} x${r.interval} [${r.byWeekday}]${r.count ? ` ${r.count}회` : ""}`
    );
    pass++;
  } else {
    failures.push(
      `${label} → freq=${r.freq} interval=${r.interval} days=[${r.byWeekday}] count=${r.count} (기대: ${freq} x${interval} [${byWeekday}] count=${count})`
    );
  }
}

// 기간 종료 조건
{
  const r = parseRecurrence("매주 4주 동안", TODAY);
  const ok = r && r.freq === "weekly" && r.until instanceof Date;
  if (ok) {
    console.log(`ok    ${"매주 4주 동안".padEnd(18)} → until=${r.until.toISOString().slice(0, 10)}`);
    pass++;
  } else failures.push(`매주 4주 동안 → ${JSON.stringify(r)}`);
}

for (const f of failures) console.log(`FAIL  ${f}`);
console.log(`\n${pass} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
