// ==========================================
// 원칙(doctrine) 테스트
// ==========================================
//
// 이 테스트가 막으려는 것:
//
// 지금까지 AI 문제가 터질 때마다 그 라우트의 프롬프트 문자열에 규칙을 한 줄
// 추가해서 막았다. 그래서 "없는 이름 지어내지 마라"가 대화 프롬프트에만 있고
// 정작 지어내기가 일어나는 추출 프롬프트엔 없는 상태가 됐다.
// 증상은 세 번 고쳤는데 원인은 그대로였다.
//
// 그래서 두 가지를 검사한다.
//   1) composeSystem이 CORE를 반드시 싣는지 (단위 테스트)
//   2) 라우트가 composeSystem을 우회해 생짜 프롬프트를 쓰지 않는지 (소스 검사)
//
// 2번이 핵심이다. 다음에 누가(나 포함) 급해서 프롬프트에 규칙을 직접 박으면
// 여기서 걸린다.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  CORE,
  BLOCKS,
  composeSystem,
} from "../src/lib/doctrine.ts";

let passed = 0;
let failed = 0;

function check(name, cond, detail = "") {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}`);
  }
}

// ── 1. composeSystem 단위 테스트 ──

{
  const s = composeSystem("역할 설명", [], "출력 형식");

  check("CORE는 블록을 안 넘겨도 항상 실린다", s.includes(CORE));
  check("intro가 맨 앞에 온다", s.startsWith("역할 설명"));
  check("outro가 맨 뒤에 온다", s.trimEnd().endsWith("출력 형식"));
  check(
    "CORE가 intro보다 뒤, outro보다 앞",
    s.indexOf("역할 설명") < s.indexOf(CORE) &&
      s.indexOf(CORE) < s.indexOf("출력 형식")
  );
}

{
  const s = composeSystem("역할", ["TOPIC", "PERSON"], "출력");
  check("요청한 블록이 실린다 (TOPIC)", s.includes(BLOCKS.TOPIC));
  check("요청한 블록이 실린다 (PERSON)", s.includes(BLOCKS.PERSON));
  check("요청 안 한 블록은 안 실린다", !s.includes(BLOCKS.CONVERSE));
  check(
    "블록 순서가 인자 순서와 같다",
    s.indexOf(BLOCKS.TOPIC) < s.indexOf(BLOCKS.PERSON)
  );
}

// CORE에 실제로 지켜야 할 항목들이 들어 있는지.
// 문구가 통째로 지워지는 사고를 막는 최소한의 가드다.
check("CORE: 지어내기 금지", /지어내지 마라/.test(CORE));
check("CORE: 계산 금지", /계산하지 마라/.test(CORE));
check("CORE: 정보 유실 금지", /버리지 마라/.test(CORE));
check("CORE: 허위 실행 약속 금지", /하겠다고 말하지 마라/.test(CORE));

// ── 2. 라우트 소스 검사 ──
//
// AI 라우트가 composeSystem을 거치지 않고 system을 만들면 원칙이 빠진다.
// 정적으로 잡는다.

const AI_DIR = "src/app/api/ai";

function routeFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...routeFiles(p));
    else if (entry === "route.ts") out.push(p);
  }
  return out;
}

const files = routeFiles(AI_DIR);
check(`AI 라우트를 찾았다 (${files.length}개)`, files.length > 0);

for (const file of files) {
  const src = readFileSync(file, "utf8");

  // 모델을 부르지 않는 라우트(models 조회 등)는 검사 대상이 아니다.
  // chat() 과 chatWithTools() 둘 다 본다 — 새 호출 방식이 검사망을
  // 빠져나가면 원칙 없이 도는 경로가 조용히 생긴다.
  if (!/\bchat(WithTools)?\s*\(/.test(src)) continue;

  const short = file.replace(/\\/g, "/");

  // 생짜 템플릿 리터럴로 system을 만드는 패턴
  const raw = src.match(/const\s+system\s*=\s*`/g);
  check(
    `${short}: system을 직접 만들지 않는다`,
    !raw,
    raw ? `composeSystem()을 쓰세요. doctrine.ts 참고.` : ""
  );

  check(
    `${short}: composeSystem을 import 한다`,
    /from\s+["']@\/lib\/doctrine["']/.test(src)
  );

  // chat() 호출 수와 composeSystem() 호출 수가 맞는지.
  // 하나라도 빠뜨리면 그 경로만 원칙 없이 돈다.
  const chatCalls = (src.match(/\bchat(WithTools)?\s*\(\s*\{/g) ?? []).length;
  const composed = (src.match(/composeSystem\s*\(/g) ?? []).length;
  check(
    `${short}: chat() ${chatCalls}건 전부 composeSystem을 거친다 (${composed}건)`,
    composed >= chatCalls,
    `chat() ${chatCalls}건 중 composeSystem은 ${composed}건`
  );
}

// ── 결과 ──
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
