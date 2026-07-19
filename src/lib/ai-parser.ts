// ==========================================
// AI 파서 — 자연어 → Node 변환 (Mock)
// Phase 2: 클라이언트 사이드 모의 파서
// ==========================================

import { createNode } from "./services";
import type { Node, ScheduleInfo, NodeType, NodeStatus } from "./types";

export interface ParseResult {
  type: NodeType;
  title: string;
  description: string;
  missingFields: string[];
  schedule: ScheduleInfo | null;
  priority: { urgency: number; importance: number; score: number };
}

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

export function parseUserInput(input: string, locale: string): ParseResult {
  const text = input.trim();

  // --- Detect type ---
  const isEvent =
    /오늘|내일|모레|다음\s*주|this week|tomorrow|meeting|미팅|회의|약속|일정|schedule|event|수업|class/i.test(
      text
    );
  const type: NodeType = isEvent ? "calendar_event" : "todo";

  // --- Extract date ---
  let dayOffset = 0;
  if (/내일|tomorrow/i.test(text)) dayOffset = 1;
  else if (/모레|day after/i.test(text)) dayOffset = 2;
  else if (/다음\s*주|next week/i.test(text)) dayOffset = 7;
  else if (/이틀 후|2일 후/i.test(text)) dayOffset = 2;
  else if (/3일 후/i.test(text)) dayOffset = 3;

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

  // --- Clean title ---
  let title = text
    .replace(
      /오늘|내일|모레|다음\s*주|이틀 후|\d+일 후|this week|tomorrow|day after|next week/gi,
      ""
    )
    .replace(/\d{1,2}[시:]\d{0,2}\s*(오전|오후|am|pm)?/gi, "")
    .replace(/(\d+)\s*(시간|hour|hr|분|min)/gi, "")
    .replace(/(?:장소|위치|at|in)\s*[:_]?\s*.+?(?:$|[,.\n])/gim, "")
    .replace(/(.+?)(?:에서|에서의|에서 )/g, "")
    .replace(/(?:와|과|with)\s*.+?(?:$|[,.\n(])/gim, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!title) title = text.trim().substring(0, 80);
  title = title.replace(/^[,.\s]+|[,.\s]+$/g, "");

  // --- Determine missing fields ---
  const missingFields: string[] = [];
  if (dayOffset === 0 && !/오늘|today/i.test(text)) missingFields.push("date");
  if (!timeMatch) missingFields.push("time");
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
          category: "",
          location,
          attendees,
          reminders: [],
        }
      : {
          startAt: baseDate,
          endAt: baseEnd,
          dueAt: new Date(new Date(baseDate).setHours(18, 0, 0, 0)),
          allDay: true,
          category: "",
          location: null,
          attendees: [],
          reminders: [],
        },
    priority: {
      urgency: missingFields.length === 0 ? 4 : 2,
      importance: 3,
      score: 0,
    },
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
      suggestedProjectId: null,
      matchConfidence: null,
      clarificationLog: [],
    },
  });
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