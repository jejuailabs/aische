// ==========================================
// 인입 파이프라인 — 입력 1건 → 정보 층 분해 → 저장
// ==========================================
//
//   사용자 입력
//        │
//        ▼
//   /api/ai/parse  ── AI가 층으로 분해
//        │
//        ▼
//   ExtractionResult
//        │
//   ┌────┼──────────┬────────────┬──────────┐
//   ▼    ▼          ▼            ▼          ▼
// 일정  인물      조직        프로젝트    실행항목
// (캘린더) (명함)  (단체)      (매칭/신규)  (task/project)
//        │
//        └─ 원본 입력(CapturedInput)은 통째로 보존 → 향후 재분석 소스
//
// 이 모듈은 "무엇을 어디에 저장할지"를 계획(plan)으로 먼저 만들고,
// 사용자가 Confirm하면 실제로 적용(apply)한다. Draft→Confirm 원칙 (core.md §2-3)

import type {
  ExtractionResult,
  ExtractedPerson,
  ExtractedOrg,
  Node,
  Person,
  Organization,
  CapturedInput,
  ProjectSummary,
  ScheduleInfo,
  NodeType,
  InputChannel,
} from "@/lib/types";
import {
  createNode,
  createPerson,
  createOrganization,
  createCapturedInput,
  generateId,
} from "@/lib/services";

const WS = "demo-workspace";

// ─────────────────────────────────────────
// 저장 계획 (Draft에 그대로 표시됨)
// ─────────────────────────────────────────

export type PlanLayer =
  | "schedule"
  | "person"
  | "organization"
  | "project"
  | "task"
  | "note";

export interface PlanItem {
  layer: PlanLayer;
  /** 화면에 보여줄 한 줄 */
  label: string;
  /** 부연 설명 (날짜, 소속, 신뢰도 등) */
  detail: string | null;
  /** 신규 생성인지 기존에 연결인지 */
  action: "create" | "link" | "merge";
  /** 사용자가 이 항목만 끌 수 있게 */
  enabled: boolean;
}

export interface IngestPlan {
  summary: string;
  intent: string;
  items: PlanItem[];
  raw: ExtractionResult;
}

// ─────────────────────────────────────────
// 1) 추출 결과 → 저장 계획
// ─────────────────────────────────────────

export function buildPlan(
  ex: ExtractionResult,
  ctx: {
    projects: ProjectSummary[];
    findPerson: (name: string, org?: string | null) => Person | undefined;
    findOrg: (name: string) => Organization | undefined;
  }
): IngestPlan {
  const items: PlanItem[] = [];

  // --- 일정 층 ---
  if (ex.schedule) {
    const s = ex.schedule;
    const when = s.startAt
      ? formatWhen(s.startAt, s.endAt, s.allDay)
      : "날짜 미정";
    items.push({
      layer: "schedule",
      label: s.title || ex.summary,
      detail: [when, s.location].filter(Boolean).join(" · "),
      action: "create",
      enabled: true,
    });
  }

  // --- 인물 층 ---
  for (const p of ex.people) {
    const existing = ctx.findPerson(p.name, p.org);
    const detailParts = [p.role, p.org, p.phone, p.email].filter(Boolean);
    items.push({
      layer: "person",
      label: p.name,
      detail: detailParts.length ? detailParts.join(" · ") : null,
      action: existing ? "link" : "create",
      enabled: true,
    });
  }

  // --- 조직 층 ---
  for (const o of ex.organizations) {
    const existing = ctx.findOrg(o.name);
    items.push({
      layer: "organization",
      label: o.name,
      detail: o.orgType,
      action: existing ? "link" : "create",
      enabled: true,
    });
  }

  // --- 프로젝트 층 ---
  if (ex.project) {
    const pr = ex.project;
    if (pr.matchedProjectId) {
      const proj = ctx.projects.find((p) => p.id === pr.matchedProjectId);
      if (proj) {
        items.push({
          layer: "project",
          label: proj.title,
          detail: `기존 프로젝트에 배치 · 신뢰도 ${pr.matchConfidence}%`,
          action: "merge",
          enabled: true,
        });
      }
    } else if (pr.newProjectSuggestion) {
      items.push({
        layer: "project",
        label: pr.newProjectSuggestion,
        detail: "새 프로젝트로 생성 제안",
        action: "create",
        // 신규 프로젝트 생성은 기본 OFF — 사용자가 명시적으로 켜야 함
        enabled: false,
      });
    }
  }

  // --- 실행 항목 층 ---
  for (const tk of ex.tasks) {
    items.push({
      layer: "task",
      label: tk.title,
      detail: [
        tk.kind === "project" ? "하위 프로젝트" : "단일 실행",
        tk.dueAt ? formatDate(tk.dueAt) : null,
        completionLabel(tk.completionMode),
      ]
        .filter(Boolean)
        .join(" · "),
      action: "create",
      enabled: true,
    });
  }

  // --- 잔여 메모 ---
  for (const n of ex.notes) {
    items.push({
      layer: "note",
      label: n,
      detail: null,
      action: "create",
      enabled: true,
    });
  }

  return {
    summary: ex.summary,
    intent: ex.intent,
    items,
    raw: ex,
  };
}

