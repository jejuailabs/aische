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
  /** 반복 규칙. null이면 1회성 일정 */
  recurrence: RecurrenceRule | null;
}

/**
 * 반복 일정 규칙 (iCalendar RRULE의 축소판).
 * 회차를 미리 만들어 저장하지 않고, 조회 시점에 계산해서 펼친다.
 */
export interface RecurrenceRule {
  freq: "daily" | "weekly" | "monthly" | "yearly";
  /** 1 = 매주, 2 = 격주 */
  interval: number;
  /** weekly 전용. 0(일)~6(토). 비어 있으면 startAt의 요일을 사용 */
  byWeekday: number[];
  /** 이 날짜까지만 반복 (포함). null이면 무기한 */
  until: Date | null;
  /** 총 반복 횟수. null이면 무제한 */
  count: number | null;
  /** 개별 취소된 회차 (해당 날짜의 자정 기준) */
  exdates: Date[];
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

// ==========================================
// 실행 단위 구분 — Task vs Project
// ==========================================
//
// task    : 실행하면 끝나는 단일 미션. 완료/미완료가 직접 측정됨.
// project : 하위 task들이 모두 완료되어야 완성되는 컨테이너. 진행률은 자식에서 집계.
export type NodeKind = "task" | "project";

/** Task의 완료 판정 기준 */
export type CompletionCriteria =
  /** 사용자가 직접 체크 */
  | { mode: "manual" }
  /** 결과물 파일/링크가 등록되어야 완료 */
  | { mode: "deliverable"; deliverableRef: string | null; deliverableNote: string }
  /** 체크리스트 전 항목 완료 시 완료 */
  | { mode: "checklist"; items: ChecklistItem[] };

export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

/** Task가 완료 조건을 충족했는지 판정 */
export function isCriteriaMet(c: CompletionCriteria | null): boolean {
  if (!c) return false;
  switch (c.mode) {
    case "manual":
      return true; // 수동 체크는 호출 시점이 곧 완료
    case "deliverable":
      return !!c.deliverableRef;
    case "checklist":
      return c.items.length > 0 && c.items.every((i) => i.done);
  }
}

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

  // --- 실행 단위 구분 ---
  /** task = 실행하면 끝 / project = 하위 완료로 완성 */
  kind: NodeKind;
  /** kind가 task일 때의 완료 판정 기준 (project는 null) */
  completion: CompletionCriteria | null;
  /** kind가 project일 때, 자식 전부 완료 시 자동 완료 처리할지 */
  autoCompleteFromChildren: boolean;

  // --- 관계 레이어 참조 ---
  personIds: string[];
  orgIds: string[];
  /** 이 노드를 만들어낸 원본 입력 (CapturedInput.id) */
  capturedInputId: string | null;
}

// ==========================================
// 정보 레이어 — 인물 / 조직 / 원본 입력
// ==========================================

/** 인물 (명함·연락처 레이어) */
export interface Person {
  id: string;
  workspaceId: string;
  name: string;
  /** 소속 조직명 (Organization.name과 느슨하게 연결) */
  org: string | null;
  orgId: string | null;
  role: string | null;        // 직함 / 역할
  phone: string | null;
  email: string | null;
  note: string;
  tags: string[];
  /** 이 인물이 등장한 일정·프로젝트 노드들 */
  relatedNodeIds: string[];
  /** 어느 원본 입력에서 추출됐는지 */
  sourceInputIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

/** 조직 / 단체 */
export interface Organization {
  id: string;
  workspaceId: string;
  name: string;
  /** 회사 / 협의회 / 학교 / 동호회 등 */
  orgType: string | null;
  note: string;
  memberIds: string[];        // Person.id
  relatedNodeIds: string[];
  sourceInputIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 원본 입력 축적 레이어.
 * 사용자가 넣은 raw 텍스트와 AI 추출 결과를 그대로 보존한다.
 * 향후 데이터가 쌓였을 때 재분석·재학습의 소스가 된다.
 */
export interface CapturedInput {
  id: string;
  workspaceId: string;
  rawText: string;
  channel: InputChannel;
  /** AI가 뽑아낸 구조화 결과 (원본 JSON 보존) */
  extraction: ExtractionResult | null;
  /** 이 입력에서 실제로 생성된 것들 */
  appliedNodeIds: string[];
  appliedPersonIds: string[];
  appliedOrgIds: string[];
  createdAt: Date;
}

/** AI가 입력 하나를 분해해 만든 정보 층 */
export interface ExtractionResult {
  /** 한 줄 요약 */
  summary: string;
  /** 이 입력이 무엇인지 — 일정/할일/목표/메모/명함 등 */
  intent: "schedule" | "todo" | "goal" | "contact" | "note" | "mixed";
  schedule: ExtractedSchedule | null;
  people: ExtractedPerson[];
  organizations: ExtractedOrg[];
  project: ExtractedProject | null;
  /** 입력에서 파생되는 실행 항목들 */
  tasks: ExtractedTask[];
  /** 어디에도 안 들어간 잔여 정보 */
  notes: string[];
}

export interface ExtractedSchedule {
  title: string;
  /** AI가 입력에서 뽑은 날짜 표현 원문 ("다음주 화요일") — 서버가 이걸로 재계산 */
  dateExpr: string | null;
  startAt: string | null;   // ISO
  endAt: string | null;
  dueAt: string | null;
  allDay: boolean;
  location: string | null;
  categoryId: string | null;
}

export interface ExtractedPerson {
  name: string;
  role: string | null;
  org: string | null;
  phone: string | null;
  email: string | null;
  /** 기존 Person과 매칭됐다면 그 id */
  matchedPersonId: string | null;
  isNew: boolean;
}

export interface ExtractedOrg {
  name: string;
  orgType: string | null;
  matchedOrgId: string | null;
  isNew: boolean;
}

export interface ExtractedProject {
  matchedProjectId: string | null;
  matchConfidence: number;      // 0~100
  /** 매칭 실패 시 AI가 제안하는 신규 프로젝트명 */
  newProjectSuggestion: string | null;
}

export interface ExtractedTask {
  title: string;
  kind: NodeKind;
  /** 마감 날짜 표현 원문 — 서버가 재계산 */
  dueExpr: string | null;
  dueAt: string | null;
  completionMode: "manual" | "deliverable" | "checklist";
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
export type AppView = "calendar" | "todo" | "mandarat" | "dashboard" | "drafts" | "settings" | "admin" | "log" | "data" | "people";
export type CalendarSubView = "monthly" | "daily";