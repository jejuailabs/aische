// 주제 승격 조건 검증
//   node --experimental-strip-types scripts/test-topic.mjs
import { shouldPromoteTopic } from "../src/lib/types.ts";

let pass = 0;
const failures = [];
const check = (name, actual, expected) => {
  if (actual === expected) { console.log(`ok    ${name}`); pass++; }
  else failures.push(`${name} — got ${actual}, expected ${expected}`);
};

const topic = (over = {}) => ({
  id: "t", workspaceId: "w", label: "제주 이주",
  aliases: [], notes: [], nodeIds: [], sourceInputIds: [],
  status: "collecting", promotedProjectId: null,
  createdAt: new Date(), updatedAt: new Date(),
  ...over,
});
const note = (i) => ({ id: "n" + i, text: "메모" + i, capturedInputId: null, createdAt: new Date() });

// 핵심 규칙: 행동(노드)이 붙어야 승격. 메모만 쌓이는 건 아직 프로젝트가 아니다.
check("메모 0 + 행동 0 → 승격 안 함", shouldPromoteTopic(topic()), false);
check("메모 1 + 행동 0 → 승격 안 함", shouldPromoteTopic(topic({ notes: [note(1)] })), false);
check("메모 5 + 행동 0 → 승격 안 함 (잡생각은 프로젝트 아님)",
  shouldPromoteTopic(topic({ notes: [1,2,3,4,5].map(note) })), false);
check("메모 0 + 행동 1 → 승격 안 함 (단발 일정)",
  shouldPromoteTopic(topic({ nodeIds: ["a"] })), false);
check("메모 1 + 행동 1 → 승격 (행동이 붙었고 2건)",
  shouldPromoteTopic(topic({ notes: [note(1)], nodeIds: ["a"] })), true);
check("메모 0 + 행동 2 → 승격",
  shouldPromoteTopic(topic({ nodeIds: ["a", "b"] })), true);
check("메모 3 + 행동 1 → 승격",
  shouldPromoteTopic(topic({ notes: [1,2,3].map(note), nodeIds: ["a"] })), true);

// 이미 승격됐거나 보관된 주제는 다시 제안하지 않는다
check("이미 승격됨 → 재제안 안 함",
  shouldPromoteTopic(topic({ notes: [note(1)], nodeIds: ["a"], status: "promoted" })), false);
check("보관됨 → 제안 안 함",
  shouldPromoteTopic(topic({ notes: [note(1)], nodeIds: ["a"], status: "archived" })), false);

for (const f of failures) console.log(`FAIL  ${f}`);
console.log(`\n${pass} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
