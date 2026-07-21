// 도구 정의 테스트
//
// 여기서 잡으려는 것:
// - 쓰기 도구가 실수로 mutating=false로 새어나가는 것 (확인 게이트를 건너뛴다)
// - 필수 인자 누락을 조용히 통과시키는 것 (모델이 뭘 틀렸는지 모른 채 반복한다)
// - 모델이 JSON을 깨뜨렸을 때 대화 전체가 죽는 것

import {
  TOOLS,
  findTool,
  isMutating,
  toOpenAITools,
  toAnthropicTools,
  parseToolArgs,
  validateToolCall,
} from "../src/lib/tools.ts";

let passed = 0;
let failed = 0;

function check(name, cond, detail = "") {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}`);
  }
}

// ── 정의 자체의 건전성 ──
{
  check("도구가 하나 이상 있다", TOOLS.length > 0);
  check(
    "이름이 중복되지 않는다",
    new Set(TOOLS.map((t) => t.name)).size === TOOLS.length
  );
  for (const t of TOOLS) {
    check(`${t.name}: 설명이 있다`, t.description.length > 20);
    check(
      `${t.name}: parameters가 object 스키마다`,
      t.parameters?.type === "object"
    );
  }
}

// ── 쓰기/읽기 구분 ──
//
// 이게 틀리면 확인 없이 데이터가 바뀐다. 이름으로 하드코딩해서 검사한다 —
// 나중에 누가 mutating을 잘못 바꾸면 여기서 걸려야 한다.
{
  const mustMutate = ["update_schedule", "delete_schedule"];
  const mustNotMutate = [
    "search_schedules",
    "get_schedule",
    "search_notes",
    "search_people",
  ];

  for (const n of mustMutate) {
    check(`${n}은 쓰기 도구다 (확인 필요)`, isMutating(n) === true);
  }
  for (const n of mustNotMutate) {
    check(`${n}은 읽기 도구다`, isMutating(n) === false);
  }
  check("모르는 도구는 쓰기가 아니다", isMutating("nope") === false);
  check("모르는 도구는 null", findTool("nope") === null);
}

// ── 삭제 도구는 되돌릴 수 없다는 걸 설명에 밝혀야 한다 ──
{
  const del = findTool("delete_schedule");
  check("삭제 도구가 위험을 명시한다", /되돌릴 수 없/.test(del.description));
}

// ── 날짜를 AI가 계산하지 못하게 막았는지 ──
//
// 날짜 산술은 실제로 틀린 적이 있다("다음주 화요일"→토요일).
// 스키마 설명에서 계산하지 말라고 못 박아야 한다.
{
  const search = findTool("search_schedules");
  const de = search.parameters.properties.dateExpr.description;
  check("search: 날짜 계산 금지가 명시돼 있다", /계산/.test(de), de);

  const upd = findTool("update_schedule");
  const ude = upd.parameters.properties.dateExpr.description;
  check("update: 날짜 계산 금지가 명시돼 있다", /계산/.test(ude), ude);
}

// ── 프로바이더 형식 변환 ──
{
  const oa = toOpenAITools();
  check("OpenAI: 개수가 같다", oa.length === TOOLS.length);
  check("OpenAI: type=function", oa.every((t) => t.type === "function"));
  check(
    "OpenAI: function.name/parameters가 있다",
    oa.every((t) => t.function.name && t.function.parameters)
  );

  const an = toAnthropicTools();
  check("Anthropic: 개수가 같다", an.length === TOOLS.length);
  check(
    "Anthropic: input_schema를 쓴다",
    an.every((t) => t.input_schema && !("parameters" in t))
  );
  check(
    "두 형식의 이름 집합이 같다",
    JSON.stringify(oa.map((t) => t.function.name).sort()) ===
      JSON.stringify(an.map((t) => t.name).sort())
  );
}

// ── 인자 파싱: 모델이 깨진 걸 보내도 죽지 않아야 한다 ──
{
  check("객체는 그대로", parseToolArgs({ a: 1 }).a === 1);
  check('JSON 문자열 파싱', parseToolArgs('{"a":1}').a === 1);
  check("깨진 JSON은 빈 객체", Object.keys(parseToolArgs("{oops")).length === 0);
  check("null은 빈 객체", Object.keys(parseToolArgs(null)).length === 0);
  check("undefined는 빈 객체", Object.keys(parseToolArgs(undefined)).length === 0);
  check("배열은 빈 객체 취급 안 함(객체이므로 통과)", typeof parseToolArgs([]) === "object");
  check('숫자 JSON은 빈 객체', Object.keys(parseToolArgs("42")).length === 0);
}

// ── 호출 검증 ──
{
  const ok = validateToolCall({
    id: "1",
    name: "get_schedule",
    args: { id: "n_abc" },
  });
  check("정상 호출은 통과", ok === null, String(ok));

  const missing = validateToolCall({ id: "1", name: "get_schedule", args: {} });
  check("필수 인자 누락을 잡는다", missing !== null);
  check("무엇이 없는지 알려준다", /id/.test(missing ?? ""), String(missing));

  const empty = validateToolCall({
    id: "1",
    name: "get_schedule",
    args: { id: "" },
  });
  check("빈 문자열도 누락으로 본다", empty !== null);

  const unknown = validateToolCall({ id: "1", name: "rm_rf", args: {} });
  check("모르는 도구를 잡는다", unknown !== null);
  check("도구 이름을 알려준다", /rm_rf/.test(unknown ?? ""), String(unknown));

  // 선택 인자만 있는 도구는 인자 없이도 호출 가능해야 한다
  const noArgs = validateToolCall({
    id: "1",
    name: "search_schedules",
    args: {},
  });
  check("선택 인자뿐이면 빈 인자도 통과", noArgs === null, String(noArgs));
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
