// ==========================================
// LLM 호출 공용 계층 (OpenAI / Anthropic)
// ==========================================
//
// 왜 이 파일이 필요한가:
//
// 1) 모델별 파라미터 규칙이 제각각이다.
//    gpt-5 계열은 `max_tokens` 대신 `max_completion_tokens`를 쓴다.
//    이걸 모르고 max_tokens를 보내면 400이 나는데, 에러 메시지를 안 보면
//    "모델이 없다"로 오해하기 쉽다. (실제로 그렇게 오진해서 더 약한 모델로
//    조용히 폴백돼 있었고, 응답 품질이 나빠졌다.)
//
// 2) 프로바이더를 바꿀 수 있어야 한다.
//    이 앱의 핵심은 한국어 문맥에서 의도를 뽑아 스케줄/사람/프로젝트로
//    분기시키는 것이고, 그건 추출이 아니라 추론이다. 모델을 바꿔서
//    실측해 볼 수 있어야 하는데, 라우트마다 fetch를 박아두면 못 바꾼다.
//
// 전환 방법: .env.local 에 아래 두 줄만 추가하면 된다. 라우트는 안 건드린다.
//   ANTHROPIC_API_KEY=sk-ant-...
//   ANTHROPIC_MODEL=claude-sonnet-5
// (강제로 한쪽만 쓰려면 LLM_PROVIDER=openai | anthropic)

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_TEXT_MODEL || "gpt-4.1-mini";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

export type Provider = "openai" | "anthropic";

/**
 * 어느 프로바이더를 쓸지.
 * 명시 설정이 없으면 Anthropic 키가 있을 때만 Anthropic을 쓴다.
 * (키 없이 전환되면 전 기능이 500으로 죽으므로 자동 전환은 키 기준으로만.)
 */
export function getProvider(): Provider {
  const forced = process.env.LLM_PROVIDER;
  if (forced === "anthropic" || forced === "openai") return forced;
  return ANTHROPIC_API_KEY ? "anthropic" : "openai";
}

export function getModel(): string {
  return getProvider() === "anthropic" ? ANTHROPIC_MODEL : OPENAI_MODEL;
}

/** gpt-5 계열인지 (파라미터 규칙이 다름) */
function isNextGenOpenAI(model: string): boolean {
  return /^gpt-5|^o1|^o3/.test(model);
}

/** 사고(thinking) 파라미터를 쓰는 Claude 계열인지 */
function isThinkingClaude(model: string): boolean {
  return /^claude-(opus-4-[678]|sonnet-5|fable-5|mythos-5)/.test(model);
}

export interface ChatOptions {
  system: string;
  messages: { role: string; content: any }[];
  /** JSON 강제 여부 */
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  /** 이 호출만 다른 모델로 */
  model?: string;
  /**
   * 도구 목록. 넘기면 모델이 도구를 호출할 수 있다.
   * 프로바이더별 형식 변환은 이 계층에서 처리한다 (tools.ts의 변환 함수 사용).
   */
  tools?: unknown[];
}

/** 모델이 요청한 도구 호출 */
export interface RawToolCall {
  id: string;
  name: string;
  /** 프로바이더에 따라 문자열(OpenAI) 또는 객체(Anthropic) */
  args: unknown;
}

/**
 * 도구를 쓸 수 있는 호출의 응답.
 *
 * text와 toolCalls는 **동시에 있을 수 있다.** 모델이 "찾아볼게요"라고 말하면서
 * 검색을 호출하는 경우다. 둘 중 하나만 보면 한쪽을 잃는다.
 */
export interface ChatResult {
  text: string;
  toolCalls: RawToolCall[];
  /** 대화 히스토리에 그대로 다시 넣어야 하는 assistant 턴 (프로바이더 원본 형태) */
  assistantTurn: unknown;
}

export class LLMError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail: string
  ) {
    super(message);
  }
}

/** 하위호환: 기존 코드가 OpenAIError를 import 하고 있다 */
export { LLMError as OpenAIError };

/**
 * LLM 호출. 프로바이더/모델별 차이를 흡수하고, 실패 시 원인을 그대로 던진다.
 * 호출측은 어느 프로바이더인지 몰라도 된다.
 */
