// ==========================================
// 도구 실행 — AI가 부른 도구를 실제 데이터에 대고 돌린다
// ==========================================
//
// 스토어를 직접 import 하지 않고 데이터를 **인자로 받는다.**
// 이유 두 가지:
//   1) 유닛 테스트가 된다. 검색이 틀리면 AI가 "그런 일정 없다"고 답하는데,
//      그게 오늘 실제로 터진 사고다. 검색 로직은 반드시 테스트가 붙어야 한다.
//   2) 서버/클라이언트 어디서든 같은 코드를 쓸 수 있다.
//
// 쓰기 도구는 **여기서 적용하지 않는다.** 무엇을 바꿀지 계획만 돌려주고,
// 사용자가 확인한 뒤 호출 측이 적용한다. AI가 잘못 판단해 지운 건 못 되돌린다.

import type { Node, Person, Topic, CapturedInput } from "./types";
import { resolveDateExpr } from "./date-expr.ts";
import { buildAgenda } from "./agenda.ts";
import {
  buildScheduleIndex,
  findByDate,
  findByTitle,
  findConflicts,
  toDateKey,
  type Conflict,
  type IndexedItem,
} from "./schedule-index.ts";
import { parseToolArgs, validateToolCall, type ToolCall } from "./tools.ts";

/** 실행에 필요한 데이터 — 호출 측이 스토어에서 모아 넘긴다 */
export interface ToolData {
  nodes: Node[];
  people: Person[];
  topics: Topic[];
  captures: CapturedInput[];
}

/** 쓰기 도구의 결과 — 아직 적용되지 않은 '제안' */
export interface PendingChange {
  kind: "update_schedule" | "delete_schedule";
  nodeId: string;
  /** 사용자에게 보여줄 대상 이름 */
  targetTitle: string;
  /** 바뀌는 필드: 라벨 → { 전, 후 } */
  changes: { field: string; label: string; before: string; after: string }[];
}

export interface ExecResult {
  /** 모델에게 돌려줄 내용 */
  content: string;
  /** 쓰기 도구면 확인 대기 중인 변경 */
  pending?: PendingChange;
  /** 감지된 충돌 — UI가 그대로 보여준다 */
  conflicts?: Conflict[];
  /**
   * 등록 절차로 넘길 원문.
   *
   * 새 일정 생성은 **기존 계획 카드 경로를 그대로 쓴다.** 여기서 만들지 않는다.
   * 생성 경로가 둘이 되면 어느 쪽이 도는지 헷갈리고 고칠 때도 두 군데를 고쳐야 한다.
   * 에이전트는 "이건 새로 등록할 내용"이라고 판단만 하고 넘긴다.
   */
  staged?: { text: string };
}

const pad = (n: number) => String(n).padStart(2, "0");
const dateStr = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 검색용 정규화 — 띄어쓰기 차이로 못 찾는 걸 막는다 ("당근모임" vs "당근 모임") */
function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}

function matches(haystack: string, needle: string): boolean {
  return norm(haystack).includes(norm(needle));
}

/**
 * 일정 검색.
 *
 * query와 dateExpr는 **둘 다 선택**이고, 둘 다 주면 AND다.
 * 둘 다 없으면 앞으로의 일정을 돌려준다(= "일정 뭐 있어?").
 */
