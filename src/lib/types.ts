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
  /** 소속 주제 (아직 프로젝트로 승격되지 않은 묶음) */
  topicId: string | null;
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

/**
 * 주제(Topic) — 일정이 없는 애매한 입력이 모이는 곳.
 *
 * 미분류함이 "버려지는 곳"이라면 주제는 "쌓이는 곳"이다.
 * 같은 주제로 내용이 모이다가 **날짜·할일 같은 행동이 붙는 순간**
 * 프로젝트 승격을 제안한다. (메모만 쌓이는 건 아직 프로젝트가 아니다)
 */
export interface Topic {
  id: string;
  workspaceId: string;
  label: string;
  /** 같은 주제로 병합된 다른 표현들 ("제주도 이주", "이주 준비") */
  aliases: string[];
  /** 행동이 없는 메모들 */
  notes: TopicNote[];
  /** 이 주제에 붙은 일정·할일 노드 */
  nodeIds: string[];
  sourceInputIds: string[];
  status: "collecting" | "promoted" | "archived";
  /** 승격됐다면 그 프로젝트 id */
  promotedProjectId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TopicNote {
  id: string;
  text: string;
  capturedInputId: string | null;
  createdAt: Date;
}

/** 주제가 프로젝트로 승격될 조건을 만족했는지 */
export function shouldPromoteTopic(topic: Topic): boolean {
  if (topic.status !== "collecting") return false;
  // 행동(일정·할일)이 하나라도 붙었고, 전체 항목이 2개 이상일 때
  const total = topic.nodeIds.length + topic.notes.length;
  return topic.nodeIds.length >= 1 && total >= 2;
}

// ==========================================
// 일기 / 관계 로그
// ==========================================
//
// 다른 레이어와 방향이 반대다.
// 일정·고정비는 입력을 구조로 분해하고 원문을 버리지만,
// 일기는 **원문이 곧 내용**이다. AI는 원문을 고치지 않고
// 메타데이터를 옆에 붙이기만 한다.

/** 전반적 기분 (-2 ~ +2) */
export type Mood = -2 | -1 | 0 | 1 | 2;

export const MOOD_LABEL: Record<Mood, string> = {
  [-2]: "많이 힘듦",
  [-1]: "가라앉음",
  [0]: "보통",
  [1]: "괜찮음",
  [2]: "좋음",
};

export interface DiaryEntry {
  id: string;
  workspaceId: string;
  /** 사용자가 쓴 원문. AI가 절대 덮어쓰지 않는다 */
  rawText: string;
  /** 음성 입력이면 전사된 원문 */
  channel: "text" | "voice";
  /** 일기가 가리키는 날짜 (작성일과 다를 수 있음 — "어제 있었던 일") */
  entryDate: Date;

  // ── 아래는 AI가 덧붙인 메타. 원문과 별개로 보관 ──
  /** 목록에 보여줄 짧은 제목 */
  title: string;
  mood: Mood | null;
  /** 세부 감정 태그 ("서운함", "뿌듯함") */
  emotions: string[];
  /** 등장한 인물 */
  personIds: string[];
  orgIds: string[];
  places: string[];
  /** 무슨 일이 있었는지 (사실 위주 요약) */
  events: string[];
  /** 소재 태그 */
  tags: string[];
  /** AI 분석을 마쳤는지 (실패해도 원문은 남는다) */
  analyzed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 사람 한 명과의 상호작용 기록 한 건.
 *
 * 단일 점수로 사람을 규정하지 않기 위해, 판정마다
 * **근거가 된 원문 인용(quote)** 을 반드시 함께 남긴다.
 */
export interface RelationshipLog {
  id: string;
  workspaceId: string;
  personId: string;
  /** 어느 일기에서 나왔는지 (직접 추가면 null) */
  diaryEntryId: string | null;
  occurredAt: Date;
  /** 객관 — 무슨 일이 있었는지 */
  event: string;
  /** 주관 — 그때 내가 느낀 것 */
  feeling: string | null;
  /** 감정 방향 -2 ~ +2 */
  sentiment: number;
  /** 판정 근거가 된 원문 조각. 없으면 사용자가 직접 쓴 기록 */
  quote: string | null;
  createdAt: Date;
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
  /** 이 입력이 무슨 주제에 관한 것인지 */
  topic: ExtractedTopic | null;
}

export interface ExtractedTopic {
  label: string;
  /** 기존 주제와 같은 주제면 그 id (신규 남발 방지) */
  matchedTopicId: string | null;
  isNew: boolean;
}

export interface ExtractedSchedule {
  title: string;
  /**
   * 제목에 안 담긴 내용 — 무슨 이야기를 하는 자리인지, 뭘 준비하는지.
   *
   * 제목은 캘린더 한 칸에 들어가야 해서 짧다. 이게 없으면 나중에
   * "그 미팅이 무슨 건이었지"를 알 수 없다.
   */
  description?: string;
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

// ==========================================
// 결제수단 / 고정비
// ==========================================

/**
 * 결제수단.
 *
 * ⚠️ 카드번호 전체·CVC·유효기간은 저장하지 않는다.
 * "이 돈이 어느 카드에서 나가는가"를 구분하는 데는
 * 카드사 + 별칭 + 끝 4자리면 충분하고, 유출돼도 결제에 쓸 수 없다.
 */
export interface PaymentMethod {
  id: string;
  workspaceId: string;
  /** 카드사·은행명 ("신한카드", "국민은행") */
  issuer: string;
  /** 사용자가 붙인 이름 ("주력카드", "구독 전용") */
  label: string;
  /** 끝 4자리만. 그 이상은 받지 않는다 */
  last4: string;
  type: "credit" | "debit" | "account" | "cash" | "other";
  /** 카드 결제일 (1~31). 없으면 null */
  billingDay: number | null;
  color: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** 구독·고정비 */
export interface FixedCost {
  id: string;
  workspaceId: string;
  title: string;
  /** 원 단위 정수 */
  amount: number;
  currency: string;
  cycle: "monthly" | "yearly";
  /** 결제일 (1~31). 말일이 없는 달은 그 달 마지막 날로 밀린다 */
  paymentDay: number;
  /** cycle이 yearly일 때의 결제 월 (1~12) */
  paymentMonth: number | null;
  /** 어느 결제수단에서 빠지는지. 현금 등은 null */
  paymentMethodId: string | null;
  /** 카테고리 (Category.id) */
  categoryId: string | null;
  memo: string;
  startedAt: Date;
  /** 해지일. null이면 계속 나감 */
  endedAt: Date | null;
  active: boolean;
  /** 영수증/캡처 원본 참조 */
  sourceInputId: string | null;
  createdAt: Date;
  updatedAt: Date;
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
export type AppView = "calendar" | "todo" | "mandarat" | "dashboard" | "drafts" | "settings" | "admin" | "log" | "data" | "people" | "fixedcost" | "report" | "diary";
export type CalendarSubView = "monthly" | "daily";