export async function chat(opts: ChatOptions): Promise<string> {
  return getProvider() === "anthropic"
    ? chatAnthropic(opts)
    : chatOpenAI(opts);
}

/**
 * 도구를 쓸 수 있는 호출.
 *
 * chat()과 달리 문자열이 아니라 ChatResult를 돌려준다 —
 * 모델이 말을 하면서 동시에 도구를 부를 수 있기 때문이다.
 */
export async function chatWithTools(opts: ChatOptions): Promise<ChatResult> {
  return getProvider() === "anthropic"
    ? chatAnthropicTools(opts)
    : chatOpenAITools(opts);
}

// ────────────────────────── OpenAI ──────────────────────────

async function chatOpenAI(opts: ChatOptions): Promise<string> {
  if (!OPENAI_API_KEY) throw new LLMError("OPENAI_API_KEY 미설정", 500, "");

  const model = opts.model ?? OPENAI_MODEL;
  const maxTokens = opts.maxTokens ?? 1600;

  const body: Record<string, unknown> = {
    model,
    messages: [{ role: "system", content: opts.system }, ...opts.messages],
  };

  if (isNextGenOpenAI(model)) {
    // gpt-5/o 계열은 **추론 토큰이 max_completion_tokens에 포함된다.**
    // 출력 길이만 보고 잡으면 추론에 다 써버려서 본문이 빈 문자열로 돌아온다.
    body.max_completion_tokens = Math.max(4000, maxTokens * 4);
    // temperature는 기본값(1)만 허용한다. 지정하면 400.
  } else {
    body.max_tokens = maxTokens;
    body.temperature = opts.temperature ?? 0.3;
  }

  if (opts.json) body.response_format = { type: "json_object" };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error(`[openai] ${model} ${res.status}: ${detail.slice(0, 400)}`);
    throw new LLMError(`OpenAI ${res.status}`, res.status, detail);
  }

  const data = await res.json();
  const content = (data.choices?.[0]?.message?.content ?? "").trim();

  // 추론 모델이 토큰을 다 쓰면 content가 빈 문자열로 온다.
  // 그냥 넘기면 호출측에서 JSON 파싱 에러로 터지므로 원인을 밝혀 던진다.
  if (!content) {
    const reason = data.choices?.[0]?.finish_reason ?? "unknown";
    const usage = JSON.stringify(data.usage ?? {});
    console.error(`[openai] ${model} 빈 응답 (finish_reason=${reason}) usage=${usage}`);
    throw new LLMError(
      `${model} 응답이 비었습니다 (finish_reason=${reason})`,
      502,
      usage
    );
  }
  return content;
}

/**
 * OpenAI 도구 호출.
 *
 * chatOpenAI와 나눈 이유: 도구를 쓰면 content가 비고 tool_calls만 오는 게
 * 정상인데, chatOpenAI는 빈 content를 **에러로 던진다**(추론 토큰 소진을
 * 잡으려고 넣은 가드다). 그대로 재사용하면 도구를 부를 때마다 터진다.
 */
async function chatOpenAITools(opts: ChatOptions): Promise<ChatResult> {
  if (!OPENAI_API_KEY) throw new LLMError("OPENAI_API_KEY 미설정", 500, "");

  const model = opts.model ?? OPENAI_MODEL;
  const maxTokens = opts.maxTokens ?? 1600;

  const body: Record<string, unknown> = {
    model,
    messages: [{ role: "system", content: opts.system }, ...opts.messages],
  };
  if (isNextGenOpenAI(model)) {
    body.max_completion_tokens = Math.max(4000, maxTokens * 4);
  } else {
    body.max_tokens = maxTokens;
    body.temperature = opts.temperature ?? 0.3;
  }
  if (opts.tools?.length) {
    body.tools = opts.tools;
    body.tool_choice = "auto";
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error(`[openai:tools] ${model} ${res.status}: ${detail.slice(0, 400)}`);
    throw new LLMError(`OpenAI ${res.status}`, res.status, detail);
  }

  const data = await res.json();
  const msg = data.choices?.[0]?.message ?? {};

  const toolCalls: RawToolCall[] = (msg.tool_calls ?? []).map((c: any) => ({
    id: c.id,
    name: c.function?.name ?? "",
    args: c.function?.arguments ?? "{}",
  }));

  const text = (msg.content ?? "").trim();

  // 말도 없고 도구 호출도 없으면 진짜로 빈 응답이다. 이건 알려야 한다.
  if (!text && !toolCalls.length) {
    const reason = data.choices?.[0]?.finish_reason ?? "unknown";
    throw new LLMError(
      `${model} 응답이 비었습니다 (finish_reason=${reason})`,
      502,
      JSON.stringify(data.usage ?? {})
    );
  }

  return { text, toolCalls, assistantTurn: msg };
}

