// ==========================================
// 서비스 레이어 — 데이터 생성/조작 헬퍼
// ==========================================

import type {
  Node,
  Category,
  NodeType,
  NodeKind,
  CompletionCriteria,
  Person,
  Organization,
  CapturedInput,
} from "@/lib/types";
import { isCriteriaMet } from "@/lib/types";
import { v4 as uuid } from "uuid";

// --- ID 생성 ---
export function generateId(): string {
  return uuid();
}

// --- 기본 우선순위 계산 ---
export function calcPriorityScore(urgency: number, importance: number): number {
  return Math.round(urgency * 0.4 + importance * 0.6);
}

// --- 노드 생성 헬퍼 ---
export function createNode(partial: Partial<Node> & { title: string; workspaceId: string; type: NodeType }): Node {
  const now = new Date();
  const urgency = partial.priority?.urgency ?? 3;
  const importance = partial.priority?.importance ?? 3;
  return {
    id: partial.id ?? generateId(),
    workspaceId: partial.workspaceId,
    parentId: partial.parentId ?? null,
    childrenIds: partial.childrenIds ?? [],
    projectId: partial.projectId ?? "unsorted",
    type: partial.type,
    title: partial.title,
    description: partial.description ?? "",
    status: partial.status ?? "scheduled",
    priority: {
      urgency,
      importance,
      score: calcPriorityScore(urgency, importance),
    },
    progress: partial.progress ?? 0,
    createdAt: partial.createdAt ?? now,
    updatedAt: now,
    completedAt: partial.completedAt ?? null,
    assignee: partial.assignee ?? null,
    tags: partial.tags ?? [],
    estimatedDuration: partial.estimatedDuration ?? 60,
    actualDuration: partial.actualDuration ?? null,
    schedule: partial.schedule ?? null,
    dependency: partial.dependency ?? { blockedBy: [], blocks: [] },
    aiMeta: partial.aiMeta ?? null,
    // 실행 단위: goal은 기본 project, 나머지는 task
    kind: partial.kind ?? (partial.type === "goal" ? "project" : "task"),
    completion:
      partial.completion ??
      ((partial.kind ?? (partial.type === "goal" ? "project" : "task")) === "task"
        ? { mode: "manual" }
        : null),
    autoCompleteFromChildren: partial.autoCompleteFromChildren ?? true,
    personIds: partial.personIds ?? [],
    orgIds: partial.orgIds ?? [],
    capturedInputId: partial.capturedInputId ?? null,
  };
}

// ==========================================
// 완료 판정 & 상향 전파
// ==========================================

/** 노드가 완료 상태인지 */
export function isNodeComplete(node: Node): boolean {
  return node.status === "completed";
}

/**
 * project 노드의 진행률/완료를 자식 기준으로 재계산한다.
 * 자식이 전부 완료 && autoCompleteFromChildren이면 자신도 완료 처리.
 * 반환값: 이 노드에 적용해야 할 변경사항 (없으면 null)
 */
export function computeRollup(
  node: Node,
  children: Node[]
): Partial<Node> | null {
  // task는 자식 기준 집계 대상이 아님
  if (node.kind === "task") return null;
  if (children.length === 0) return null;

  const completedCount = children.filter(isNodeComplete).length;
  const progress = Math.round(
    children.reduce((sum, c) => sum + (isNodeComplete(c) ? 100 : c.progress), 0) /
      children.length
  );
  const allDone = completedCount === children.length;

  const updates: Partial<Node> = {};
  if (progress !== node.progress) updates.progress = progress;

  if (allDone && node.autoCompleteFromChildren && node.status !== "completed") {
    updates.status = "completed";
    updates.completedAt = new Date();
    updates.progress = 100;
  } else if (!allDone && node.status === "completed") {
    // 자식이 다시 열리면 부모도 진행중으로 되돌림
    updates.status = "in_progress";
    updates.completedAt = null;
  } else if (!allDone && completedCount > 0 && node.status === "scheduled") {
    updates.status = "in_progress";
  }

  return Object.keys(updates).length > 0 ? updates : null;
}

