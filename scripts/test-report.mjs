// 프로젝트 리포트 집계 검증
//   node --experimental-strip-types scripts/test-report.mjs
import { buildDossier, detectSignals, actualProgress } from "../src/lib/report.ts";

let pass = 0;
const failures = [];
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`ok    ${name}`); pass++; }
  else failures.push(`${name} — got ${a}, expected ${e}`);
};

const NOW = new Date(2026, 6, 20); // 2026-07-20

const node = (over = {}) => ({
  id: "n", workspaceId: "w", parentId: null, childrenIds: [], projectId: "p1",
  type: "todo", title: "항목", description: "", status: "scheduled",
  priority: { urgency: 3, importance: 3, score: 3 }, progress: 0,
  createdAt: new Date(2026, 4, 1), updatedAt: NOW, completedAt: null,
  assignee: null, tags: [], estimatedDuration: 60, actualDuration: null,
  schedule: null, dependency: { blockedBy: [], blocks: [] }, aiMeta: null,
  kind: "task", completion: { mode: "manual" }, autoCompleteFromChildren: true,
  personIds: [], orgIds: [], topicId: null, capturedInputId: null,
  ...over,
});
const sched = (dueAt) => ({
  startAt: dueAt, endAt: dueAt, dueAt, allDay: true, category: "",
  location: null, attendees: [], reminders: [], recurrence: null,
});
const log = (action, d) => ({
  id: "l" + Math.random(), nodeId: "n", workspaceId: "w", action,
  before: null, after: null, actor: "u", timestamp: d,
});
const project = { id: "p1", title: "제주 이주", progress: 40, memberCount: 1, updatedAt: NOW };

// ── 기본 집계 ──
{
  const nodes = [
    node({ id: "p1", kind: "project", type: "goal", description: "이주 준비" }), // 루트
    node({ id: "a", status: "completed", completedAt: new Date(2026, 5, 1) }),
    node({ id: "b", status: "in_progress" }),
    node({ id: "c", status: "scheduled" }),
  ];
  const d = buildDossier({ project, nodes, logs: [], people: [], orgs: [], topic: null, now: NOW });
  check("루트는 항목 수에서 제외", d.counts.total, 3);
  check("완료 수", d.counts.completed, 1);
  check("진행중 수", d.counts.inProgress, 1);
  check("미착수 수", d.counts.notStarted, 1);
  check("실제 진행률 재계산", actualProgress(d), 33);
  check("루트 설명 반영", d.project.description, "이주 준비");
}

// ── 마감 초과 ──
{
  const nodes = [
    node({ id: "p1", kind: "project" }),
    node({ id: "a", schedule: sched(new Date(2026, 6, 10)) }),          // 지남
    node({ id: "b", schedule: sched(new Date(2026, 6, 25)) }),          // 안 지남
    node({ id: "c", status: "completed", schedule: sched(new Date(2026, 6, 1)) }), // 완료는 제외
    node({ id: "d", status: "cancelled", schedule: sched(new Date(2026, 6, 1)) }), // 취소도 제외
  ];
  const d = buildDossier({ project, nodes, logs: [], people: [], orgs: [], topic: null, now: NOW });
  check("마감 초과는 미완료만", d.counts.overdue, 1);
}

// ── 결과물 미등록 / 차단 ──
{
  const nodes = [
    node({ id: "p1", kind: "project" }),
    node({ id: "a", completion: { mode: "deliverable", deliverableRef: null, deliverableNote: "" } }),
    node({ id: "b", completion: { mode: "deliverable", deliverableRef: "file.pdf", deliverableNote: "" } }),
    node({ id: "c", status: "completed", completion: { mode: "deliverable", deliverableRef: null, deliverableNote: "" } }),
    node({ id: "e", dependency: { blockedBy: ["a"], blocks: [] } }),
  ];
  const d = buildDossier({ project, nodes, logs: [], people: [], orgs: [], topic: null, now: NOW });
  check("결과물 미등록 (완료건 제외)", d.counts.missingDeliverable, 1);
  check("차단된 항목", d.counts.blocked, 1);
}

// ── 활동 이력 / 정체 ──
{
  const nodes = [node({ id: "p1", kind: "project" }), node({ id: "a" })];
  const logs = [
    log("create", new Date(2026, 3, 5)),
    log("complete", new Date(2026, 4, 10)),
    log("update", new Date(2026, 4, 20)),
  ];
  const d = buildDossier({ project, nodes, logs, people: [], orgs: [], topic: null, now: NOW });
  check("월별 버킷 수", d.activity.length, 2);
  check("4월 생성 1건", d.activity[0], { period: "2026-04", created: 1, completed: 0, updated: 0 });
  check("5월 완료1 수정1", d.activity[1], { period: "2026-05", created: 0, completed: 1, updated: 1 });
  check("마지막 활동 이후 일수", d.timeline.daysSinceLastActivity, 61);

  const sigs = detectSignals(d);
  check("정체 신호 잡힘", sigs.some((s) => s.kind === "stalled" && s.severity === "risk"), true);
}

// ── 관계자 / 출처 ──
{
  const nodes = [
    node({ id: "p1", kind: "project" }),
    node({ id: "a", personIds: ["u1"], orgIds: ["o1"] }),
  ];
  const people = [
    { id: "u1", name: "강소희", role: "연구원", org: "제주소통협력센터" },
    { id: "u2", name: "무관한사람", role: null, org: null },
  ];
  const orgs = [
    { id: "o1", name: "제주소통협력센터", orgType: "기관" },
    { id: "o2", name: "무관한조직", orgType: null },
  ];
  const topic = { label: "제주 이주", notes: [{ text: "물류비 비쌈" }, { text: "학교 알아봐야" }] };
  const d = buildDossier({ project, nodes, logs: [], people, orgs, topic, now: NOW });
  check("관련 인물만 포함", d.people.map((p) => p.name), ["강소희"]);
  check("관련 조직만 포함", d.orgs.map((o) => o.name), ["제주소통협력센터"]);
  check("출처 주제 메모 보존", d.origin.notes, ["물류비 비쌈", "학교 알아봐야"]);
}

// ── 건강한 프로젝트 ──
{
  const nodes = [node({ id: "p1", kind: "project" }), node({ id: "a", status: "completed" })];
  const d = buildDossier({
    project, nodes, logs: [log("complete", new Date(2026, 6, 18))],
    people: [], orgs: [], topic: null, now: NOW,
  });
  const sigs = detectSignals(d);
  check("문제 없으면 healthy", sigs.map((s) => s.kind), ["healthy"]);
}

for (const f of failures) console.log(`FAIL  ${f}`);
console.log(`\n${pass} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