// ─────────────────────────────────────────
// 2) 계획 실행 — 실제 저장
// ─────────────────────────────────────────

export interface ApplyDeps {
  addNode: (n: Node) => void;
  addPerson: (p: Person) => void;
  updatePerson: (id: string, u: Partial<Person>) => void;
  addOrg: (o: Organization) => void;
  updateOrg: (id: string, u: Partial<Organization>) => void;
  addProject: (p: ProjectSummary) => void;
  addCapture: (c: CapturedInput) => void;
  updateCapture: (id: string, u: Partial<CapturedInput>) => void;
  findPerson: (name: string, org?: string | null) => Person | undefined;
  findOrg: (name: string) => Organization | undefined;
  getPersonById: (id: string) => Person | undefined;
  getOrgById: (id: string) => Organization | undefined;
}

export interface ApplyResult {
  capturedInputId: string;
  nodeIds: string[];
  personIds: string[];
  orgIds: string[];
  projectId: string | null;
}

export function applyPlan(
  plan: IngestPlan,
  rawText: string,
  channel: InputChannel,
  deps: ApplyDeps
): ApplyResult {
  const ex = plan.raw;
  const enabled = (layer: PlanLayer, label: string) =>
    plan.items.some(
      (i) => i.layer === layer && i.label === label && i.enabled
    );

  // --- 0) 원본 입력을 먼저 기록 (모든 산출물이 이걸 참조) ---
  const capture = createCapturedInput({
    workspaceId: WS,
    rawText,
    channel,
    extraction: ex,
  });
  deps.addCapture(capture);

  const nodeIds: string[] = [];
  const personIds: string[] = [];
  const orgIds: string[] = [];

  // --- 1) 조직 먼저 (인물이 조직을 참조하므로) ---
  const orgIdByName = new Map<string, string>();
  for (const o of ex.organizations) {
    if (!enabled("organization", o.name)) continue;
    const existing = deps.findOrg(o.name);
    if (existing) {
      orgIdByName.set(o.name, existing.id);
      orgIds.push(existing.id);
      deps.updateOrg(existing.id, {
        sourceInputIds: [...existing.sourceInputIds, capture.id],
      });
    } else {
      const org = createOrganization({
        workspaceId: WS,
        name: o.name,
        orgType: o.orgType,
        sourceInputIds: [capture.id],
      });
      deps.addOrg(org);
      orgIdByName.set(o.name, org.id);
      orgIds.push(org.id);
    }
  }

  // --- 2) 인물 ---
  for (const p of ex.people) {
    if (!enabled("person", p.name)) continue;
    const existing = deps.findPerson(p.name, p.org);
    const linkedOrgId = p.org ? orgIdByName.get(p.org) ?? null : null;

    if (existing) {
      personIds.push(existing.id);
      // 기존 인물에 비어있던 정보만 채워넣기 (덮어쓰기 금지)
      deps.updatePerson(existing.id, {
        role: existing.role ?? p.role,
        org: existing.org ?? p.org,
        orgId: existing.orgId ?? linkedOrgId,
        phone: existing.phone ?? p.phone,
        email: existing.email ?? p.email,
        sourceInputIds: [...existing.sourceInputIds, capture.id],
      });
    } else {
      const person = createPerson({
        workspaceId: WS,
        name: p.name,
        role: p.role,
        org: p.org,
        orgId: linkedOrgId,
        phone: p.phone,
        email: p.email,
        sourceInputIds: [capture.id],
      });
      deps.addPerson(person);
      personIds.push(person.id);
      // 조직 멤버로 등록
      if (linkedOrgId) {
        const org = deps.findOrg(p.org!);
        if (org) {
          deps.updateOrg(org.id, { memberIds: [...org.memberIds, person.id] });
        }
      }
    }
  }

  // --- 3) 프로젝트 결정 ---
  let targetProjectId: string | null = ex.project?.matchedProjectId ?? null;

  if (
    !targetProjectId &&
    ex.project?.newProjectSuggestion &&
    enabled("project", ex.project.newProjectSuggestion)
  ) {
    // 새 프로젝트 = 루트 goal 노드 + ProjectSummary
    const rootId = generateId();
    const root = createNode({
      id: rootId,
      workspaceId: WS,
      type: "goal",
      kind: "project",
      title: ex.project.newProjectSuggestion,
      projectId: rootId, // 루트 노드가 곧 프로젝트
      parentId: null,
      capturedInputId: capture.id,
      personIds,
      orgIds,
    });
    deps.addNode(root);
    deps.addProject({
      id: rootId,
      title: root.title,
      progress: 0,
      memberCount: 1,
      updatedAt: new Date(),
    });
    nodeIds.push(rootId);
    targetProjectId = rootId;
  }

  const projectId = targetProjectId ?? "unsorted";

  // --- 4) 일정 노드 ---
  if (ex.schedule && enabled("schedule", ex.schedule.title || ex.summary)) {
    const s = ex.schedule;
    const schedule = toScheduleInfo(s);
    const node = createNode({
      workspaceId: WS,
      type: "calendar_event" as NodeType,
      kind: "task",
      completion: { mode: "manual" },
      title: s.title || ex.summary,
      description: "",
      projectId,
      parentId: targetProjectId,
      schedule,
      personIds,
      orgIds,
      capturedInputId: capture.id,
      aiMeta: {
        status: "draft",
        sourceInput: { channel, rawRef: capture.id },
        suggestedProjectId: targetProjectId,
        matchConfidence: ex.project?.matchConfidence ?? null,
        clarificationLog: [],
      },
    });
    deps.addNode(node);
    nodeIds.push(node.id);
  }

  // --- 5) 실행 항목 노드 ---
  for (const tk of ex.tasks) {
    if (!enabled("task", tk.title)) continue;
    const due = tk.dueAt ? new Date(tk.dueAt) : null;
    const node = createNode({
      workspaceId: WS,
      type: tk.kind === "project" ? "goal" : "todo",
      kind: tk.kind,
      completion:
        tk.kind === "task"
          ? tk.completionMode === "deliverable"
            ? { mode: "deliverable", deliverableRef: null, deliverableNote: "" }
            : tk.completionMode === "checklist"
              ? { mode: "checklist", items: [] }
              : { mode: "manual" }
          : null,
      title: tk.title,
      projectId,
      parentId: targetProjectId,
      schedule:
        due && !isNaN(due.getTime())
          ? {
              startAt: due,
              endAt: due,
              dueAt: due,
              allDay: true,
              category: "",
              location: null,
              attendees: [],
              reminders: [],
            }
          : null,
      personIds,
      orgIds,
      capturedInputId: capture.id,
      aiMeta: {
        status: "draft",
        sourceInput: { channel, rawRef: capture.id },
        suggestedProjectId: targetProjectId,
        matchConfidence: ex.project?.matchConfidence ?? null,
        clarificationLog: [],
      },
    });
    deps.addNode(node);
    nodeIds.push(node.id);
  }

  // --- 6) 원본 입력에 산출물 역참조 기록 ---
  deps.updateCapture(capture.id, {
    appliedNodeIds: nodeIds,
    appliedPersonIds: personIds,
    appliedOrgIds: orgIds,
  });

  // --- 7) 인물/조직 → 노드 역참조 (기존 링크에 추가) ---
  for (const pid of personIds) {
    const prev = deps.getPersonById(pid)?.relatedNodeIds ?? [];
    deps.updatePerson(pid, {
      relatedNodeIds: Array.from(new Set([...prev, ...nodeIds])),
    });
  }
  for (const oid of orgIds) {
    const prev = deps.getOrgById(oid)?.relatedNodeIds ?? [];
    deps.updateOrg(oid, {
      relatedNodeIds: Array.from(new Set([...prev, ...nodeIds])),
    });
  }

  return {
    capturedInputId: capture.id,
    nodeIds,
    personIds,
    orgIds,
    projectId: targetProjectId,
  };
}

