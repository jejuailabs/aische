// ==========================================
// 반복 일정 계산
// ==========================================
//
// 회차를 미리 만들어 저장하지 않는다. 원본 일정 1건만 저장하고,
// 조회하는 날짜마다 "이 날 이 일정이 있는가?"를 계산한다.
//
// 이유:
//  - 무기한 반복("매주 팀미팅")을 저장할 수 없음
//  - 규칙이 바뀌면 이미 만든 회차를 전부 고쳐야 함
//  - Firestore 문서 수가 폭발함
//
// 타입만 import하므로(값 import 없음) 단독 실행 테스트가 가능하다.

import type { RecurrenceRule, ScheduleInfo } from "./types";

const DAY_MS = 86400000;

/** 로컬 자정으로 정규화 */
function midnight(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

/** 자정 기준 일수 차이 (DST 안전) */
function daysBetween(a: Date, b: Date): number {
  return Math.round((midnight(b).getTime() - midnight(a).getTime()) / DAY_MS);
}

/** 그 주의 일요일 기준 주차 차이 */
function weeksBetween(a: Date, b: Date): number {
  const sunA = midnight(a);
  sunA.setDate(sunA.getDate() - sunA.getDay());
  const sunB = midnight(b);
  sunB.setDate(sunB.getDate() - sunB.getDay());
  return Math.round((sunB.getTime() - sunA.getTime()) / (DAY_MS * 7));
}

function monthsBetween(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * 주어진 날짜에 이 일정이 발생하는가?
 * 반복 규칙이 없으면 startAt과 같은 날인지만 본다.
 */
export function occursOn(schedule: ScheduleInfo, date: Date): boolean {
  const start = schedule.startAt;
  if (!start || isNaN(start.getTime())) return false;

  const rec = schedule.recurrence;
  if (!rec) return sameDay(start, date);

  const target = midnight(date);
  const startDay = midnight(start);

  // 시작 이전
  if (target.getTime() < startDay.getTime()) return false;

  // 종료일 이후
  if (rec.until && target.getTime() > midnight(rec.until).getTime()) return false;

  // 개별 취소된 회차
  if (rec.exdates?.some((ex) => sameDay(ex, target))) return false;

  const interval = Math.max(1, rec.interval || 1);
  let hit = false;

  switch (rec.freq) {
    case "daily": {
      const d = daysBetween(startDay, target);
      hit = d >= 0 && d % interval === 0;
      break;
    }
    case "weekly": {
      const weekdays =
        rec.byWeekday && rec.byWeekday.length > 0
          ? rec.byWeekday
          : [startDay.getDay()];
      if (!weekdays.includes(target.getDay())) break;
      const w = weeksBetween(startDay, target);
      hit = w >= 0 && w % interval === 0;
      break;
    }
    case "monthly": {
      if (target.getDate() !== startDay.getDate()) break;
      const m = monthsBetween(startDay, target);
      hit = m >= 0 && m % interval === 0;
      break;
    }
    case "yearly": {
      if (
        target.getMonth() !== startDay.getMonth() ||
        target.getDate() !== startDay.getDate()
      )
        break;
      const y = target.getFullYear() - startDay.getFullYear();
      hit = y >= 0 && y % interval === 0;
      break;
    }
  }

  if (!hit) return false;

  // 횟수 제한: 이 회차가 몇 번째인지 세어 초과하면 제외
  if (rec.count != null) {
    const idx = occurrenceIndex(schedule, target);
    if (idx < 0 || idx >= rec.count) return false;
  }

  return true;
}

/**
 * 해당 날짜가 몇 번째 회차인지 (0-based). 발생일이 아니면 -1.
 * count 제한 판정에 쓴다.
 */
export function occurrenceIndex(schedule: ScheduleInfo, date: Date): number {
  const rec = schedule.recurrence;
  if (!rec) return sameDay(schedule.startAt, date) ? 0 : -1;

  const startDay = midnight(schedule.startAt);
  const target = midnight(date);
  const interval = Math.max(1, rec.interval || 1);

  switch (rec.freq) {
    case "daily": {
      const d = daysBetween(startDay, target);
      return d % interval === 0 ? d / interval : -1;
    }
    case "weekly": {
      const weekdays = (
        rec.byWeekday && rec.byWeekday.length > 0
          ? rec.byWeekday
          : [startDay.getDay()]
      )
        .slice()
        .sort((a, b) => a - b);
      if (!weekdays.includes(target.getDay())) return -1;
      const w = weeksBetween(startDay, target);
      if (w % interval !== 0) return -1;
      // 주기 수 × 주당 발생 수 + 그 주 내 순번
      const cycles = w / interval;
      const posInWeek = weekdays.indexOf(target.getDay());
      // 첫 주는 시작 요일 이전 회차가 없으므로 보정
      const startPos = weekdays.findIndex((d) => d >= startDay.getDay());
      const firstWeekCount = weekdays.length - Math.max(0, startPos);
      if (cycles === 0) return posInWeek - Math.max(0, startPos);
      return firstWeekCount + (cycles - 1) * weekdays.length + posInWeek;
    }
    case "monthly": {
      const m = monthsBetween(startDay, target);
      return m % interval === 0 ? m / interval : -1;
    }
    case "yearly": {
      const y = target.getFullYear() - startDay.getFullYear();
      return y % interval === 0 ? y / interval : -1;
    }
  }
  return -1;
}

/**
 * 특정 날짜의 실제 시작/종료 시각.
 * 반복 회차는 원본의 시각을 유지하되 날짜만 바뀐다.
 */
export function occurrenceTimes(
  schedule: ScheduleInfo,
  date: Date
): { startAt: Date; endAt: Date } {
  const durationMs = Math.max(
    0,
    schedule.endAt.getTime() - schedule.startAt.getTime()
  );
  const s = new Date(date);
  s.setHours(
    schedule.startAt.getHours(),
    schedule.startAt.getMinutes(),
    0,
    0
  );
  return { startAt: s, endAt: new Date(s.getTime() + durationMs) };
}

/** 사람이 읽는 반복 설명 ("매주 화요일", "격주 월·수") */
export function describeRecurrence(rec: RecurrenceRule | null): string {
  if (!rec) return "";
  const names = ["일", "월", "화", "수", "목", "금", "토"];
  const n = Math.max(1, rec.interval || 1);

  let base: string;
  switch (rec.freq) {
    case "daily":
      base = n === 1 ? "매일" : `${n}일마다`;
      break;
    case "weekly": {
      const days =
        rec.byWeekday && rec.byWeekday.length > 0
          ? rec.byWeekday
              .slice()
              .sort((a, b) => a - b)
              .map((d) => names[d])
              .join("·")
          : "";
      const prefix = n === 1 ? "매주" : n === 2 ? "격주" : `${n}주마다`;
      base = days ? `${prefix} ${days}요일` : prefix;
      break;
    }
    case "monthly":
      base = n === 1 ? "매월" : `${n}개월마다`;
      break;
    case "yearly":
      base = n === 1 ? "매년" : `${n}년마다`;
      break;
  }

  if (rec.count != null) base += ` (${rec.count}회)`;
  else if (rec.until)
    base += ` (~${rec.until.getMonth() + 1}/${rec.until.getDate()})`;
  return base;
}

/** 기본 반복 규칙 */
export function makeRecurrence(
  partial: Partial<RecurrenceRule> & { freq: RecurrenceRule["freq"] }
): RecurrenceRule {
  return {
    freq: partial.freq,
    interval: partial.interval ?? 1,
    byWeekday: partial.byWeekday ?? [],
    until: partial.until ?? null,
    count: partial.count ?? null,
    exdates: partial.exdates ?? [],
  };
}