function searchSchedules(
  data: ToolData,
  args: Record<string, any>,
  now: Date
): ExecResult {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const dateExpr = typeof args.dateExpr === "string" ? args.dateExpr.trim() : "";

  // 날짜 표현은 코드가 푼다. AI가 계산하면 틀린다.
  let targetDate: string | null = null;
  if (dateExpr) {
    const r = resolveDateExpr(dateExpr, now);
    if (!r) {
      return {
        content: JSON.stringify({
          error: `날짜 표현을 해석하지 못했습니다: "${dateExpr}". ` +
            `구체적인 날짜로 다시 시도하거나 dateExpr 없이 검색하세요.`,
        }),
      };
    }
    targetDate = dateStr(r.date);
  }

  // 색인으로 찾는다. 전체를 훑지 않으므로 항목이 늘어도 느려지지 않고,
  // 반복 일정이 회차로 펼쳐져 있어 "오늘 그 모임"이 정확히 잡힌다.
  const index = buildScheduleIndex(data.nodes, now);

  let hits: IndexedItem[];
  if (targetDate && query) {
    // 날짜 칸을 먼저 좁힌 뒤 제목을 본다 — 날짜 칸이 훨씬 작다.
    hits = findByDate(index, targetDate).filter((it) =>
      matches(it.title, query)
    );
  } else if (targetDate) {
    hits = findByDate(index, targetDate);
  } else if (query) {
    hits = findByTitle(index, query);
  } else {
    // 조건이 없으면 오늘부터 앞으로.
    const todayKey = toDateKey(now);
    hits = [...index.byDate.entries()]
      .filter(([k]) => k >= todayKey)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .flatMap(([, items]) => items);
  }

  const timeStr = (m: number | null) =>
    m === null ? null : `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

  return {
    content: JSON.stringify({
      count: hits.length,
      // 못 찾았을 때 AI가 "없다"고 단정해도 되게 명시한다.
      note: hits.length ? undefined : "조건에 맞는 일정이 없습니다.",
      schedules: hits.slice(0, 30).map((it) => ({
        id: it.nodeId,
        title: it.title,
        date: it.date,
        time: timeStr(it.startMin),
        recurring: it.isRecurring || undefined,
      })),
    }),
  };
}

/** 일정 하나의 전체 내용 — 수정 전에 현재 값을 확인할 때 */
function getSchedule(data: ToolData, args: Record<string, any>): ExecResult {
  const node = data.nodes.find((n) => n.id === args.id);
  if (!node) {
    return {
      content: JSON.stringify({
        error: `id "${args.id}" 인 일정이 없습니다. search_schedules로 먼저 찾으세요.`,
      }),
    };
  }

  const capture = node.capturedInputId
    ? data.captures.find((c) => c.id === node.capturedInputId)
    : null;

  return {
    content: JSON.stringify({
      id: node.id,
      title: node.title,
      // 빈 문자열이면 키를 빼지 말고 ""로 남긴다 —
      // 키가 없으면 AI가 "설명 필드가 없는 일정"으로 오해한다.
      description: node.description ?? "",
      status: node.status,
      date: node.schedule ? dateStr(node.schedule.startAt) : null,
      allDay: node.schedule?.allDay ?? null,
      location: node.schedule?.location ?? null,
      originalInput: capture?.rawText ?? null,
    }),
  };
}

function searchNotes(data: ToolData, args: Record<string, any>): ExecResult {
  const q = String(args.query ?? "").trim();
  if (!q) return { content: JSON.stringify({ error: "query가 비었습니다." }) };

  const topics = data.topics
    .filter(
      (t) =>
        matches(t.label, q) ||
        (t.aliases ?? []).some((a) => matches(a, q)) ||
        (t.notes ?? []).some((n: any) => matches(String(n?.text ?? ""), q))
    )
    .slice(0, 10)
    .map((t) => ({
      id: t.id,
      label: t.label,
      notes: (t.notes ?? []).slice(-5).map((n: any) => String(n?.text ?? "")),
    }));

  return {
    content: JSON.stringify({
      count: topics.length,
      note: topics.length ? undefined : "일치하는 기록이 없습니다.",
      topics,
    }),
  };
}

function searchPeople(data: ToolData, args: Record<string, any>): ExecResult {
  const q = String(args.query ?? "").trim();
  if (!q) return { content: JSON.stringify({ error: "query가 비었습니다." }) };

  const hits = data.people
    .filter((p) => matches(p.name, q) || matches(p.org ?? "", q))
    .slice(0, 10)
    .map((p) => ({
      id: p.id,
      name: p.name,
      org: p.org,
      phone: p.phone ?? null,
      email: p.email ?? null,
    }));

  return {
    content: JSON.stringify({
      count: hits.length,
      note: hits.length ? undefined : "일치하는 인물이 없습니다.",
      people: hits,
    }),
  };
}

/**
 * 등록 절차로 넘긴다.
 *
 * 여기서 노드를 만들지 않는다. 기존 추출 파이프라인(buildPlan → 계획 카드)이
 * 그대로 돌게 원문만 전달한다. 저장 버튼이 곧 확인이다.
 *
 * 중복 확인은 AI가 프롬프트 지시대로 search_schedules를 먼저 부르는 것에
 * 의존하지만, 여기서도 한 번 더 본다 — AI가 건너뛰었을 때의 방어선이다.
 */
function stageNewEntry(
  data: ToolData,
  args: Record<string, any>,
  now: Date
): ExecResult {
  const text = String(args.text ?? "").trim();
  if (!text) {
    return { content: JSON.stringify({ error: "text가 비었습니다." }) };
  }

  // ── 충돌 감지: AI가 search를 불렀든 안 불렀든 여기서 무조건 돈다 ──
  //
  // 프롬프트로 "먼저 확인하라"고 시켜뒀지만, 모델이 안 지키면 그만이다.
  // 프롬프트 준수에 안전장치를 거는 건 안전장치가 아니다.
  // 날짜를 뽑을 수 있으면 그 날짜 칸을 색인에서 직접 들여다본다.
  const index = buildScheduleIndex(data.nodes, now);
  const r = resolveDateExpr(text, now);

  // AI가 제목을 뽑아줬으면 그걸로 정확히 판정한다.
  // 안 줬으면 원문으로 대충 본다 — 포함 관계로 걸리므로 "오늘 당근 모임"에서도
  // "당근 모임"이 잡히긴 한다. 다만 중복/유사 구분이 흐려진다.
  const title = String(args.title ?? "").trim() || text;

  let conflicts: ReturnType<typeof findConflicts> = [];
  if (r) {
    conflicts = findConflicts(index, {
      title,
      date: toDateKey(r.date),
    });
  }

  return {
    content: JSON.stringify({
      status: conflicts.length ? "충돌 있음 — 확인 필요" : "등록 화면으로 넘김",
      message: conflicts.length
        ? "**이미 등록된 일정과 겹칩니다.** 등록 카드를 띄우지 않았습니다. " +
          "아래 충돌 내용을 사용자에게 알리고, 그래도 추가할지 물어보세요. " +
          "사용자가 추가하라고 하면 그때 다시 stage_new_entry를 호출하세요."
        : "등록 카드를 띄웠습니다. 아직 저장되지 않았습니다. " +
          "'등록했습니다'라고 말하지 마세요. 사용자가 저장 버튼을 눌러야 합니다.",
      conflicts: conflicts.length
        ? conflicts.map((c) => ({
            kind: c.kind,
            existing: `${c.item.date} ${c.item.title}`,
            reason: c.reason,
          }))
        : undefined,
    }),
    // 충돌이 있으면 카드를 띄우지 않는다. 사용자가 판단해야 한다.
    staged: conflicts.length ? undefined : { text },
    conflicts: conflicts.length ? conflicts : undefined,
  };
}

/**
 * 수정 제안을 만든다. **적용하지 않는다.**
 *
 * 전/후를 같이 담아서 사용자가 무엇이 바뀌는지 볼 수 있게 한다.
 * "고쳤습니다"라고만 하면 뭐가 바뀌었는지 알 수 없다.
 */
function updateSchedule(
  data: ToolData,
  args: Record<string, any>,
  now: Date
): ExecResult {
  const node = data.nodes.find((n) => n.id === args.id);
  if (!node) {
    return {
      content: JSON.stringify({
        error: `id "${args.id}" 인 일정이 없습니다. search_schedules로 먼저 찾으세요.`,
      }),
    };
  }

  const changes: PendingChange["changes"] = [];
  const push = (field: string, label: string, before: string, after: string) => {
    // 같은 값이면 변경으로 치지 않는다 — 안 바뀐 걸 바뀐 것처럼 보여주면 안 된다.
    if (before.trim() === after.trim()) return;
    changes.push({ field, label, before, after });
  };

  if (typeof args.title === "string" && args.title.trim()) {
    push("title", "제목", node.title, args.title.trim());
  }
  if (typeof args.description === "string") {
    push("description", "설명", node.description ?? "", args.description);
  }
  if (typeof args.location === "string") {
    push(
      "location",
      "장소",
      node.schedule?.location ?? "",
      args.location
    );
  }
  if (typeof args.dateExpr === "string" && args.dateExpr.trim()) {
    const r = resolveDateExpr(args.dateExpr, now);
    if (!r) {
      return {
        content: JSON.stringify({
          error: `날짜 표현을 해석하지 못했습니다: "${args.dateExpr}".`,
        }),
      };
    }
    push(
      "date",
      "날짜",
      node.schedule ? dateStr(node.schedule.startAt) : "",
      dateStr(r.date)
    );
  }

  if (!changes.length) {
    return {
      content: JSON.stringify({
        error:
          "바뀌는 내용이 없습니다. 이미 같은 값이거나 인자를 안 넣었습니다.",
      }),
    };
  }

  return {
    content: JSON.stringify({
      status: "확인 대기",
      message:
        "사용자에게 확인을 요청했습니다. 아직 적용되지 않았습니다. " +
        "적용됐다고 말하지 말고, 확인해 달라고 안내하세요.",
      target: node.title,
      changes: changes.map((c) => ({ [c.label]: `${c.before || "(비어있음)"} → ${c.after}` })),
    }),
    pending: {
      kind: "update_schedule",
      nodeId: node.id,
      targetTitle: node.title,
      changes,
    },
  };
}

function deleteSchedule(data: ToolData, args: Record<string, any>): ExecResult {
  const node = data.nodes.find((n) => n.id === args.id);
  if (!node) {
    return {
      content: JSON.stringify({
        error: `id "${args.id}" 인 일정이 없습니다.`,
      }),
    };
  }

  return {
    content: JSON.stringify({
      status: "확인 대기",
      message:
        "삭제 확인을 요청했습니다. 아직 지워지지 않았습니다. " +
        "지웠다고 말하지 마세요.",
      target: node.title,
    }),
    pending: {
      kind: "delete_schedule",
      nodeId: node.id,
      targetTitle: node.title,
      changes: [],
    },
  };
}

/**
 * 도구 호출 하나를 실행한다.
 *
 * **절대 throw 하지 않는다.** 실패도 모델에게 돌려줄 내용으로 바꾼다.
 * 여기서 던지면 대화 전체가 죽고, 모델은 자기가 뭘 잘못했는지 모른다.
 */
export function executeTool(
  call: ToolCall,
  data: ToolData,
  now: Date = new Date()
): ExecResult {
  const invalid = validateToolCall(call);
  if (invalid) return { content: JSON.stringify({ error: invalid }) };

  const args = parseToolArgs(call.args);

  try {
    switch (call.name) {
      case "search_schedules":
        return searchSchedules(data, args, now);
      case "get_schedule":
        return getSchedule(data, args);
      case "search_notes":
        return searchNotes(data, args);
      case "search_people":
        return searchPeople(data, args);
      case "stage_new_entry":
        return stageNewEntry(data, args, now);
      case "update_schedule":
        return updateSchedule(data, args, now);
      case "delete_schedule":
        return deleteSchedule(data, args);
      default:
        return {
          content: JSON.stringify({ error: `알 수 없는 도구: ${call.name}` }),
        };
    }
  } catch (err: any) {
    console.error("[tool-exec]", call.name, err);
    return {
      content: JSON.stringify({
        error: `도구 실행 중 오류: ${err?.message ?? "unknown"}`,
      }),
    };
  }
}
