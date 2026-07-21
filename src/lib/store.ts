// ==========================================
// Zustand 상태관리 — 통합 스토어
// (Firestore 동기화 포함)
// ==========================================

import { create } from "zustand";
import type {
  Node,
  Category,
  AppView,
  CalendarSubView,
  Language,
  HomeMode,
  ProjectSummary,
  UserProfile,
  NodeStatus,
  NodeType,
  LogEntry,
  LogAction,
  Person,
  Organization,
  CapturedInput,
  Topic,
  PaymentMethod,
  FixedCost,
  DiaryEntry,
  RelationshipLog,
} from "@/lib/types";
import {
  generateId,
  computeRollup,
  createNode,
  createTopicNote,
} from "@/lib/services";

import { occursOn, occurrenceTimes } from "@/lib/recurrence";
import { shouldPromoteTopic } from "@/lib/types";
import * as fs from "@/lib/firestore";

// ─── Firestore 쓰기 헬퍼 (fire-and-forget, 에러 콘솔) ───
function getUid(): string | null {
  return useAuthStore.getState().user?.uid ?? null;
}

/** Firestore에 비동기 쓰기. 실패 시 콘솔 경고만 (낙관적 업데이트 패턴) */
function fsWrite(fn: (uid: string) => Promise<void>) {
  const uid = getUid();
  if (!uid) return;
  fn(uid).catch((e) => console.warn("[store→firestore]", e));
}

// --- Auth Store ---
interface AuthState {
  user: UserProfile | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (user: UserProfile) => void;
  logout: () => void;
  setLoading: (v: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  login: (user) => set({ user, isAuthenticated: true, isLoading: false }),
  logout: () => set({ user: null, isAuthenticated: false, isLoading: false }),
  setLoading: (v) => set({ isLoading: v }),
}));

// --- Navigation Store ---
interface NavState {
  activeView: AppView;
  calendarSubView: CalendarSubView;
  selectedDate: Date;
  selectedProjectId: string | null;
  selectedNodeId: string | null;
  mobileTab: AppView;
  setView: (view: AppView) => void;
  setCalendarSubView: (v: CalendarSubView) => void;
  setSelectedDate: (d: Date) => void;
  setSelectedProject: (id: string | null) => void;
  setSelectedNode: (id: string | null) => void;
  setMobileTab: (v: AppView) => void;
}

export const useNavStore = create<NavState>((set) => ({
  activeView: "calendar",
  calendarSubView: "monthly",
  selectedDate: new Date(),
  selectedProjectId: null,
  selectedNodeId: null,
  mobileTab: "calendar",
  setView: (v) => set({ activeView: v }),
  setCalendarSubView: (v) => set({ calendarSubView: v }),
  setSelectedDate: (d) => set({ selectedDate: d }),
  setSelectedProject: (id) => set({ selectedProjectId: id }),
  setSelectedNode: (id) => set({ selectedNodeId: id }),
  setMobileTab: (v) => set({ mobileTab: v, activeView: v }),
}));

// --- Log Store ---
interface LogState {
  logs: Record<string, LogEntry>;
  addLog: (entry: Omit<LogEntry, "id" | "timestamp">) => void;
  getLogsForNode: (nodeId: string) => LogEntry[];
  getRecentLogs: (limit?: number) => LogEntry[];
}

export const useLogStore = create<LogState>((set, get) => ({
  logs: {},
  addLog: (entry) => {
    const log: LogEntry = {
      id: (entry as any).id ?? generateId(),
      nodeId: entry.nodeId,
      workspaceId: entry.workspaceId,
      action: entry.action,
      before: entry.before,
      after: entry.after,
      actor: entry.actor,
      timestamp: (entry as any).timestamp ?? new Date(),
    };
    set((s) => ({ logs: { ...s.logs, [log.id]: log } }));
    fsWrite((uid) => fs.saveLog(uid, log));
  },
  getLogsForNode: (nodeId) =>
    Object.values(get().logs)
      .filter((l) => l.nodeId === nodeId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()),
  getRecentLogs: (limit = 50) =>
    Object.values(get().logs)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit),
}));

