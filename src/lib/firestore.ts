// ==========================================
// Firestore CRUD — Node / Category / Project / Log
// ==========================================
//
// 컬렉션 구조:
//   users/{uid}                   — UserProfile (preferences 포함)
//   users/{uid}/nodes/{nodeId}    — Node
//   users/{uid}/categories/{id}   — Category
//   users/{uid}/projects/{id}     — ProjectSummary
//   users/{uid}/logs/{id}         — LogEntry
//
// Date 필드는 Firestore Timestamp로 자동 변환됩니다.
// 읽을 때 Timestamp → Date 변환을 수동으로 해줘야 합니다.

import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  writeBatch,
  Timestamp,
  serverTimestamp,
  query,
  orderBy,
  limit as fsLimit,
  type DocumentData,
} from "firebase/firestore";
import { getClientDb } from "./firebase";
import type {
  Node,
  Category,
  ProjectSummary,
  LogEntry,
  UserProfile,
  ScheduleInfo,
  Reminder,
} from "./types";

// ─── helpers ────────────────────────────────────────

/** Firestore Timestamp → Date (null-safe) */
function toDate(v: unknown): Date {
  if (v instanceof Timestamp) return v.toDate();
  if (v instanceof Date) return v;
  if (typeof v === "string" || typeof v === "number") return new Date(v);
  return new Date();
}

/** Date → Firestore-safe plain object (Timestamp 등 직렬화) */
function dateToTs(d: Date | null | undefined): Timestamp | null {
  if (!d) return null;
  return Timestamp.fromDate(d instanceof Date ? d : new Date(d));
}

// ─── Node 변환 ───────────────────────────────────────

function nodeToFirestore(node: Node): DocumentData {
  const { schedule, ...rest } = node;
  const base: Record<string, unknown> = {
    ...rest,
    createdAt: dateToTs(node.createdAt),
    updatedAt: dateToTs(node.updatedAt),
    completedAt: dateToTs(node.completedAt),
  };

  if (schedule) {
    base.schedule = {
      ...schedule,
      startAt: dateToTs(schedule.startAt),
      endAt: dateToTs(schedule.endAt),
      dueAt: dateToTs(schedule.dueAt),
      reminders: schedule.reminders ?? [],
    };
  } else {
    base.schedule = null;
  }

  return base;
}

function firestoreToNode(data: DocumentData): Node {
  const schedule = data.schedule
    ? ({
        ...data.schedule,
        startAt: toDate(data.schedule.startAt),
        endAt: toDate(data.schedule.endAt),
        dueAt: data.schedule.dueAt ? toDate(data.schedule.dueAt) : null,
        reminders: data.schedule.reminders ?? [],
      } as ScheduleInfo)
    : null;

  return {
    id: data.id,
    workspaceId: data.workspaceId ?? "",
    parentId: data.parentId ?? null,
    childrenIds: data.childrenIds ?? [],
    projectId: data.projectId ?? "unsorted",
    type: data.type,
    title: data.title ?? "",
    description: data.description ?? "",
    status: data.status ?? "scheduled",
    priority: data.priority ?? { urgency: 3, importance: 3, score: 3 },
    progress: data.progress ?? 0,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
    completedAt: data.completedAt ? toDate(data.completedAt) : null,
    assignee: data.assignee ?? null,
    tags: data.tags ?? [],
    estimatedDuration: data.estimatedDuration ?? 60,
    actualDuration: data.actualDuration ?? null,
    schedule,
    dependency: data.dependency ?? { blockedBy: [], blocks: [] },
    aiMeta: data.aiMeta ?? null,
  };
}

// ─── LogEntry 변환 ───────────────────────────────────

function logToFirestore(log: LogEntry): DocumentData {
  return {
    ...log,
    timestamp: dateToTs(log.timestamp),
  };
}

function firestoreToLog(data: DocumentData): LogEntry {
  return {
    id: data.id,
    nodeId: data.nodeId ?? "",
    workspaceId: data.workspaceId ?? "",
    action: data.action ?? "update",
    before: data.before ?? null,
    after: data.after ?? null,
    actor: data.actor ?? "",
    timestamp: toDate(data.timestamp),
  };
}

// ─── ProjectSummary 변환 ─────────────────────────────

function projectToFirestore(p: ProjectSummary): DocumentData {
  return {
    ...p,
    updatedAt: dateToTs(p.updatedAt),
  };
}

function firestoreToProject(data: DocumentData): ProjectSummary {
  return {
    id: data.id,
    title: data.title ?? "",
    progress: data.progress ?? 0,
    memberCount: data.memberCount ?? 1,
    updatedAt: toDate(data.updatedAt),
  };
}

// ─── UserProfile 변환 ────────────────────────────────

function profileToFirestore(p: UserProfile): DocumentData {
  return {
    ...p,
    createdAt: dateToTs(p.createdAt),
  };
}

function firestoreToProfile(data: DocumentData): UserProfile {
  return {
    uid: data.uid,
    displayName: data.displayName ?? "",
    email: data.email ?? "",
    photoURL: data.photoURL ?? null,
    role: data.role ?? "user",
    preferences: data.preferences ?? {
      theme: "light",
      language: "ko",
      homeMode: "dashboard",
      avatarAssetRef: "",
      backgroundAssetRef: "",
      pcWorkspaceLayout: [],
    },
    createdAt: toDate(data.createdAt),
  };
}

// ═══════════════════════════════════════════════════════
// API: UserProfile
// ═══════════════════════════════════════════════════════

const usersCol = () => collection(getClientDb(), "users");
const userDoc = (uid: string) => doc(getClientDb(), "users", uid);

