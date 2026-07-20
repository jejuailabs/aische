// ==========================================
// 한국어 반복 표현 → RecurrenceRule (결정론적)
// ==========================================
//
// date-expr.ts와 같은 이유로 LLM에 맡기지 않는다.
// AI는 "매주 화요일" 같은 원문만 뽑고, 해석은 여기서 한다.
//
// 타입만 import하므로 단독 실행 테스트가 가능하다.

import type { RecurrenceRule } from "./types";

const WEEKDAY: Record<string, number> = {
  일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6,
};

/** "월수금", "월, 수, 금", "월요일과 목요일" → [1,3,5] */
function extractWeekdays(s: string): number[] {
  const found = new Set<number>();

  // "월요일" 형태 우선
  const full = s.matchAll(/([일월화수목금토])\s*요일/g);
  for (const m of full) found.add(WEEKDAY[m[1]]);

  if (found.size === 0) {
    // "월수금", "월,수,금" — 요일 글자가 2개 이상 연속/나열될 때만 인정.
    // "매주"의 '주', "매일"의 '일' 같은 오탐을 막기 위해 접두어를 먼저 제거한다.
    const stripped = s
      .replace(/매일|매주|매월|매년|격주|격월|주말|평일/g, " ")
      .replace(/\d+\s*[주일개월년]/g, " ");
    const seq = stripped.match(/[일월화수목금토]([\s,·/]*[일월화수목금토])+/g);
    if (seq) {
      for (const block of seq) {
        for (const ch of block) {
          if (ch in WEEKDAY) found.add(WEEKDAY[ch]);
        }
      }
    }
  }
  return Array.from(found).sort((a, b) => a - b);
}

/**
 * 반복 표현을 규칙으로 해석한다. 반복이 아니면 null.
 * @param today 상대 표현("이번 달부터") 해석 기준일
 */
export function parseRecurrence(
  expr: string,
  today: Date = new Date()
): RecurrenceRule | null {
  if (!expr?.trim()) return null;
  const s = expr.trim();

  // 명시적 반복 신호가 하나도 없는데 일회성 날짜 표현이면 반복이 아니다.
  // ("다음주 화요일"이 '화요일' 때문에 매주로 잡히는 것을 막는다)
  const hasRepeatMarker =
    /매일|매주|매월|매달|매년|해마다|날마다|격주|격월|격일|마다|평일|주중|주말|\d+\s*(?:회|번)|daily|weekly|monthly|yearly|every/i.test(
      s
    );
  const hasOneTimeMarker =
    /다음\s*주|이번\s*주|지난\s*주|저번\s*주|담주|내주|오늘|내일|모레|글피|어제|\d+\s*월\s*\d+\s*일|\d+\s*일\s*(?:후|뒤)/.test(
      s
    );
  if (!hasRepeatMarker && hasOneTimeMarker) return null;

  const base = (
    freq: RecurrenceRule["freq"],
    interval = 1,
    byWeekday: number[] = []
  ): RecurrenceRule => ({
    freq,
    interval,
    byWeekday,
    until: null,
    count: null,
    exdates: [],
  });

  // ── 종료 조건 먼저 뽑기 ──
  let count: number | null = null;
  let until: Date | null = null;

  const countM = s.match(/(?:총\s*)?(\d+)\s*(?:회|번)(?:만|\s*동안)?/);
  if (countM) count = parseInt(countM[1], 10);

  const untilWeeks = s.match(/(\d+)\s*주\s*(?:동안|간)/);
  if (untilWeeks) {
    until = new Date(today);
    until.setDate(until.getDate() + parseInt(untilWeeks[1], 10) * 7);
  }
  const untilMonths = s.match(/(\d+)\s*(?:개월|달)\s*(?:동안|간)/);
  if (untilMonths) {
    until = new Date(today);
    until.setMonth(until.getMonth() + parseInt(untilMonths[1], 10));
  }

  const withEnd = (r: RecurrenceRule): RecurrenceRule => ({
    ...r,
    count,
    until,
  });

  const weekdays = extractWeekdays(s);

  // ── 격주 / N주마다 ──
  if (/격주|2\s*주\s*(?:마다|에\s*한\s*번)/.test(s)) {
    return withEnd(base("weekly", 2, weekdays));
  }
  const everyNWeeks = s.match(/(\d+)\s*주\s*(?:마다|에\s*한\s*번)/);
  if (everyNWeeks) {
    return withEnd(base("weekly", parseInt(everyNWeeks[1], 10), weekdays));
  }

  // ── 주 N회 (요일 미지정이면 주 단위 반복으로 근사) ──
  const timesPerWeek = s.match(/주\s*(\d+)\s*(?:회|번)/);
  if (timesPerWeek) {
    // 요일이 함께 주어졌으면 그 요일들을 쓰고, 아니면 주 1회로 둔다.
    return withEnd(base("weekly", 1, weekdays));
  }

  // ── 매주 ──
  if (/매주|주마다|weekly/i.test(s)) {
    return withEnd(base("weekly", 1, weekdays));
  }

  // ── 격월 / N개월마다 ──
  if (/격월|2\s*(?:개월|달)\s*마다/.test(s)) {
    return withEnd(base("monthly", 2));
  }
  const everyNMonths = s.match(/(\d+)\s*(?:개월|달)\s*마다/);
  if (everyNMonths) {
    return withEnd(base("monthly", parseInt(everyNMonths[1], 10)));
  }
  if (/매월|매달|monthly/i.test(s)) {
    return withEnd(base("monthly", 1));
  }

  // ── 매년 ──
  if (/매년|해마다|yearly|annually/i.test(s)) {
    return withEnd(base("yearly", 1));
  }

  // ── N일마다 / 격일 ──
  if (/격일|이틀\s*마다|2\s*일\s*마다/.test(s)) {
    return withEnd(base("daily", 2));
  }
  const everyNDays = s.match(/(\d+)\s*일\s*마다/);
  if (everyNDays) {
    return withEnd(base("daily", parseInt(everyNDays[1], 10)));
  }

  // ── 매일 / 평일 / 주말 ──
  if (/평일|주중|weekdays?/i.test(s)) {
    return withEnd(base("weekly", 1, [1, 2, 3, 4, 5]));
  }
  if (/주말|weekends?/i.test(s)) {
    return withEnd(base("weekly", 1, [0, 6]));
  }
  if (/매일|날마다|daily|every\s*day/i.test(s)) {
    return withEnd(base("daily", 1));
  }

  // ── 요일만 나열된 경우 ("월수금") → 매주로 해석 ──
  if (weekdays.length > 0 && /요일|[월화수목금토일]{2,}/.test(s)) {
    return withEnd(base("weekly", 1, weekdays));
  }

  return null;
}