// --- Node Store ---
interface NodeState {
  nodes: Record<string, Node>;
  isLoading: boolean;
  setNodes: (nodes: Node[]) => void;
  addNode: (node: Node) => void;
  addNodeWithLog: (node: Node) => void;
  updateNode: (id: string, updates: Partial<Node>) => void;
  updateNodeWithLog: (id: string, updates: Partial<Node>) => void;
  removeNode: (id: string) => void;
  removeNodeWithLog: (id: string) => void;
  moveNode: (id: string, newProjectId: string, newParentId: string | null) => void;
  toggleNodeStatus: (id: string) => void;
  getNodesByType: (type: NodeType) => Node[];
  getNodesByProject: (projectId: string) => Node[];
  getNodesByDate: (date: Date) => Node[];
  getProjectNodes: (projectId: string) => Node[];
  getChildNodes: (parentId: string) => Node[];
  getDescendantNodes: (parentId: string) => Node[];
  getUnsortedNodes: () => Node[];
  /** parentId부터 루트까지 자식 기준 롤업(진행률/자동완료/재오픈)을 전파 */
  recalcParentProgress: (parentId: string) => void;
  /** 해당 노드의 상태 변경을 부모 체인을 따라 루트까지 전파 */
  propagateCompletion: (nodeId: string) => void;
}

