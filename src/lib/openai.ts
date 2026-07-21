// 이 파일은 하위호환용 재수출 계층이다.
// 실제 구현은 llm.ts로 옮겼다 — 프로바이더(OpenAI/Anthropic)를 env로
// 갈아끼울 수 있어야 해서, 파일 이름이 openai로 고정돼 있으면 곤란하다.
//
// 새 코드는 `@/lib/llm`에서 직접 import 할 것.

export {
  chat,
  parseJson,
  todayInfo,
  getModel,
  getProvider,
  LLMError,
  OpenAIError,
  type ChatOptions,
  type Provider,
} from "./llm";
