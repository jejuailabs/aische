// ==========================================
// Zustand 상태관리 — 통합 스토어
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
  Node as NodeTypeI,
  ScheduleInfo,
  Priority,
} from "@/lib/types";

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
  mobileTab: AppView;
  setView: (view: AppView) => void;
  setCalendarSubView: (v: CalendarSubView) => void;
  setSelectedDate: (d: Date) => void;
  setSelectedProject: (id: string | null) => void;
  setMobileTab: (v: AppView) => void;
}

export const useNavStore = create<NavState>((set) => ({
  activeView: "dashboard",
  calendarSubView: "monthly",
  selectedDate: new Date(),
  selectedProjectId: null,
  mobileTab: "dashboard",
  setView: (v) => set({ activeView: v }),
  setCalendarSubView: (v) => set({ calendarSubView: v }),
  setSelectedDate: (d) => set({ selectedDate: d }),
  setSelectedProject: (id) => set({ selectedProjectId: id }),
  setMobileTab: (v) => set({ mobileTab: v, activeView: v }),
}));

// --- Node Store ---
interface NodeState {
  nodes: Record<string, Node>;
  isLoading: boolean;
  setNodes: (nodes: Node[]) => void;
  addNode: (node: Node) => void;
  updateNode: (id: string, updates: Partial<Node>) => void;
  removeNode: (id: string) => void;
  toggleNodeStatus: (id: string) => void;
  getNodesByType: (type: NodeType) => Node[];
  getNodesByProject: (projectId: string) => Node[];
  getNodesByDate: (date: Date) => Node[];
  getProjectNodes: (projectId: string) => Node[];
}

export const useNodeStore = create<NodeState>((set, get) => ({
  nodes: {},
  isLoading: false,
  setNodes: (nodes) => {
    const map: Record<string, Node> = {};
    nodes.forEach((n) => { map[n.id] = n; });
    set({ nodes: map });
  },
  addNode: (node) =>
    set((s) => ({ nodes: { ...s.nodes, [node.id]: node } })),
  updateNode: (id, updates) =>
    set((s) => ({
      nodes: {
        ...s.nodes,
        [id]: s.nodes[id]
          ? { ...s.nodes[id], ...updates, updatedAt: new Date() }
          : s.nodes[id],
      },
    })),
  removeNode: (id) =>
    set((s) => {
      const { [id]: _, ...rest } = s.nodes;
      return { nodes: rest };
    }),
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
  addCategory: (cat) =>
    set((s) => ({ categories: { ...s.categories, [cat.id]: cat } })),
  updateCategory: (id, updates) =>
    set((s) => ({
      categories: {
        ...s.categories,
        [id]: s.categories[id]
          ? { ...s.categories[id], ...updates }
          : s.categories[id],
      },
    })),
  removeCategory: (id) =>
    set((s) => {
      const { [id]: _, ...rest } = s.categories;
      return { categories: rest };
    }),
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
}

export const useProjectStore = create<ProjectSummaryState>((set) => ({
  projects: [],
  setProjects: (p) => set({ projects: p }),
}));