export const useNodeStore = create<NodeState>((set, get) => ({
  nodes: {},
  isLoading: false,
  setNodes: (nodes) => {
    const map: Record<string, Node> = {};
    nodes.forEach((n) => { map[n.id] = n; });
    set({ nodes: map });
  },
  addNode: (node) => {
    set((s) => ({ nodes: { ...s.nodes, [node.id]: node } }));
    fsWrite((uid) => fs.saveNode(uid, node));
  },
  addNodeWithLog: (node) => {
    get().addNode(node);
    useLogStore.getState().addLog({
      nodeId: node.id,
      workspaceId: node.workspaceId,
      action: "create",
      before: null,
      after: node,
      actor: useAuthStore.getState().user?.uid ?? "anonymous",
    });
  },
  updateNode: (id, updates) => {
    set((s) => ({
      nodes: {
        ...s.nodes,
        [id]: s.nodes[id]
          ? { ...s.nodes[id], ...updates, updatedAt: new Date() }
          : s.nodes[id],
      },
    }));
    fsWrite((uid) => fs.updateNodeFields(uid, id, updates));
  },
  updateNodeWithLog: (id, updates) => {
    const before = get().nodes[id] ? { ...get().nodes[id] } : null;
    get().updateNode(id, updates);
    const actionType: LogAction = updates.schedule ? "schedule_change" : updates.assignee ? "assignee_change" : "update";
    useLogStore.getState().addLog({
      nodeId: id,
      workspaceId: get().nodes[id]?.workspaceId ?? "",
      action: actionType,
      before,
      after: updates,
      actor: useAuthStore.getState().user?.uid ?? "anonymous",
    });
  },
  removeNode: (id) => {
    set((s) => {
      const { [id]: _, ...rest } = s.nodes;
      return { nodes: rest };
    });
    fsWrite((uid) => fs.deleteNode(uid, id));
  },
  removeNodeWithLog: (id) => {
    const node = get().nodes[id];
    if (!node) return;
    get().removeNode(id);
    useLogStore.getState().addLog({
      nodeId: id,
      workspaceId: node.workspaceId,
      action: "delete",
      before: node,
      after: null,
      actor: useAuthStore.getState().user?.uid ?? "anonymous",
    });
  },
  moveNode: (id, newProjectId, newParentId) => {
    const node = get().nodes[id];
    if (!node) return;
    // Remove from old parent's children
    if (node.parentId) {
      const oldParent = get().nodes[node.parentId];
      if (oldParent) {
        get().updateNode(node.parentId, {
          childrenIds: oldParent.childrenIds.filter((c) => c !== id),
        });
      }
    }
    // Update node
    get().updateNode(id, { projectId: newProjectId, parentId: newParentId });
    // Add to new parent's children
    if (newParentId) {
      const newParent = get().nodes[newParentId];
      if (newParent) {
        get().updateNode(newParentId, {
          childrenIds: [...newParent.childrenIds, id],
        });
      }
    }
    useLogStore.getState().addLog({
      nodeId: id,
      workspaceId: node.workspaceId,
      action: "move",
      before: { projectId: node.projectId, parentId: node.parentId },
      after: { projectId: newProjectId, parentId: newParentId },
      actor: useAuthStore.getState().user?.uid ?? "anonymous",
    });
  },
  toggleNodeStatus: (id) => {
    const node = get().nodes[id];
    if (!node) return;
    const newStatus: NodeStatus =
      node.status === "completed" ? "scheduled" : "completed";
    get().updateNode(id, {
      status: newStatus,
      completedAt: newStatus === "completed" ? new Date() : null,
      progress: newStatus === "completed" ? 100 : 0,
    });
    if (newStatus === "completed") {
      useLogStore.getState().addLog({
        nodeId: id,
        workspaceId: node.workspaceId,
        action: "complete",
        before: { status: node.status, progress: node.progress },
        after: { status: newStatus, progress: 100 },
        actor: useAuthStore.getState().user?.uid ?? "anonymous",
      });
    }
    // Recalc parent progress
    if (node.parentId) get().recalcParentProgress(node.parentId);
  },
  getNodesByType: (type) =>
    Object.values(get().nodes).filter((n) => n.type === type),
  getNodesByProject: (projectId) =>
    Object.values(get().nodes).filter((n) => n.projectId === projectId),
  getNodesByDate: (date) => {
    // 반복 일정은 회차를 저장하지 않으므로 조회 시점에 계산해서 펼친다.
    // 이 함수가 캘린더/투두/대시보드 공통 관문이라 여기 한 곳만 고치면 된다.
    return Object.values(get().nodes)
      // 대기함(draft)에 있는 항목은 아직 확정 전이므로 캘린더에 띄우지 않는다
      .filter(
        (n) =>
          n.schedule &&
          n.aiMeta?.status !== "draft" &&
          occursOn(n.schedule, date)
      )
      .map((n) => {
        if (!n.schedule?.recurrence) return n;
        // 반복 회차는 원본의 시각을 유지한 채 날짜만 그 날로 옮겨 반환한다.
        // (원본은 건드리지 않는다 — 화면 표시용 파생 객체)
        const { startAt, endAt } = occurrenceTimes(n.schedule, date);
        return { ...n, schedule: { ...n.schedule, startAt, endAt } };
      });
  },
  getProjectNodes: (projectId) =>
    Object.values(get().nodes).filter(
      (n) => n.projectId === projectId && n.parentId === null
    ),
  getChildNodes: (parentId) =>
    Object.values(get().nodes).filter(
      (n) => n.parentId === parentId
    ),
  getDescendantNodes: (parentId) => {
    const result: Node[] = [];
    const children = get().getChildNodes(parentId);
    for (const child of children) {
      result.push(child);
      result.push(...get().getDescendantNodes(child.id));
    }
    return result;
  },
  getUnsortedNodes: () =>
    Object.values(get().nodes).filter(
      (n) => n.projectId === "unsorted" && n.aiMeta?.status !== "draft"
    ),
  // parentId(포함)부터 루트까지 올라가며 computeRollup을 적용한다.
  // - 자식 전부 완료 + autoCompleteFromChildren → 부모 자동 완료
  // - 자식이 다시 열리면 완료됐던 부모를 in_progress로 되돌림
  recalcParentProgress: (parentId) => {
    let currentId: string | null = parentId;
    const seen = new Set<string>();
    while (currentId && !seen.has(currentId)) {
      seen.add(currentId);
      const parent: Node | undefined = get().nodes[currentId];
      if (!parent) break;
      const children = get().getChildNodes(currentId);
      const updates = computeRollup(parent, children);
      if (updates) {
        get().updateNode(currentId, updates);
        if (updates.status === "completed") {
          useLogStore.getState().addLog({
            nodeId: currentId,
            workspaceId: parent.workspaceId,
            action: "complete",
            before: { status: parent.status, progress: parent.progress },
            after: updates,
            actor: useAuthStore.getState().user?.uid ?? "anonymous",
          });
        }
      }
      currentId = parent.parentId;
    }
  },
  propagateCompletion: (nodeId) => {
    const node = get().nodes[nodeId];
    if (!node?.parentId) return;
    get().recalcParentProgress(node.parentId);
  },
}));

// --- Category Store ---
interface CategoryState {
  categories: Record<string, Category>;
  setCategories: (cats: Category[]) => void;
  addCategory: (cat: Category) => void;
  updateCategory: (id: string, updates: Partial<Category>) => void;
  removeCategory: (id: string) => void;
  getById: (id: string) => Category | undefined;
  getColor: (id: string, isDark: boolean) => string;
}

