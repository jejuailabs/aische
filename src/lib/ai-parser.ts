// ==========================================
// AI 파서 — 자연어 → Node 변환 (Enhanced)
// Phase 2: 필수 필드 되묻기, 프로젝트 매칭, 카테고리 자동 분류
// ==========================================

import { createNode } from "./services";
import type { Node, ScheduleInfo, NodeType, NodeStatus } from "./types";

// Re-export ParseResult for backward compatibility
export interface ParseResult {
  type: NodeType;
  title: string;
  description: string;
  missingFields: string[];
  schedule: ScheduleInfo | null;
  priority: { urgency: number; importance: number; score: number };
  suggestedCategoryId: string | null;
  suggestedProjectId: string | null;
  matchConfidence: number | null;
}

export type ClarificationState =
  | { phase: "idle" }
  | { phase: "awaiting"; fieldName: string; nodeId: string }
  | { phase: "complete"; nodeId: string }
  | { phase: "project_suggestion"; nodeId: string; projectId: string; confidence: number };

function makeDateOffset(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(0, 0, 0, 0);
  return d;
}

function makeDateAt(days: number, hour: number, minute: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d;
}

// --- Category detection keywords ---
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  "cat-meeting": ["회의", "미팅", "meeting", "미팅", "conf", "conference"],
  "cat-personal": ["약속", "저녁", "점심", "식사", "친구", "가족", "생일", "dinner", "lunch", "friend", "birthday"],
  "cat-work": ["프로젝트", "보고서", "업무", "기획", "리뷰", "코드", "개발", "project", "report", "work", "code"],
  "cat-health": ["운동", "헬스", "조깅", "식단", "건강", "요가", "수영", "exercise", "gym", "run", "health", "yoga"],
  "cat-study": ["공부", "강의", "학습", "세미나", "책", "스터디", "study", "lecture", "seminar", "book", "reading"],
  "cat-travel": ["여행", "출장", "휴가", "여행", "travel", "trip", "vacation"],
};

export function detectCategory(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [catId, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) return catId;
  }
  return null;
}

// --- Project matching (keyword-based for demo) ---
export function matchProject(
  title: string,
  description: string,
  projectTitles: string[]
): { projectId: string | null; confidence: number } | null {
  if (projectTitles.length === 0) return null;

  const combined = (title + " " + description).toLowerCase();
  let bestMatch: string | null = null;
  let bestScore = 0;

  for (const projTitle of projectTitles) {
    const keywords = projTitle.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
    let score = 0;
    for (const kw of keywords) {
      if (combined.includes(kw)) score += 1;
    }
    // Normalize by keyword count
    const normalizedScore = keywords.length > 0 ? score / keywords.length : 0;
    if (normalizedScore > bestScore && normalizedScore > 0.2) {
      bestScore = normalizedScore;
      bestMatch = projTitle;
    }
  }

  return bestMatch
    ? { projectId: bestMatch, confidence: Math.round(bestScore * 100) }
    : null;
}

// --- Extract day of week ---
function getDayOfWeekOffset(targetDay: number): number {
  const today = new Date().getDay();
  let diff = targetDay - today;
  if (diff <= 0) diff += 7;
  return diff;
}

const DAY_MAP_KO: Record<string, number> = {
  "월요일": 1, "화요일": 2, "수요일": 3, "목요일": 4,
  "금요일": 5, "토요일": 6, "일요일": 0,
  "월": 1, "화": 2, "수": 3, "목": 4, "금": 5, "토": 6, "일": 0,
};
const DAY_MAP_EN: Record<string, number> = {
  "monday": 1, "tuesday": 2, "wednesday": 3, "thursday": 4,
  "friday": 5, "saturday": 6, "sunday": 0,
  "mon": 1, "tue": 2, "wed": 3, "thu": 4, "fri": 5, "sat": 6, "sun": 0,
};

