// ==========================================
// 일기 분석 — 원문 보존형
// ==========================================
//
// 다른 추출 API와 결정적으로 다른 점:
// **원문을 절대 고치지 않는다.** 요약·교정·재작성 금지.
// AI는 원문 옆에 붙일 메타데이터(감정·인물·장소·사건)만 만든다.
//
// 그리고 사람에 대한 감정 판정에는 **근거가 된 원문 인용(quote)** 을
// 반드시 함께 내게 한다. 근거 없는 점수만 남으면 실존 인물에 대한
// 틀린 기록이 되기 때문이다.

import { NextRequest, NextResponse } from "next/server";
import { resolveDateExpr } from "@/lib/date-expr";
import { verifyQuote } from "@/lib/diary";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const RAW_MODEL = process.env.OPENAI_TEXT_MODEL || "gpt-4o-mini";
const MODEL = RAW_MODEL === "gpt-5-mini" ? "gpt-4o-mini" : RAW_MODEL;

interface Body {
  /** 사용자가 쓴/말한 원문 */
  text: string;
  channel?: "text" | "voice";
  people: { id: string; name: string; org: string | null }[];
  organizations: { id: string; name: string }[];
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

  const text = (body.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ error: "내용이 비었습니다" }, { status: 400 });
  }

  const people = body.people ?? [];
  const orgs = body.organizations ?? [];
  const now = new Date();
  const dow = ["일", "월", "화", "수", "목", "금", "토"][now.getDay()];
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const fmt = (a: string[]) => (a.length ? a.join("\n") : "(없음)");

  const system = `너는 일기를 읽고 **메타데이터만** 뽑는 엔진이다.

오늘: ${todayStr}(${dow})

## 등록된 인물
${fmt(people.map((p) => `- id:"${p.id}" name:"${p.name}" org:"${p.org ?? ""}"`))}
## 등록된 조직
${fmt(orgs.map((o) => `- id:"${o.id}" name:"${o.name}"`))}

## 절대 규칙
1. **원문을 고치거나 요약해서 돌려주지 마라.** 원문은 이미 그대로 저장된다.
   너는 원문 옆에 붙일 정보만 만든다. 맞춤법도 고치지 마라.
2. 사람에 대한 감정 판정에는 **반드시 근거가 된 원문 조각(quote)을 그대로 인용**하라.
   인용은 원문에서 글자 그대로 복사한다. 바꿔 쓰지 마라. 근거를 못 찾으면 그 사람은 빼라.
3. 쓰이지 않은 감정을 추측하지 마라. "친구를 만났다"에는 감정이 없다. mood는 null로 둬라.
4. 일기 쓴 사람 자신은 인물로 잡지 마라. ("나", "내가")

## 출력 (JSON only)
{
  "title": "목록에 보여줄 짧은 제목 (원문에서 뽑은 12자 내외)",
  "dateExpr": "일기가 가리키는 날짜 표현 원문 (\\"어제\\", \\"지난 토요일\\") 없으면 null",
  "mood": -2 | -1 | 0 | 1 | 2 | null,
  "emotions": ["서운함", "뿌듯함"],
  "events": ["있었던 일을 사실 위주로 (감정 섞지 말 것)"],
  "places": ["장소"],
  "tags": ["소재 태그"],
  "people": [
    {
      "name": "이름 또는 호칭 (원문에 나온 그대로)",
      "matchedPersonId": "위 목록에 있으면 그 id, 없으면 null",
      "event": "그 사람과 무슨 일이 있었는지 (객관)",
      "feeling": "그에 대해 내가 느낀 것 (주관). 안 드러나면 null",
      "sentiment": -2 | -1 | 0 | 1 | 2,
      "quote": "이 판정의 근거가 된 원문 조각 (글자 그대로)"
    }
  ],
  "organizations": [{"name":"", "matchedOrgId": null}]
}

## mood 기준
-2 많이 힘듦 / -1 가라앉음 / 0 보통 / 1 괜찮음 / 2 좋음
글에 감정 표현이 없으면 null. 억지로 매기지 마라.

## sentiment 기준
그 사람과의 **이번 일**에 대한 감정이다. 그 사람 자체에 대한 평가가 아니다.
같은 사람이라도 날마다 다를 수 있다.

JSON만. 코드펜스 금지.`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: text },
        ],
        temperature: 0.2,
        max_tokens: 1400,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error("[diary] OpenAI error:", res.status, detail.slice(0, 300));
      // 분석에 실패해도 원문은 저장돼야 하므로, 빈 메타를 돌려준다
      return NextResponse.json({
        analyzed: false,
        title: text.slice(0, 20),
        entryDate: null,
        mood: null,
        emotions: [],
        events: [],
        places: [],
        tags: [],
        people: [],
        organizations: [],
      });
    }

    const data = await res.json();
    const raw = (data.choices?.[0]?.message?.content ?? "").trim();
    const p = JSON.parse(
      raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim()
    );

    // 날짜 표현은 코드로 계산 (LLM 날짜 산술 불신 — date-expr.ts와 동일 원칙)
    let entryDate: string | null = null;
    if (p.dateExpr) {
      const r = resolveDateExpr(String(p.dateExpr), now);
      if (r) {
        const pad = (n: number) => String(n).padStart(2, "0");
        entryDate = `${r.date.getFullYear()}-${pad(r.date.getMonth() + 1)}-${pad(r.date.getDate())}`;
      }
    }

    const clampMood = (v: unknown): number | null => {
      const n = Number(v);
      if (v == null || Number.isNaN(n)) return null;
      return Math.max(-2, Math.min(2, Math.round(n)));
    };

    // 근거(quote)가 원문에 실제로 있는지 확인한다.
    // AI가 인용을 지어냈으면 그 사람 판정은 버린다 — 틀린 기록이 남는 것보다 낫다.
    const peopleOut = (Array.isArray(p.people) ? p.people : [])
      .map((x: any) => {
        const quote = x.quote ? String(x.quote) : null;
        const quoteFound = verifyQuote(text, quote);
        return {
          name: String(x.name ?? "").slice(0, 40),
          matchedPersonId: people.some((pp) => pp.id === x.matchedPersonId)
            ? x.matchedPersonId
            : null,
          event: String(x.event ?? "").slice(0, 200),
          feeling: x.feeling ? String(x.feeling).slice(0, 200) : null,
          sentiment: clampMood(x.sentiment) ?? 0,
          quote: quoteFound ? quote : null,
          /** 근거를 원문에서 찾지 못했음 — 화면에서 표시해 사용자가 판단하게 */
          quoteVerified: quoteFound,
        };
      })
      .filter((x: any) => x.name);

    return NextResponse.json({
      analyzed: true,
      title: String(p.title ?? text.slice(0, 20)).slice(0, 40),
      entryDate,
      mood: clampMood(p.mood),
      emotions: Array.isArray(p.emotions)
        ? p.emotions.slice(0, 8).map((s: any) => String(s).slice(0, 20))
        : [],
      events: Array.isArray(p.events)
        ? p.events.slice(0, 8).map((s: any) => String(s).slice(0, 200))
        : [],
      places: Array.isArray(p.places)
        ? p.places.slice(0, 5).map((s: any) => String(s).slice(0, 40))
        : [],
      tags: Array.isArray(p.tags)
        ? p.tags.slice(0, 8).map((s: any) => String(s).slice(0, 20))
        : [],
      people: peopleOut,
      organizations: (Array.isArray(p.organizations) ? p.organizations : [])
        .map((o: any) => ({
          name: String(o.name ?? "").slice(0, 60),
          matchedOrgId: orgs.some((oo) => oo.id === o.matchedOrgId)
            ? o.matchedOrgId
            : null,
        }))
        .filter((o: any) => o.name),
    });
  } catch (err: any) {
    console.error("[diary] error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
