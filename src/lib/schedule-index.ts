// ==========================================
// 일정 색인 — 찾기와 충돌 감지를 결정적으로 만든다
// ==========================================
//
// 왜 필요한가:
//
// 지금까지 충돌 감지가 "AI가 search_schedules를 먼저 불러줄 것"에 의존했다.
// 프롬프트로 시켰지만 모델이 안 부르면 그냥 통과한다. 같은 일정이 두 개 생긴다.
// 프롬프트 준수에 안전장치를 거는 건 안전장치가 아니다.
//
// 색인을 만들면 등록 시점에 **무조건** 그 날짜 칸을 본다. 모델과 무관하게 돈다.
//
// 부수 효과로 검색도 정확해진다. 이전에는 전체를 훑으며 부분 문자열 비교를
// 했는데, 반복 일정의 회차를 못 잡고("당근 모임"이 매주인데 오늘 것을 못 찾음)
// 띄어쓰기·조사 차이에도 약했다.
//
// 구조:
//
//   byDate   "2026-07-21" → [항목…]     ← 충돌 감지의 핵심
//   byToken  "당근"        → [항목…]     ← 제목 검색
//
// 반복 일정은 색인을 만들 때 **회차로 펼친다.** 조회 때마다 푸는 것보다
// 한 번 펼쳐두는 게 싸고, 날짜 칸에 실제로 들어가 있어야 충돌이 잡힌다.

import type { Node } from "./types";
import { occursOn } from "./recurrence.ts";

export interface IndexedItem {
  nodeId: string;
  title: string;
  /** YYYY-MM-DD — 반복이면 그 회차의 날짜 */
  date: string;
  /** 분 단위 시작 시각. 종일이면 null */
  startMin: number | null;
  /** 분 단위 종료 시각. 종일이면 null */
  endMin: number | null;
  allDay: boolean;
  /** 반복 일정의 회차인지 */
  isRecurring: boolean;
}

export interface ScheduleIndex {
  byDate: Map<string, IndexedItem[]>;
  byToken: Map<string, IndexedItem[]>;
  /** 색인에 담긴 총 회차 수 */
  size: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/**
 * 제목을 검색용 토큰으로 쪼갠다.
 *
 * 한국어는 띄어쓰기가 들쭉날쭉하고 조사가 붙는다("당근모임", "당근 모임에").
 * 그래서 두 가지를 넣는다:
 *   - 공백으로 나눈 단어
 *   - 공백을 지운 전체 문자열
 * 완벽한 형태소 분석은 아니지만, 이 규모에서는 이 정도로 충분히 잡힌다.
 */
export function tokenize(title: string): string[] {
  const norm = title.toLowerCase().trim();
  if (!norm) return [];
  const compact = norm.replace(/\s+/g, "");
  const words = norm.split(/\s+/).filter((w) => w.length >= 2);
  return [...new Set([compact, ...words])];
}

/** 비교용 정규화 — 띄어쓰기 차이를 없앤다 */
export function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}

/**
 * 색인을 만든다.
 *
 * @param windowDays 오늘 기준 앞뒤 며칠까지 펼칠지.
 *   반복 일정을 무한히 펼칠 수는 없으므로 창을 둔다.
 *   충돌 감지에 필요한 건 등록하려는 날짜 근처뿐이다.
 */
export function buildScheduleIndex(
  nodes: Node[],
  now: Date,
  windowDays = 400
): ScheduleIndex {
  const byDate = new Map<string, IndexedItem[]>();
  const byToken = new Map<string, IndexedItem[]>();
  let size = 0;

  const today = startOfDay(now);
  const from = addDays(today, -Math.floor(windowDays / 4));
  const to = addDays(today, windowDays);

  const push = (map: Map<string, IndexedItem[]>, key: string, item: IndexedItem) => {
    const arr = map.get(key);
    if (arr) arr.push(item);
    else map.set(key, [item]);
  };

  const add = (item: IndexedItem) => {
    size++;
    push(byDate, item.date, item);
    for (const tk of tokenize(item.title)) push(byToken, tk, item);
  };

  for (const n of nodes) {
    const s = n.schedule;
    if (!s?.startAt || isNaN(s.startAt.getTime())) continue;
    // 대기함은 아직 확정 전이라 "잡혀 있는 일정"이 아니다 — 충돌 대상도 아니다.
    if (n.aiMeta?.status === "draft") continue;

    const startMin = s.allDay
      ? null
      : s.startAt.getHours() * 60 + s.startAt.getMinutes();
    const endMin =
      s.allDay || !s.endAt || isNaN(s.endAt.getTime())
        ? null
        : s.endAt.getHours() * 60 + s.endAt.getMinutes();

    const base = {
      nodeId: n.id,
      title: n.title,
      startMin,
      endMin,
      allDay: s.allDay,
    };

    if (s.recurrence) {
      // 회차로 펼친다. 창 안에서만.
      for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
        if (occursOn(s, d)) {
          add({ ...base, date: toDateKey(d), isRecurring: true });
        }
      }
    } else {
      add({ ...base, date: toDateKey(s.startAt), isRecurring: false });
    }
  }

  return { byDate, byToken, size };
}

