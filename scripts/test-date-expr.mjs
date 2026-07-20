// 날짜 표현 파서 검증
//   node --experimental-strip-types scripts/test-date-expr.mjs
// src/lib/date-expr.ts 의 실제 구현을 그대로 테스트한다.
import { resolveDateExpr } from "../src/lib/date-expr.ts";

// 2026-07-20 = 월요일
const TODAY = new Date(2026, 6, 20);
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const fmt = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}(${DOW[d.getDay()]})`;

const cases = [
  ["오늘", "2026-07-20(월)", null],
  ["내일", "2026-07-21(화)", null],
  ["모레", "2026-07-22(수)", null],
  ["글피", "2026-07-23(목)", null],
  ["어제", "2026-07-19(일)", null],
  ["이번주 금요일", "2026-07-24(금)", null],
  ["다음주 화요일", "2026-07-28(화)", null],
  ["다음주 월요일", "2026-07-27(월)", null],
  ["다음주 일요일", "2026-08-02(일)", null],
  ["지난주 수요일", "2026-07-15(수)", null],
  ["다음주", "2026-07-27(월)", null],
  ["금요일", "2026-07-24(금)", null],
  ["8월 5일", "2026-08-05(수)", null],
  ["3월 1일", "2027-03-01(월)", null],
  ["2026년 12월 25일", "2026-12-25(금)", null],
  ["3일 후", "2026-07-23(목)", null],
  ["2주 후", "2026-08-03(월)", null],
  ["다음주 화요일 오후 2시", "2026-07-28(화)", 14],
  ["내일 저녁 7시", "2026-07-21(화)", 19],
  ["8월 5일 오전 10시 30분", "2026-08-05(수)", 10],
  ["14:00", "2026-07-20(월)", 14],
  ["내일 오전 9시", "2026-07-21(화)", 9],
  ["다음달 3일", "2026-08-03(월)", null],
];

let pass = 0;
const failures = [];
for (const [expr, expectDate, expectHour] of cases) {
  const r = resolveDateExpr(expr, TODAY);
  if (!r) {
    failures.push(`${expr} → null (기대: ${expectDate})`);
    continue;
  }
  const got = fmt(r.date);
  const hourOk = expectHour === null || r.hour === expectHour;
  if (got === expectDate && hourOk) {
    const time =
      r.hour !== null
        ? ` ${String(r.hour).padStart(2, "0")}:${String(r.minute).padStart(2, "0")}`
        : "";
    console.log(`ok    ${expr.padEnd(22)} → ${got}${time}  [${r.rule}]`);
    pass++;
  } else {
    failures.push(`${expr} → ${got} h=${r.hour} (기대: ${expectDate} h=${expectHour})`);
  }
}

for (const f of failures) console.log(`FAIL  ${f}`);
console.log(`\n${pass} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