export const useCategoryStore = create<CategoryState>((set, get) => ({
  categories: {},
  setCategories: (cats) => {
    const map: Record<string, Category> = {};
    cats.forEach((c) => { map[c.id] = c; });
    set({ categories: map });
  },
  addCategory: (cat) => {
    set((s) => ({ categories: { ...s.categories, [cat.id]: cat } }));
    fsWrite((uid) => fs.saveCategory(uid, cat));
  },
  updateCategory: (id, updates) => {
    set((s) => ({
      categories: {
        ...s.categories,
        [id]: s.categories[id]
          ? { ...s.categories[id], ...updates }
          : s.categories[id],
      },
    }));
    // 머지된 결과를 Firestore에 저장
    const merged = useCategoryStore.getState().categories[id];
    if (merged) fsWrite((uid) => fs.saveCategory(uid, merged));
  },
  removeCategory: (id) => {
    set((s) => {
      const { [id]: _, ...rest } = s.categories;
      return { categories: rest };
    });
    fsWrite((uid) => fs.deleteCategory(uid, id));
  },
  getById: (id) => get().categories[id],
  getColor: (id, isDark) => {
    const cat = get().categories[id];
    if (!cat) return isDark ? "#6b7280" : "#9ca3af";
    return isDark ? cat.darkColor : cat.color;
  },
}));

// --- Preference Store ---
interface PrefState {
  language: Language;
  homeMode: HomeMode;
  setLanguage: (l: Language) => void;
  setHomeMode: (m: HomeMode) => void;
}

export const usePrefStore = create<PrefState>((set) => ({
  language: "ko",
  homeMode: "calendar",
  setLanguage: (l) => set({ language: l }),
  setHomeMode: (m) => set({ homeMode: m }),
}));

// --- Project Summary Store ---
interface ProjectSummaryState {
  projects: ProjectSummary[];
  setProjects: (p: ProjectSummary[]) => void;
  addProject: (p: ProjectSummary) => void;
  updateProject: (id: string, updates: Partial<ProjectSummary>) => void;
  /**
   * 프로젝트 삭제.
   * @param mode "unsort" = 소속 노드를 미분류함으로 이동 (기본, 안전)
   *             "cascade" = 소속 노드까지 전부 삭제
   */
  removeProject: (id: string, mode?: "unsort" | "cascade") => void;
}

export const useProjectStore = create<ProjectSummaryState>((set, get) => ({
  projects: [],
  setProjects: (p) => set({ projects: p }),
  addProject: (p) => {
    set((s) => ({ projects: [...s.projects, p] }));
    fsWrite((uid) => fs.saveProject(uid, p));
  },
  updateProject: (id, updates) => {
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === id ? { ...p, ...updates, updatedAt: new Date() } : p
      ),
    }));
    const merged = useProjectStore.getState().projects.find((p) => p.id === id);
    if (merged) fsWrite((uid) => fs.saveProject(uid, merged));
  },
  removeProject: (id, mode = "unsort") => {
    const nodeStore = useNodeStore.getState();
    // 이 프로젝트에 속한 모든 노드 (루트 노드 자신 포함)
    const owned = Object.values(nodeStore.nodes).filter(
      (n) => n.projectId === id || n.id === id
    );

    if (mode === "cascade") {
      for (const n of owned) nodeStore.removeNodeWithLog(n.id);
    } else {
      // 루트만 삭제하고 나머지는 미분류함으로 옮긴다.
      // 내부 부모-자식 관계는 그대로 두고, 삭제되는 루트를 부모로 갖던
      // 노드만 최상위로 올린다 (계층 구조 보존).
      const removedIds = new Set([id]);
      for (const n of owned) {
        if (n.id === id) {
          nodeStore.removeNodeWithLog(n.id);
          continue;
        }
        nodeStore.updateNode(n.id, {
          projectId: "unsorted",
          parentId:
            n.parentId && removedIds.has(n.parentId) ? null : n.parentId,
        });
      }
    }

    set((s) => ({ projects: s.projects.filter((p) => p.id !== id) }));
    fsWrite((uid) => fs.deleteProject(uid, id));

    // 삭제된 프로젝트를 보고 있었으면 선택 해제
    if (useNavStore.getState().selectedProjectId === id) {
      useNavStore.getState().setSelectedProject(null);
    }
  },
}));

