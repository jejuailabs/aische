// ==========================================
// 서비스 레이어 — 데이터 생성/조작 헬퍼
// (Firebase 대신 클라이언트 상태용 데모 데이터 + 유틸)
// ==========================================

import type {
  Node,
  Category,
  NodeStatus,
  NodeType,
  ScheduleInfo,
  Priority,
  ProjectSummary,
  LogEntry,
  LogAction,
} from "@/lib/types";
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

// --- 데모 데이터 생성 ---
const WORKSPACE_ID = "demo-workspace";

export function generateDemoCategories(): Category[] {
  return [
    createCategory({ id: "cat-meeting", workspaceId: WORKSPACE_ID, label: "회의", color: "#f59e0b", darkColor: "#fbbf24", order: 0 }),
    createCategory({ id: "cat-personal", workspaceId: WORKSPACE_ID, label: "개인", color: "#10b981", darkColor: "#34d399", order: 1 }),
    createCategory({ id: "cat-work", workspaceId: WORKSPACE_ID, label: "업무", color: "#6366f1", darkColor: "#818cf8", order: 2 }),
    createCategory({ id: "cat-health", workspaceId: WORKSPACE_ID, label: "건강", color: "#ef4444", darkColor: "#f87171", order: 3 }),
    createCategory({ id: "cat-study", workspaceId: WORKSPACE_ID, label: "학습", color: "#8b5cf6", darkColor: "#a78bfa", order: 4 }),
    createCategory({ id: "cat-travel", workspaceId: WORKSPACE_ID, label: "여행", color: "#06b6d4", darkColor: "#22d3ee", order: 5 }),
  ];
}