// ─────────────────────────────────────────
// helpers
// ─────────────────────────────────────────

function toScheduleInfo(s: {
  startAt: string | null;
  endAt: string | null;
  dueAt: string | null;
  allDay: boolean;
  location: string | null;
  categoryId: string | null;
}): ScheduleInfo {
  const start = s.startAt ? new Date(s.startAt) : new Date();
  const end = s.endAt ? new Date(s.endAt) : new Date(start.getTime() + 3600000);
  const due = s.dueAt ? new Date(s.dueAt) : null;
  const safe = (d: Date, fallback: Date) =>
    isNaN(d.getTime()) ? fallback : d;
  const now = new Date();
  return {
    startAt: safe(start, now),
    endAt: safe(end, new Date(now.getTime() + 3600000)),
    dueAt: due && !isNaN(due.getTime()) ? due : null,
    allDay: s.allDay ?? true,
    category: s.categoryId ?? "",
    location: s.location ?? null,
    attendees: [],
    reminders: [],
  };
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatWhen(
  startIso: string,
  endIso: string | null,
  allDay: boolean
): string {
  const s = new Date(startIso);
  if (isNaN(s.getTime())) return startIso;
  const dateStr = `${s.getMonth() + 1}/${s.getDate()}(${["일", "월", "화", "수", "목", "금", "토"][s.getDay()]})`;
  if (allDay) return `${dateStr} 종일`;
  const hh = String(s.getHours()).padStart(2, "0");
  const mm = String(s.getMinutes()).padStart(2, "0");
  let str = `${dateStr} ${hh}:${mm}`;
  if (endIso) {
    const e = new Date(endIso);
    if (!isNaN(e.getTime())) {
      str += `~${String(e.getHours()).padStart(2, "0")}:${String(e.getMinutes()).padStart(2, "0")}`;
    }
  }
  return str;
}

function completionLabel(mode: string): string {
  if (mode === "deliverable") return "결과물 필요";
  if (mode === "checklist") return "체크리스트";
  return "체크 완료";
}

export const LAYER_LABEL: Record<PlanLayer, string> = {
  schedule: "일정",
  person: "인물",
  organization: "조직",
  project: "프로젝트",
  task: "실행",
  note: "메모",
};
