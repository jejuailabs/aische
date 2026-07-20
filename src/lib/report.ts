// ==========================================
// 프로젝트 리포트 — 사실 집계
// ==========================================
//
// 설계 원칙: **숫자는 코드가 계산하고, 해석만 AI가 한다.**
//
// AI에게 원본을 통째로 던지고 "분석해줘" 하면 진행률이나 날짜를 지어낸다.
// 그래서 여기서 검증 가능한 사실(ProjectDossier)을 먼저 만들고,
// AI에게는 "이 숫자를 해석해서 서술하라"만 시킨다.
//
// 타입만 import하므로 단독 실행 테스트가 가능하다.

import type {
  Node,
  Person,
  Organization,
  LogEntry,
  Topic,
  ProjectSummary,
} from "./types";

const DAY_MS = 86400000;

export interface DossierTask {
  id: string;
  title: string;
  status: string;
  kind: string;
  progress: number;
  /** 마감 대비 상태 */
  overdue: boolean;
  dueAt: string | null;
  completedAt: string | null;
  /** 결과물이 필요한데 아직 없는 task */
  missingDeliverable: boolean;
  blockedBy: string[];
}

export interface ActivityBucket {
  /** YYYY-MM 또는 YYYY-WW */
  period: string;
  created: number;
  completed: number;
  updated: number;
}

export interface ProjectDossier {
  project: {
    id: string;
    title: string;
    description: string;
    progress: number;
    status: string;
  };
  counts: {
    total: number;
    completed: number;
    inProgress: number;
    notStarted: number;
    overdue: number;
    blocked: number;
    missingDeliverable: number;
  };
  timeline: {
    startedAt: string | null;
    firstActivityAt: string | null;
    lastActivityAt: string | null;
    /** 마지막 활동 이후 며칠 지났는지 */
    daysSinceLastActivity: number | null;
    /** 예정된 가장 이른/늦은 일정 */
    nextEventAt: string | null;
    lastEventAt: string | null;
  };
  tasks: DossierTask[];
  /** 월별 활동량 — 정체 구간을 보여주기 위한 것 */
  activity: ActivityBucket[];
  people: { name: string; role: string | null; org: string | null }[];
  orgs: { name: string; orgType: string | null }[];
  /** 이 프로젝트가 주제에서 승격됐다면 그때 모아둔 메모 */
  origin: { topicLabel: string; notes: string[] } | null;
}

// ─────────────────────────────────────────