function makeDate(dayOffset: number, hour: number, minute: number = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function makeSchedule(dayOffset: number, startH: number, endH: number, categoryId: string, allDay = false, location: string | null = null, attendees: string[] = []): ScheduleInfo {
  return {
    startAt: makeDate(dayOffset, startH),
    endAt: makeDate(dayOffset, endH),
    dueAt: null,
    allDay,
    category: categoryId,
    location,
    attendees,
    reminders: [],
  };
}

export function generateDemoNodes(): Node[] {
  const nodes: Node[] = [];
  const ws = WORKSPACE_ID;

  // --- 프로젝트 (루트 목표) ---
  const project1Id = "proj-1";
  nodes.push(createNode({
    id: project1Id, workspaceId: ws, type: "goal",
    title: "2026 상반기 목표 달성", description: "올해 상반기 핵심 목표들을 달성합니다",
    status: "in_progress", priority: { urgency: 5, importance: 5, score: 5 },
    progress: 35,
  }));

  const project2Id = "proj-2";
  nodes.push(createNode({
    id: project2Id, workspaceId: ws, type: "goal",
    title: "건강 관리 루틴", description: "규칙적인 운동과 식단 관리",
    status: "in_progress", priority: { urgency: 4, importance: 4, score: 4 },
    progress: 60,
  }));

  // --- 캘린더 이벤트 (오늘) ---
  nodes.push(createNode({
    id: "evt-1", workspaceId: ws, type: "calendar_event", projectId: project1Id,
    title: "팀 미팅", description: "주간 진행 상황 공유",
    status: "scheduled",
    schedule: makeSchedule(0, 9, 10, "cat-meeting", false, "회의실 A", ["김팀장", "이대리"]),
    estimatedDuration: 60,
  }));

  nodes.push(createNode({
    id: "evt-2", workspaceId: ws, type: "calendar_event", projectId: project1Id,
    title: "프로젝트 기획 리뷰", description: "Q3 프로젝트 계획 검토",
    status: "scheduled",
    schedule: makeSchedule(0, 14, 16, "cat-work", false, "온라인", ["박과장", "최수석"]),
    estimatedDuration: 120,
  }));

  nodes.push(createNode({
    id: "evt-3", workspaceId: ws, type: "calendar_event", projectId: project2Id,
    title: "헬스장", description: "상체 근력 운동",
    status: "completed",
    schedule: makeSchedule(0, 7, 8, "cat-health", false, "헬스장", []),
    estimatedDuration: 60,
    completedAt: makeDate(0, 8),
  }));

  // --- 내일 이벤트 ---
  nodes.push(createNode({
    id: "evt-4", workspaceId: ws, type: "calendar_event", projectId: project1Id,
    title: "클라이언트 미팅", description: "신규 계약 논의",
    status: "scheduled",
    schedule: makeSchedule(1, 10, 11, "cat-meeting", false, "본사 3층", ["고객사 김대표"]),
    estimatedDuration: 60,
  }));

  nodes.push(createNode({
    id: "evt-5", workspaceId: ws, type: "calendar_event",
    title: "저녁 약속", description: "친구와 저녁 식사",
    status: "scheduled",
    schedule: makeSchedule(1, 19, 21, "cat-personal", false, "강남역 근처", []),
    estimatedDuration: 120,
  }));

  // --- 이번 주 이벤트들 ---
  nodes.push(createNode({
    id: "evt-6", workspaceId: ws, type: "calendar_event", projectId: project2Id,
    title: "조깅", description: "한강 둔치 5km 러닝",
    status: "scheduled",
    schedule: makeSchedule(2, 6, 7, "cat-health", false, "한강공원", []),
    estimatedDuration: 60,
  }));

  nodes.push(createNode({
    id: "evt-7", workspaceId: ws, type: "calendar_event", projectId: project1Id,
    title: "기술 세미나", description: "AI/ML 트렌드 세미나 참석",
    status: "scheduled",
    schedule: makeSchedule(3, 14, 17, "cat-study", false, "컨벤션센터", []),
    estimatedDuration: 180,
  }));

  nodes.push(createNode({
    id: "evt-8", workspaceId: ws, type: "calendar_event",
    title: "제주 여행 출발", description: "3박 4일 제주도 여행",
    status: "scheduled",
    schedule: makeSchedule(5, 8, 20, "cat-travel", true, "제주도", ["가족"]),
    estimatedDuration: 720,
  }));

  // --- 어제 이벤트 ---
  nodes.push(createNode({
    id: "evt-9", workspaceId: ws, type: "calendar_event", projectId: project1Id,
    title: "코드 리뷰", description: "PR 리뷰 및 피드백",
    status: "completed",
    schedule: makeSchedule(-1, 15, 16, "cat-work", false, "온라인", ["개발팀"]),
    estimatedDuration: 60,
    completedAt: makeDate(-1, 16),
  }));

  // --- 일주일 전 이벤트 ---
  nodes.push(createNode({
    id: "evt-10", workspaceId: ws, type: "calendar_event",
    title: "생일 파티", description: "지인 생일 축하 모임",
    status: "completed",
    schedule: makeSchedule(-7, 18, 21, "cat-personal", false, "레스토랑", []),
    completedAt: makeDate(-7, 21),
  }));

  // --- 투두 아이템 ---
  nodes.push(createNode({
    id: "todo-1", workspaceId: ws, type: "todo", projectId: project1Id,
    title: "Q3 보고서 작성", description: "분기별 실적 보고서 초안 작성",
    status: "in_progress",
    priority: { urgency: 5, importance: 4, score: 4.4 },
    schedule: { startAt: makeDate(0, 0), endAt: makeDate(2, 0), dueAt: makeDate(2, 18), allDay: true, category: "cat-work", location: null, attendees: [], reminders: [] },
    estimatedDuration: 240,
  }));

  nodes.push(createNode({
    id: "todo-2", workspaceId: ws, type: "todo", projectId: project1Id,
    title: "이메일 확인 및 회신", description: "미처리 이메일 12건",
    status: "scheduled",
    priority: { urgency: 4, importance: 3, score: 3.4 },
    schedule: { startAt: makeDate(0, 0), endAt: makeDate(0, 0), dueAt: makeDate(0, 18), allDay: true, category: "cat-work", location: null, attendees: [], reminders: [] },
    estimatedDuration: 30,
  }));

  nodes.push(createNode({
    id: "todo-3", workspaceId: ws, type: "todo", projectId: project2Id,
    title: "식단 계획 수립", description: "다음 주 식단 미리 계획하기",
    status: "scheduled",
    priority: { urgency: 3, importance: 3, score: 3 },
    schedule: { startAt: makeDate(1, 0), endAt: makeDate(1, 0), dueAt: makeDate(1, 18), allDay: true, category: "cat-health", location: null, attendees: [], reminders: [] },
    estimatedDuration: 30,
  }));

  nodes.push(createNode({
    id: "todo-4", workspaceId: ws, type: "todo", projectId: project1Id,
    title: "TypeScript 강의 수강", description: "Udemy TS 고급 과정 Section 5",
    status: "scheduled",
    priority: { urgency: 2, importance: 4, score: 3.2 },
    schedule: { startAt: makeDate(3, 0), endAt: makeDate(3, 0), dueAt: makeDate(5, 18), allDay: true, category: "cat-study", location: null, attendees: [], reminders: [] },
    estimatedDuration: 90,
  }));

  nodes.push(createNode({
    id: "todo-5", workspaceId: ws, type: "todo", projectId: "unsorted",
    title: "서점 방문", description: "새로 나온 개발 서적 구매",
    status: "scheduled",
    priority: { urgency: 1, importance: 2, score: 1.6 },
    schedule: { startAt: makeDate(4, 0), endAt: makeDate(4, 0), dueAt: makeDate(7, 18), allDay: true, category: "cat-personal", location: null, attendees: [], reminders: [] },
    estimatedDuration: 60,
  }));

  nodes.push(createNode({
    id: "todo-6", workspaceId: ws, type: "todo", projectId: project1Id,
    title: "UI 디자인 피드백 반영", description: "디자이너 피드백 사항 수정",
    status: "completed",
    priority: { urgency: 5, importance: 5, score: 5 },
    schedule: { startAt: makeDate(-1, 0), endAt: makeDate(-1, 0), dueAt: makeDate(0, 18), allDay: true, category: "cat-work", location: null, attendees: [], reminders: [] },
    estimatedDuration: 120,
    completedAt: makeDate(-1, 17),
  }));

  // --- 프로젝트 하위 목표 ---
  nodes.push(createNode({
    id: "sub-1", workspaceId: ws, type: "goal", projectId: project1Id, parentId: project1Id,
    title: "프로젝트 A 성공적 론칭", description: "",
    status: "in_progress", progress: 45,
    priority: { urgency: 5, importance: 5, score: 5 },
  }));

  nodes.push(createNode({
    id: "sub-2", workspaceId: ws, type: "goal", projectId: project1Id, parentId: project1Id,
    title: "신규 비즈니스 모델 검증", description: "",
    status: "scheduled", progress: 15,
    priority: { urgency: 4, importance: 4, score: 4 },
  }));

  nodes.push(createNode({
    id: "sub-3", workspaceId: ws, type: "goal", projectId: project2Id, parentId: project2Id,
    title: "주 3회 운동 루틴 유지", description: "",
    status: "in_progress", progress: 70,
    priority: { urgency: 3, importance: 5, score: 4.2 },
  }));

  return nodes;
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