// ==========================================
// 인물 레이어 (명함 / 연락처)
// ==========================================
interface PersonState {
  people: Record<string, Person>;
  setPeople: (p: Person[]) => void;
  addPerson: (p: Person) => void;
  updatePerson: (id: string, updates: Partial<Person>) => void;
  removePerson: (id: string) => void;
  /** 이름(+소속)으로 기존 인물 찾기 — AI 중복 등록 방지용 */
  findByName: (name: string, org?: string | null) => Person | undefined;
  linkToNode: (personId: string, nodeId: string) => void;
}

export const usePersonStore = create<PersonState>((set, get) => ({
  people: {},
  setPeople: (list) => {
    const map: Record<string, Person> = {};
    list.forEach((p) => { map[p.id] = p; });
    set({ people: map });
  },
  addPerson: (p) => {
    set((s) => ({ people: { ...s.people, [p.id]: p } }));
    fsWrite((uid) => fs.savePerson(uid, p));
  },
  updatePerson: (id, updates) => {
    set((s) => ({
      people: s.people[id]
        ? { ...s.people, [id]: { ...s.people[id], ...updates, updatedAt: new Date() } }
        : s.people,
    }));
    fsWrite((uid) => fs.updatePersonFields(uid, id, updates));
  },
  removePerson: (id) => {
    set((s) => {
      const { [id]: _, ...rest } = s.people;
      return { people: rest };
    });
    fsWrite((uid) => fs.deletePerson(uid, id));
  },
  findByName: (name, org) => {
    const norm = (v: string) => v.replace(/\s+/g, "").toLowerCase();
    const target = norm(name);
    return Object.values(get().people).find((p) => {
      if (norm(p.name) !== target) return false;
      // 소속이 둘 다 있으면 소속까지 일치해야 동일인
      if (org && p.org) return norm(p.org) === norm(org);
      return true;
    });
  },
  linkToNode: (personId, nodeId) => {
    const p = get().people[personId];
    if (!p || p.relatedNodeIds.includes(nodeId)) return;
    get().updatePerson(personId, {
      relatedNodeIds: [...p.relatedNodeIds, nodeId],
    });
  },
}));

// ==========================================
// 조직 레이어
// ==========================================
interface OrgState {
  orgs: Record<string, Organization>;
  setOrgs: (o: Organization[]) => void;
  addOrg: (o: Organization) => void;
  updateOrg: (id: string, updates: Partial<Organization>) => void;
  removeOrg: (id: string) => void;
  findByName: (name: string) => Organization | undefined;
  linkToNode: (orgId: string, nodeId: string) => void;
}

export const useOrgStore = create<OrgState>((set, get) => ({
  orgs: {},
  setOrgs: (list) => {
    const map: Record<string, Organization> = {};
    list.forEach((o) => { map[o.id] = o; });
    set({ orgs: map });
  },
  addOrg: (o) => {
    set((s) => ({ orgs: { ...s.orgs, [o.id]: o } }));
    fsWrite((uid) => fs.saveOrganization(uid, o));
  },
  updateOrg: (id, updates) => {
    set((s) => ({
      orgs: s.orgs[id]
        ? { ...s.orgs, [id]: { ...s.orgs[id], ...updates, updatedAt: new Date() } }
        : s.orgs,
    }));
    fsWrite((uid) => fs.updateOrganizationFields(uid, id, updates));
  },
  removeOrg: (id) => {
    set((s) => {
      const { [id]: _, ...rest } = s.orgs;
      return { orgs: rest };
    });
    fsWrite((uid) => fs.deleteOrganization(uid, id));
  },
  findByName: (name) => {
    const norm = (v: string) => v.replace(/\s+/g, "").toLowerCase();
    const target = norm(name);
    return Object.values(get().orgs).find((o) => norm(o.name) === target);
  },
  linkToNode: (orgId, nodeId) => {
    const o = get().orgs[orgId];
    if (!o || o.relatedNodeIds.includes(nodeId)) return;
    get().updateOrg(orgId, { relatedNodeIds: [...o.relatedNodeIds, nodeId] });
  },
}));

