// ==========================================
// 고정비 계산
// ==========================================
//
// 결제일 계산에 함정이 하나 있다: "매월 31일" 고정비는 2월에 31일이 없다.
// 이런 건 그 달의 마지막 날로 밀어야 한다. (31일 → 2월 28일)
// 아래 resolvePaymentDate가 그걸 처리한다.
//
// 타입만 import하므로 단독 실행 테스트가 가능하다.

import type { FixedCost, PaymentMethod } from "./types";

/** 그 달의 마지막 날 */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function midnight(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

/**
 * 특정 연/월에 이 고정비가 실제로 빠져나가는 날짜.
 * 그 달에 결제가 없으면(연 1회인데 다른 달) null.
 */
export function resolvePaymentDate(
  cost: FixedCost,
  year: number,
  month: number // 0-based
): Date | null {
  if (cost.cycle === "yearly") {
    const targetMonth = (cost.paymentMonth ?? 1) - 1;
    if (targetMonth !== month) return null;
  }

  // 31일 지정인데 그 달이 30일까지면 30일로 당긴다
  const day = Math.min(cost.paymentDay, lastDayOfMonth(year, month));
  const date = new Date(year, month, day);

  // 시작 전이거나 해지 후면 결제 없음
  if (date < midnight(cost.startedAt)) return null;
  if (cost.endedAt && date > midnight(cost.endedAt)) return null;

  return date;
}

/** 이 고정비가 해당 날짜에 결제되는가 */
export function isPaymentOn(cost: FixedCost, date: Date): boolean {
  if (!cost.active) return false;
  const d = resolvePaymentDate(cost, date.getFullYear(), date.getMonth());
  if (!d) return false;
  return (
    d.getFullYear() === date.getFullYear() &&
    d.getMonth() === date.getMonth() &&
    d.getDate() === date.getDate()
  );
}

/** 해당 날짜에 결제되는 고정비 목록 */
export function costsOnDate(costs: FixedCost[], date: Date): FixedCost[] {
  return costs.filter((c) => isPaymentOn(c, date));
}

/** 해당 월에 결제되는 고정비 (결제일 순) */
export function costsInMonth(
  costs: FixedCost[],
  year: number,
  month: number
): { cost: FixedCost; date: Date }[] {
  return costs
    .filter((c) => c.active)
    .map((c) => ({ cost: c, date: resolvePaymentDate(c, year, month) }))
    .filter((x): x is { cost: FixedCost; date: Date } => x.date !== null)
    .sort((a, b) => a.date.getDate() - b.date.getDate());
}

/** 해당 월 총액 */
export function monthlyTotal(
  costs: FixedCost[],
  year: number,
  month: number
): number {
  return costsInMonth(costs, year, month).reduce(
    (sum, { cost }) => sum + cost.amount,
    0
  );
}

/**
 * 월 환산 총액 — 연 결제를 12로 나눠 더한 "실질 월 부담".
 * 특정 달 총액과 다르다. 연간 구독이 몰린 달만 보면 왜곡되므로 함께 보여준다.
 */
export function normalizedMonthlyTotal(costs: FixedCost[]): number {
  return costs
    .filter((c) => c.active)
    .reduce(
      (sum, c) => sum + (c.cycle === "yearly" ? c.amount / 12 : c.amount),
      0
    );
}

/** 결제수단별 월 합계 */
export function totalsByMethod(
  costs: FixedCost[],
  year: number,
  month: number
): Map<string | null, number> {
  const map = new Map<string | null, number>();
  for (const { cost } of costsInMonth(costs, year, month)) {
    const key = cost.paymentMethodId;
    map.set(key, (map.get(key) ?? 0) + cost.amount);
  }
  return map;
}

/** 카테고리별 월 합계 */
export function totalsByCategory(
  costs: FixedCost[],
  year: number,
  month: number
): Map<string | null, number> {
  const map = new Map<string | null, number>();
  for (const { cost } of costsInMonth(costs, year, month)) {
    const key = cost.categoryId;
    map.set(key, (map.get(key) ?? 0) + cost.amount);
  }
  return map;
}

/**
 * 오늘 기준 다음 결제일. 이번 달 결제일이 지났으면 다음 달(또는 내년)을 본다.
 * 해지됐거나 더 이상 결제가 없으면 null.
 */
export function nextPaymentDate(
  cost: FixedCost,
  from: Date = new Date()
): Date | null {
  if (!cost.active) return null;
  const base = midnight(from);
  // 최대 24개월까지만 앞을 본다 (연 1회도 반드시 잡힌다)
  for (let i = 0; i < 24; i++) {
    const y = base.getFullYear();
    const m = base.getMonth() + i;
    const d = resolvePaymentDate(
      cost,
      y + Math.floor(m / 12),
      ((m % 12) + 12) % 12
    );
    if (d && d >= base) return d;
  }
  return null;
}

/** 다음 결제일까지 남은 일수 */
export function daysUntilNextPayment(
  cost: FixedCost,
  from: Date = new Date()
): number | null {
  const next = nextPaymentDate(cost, from);
  if (!next) return null;
  return Math.round(
    (next.getTime() - midnight(from).getTime()) / 86400000
  );
}

/** 금액 표시 (₩1,234) */
export function formatAmount(amount: number, currency = "KRW"): string {
  const rounded = Math.round(amount);
  if (currency === "KRW") return `₩${rounded.toLocaleString("ko-KR")}`;
  return `${rounded.toLocaleString()} ${currency}`;
}

/** 결제수단 표시명 ("신한카드 ****1234") */
export function describeMethod(m: PaymentMethod | undefined | null): string {
  if (!m) return "미지정";
  const tail = m.last4 ? ` ****${m.last4}` : "";
  return `${m.issuer}${tail}`;
}

/** 주기 표시 ("매월 15일", "매년 3월 2일") */
export function describeCycle(cost: FixedCost): string {
  if (cost.cycle === "yearly") {
    return `매년 ${cost.paymentMonth ?? 1}월 ${cost.paymentDay}일`;
  }
  return `매월 ${cost.paymentDay}일`;
}
