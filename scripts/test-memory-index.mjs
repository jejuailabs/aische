// 기억 인덱스 테스트
//
// 핵심적으로 지키려는 성질:
// - 분석 실패한 입력도 인덱스에서 빠지지 않는다 (원문이라도 남아야 찾을 수 있다)
// - 잘렸으면 잘렸다고 말한다 (AI가 "이게 전부"로 착각하면 틀린 단정을 한다)
// - 비었을 때 섹션이 사라지지 않는다 (개념 자체가 없다고 보고 지어내기 시작한다)

import {
  buildIndexEntry,
  buildIndex,
  renderEntry,
  renderIndex,
  selectEntries,
} from "../src/lib/memory-index.ts";

let passed = 0;
let failed = 0;

function check(name, cond, detail = "") {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}`);
  }
}

const cap = (over = {}) => ({
  id: "c1",
  workspaceId: "w",
  rawText: "원문",
  channel: "text",
  extraction: null,
  appliedNodeIds: [],
  appliedPersonIds: [],
  appliedOrgIds: [],
  createdAt: new Date(2026, 6, 21),
  ...over,
});

const ex = (over = {}) => ({
  summary: "요약",
  intent: "schedule",
  schedule: null,
  people: [],
  organizations: [],
  project: null,
  tasks: [],
  notes: [],
  topic: null,
  ...over,
});

// ── 기본 ──
{
  const e = buildIndexEntry(
    cap({
      extraction: ex({
        summary: "강소희와 AX 강의 사전미팅",
        people: [{ name: "강소희" }],
        schedule: { title: "AX 강의 사전미팅" },
        topic: { label: "AX 강의 준비" },
      }),
    })
  );
  check("날짜가 YYYY-MM-DD", e.date === "2026-07-21", e.date);
  check("요약이 title로", e.title === "강소희와 AX 강의 사전미팅");
  check("인물이 entities에", e.entities.includes("강소희"));
  check("일정 제목도 entities에", e.entities.includes("AX 강의 사전미팅"));
  check("주제 라벨", e.topic === "AX 강의 준비");
  check("kind는 intent", e.kind === "schedule");
}

// ── 분석 실패한 입력도 살린다 ──
{
  const e = buildIndexEntry(
    cap({ extraction: null, rawText: "제주 이주 물류비가 생각보다 비싸네" })
  );
  check("extraction 없어도 title이 원문에서 나온다", e.title.startsWith("제주 이주"));
  check("extraction 없으면 kind=note", e.kind === "note");
  check("entities는 빈 배열", e.entities.length === 0);
}

// ── 중복 제거 ──
{
  const e = buildIndexEntry(
    cap({
      extraction: ex({
        people: [{ name: "김철수" }, { name: "김철수" }],
        tasks: [{ title: "김철수" }],
      }),
    })
  );
  check("같은 이름은 한 번만", e.entities.filter((x) => x === "김철수").length === 1);
}

// ── 긴 문자열 자르기 ──
{
  const e = buildIndexEntry(
    cap({ extraction: ex({ summary: "가".repeat(200) }) })
  );
  check("title이 잘린다", e.title.length <= 44, `len=${e.title.length}`);
  check("잘렸으면 말줄임표", e.title.endsWith("…"));
}

// ── 정렬 ──
{
  const idx = buildIndex([
    cap({ id: "b", createdAt: new Date(2026, 6, 20) }),
    cap({ id: "a", createdAt: new Date(2026, 6, 1) }),
    cap({ id: "c", createdAt: new Date(2026, 6, 25) }),
  ]);
  check("오래된 것이 앞", idx.map((e) => e.id).join("") === "abc", idx.map((e) => e.id).join(""));
}

// ── 선택: 자를 때 오래된 것부터 버린다 ──
{
  const entries = Array.from({ length: 10 }, (_, i) =>
    buildIndexEntry(cap({ id: `n${i}`, createdAt: new Date(2026, 6, i + 1) }))
  );

  const all = selectEntries(entries, { limit: 20 });
  check("한도 이하면 전부", all.selected.length === 10 && all.omitted === 0);

  const cut = selectEntries(entries, { limit: 3 });
  check("한도만큼만 남는다", cut.selected.length === 3);
  check("생략 건수를 보고한다", cut.omitted === 7, String(cut.omitted));
  check(
    "최신 것이 남는다",
    cut.selected.map((e) => e.id).join(",") === "n7,n8,n9",
    cut.selected.map((e) => e.id).join(",")
  );

  const since = selectEntries(entries, { since: "2026-07-08" });
  check("since로 거른다", since.selected.length === 3, String(since.selected.length));
}

// ── 렌더 ──
{
  const e = buildIndexEntry(
    cap({
      extraction: ex({
        summary: "사전미팅",
        people: [{ name: "강소희" }],
        topic: { label: "AX 강의 준비" },
      }),
    })
  );
  const line = renderEntry(e);
  check("날짜는 MM-DD로 짧게", line.startsWith("[07-21]"), line);
  check("인물이 보인다", line.includes("강소희"), line);
  check("주제가 보인다", line.includes("주제:AX 강의 준비"), line);
}

{
  const empty = renderIndex([]);
  check("비어도 섹션이 남는다", empty.includes("지금까지 쌓인 기록"));
  check("비었음을 명시", empty.includes("없음"));
}

{
  const entries = Array.from({ length: 5 }, (_, i) =>
    buildIndexEntry(cap({ id: `n${i}`, createdAt: new Date(2026, 6, i + 1) }))
  );
  const full = renderIndex(entries);
  check("전체일 때 건수 표시", full.includes("전체 5건"), full.split("\n")[0]);
  check("지어내기 금지 문구가 붙는다", full.includes("존재하지 않는 것으로 취급"));

  const cut = renderIndex(entries, { limit: 2 });
  check("생략됐으면 그 사실을 밝힌다", cut.includes("생략됨"), cut.split("\n")[0]);
  check("생략 건수가 맞다", cut.includes("이전 3건"), cut.split("\n")[0]);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