export function parseUserInput(input: string, locale: string): ParseResult {
  const text = input.trim();

  // --- Detect type ---
  const isEvent =
    /오늘|내일|모레|다음\s*주|this week|tomorrow|meeting|미팅|회의|약속|일정|schedule|event|수업|class|식사|저녁|점심|운동|헬스|조깅|출장|여행|세미나/i.test(
      text
    );
  const isGoal =
    /목표|goal|달성|계획|plan|전략|strategy/i.test(text);
  const type: NodeType = isGoal ? "goal" : isEvent ? "calendar_event" : "todo";

  // --- Extract date ---
  let dayOffset = 0;
  if (/내일|tomorrow/i.test(text)) dayOffset = 1;
  else if (/모레|day after/i.test(text)) dayOffset = 2;
  else if (/다음\s*주|next week/i.test(text)) dayOffset = 7;
  else if (/이틀 후|2일 후/i.test(text)) dayOffset = 2;
  else if (/3일 후/i.test(text)) dayOffset = 3;
  else if (/이번\s*주\s*(\S+)/i.test(text)) {
    const m = text.match(/이번\s*주\s*(\S+)/i);
    if (m) {
      const dayName = m[1];
      const dow = DAY_MAP_KO[dayName] ?? DAY_MAP_EN[dayName.toLowerCase()];
      if (dow !== undefined) dayOffset = getDayOfWeekOffset(dow);
    }
  } else if (/this\s+(\w+)/i.test(text)) {
    const m = text.match(/this\s+(\w+)/i);
    if (m) {
      const dow = DAY_MAP_EN[m[1].toLowerCase()];
      if (dow !== undefined) dayOffset = getDayOfWeekOffset(dow);
    }
  }

  // --- Extract time ---
  const timeMatch = text.match(/(\d{1,2})[시:](\d{0,2})/);
  const ampmMatch = text.match(/(오전|오후|am|pm)/i);
  let startHour = 10;
  let startMinute = 0;

  if (timeMatch) {
    startHour = parseInt(timeMatch[1]) || 10;
    startMinute = parseInt(timeMatch[2]) || 0;
    if (ampmMatch && /오후|pm/i.test(ampmMatch[1]) && startHour < 12) {
      startHour += 12;
    }
    if (ampmMatch && /오전|am/i.test(ampmMatch[1]) && startHour === 12) {
      startHour = 0;
    }
  }

  // --- Extract duration ---
  let durationMinutes = type === "calendar_event" ? 60 : 30;
  const durHourMatch = text.match(/(\d+)\s*(시간|hour|hr)/i);
  if (durHourMatch) durationMinutes = parseInt(durHourMatch[1]) * 60;
  const durMinMatch = text.match(/(\d+)\s*(분|min)/i);
  if (durMinMatch && !durHourMatch) durationMinutes = parseInt(durMinMatch[1]);

  // --- Build schedule ---
  const baseDate = makeDateOffset(dayOffset);
  const startAt = makeDateAt(dayOffset, startHour, startMinute);
  const endAt = new Date(startAt.getTime() + durationMinutes * 60000);

  // --- Extract location ---
  const locPatterns = [
    /(?:장소|위치|at|in)\s*[:_]?\s*(.+?)(?:$|[,.\n])/im,
    /(.+?)(?:에서|에서의)\s/,
    /(?:@)\s*(.+?)(?:$|[,.\s])/im,
  ];
  let location: string | null = null;
  for (const p of locPatterns) {
    const m = text.match(p);
    if (m) {
      location = m[1].trim().replace(/[,.\n]/g, "").substring(0, 50);
      break;
    }
  }

  // --- Extract attendees ---
  const attendeePatterns = [
    /(?:와|과|with)\s*(.+?)(?:$|[,.\n(])/im,
    /(?:함께|같이)\s*(.+?)(?:$|[,.\n])/im,
  ];
  let attendees: string[] = [];
  for (const p of attendeePatterns) {
    const m = text.match(p);
    if (m) {
      attendees = m[1]
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean);
      break;
    }
  }

  // --- Auto-detect category ---
  const suggestedCategoryId = detectCategory(text);

  // --- Clean title ---
  let title = text
    .replace(
      /오늘|내일|모레|다음\s*주|이번\s*주\s*\S+|이틀 후|\d+일 후|this week|tomorrow|day after|next week|this \w+/gi,
      ""
    )
    .replace(/\d{1,2}[시:]\d{0,2}\s*(오전|오후|am|pm)?/gi, "")
    .replace(/(\d+)\s*(시간|hour|hr|분|min)/gi, "")
    .replace(/(?:장소|위치|at|in)\s*[:_]?\s*.+?(?:$|[,.\n])/gim, "")
    .replace(/(.+?)(?:에서|에서의|에서 )/g, "")
    .replace(/(?:와|과|with|함께|같이)\s*.+?(?:$|[,.\n(])/gim, "")
    .replace(/@.+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!title) title = text.trim().substring(0, 80);
  title = title.replace(/^[,.\s]+|[,.\s]+$/g, "");

  // --- Determine missing fields ---
  const missingFields: string[] = [];
  const hasDate = dayOffset > 0 || /오늘|today/i.test(text);
  if (!hasDate && type !== "goal") missingFields.push("date");
  if (!timeMatch && type === "calendar_event") missingFields.push("time");
  if (type === "calendar_event" && !location) missingFields.push("location");
  if (type === "calendar_event" && attendees.length === 0) missingFields.push("target");

  const hasSchedule = type === "calendar_event" || dayOffset > 0 || !!timeMatch;
  const baseEnd = new Date(baseDate);
  baseEnd.setHours(23, 59, 59, 999);

  return {
    type,
    title: title.substring(0, 100),
    description: "",
    missingFields,
    schedule: hasSchedule
      ? {
          startAt,
          endAt,
          dueAt: type === "todo" ? endAt : null,
          allDay: !timeMatch,
          category: suggestedCategoryId ?? "",
          location,
          attendees,
          reminders: [],
        }
      : {
          startAt: baseDate,
          endAt: baseEnd,
          dueAt: new Date(new Date(baseDate).setHours(18, 0, 0, 0)),
          allDay: true,
          category: suggestedCategoryId ?? "",
          location: null,
          attendees: [],
          reminders: [],
        },
    priority: {
      urgency: missingFields.length === 0 ? 4 : 2,
      importance: 3,
      score: 0,
    },
    suggestedCategoryId,
    suggestedProjectId: null,
    matchConfidence: null,
  };
}

export function createDraftNode(
  parseResult: ParseResult,
  workspaceId: string
): Node {
  const p = parseResult.priority;
  return createNode({
    workspaceId,
    type: parseResult.type,
    title: parseResult.title,
    description: parseResult.description,
    projectId: parseResult.suggestedProjectId ?? "unsorted",
    status: "scheduled" as NodeStatus,
    priority: {
      urgency: p.urgency,
      importance: p.importance,
      score: Math.round(p.urgency * 0.4 + p.importance * 0.6),
    },
    schedule: parseResult.schedule,
    aiMeta: {
      status: "draft",
      sourceInput: { channel: "text", rawRef: "" },
      suggestedProjectId: parseResult.suggestedProjectId,
      matchConfidence: parseResult.matchConfidence,
      clarificationLog: [],
    },
  });
}

/** Apply clarification answer to a draft node */
export function applyClarification(
  node: Node,
  fieldName: string,
  answer: string,
  locale: string
): Node {
  const updates: Partial<Node> = {};
  let schedule = node.schedule
    ? { ...node.schedule }
    : {
        startAt: new Date(),
        endAt: new Date(),
        dueAt: null,
        allDay: true,
        category: "",
        location: null,
        attendees: [],
        reminders: [],
      };

  switch (fieldName) {
    case "date": {
      const result = parseUserInput(answer, locale);
      if (result.schedule) {
        schedule.startAt = result.schedule.startAt;
        schedule.endAt = result.schedule.endAt;
        schedule.allDay = result.schedule.allDay;
        if (result.schedule.dueAt) schedule.dueAt = result.schedule.dueAt;
      }
      break;
    }
    case "time": {
      const timeMatch = answer.match(/(\d{1,2})[시:](\d{0,2})/);
      const ampmMatch = answer.match(/(오전|오후|am|pm)/i);
      if (timeMatch) {
        let h = parseInt(timeMatch[1]) || 10;
        const m = parseInt(timeMatch[2]) || 0;
        if (ampmMatch && /오후|pm/i.test(ampmMatch[1]) && h < 12) h += 12;
        if (ampmMatch && /오전|am/i.test(ampmMatch[1]) && h === 12) h = 0;
        const startDate = new Date(schedule.startAt);
        startDate.setHours(h, m, 0, 0);
        schedule.startAt = startDate;
        const endDate = new Date(startDate.getTime() + node.estimatedDuration * 60000);
        schedule.endAt = endDate;
        schedule.allDay = false;
      }
      break;
    }
    case "location":
      schedule.location = answer.trim();
      break;
    case "target":
      schedule.attendees = answer
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean);
      break;
    case "duration": {
      const durHourMatch = answer.match(/(\d+)\s*(시간|hour|hr)/i);
      const durMinMatch = answer.match(/(\d+)\s*(분|min)/i);
      if (durHourMatch) {
        const mins = parseInt(durHourMatch[1]) * 60;
        updates.estimatedDuration = mins;
        const endDate = new Date(schedule.startAt.getTime() + mins * 60000);
        schedule.endAt = endDate;
      } else if (durMinMatch) {
        const mins = parseInt(durMinMatch[1]);
        updates.estimatedDuration = mins;
        const endDate = new Date(schedule.startAt.getTime() + mins * 60000);
        schedule.endAt = endDate;
      }
      break;
    }
    case "content":
      updates.description = answer.trim();
      break;
  }

  updates.schedule = schedule;

  // Update clarification log
  const clarificationLog = node.aiMeta?.clarificationLog
    ? [...node.aiMeta.clarificationLog, { question: fieldName, answer }]
    : [{ question: fieldName, answer }];

  // Remove field from missing (re-check)
  const currentMissing = [...(node.aiMeta?.clarificationLog?.map((c) => c.question) ?? [])];
  if (fieldName) currentMissing.push(fieldName);

  return {
    ...node,
    ...updates,
    aiMeta: node.aiMeta
      ? { ...node.aiMeta, clarificationLog }
      : null,
  };
}

/** Parse file content line by line */
export function parseFileContent(content: string): ParseResult[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseUserInput(line, "ko"))
    .filter((r) => r.title.length > 0);
}