/** task 노드를 완료 조건에 따라 완료 처리할 수 있는지 */
export function canCompleteTask(node: Node): boolean {
  if (node.kind !== "task") return false;
  return isCriteriaMet(node.completion);
}

// ==========================================
// 인물 / 조직 / 원본입력 생성 헬퍼
// ==========================================

export function createPerson(
  partial: Partial<Person> & { name: string; workspaceId: string }
): Person {
  const now = new Date();
  return {
    id: partial.id ?? generateId(),
    workspaceId: partial.workspaceId,
    name: partial.name,
    org: partial.org ?? null,
    orgId: partial.orgId ?? null,
    role: partial.role ?? null,
    phone: partial.phone ?? null,
    email: partial.email ?? null,
    note: partial.note ?? "",
    tags: partial.tags ?? [],
    relatedNodeIds: partial.relatedNodeIds ?? [],
    sourceInputIds: partial.sourceInputIds ?? [],
    createdAt: partial.createdAt ?? now,
    updatedAt: now,
  };
}

export function createOrganization(
  partial: Partial<Organization> & { name: string; workspaceId: string }
): Organization {
  const now = new Date();
  return {
    id: partial.id ?? generateId(),
    workspaceId: partial.workspaceId,
    name: partial.name,
    orgType: partial.orgType ?? null,
    note: partial.note ?? "",
    memberIds: partial.memberIds ?? [],
    relatedNodeIds: partial.relatedNodeIds ?? [],
    sourceInputIds: partial.sourceInputIds ?? [],
    createdAt: partial.createdAt ?? now,
    updatedAt: now,
  };
}

export function createCapturedInput(
  partial: Partial<CapturedInput> & { rawText: string; workspaceId: string }
): CapturedInput {
  return {
    id: partial.id ?? generateId(),
    workspaceId: partial.workspaceId,
    rawText: partial.rawText,
    channel: partial.channel ?? "text",
    extraction: partial.extraction ?? null,
    appliedNodeIds: partial.appliedNodeIds ?? [],
    appliedPersonIds: partial.appliedPersonIds ?? [],
    appliedOrgIds: partial.appliedOrgIds ?? [],
    createdAt: partial.createdAt ?? new Date(),
  };
}

// --- 카테고리 생성 ---
export function createCategory(partial: Partial<Category> & { label: string; workspaceId: string }): Category {
  return {
    id: partial.id ?? generateId(),
    workspaceId: partial.workspaceId,
    label: partial.label,
    color: partial.color ?? "#10b981",
    darkColor: partial.darkColor ?? "#34d399",
    order: partial.order ?? 0,
  };
}

const WORKSPACE_ID = "demo-workspace";

/** 신규 유저용 기본 카테고리 */
export function generateDefaultCategories(): Category[] {
  return [
    createCategory({ id: "cat-meeting", workspaceId: WORKSPACE_ID, label: "회의", color: "#f59e0b", darkColor: "#fbbf24", order: 0 }),
    createCategory({ id: "cat-personal", workspaceId: WORKSPACE_ID, label: "개인", color: "#10b981", darkColor: "#34d399", order: 1 }),
    createCategory({ id: "cat-work", workspaceId: WORKSPACE_ID, label: "업무", color: "#6366f1", darkColor: "#818cf8", order: 2 }),
    createCategory({ id: "cat-health", workspaceId: WORKSPACE_ID, label: "건강", color: "#ef4444", darkColor: "#f87171", order: 3 }),
    createCategory({ id: "cat-study", workspaceId: WORKSPACE_ID, label: "학습", color: "#8b5cf6", darkColor: "#a78bfa", order: 4 }),
    createCategory({ id: "cat-travel", workspaceId: WORKSPACE_ID, label: "여행", color: "#06b6d4", darkColor: "#22d3ee", order: 5 }),
  ];
}

// --- 시간 포맷 ---
export function formatTime(date: Date): string {
  const h = date.getHours();
  const m = date.getMinutes();
  const ampm = h >= 12 ? "오후" : "오전";
  const h12 = h % 12 || 12;
  return `${ampm} ${h12}:${m.toString().padStart(2, "0")}`;
}

// --- 날짜가 같은지 ---
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// --- 분→시간 문자열 ---
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}분`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
}