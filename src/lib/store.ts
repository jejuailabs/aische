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
} from "@/lib/types";
import { generateId } from "@/lib/services";
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
  activeView: "dashboard",
  calendarSubView: "monthly",
  selectedDate: new Date(),
  selectedProjectId: null,
  selectedNodeId: null,
  mobileTab: "dashboard",
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
  recalcParentProgress: (parentId: string) => void;
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
  recalcParentProgress: (parentId) => {
    const parent = get().nodes[parentId];
    if (!parent) return;
    const children = get().getChildNodes(parentId);
    if (children.length === 0) return;
    const avgProgress = Math.round(
      children.reduce((sum, c) => sum + c.progress, 0) / children.length
    );
    get().updateNode(parentId, { progress: avgProgress });
    // Cascade upward
    if (parent.parentId) get().recalcParentProgress(parent.parentId);
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
  homeMode: "dashboard",
  setLanguage: (l) => set({ language: l }),
  setHomeMode: (m) => set({ homeMode: m }),
}));

// --- Project Summary Store ---
interface ProjectSummaryState {
  projects: ProjectSummary[];
  setProjects: (p: ProjectSummary[]) => void;
  addProject: (p: ProjectSummary) => void;
  updateProject: (id: string, updates: Partial<ProjectSummary>) => void;
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
}));