// ───────────────────────── Anthropic ─────────────────────────

/**
 * OpenAI 형식 메시지를 Anthropic 형식으로 변환.
 *
 * 주의할 점 두 가지:
 * - Anthropic은 system을 messages 배열이 아니라 최상위 필드로 받는다.
 * - 이미지 블록의 모양이 다르다. OpenAI는 {type:"image_url", image_url:{url}},
 *   Anthropic은 {type:"image", source:{type:"base64"|"url", ...}}.
 *   영수증 분석이 data URL을 쓰고 있으므로 그 경로를 반드시 변환해야 한다.
 */
function toAnthropicMessages(messages: { role: string; content: any }[]) {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      const role = m.role === "assistant" ? "assistant" : "user";
      if (typeof m.content === "string") return { role, content: m.content };

      const blocks = (Array.isArray(m.content) ? m.content : [m.content]).map(
        (b: any) => {
          if (b?.type === "image_url") {
            const url: string = b.image_url?.url ?? "";
            const m64 = /^data:([^;]+);base64,(.*)$/.exec(url);
            if (m64) {
              return {
                type: "image",
                source: {
                  type: "base64",
                  media_type: m64[1],
                  data: m64[2],
                },
              };
            }
            return { type: "image", source: { type: "url", url } };
          }
          return b;
        }
      );
      return { role, content: blocks };
    });
}

async function chatAnthropic(opts: ChatOptions): Promise<string> {
  if (!ANTHROPIC_API_KEY) throw new LLMError("ANTHROPIC_API_KEY 미설정", 500, "");

  const model = opts.model ?? ANTHROPIC_MODEL;
  const maxTokens = opts.maxTokens ?? 1600;

  // JSON을 강제하는 별도 파라미터 대신 시스템 프롬프트로 지시한다.
  // (스키마 강제는 output_config.format을 써야 하는데, 라우트마다 스키마가
  //  달라서 지금 구조로는 못 넣는다. 그건 라우트별로 옮길 때 같이 한다.)
  const system = opts.json
    ? `${opts.system}\n\n반드시 JSON 객체 하나만 출력한다. 설명·머리말·코드펜스를 붙이지 않는다.`
    : opts.system;

  const body: Record<string, unknown> = {
    model,
    system,
    messages: toAnthropicMessages(opts.messages),
    // 사고 토큰이 max_tokens에 포함되므로 넉넉히 잡는다.
    max_tokens: isThinkingClaude(model) ? Math.max(4000, maxTokens * 4) : maxTokens,
  };

  if (isThinkingClaude(model)) {
    // adaptive: 모델이 사안별로 사고량을 정한다. budget_tokens는 이 계열에서 400.
    body.thinking = { type: "adaptive" };
    // temperature는 이 계열에서 제거됐다. 보내면 400.
  } else if (opts.temperature !== undefined) {
    body.temperature = opts.temperature;
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error(`[anthropic] ${model} ${res.status}: ${detail.slice(0, 400)}`);
    throw new LLMError(`Anthropic ${res.status}`, res.status, detail);
  }

  const data = await res.json();

  // 안전 분류기가 막으면 200인데 stop_reason이 refusal로 온다.
  // content를 그냥 읽으면 빈 배열이라 조용히 이상하게 동작한다.
  if (data.stop_reason === "refusal") {
    const cat = data.stop_details?.category ?? "unknown";
    throw new LLMError(`${model} 요청 거부 (${cat})`, 502, JSON.stringify(data.stop_details ?? {}));
  }

  // thinking 블록이 섞여 오므로 text 블록만 모은다.
  const content = (data.content ?? [])
    .filter((b: any) => b?.type === "text")
    .map((b: any) => b.text)
    .join("")
    .trim();

  if (!content) {
    const reason = data.stop_reason ?? "unknown";
    const usage = JSON.stringify(data.usage ?? {});
    console.error(`[anthropic] ${model} 빈 응답 (stop_reason=${reason}) usage=${usage}`);
    throw new LLMError(
      `${model} 응답이 비었습니다 (stop_reason=${reason})`,
      502,
      usage
    );
  }
  return content;
}

