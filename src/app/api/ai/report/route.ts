// ==========================================
// 프로젝트 리포트 — AI 해석
// ==========================================
//
// 숫자는 이미 클라이언트에서 buildDossier()가 계산해 보낸다.
// 여기서 AI가 하는 일은 **해석과 서술**뿐이다.
// 숫자를 다시 세거나 없는 사실을 만들어내지 못하게 강하게 제약한다.

import { NextRequest, NextResponse } from "next/server";
import type { ProjectDossier, ProjectSignal } from "@/lib/report";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const RAW_MODEL = process.env.OPENAI_TEXT_MODEL || "gpt-4o-mini";
const MODEL = RAW_MODEL === "gpt-5-mini" ? "gpt-4o-mini" : RAW_MODEL;

interface Body {
  dossier: ProjectDossier;
  signals: ProjectSignal[];
  /** 실제 완료율 (코드 계산값) */
  actualProgress: number;
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

  const d = body.dossier;
  if (!d?.project?.id) {
    return NextResponse.json({ error: "dossier 없음" }, { status: 400 });
  }

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const system = `너는 프로젝트 진행 상황을 읽고 **통찰이 있는 리포트**를 쓰는 분석가다.

오늘: ${todayStr}

## 절대 규칙
1. **숫자를 새로 만들지 마라.** 아래 데이터에 있는 값만 인용한다.
   진행률·건수·날짜를 네가 계산하거나 추정하지 마라. 이미 계산돼 있다.
2. 데이터에 없는 사실을 쓰지 마라. 모르면 "기록이 없다"고 써라.
3. **숫자를 나열하지 마라. 그 숫자가 무슨 뜻인지 써라.**
   나쁨: "완료 3건, 미착수 5건입니다."
   좋음: "8건 중 3건만 끝났고, 최근 두 달간 완료된 게 없습니다. 초기에 몰아서 하고 멈춘 패턴입니다."
4. 문제를 발견하면 돌려 말하지 마라. 정체돼 있으면 정체됐다고 써라.
5. 한국어. 담백한 서술체. 과장·응원 문구 금지.

## 출력 (JSON only)
{
  "headline": "이 프로젝트의 현재 상태를 한 문장으로",
  "summary": "2~4문장 개요. 무엇을 하는 프로젝트이고 지금 어디까지 왔는지",
  "progressReading": "진행 상황 해석 2~4문장. 숫자가 아니라 패턴을 설명하라 (초기에 몰렸는지, 꾸준한지, 멈췄는지)",
  "risks": [
    { "title": "짧은 제목", "detail": "왜 문제인지 1~2문장", "severity": "info|warn|risk" }
  ],
  "nextActions": [
    { "action": "구체적인 다음 행동", "why": "왜 이걸 먼저 해야 하는지 한 문장" }
  ],
  "closing": "마무리 1~2문장. 이 프로젝트를 계속 끌고 가려면 무엇이 관건인지"
}

- risks는 아래 '자동 감지된 신호'를 기반으로 쓰되, 신호를 그대로 옮기지 말고 맥락을 붙여라.
- nextActions는 2~4개. 막연한 말("잘 관리한다") 금지. 데이터에 있는 항목명을 짚어라.
- 항목이 하나도 없는 빈 프로젝트면 솔직하게 "아직 기록된 활동이 없다"고 쓰고 nextActions만 제안하라.

JSON만. 코드펜스 금지.`;

  // AI에게 넘길 데이터는 필요한 만큼만 추린다 (토큰 절약 + 환각 여지 축소)
  const payload = {
    프로젝트: {
      이름: d.project.title,
      설명: d.project.description,
      상태: d.project.status,
      저장된진행률: d.project.progress,
      실제완료율: body.actualProgress,
    },
    집계: d.counts,
    기간: d.timeline,
    자동감지된신호: body.signals,
    // 항목이 많으면 상위 30개만 (제목이 핵심이므로)
    항목: d.tasks.slice(0, 30).map((t) => ({
      제목: t.title,
      상태: t.status,
      마감: t.dueAt,
      완료일: t.completedAt,
      마감초과: t.overdue,
      결과물미등록: t.missingDeliverable,
    })),
    월별활동: d.activity,
    관계자: d.people,
    조직: d.orgs,
    시작배경: d.origin,
  };

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
          { role: "user", content: JSON.stringify(payload, null, 1) },
        ],
        temperature: 0.4,
        max_tokens: 2000,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error("[report] OpenAI error:", res.status, detail.slice(0, 300));
      return NextResponse.json(
        { error: "리포트 생성에 실패했습니다" },
        { status: 502 }
      );
    }

    const data = await res.json();
    const raw = (data.choices?.[0]?.message?.content ?? "").trim();
    const p = JSON.parse(
      raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim()
    );

    return NextResponse.json({
      headline: String(p.headline ?? ""),
      summary: String(p.summary ?? ""),
      progressReading: String(p.progressReading ?? ""),
      risks: Array.isArray(p.risks)
        ? p.risks.slice(0, 8).map((r: any) => ({
            title: String(r.title ?? ""),
            detail: String(r.detail ?? ""),
            severity: ["info", "warn", "risk"].includes(r.severity)
              ? r.severity
              : "info",
          }))
        : [],
      nextActions: Array.isArray(p.nextActions)
        ? p.nextActions.slice(0, 6).map((a: any) => ({
            action: String(a.action ?? ""),
            why: String(a.why ?? ""),
          }))
        : [],
      closing: String(p.closing ?? ""),
      generatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[report] error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
