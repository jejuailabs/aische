// 일기 / 관계 로그 계산 검증
//   node --experimental-strip-types scripts/test-diary.mjs
import {
  entriesOnDate, entriesInMonth, moodByMonth, writingStreak, topEmotions,
  summarizeRelationship, logsForPerson, peopleByRecency,
  driftingRelationships, sentimentLabel, isSummaryReliable,
  verifyQuote,
} from "../src/lib/diary.ts";

let pass = 0;
const failures = [];
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`ok    ${name}`); pass++; }
  else failures.push(`${name} — got ${a}, expected ${e}`);
};

const NOW = new Date(2026, 6, 20); // 2026-07-20
const d = (y, m, day) => new Date(y, m - 1, day);

const entry = (over = {}) => ({
  id: "e" + Math.random(), workspaceId: "w",
  rawText: "오늘은 그냥 그랬다", channel: "text",
  entryDate: d(2026, 7, 20), title: "일기", mood: 0, emotions: [],
  personIds: [], orgIds: [], places: [], events: [], tags: [],
  analyzed: true, createdAt: NOW, updatedAt: NOW,
  ...over,
});

const rlog = (over = {}) => ({
  id: "r" + Math.random(), workspaceId: "w", personId: "p1",
  diaryEntryId: null, occurredAt: d(2026, 7, 1),
  event: "만남", feeling: null, sentiment: 0, quote: null, createdAt: NOW,
  ...over,
});

// ── 원문 보존 확인 (설계 핵심) ──
{
  const e = entry({ rawText: "친구가 늦게 와서 좀 서운했는데, 사정 듣고 나니 이해됐다." });
  check("원문은 그대로 보존", e.rawText, "친구가 늦게 와서 좀 서운했는데, 사정 듣고 나니 이해됐다.");
}

// ── 인용 검증 (AI가 근거를 지어내는 것 차단) ──
{
  const raw = "친구가 늦게 와서 좀 서운했는데, 사정 듣고 나니 이해됐다.";
  check("원문에 있는 인용 통과", verifyQuote(raw, "좀 서운했는데"), true);
  check("공백 차이는 무시", verifyQuote(raw, "좀  서운했는데"), true);
  check("줄바꿈 차이도 무시", verifyQuote(raw, "좀\n서운했는데"), true);
  check("지어낸 인용 차단", verifyQuote(raw, "정말 화가 났다"), false);
  check("살짝 바꾼 인용도 차단", verifyQuote(raw, "많이 서운했는데"), false);
  check("빈 인용 차단", verifyQuote(raw, ""), false);
  check("null 차단", verifyQuote(raw, null), false);
}

// ── 날짜별 조회 ──
{
  const es = [
    entry({ entryDate: d(2026, 7, 20) }),
    entry({ entryDate: d(2026, 7, 20) }),
    entry({ entryDate: d(2026, 7, 19) }),
    entry({ entryDate: d(2026, 6, 20) }),
  ];
  check("당일 일기 2건", entriesOnDate(es, d(2026, 7, 20)).length, 2);
  check("7월 일기 3건", entriesInMonth(es, 2026, 6).length, 3);
}

// ── 기분 추이 ──
{
  const es = [
    entry({ entryDate: d(2026, 5, 3), mood: 2 }),
    entry({ entryDate: d(2026, 5, 10), mood: 0 }),
    entry({ entryDate: d(2026, 6, 1), mood: -2 }),
    entry({ entryDate: d(2026, 6, 5), mood: null }), // 기분 미기록은 평균에서 제외
  ];
  const m = moodByMonth(es);
  check("월 버킷 2개", m.length, 2);
  check("5월 평균 1.0", m[0], { period: "2026-05", avgMood: 1, count: 2 });
  check("6월 평균은 null 제외", m[1], { period: "2026-06", avgMood: -2, count: 2 });
}

