// ==========================================
// 한국어 날짜 표현 → 실제 날짜 (결정론적)
// ==========================================
//
// LLM은 날짜 산술("다음주 화요일" → 2026-07-28)을 자주 틀린다.
// 그래서 AI에게는 **날짜 표현 문자열만** 뽑게 하고,
// 실제 계산은 여기서 코드로 한다.

export interface ResolvedDate {
  /** 계산된 날짜 (시각 미포함, 로컬 자정) */
  date: Date;
  /** 시각이 명시됐으면 시/분 */
  hour: number | null;
  minute: number;
  /** 종료 시각이 명시됐으면 ("19시부터 21시까지") */
  endHour: number | null;
  endMinute: number;
  /** 어떤 규칙으로 해석했는지 (디버깅/로그용) */
  rule: string;
}

const WEEKDAY: Record<string, number> = {
  일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6,
};

/** 그 주의 월요일 (월요일 시작 주) */
function mondayOf(d: Date): Date {
  const r = new Date(d);
  const dow = r.getDay(); // 0=일
  const diff = dow === 0 ? -6 : 1 - dow;
  r.setDate(r.getDate() + diff);
  r.setHours(0, 0, 0, 0);
  return r;
}

function atMidnight(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

/** 주 시작(월) 기준으로 해당 주의 특정 요일 */
function weekdayInWeek(weekStart: Date, targetDow: number): Date {
  // weekStart는 월요일. 월=1..일=0 을 월요일 기준 오프셋으로 변환
  const offset = targetDow === 0 ? 6 : targetDow - 1;
  const r = new Date(weekStart);
  r.setDate(r.getDate() + offset);
  return r;
}

interface TimePoint {
  hour: number;
  minute: number;
}
interface TimeRange {
  start: TimePoint;
  /** "19시부터 21시까지"처럼 종료가 명시된 경우만 */
  end: TimePoint | null;
}

/** 오전/오후 보정. 문맥에 오후 표시가 있으면 12시간 더한다 */
function applyMeridiem(h: number, isPM: boolean, isAM: boolean): number {
  if (isPM && h < 12) return h + 12;
  if (isAM && h === 12) return 0;
  return h;
}

/**
 * 시각 표현 파싱. 범위도 인식한다.
 *   "오후 2시 30분"        → 14:30
 *   "19시부터 21시까지"     → 19:00 ~ 21:00
 *   "오후 7시~9시"         → 19:00 ~ 21:00
 *   "14:00-16:00"         → 14:00 ~ 16:00
 */
function parseTime(text: string): TimeRange | null {
  const isPM = /오후|저녁|밤|pm/i.test(text);
  const isAM = /오전|아침|am/i.test(text);

  // ── 1) 범위 먼저 ──
  // "19시부터 21시까지", "7시~9시", "7시 - 9시"
  const korRange = text.match(
    /(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?\s*(?:부터|에서)?\s*(?:~|-|—|–|부터)\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?\s*(?:까지)?/
  );
  if (korRange) {
    let sh = applyMeridiem(+korRange[1], isPM, isAM);
    const sm = korRange[2] ? +korRange[2] : 0;
    let eh = applyMeridiem(+korRange[3], isPM, isAM);
    const em = korRange[4] ? +korRange[4] : 0;
    if (!isPM && !isAM && /저녁|밤/.test(text) && sh < 12) {
      sh += 12;
      eh += 12;
    }
    // 종료가 시작보다 이르면 오후로 넘어간 것으로 본다 (예: 11시~1시)
    if (eh < sh) eh += 12;
    return { start: { hour: sh, minute: sm }, end: { hour: eh, minute: em } };
  }

  // "14:00~16:00"
  const colonRange = text.match(
    /(\d{1,2}):(\d{2})\s*(?:~|-|—|–|부터)\s*(\d{1,2}):(\d{2})/
  );
  if (colonRange) {
    const sh = applyMeridiem(+colonRange[1], isPM, isAM);
    const eh = applyMeridiem(+colonRange[3], isPM, isAM);
    return {
      start: { hour: sh, minute: +colonRange[2] },
      end: { hour: eh, minute: +colonRange[4] },
    };
  }

  // ── 2) 단일 시각 ──
  const colon = text.match(/(\d{1,2}):(\d{2})/);
  if (colon) {
    const h = applyMeridiem(+colon[1], isPM, isAM);
    return { start: { hour: h, minute: +colon[2] }, end: null };
  }

  const kor = text.match(/(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/);
  if (kor) {
    let h = applyMeridiem(+kor[1], isPM, isAM);
    const m = kor[2] ? +kor[2] : 0;
    // "저녁 7시" 처럼 오전/오후 없이 저녁/밤이면 오후로
    if (!isPM && !isAM && /저녁|밤/.test(text) && h < 12) h += 12;
    return { start: { hour: h, minute: m }, end: null };
  }

  return null;
}

/**
 * 날짜 표현을 실제 날짜로 해석한다.
 * 해석 불가면 null (호출측에서 AI가 준 ISO를 폴백으로 사용)
 */
export function resolveDateExpr(
  expr: string,
  today: Date = new Date()
): ResolvedDate | null {
  if (!expr?.trim()) return null;
  const s = expr.trim();
  const time = parseTime(s);
  const withTime = (date: Date, rule: string): ResolvedDate => ({
    date: atMidnight(date),
    hour: time?.start.hour ?? null,
    minute: time?.start.minute ?? 0,
    endHour: time?.end?.hour ?? null,
    endMinute: time?.end?.minute ?? 0,
    rule,
  });

  const base = atMidnight(today);

  // --- 1) 절대 날짜: "8월 5일", "2026년 8월 5일", "8/5" ---
  const ymd = s.match(/(\d{4})\s*[년.\-/]\s*(\d{1,2})\s*[월.\-/]\s*(\d{1,2})/);
  if (ymd) {
    const d = new Date(+ymd[1], +ymd[2] - 1, +ymd[3]);
    return withTime(d, "absolute-ymd");
  }
  const md = s.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일?/) ?? s.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (md) {
    const month = +md[1] - 1;
    const day = +md[2];
    let d = new Date(base.getFullYear(), month, day);
    // 이미 지난 날짜면 내년
    if (d < base) d = new Date(base.getFullYear() + 1, month, day);
    return withTime(d, "absolute-md");
  }

  // --- 2) N일/주 후 ---
  const afterDays = s.match(/(\d+)\s*일\s*(?:후|뒤)/);
  if (afterDays) {
    const d = new Date(base);
    d.setDate(d.getDate() + +afterDays[1]);
    return withTime(d, "after-days");
  }
  const afterWeeks = s.match(/(\d+)\s*주\s*(?:후|뒤)/);
  if (afterWeeks) {
    const d = new Date(base);
    d.setDate(d.getDate() + +afterWeeks[1] * 7);
    return withTime(d, "after-weeks");
  }

  // --- 3) 상대 일 (요일 매칭보다 먼저! "내일"의 '일'이 일요일로 오인되는 것 방지) ---
  if (/모레|내일모레/.test(s)) {
    const d = new Date(base);
    d.setDate(d.getDate() + 2);
    return withTime(d, "day-after-tomorrow");
  }
  if (/글피/.test(s)) {
    const d = new Date(base);
    d.setDate(d.getDate() + 3);
    return withTime(d, "three-days");
  }
  if (/내일|명일/.test(s)) {
    const d = new Date(base);
    d.setDate(d.getDate() + 1);
    return withTime(d, "tomorrow");
  }
  if (/어제|작일/.test(s)) {
    const d = new Date(base);
    d.setDate(d.getDate() - 1);
    return withTime(d, "yesterday");
  }
  if (/오늘|금일/.test(s)) {
    return withTime(base, "today");
  }

  // --- 4) 주 + 요일 조합 ("다음주 화요일", "이번주 금") ---
  // 단독 요일 글자는 앞이 문자열 시작/공백일 때만 인정 (예: "내일"의 '일' 제외)
  const weekdayMatch =
    s.match(/([일월화수목금토])\s*요일/) ??
    s.match(/(?:^|\s)([일월화수목금토])(?=\s|$|에|까지|부터)/);
  const hasNextWeek = /다음\s*주|담주|내주/.test(s);
  const hasThisWeek = /이번\s*주|금주/.test(s);
  const hasLastWeek = /지난\s*주|저번\s*주/.test(s);

  if (weekdayMatch) {
    const dow = WEEKDAY[weekdayMatch[1]];
    const thisMonday = mondayOf(base);

    if (hasNextWeek) {
      const nextMonday = new Date(thisMonday);
      nextMonday.setDate(nextMonday.getDate() + 7);
      return withTime(weekdayInWeek(nextMonday, dow), "next-week-weekday");
    }
    if (hasThisWeek) {
      return withTime(weekdayInWeek(thisMonday, dow), "this-week-weekday");
    }
    if (hasLastWeek) {
      const lastMonday = new Date(thisMonday);
      lastMonday.setDate(lastMonday.getDate() - 7);
      return withTime(weekdayInWeek(lastMonday, dow), "last-week-weekday");
    }
    // 요일만 → 오늘 이후 가장 가까운 그 요일 (오늘이 그 요일이면 오늘)
    const d = new Date(base);
    const diff = (dow - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + diff);
    return withTime(d, "next-weekday");
  }

  // --- 5) 요일 없는 주 표현 ---
  if (hasNextWeek) {
    const nextMonday = new Date(mondayOf(base));
    nextMonday.setDate(nextMonday.getDate() + 7);
    return withTime(nextMonday, "next-week");
  }
  if (hasThisWeek) {
    return withTime(mondayOf(base), "this-week");
  }

  // --- 6) 다음달 / 이번달 N일 ---
  const nextMonthDay = s.match(/다음\s*달\s*(\d{1,2})\s*일/);
  if (nextMonthDay) {
    const d = new Date(base.getFullYear(), base.getMonth() + 1, +nextMonthDay[1]);
    return withTime(d, "next-month-day");
  }

  // 시각만 있고 날짜 표현이 없으면 오늘로
  if (time) return withTime(base, "time-only-today");

  return null;
}

/** ResolvedDate → 시작/종료 ISO 문자열 */
export function toStartEnd(
  r: ResolvedDate,
  durationMinutes = 60
): { startAt: string; endAt: string; allDay: boolean } {
  const start = new Date(r.date);
  if (r.hour === null) {
    // 종일 일정
    start.setHours(9, 0, 0, 0);
    const end = new Date(start);
    end.setHours(18, 0, 0, 0);
    return { startAt: toLocalISO(start), endAt: toLocalISO(end), allDay: true };
  }
  start.setHours(r.hour, r.minute, 0, 0);
  // 종료 시각이 명시됐으면("19시부터 21시까지") 그걸 쓰고, 아니면 기본 소요시간
  let end: Date;
  if (r.endHour !== null) {
    end = new Date(r.date);
    end.setHours(r.endHour, r.endMinute, 0, 0);
    // 자정을 넘기는 일정 (22시~1시)
    if (end.getTime() <= start.getTime()) end.setDate(end.getDate() + 1);
  } else {
    end = new Date(start.getTime() + durationMinutes * 60000);
  }
  return { startAt: toLocalISO(start), endAt: toLocalISO(end), allDay: false };
}

/** 로컬 타임존 기준 ISO (Z 없음) — Date로 다시 파싱해도 같은 시각 */
function toLocalISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}