// ==========================================
// 주제 레이어 — 일정 없는 입력이 쌓이는 곳
// ==========================================
interface TopicState {
  topics: Record<string, Topic>;
  setTopics: (t: Topic[]) => void;
  addTopic: (t: Topic) => void;
  updateTopic: (id: string, updates: Partial<Topic>) => void;
  removeTopic: (id: string) => void;
  /** 라벨/별칭으로 기존 주제 찾기 — 신규 남발 방지 */
  findByLabel: (label: string) => Topic | undefined;
  /** 주제에 메모 추가 */
  addNote: (topicId: string, text: string, captureId: string | null) => void;
  /** 주제에 노드(행동) 연결 */
  linkNode: (topicId: string, nodeId: string) => void;
  /** 승격 조건을 만족한 주제들 */
  getPromotable: () => Topic[];
  /** 주제를 프로젝트로 승격 — 소속 노드를 전부 그 프로젝트로 옮긴다 */
  promote: (topicId: string) => string | null;
}

const normLabel = (v: string) =>
  v.replace(/\s+/g, "").toLowerCase().replace(/[·・,./-]/g, "");

export const useTopicStore = create<TopicState>((set, get) => ({
  topics: {},
  setTopics: (list) => {
    const map: Record<string, Topic> = {};
    list.forEach((t) => { map[t.id] = t; });
    set({ topics: map });
  },
  addTopic: (t) => {
    set((s) => ({ topics: { ...s.topics, [t.id]: t } }));
    fsWrite((uid) => fs.saveTopic(uid, t));
  },
  updateTopic: (id, updates) => {
    set((s) => ({
      topics: s.topics[id]
        ? { ...s.topics, [id]: { ...s.topics[id], ...updates, updatedAt: new Date() } }
        : s.topics,
    }));
    fsWrite((uid) => fs.updateTopicFields(uid, id, updates));
  },
  removeTopic: (id) => {
    set((s) => {
      const { [id]: _, ...rest } = s.topics;
      return { topics: rest };
    });
    fsWrite((uid) => fs.deleteTopic(uid, id));
  },
  findByLabel: (label) => {
    const target = normLabel(label);
    if (!target) return undefined;
    return Object.values(get().topics).find((t) => {
      if (normLabel(t.label) === target) return true;
      if (t.aliases.some((a) => normLabel(a) === target)) return true;
      // 한쪽이 다른 쪽을 포함하면 같은 주제로 본다 ("제주이주" ⊂ "제주이주준비")
      const self = normLabel(t.label);
      if (self.length >= 3 && target.length >= 3) {
        return self.includes(target) || target.includes(self);
      }
      return false;
    });
  },
  addNote: (topicId, text, captureId) => {
    const t = get().topics[topicId];
    if (!t) return;
    get().updateTopic(topicId, {
      notes: [...t.notes, createTopicNote(text, captureId)],
    });
  },
  linkNode: (topicId, nodeId) => {
    const t = get().topics[topicId];
    if (!t || t.nodeIds.includes(nodeId)) return;
    get().updateTopic(topicId, { nodeIds: [...t.nodeIds, nodeId] });
  },
  getPromotable: () =>
    Object.values(get().topics).filter(shouldPromoteTopic),
  promote: (topicId) => {
    const topic = get().topics[topicId];
    if (!topic || topic.status !== "collecting") return null;

    // 주제 자체가 프로젝트 루트 노드가 된다 (data-model.md §6)
    const rootId = generateId();
    const nodeStore = useNodeStore.getState();
    const root = createNode({
      id: rootId,
      workspaceId: topic.workspaceId,
      type: "goal",
      kind: "project",
      title: topic.label,
      // 쌓아둔 메모를 프로젝트 설명으로 옮긴다 — 맥락이 사라지지 않게
      description: topic.notes.map((n) => `· ${n.text}`).join("\n"),
      projectId: rootId,
      parentId: null,
      topicId: topic.id,
    });
    nodeStore.addNodeWithLog(root);

    useProjectStore.getState().addProject({
      id: rootId,
      title: topic.label,
      progress: 0,
      memberCount: 1,
      updatedAt: new Date(),
    });

    // 주제에 붙어 있던 노드들을 프로젝트 하위로 이동
    for (const nid of topic.nodeIds) {
      if (!nodeStore.nodes[nid]) continue;
      nodeStore.moveNode(nid, rootId, rootId);
    }

    get().updateTopic(topicId, {
      status: "promoted",
      promotedProjectId: rootId,
    });
    return rootId;
  },
}));