export async function getOrCreateUser(
  uid: string,
  defaults: UserProfile
): Promise<UserProfile> {
  const snap = await getDoc(userDoc(uid));
  if (snap.exists()) return firestoreToProfile(snap.data());
  await setDoc(userDoc(uid), profileToFirestore(defaults));
  return defaults;
}

export async function updateUserProfile(
  uid: string,
  updates: Partial<UserProfile>
): Promise<void> {
  await updateDoc(userDoc(uid), updates as DocumentData);
}

// ═══════════════════════════════════════════════════════
// API: Nodes
// ═══════════════════════════════════════════════════════

const nodesCol = (uid: string) => collection(getClientDb(), "users", uid, "nodes");
const nodeDoc = (uid: string, id: string) =>
  doc(getClientDb(), "users", uid, "nodes", id);

export async function fetchAllNodes(uid: string): Promise<Node[]> {
  const snap = await getDocs(nodesCol(uid));
  return snap.docs.map((d) => firestoreToNode({ id: d.id, ...d.data() }));
}

export async function saveNode(uid: string, node: Node): Promise<void> {
  await setDoc(nodeDoc(uid, node.id), nodeToFirestore(node));
}

export async function updateNodeFields(
  uid: string,
  nodeId: string,
  updates: Partial<Node>
): Promise<void> {
  // Schedule 필드가 있으면 Date→Timestamp 변환
  const mapped: Record<string, unknown> = { ...updates, updatedAt: dateToTs(new Date()) };
  if (updates.schedule) {
    mapped.schedule = {
      ...updates.schedule,
      startAt: dateToTs(updates.schedule.startAt),
      endAt: dateToTs(updates.schedule.endAt),
      dueAt: dateToTs(updates.schedule.dueAt ?? null),
    };
  }
  if (updates.completedAt !== undefined) {
    mapped.completedAt = dateToTs(updates.completedAt ?? null);
  }
  await updateDoc(nodeDoc(uid, nodeId), mapped as DocumentData);
}

export async function deleteNode(uid: string, nodeId: string): Promise<void> {
  await deleteDoc(nodeDoc(uid, nodeId));
}

/** 여러 노드를 한번에 저장 (초기 시드 용) */
export async function saveAllNodes(uid: string, nodes: Node[]): Promise<void> {
  // Firestore batch 는 500개 제한이므로 청크 분할
  const CHUNK = 450;
  for (let i = 0; i < nodes.length; i += CHUNK) {
    const batch = writeBatch(getClientDb());
    const chunk = nodes.slice(i, i + CHUNK);
    for (const node of chunk) {
      batch.set(nodeDoc(uid, node.id), nodeToFirestore(node));
    }
    await batch.commit();
  }
}

// ═══════════════════════════════════════════════════════
// API: Categories
// ═══════════════════════════════════════════════════════

const catsCol = (uid: string) => collection(getClientDb(), "users", uid, "categories");
const catDoc = (uid: string, id: string) =>
  doc(getClientDb(), "users", uid, "categories", id);

export async function fetchAllCategories(uid: string): Promise<Category[]> {
  const snap = await getDocs(catsCol(uid));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Category);
}

export async function saveCategory(uid: string, cat: Category): Promise<void> {
  await setDoc(catDoc(uid, cat.id), { ...cat });
}

export async function deleteCategory(uid: string, id: string): Promise<void> {
  await deleteDoc(catDoc(uid, id));
}

export async function saveAllCategories(
  uid: string,
  cats: Category[]
): Promise<void> {
  const batch = writeBatch(getClientDb());
  for (const cat of cats) {
    batch.set(catDoc(uid, cat.id), { ...cat });
  }
  await batch.commit();
}

// ═══════════════════════════════════════════════════════
// API: Projects
// ═══════════════════════════════════════════════════════

const projsCol = (uid: string) => collection(getClientDb(), "users", uid, "projects");
const projDoc = (uid: string, id: string) =>
  doc(getClientDb(), "users", uid, "projects", id);

export async function fetchAllProjects(uid: string): Promise<ProjectSummary[]> {
  const snap = await getDocs(projsCol(uid));
  return snap.docs.map((d) =>
    firestoreToProject({ id: d.id, ...d.data() })
  );
}

export async function saveProject(
  uid: string,
  p: ProjectSummary
): Promise<void> {
  await setDoc(projDoc(uid, p.id), projectToFirestore(p));
}

export async function deleteProject(uid: string, id: string): Promise<void> {
  await deleteDoc(projDoc(uid, id));
}

export async function saveAllProjects(
  uid: string,
  projects: ProjectSummary[]
): Promise<void> {
  const batch = writeBatch(getClientDb());
  for (const p of projects) {
    batch.set(projDoc(uid, p.id), projectToFirestore(p));
  }
  await batch.commit();
}

// ═══════════════════════════════════════════════════════
// API: Logs
// ═══════════════════════════════════════════════════════

const logsCol = (uid: string) => collection(getClientDb(), "users", uid, "logs");
const logDoc = (uid: string, id: string) =>
  doc(getClientDb(), "users", uid, "logs", id);

export async function fetchRecentLogs(
  uid: string,
  count = 100
): Promise<LogEntry[]> {
  const q = query(logsCol(uid), orderBy("timestamp", "desc"), fsLimit(count));
  const snap = await getDocs(q);
  return snap.docs.map((d) => firestoreToLog({ id: d.id, ...d.data() }));
}

export async function saveLog(uid: string, log: LogEntry): Promise<void> {
  await setDoc(logDoc(uid, log.id), logToFirestore(log));
}

export async function saveAllLogs(
  uid: string,
  logs: LogEntry[]
): Promise<void> {
  const batch = writeBatch(getClientDb());
  for (const log of logs) {
    batch.set(logDoc(uid, log.id), logToFirestore(log));
  }
  await batch.commit();
}
