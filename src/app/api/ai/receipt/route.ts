// ==========================================
// 영수증 / 결제내역 이미지 분석
// ==========================================
//
// 이미지를 비전 모델에 넣어 고정비 후보를 뽑는다.
// 결과는 바로 저장하지 않고 초안으로 돌려준다 (Draft→Confirm 원칙).
//
// ⚠️ 카드번호는 뽑지 않는다. 영수증에 전체 번호가 찍혀 있어도 끝 4자리만 읽는다.

import { NextRequest, NextResponse } from "next/server";
import { chat, parseJson, OpenAIError } from "@/lib/llm";
import { composeSystem } from "@/lib/doctrine";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// Vercel 서버리스 함수는 **요청 본문 4.5MB**에서 잘린다. 우리 코드에 닿기 전에
// 플랫폼이 413(FUNCTION_PAYLOAD_TOO_LARGE)으로 끊는다.
// 이미지는 data URL(base64)로 오므로 원본의 약 4/3 크기가 되고,
// JSON 래핑과 methods/categories 배열도 같이 실린다.
//   4.5MB × 0.75 ≈ 3.37MB → 여유를 둬 3MB로 잡는다.
// 이전 값(6MB)은 절대 도달할 수 없어서, 사용자는 우리 안내문 대신
// 플랫폼의 정체불명 413을 봤다.
const MAX_BYTES = 3 * 1024 * 1024;

interface Body {
  /** data:image/...;base64,... 형태 */
  image: string;
  /** 매칭에 쓸 기존 결제수단 (끝 4자리로 대조) */
  methods: { id: string; issuer: string; last4: string; label: string }[];
  categories: { id: string; label: string }[];
}

export async function POST(req: NextRequest) {
  if (!OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured" },
      { status: 500 }
    );
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const image = body.image ?? "";
  if (!image.startsWith("data:image/")) {
    return NextResponse.json(
      { error: "이미지 형식이 올바르지 않습니다" },
      { status: 400 }
    );
  }
  // base64는 원본의 약 4/3 크기
  if (image.length * 0.75 > MAX_BYTES) {
    return NextResponse.json(
      { error: "이미지가 너무 큽니다 (최대 3MB). 사진 크기를 줄여서 다시 올려주세요." },
      { status: 413 }
    );
  }

  const methods = body.methods ?? [];
  const categories = body.categories ?? [];
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const fmt = (a: string[]) => (a.length ? a.join("\n") : "(없음)");

  const system = composeSystem(
    `너는 영수증·결제내역 이미지에서 **고정비(구독) 정보**를 뽑는 엔진이다.

오늘: ${todayStr}

## 등록된 결제수단 (끝 4자리로 대조해라)
${fmt(methods.map((m) => `- id:"${m.id}" ${m.issuer} ****${m.last4} (${m.label})`))}
## 카테고리
${fmt(categories.map((c) => `- id:"${c.id}" label:"${c.label}"`))}`,
    ["UNCERTAIN"],
    `## 출력 (JSON only)
{
  "items": [
    {
      "title": "상호명 또는 서비스명 (예: 넷플릭스, 스타벅스)",
      "amount": 숫자만 (원 단위, 콤마·원 기호 제거),
      "currency": "KRW",
      "paidAtExpr": "영수증에 찍힌 날짜 원문 또는 null",
      "paymentDay": 결제일로 쓸 일자 1~31 (날짜를 읽었으면 그 일자, 못 읽으면 null),
      "cycle": "monthly" | "yearly" | "once",
      "last4": "영수증에서 읽은 카드 끝 4자리 또는 null",
      "matchedMethodId": "위 목록에서 끝4자리가 일치하는 id 또는 null",
      "categoryId": "위 카테고리 id 또는 null",
      "confidence": 0-100
    }
  ],
  "note": "읽기 어려웠던 부분이 있으면 한 줄로. 없으면 null"
}

## 규칙
1. **카드번호는 끝 4자리만 읽어라.** 전체 번호가 찍혀 있어도 앞자리는 절대 출력하지 마라.
2. 금액은 숫자만. "13,500원" → 13500.
3. 구독 서비스로 보이면 cycle="monthly", 연간 결제 표시가 있으면 "yearly",
   일회성 소비(식당·마트 등)로 보이면 "once".
4. 영수증 한 장에 여러 건이 찍혀 있으면(카드 명세서 등) items에 전부 담아라.
5. 흐릿해서 확신이 없으면 confidence를 낮게 주고, 못 읽은 필드는 null로 둬라.
   **추측해서 지어내지 마라.** 틀린 금액이 저장되는 게 빈 값보다 나쁘다.
6. 고정비와 무관한 이미지면 items: [] 로 반환하라.

JSON만. 코드펜스 금지.`
  );

  try {
    const raw = await chat({
      system,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "이 이미지에서 고정비 정보를 뽑아줘." },
            { type: "image_url", image_url: { url: image, detail: "high" } },
          ],
        },
      ],
      json: true,
      maxTokens: 1200,
      temperature: 0.1,
    });

    const parsed = parseJson(raw);

    // 방어: 혹시라도 전체 카드번호가 넘어오면 끝 4자리로 잘라낸다
    const items = (Array.isArray(parsed.items) ? parsed.items : []).map(
      (it: any) => ({
        title: String(it.title ?? "").slice(0, 80),
        amount: Number(it.amount) || 0,
        currency: it.currency ?? "KRW",
        paidAtExpr: it.paidAtExpr ?? null,
        paymentDay:
          it.paymentDay != null
            ? Math.min(31, Math.max(1, Number(it.paymentDay)))
            : null,
        cycle: ["monthly", "yearly", "once"].includes(it.cycle)
          ? it.cycle
          : "monthly",
        last4: it.last4 ? String(it.last4).replace(/\D/g, "").slice(-4) : null,
        matchedMethodId: it.matchedMethodId ?? null,
        categoryId: it.categoryId ?? null,
        confidence: Math.min(100, Math.max(0, Number(it.confidence) || 0)),
      })
    );

    return NextResponse.json({ items, note: parsed.note ?? null });
  } catch (err: any) {
    console.error("[receipt] error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