// ==========================================
// 결제수단 (카드번호 전체는 저장하지 않는다)
// ==========================================
interface PaymentMethodState {
  methods: Record<string, PaymentMethod>;
  setMethods: (m: PaymentMethod[]) => void;
  addMethod: (m: PaymentMethod) => void;
  updateMethod: (id: string, u: Partial<PaymentMethod>) => void;
  removeMethod: (id: string) => void;
  getActive: () => PaymentMethod[];
}

export const usePaymentMethodStore = create<PaymentMethodState>((set, get) => ({
  methods: {},
  setMethods: (list) => {
    const map: Record<string, PaymentMethod> = {};
    list.forEach((m) => { map[m.id] = m; });
    set({ methods: map });
  },
  addMethod: (m) => {
    set((s) => ({ methods: { ...s.methods, [m.id]: m } }));
    fsWrite((uid) => fs.savePaymentMethod(uid, m));
  },
  updateMethod: (id, u) => {
    set((s) => ({
      methods: s.methods[id]
        ? { ...s.methods, [id]: { ...s.methods[id], ...u, updatedAt: new Date() } }
        : s.methods,
    }));
    fsWrite((uid) => fs.updatePaymentMethodFields(uid, id, u));
  },
  removeMethod: (id) => {
    set((s) => {
      const { [id]: _, ...rest } = s.methods;
      return { methods: rest };
    });
    // 이 카드를 쓰던 고정비는 '미지정'으로 남긴다 (고정비까지 지우지 않는다)
    const fcStore = useFixedCostStore.getState();
    for (const c of Object.values(fcStore.costs)) {
      if (c.paymentMethodId === id) {
        fcStore.updateCost(c.id, { paymentMethodId: null });
      }
    }
    fsWrite((uid) => fs.deletePaymentMethod(uid, id));
  },
  getActive: () => Object.values(get().methods).filter((m) => m.active),
}));

// ==========================================
// 고정비 / 구독
// ==========================================
interface FixedCostState {
  costs: Record<string, FixedCost>;
  setCosts: (c: FixedCost[]) => void;
  addCost: (c: FixedCost) => void;
  updateCost: (id: string, u: Partial<FixedCost>) => void;
  removeCost: (id: string) => void;
  /** 해지 처리 — 기록은 남기고 앞으로만 안 나가게 */
  endCost: (id: string, endedAt?: Date) => void;
  getActive: () => FixedCost[];
}

export const useFixedCostStore = create<FixedCostState>((set, get) => ({
  costs: {},
  setCosts: (list) => {
    const map: Record<string, FixedCost> = {};
    list.forEach((c) => { map[c.id] = c; });
    set({ costs: map });
  },
  addCost: (c) => {
    set((s) => ({ costs: { ...s.costs, [c.id]: c } }));
    fsWrite((uid) => fs.saveFixedCost(uid, c));
  },
  updateCost: (id, u) => {
    set((s) => ({
      costs: s.costs[id]
        ? { ...s.costs, [id]: { ...s.costs[id], ...u, updatedAt: new Date() } }
        : s.costs,
    }));
    fsWrite((uid) => fs.updateFixedCostFields(uid, id, u));
  },
  removeCost: (id) => {
    set((s) => {
      const { [id]: _, ...rest } = s.costs;
      return { costs: rest };
    });
    fsWrite((uid) => fs.deleteFixedCost(uid, id));
  },
  endCost: (id, endedAt = new Date()) => {
    get().updateCost(id, { endedAt, active: false });
  },
  getActive: () => Object.values(get().costs).filter((c) => c.active),
}));

// ==========================================
// 일기 (원문 보존)
// ==========================================
interface DiaryState {
  entries: Record<string, DiaryEntry>;
  setEntries: (e: DiaryEntry[]) => void;
  addEntry: (e: DiaryEntry) => void;
  updateEntry: (id: string, u: Partial<DiaryEntry>) => void;
  removeEntry: (id: string) => void;
  getAll: () => DiaryEntry[];
}