function iso(d: Date | null | undefined): string | null {
  if (!d || isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function isDone(n: Node): boolean {
  return n.status === "completed";
}

/** 마감이 지났는데 완료되지 않은 항목 */
function isOverdue(n: Node, now: Date): boolean {
  if (isDone(n) || n.status === "cancelled") return false;
  const due = n.schedule?.dueAt ?? null;
  if (!due || isNaN(due.getTime())) return false;
  return due.getTime() < now.getTime();
}

/** 결과물 등록이 필요한데 비어 있는 task */
function isMissingDeliverable(n: Node): boolean {
  if (n.kind !== "task" || isDone(n)) return false;
  const c = n.completion;
  return !!c && c.mode === "deliverable" && !c.deliverableRef;
}

/**
 * 프로젝트 하나에 대한 사실 집계.
 * 여기서 나온 숫자만 리포트에 실린다.
 */
export function buildDossier(input: {
  project: ProjectSummary;
  /** 이 프로젝트에 속한 노드 전체 (루트 포함) */
  nodes: Node[];
  logs: LogEntry[];
  people: Person[];
  orgs: Organization[];
  topic: Topic | null;
  now?: Date;
}): ProjectDossier {
  const now = input.now ?? new Date();
  const nodes = input.nodes;
  const rootNode = nodes.find((n) => n.id === input.project.id) ?? null;

  // 루트(프로젝트 자신)는 통계에서 뺀다 — 자기 자신을 항목으로 세면 왜곡된다
  const items = nodes.filter((n) => n.id !== input.project.id);

  const tasks: DossierTask[] = items.map((n) => ({
    id: n.id,
    title: n.title,
    status: n.status,
    kind: n.kind,
    progress: n.progress,
    overdue: isOverdue(n, now),
    dueAt: iso(n.schedule?.dueAt ?? null),
    completedAt: iso(n.completedAt),
    missingDeliverable: isMissingDeliverable(n),
    blockedBy: n.dependency?.blockedBy ?? [],
  }));

  const counts = {
    total: items.length,
    completed: items.filter(isDone).length,
    inProgress: items.filter((n) => n.status === "in_progress").length,
    notStarted: items.filter((n) => n.status === "scheduled").length,
    overdue: tasks.filter((t) => t.overdue).length,
    blocked: tasks.filter((t) => t.blockedBy.length > 0).length,
    missingDeliverable: tasks.filter((t) => t.missingDeliverable).length,
  };

  // ── 타임라인 ──
  const logTimes = input.logs
    .map((l) => l.timestamp)
    .filter((d) => d && !isNaN(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());

  const eventDates = items
    .map((n) => n.schedule?.startAt)
    .filter((d): d is Date => !!d && !isNaN(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());

  const lastActivity = logTimes.length ? logTimes[logTimes.length - 1] : null;
  const future = eventDates.filter((d) => d.getTime() >= now.getTime());

  const timeline = {
    startedAt: iso(rootNode?.createdAt ?? null),
    firstActivityAt: iso(logTimes[0] ?? null),
    lastActivityAt: iso(lastActivity),
    daysSinceLastActivity: lastActivity
      ? Math.floor((now.getTime() - lastActivity.getTime()) / DAY_MS)
      : null,
    nextEventAt: iso(future[0] ?? null),
    lastEventAt: iso(eventDates[eventDates.length - 1] ?? null),
  };

  // ── 월별 활동량 (정체 구간 파악용) ──
  const buckets = new Map<string, ActivityBucket>();
  const bump = (d: Date, key: keyof Omit<ActivityBucket, "period">) => {
    if (!d || isNaN(d.getTime())) return;
    const k = monthKey(d);
    const b = buckets.get(k) ?? { period: k, created: 0, completed: 0, updated: 0 };
    b[key] += 1;
    buckets.set(k, b);
  };
  for (const l of input.logs) {
    if (l.action === "create") bump(l.timestamp, "created");
    else if (l.action === "complete") bump(l.timestamp, "completed");
    else bump(l.timestamp, "updated");
  }
  const activity = Array.from(buckets.values()).sort((a, b) =>
    a.period.localeCompare(b.period)
  );

  // ── 관계자 ──
  const personIds = new Set(items.flatMap((n) => n.personIds ?? []));
  const orgIds = new Set(items.flatMap((n) => n.orgIds ?? []));
  const people = input.people
    .filter((p) => personIds.has(p.id))
    .map((p) => ({ name: p.name, role: p.role, org: p.org }));
  const orgs = input.orgs
    .filter((o) => orgIds.has(o.id))
    .map((o) => ({ name: o.name, orgType: o.orgType }));

  return {
    project: {
      id: input.project.id,
      title: input.project.title,
      description: rootNode?.description ?? "",
      progress: input.project.progress,
      status: rootNode?.status ?? "scheduled",
    },
    counts,
    timeline,
    tasks,
    activity,
    people,
    orgs,
    origin: input.topic
      ? {
          topicLabel: input.topic.label,
          notes: input.topic.notes.map((n) => n.text),
        }
      : null,
  };
}

// ─────────────────────────────────────────
// 코드로 판정 가능한 신호 — AI가 지어내지 않게 미리 뽑아 둔다
// ─────────────────────────────────────────

export interface ProjectSignal {
  kind: "stalled" | "overdue" | "blocked" | "deliverable" | "pace" | "healthy";
  severity: "info" | "warn" | "risk";
  message: string;
}

export function detectSignals(d: ProjectDossier): ProjectSignal[] {
  const out: ProjectSignal[] = [];

  // 정체 — 마지막 활동 이후 오래 지남
  const idle = d.timeline.daysSinceLastActivity;
  if (idle != null && idle >= 30) {
    out.push({
      kind: "stalled",
      severity: "risk",
      message: `마지막 활동 이후 ${idle}일 경과`,
    });
  } else if (idle != null && idle >= 14) {
    out.push({
      kind: "stalled",
      severity: "warn",
      message: `마지막 활동 이후 ${idle}일 경과`,
    });
  }

  if (d.counts.overdue > 0) {
    out.push({
      kind: "overdue",
      severity: d.counts.overdue >= 3 ? "risk" : "warn",
      message: `마감이 지난 항목 ${d.counts.overdue}건`,
    });
  }

  if (d.counts.blocked > 0) {
    out.push({
      kind: "blocked",
      severity: "warn",
      message: `선행 작업에 막힌 항목 ${d.counts.blocked}건`,
    });
  }

  if (d.counts.missingDeliverable > 0) {
    out.push({
      kind: "deliverable",
      severity: "info",
      message: `결과물 등록이 필요한 항목 ${d.counts.missingDeliverable}건`,
    });
  }

  // 속도 — 최근 2개월 완료가 그 이전보다 뚜렷이 줄었는지
  if (d.activity.length >= 3) {
    const recent = d.activity.slice(-2).reduce((s, b) => s + b.completed, 0);
    const before = d.activity.slice(0, -2);
    const avgBefore =
      before.reduce((s, b) => s + b.completed, 0) / Math.max(1, before.length);
    if (avgBefore >= 1 && recent === 0) {
      out.push({
        kind: "pace",
        severity: "warn",
        message: "최근 2개월간 완료된 항목 없음",
      });
    }
  }

  if (out.length === 0 && d.counts.total > 0) {
    out.push({
      kind: "healthy",
      severity: "info",
      message: "지연·차단 항목 없음",
    });
  }

  return out;
}

/** 진행률을 코드로 재계산 — 저장된 값과 어긋나면 실제 값을 쓴다 */
export function actualProgress(d: ProjectDossier): number {
  if (d.counts.total === 0) return 0;
  return Math.round((d.counts.completed / d.counts.total) * 100);
}
