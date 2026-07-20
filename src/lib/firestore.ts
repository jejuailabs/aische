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
  RecurrenceRule,
  Person,
  Organization,
  CapturedInput,
  Topic,
  PaymentMethod,
  FixedCost,
  DiaryEntry,
  RelationshipLog,
} from "./types";

// ─── helpers ────────────────────────────────────────

/** Firestore Timestamp → Date (null-safe) */
function toDate(v: unknown): Date {
  if (v instanceof Timestamp) return v.toDate();
  if (v instanceof Date) return v;
  if (typeof v === "string" || typeof v === "number") return new Date(v);
  return new Date();
}

/** Date → Firestore Timestamp (invalid/null → null) */
function dateToTs(d: Date | null | undefined): Timestamp | null {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return null;
  return Timestamp.fromDate(date);
}

// ─── 반복 규칙 변환 ──────────────────────────────────

function recurrenceToFirestore(r: RecurrenceRule | null): DocumentData | null {
  if (!r) return null;
  return {
    freq: r.freq,
    interval: r.interval ?? 1,
    byWeekday: r.byWeekday ?? [],
    until: dateToTs(r.until),
    count: r.count ?? null,
    exdates: (r.exdates ?? [])
      .map((d) => dateToTs(d))
      .filter((t): t is Timestamp => t !== null),
  };
}