export const useDiaryStore = create<DiaryState>((set, get) => ({
  entries: {},
  setEntries: (list) => {
    const map: Record<string, DiaryEntry> = {};
    list.forEach((e) => { map[e.id] = e; });
    set({ entries: map });
  },
  addEntry: (e) => {
    set((s) => ({ entries: { ...s.entries, [e.id]: e } }));
    fsWrite((uid) => fs.saveDiaryEntry(uid, e));
  },
  updateEntry: (id, u) => {
    set((s) => ({
      entries: s.entries[id]
        ? { ...s.entries, [id]: { ...s.entries[id], ...u, updatedAt: new Date() } }
        : s.entries,
    }));
    fsWrite((uid) => fs.updateDiaryEntryFields(uid, id, u));
  },
  removeEntry: (id) => {
    set((s) => {
      const { [id]: _, ...rest } = s.entries;
      return { entries: rest };
    });
    // 이 일기에서 나온 관계 기록도 함께 지운다 (근거가 사라지므로)
    const relStore = useRelationshipStore.getState();
    for (const l of Object.values(relStore.logs)) {
      if (l.diaryEntryId === id) relStore.removeLog(l.id);
    }
    fsWrite((uid) => fs.deleteDiaryEntry(uid, id));
  },
  getAll: () => Object.values(get().entries),
}));

// ==========================================
// 관계 로그
// ==========================================
interface RelationshipState {
  logs: Record<string, RelationshipLog>;
  setLogs: (l: RelationshipLog[]) => void;
  addLog: (l: RelationshipLog) => void;
  updateLog: (id: string, u: Partial<RelationshipLog>) => void;
  removeLog: (id: string) => void;
  getAll: () => RelationshipLog[];
  getForPerson: (personId: string) => RelationshipLog[];
}

export const useRelationshipStore = create<RelationshipState>((set, get) => ({
  logs: {},
  setLogs: (list) => {
    const map: Record<string, RelationshipLog> = {};
    list.forEach((l) => { map[l.id] = l; });
    set({ logs: map });
  },
  addLog: (l) => {
    set((s) => ({ logs: { ...s.logs, [l.id]: l } }));
    fsWrite((uid) => fs.saveRelationshipLog(uid, l));
  },
  updateLog: (id, u) => {
    set((s) => ({
      logs: s.logs[id] ? { ...s.logs, [id]: { ...s.logs[id], ...u } } : s.logs,
    }));
    fsWrite((uid) => fs.updateRelationshipLogFields(uid, id, u));
  },
  removeLog: (id) => {
    set((s) => {
      const { [id]: _, ...rest } = s.logs;
      return { logs: rest };
    });
    fsWrite((uid) => fs.deleteRelationshipLog(uid, id));
  },
  getAll: () => Object.values(get().logs),
  getForPerson: (personId) =>
    Object.values(get().logs)
      .filter((l) => l.personId === personId)
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()),
}));

// ==========================================
// 원본 입력 축적 레이어
// ==========================================
interface CaptureState {
  captures: Record<string, CapturedInput>;
  setCaptures: (c: CapturedInput[]) => void;
  addCapture: (c: CapturedInput) => void;
  updateCapture: (id: string, updates: Partial<CapturedInput>) => void;
  removeCapture: (id: string) => void;
  getRecent: (limit?: number) => CapturedInput[];
}

export const useCaptureStore = create<CaptureState>((set, get) => ({
  captures: {},
  setCaptures: (list) => {
    const map: Record<string, CapturedInput> = {};
    list.forEach((c) => { map[c.id] = c; });
    set({ captures: map });
  },
  addCapture: (c) => {
    set((s) => ({ captures: { ...s.captures, [c.id]: c } }));
    fsWrite((uid) => fs.saveCapturedInput(uid, c));
  },
  updateCapture: (id, updates) => {
    set((s) => ({
      captures: s.captures[id]
        ? { ...s.captures, [id]: { ...s.captures[id], ...updates } }
        : s.captures,
    }));
    fsWrite((uid) => fs.updateCapturedInputFields(uid, id, updates));
  },
  removeCapture: (id) => {
    set((s) => {
      const { [id]: _, ...rest } = s.captures;
      return { captures: rest };
    });
    fsWrite((uid) => fs.deleteCapturedInput(uid, id));
  },
  getRecent: (limit = 50) =>
    Object.values(get().captures)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit),
}));