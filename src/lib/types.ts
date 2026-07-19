// ==========================================
// data-model.md 기반 통합 타입 정의
// ==========================================

// --- 스케줄 관련 ---
export interface ScheduleInfo {
  startAt: Date;
  endAt: Date;
  dueAt: Date | null;
  allDay: boolean;
  category: string; // Category.id 참조
  location: string | null;
  attendees: string[];
  reminders: Reminder[];
}

export interface Reminder {
  id: string;
  unit: "minute" | "hour" | "day" | "week" | "month";
  amount: number;
}

// --- AI 메타데이터 ---
export type InputChannel = "voice" | "text" | "file" | "gmail" | "kakao_share" | "sms";

export interface SourceInput {
  channel: InputChannel;
  rawRef: string;
}

export interface AiMeta {
  status: "draft" | "confirmed";
  sourceInput: SourceInput;
  suggestedProjectId: string | null;
  matchConfidence: number | null;
  clarificationLog: { question: string; answer: string }[];
}

// --- 의존성 ---
export interface Dependency {
  blockedBy: string[];
  blocks: string[];
}

// --- 우선순위 ---
export interface Priority {
  urgency: number; // 1~5
  importance: number; // 1~5
  score: number; // 계산된 점수
}

// --- 노드 상태 ---
export type NodeStatus = "scheduled" | "in_progress" | "waiting" | "review" | "completed" | "on_hold" | "cancelled";

export const NODE_STATUS_LABELS: Record<NodeStatus, string> = {
  scheduled: "예정",
  in_progress: "진행중",
  waiting: "대기",
  review: "검토",
  completed: "완료",
  on_hold: "보류",
  cancelled: "취소",
};

// --- 노드 타입 ---
export type NodeType = "goal" | "task" | "calendar_event" | "todo";

// --- 핵심 Node 인터페이스 ---
export interface Node {
  id: string;
  workspaceId: string;
  parentId: string | null;
  childrenIds: string[];
  projectId: string;
  type: NodeType;
  title: string;
  description: string;
  status: NodeStatus;
  priority: Priority;
  progress: number; // 0~100
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  assignee: string | null;
  tags: string[];
  estimatedDuration: number; // 분 단위
  actualDuration: number | null;
  schedule: ScheduleInfo | null;
  dependency: Dependency;
  aiMeta: AiMeta | null;
}

// --- 카테고리 ---
export interface Category {
  id: string;
  workspaceId: string;
  label: string;
  color: string;
  darkColor: string;
  order: number;
}

// --- 프로젝트 요약 ---
export interface ProjectSummary {
  id: string;
  title: string;
  progress: number;
  memberCount: number;
  updatedAt: Date;
}

// --- 로그 ---
export type LogAction =
  | "create"
  | "update"
  | "delete"
  | "move"
  | "complete"
  | "schedule_change"
  | "assignee_change";

export interface LogEntry {
  id: string;
  nodeId: string;
  workspaceId: string;
  action: LogAction;
  before: Partial<Node> | null;
  after: Partial<Node> | null;
  actor: string;
  timestamp: Date;
}

// --- 사용자 설정 ---
export type ThemeMode = "light" | "dark";
export type HomeMode = "calendar" | "dashboard" | "mandarat";
export type Language = "ko" | "en";

export interface UserPreferences {
  theme: ThemeMode;
  language: Language;
  homeMode: HomeMode;
  avatarAssetRef: string;
  backgroundAssetRef: string;
  pcWorkspaceLayout: WidgetLayout[];
}

export interface WidgetLayout {
  id: string;
  type: "calendar" | "todo" | "mandarat" | "ai_assistant" | "notifications";
  x: number;
  y: number;
  w: number;
  h: number;
}

// --- 워크스페이스 ---
export interface Workspace {
  id: string;
  name: string;
  ownerId: string;
  memberIds: string[];
  createdAt: Date;
}

// --- 사용자 ---
export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string | null;
  role: "user" | "admin";
  preferences: UserPreferences;
  createdAt: Date;
}

// --- 캘린더 관련 헬퍼 타입 ---
export interface CalendarDay {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  events: Node[];
}

// --- 뷰 타입 ---
export type AppView = "calendar" | "todo" | "mandarat" | "dashboard" | "drafts" | "settings";
export type CalendarSubView = "monthly" | "daily";