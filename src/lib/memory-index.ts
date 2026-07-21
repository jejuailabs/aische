// ==========================================
// 기억 인덱스 — AI가 "지금까지 뭐가 쌓였는지" 알게 하는 층
// ==========================================
//
// 문제:
// AI에게 넘기는 컨텍스트가 이름 목록뿐이었다. "프로젝트: A, B / 인물: 김철수".
// 그래서 "AX 강의 사전미팅"을 넣었을 때 그게 무엇에 관한 것인지 판단할 근거가
// 없었고, 이름만 보고 그럴듯한 걸 골라 붙였다. 없는 모임을 지어낸 것도 같은
// 이유다 — 실제로 뭐가 있는지 모르니까 추측한 것이다.
//
// 원문(CapturedInput)은 이미 전부 쌓여 있다. 문제는 꺼낼 길이 없다는 것이다.
//
// 해결:
// 입력 하나당 한 줄짜리 요약 레코드를 만들어 전부 프롬프트에 넣는다.
//
//   [07-21] 미팅 | 강소희, AX강의 | 주제:AX 강의 준비
//
// 왜 벡터 검색을 안 쓰는가:
// 이 앱은 개인용이고 하루 몇 건이다. 1000건이라도 한 줄 60~80자면 7만 자,
// 프롬프트에 통째로 들어간다. 검색을 붙이면 "관련 있는 것만" 뽑히는 대신
// 놓치는 게 생기고, 임베딩 비용과 동기화 문제가 따라온다.
// 전부 보여주는 게 이 규모에선 더 정확하고 더 싸다.
//
// 1만 건을 넘어가면 selectEntries()의 필터로 좁히면 된다. 그때 가서.

import type { CapturedInput } from "./types";

/** 프롬프트에 실을 한 줄 요약 */
export interface IndexEntry {
  /** CapturedInput.id — 원문을 되찾는 열쇠 */
  id: string;
  /** YYYY-MM-DD */
  date: string;
  /** 이 입력이 무엇이었나 */
  kind: "schedule" | "todo" | "goal" | "contact" | "note" | "mixed";
  /** 한 줄 요약 */
  title: string;
  /** 등장한 고유명사 — 사람·조직·프로젝트 */
  entities: string[];
  /** 묶인 주제 라벨 */
  topic: string | null;
}

const pad = (n: number) => String(n).padStart(2, "0");

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 한 줄에 들어갈 만큼만 자른다 */
function trim(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max - 1) + "…";
}

/**
 * 저장된 입력 하나에서 인덱스 한 줄을 만든다.
 *
 * extraction이 없는(분석 실패) 입력도 버리지 않는다.
 * 원문 앞부분이라도 남겨야 나중에 "그때 뭐라고 했더라"를 찾을 수 있다.
 */
export function buildIndexEntry(c: CapturedInput): IndexEntry {
  const ex = c.extraction;
  const date = toDateStr(c.createdAt instanceof Date ? c.createdAt : new Date(c.createdAt));

  // 고유명사를 모은다. AI가 판단 근거로 쓸 수 있는 건 결국 이것이다.
  const entities: string[] = [];
  if (ex) {
    for (const p of ex.people ?? []) if (p.name) entities.push(p.name);
    for (const o of ex.organizations ?? []) if (o.name) entities.push(o.name);
    if (ex.schedule?.title) entities.push(ex.schedule.title);
    for (const t of ex.tasks ?? []) if (t.title) entities.push(t.title);
  }

  return {
    id: c.id,
    date,
    kind: ex?.intent ?? "note",
    // summary가 없으면 원문 앞부분으로 대신한다. 빈 줄은 만들지 않는다.
    title: trim(ex?.summary || c.rawText, 44),
    // 중복 제거 — 같은 사람이 여러 층에 등장하는 게 흔하다
    entities: [...new Set(entities.map((e) => trim(e, 20)))].slice(0, 5),
    topic: ex?.topic?.label ? trim(ex.topic.label, 24) : null,
  };
}

/** 여러 입력 → 인덱스. 최신이 뒤로 가게 정렬한다 (읽는 순서가 시간 순서). */
export function buildIndex(captures: CapturedInput[]): IndexEntry[] {
  return captures
    .map(buildIndexEntry)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** 한 줄 렌더 */
export function renderEntry(e: IndexEntry): string {
  const parts = [`[${e.date.slice(5)}]`, e.title];
  if (e.entities.length) parts.push(`| ${e.entities.join(", ")}`);
  if (e.topic) parts.push(`| 주제:${e.topic}`);
  return parts.join(" ");
}

export interface SelectOptions {
  /** 최대 몇 줄까지 (프롬프트 예산) */
  limit?: number;
  /** 이 날짜(YYYY-MM-DD) 이후만 */
  since?: string;
}

/**
 * 프롬프트에 실을 항목을 고른다.
 *
 * 잘라야 할 때는 **오래된 것부터** 버린다. 최근 맥락이 판단에 더 쓸모 있다.
 * 다만 잘렸다는 사실을 렌더에 명시한다 — AI가 "이게 전부"라고 착각하면
 * "그런 기록 없다"고 틀리게 단정하기 때문이다.
 */
export function selectEntries(
  entries: IndexEntry[],
  opts: SelectOptions = {}
): { selected: IndexEntry[]; omitted: number } {
  let pool = entries;
  if (opts.since) pool = pool.filter((e) => e.date >= opts.since!);

  const limit = opts.limit ?? 300;
  if (pool.length <= limit) return { selected: pool, omitted: 0 };

  return {
    selected: pool.slice(pool.length - limit),
    omitted: pool.length - limit,
  };
}

/**
 * 프롬프트에 넣을 블록으로 렌더.
 *
 * 비어 있을 때 빈 문자열이 아니라 "(없음)"을 내는 게 중요하다.
 * 섹션이 통째로 사라지면 AI는 그런 개념 자체가 없다고 보고,
 * 있지도 않은 걸 지어내는 쪽으로 기운다.
 */
export function renderIndex(
  entries: IndexEntry[],
  opts: SelectOptions = {}
): string {
  const { selected, omitted } = selectEntries(entries, opts);
  if (!selected.length) {
    return "## 지금까지 쌓인 기록\n(없음 — 아직 저장된 입력이 없다)";
  }

  const head = omitted
    ? `## 지금까지 쌓인 기록 (최근 ${selected.length}건. 이전 ${omitted}건은 생략됨)`
    : `## 지금까지 쌓인 기록 (전체 ${selected.length}건)`;

  return [
    head,
    "여기 없는 사람·모임·주제는 **존재하지 않는 것으로 취급하라.**",
    ...selected.map(renderEntry),
  ].join("\n");
}
