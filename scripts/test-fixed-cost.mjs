// 고정비 결제일 계산 검증
//   node --experimental-strip-types scripts/test-fixed-cost.mjs
import {
  resolvePaymentDate, isPaymentOn, costsInMonth, monthlyTotal,
  normalizedMonthlyTotal, totalsByMethod, nextPaymentDate,
  daysUntilNextPayment, formatAmount, describeCycle,
} from "../src/lib/fixed-cost.ts";

let pass = 0;
const failures = [];
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`ok    ${name}`); pass++; }
  else failures.push(`${name} — got ${a}, expected ${e}`);
};
const fmt = (d) => d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}` : null;

const cost = (over = {}) => ({
  id: "c", workspaceId: "w", title: "넷플릭스",
  amount: 13500, currency: "KRW",
  cycle: "monthly", paymentDay: 15, paymentMonth: null,
  paymentMethodId: "pm1", categoryId: null, memo: "",
  startedAt: new Date(2025, 0, 1), endedAt: null, active: true,
  sourceInputId: null, createdAt: new Date(), updatedAt: new Date(),
  ...over,
});

// ── 기본 ──
check("매월 15일 → 2026-07-15", fmt(resolvePaymentDate(cost(), 2026, 6)), "2026-07-15");

// ── 말일 함정: 31일 지정인데 그 달에 31일이 없음 ──
check("매월 31일 → 2월은 28일로", fmt(resolvePaymentDate(cost({paymentDay:31}), 2026, 1)), "2026-02-28");
check("매월 31일 → 4월은 30일로", fmt(resolvePaymentDate(cost({paymentDay:31}), 2026, 3)), "2026-04-30");
check("매월 31일 → 7월은 31일 그대로", fmt(resolvePaymentDate(cost({paymentDay:31}), 2026, 6)), "2026-07-31");
check("매월 30일 → 2월은 28일로", fmt(resolvePaymentDate(cost({paymentDay:30}), 2026, 1)), "2026-02-28");
// 윤년
check("윤년 2028년 2월 31일 → 29일", fmt(resolvePaymentDate(cost({paymentDay:31}), 2028, 1)), "2028-02-29");

// ── 연 결제 ──
const yearly = cost({cycle:"yearly", paymentMonth:3, paymentDay:2, amount:120000});
check("연 결제: 3월엔 있음", fmt(resolvePaymentDate(yearly, 2026, 2)), "2026-03-02");
check("연 결제: 다른 달엔 없음", resolvePaymentDate(yearly, 2026, 6), null);

// ── 시작 전 / 해지 후 ──
check("시작 전이면 결제 없음",
  resolvePaymentDate(cost({startedAt:new Date(2026,7,1)}), 2026, 6), null);
check("해지 후면 결제 없음",
  resolvePaymentDate(cost({endedAt:new Date(2026,5,30)}), 2026, 6), null);
check("해지 당월까지는 결제됨",
  fmt(resolvePaymentDate(cost({endedAt:new Date(2026,6,20)}), 2026, 6)), "2026-07-15");

// ── isPaymentOn ──
check("결제일 당일 true", isPaymentOn(cost(), new Date(2026,6,15)), true);
check("결제일 아니면 false", isPaymentOn(cost(), new Date(2026,6,16)), false);
check("비활성이면 false", isPaymentOn(cost({active:false}), new Date(2026,6,15)), false);

// ── 월별 집계 ──
const costs = [
  cost({id:"a", title:"넷플릭스", amount:13500, paymentDay:15, paymentMethodId:"pm1"}),
  cost({id:"b", title:"헬스장", amount:70000, paymentDay:5, paymentMethodId:"pm1"}),
  cost({id:"c", title:"보험", amount:45000, paymentDay:25, paymentMethodId:"pm2"}),
  cost({id:"d", title:"도메인", amount:120000, cycle:"yearly", paymentMonth:3, paymentDay:2, paymentMethodId:"pm2"}),
  cost({id:"e", title:"해지됨", amount:9900, paymentDay:10, active:false}),
];
check("7월 결제 건수 (연간 제외, 비활성 제외)", costsInMonth(costs, 2026, 6).length, 3);
check("7월 결제일 순 정렬", costsInMonth(costs, 2026, 6).map(x=>x.cost.title), ["헬스장","넷플릭스","보험"]);
check("7월 총액", monthlyTotal(costs, 2026, 6), 128500);
check("3월 총액 (연간 포함)", monthlyTotal(costs, 2026, 2), 248500);
check("월 환산 총액 (연간/12)", Math.round(normalizedMonthlyTotal(costs)), 138500);

const byMethod = totalsByMethod(costs, 2026, 6);
check("카드별: pm1", byMethod.get("pm1"), 83500);
check("카드별: pm2", byMethod.get("pm2"), 45000);

// ── 다음 결제일 ──
check("이번달 결제일 전 → 이번달",
  fmt(nextPaymentDate(cost(), new Date(2026,6,10))), "2026-07-15");
check("결제일 당일 → 오늘",
  fmt(nextPaymentDate(cost(), new Date(2026,6,15))), "2026-07-15");
check("결제일 지남 → 다음달",
  fmt(nextPaymentDate(cost(), new Date(2026,6,20))), "2026-08-15");
check("연 결제 지남 → 내년",
  fmt(nextPaymentDate(yearly, new Date(2026,6,1))), "2027-03-02");
check("해지된 건 다음 결제 없음",
  nextPaymentDate(cost({endedAt:new Date(2026,0,1)}), new Date(2026,6,1)), null);
check("남은 일수", daysUntilNextPayment(cost(), new Date(2026,6,10)), 5);

// ── 표시 ──
check("금액 포맷", formatAmount(13500), "₩13,500");
check("주기 표시(월)", describeCycle(cost()), "매월 15일");
check("주기 표시(연)", describeCycle(yearly), "매년 3월 2일");

for (const f of failures) console.log(`FAIL  ${f}`);
console.log(`\n${pass} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
