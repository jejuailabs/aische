// ==========================================
// 일기 / 관계 로그 계산
// ==========================================
//
// 사람을 단일 점수로 규정하지 않는 것이 이 파일의 설계 원칙이다.
// 평균 감정만 보여주면 "이 사람은 3.2점" 같은 오해가 생긴다.
// 그래서 항상 **추이 + 근거 개수 + 최근 기록**을 함께 낸다.
//
// 타입만 import하므로 단독 실행 테스트가 가능하다.

import type { DiaryEntry, RelationshipLog, Mood } from "./types";

const DAY_MS = 86400000;

function midnight(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ─────────────────────────────────────────
// 인용 검증
// ─────────────────────────────────────────

/**
 * AI가 낸 인용이 원문에 실제로 있는지 확인한다.
 *
 * 이게 없으면 AI가 근거를 지어내도 그대로 저장돼서,
 * 실존 인물에 대한 틀린 기록이 남는다.
 * 공백/줄바꿈만 무시하고 나머지는 글자 그대로 대조한다.
 */
export function verifyQuote(rawText: string, quote: string | null): boolean {
  if (!quote || !quote.trim()) return false;
  const strip = (s: string) => s.replace(/\s+/g, "");
  return strip(rawText).includes(strip(quote));
}

// ─────────────────────────────────────────
// 일기
// ─────────────────────────────────────────

/** 해당 날짜의 일기들 */
export function entriesOnDate(
  entries: DiaryEntry[],
  date: Date
): DiaryEntry[] {
  const key = dayKey(date);
  return entries
    .filter((e) => dayKey(e.entryDate) === key)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** 해당 월의 일기 (날짜 내림차순) */
export function entriesInMonth(
  entries: DiaryEntry[],
  year: number,
  month: number
): DiaryEntry[] {
  return entries
    .filter(
      (e) =>
        e.entryDate.getFullYear() === year && e.entryDate.getMonth() === month
    )
    .sort((a, b) => b.entryDate.getTime() - a.entryDate.getTime());
}

/** 월별 기분 추이 — 그 달 평균과 기록 수 */
export function moodByMonth(
  entries: DiaryEntry[]
): { period: string; avgMood: number; count: number }[] {
  const map = new Map<string, { sum: number; n: number; count: number }>();
  for (const e of entries) {
    const k = monthKey(e.entryDate);
    const cur = map.get(k) ?? { sum: 0, n: 0, count: 0 };
    cur.count += 1;
    if (e.mood != null) {
      cur.sum += e.mood;
      cur.n += 1;
    }
    map.set(k, cur);
  }
  return Array.from(map.entries())
    .map(([period, v]) => ({
      period,
      avgMood: v.n > 0 ? v.sum / v.n : 0,
      count: v.count,
    }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

/**
 * 연속 기록 일수. 오늘(또는 어제)부터 거꾸로 세어 끊기는 지점까지.
 * 오늘 아직 안 썼어도 어제까지 이어졌으면 유지된 것으로 본다.
 */
export function writingStreak(
  entries: DiaryEntry[],
  today: Date = new Date()
): number {
  if (entries.length === 0) return 0;
  const days = new Set(entries.map((e) => dayKey(e.entryDate)));
  const base = midnight(today);

  // 오늘 썼으면 오늘부터, 아니면 어제부터 센다
  let cursor = days.has(dayKey(base))
    ? base
    : new Date(base.getTime() - DAY_MS);
  if (!days.has(dayKey(cursor))) return 0;

  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor = new Date(cursor.getTime() - DAY_MS);
  }
  return streak;
}

/** 자주 등장한 감정 태그 */
export function topEmotions(
  entries: DiaryEntry[],
  limit = 8
): { emotion: string; count: number }[] {
  const map = new Map<string, number>();
  for (const e of entries) {
    for (const em of e.emotions) {
      map.set(em, (map.get(em) ?? 0) + 1);
    }
  }
  return Array.from(map.entries())
    .map(([emotion, count]) => ({ emotion, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

// ─────────────────────────────────────────
// 관계
// ─────────────────────────────────────────

export interface RelationshipSummary {
  personId: string;
  /** 기록 건수 — 적으면 판단 근거가 얕다는 뜻 */
  logCount: number;
  /** 평균 감정. logCount가 작을 때는 신뢰하면 안 된다 */
  avgSentiment: number;
  /** 최근 3건 평균 — 지금 관계가 어떤지 */
  recentSentiment: number;
  /** 최근 - 전체. 양수면 나아지는 중 */
  trend: number;
  firstAt: Date | null;
  lastAt: Date | null;
  daysSinceLast: number | null;
  positive: number;
  negative: number;
  neutral: number;
}

/** 한 사람에 대한 관계 요약 */
export function summarizeRelationship(
  logs: RelationshipLog[],
  personId: string,
  now: Date = new Date()
): RelationshipSummary {
  const mine = logs
    .filter((l) => l.personId === personId)
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  if (mine.length === 0) {
    return {
      personId,
      logCount: 0,
      avgSentiment: 0,
      recentSentiment: 0,
      trend: 0,
      firstAt: null,
      lastAt: null,
      daysSinceLast: null,
      positive: 0,
      negative: 0,
      neutral: 0,
    };
  }

  const avg =
    mine.reduce((s, l) => s + l.sentiment, 0) / mine.length;
  const recentSlice = mine.slice(-3);
  const recent =
    recentSlice.reduce((s, l) => s + l.sentiment, 0) / recentSlice.length;
  const last = mine[mine.length - 1].occurredAt;

  return {
    personId,
    logCount: mine.length,
    avgSentiment: avg,
    recentSentiment: recent,
    trend: recent - avg,
    firstAt: mine[0].occurredAt,
    lastAt: last,
    daysSinceLast: Math.floor(
      (midnight(now).getTime() - midnight(last).getTime()) / DAY_MS
    ),
    positive: mine.filter((l) => l.sentiment > 0).length,
    negative: mine.filter((l) => l.sentiment < 0).length,
    neutral: mine.filter((l) => l.sentiment === 0).length,
  };
}

/** 한 사람의 기록 (최신순) */
export function logsForPerson(
  logs: RelationshipLog[],
  personId: string
): RelationshipLog[] {
  return logs
    .filter((l) => l.personId === personId)
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
}

/** 기록이 있는 사람들을 최근 순으로 */
export function peopleByRecency(logs: RelationshipLog[]): string[] {
  const last = new Map<string, number>();
  for (const l of logs) {
    const t = l.occurredAt.getTime();
    if (t > (last.get(l.personId) ?? 0)) last.set(l.personId, t);
  }
  return Array.from(last.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
}

/**
 * 한동안 기록이 없는 사람 — "연락한 지 오래됐다" 알림용.
 * 기록이 2건 미만이면 제외한다. 한 번 만난 사람까지 챙기라고 하면 소음이 된다.
 */
export function driftingRelationships(
  logs: RelationshipLog[],
  thresholdDays = 60,
  now: Date = new Date()
): RelationshipSummary[] {
  const ids = Array.from(new Set(logs.map((l) => l.personId)));
  return ids
    .map((id) => summarizeRelationship(logs, id, now))
    .filter(
      (s) =>
        s.logCount >= 2 &&
        s.daysSinceLast != null &&
        s.daysSinceLast >= thresholdDays
    )
    .sort((a, b) => (b.daysSinceLast ?? 0) - (a.daysSinceLast ?? 0));
}

/** 감정 점수 → 라벨 */
export function sentimentLabel(v: number): string {
  if (v >= 1.5) return "매우 긍정";
  if (v >= 0.5) return "긍정";
  if (v > -0.5) return "중립";
  if (v > -1.5) return "부정";
  return "매우 부정";
}

/**
 * 요약을 신뢰해도 되는지.
 * 기록이 적으면 평균이 튀므로 화면에서 단정적으로 쓰면 안 된다.
 */
export function isSummaryReliable(s: RelationshipSummary): boolean {
  return s.logCount >= 3;
}

/** 기분 라벨 */
export function moodLabel(m: Mood | null): string {
  if (m == null) return "기록 없음";
  return (
    { [-2]: "많이 힘듦", [-1]: "가라앉음", [0]: "보통", [1]: "괜찮음", [2]: "좋음" }[
      m
    ] ?? "보통"
  );
}