// ── 연속 기록 ──
{
  const es = [
    entry({ entryDate: d(2026, 7, 20) }),
    entry({ entryDate: d(2026, 7, 19) }),
    entry({ entryDate: d(2026, 7, 18) }),
    entry({ entryDate: d(2026, 7, 15) }), // 끊김
  ];
  check("오늘 포함 3일 연속", writingStreak(es, NOW), 3);

  // 오늘 안 썼지만 어제까지 이어짐 → 유지
  const es2 = [entry({ entryDate: d(2026, 7, 19) }), entry({ entryDate: d(2026, 7, 18) })];
  check("오늘 안 써도 어제까지면 2일", writingStreak(es2, NOW), 2);

  // 이틀 전에 끊김
  const es3 = [entry({ entryDate: d(2026, 7, 17) })];
  check("이틀 넘게 비면 0", writingStreak(es3, NOW), 0);
  check("기록 없으면 0", writingStreak([], NOW), 0);
}

// ── 감정 태그 ──
{
  const es = [
    entry({ emotions: ["서운함", "이해"] }),
    entry({ emotions: ["서운함"] }),
    entry({ emotions: ["뿌듯함"] }),
  ];
  check("가장 잦은 감정", topEmotions(es)[0], { emotion: "서운함", count: 2 });
}

// ── 관계 요약 ──
{
  const logs = [
    rlog({ personId: "p1", occurredAt: d(2026, 3, 1), sentiment: -2 }),
    rlog({ personId: "p1", occurredAt: d(2026, 4, 1), sentiment: -1 }),
    rlog({ personId: "p1", occurredAt: d(2026, 5, 1), sentiment: 1 }),
    rlog({ personId: "p1", occurredAt: d(2026, 6, 1), sentiment: 2 }),
    rlog({ personId: "p2", occurredAt: d(2026, 7, 1), sentiment: 1 }),
  ];
  const s = summarizeRelationship(logs, "p1", NOW);
  check("기록 건수", s.logCount, 4);
  check("전체 평균 0", s.avgSentiment, 0);
  check("최근 3건 평균", Math.round(s.recentSentiment * 100) / 100, 0.67);
  check("추이는 개선(양수)", s.trend > 0, true);
  check("긍정/부정 건수", [s.positive, s.negative], [2, 2]);
  check("마지막 이후 일수", s.daysSinceLast, 49);

  check("기록 없는 사람은 0으로", summarizeRelationship(logs, "없음", NOW).logCount, 0);
  check("한 사람 기록만 최신순", logsForPerson(logs, "p1")[0].occurredAt.getMonth(), 5);
  check("최근 순 인물", peopleByRecency(logs), ["p2", "p1"]);
}

// ── 신뢰도 가드 (사람을 단정하지 않기 위한 장치) ──
{
  const few = [rlog({ personId: "x", sentiment: -2 })];
  check("기록 1건이면 신뢰 불가", isSummaryReliable(summarizeRelationship(few, "x", NOW)), false);
  const many = [
    rlog({ personId: "y", sentiment: 1 }),
    rlog({ personId: "y", sentiment: 1 }),
    rlog({ personId: "y", sentiment: 2 }),
  ];
  check("3건 이상이면 신뢰 가능", isSummaryReliable(summarizeRelationship(many, "y", NOW)), true);
}

// ── 소원해진 관계 ──
{
  const logs = [
    rlog({ personId: "old", occurredAt: d(2026, 1, 1), sentiment: 1 }),
    rlog({ personId: "old", occurredAt: d(2026, 2, 1), sentiment: 1 }),
    rlog({ personId: "recent", occurredAt: d(2026, 7, 10), sentiment: 1 }),
    rlog({ personId: "recent", occurredAt: d(2026, 7, 15), sentiment: 1 }),
    rlog({ personId: "once", occurredAt: d(2025, 1, 1), sentiment: 1 }), // 1건뿐 → 제외
  ];
  const drift = driftingRelationships(logs, 60, NOW);
  check("오래된 관계만 (1건짜리 제외)", drift.map((s) => s.personId), ["old"]);
}

// ── 라벨 ──
check("감정 라벨: 긍정", sentimentLabel(1), "긍정");
check("감정 라벨: 중립", sentimentLabel(0), "중립");
check("감정 라벨: 매우 부정", sentimentLabel(-2), "매우 부정");

for (const f of failures) console.log(`FAIL  ${f}`);
console.log(`\n${pass} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