/**
 * Anthropic 도구 호출.
 *
 * OpenAI와 응답 모양이 다르다. Anthropic은 content 블록 배열이고,
 * 그 안에 text 블록과 tool_use 블록이 섞여 온다.
 */
async function chatAnthropicTools(opts: ChatOptions): Promise<ChatResult> {
  if (!ANTHROPIC_API_KEY) throw new LLMError("ANTHROPIC_API_KEY 미설정", 500, "");

  const model = opts.model ?? ANTHROPIC_MODEL;
  const maxTokens = opts.maxTokens ?? 1600;

  const body: Record<string, unknown> = {
    model,
    system: opts.system,
    messages: toAnthropicMessages(opts.messages),
    max_tokens: isThinkingClaude(model) ? Math.max(4000, maxTokens * 4) : maxTokens,
  };
  if (isThinkingClaude(model)) {
    body.thinking = { type: "adaptive" };
  } else if (opts.temperature !== undefined) {
    body.temperature = opts.temperature;
  }
  if (opts.tools?.length) body.tools = opts.tools;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error(`[anthropic:tools] ${model} ${res.status}: ${detail.slice(0, 400)}`);
    throw new LLMError(`Anthropic ${res.status}`, res.status, detail);
  }

  const data = await res.json();
  if (data.stop_reason === "refusal") {
    const cat = data.stop_details?.category ?? "unknown";
    throw new LLMError(`${model} 요청 거부 (${cat})`, 502, JSON.stringify(data.stop_details ?? {}));
  }

  const blocks: any[] = data.content ?? [];
  const text = blocks
    .filter((b) => b?.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  const toolCalls: RawToolCall[] = blocks
    .filter((b) => b?.type === "tool_use")
    .map((b) => ({ id: b.id, name: b.name, args: b.input ?? {} }));

  if (!text && !toolCalls.length) {
    throw new LLMError(
      `${model} 응답이 비었습니다 (stop_reason=${data.stop_reason ?? "unknown"})`,
      502,
      JSON.stringify(data.usage ?? {})
    );
  }

  // 히스토리에 되돌릴 때는 content 블록 배열을 그대로 넣어야 한다.
  // (thinking 블록도 포함해서 — 편집하면 다음 턴에서 거부된다)
  return { text, toolCalls, assistantTurn: { role: "assistant", content: blocks } };
}

/**
 * 도구 실행 결과를 대화 히스토리에 넣을 형태로 만든다.
 *
 * 프로바이더마다 모양이 다르다:
 *   OpenAI    → { role: "tool", tool_call_id, content }
 *   Anthropic → { role: "user", content: [{ type: "tool_result", ... }] }
 *
 * 호출 측(클라이언트 루프)이 이 차이를 몰라도 되게 여기서 감춘다.
 */
export function formatToolResult(
  toolCallId: string,
  content: string
): Record<string, unknown> {
  if (getProvider() === "anthropic") {
    return {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: toolCallId, content },
      ],
    };
  }
  return { role: "tool", tool_call_id: toolCallId, content };
}

// ────────────────────────── 공용 ──────────────────────────

/** JSON 응답 파싱 (코드펜스 제거 포함) */
export function parseJson<T = any>(raw: string): T {
  return JSON.parse(
    raw
      .replace(/^```json\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim()
  );
}

/** 오늘 날짜 정보 (프롬프트용) */
export function todayInfo() {
  const now = new Date();
  const dow = ["일", "월", "화", "수", "목", "금", "토"][now.getDay()];
  const p = (n: number) => String(n).padStart(2, "0");
  const str = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  return { now, str, dow };
}
