// 진단용 — 이 API 키로 어떤 모델을 실제로 쓸 수 있는지 확인한다.
// GET /api/ai/models

import { NextResponse } from "next/server";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/** 후보 모델 — 품질 높은 순 */
const CANDIDATES = [
  "gpt-5-mini",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4o",
  "gpt-4o-mini",
];

export async function GET() {
  if (!OPENAI_API_KEY) {
    return NextResponse.json({ error: "no key" }, { status: 500 });
  }

  const results: Record<string, string> = {};

  for (const model of CANDIDATES) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify(
          /^gpt-5|^o1|^o3/.test(model)
            ? {
                model,
                messages: [{ role: "user", content: "1+1? 숫자만." }],
                max_completion_tokens: 16,
              }
            : {
                model,
                messages: [{ role: "user", content: "1+1? 숫자만." }],
                max_tokens: 5,
              }
        ),
      });
      if (res.ok) {
        results[model] = "ok";
      } else {
        const t = await res.text();
        const m = t.match(/"message"\s*:\s*"([^"]{0,120})/);
        results[model] = `${res.status}: ${m?.[1] ?? t.slice(0, 80)}`;
      }
    } catch (e: any) {
      results[model] = `error: ${e?.message ?? "unknown"}`;
    }
  }

  return NextResponse.json({
    configured: process.env.OPENAI_TEXT_MODEL ?? "(미설정)",
    results,
  });
}