/** 특정 날짜의 일정 — 충돌 감지의 기본 조회 */
export function findByDate(index: ScheduleIndex, dateKey: string): IndexedItem[] {
  return index.byDate.get(dateKey) ?? [];
}

/**
 * 제목으로 찾는다.
 *
 * 토큰 색인에서 후보를 좁힌 뒤 정규화 부분 일치로 확인한다.
 * 전체를 훑지 않으므로 항목이 늘어도 느려지지 않는다.
 */
export function findByTitle(index: ScheduleIndex, query: string): IndexedItem[] {
  const q = normalizeTitle(query);
  if (!q) return [];

  const seen = new Set<string>();
  const out: IndexedItem[] = [];

  const consider = (it: IndexedItem) => {
    // 같은 노드의 여러 회차는 하나로 본다 — 검색 결과가 회차로 도배되면 못 읽는다.
    const key = `${it.nodeId}|${it.date}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(it);
  };

  // 토큰이 정확히 걸리는 것 우선
  for (const tk of tokenize(query)) {
    for (const it of index.byToken.get(tk) ?? []) consider(it);
  }

  // 토큰으로 못 잡는 부분 일치("당근"으로 "당근모임바이브코딩" 찾기 등)
  for (const [tk, items] of index.byToken) {
    if (tk.includes(q) || q.includes(tk)) {
      for (const it of items) consider(it);
    }
  }

  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// ────────────────────── 충돌 감지 ──────────────────────

export type ConflictKind =
  /** 같은 날 같은 제목 — 거의 확실히 중복 */
  | "duplicate"
  /** 반복 일정이 이미 그 날을 덮고 있음 */
  | "recurring_covers"
  /** 같은 날 비슷한 제목 */
  | "similar"
  /** 같은 날 시간대가 겹침 (제목은 달라도 문제가 된다) */
  | "time_overlap";

export interface Conflict {
  kind: ConflictKind;
  item: IndexedItem;
  /** 사용자·AI에게 보여줄 설명 */
  reason: string;
}

export interface ConflictQuery {
  title: string;
  /** YYYY-MM-DD */
  date: string;
  startMin?: number | null;
  endMin?: number | null;
}

/** 두 제목이 사실상 같은가 */
function sameTitle(a: string, b: string): boolean {
  return normalizeTitle(a) === normalizeTitle(b);
}

/** 한쪽이 다른 쪽을 포함하는가 (비슷함 판정) */
function similarTitle(a: string, b: string): boolean {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (!x || !y) return false;
  // 너무 짧으면 우연히 겹친다. 2자 이상일 때만 본다.
  if (Math.min(x.length, y.length) < 2) return false;
  return x.includes(y) || y.includes(x);
}

/** 시간대가 겹치는가 */
function overlaps(
  aStart: number | null,
  aEnd: number | null,
  bStart: number | null,
  bEnd: number | null
): boolean {
  // 어느 한쪽이라도 종일이면 시간 충돌로 보지 않는다.
  // 종일 일정은 그날 다른 일정과 공존하는 게 정상이다.
  if (aStart === null || bStart === null) return false;
  const ae = aEnd ?? aStart + 60;
  const be = bEnd ?? bStart + 60;
  return aStart < be && bStart < ae;
}

/**
 * 등록하려는 일정과 충돌하는 기존 일정을 찾는다.
 *
 * **이 함수는 AI와 무관하게 항상 돈다.** 등록 경로에서 무조건 호출한다.
 * AI가 확인을 건너뛰어도 여기서 잡힌다.
 *
 * 심각한 순서로 정렬해서 돌려준다.
 */
export function findConflicts(
  index: ScheduleIndex,
  q: ConflictQuery
): Conflict[] {
  const sameDay = findByDate(index, q.date);
  const out: Conflict[] = [];

  for (const it of sameDay) {
    if (sameTitle(it.title, q.title)) {
      out.push({
        kind: it.isRecurring ? "recurring_covers" : "duplicate",
        item: it,
        reason: it.isRecurring
          ? `"${it.title}"은(는) 반복 일정으로 이미 ${q.date}에 잡혀 있습니다.`
          : `"${it.title}"이(가) 이미 ${q.date}에 등록돼 있습니다.`,
      });
      continue;
    }

    if (similarTitle(it.title, q.title)) {
      out.push({
        kind: "similar",
        item: it,
        reason: `같은 날 비슷한 이름의 일정이 있습니다: "${it.title}".`,
      });
      continue;
    }

    if (overlaps(q.startMin ?? null, q.endMin ?? null, it.startMin, it.endMin)) {
      const hh = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
      out.push({
        kind: "time_overlap",
        item: it,
        reason:
          `같은 시간대에 "${it.title}"이(가) 있습니다` +
          (it.startMin !== null ? ` (${hh(it.startMin)}).` : "."),
      });
    }
  }

  const order: Record<ConflictKind, number> = {
    duplicate: 0,
    recurring_covers: 1,
    similar: 2,
    time_overlap: 3,
  };
  return out.sort((a, b) => order[a.kind] - order[b.kind]);
}
