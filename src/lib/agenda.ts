// ==========================================
// 일정 요약 — AI에게 "지금 뭐가 잡혀 있는지" 알려주는 층
// ==========================================
//
// 무엇이 잘못됐었나:
//
// 이전에는 chat-panel 안에서 이렇게 뽑았다.
//
//   .filter(({ s }) => s.recurrence || s.startAt >= now)
//
// `now`가 **현재 시각**이라는 게 문제다. 종일 일정의 startAt은 그날 00:00이므로,
// 자정을 넘기는 순간 **오늘 일정이 목록에서 사라진다.**
// 그래서 "오늘 당근 모임 있잖아"라고 해도 AI는 "등록된 일정이 없다"고 답했다.
// AI가 거짓말을 한 게 아니라, 받은 목록에 정말 없었다.
//
// 그리고 더 큰 문제: 이 목록이 **추출(doSchedule) 쪽에는 아예 안 갔다.**
// 기존 일정을 모르는 채로 새 일정을 뽑으니 중복을 거를 방법이 없었다.
// 같은 약속을 두 번 말하면 두 개가 생긴다.
//
// 그래서:
// - 기준을 시각이 아니라 **날짜(오늘 0시)**로 잡는다.
// - 반복 일정은 원래 시작일이 아니라 **다음 발생일**을 보여준다.
//   ("당근 모임 바이브코딩 3/2" 처럼 몇 달 전 날짜가 뜨면 판단에 방해가 된다)
// - 최근 지난 것도 조금 포함한다. "어제 그 미팅" 같은 참조가 가능해야 한다.
// - 이 목록을 대화·질의·**추출** 모두에 넘긴다.

import type { Node } from "./types";
import { occursOn, describeRecurrence } from "./recurrence.ts";

export interface AgendaItem {
  /** 노드 id — 중복 판정 결과를 되짚을 때 쓴다 */
  id: string;
  title: string;
  /** YYYY-MM-DD — 반복이면 다음(또는 오늘) 발생일 */
  date: string;
  /** HH:mm, 종일이면 null */
  time: string | null;
  /** "매주 화요일" 같은 설명, 반복이 아니면 null */
  recurrence: string | null;
  /** 오늘 일정인지 — 프롬프트에서 강조하려고 */
  isToday: boolean;
}

export interface AgendaOptions {
  /** 며칠 전까지 포함할지 (기본 7) */
  pastDays?: number;
  /** 며칠 뒤까지 포함할지 (기본 60) */
  futureDays?: number;
  /** 최대 건수 (기본 40) */
  limit?: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

function dateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 그 날의 0시 — 시각 비교 때문에 오늘 일정이 누락되는 걸 막는다 */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/**
 * 반복 일정의 다음 발생일을 찾는다.
 *
 * 오늘 발생하면 오늘을 돌려준다 — "오늘 당근 모임 있잖아"가 성립해야 한다.
 * 창 안에서 못 찾으면 null (이미 끝난 반복 등).
 */
function nextOccurrence(
  node: Node,
  from: Date,
  windowDays: number
): Date | null {
  const s = node.schedule;
  if (!s) return null;
  for (let i = 0; i <= windowDays; i++) {
    const day = addDays(from, i);
    if (occursOn(s, day)) return day;
  }
  return null;
}

/**
 * AI에게 넘길 일정 목록을 만든다.
 *
 * @param now 기준 시각 (테스트에서 고정할 수 있게 인자로 받는다)
 */
export function buildAgenda(
  nodes: Node[],
  now: Date,
  opts: AgendaOptions = {}
): AgendaItem[] {
  const { pastDays = 7, futureDays = 60, limit = 40 } = opts;

  const today = startOfDay(now);
  const from = addDays(today, -pastDays);
  const until = addDays(today, futureDays);
  const todayStr = dateStr(today);

  const items: AgendaItem[] = [];

  for (const n of nodes) {
    const s = n.schedule;
    if (!s) continue;
    // 대기함(draft)은 아직 확정 전이라 "잡혀 있는 일정"이 아니다.
    if (n.aiMeta?.status === "draft") continue;
    if (!s.startAt || isNaN(s.startAt.getTime())) continue;

    let when: Date | null;

    if (s.recurrence) {
      // 반복은 원래 시작일이 아니라 다음 발생일을 보여준다.
      // 오늘부터 찾되, 오늘 발생하면 오늘이 나온다.
      when = nextOccurrence(n, today, futureDays);
    } else {
      // 단발은 시작일 그대로. **날짜 기준**으로 창에 드는지 본다.
      // (시각으로 비교하면 오늘 0시 종일 일정이 탈락한다 — 원래 버그)
      const d = startOfDay(s.startAt);
      when = d >= from && d <= until ? d : null;
    }

    if (!when) continue;

    const ds = dateStr(when);
    items.push({
      id: n.id,
      title: n.title,
      date: ds,
      time: s.allDay
        ? null
        : `${pad(s.startAt.getHours())}:${pad(s.startAt.getMinutes())}`,
      recurrence: describeRecurrence(s.recurrence) || null,
      isToday: ds === todayStr,
    });
  }

  // 날짜순. 같은 날이면 시각순(종일이 먼저).
  items.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.time === b.time) return 0;
    if (a.time === null) return -1;
    if (b.time === null) return 1;
    return a.time < b.time ? -1 : 1;
  });

  return items.slice(0, limit);
}

/** 한 줄 렌더 */
export function renderAgendaItem(it: AgendaItem): string {
  const parts = [`${it.date}${it.time ? ` ${it.time}` : " 종일"}`, it.title];
  if (it.recurrence) parts.push(`(${it.recurrence})`);
  if (it.isToday) parts.push("← 오늘");
  return `- ${parts.join(" ")}`;
}

/**
 * 프롬프트 블록으로 렌더.
 *
 * 비어 있어도 섹션을 남긴다. 섹션이 통째로 사라지면 AI가 그 개념 자체를
 * 모른다고 보고 엉뚱하게 답한다(기억 인덱스와 같은 이유).
 */
export function renderAgenda(items: AgendaItem[]): string {
  if (!items.length) {
    return "## 현재 잡혀 있는 일정\n(없음 — 등록된 일정이 하나도 없다)";
  }
  return [
    `## 현재 잡혀 있는 일정 (${items.length}건)`,
    "**여기 있는 일정은 실제로 등록돼 있는 것이다.** 없다고 말하지 마라.",
    ...items.map(renderAgendaItem),
  ].join("\n");
}
