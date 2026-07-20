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
} from "@/lib/types";
import { generateId, computeRollup } from "@/lib/services";
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
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);
    return Object.values(get().nodes).filter((n) => {
      if (!n.schedule) return false;
      const start = new Date(n.schedule.startAt);
      return start >= dayStart && start <= dayEnd;
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