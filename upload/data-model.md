# data-model.md — Firestore 데이터 모델

> `core.md`의 "단일 데이터 모델" 원칙에 따라, 만다라트/캘린더/투두/간트가 공유하는 통합 스키마를 정의한다.

## 1. 설계 방향

- 만다라트 문서(첨부 스펙)에서 정의한 15개 노드 필드를 기반으로 확장
- 캘린더 이벤트, 투두 아이템은 **별도 컬렉션이 아니라 동일한 `nodes` 컬렉션의 레코드**이며, `type` 필드로 성격을 구분한다. (View는 쿼리 조건만 다를 뿐 데이터 소스는 동일)
- 모든 AI 산출물(초안, 자동생성 텍스트, 매칭 제안 등)은 Firestore/Storage에만 저장한다. 로컬/빌드 번들 저장 금지.

## 2. Node 컬렉션 스키마

`workspaces/{workspaceId}/nodes/{nodeId}`

```ts
interface Node {
  id: string;                 // 고유 ID
  workspaceId: string;
  parentId: string | null;    // 부모 노드
  childrenIds: string[];      // 자식 노드 목록 (역참조 캐시)
  projectId: string;          // 소속 프로젝트(최상위 만다라트 루트)

  type: "goal" | "task" | "calendar_event" | "todo"; // 노드 성격
  title: string;
  description: string;

  status: "예정" | "진행중" | "대기" | "검토" | "완료" | "보류" | "취소";
  priority: { urgency: number; importance: number; score: number };
  progress: number;           // 0~100, 자식 노드 기준 자동 집계

  createdAt: Timestamp;
  updatedAt: Timestamp;
  completedAt: Timestamp | null;

  assignee: string | null;    // 담당자
  tags: string[];

  estimatedDuration: number;  // 분 단위
  actualDuration: number | null;

  schedule: ScheduleInfo | null; // 캘린더/투두용, 목표 노드는 null 가능
  dependency: { blockedBy: string[]; blocks: string[] }; // 선후 관계

  aiMeta: AiMeta | null;      // AI 생성 이력 (draft 여부 등)
}
```

## 3. 일정 정보 (ScheduleInfo)

```ts
interface ScheduleInfo {
  startAt: Timestamp;
  endAt: Timestamp;
  dueAt: Timestamp | null;
  allDay: boolean;
  category: string;           // 캘린더 색상 범례와 매핑되는 카테고리 키
  location: string | null;
  attendees: string[];
  reminders: Reminder[];       // 최대 5개
}

interface Reminder {
  unit: "minute" | "hour" | "day" | "week" | "month";
  amount: number;              // 예: 1일 전 → unit=day, amount=1
}
```

- `reminders` 배열은 항목당 **최대 5개**까지 등록 가능 (시간/일/주/월 단위 조합)
- `category`는 워크스페이스별 카테고리 마스터(`categories` 컬렉션)와 연결되어 범례 색상을 결정

## 4. AI 메타데이터 (Draft → Confirm 흐름 반영)

```ts
interface AiMeta {
  status: "draft" | "confirmed";
  sourceInput: {
    channel: "voice" | "text" | "file" | "gmail" | "kakao_share" | "sms";
    rawRef: string;            // Storage 경로 (원본 입력 참조, 로컬 저장 금지)
  };
  suggestedProjectId: string | null; // AI가 자동 매칭 제안한 프로젝트
  matchConfidence: number | null;    // 매칭 신뢰도 (0~1)
  clarificationLog: { question: string; answer: string }[]; // 되묻기 대화 기록
}
```

- `status: draft`인 노드는 정식 View(캘린더/투두 등)에 노출되지 않고, "확인 대기함"에서만 보인다.
- 사용자가 Confirm하면 `status: confirmed`로 전환되며, 이때 `suggestedProjectId`가 실제 `projectId`로 반영된다.
- 매칭 실패(`suggestedProjectId: null`)한 confirmed 노드는 `projectId: "unsorted"` (미분류함)로 들어간다.

## 5. 카테고리 마스터 (캘린더 범례)

`workspaces/{workspaceId}/categories/{categoryId}`

```ts
interface Category {
  id: string;
  label: string;      // "여행", "회의", "투두" 등
  color: string;       // HEX 또는 디자인 토큰 키
  order: number;
}
```

## 6. 프로젝트(만다라트 루트)

`projectId`가 가리키는 최상위 Node 자체가 프로젝트이며, 별도 컬렉션을 두지 않는다. 단, 조회 편의를 위해 `projects` 컬렉션에 요약 캐시를 둘 수 있다.

```ts
interface ProjectSummary {
  id: string;            // = 루트 Node id
  title: string;
  progress: number;      // 하위 전체 집계
  memberCount: number;
  updatedAt: Timestamp;
}
```

## 7. 로그(변경 이력)

`workspaces/{workspaceId}/logs/{logId}`

```ts
interface LogEntry {
  id: string;
  nodeId: string;
  action: "생성" | "수정" | "삭제" | "이동" | "완료" | "일정변경" | "담당자변경";
  before: Partial<Node> | null;
  after: Partial<Node> | null;
  actor: string;         // uid, "ai" 등
  timestamp: Timestamp;
}
```

## 8. 사용자 설정

`users/{uid}/preferences`

```ts
interface UserPreferences {
  theme: "light" | "dark";
  language: string;          // ISO 코드
  homeMode: "calendar" | "dashboard" | "mandarat"; // 모바일 시작 화면
  avatarAssetRef: string;    // Storage 경로 (샘플 or 업로드)
  backgroundAssetRef: string;
  pcWorkspaceLayout: WidgetLayout[]; // PC 대시보드 위젯 배치
}
```

## 9. 진행률 자동 집계 로직 (요약)

- 자식 노드들의 `progress`를 가중 평균(또는 완료 개수 비율)하여 부모 `progress` 자동 계산
- Firestore onWrite 트리거(Cloud Functions)로 자식 변경 시 부모까지 재귀적으로 업데이트 전파
- Task → SubGoal → Goal → Project → Workspace 순으로 상향 전파