function firestoreToRecurrence(data: unknown): RecurrenceRule | null {
  if (!data || typeof data !== "object") return null;
  const d = data as DocumentData;
  if (!d.freq) return null;
  return {
    freq: d.freq,
    interval: d.interval ?? 1,
    byWeekday: d.byWeekday ?? [],
    until: d.until ? toDate(d.until) : null,
    count: d.count ?? null,
    exdates: Array.isArray(d.exdates) ? d.exdates.map(toDate) : [],
  };
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
      recurrence: recurrenceToFirestore(schedule.recurrence),
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
        // 구 데이터 호환: recurrence 필드가 없으면 1회성 일정
        recurrence: firestoreToRecurrence(data.schedule.recurrence),
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
    // 실행 단위 (구 데이터 호환: 없으면 type으로 추론)
    kind: data.kind ?? (data.type === "goal" ? "project" : "task"),
    completion:
      data.completion ??
      ((data.kind ?? (data.type === "goal" ? "project" : "task")) === "task"
        ? { mode: "manual" }
        : null),
    autoCompleteFromChildren: data.autoCompleteFromChildren ?? true,
    personIds: data.personIds ?? [],
    orgIds: data.orgIds ?? [],
    topicId: data.topicId ?? null,
    capturedInputId: data.capturedInputId ?? null,
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
      reminders: updates.schedule.reminders ?? [],
      recurrence: recurrenceToFirestore(updates.schedule.recurrence ?? null),
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

// ═══════════════════════════════════════════════════════
// API: People (인물 / 명함 레이어)
// ═══════════════════════════════════════════════════════

const peopleCol = (uid: string) =>
  collection(getClientDb(), "users", uid, "people");
const personDoc = (uid: string, id: string) =>
  doc(getClientDb(), "users", uid, "people", id);

function personToFirestore(p: Person): DocumentData {
  return {
    ...p,
    createdAt: dateToTs(p.createdAt),
    updatedAt: dateToTs(p.updatedAt),
  };
}

function firestoreToPerson(data: DocumentData): Person {
  return {
    id: data.id,
    workspaceId: data.workspaceId ?? "",
    name: data.name ?? "",
    org: data.org ?? null,
    orgId: data.orgId ?? null,
    role: data.role ?? null,
    phone: data.phone ?? null,
    email: data.email ?? null,
    note: data.note ?? "",
    tags: data.tags ?? [],
    relatedNodeIds: data.relatedNodeIds ?? [],
    sourceInputIds: data.sourceInputIds ?? [],
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
}

export async function fetchAllPeople(uid: string): Promise<Person[]> {
  const snap = await getDocs(peopleCol(uid));
  return snap.docs.map((d) => firestoreToPerson({ id: d.id, ...d.data() }));
}

export async function savePerson(uid: string, p: Person): Promise<void> {
  await setDoc(personDoc(uid, p.id), personToFirestore(p));
}

export async function updatePersonFields(
  uid: string,
  id: string,
  updates: Partial<Person>
): Promise<void> {
  await updateDoc(personDoc(uid, id), {
    ...updates,
    updatedAt: dateToTs(new Date()),
  } as DocumentData);
}

export async function deletePerson(uid: string, id: string): Promise<void> {
  await deleteDoc(personDoc(uid, id));
}

// ═══════════════════════════════════════════════════════
// API: Organizations (조직 / 단체 레이어)
// ═══════════════════════════════════════════════════════

const orgsCol = (uid: string) =>
  collection(getClientDb(), "users", uid, "organizations");
const orgDoc = (uid: string, id: string) =>
  doc(getClientDb(), "users", uid, "organizations", id);

function orgToFirestore(o: Organization): DocumentData {
  return {
    ...o,
    createdAt: dateToTs(o.createdAt),
    updatedAt: dateToTs(o.updatedAt),
  };
}

function firestoreToOrg(data: DocumentData): Organization {
  return {
    id: data.id,
    workspaceId: data.workspaceId ?? "",
    name: data.name ?? "",
    orgType: data.orgType ?? null,
    note: data.note ?? "",
    memberIds: data.memberIds ?? [],
    relatedNodeIds: data.relatedNodeIds ?? [],
    sourceInputIds: data.sourceInputIds ?? [],
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
}

export async function fetchAllOrganizations(
  uid: string
): Promise<Organization[]> {
  const snap = await getDocs(orgsCol(uid));
  return snap.docs.map((d) => firestoreToOrg({ id: d.id, ...d.data() }));
}

export async function saveOrganization(
  uid: string,
  o: Organization
): Promise<void> {
  await setDoc(orgDoc(uid, o.id), orgToFirestore(o));
}

export async function updateOrganizationFields(
  uid: string,
  id: string,
  updates: Partial<Organization>
): Promise<void> {
  await updateDoc(orgDoc(uid, id), {
    ...updates,
    updatedAt: dateToTs(new Date()),
  } as DocumentData);
}

export async function deleteOrganization(
  uid: string,
  id: string
): Promise<void> {
  await deleteDoc(orgDoc(uid, id));
}

// ═══════════════════════════════════════════════════════
// API: PaymentMethods (결제수단 — 카드번호 전체는 저장 안 함)
// ═══════════════════════════════════════════════════════

const pmCol = (uid: string) =>
  collection(getClientDb(), "users", uid, "paymentMethods");
const pmDoc = (uid: string, id: string) =>
  doc(getClientDb(), "users", uid, "paymentMethods", id);

function pmToFirestore(m: PaymentMethod): DocumentData {
  return {
    ...m,
    // 방어: 혹시라도 4자리 넘게 들어오면 잘라서 저장
    last4: (m.last4 ?? "").replace(/\D/g, "").slice(-4),
    createdAt: dateToTs(m.createdAt),
    updatedAt: dateToTs(m.updatedAt),
  };
}

function firestoreToPm(data: DocumentData): PaymentMethod {
  return {
    id: data.id,
    workspaceId: data.workspaceId ?? "",
    issuer: data.issuer ?? "",
    label: data.label ?? "",
    last4: (data.last4 ?? "").toString().slice(-4),
    type: data.type ?? "credit",
    billingDay: data.billingDay ?? null,
    color: data.color ?? "#6366f1",
    active: data.active ?? true,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
}

export async function fetchAllPaymentMethods(
  uid: string
): Promise<PaymentMethod[]> {
  const snap = await getDocs(pmCol(uid));
  return snap.docs.map((d) => firestoreToPm({ id: d.id, ...d.data() }));
}

export async function savePaymentMethod(
  uid: string,
  m: PaymentMethod
): Promise<void> {
  await setDoc(pmDoc(uid, m.id), pmToFirestore(m));
}

export async function updatePaymentMethodFields(
  uid: string,
  id: string,
  updates: Partial<PaymentMethod>
): Promise<void> {
  const mapped: Record<string, unknown> = {
    ...updates,
    updatedAt: dateToTs(new Date()),
  };
  if (updates.last4 !== undefined) {
    mapped.last4 = (updates.last4 ?? "").replace(/\D/g, "").slice(-4);
  }
  await updateDoc(pmDoc(uid, id), mapped as DocumentData);
}

export async function deletePaymentMethod(
  uid: string,
  id: string
): Promise<void> {
  await deleteDoc(pmDoc(uid, id));
}

// ═══════════════════════════════════════════════════════
// API: FixedCosts (구독·고정비)
// ═══════════════════════════════════════════════════════

const fcCol = (uid: string) =>
  collection(getClientDb(), "users", uid, "fixedCosts");
const fcDoc = (uid: string, id: string) =>
  doc(getClientDb(), "users", uid, "fixedCosts", id);

function fcToFirestore(c: FixedCost): DocumentData {
  return {
    ...c,
    startedAt: dateToTs(c.startedAt),
    endedAt: dateToTs(c.endedAt),
    createdAt: dateToTs(c.createdAt),
    updatedAt: dateToTs(c.updatedAt),
  };
}

function firestoreToFc(data: DocumentData): FixedCost {
  return {
    id: data.id,
    workspaceId: data.workspaceId ?? "",
    title: data.title ?? "",
    amount: data.amount ?? 0,
    currency: data.currency ?? "KRW",
    cycle: data.cycle ?? "monthly",
    paymentDay: data.paymentDay ?? 1,
    paymentMonth: data.paymentMonth ?? null,
    paymentMethodId: data.paymentMethodId ?? null,
    categoryId: data.categoryId ?? null,
    memo: data.memo ?? "",
    startedAt: toDate(data.startedAt),
    endedAt: data.endedAt ? toDate(data.endedAt) : null,
    active: data.active ?? true,
    sourceInputId: data.sourceInputId ?? null,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
}

export async function fetchAllFixedCosts(uid: string): Promise<FixedCost[]> {
  const snap = await getDocs(fcCol(uid));
  return snap.docs.map((d) => firestoreToFc({ id: d.id, ...d.data() }));
}

export async function saveFixedCost(uid: string, c: FixedCost): Promise<void> {
  await setDoc(fcDoc(uid, c.id), fcToFirestore(c));
}

export async function updateFixedCostFields(
  uid: string,
  id: string,
  updates: Partial<FixedCost>
): Promise<void> {
  const mapped: Record<string, unknown> = {
    ...updates,
    updatedAt: dateToTs(new Date()),
  };
  if (updates.startedAt) mapped.startedAt = dateToTs(updates.startedAt);
  if (updates.endedAt !== undefined) mapped.endedAt = dateToTs(updates.endedAt);
  await updateDoc(fcDoc(uid, id), mapped as DocumentData);
}

export async function deleteFixedCost(uid: string, id: string): Promise<void> {
  await deleteDoc(fcDoc(uid, id));
}

// ═══════════════════════════════════════════════════════
// API: DiaryEntries (일기 — 원문 보존)
// ═══════════════════════════════════════════════════════

const diaryCol = (uid: string) =>
  collection(getClientDb(), "users", uid, "diary");
const diaryDoc = (uid: string, id: string) =>
  doc(getClientDb(), "users", uid, "diary", id);

function diaryToFirestore(e: DiaryEntry): DocumentData {
  return {
    ...e,
    entryDate: dateToTs(e.entryDate),
    createdAt: dateToTs(e.createdAt),
    updatedAt: dateToTs(e.updatedAt),
  };
}

function firestoreToDiary(data: DocumentData): DiaryEntry {
  return {
    id: data.id,
    workspaceId: data.workspaceId ?? "",
    rawText: data.rawText ?? "",
    channel: data.channel ?? "text",
    entryDate: toDate(data.entryDate),
    title: data.title ?? "",
    mood: data.mood ?? null,
    emotions: data.emotions ?? [],
    personIds: data.personIds ?? [],
    orgIds: data.orgIds ?? [],
    places: data.places ?? [],
    events: data.events ?? [],
    tags: data.tags ?? [],
    analyzed: data.analyzed ?? false,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
}

export async function fetchAllDiaryEntries(uid: string): Promise<DiaryEntry[]> {
  const snap = await getDocs(diaryCol(uid));
  return snap.docs.map((d) => firestoreToDiary({ id: d.id, ...d.data() }));
}

export async function saveDiaryEntry(uid: string, e: DiaryEntry): Promise<void> {
  await setDoc(diaryDoc(uid, e.id), diaryToFirestore(e));
}

export async function updateDiaryEntryFields(
  uid: string,
  id: string,
  updates: Partial<DiaryEntry>
): Promise<void> {
  const mapped: Record<string, unknown> = {
    ...updates,
    updatedAt: dateToTs(new Date()),
  };
  if (updates.entryDate) mapped.entryDate = dateToTs(updates.entryDate);
  await updateDoc(diaryDoc(uid, id), mapped as DocumentData);
}

export async function deleteDiaryEntry(uid: string, id: string): Promise<void> {
  await deleteDoc(diaryDoc(uid, id));
}

// ═══════════════════════════════════════════════════════
// API: RelationshipLogs (사람과의 상호작용 기록)
// ═══════════════════════════════════════════════════════

const relCol = (uid: string) =>
  collection(getClientDb(), "users", uid, "relationshipLogs");
const relDoc = (uid: string, id: string) =>
  doc(getClientDb(), "users", uid, "relationshipLogs", id);

function relToFirestore(l: RelationshipLog): DocumentData {
  return {
    ...l,
    occurredAt: dateToTs(l.occurredAt),
    createdAt: dateToTs(l.createdAt),
  };
}

function firestoreToRel(data: DocumentData): RelationshipLog {
  return {
    id: data.id,
    workspaceId: data.workspaceId ?? "",
    personId: data.personId ?? "",
    diaryEntryId: data.diaryEntryId ?? null,
    occurredAt: toDate(data.occurredAt),
    event: data.event ?? "",
    feeling: data.feeling ?? null,
    sentiment: data.sentiment ?? 0,
    quote: data.quote ?? null,
    createdAt: toDate(data.createdAt),
  };
}

export async function fetchAllRelationshipLogs(
  uid: string
): Promise<RelationshipLog[]> {
  const snap = await getDocs(relCol(uid));
  return snap.docs.map((d) => firestoreToRel({ id: d.id, ...d.data() }));
}

export async function saveRelationshipLog(
  uid: string,
  l: RelationshipLog
): Promise<void> {
  await setDoc(relDoc(uid, l.id), relToFirestore(l));
}

export async function updateRelationshipLogFields(
  uid: string,
  id: string,
  updates: Partial<RelationshipLog>
): Promise<void> {
  const mapped: Record<string, unknown> = { ...updates };
  if (updates.occurredAt) mapped.occurredAt = dateToTs(updates.occurredAt);
  await updateDoc(relDoc(uid, id), mapped as DocumentData);
}

export async function deleteRelationshipLog(
  uid: string,
  id: string
): Promise<void> {
  await deleteDoc(relDoc(uid, id));
}

// ═══════════════════════════════════════════════════════
// API: Topics (주제 — 일정 없는 입력이 쌓이는 곳)
// ═══════════════════════════════════════════════════════

const topicsCol = (uid: string) =>
  collection(getClientDb(), "users", uid, "topics");
const topicDoc = (uid: string, id: string) =>
  doc(getClientDb(), "users", uid, "topics", id);

function topicToFirestore(t: Topic): DocumentData {
  return {
    ...t,
    notes: (t.notes ?? []).map((n) => ({
      ...n,
      createdAt: dateToTs(n.createdAt),
    })),
    createdAt: dateToTs(t.createdAt),
    updatedAt: dateToTs(t.updatedAt),
  };
}

function firestoreToTopic(data: DocumentData): Topic {
  return {
    id: data.id,
    workspaceId: data.workspaceId ?? "",
    label: data.label ?? "",
    aliases: data.aliases ?? [],
    notes: Array.isArray(data.notes)
      ? data.notes.map((n: DocumentData) => ({
          id: n.id,
          text: n.text ?? "",
          capturedInputId: n.capturedInputId ?? null,
          createdAt: toDate(n.createdAt),
        }))
      : [],
    nodeIds: data.nodeIds ?? [],
    sourceInputIds: data.sourceInputIds ?? [],
    status: data.status ?? "collecting",
    promotedProjectId: data.promotedProjectId ?? null,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
}

export async function fetchAllTopics(uid: string): Promise<Topic[]> {
  const snap = await getDocs(topicsCol(uid));
  return snap.docs.map((d) => firestoreToTopic({ id: d.id, ...d.data() }));
}

export async function saveTopic(uid: string, t: Topic): Promise<void> {
  await setDoc(topicDoc(uid, t.id), topicToFirestore(t));
}

export async function updateTopicFields(
  uid: string,
  id: string,
  updates: Partial<Topic>
): Promise<void> {
  const mapped: Record<string, unknown> = {
    ...updates,
    updatedAt: dateToTs(new Date()),
  };
  if (updates.notes) {
    mapped.notes = updates.notes.map((n) => ({
      ...n,
      createdAt: dateToTs(n.createdAt),
    }));
  }
  await updateDoc(topicDoc(uid, id), mapped as DocumentData);
}

export async function deleteTopic(uid: string, id: string): Promise<void> {
  await deleteDoc(topicDoc(uid, id));
}

// ═══════════════════════════════════════════════════════
// API: CapturedInputs (원본 입력 축적 — 향후 재분석 소스)
// ═══════════════════════════════════════════════════════

const capturesCol = (uid: string) =>
  collection(getClientDb(), "users", uid, "capturedInputs");
const captureDoc = (uid: string, id: string) =>
  doc(getClientDb(), "users", uid, "capturedInputs", id);

function captureToFirestore(c: CapturedInput): DocumentData {
  return {
    ...c,
    // extraction은 중첩 객체이므로 그대로 저장 (Date 없음, ISO 문자열만 포함)
    createdAt: dateToTs(c.createdAt),
  };
}

function firestoreToCapture(data: DocumentData): CapturedInput {
  return {
    id: data.id,
    workspaceId: data.workspaceId ?? "",
    rawText: data.rawText ?? "",
    channel: data.channel ?? "text",
    extraction: data.extraction ?? null,
    appliedNodeIds: data.appliedNodeIds ?? [],
    appliedPersonIds: data.appliedPersonIds ?? [],
    appliedOrgIds: data.appliedOrgIds ?? [],
    createdAt: toDate(data.createdAt),
  };
}

export async function fetchRecentCaptures(
  uid: string,
  count = 200
): Promise<CapturedInput[]> {
  const q = query(capturesCol(uid), orderBy("createdAt", "desc"), fsLimit(count));
  const snap = await getDocs(q);
  return snap.docs.map((d) => firestoreToCapture({ id: d.id, ...d.data() }));
}

export async function saveCapturedInput(
  uid: string,
  c: CapturedInput
): Promise<void> {
  await setDoc(captureDoc(uid, c.id), captureToFirestore(c));
}

export async function updateCapturedInputFields(
  uid: string,
  id: string,
  updates: Partial<CapturedInput>
): Promise<void> {
  await updateDoc(captureDoc(uid, id), updates as DocumentData);
}

export async function deleteCapturedInput(
  uid: string,
  id: string
): Promise<void> {
  await deleteDoc(captureDoc(uid, id));
}
