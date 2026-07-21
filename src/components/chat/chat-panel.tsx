'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  useNodeStore,
  useProjectStore,
  useCategoryStore,
  usePrefStore,
  usePersonStore,
  useOrgStore,
  useCaptureStore,
  useTopicStore,
} from '@/lib/store';
import { buildIndex } from '@/lib/memory-index';
import { buildAgenda, renderAgenda } from '@/lib/agenda';
import { runAgent } from '@/lib/agent-loop';
import type { PendingChange } from '@/lib/tool-exec';
import type { Conflict } from '@/lib/schedule-index';
import {
  buildPlan,
  applyPlan,
  LAYER_LABEL,
  type IngestPlan,
  type PlanLayer,
} from '@/lib/ingest';
import { useLocale } from '@/hooks/use-locale';
import {
  parseUserInput,
  createDraftNode,
  applyClarification,
  matchProject,
} from '@/lib/ai-parser';
import {
  MessageCircle,
  X,
  Send,
  Paperclip,
  CalendarDays,
  ListChecks,
  Target,
  MapPin,
  Users,
  Clock,
  AlertCircle,
  Loader2,
  XCircle,
  Mic,
  Pencil,
  FolderOpen,
  Check,
  Sparkles,
  Layers,
  Inbox,
  TrendingUp,
  Building2,
  FileText,
  Minus,
  RotateCcw,
  GripHorizontal,
} from 'lucide-react';
import {
  useFloatingWindow,
  RESIZE_HANDLES,
} from '@/hooks/use-floating-window';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import type { Node } from '@/lib/types';
import { VoiceButton } from './voice-input';
import { describeRecurrence } from '@/lib/recurrence';
import { shouldPromoteTopic } from '@/lib/types';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ProjectMatchData {
  projectId: string;
  projectName: string;
  confidence: number;
  nodeId: string;
}

interface ChatMessage {
  id: string;
  role:
    | 'user'
    | 'ai'
    | 'draft'
    | 'project_match'
    | 'plan'
    | 'promote'
    /** 수정·삭제 확인 카드 */
    | 'confirm';
  content: string;
  /** Reference to node stored in Zustand — keeps UI in sync after edits / clarification */
  draftNodeId?: string;
  isThinking?: boolean;
  projectMatchData?: ProjectMatchData;
  /** AI가 분해한 저장 계획 (layered draft) */
  plan?: IngestPlan;
  /** 계획이 이미 적용됐는지 */
  planApplied?: boolean;
  /** 원본 입력 텍스트 (적용 시 CapturedInput으로 보존) */
  rawText?: string;
  /** 프로젝트 승격을 제안할 주제 id */
  promoteTopicId?: string;
  /** 확인 대기 중인 변경 (role: confirm) */
  pending?: PendingChange;
  /** 등록을 막은 충돌 — 답변 아래에 함께 보여준다 */
  conflicts?: Conflict[];
  /** 확인 카드가 이미 처리됐는지 */
  resolved?: 'applied' | 'cancelled';
}

interface ClarificationAwaiting {
  fieldName: string;
  nodeId: string;
  remainingFields: string[];
}

interface ClarificationState {
  awaiting: ClarificationAwaiting | null;
}

interface EditValues {
  title: string;
  location: string;
  attendees: string;
  duration: string;
  description: string;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface ChatPanelProps {
  /**
   * floating — 데스크톱: 드래그·리사이즈 되는 독립 창
   * docked   — 모바일: 화면 하단에 고정된 입력 바
   */
  variant?: 'floating' | 'docked';
}

/**
 * 입력창이 늘어날 수 있는 최대 높이(px).
 *
 * 대략 5~6줄. 이보다 길어지면 입력창 안에서 스크롤한다.
 * 상한이 없으면 긴 글을 붙여넣었을 때 입력창이 대화 내용을 다 덮어버린다.
 */
const MAX_INPUT_HEIGHT = 120;

/** 한 줄일 때의 대략적인 높이(px) — 이보다 크면 여러 줄로 본다 */
const SINGLE_LINE_HEIGHT = 28;

/**
 * 도구 실행 중 표시할 문구.
 *
 * "생각 중…"만 계속 띄우면 사용자는 멈춘 줄 안다.
 * 무엇을 하고 있는지 보여야 기다릴 수 있다.
 */
const TOOL_LABEL: Record<string, string> = {
  search_schedules: '일정을 찾는 중…',
  get_schedule: '일정 내용을 확인하는 중…',
  search_notes: '기록을 찾는 중…',
  search_people: '인물을 찾는 중…',
  stage_new_entry: '등록할 내용을 정리하는 중…',
  update_schedule: '수정할 내용을 확인하는 중…',
  delete_schedule: '삭제할 항목을 확인하는 중…',
};

export function ChatPanel({ variant = 'docked' }: ChatPanelProps) {
  const { t, locale } = useLocale();
  const isFloating = variant === 'floating';

  /* ---- 플로팅 창 위치·크기 ---- */
  const { rect, interacting, dragProps, resizeProps, reset } =
    useFloatingWindow({
      storageKey: 'goalflow.chat.window',
      defaultRect: (vp) => ({
        w: 420,
        h: Math.min(560, vp.h - 120),
        x: vp.w - 420 - 24,
        y: vp.h - Math.min(560, vp.h - 120) - 24,
      }),
      minW: 320,
      minH: 240,
    });

  /* ---- local state ---- */
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [attachedFile, setAttachedFile] = useState<string | null>(null);
  const [clarificationState, setClarificationState] = useState<ClarificationState>({
    awaiting: null,
  });
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<EditValues>({
    title: '',
    location: '',
    attendees: '',
    duration: '',
    description: '',
  });
  const [isDark, setIsDark] = useState(false);
  const welcomeShownRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // textarea다 — Shift+Enter 줄바꿈을 받으려면 단일 라인 input으로는 안 된다.
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /** 입력창이 두 줄 이상인지 — 테두리 곡률을 바꾸는 데만 쓴다 */
  const [isMultiline, setIsMultiline] = useState(false);

  /**
   * 입력 높이를 내용에 맞춘다.
   *
   * textarea는 기본이 고정 높이라 여러 줄을 써도 한 줄만 보인다.
   * scrollHeight를 재서 늘리되, 상한을 두고 그 뒤로는 스크롤시킨다 —
   * 안 그러면 긴 글을 붙여넣었을 때 입력창이 화면을 다 덮는다.
   */
  const autoGrow = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto'; // 줄여야 할 때를 위해 먼저 초기화
    const next = Math.min(el.scrollHeight, MAX_INPUT_HEIGHT);
    el.style.height = `${next}px`;
    // 줄바꿈 문자 유무가 아니라 실제 높이로 판단한다 —
    // 긴 한 줄이 자동 줄바꿈된 경우에도 여러 줄이다.
    setIsMultiline(next > SINGLE_LINE_HEIGHT);
  }, []);

  /** 전송·초기화 후 입력창 높이를 한 줄로 되돌린다 */
  const resetInputHeight = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    setIsMultiline(false);
  }, []);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ---- stores ---- */
  const addNode = useNodeStore((s) => s.addNode);
  const updateNode = useNodeStore((s) => s.updateNode);
  const removeNode = useNodeStore((s) => s.removeNode);
  const nodes = useNodeStore((s) => s.nodes);
  const projects = useProjectStore((s) => s.projects);
  const addProject = useProjectStore((s) => s.addProject);
  const categories = useCategoryStore((s) => s.categories);
  const language = usePrefStore((s) => s.language);

  /* ---- 정보 레이어 스토어 ---- */
  const people = usePersonStore((s) => s.people);
  const addPerson = usePersonStore((s) => s.addPerson);
  const updatePerson = usePersonStore((s) => s.updatePerson);
  const findPerson = usePersonStore((s) => s.findByName);
  const orgs = useOrgStore((s) => s.orgs);
  const addOrg = useOrgStore((s) => s.addOrg);
  const updateOrg = useOrgStore((s) => s.updateOrg);
  const findOrg = useOrgStore((s) => s.findByName);
  const captures = useCaptureStore((s) => s.captures);
  const addCapture = useCaptureStore((s) => s.addCapture);
  const updateCapture = useCaptureStore((s) => s.updateCapture);
  const topics = useTopicStore((s) => s.topics);
  const addTopic = useTopicStore((s) => s.addTopic);
  const updateTopic = useTopicStore((s) => s.updateTopic);
  const findTopic = useTopicStore((s) => s.findByLabel);
  const promoteTopic = useTopicStore((s) => s.promote);

  /* ---- derived ---- */
  const draftCount = Object.values(nodes).filter(
    (n) => n.aiMeta?.status === 'draft',
  ).length;

  /* ---- dark-mode observer ---- */
  useEffect(() => {
    setIsDark(document.documentElement.classList.contains('dark'));
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, []);

  /* ---- auto-scroll ---- */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /* ---- focus input when opened ---- */
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  /* ---- welcome message (once via ref) ---- */
  useEffect(() => {
    if (open && !welcomeShownRef.current) {
      welcomeShownRef.current = true;
      setMessages((prev) => [
        ...prev,
        {
          id: 'welcome-' + Date.now(),
          role: 'ai' as const,
          content: t.chat.welcomeMessage,
        },
      ]);
    }
  }, [open, t.chat.welcomeMessage]);

  /* ================================================================ */
  /*  Helpers                                                          */
  /* ================================================================ */

  /** Map missing-field name → i18n question string */
  const getFieldLabel = useCallback(
    (fieldName: string): string => {
      const map: Record<string, string> = {
        date: t.chat.askDate,
        time: t.chat.askTime,
        location: t.chat.askLocation,
        target: t.chat.askTarget,
        duration: t.chat.askDuration,
        content: t.chat.askContent,
      };
      return map[fieldName] ?? fieldName;
    },
    [t],
  );

  const typeLabel = (type: string) => {
    if (type === 'calendar_event') return t.chat.typeEvent;
    if (type === 'todo') return t.chat.typeTodo;
    return t.chat.typeGoal;
  };

  const typeIcon = (type: string) => {
    if (type === 'calendar_event') return CalendarDays;
    if (type === 'todo') return ListChecks;
    return Target;
  };

  /** Locale-aware schedule formatting */
  const formatSchedule = (node: Node): string | null => {
    if (!node.schedule) return null;
    const s = node.schedule;
    const parts: string[] = [];

    if (s.allDay) {
      parts.push(
        locale === 'ko'
          ? `${s.startAt.getMonth() + 1}/${s.startAt.getDate()} (${['일', '월', '화', '수', '목', '금', '토'][s.startAt.getDay()]})`
          : s.startAt.toLocaleDateString(locale, {
              month: 'short',
              weekday: 'short',
            }),
      );
    } else {
      const fmt = (d: Date) =>
        locale === 'ko'
          ? `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
          : d.toLocaleTimeString(locale, {
              hour: '2-digit',
              minute: '2-digit',
            });
      parts.push(fmt(s.startAt) + '~' + fmt(s.endAt));
    }

    if (s.location) parts.push('\u{1F4CD} ' + s.location);
    if (s.attendees.length > 0)
      parts.push('\u{1F465} ' + s.attendees.join(', '));
    return parts.join(' \u00B7 ');
  };

  /* ================================================================ */
  /*  Project matching                                                 */
  /* ================================================================ */

  const runProjectMatch = useCallback(
    (node: Node) => {
      const match = matchProject(
        node.title,
        node.description,
        projects.map((p) => p.title),
      );
      if (match && match.confidence > 20) {
        const project = projects.find((p) => p.title === match.projectId);
        if (project) {
          setMessages((prev) => [
            ...prev,
            {
              id: 'pmatch-' + Date.now(),
              role: 'project_match' as const,
              content: t.chat.projectMatched,
              projectMatchData: {
                projectId: project.id,
                projectName: project.title,
                confidence: match.confidence,
                nodeId: node.id,
              },
            },
          ]);
        }
      }
    },
    [projects, t],
  );

  /* ================================================================ */
  /*  저장 계획 (layered plan)                                         */
  /* ================================================================ */

  /** 계획 항목 하나를 켜고 끔 */
  const togglePlanItem = useCallback((msgId: string, idx: number) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId || !m.plan) return m;
        const items = m.plan.items.map((it, i) =>
          i === idx ? { ...it, enabled: !it.enabled } : it,
        );
        return { ...m, plan: { ...m.plan, items } };
      }),
    );
  }, []);

  /**
   * 확인 카드의 변경을 실제로 적용한다.
   *
   * **AI는 여기까지 오지 못한다.** 도구는 제안만 만들고, 적용은 사용자가
   * 이 버튼을 눌러야 일어난다. AI가 잘못 판단해 지운 건 되돌릴 수 없어서다.
   */
  const handleApplyPending = useCallback(
    (msgId: string) => {
      const msg = messages.find((m) => m.id === msgId);
      const pending = msg?.pending;
      if (!pending) return;

      const store = useNodeStore.getState();
      const node = store.nodes[pending.nodeId];
      if (!node) {
        toast.error('대상 일정을 찾을 수 없습니다. 이미 지워졌을 수 있습니다.');
        setMessages((prev) =>
          prev.map((m) => (m.id === msgId ? { ...m, resolved: 'cancelled' } : m)),
        );
        return;
      }

      if (pending.kind === 'delete_schedule') {
        store.removeNodeWithLog(pending.nodeId);
        toast.success(`"${pending.targetTitle}" 삭제됨`);
      } else {
        // changes는 필드별 { before, after }다. after만 반영한다.
        const updates: Partial<Node> = {};
        for (const c of pending.changes) {
          if (c.field === 'title') updates.title = c.after;
          else if (c.field === 'description') updates.description = c.after;
          else if (c.field === 'location' && node.schedule) {
            updates.schedule = { ...node.schedule, location: c.after };
          } else if (c.field === 'date' && node.schedule) {
            // after는 "YYYY-MM-DD" — 시각은 유지한다.
            const [y, mo, d] = c.after.slice(0, 10).split('-').map(Number);
            const start = new Date(node.schedule.startAt);
            const end = new Date(node.schedule.endAt);
            const span = end.getTime() - start.getTime();
            start.setFullYear(y, mo - 1, d);
            updates.schedule = {
              ...(updates.schedule ?? node.schedule),
              startAt: start,
              endAt: new Date(start.getTime() + (isNaN(span) ? 3600000 : span)),
            };
          }
        }
        store.updateNodeWithLog(pending.nodeId, updates);
        toast.success(`"${pending.targetTitle}" 수정됨`);
      }

      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, resolved: 'applied' } : m)),
      );
    },
    [messages],
  );

  const handleCancelPending = useCallback((msgId: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, resolved: 'cancelled' } : m)),
    );
  }, []);

  /**
   * 계획을 저장한다.
   * @param hold true면 확정하지 않고 대기함으로 보낸다 ("나중에 정할래")
   */
  const handleApplyPlan = useCallback(
    (msgId: string, hold = false) => {
      const msg = messages.find((m) => m.id === msgId);
      if (!msg?.plan || !msg.rawText) return;

      const result = applyPlan(msg.plan, msg.rawText, 'text', {
        addNode,
        addPerson,
        updatePerson,
        addOrg,
        updateOrg,
        addProject,
        addCapture,
        updateCapture,
        findPerson,
        findOrg,
        getPersonById: (id) => usePersonStore.getState().people[id],
        getOrgById: (id) => useOrgStore.getState().orgs[id],
        addTopic,
        updateTopic,
        findTopic,
        findTopicById: (id) => useTopicStore.getState().topics[id],
        getTopicById: (id) => useTopicStore.getState().topics[id],
      }, hold);

      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, planApplied: true } : m)),
      );

      if (hold) {
        toast.success('대기함에 보관했습니다. 나중에 확정하세요');
        return;
      }

      const parts: string[] = [];
      if (result.nodeIds.length) parts.push(`일정/실행 ${result.nodeIds.length}`);
      if (result.personIds.length) parts.push(`인물 ${result.personIds.length}`);
      if (result.orgIds.length) parts.push(`조직 ${result.orgIds.length}`);
      toast.success(
        parts.length ? `저장 완료 — ${parts.join(', ')}` : '저장 완료',
      );

      // 주제에 행동이 붙어 승격 조건을 넘겼으면 제안한다 (자동 생성하지 않음)
      // 대기함 보관은 아직 확정이 아니므로 승격 제안하지 않는다
      if (result.topicId) {
        const topic = useTopicStore.getState().topics[result.topicId];
        if (topic && shouldPromoteTopic(topic)) {
          setMessages((prev) => [
            ...prev,
            {
              id: 'promote-' + Date.now(),
              role: 'promote' as const,
              content: topic.label,
              promoteTopicId: topic.id,
            },
          ]);
        }
      }
    },
    [
      messages,
      addNode,
      addPerson,
      updatePerson,
      addOrg,
      updateOrg,
      addProject,
      addCapture,
      updateCapture,
      findPerson,
      findOrg,
      addTopic,
      updateTopic,
      findTopic,
    ],
  );

  /** 주제 → 프로젝트 승격 */
  const handlePromote = useCallback(
    (msgId: string, topicId: string) => {
      const topic = useTopicStore.getState().topics[topicId];
      const projectId = promoteTopic(topicId);
      if (!projectId) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? {
                id: m.id,
                role: 'ai' as const,
                content: `'${topic?.label}' 을(를) 프로젝트로 만들었습니다. 모아둔 메모는 프로젝트 설명으로 옮겼습니다.`,
              }
            : m,
        ),
      );
      toast.success('프로젝트로 승격했습니다');
    },
    [promoteTopic],
  );

  const handleDismissPromote = useCallback((msgId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== msgId));
  }, []);

  /** 이 대화에서만 지운다 (아무것도 저장하지 않음) */
  const handleDiscardPlan = useCallback((msgId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== msgId));
  }, []);

  /* ================================================================ */
  /*  Draft editing                                                    */
  /* ================================================================ */

  const handleStartEdit = useCallback((node: Node) => {
    setEditingNodeId(node.id);
    setEditValues({
      title: node.title,
      location: node.schedule?.location ?? '',
      attendees: node.schedule?.attendees?.join(', ') ?? '',
      duration: String(node.estimatedDuration),
      description: node.description,
    });
  }, []);

  const handleSaveEdit = useCallback(
    (nodeId: string) => {
      const current = nodes[nodeId];
      if (!current) return;

      const updates: Partial<Node> = { title: editValues.title };

      if (current.schedule) {
        const schedule = { ...current.schedule };
        schedule.location = editValues.location || null;
        schedule.attendees = editValues.attendees
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        updates.schedule = schedule;
      }

      updates.description = editValues.description;

      const dur = parseInt(editValues.duration, 10);
      if (!isNaN(dur) && dur > 0) {
        updates.estimatedDuration = dur;
      }

      updateNode(nodeId, updates);
      setEditingNodeId(null);
      toast.success(t.chat.draftSaved);
    },
    [editValues, nodes, updateNode, t],
  );

  /* ================================================================ */
  /*  Confirm / Cancel draft                                           */
  /* ================================================================ */

  const handleConfirmDraft = useCallback(
    (node: Node) => {
      if (!node.aiMeta) return;
      updateNode(node.id, {
        aiMeta: { ...node.aiMeta, status: 'confirmed' },
      });
      toast.success(t.chat.draftSaved);
      setMessages((prev) => {
        const filtered = prev.filter((m) => m.draftNodeId !== node.id);
        return [
          ...filtered,
          {
            id: Date.now().toString() + 'c',
            role: 'ai' as const,
            content: '\u2705 ' + node.title + ' \u2014 ' + t.chat.draftSaved,
          },
        ];
      });
      // clear clarification if it was for this node
      if (clarificationState.awaiting?.nodeId === node.id) {
        setClarificationState({ awaiting: null });
      }
    },
    [updateNode, t, clarificationState.awaiting],
  );

  const handleCancelDraft = useCallback(
    (nodeId: string) => {
      removeNode(nodeId);
      setMessages((prev) => prev.filter((m) => m.draftNodeId !== nodeId));
      if (clarificationState.awaiting?.nodeId === nodeId) {
        setClarificationState({ awaiting: null });
      }
    },
    [removeNode, clarificationState.awaiting],
  );

  /* ================================================================ */
  /*  Project suggestion actions                                       */
  /* ================================================================ */

  const handleAddToProject = useCallback(
    (projectId: string, nodeId: string) => {
      const node = nodes[nodeId];
      if (!node) return;
      updateNode(nodeId, {
        projectId,
        aiMeta: node.aiMeta
          ? { ...node.aiMeta, suggestedProjectId: projectId }
          : null,
      });
      setMessages((prev) =>
        prev.filter(
          (m) =>
            !(
              m.role === 'project_match' &&
              m.projectMatchData?.nodeId === nodeId
            ),
        ),
      );
      toast.success(t.chat.draftSaved);
    },
    [nodes, updateNode, t],
  );

  const handleKeepUnsorted = useCallback((nodeId: string) => {
    setMessages((prev) =>
      prev.filter(
        (m) =>
          !(
            m.role === 'project_match' &&
            m.projectMatchData?.nodeId === nodeId
          ),
      ),
    );
  }, []);

  /* ================================================================ */
  /*  File handling                                                    */
  /* ================================================================ */

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        setAttachedFile(ev.target?.result as string);
      };
      reader.readAsText(file);
      e.target.value = '';
    },
    [],
  );

  /* ================================================================ */
  /*  Voice input — Phase 4: integrates VoiceButton component         */
  /* ================================================================ */

  const handleVoiceTranscript = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      setInput(text);
      // 음성 결과가 길면 여러 줄이 된다 — 높이를 맞춰준다
      requestAnimationFrame(() => autoGrow(inputRef.current));
      setTimeout(() => {
        const sendBtn = document.querySelector('[data-send-btn]') as HTMLButtonElement;
        sendBtn?.click();
      }, 300);
    },
    []
  );

  /* ================================================================ */
  /*  Send / Clarification flow                                        */
  /* ================================================================ */

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text && !attachedFile) return;

    /* -------------------------------------------------------------- */
    /*  CLARIFICATION ANSWER                                           */
    /* -------------------------------------------------------------- */
    if (clarificationState.awaiting) {
      const { fieldName, nodeId, remainingFields } =
        clarificationState.awaiting;
      const node = nodes[nodeId];
      if (!node) return;

      setMessages((prev) => [
        ...prev,
        { id: Date.now().toString(), role: 'user' as const, content: text },
      ]);
      setInput('');
      resetInputHeight();
      setIsProcessing(true);

      // small delay for natural feel
      await new Promise((r) => setTimeout(r, 300));

      // apply the answer to the draft node
      const updatedNode = applyClarification(node, fieldName, text, locale);
      updateNode(nodeId, updatedNode);

      // advance to next missing field or finish
      const newRemaining = remainingFields.slice(1);

      if (newRemaining.length > 0) {
        setClarificationState({
          awaiting: {
            fieldName: newRemaining[0],
            nodeId,
            remainingFields: newRemaining,
          },
        });
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now().toString() + 'q',
            role: 'ai' as const,
            content: getFieldLabel(newRemaining[0]),
          },
        ]);
      } else {
        // all clarifications resolved → show confirm card + project match
        setClarificationState({ awaiting: null });
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now().toString() + 'done',
            role: 'ai' as const,
            content: t.chat.parsedSummary,
          },
        ]);
        runProjectMatch(updatedNode);
      }

      setIsProcessing(false);
      return;
    }

    /* -------------------------------------------------------------- */
    /*  NORMAL FLOW                                                    */
    /* -------------------------------------------------------------- */
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: text || '\u{1F4CE} ' + t.chat.fileAttached,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    resetInputHeight();
    setIsProcessing(true);

    /* ---- file attachment ---- */
    if (attachedFile) {
      try {
        const { parseFileContent } = await import('@/lib/ai-parser');
        const results = parseFileContent(attachedFile);
        if (results.length === 0) {
          setMessages((prev) => [
            ...prev,
            {
              id: Date.now().toString() + 'e',
              role: 'ai' as const,
              content: t.chat.fileParseError,
            },
          ]);
        } else {
          for (const r of results) {
            const draft = createDraftNode(r, 'demo-workspace');
            addNode(draft);
            setMessages((prev) => [
              ...prev,
              {
                id: Date.now().toString() + 'd' + Math.random(),
                role: 'draft' as const,
                content: t.chat.parsedSummary,
                draftNodeId: draft.id,
              },
            ]);
            // project match for file-parsed drafts (no missing fields expected)
            runProjectMatch(draft);
          }
        }
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now().toString() + 'e',
            role: 'ai' as const,
            content: t.chat.fileParseError,
          },
        ]);
      }
      setAttachedFile(null);
      setIsProcessing(false);
      return;
    }

    /* ---- thinking animation ---- */
    const thinkId = Date.now().toString() + 't';
    setMessages((prev) => [
      ...prev,
      {
        id: thinkId,
        role: 'ai' as const,
        content: t.chat.thinking,
        isThinking: true,
      },
    ]);

    /* ---- 오케스트레이터 호출 ---- */
    try {
      // 실제로 잡혀 있는 일정.
      //
      // 예전에는 여기서 `s.startAt >= now`로 걸렀는데, 종일 일정의 startAt은
      // 그날 00:00이라 **오늘 일정이 자정 직후부터 사라졌다.** 그래서 AI가
      // "오늘 당근 모임 있잖아"에 "등록된 일정이 없다"고 답했다.
      // buildAgenda는 날짜 기준으로 뽑는다 (agenda.ts 참고).
      const now = new Date();
      const agenda = buildAgenda(Object.values(nodes), now);

      // ctxSummary가 아직 쓰는 구버전 요약 — agenda에서 파생시킨다.
      const upcoming = agenda.map((a) => ({
        title: a.title,
        when: a.date.slice(5).replace('-', '/'),
        recurrence: a.recurrence,
      }));

      /* ---- 1) 에이전트: 도구를 써서 스스로 조회·수정 ---- */
      //
      // 여기서 대부분이 끝난다. 조회·수정·삭제·되묻기는 에이전트가 처리하고,
      // "새로 등록할 내용"이라고 판단했을 때만 아래 추출 파이프라인으로 넘어간다.
      // 생성 경로를 하나로 유지하려는 것이다.
      const agentOut = await runAgent(
        text,
        {
          nodes: Object.values(nodes),
          people: Object.values(people),
          topics: Object.values(topics),
          captures: Object.values(captures),
        },
        async (msgs) => {
          const r = await fetch('/api/ai/agent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: msgs,
              summary: renderAgenda(agenda),
            }),
          });
          if (!r.ok) {
            // 서버가 준 이유를 그대로 올린다. "agent API error"만 던지면
            // 화면에도 콘솔에도 원인이 안 남아서 고칠 수가 없다.
            let why = `HTTP ${r.status}`;
            try {
              const body = await r.json();
              if (body?.error) why = `${why}: ${body.error}`;
            } catch {
              /* 본문이 JSON이 아니면 상태 코드만 */
            }
            throw new Error(why);
          }
          return r.json();
        },
        // 도구 결과 포맷은 프로바이더마다 다르다. 서버가 알려준 형식을 쓴다.
        (id, content) => ({ role: 'tool', tool_call_id: id, content }),
        {
          onStep: (s) =>
            setMessages((prev) =>
              prev.map((m) =>
                m.id === thinkId
                  ? { ...m, content: TOOL_LABEL[s.tool] ?? t.chat.thinking }
                  : m,
              ),
            ),
        },
      );

      // 무엇이 일어났는지 콘솔에 남긴다. 화면에 "..."만 뜨고 끝나면
      // 어디서 멈췄는지 알 수가 없다.
      console.info('[agent]', {
        steps: agentOut.steps.map((s) => s.tool),
        pending: agentOut.pending?.kind ?? null,
        staged: agentOut.staged,
        conflicts: agentOut.conflicts.length,
        truncated: agentOut.truncated,
        text: agentOut.text.slice(0, 120),
      });

      // 확인이 필요한 변경(수정·삭제) → 확인 카드
      if (agentOut.pending) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === thinkId
              ? {
                  id: thinkId,
                  role: 'confirm' as const,
                  content: agentOut.text,
                  pending: agentOut.pending!,
                }
              : m,
          ),
        );
        setIsProcessing(false);
        return;
      }

      // 등록으로 넘어가지 않았으면 = 답변으로 끝난 것 (충돌 안내 포함)
      if (!agentOut.staged) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === thinkId
              ? {
                  id: thinkId,
                  role: 'ai' as const,
                  // 답이 비는 건 정상이 아니다. "..."로 때우면 사용자는
                  // 멈춘 건지 끝난 건지 알 수 없다. 무슨 일이 있었는지 밝힌다.
                  content:
                    agentOut.text ||
                    (agentOut.steps.length
                      ? `확인은 했는데 답변을 만들지 못했습니다. ` +
                        `(실행: ${agentOut.steps.map((s) => s.tool).join(' → ')})\n` +
                        `다시 한 번 말씀해 주시겠어요?`
                      : '답변을 받지 못했습니다. 다시 시도해 주세요.'),
                  conflicts: agentOut.conflicts.length
                    ? agentOut.conflicts
                    : undefined,
                }
              : m,
          ),
        );
        setIsProcessing(false);
        return;
      }

      /* ---- 2) 등록: 기존 추출 파이프라인 → 계획 카드 ---- */
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // 에이전트가 정리한 문장을 넘긴다. 여러 턴에 걸쳐 모인 정보가
          // 합쳐져 있을 수 있으므로 원문 그대로가 아니다.
          input: agentOut.staged,
          history: messages
            .filter((m) => m.role === 'user' || m.role === 'ai')
            .slice(-6)
            .map((m) => ({
              role: m.role === 'user' ? 'user' : 'assistant',
              content: m.content,
            })),
          ctx: {
            projects: projects.map((p) => ({ id: p.id, title: p.title })),
            categories: Object.values(categories).map((c) => ({
              id: c.id,
              label: c.label,
            })),
            people: Object.values(people).map((p) => ({
              id: p.id,
              name: p.name,
              org: p.org,
            })),
            organizations: Object.values(orgs).map((o) => ({
              id: o.id,
              name: o.name,
            })),
            topics: Object.values(topics)
              .filter((tp) => tp.status === 'collecting')
              .map((tp) => ({ id: tp.id, label: tp.label })),
            upcoming,
            // AI가 "지금까지 뭐가 쌓였는지" 볼 수 있게 한 줄 인덱스를 넘긴다.
            // 이게 없으면 이름 목록만 보고 그럴듯한 걸 지어낸다.
            index: buildIndex(Object.values(captures)),
            agenda,
            counts: {
              일정: Object.values(nodes).length,
              인물: Object.values(people).length,
              조직: Object.values(orgs).length,
              프로젝트: projects.length,
            },
          },
          locale: language,
        }),
      });

      if (!res.ok) throw new Error('API error');
      const data = await res.json();

      if (data.intent === 'schedule' && data.extraction) {
        // 일정 담당 → 저장 계획 카드
        const plan = buildPlan(data.extraction, {
          projects,
          findPerson,
          findOrg,
          findTopic,
          findTopicById: (id) => useTopicStore.getState().topics[id],
        });
        setMessages((prev) =>
          prev.map((m) =>
            m.id === thinkId
              ? {
                  id: thinkId,
                  role: 'plan' as const,
                  content: plan.summary,
                  plan,
                  rawText: text,
                  planApplied: false,
                }
              : m,
          ),
        );
      } else {
        // 대화/질의/명령 → 그냥 답한다. 저장하지 않는다.
        setMessages((prev) =>
          prev.map((m) =>
            m.id === thinkId
              ? {
                  id: thinkId,
                  role: 'ai' as const,
                  content: data.reply || '...',
                }
              : m,
          ),
        );
      }
    } catch (err) {
      // 예전엔 여기서 조용히 로컬 파서로 폴백해 초안을 만들었다.
      // 그러면 사용자는 **왜 이상한 게 생겼는지 모른 채** 엉뚱한 초안을 받는다.
      // 실패는 실패라고 보여주는 게 맞다. 원인 없이 "..."만 뜨면 고칠 수도 없다.
      console.error('[AI] 에이전트 실패:', err);
      const detail =
        err instanceof Error ? err.message : String(err ?? 'unknown');
      setMessages((prev) =>
        prev.map((m) =>
          m.id === thinkId
            ? {
                id: thinkId,
                role: 'ai' as const,
                content:
                  `처리 중 오류가 생겼습니다.\n${detail}\n\n` +
                  `잠시 후 다시 시도해 주세요. 계속되면 이 메시지를 알려주세요.`,
              }
            : m,
        ),
      );
    }

    setIsProcessing(false);
  }, [
    input,
    attachedFile,
    language,
    locale,
    addNode,
    updateNode,
    nodes,
    // 에이전트가 조회하는 데이터 — 빠져 있으면 오래된 값으로 검색해서
    // "그런 일정 없습니다"가 나온다.
    people,
    orgs,
    topics,
    captures,
    messages,
    projects,
    categories,
    clarificationState,
    getFieldLabel,
    runProjectMatch,
    t,
  ]);

  /* ================================================================ */
  /*  Render helpers                                                   */
  /* ================================================================ */

  /** 층별 아이콘 */
  const layerIcon = (layer: PlanLayer) => {
    switch (layer) {
      case 'schedule': return CalendarDays;
      case 'person': return Users;
      case 'organization': return Building2;
      case 'project': return FolderOpen;
      case 'task': return ListChecks;
      case 'topic': return Layers;
      default: return FileText;
    }
  };

  /** 층별 색상 */
  const layerTone = (layer: PlanLayer) => {
    switch (layer) {
      case 'schedule': return 'text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/40';
      case 'person': return 'text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/40';
      case 'organization': return 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40';
      case 'project': return 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40';
      case 'task': return 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40';
      case 'topic': return 'text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/40';
      default: return 'text-muted-foreground bg-muted';
    }
  };

  const actionLabel = (action: string) => {
    if (action === 'link') return '기존에 연결';
    if (action === 'merge') return '기존에 배치';
    return '신규';
  };

  /** 주제 → 프로젝트 승격 제안 카드 */
  const renderPromoteCard = (msg: ChatMessage) => {
    const topic = topics[msg.promoteTopicId!];
    if (!topic) return null;
    return (
      <div
        key={msg.id}
        className="rounded-xl border border-teal-500/30 bg-teal-50 p-3 dark:bg-teal-950/30"
      >
        <div className="mb-2 flex items-center gap-2">
          <TrendingUp className="size-3.5 text-teal-600 dark:text-teal-400" />
          <span className="text-xs font-medium text-teal-700 dark:text-teal-300">
            프로젝트로 만들까요?
          </span>
        </div>
        <p className="text-sm font-medium">{topic.label}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          메모 {topic.notes.length}건 · 일정/할일 {topic.nodeIds.length}건이 모였고,
          이제 실제 일정이 생겼습니다.
        </p>
        {topic.notes.length > 0 && (
          <ul className="mt-2 space-y-0.5 rounded-lg bg-background/60 p-2">
            {topic.notes.slice(-3).map((n) => (
              <li
                key={n.id}
                className="truncate text-[11px] text-muted-foreground"
              >
                · {n.text}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex items-center gap-2">
          <Button
            size="sm"
            className="h-7 gap-1 bg-teal-600 text-xs text-white hover:bg-teal-700"
            onClick={() => handlePromote(msg.id, topic.id)}
          >
            <FolderOpen className="size-3" />
            프로젝트로 만들기
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={() => handleDismissPromote(msg.id)}
          >
            더 모으기
          </Button>
        </div>
      </div>
    );
  };

  /** AI가 분해한 저장 계획 카드 */
  const renderPlanCard = (msg: ChatMessage) => {
    const plan = msg.plan!;
    const applied = !!msg.planApplied;

    // 층별로 묶기
    const grouped = plan.items.reduce<Record<string, { item: typeof plan.items[0]; idx: number }[]>>(
      (acc, item, idx) => {
        (acc[item.layer] ??= []).push({ item, idx });
        return acc;
      },
      {},
    );

    const order: PlanLayer[] = ['schedule', 'task', 'topic', 'note', 'person', 'organization', 'project'];
    const enabledCount = plan.items.filter((i) => i.enabled).length;

    return (
      <div
        key={msg.id}
        className="rounded-xl border border-primary/20 bg-primary/5 p-3"
      >
        {/* 요약 */}
        <div className="mb-2 flex items-start gap-2">
          <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-primary">
              {applied ? '저장 완료' : '이렇게 나눠서 저장할게요'}
            </p>
            <p className="mt-0.5 text-sm leading-snug">{plan.summary}</p>
          </div>
        </div>

        {/* 층별 항목 */}
        <div className="space-y-2 rounded-lg border bg-card p-2.5">
          {order.map((layer) => {
            const rows = grouped[layer];
            if (!rows?.length) return null;
            const Icon = layerIcon(layer);
            return (
              <div key={layer}>
                <div className="mb-1 flex items-center gap-1.5">
                  <span
                    className={cn(
                      'flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium',
                      layerTone(layer),
                    )}
                  >
                    <Icon className="size-2.5" />
                    {LAYER_LABEL[layer]}
                  </span>
                </div>
                <div className="space-y-1">
                  {rows.map(({ item, idx }) => (
                    <button
                      key={idx}
                      disabled={applied}
                      onClick={() => togglePlanItem(msg.id, idx)}
                      className={cn(
                        'flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left transition-colors',
                        !applied && 'hover:bg-muted/60',
                        !item.enabled && 'opacity-40',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded border',
                          item.enabled
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-muted-foreground/40',
                        )}
                      >
                        {item.enabled && <Check className="size-2.5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-xs font-medium">
                            {item.label}
                          </span>
                          <span className="shrink-0 text-[9px] text-muted-foreground">
                            {actionLabel(item.action)}
                          </span>
                        </span>
                        {item.detail && (
                          <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                            {item.detail}
                          </span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}

          {plan.items.length === 0 && (
            <p className="py-2 text-center text-xs text-muted-foreground">
              추출된 항목이 없습니다
            </p>
          )}
        </div>

        {/* 액션 */}
        {!applied && plan.items.length > 0 && (
          <div className="mt-2.5 flex items-center gap-2">
            <Button
              size="sm"
              className="h-7 gap-1 bg-primary text-xs text-primary-foreground hover:bg-primary/90"
              onClick={() => handleApplyPlan(msg.id)}
              disabled={enabledCount === 0}
            >
              <Check className="size-3" />
              저장 ({enabledCount})
            </Button>
            {/* 지금 정하기 애매한 건 대기함에 넣어두고 나중에 확정한다 */}
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => handleApplyPlan(msg.id, true)}
              disabled={enabledCount === 0}
              title="캘린더에 넣지 않고 대기함에 보관합니다"
            >
              <Inbox className="size-3" />
              나중에
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs text-muted-foreground"
              onClick={() => handleDiscardPlan(msg.id)}
            >
              <XCircle className="size-3" />
              취소
            </Button>
          </div>
        )}
      </div>
    );
  };

  /**
   * 수정·삭제 확인 카드.
   *
   * 전/후를 나란히 보여준다. "고쳤습니다"라고만 하면 무엇이 바뀌었는지
   * 알 수 없고, 그건 사용자가 확인할 수 없는 변경이다.
   */
  const renderConfirmCard = (msg: ChatMessage) => {
    const p = msg.pending!;
    const isDelete = p.kind === 'delete_schedule';
    const done = !!msg.resolved;

    return (
      <div key={msg.id} className="flex gap-2">
        <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted">
          <MessageCircle className="size-3 text-muted-foreground" />
        </div>
        <div className="w-full max-w-[85%] space-y-2">
          {msg.content ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {msg.content}
            </p>
          ) : null}

          <div
            className={cn(
              'rounded-xl border bg-card p-3',
              isDelete && 'border-destructive/40',
              done && 'opacity-60',
            )}
          >
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium">
              {isDelete ? (
                <XCircle className="size-3.5 text-destructive" />
              ) : (
                <Pencil className="size-3.5 text-primary" />
              )}
              {isDelete ? '이 일정을 삭제할까요?' : '이렇게 바꿀까요?'}
            </p>

            <p className="mb-2 text-sm font-medium">{p.targetTitle}</p>

            {isDelete ? (
              <p className="text-xs text-destructive">
                되돌릴 수 없습니다.
              </p>
            ) : (
              <div className="space-y-2">
                {p.changes.map((c) => (
                  <div key={c.field} className="text-xs">
                    <span className="text-muted-foreground">{c.label}</span>
                    <div className="mt-0.5 space-y-0.5">
                      {/* 전 값은 취소선으로 — 없어지는 것임을 눈으로 알 수 있게 */}
                      <p className="whitespace-pre-wrap text-muted-foreground line-through">
                        {c.before || '(비어 있음)'}
                      </p>
                      <p className="whitespace-pre-wrap font-medium text-foreground">
                        {c.after}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {done ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {msg.resolved === 'applied' ? '적용됨' : '취소됨'}
              </p>
            ) : (
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  variant={isDelete ? 'destructive' : 'default'}
                  className="h-7 flex-1 text-xs"
                  onClick={() => handleApplyPending(msg.id)}
                >
                  <Check className="mr-1 size-3" />
                  {isDelete ? '삭제' : '적용'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 flex-1 text-xs"
                  onClick={() => handleCancelPending(msg.id)}
                >
                  취소
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderProjectMatchCard = (msg: ChatMessage) => {
    const d = msg.projectMatchData;
    if (!d) return null;
    return (
      <div
        key={msg.id}
        className="rounded-xl border border-amber-500/20 bg-amber-50 p-3 dark:bg-amber-950/30"
      >
        <div className="mb-2 flex items-center gap-2">
          <FolderOpen className="size-3.5 text-amber-600 dark:text-amber-400" />
          <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
            {t.chat.projectSuggestion}
          </span>
        </div>
        <p className="mb-1 text-sm font-medium">{d.projectName}</p>
        <p className="mb-3 text-xs text-muted-foreground">
          {t.chat.projectMatchDesc}
        </p>
        <div className="mb-3 flex items-center gap-2">
          <Badge
            variant="outline"
            className="h-5 border-amber-500/30 px-1.5 text-[10px] text-amber-600 dark:text-amber-400"
          >
            {d.confidence}%
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="h-7 gap-1 bg-amber-600 text-xs text-white hover:bg-amber-700"
            onClick={() => handleAddToProject(d.projectId, d.nodeId)}
          >
            <FolderOpen className="size-3" />
            {t.chat.addToProject}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs text-muted-foreground"
            onClick={() => handleKeepUnsorted(d.nodeId)}
          >
            {t.chat.keepUnsorted}
          </Button>
        </div>
      </div>
    );
  };

  const renderDraftCard = (msg: ChatMessage) => {
    const node = nodes[msg.draftNodeId!];
    if (!node) return null;

    const TypeIcon = typeIcon(node.type);
    const scheduleStr = formatSchedule(node);
    const isClarifying = clarificationState.awaiting?.nodeId === node.id;
    const isEditing = editingNodeId === node.id;
    const isConfirmed = node.aiMeta?.status === 'confirmed';

    return (
      <div
        key={msg.id}
        className="rounded-xl border border-primary/20 bg-primary/5 p-3"
      >
        <p className="mb-2 text-xs font-medium text-primary">{msg.content}</p>

        <div className="rounded-lg border bg-card p-3">
          {/* ---- EDIT MODE ---- */}
          {isEditing && (
            <div className="space-y-2">
              {/* Title */}
              <div>
                <label className="mb-1 block text-[10px] font-medium text-muted-foreground">
                  {t.chat.editTitle}
                </label>
                <Input
                  value={editValues.title}
                  onChange={(e) =>
                    setEditValues((v) => ({ ...v, title: e.target.value }))
                  }
                  placeholder={t.chat.editTitlePlaceholder}
                  className="h-8 text-sm"
                />
              </div>

              {/* Location (calendar_event only) */}
              {node.type === 'calendar_event' && (
                <div>
                  <label className="mb-1 block text-[10px] font-medium text-muted-foreground">
                    {t.chat.editLocation}
                  </label>
                  <Input
                    value={editValues.location}
                    onChange={(e) =>
                      setEditValues((v) => ({
                        ...v,
                        location: e.target.value,
                      }))
                    }
                    placeholder={t.chat.editLocationPlaceholder}
                    className="h-8 text-sm"
                  />
                </div>
              )}

              {/* Attendees (calendar_event only) */}
              {node.type === 'calendar_event' && (
                <div>
                  <label className="mb-1 block text-[10px] font-medium text-muted-foreground">
                    {t.chat.editAttendees}
                  </label>
                  <Input
                    value={editValues.attendees}
                    onChange={(e) =>
                      setEditValues((v) => ({
                        ...v,
                        attendees: e.target.value,
                      }))
                    }
                    placeholder={t.chat.editAttendeesPlaceholder}
                    className="h-8 text-sm"
                  />
                </div>
              )}

              {/* Duration (calendar_event only) */}
              {node.type === 'calendar_event' && (
                <div>
                  <label className="mb-1 block text-[10px] font-medium text-muted-foreground">
                    {t.chat.editDuration}
                  </label>
                  <Input
                    value={editValues.duration}
                    onChange={(e) =>
                      setEditValues((v) => ({
                        ...v,
                        duration: e.target.value,
                      }))
                    }
                    type="number"
                    min="1"
                    className="h-8 text-sm"
                  />
                </div>
              )}

              {/* Description */}
              <div>
                <label className="mb-1 block text-[10px] font-medium text-muted-foreground">
                  {t.chat.editDescription}
                </label>
                <Textarea
                  value={editValues.description}
                  onChange={(e) =>
                    setEditValues((v) => ({
                      ...v,
                      description: e.target.value,
                    }))
                  }
                  placeholder={t.chat.editDescriptionPlaceholder}
                  className="min-h-[60px] text-sm"
                  rows={2}
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Button
                  size="sm"
                  className="h-7 gap-1 bg-primary text-xs text-primary-foreground hover:bg-primary/90"
                  onClick={() => handleSaveEdit(node.id)}
                >
                  <Check className="size-3" />
                  {t.chat.saveEdit}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-xs text-muted-foreground"
                  onClick={() => setEditingNodeId(null)}
                >
                  {t.chat.cancelDraft}
                </Button>
              </div>
            </div>
          )}

          {/* ---- DISPLAY MODE ---- */}
          {!isEditing && (
            <>
              <div className="mb-2 flex items-center gap-2">
                <TypeIcon className="size-3.5 text-primary" />
                <Badge
                  variant="secondary"
                  className="h-5 px-1.5 text-[10px]"
                >
                  {typeLabel(node.type)}
                </Badge>
              </div>

              <p className="text-sm font-medium">{node.title}</p>

              {scheduleStr && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {scheduleStr}
                </p>
              )}

              {node.description && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {node.description}
                </p>
              )}

              {/* Draft actions */}
              {node.aiMeta?.status === 'draft' && (
                <>
                  {/* Clarifying indicator */}
                  {isClarifying && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                      <AlertCircle className="size-3" />
                      <span>{t.chat.clarification}</span>
                    </div>
                  )}

                  {/* Confirm / Edit / Cancel — only when NOT clarifying */}
                  {!isClarifying && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        className="h-7 gap-1 bg-primary text-xs text-primary-foreground hover:bg-primary/90"
                        onClick={() => handleConfirmDraft(node)}
                      >
                        {t.chat.confirmDraft}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 text-xs text-muted-foreground"
                        onClick={() => handleStartEdit(node)}
                      >
                        <Pencil className="size-3" />
                        {t.chat.editDraft}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 text-xs text-muted-foreground"
                        onClick={() => handleCancelDraft(node.id)}
                      >
                        <XCircle className="size-3" />
                        {t.chat.cancelDraft}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  /* ================================================================ */
  /*  JSX                                                              */
  /* ================================================================ */

  const hasMessages = messages.length > 0;

  /* ---------------------------------------------------------------- */
  /*  공용 조각 — 두 변형이 같이 씀                                     */
  /* ---------------------------------------------------------------- */

  const messageList = (
    <div className="space-y-3">
      {messages.map((msg) => {
        if (msg.isThinking) {
          return (
            <div key={msg.id} className="flex gap-2">
              <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted">
                <Loader2 className="size-3 animate-spin text-muted-foreground" />
              </div>
              <p className="text-xs italic text-muted-foreground">
                {msg.content}
              </p>
            </div>
          );
        }
        if (msg.role === 'user') {
          return (
            <div key={msg.id} className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
                {msg.content}
              </div>
            </div>
          );
        }
        if (msg.role === 'plan' && msg.plan) return renderPlanCard(msg);
        if (msg.role === 'draft' && msg.draftNodeId) return renderDraftCard(msg);
        if (msg.role === 'project_match') return renderProjectMatchCard(msg);
        if (msg.role === 'confirm' && msg.pending) return renderConfirmCard(msg);
        return (
          <div key={msg.id} className="flex gap-2">
            <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted">
              <MessageCircle className="size-3 text-muted-foreground" />
            </div>
            <div className="max-w-[85%] space-y-2">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                {msg.content}
              </p>
              {/*
                충돌은 AI 말과 별개로 항상 보여준다.
                모델이 설명을 빠뜨려도 사용자는 무엇과 겹쳤는지 알아야 한다.
              */}
              {msg.conflicts?.length ? (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                  <p className="mb-1 flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                    <AlertCircle className="size-3" />
                    이미 등록된 일정과 겹칩니다
                  </p>
                  <ul className="space-y-0.5">
                    {msg.conflicts.map((c, i) => (
                      <li key={i} className="text-xs text-muted-foreground">
                        · {c.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
      <div ref={messagesEndRef} />
    </div>
  );

  const attachedChip = attachedFile ? (
    <div className="flex items-center gap-1.5 border-t bg-card px-4 py-2">
      <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
        <Paperclip className="size-3" />
        {t.chat.fileAttached}
        <button
          onClick={() => setAttachedFile(null)}
          className="ml-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      </span>
    </div>
  ) : null;

  const inputBar = (
    <div
      className={cn(
        'shrink-0 border-t bg-card px-3 py-2',
        !isFloating && 'pb-[max(0.5rem,env(safe-area-inset-bottom))]',
      )}
    >
      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md,.json,.csv"
          onChange={handleFileSelect}
          className="hidden"
        />
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground"
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip className="size-4" />
        </Button>

        <VoiceButton onTranscript={handleVoiceTranscript} />

        {/*
          한 줄일 때는 알약 모양을 유지해야 해서 rounded-full을 쓰는데,
          여러 줄로 늘어나면 그 곡률이 이상해진다. 그래서 높이에 따라
          rounded-full ↔ rounded-2xl로 바꾼다.
          items-center가 아니라 items-end인 이유: 여러 줄일 때 버튼이
          가운데 떠 있으면 어색하다. 마지막 줄에 맞춘다.
        */}
        <div
          className={cn(
            'flex flex-1 items-end gap-1 border bg-background px-3 py-1.5',
            isMultiline ? 'rounded-2xl' : 'rounded-full'
          )}
        >
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              autoGrow(e.currentTarget);
            }}
            onKeyDown={(e) => {
              // Shift+Enter는 그냥 흘려보낸다 — textarea 기본 동작이 줄바꿈이다.
              // Enter 단독일 때만 가로채서 전송한다.
              // (IME 조합 중의 Enter는 한글 확정이지 전송이 아니다. 이걸 안 막으면
              //  "안녕"을 치다가 조합 확정하는 순간 전송돼 버린다.)
              if (
                e.key === 'Enter' &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing &&
                !isProcessing
              ) {
                e.preventDefault();
                handleSend();
              }
            }}
            onFocus={() => !isFloating && setOpen(true)}
            placeholder={
              clarificationState.awaiting
                ? getFieldLabel(clarificationState.awaiting.fieldName)
                : t.chat.placeholder
            }
            className="flex-1 resize-none bg-transparent py-0.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/60"
            style={{ maxHeight: MAX_INPUT_HEIGHT }}
            disabled={isProcessing}
          />
        </div>

        <Button
          size="icon"
          className="size-8 shrink-0 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={handleSend}
          disabled={isProcessing || (!input.trim() && !attachedFile)}
          data-send-btn="true"
        >
          {isProcessing ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Send className="size-3.5" />
          )}
        </Button>
      </div>
    </div>
  );

  /* ================================================================ */
  /*  변형 1: 플로팅 창 (데스크톱)                                      */
  /* ================================================================ */

  if (isFloating) {
    return (
      <>
        {/* 닫혀 있을 때: 열기 버튼 */}
        <AnimatePresence>
          {!open && (
            <motion.button
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              onClick={() => setOpen(true)}
              className="group fixed bottom-6 right-6 z-50 flex h-12 items-center gap-2 rounded-full bg-gradient-to-br from-teal-500 to-emerald-600 px-3.5 text-white shadow-lg shadow-teal-500/25 transition-all hover:pr-4"
              aria-label={`${t.chat.title} 열기`}
              title={`${t.chat.title} 열기`}
            >
              <MessageCircle className="size-5 shrink-0" />
              {/* 평소엔 아이콘만, 호버하면 이름이 펼쳐진다 */}
              <span className="max-w-0 overflow-hidden whitespace-nowrap text-sm font-medium opacity-0 transition-all duration-200 group-hover:max-w-[8rem] group-hover:opacity-100">
                {t.chat.title}
              </span>
              {draftCount > 0 && (
                <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                  {draftCount}
                </span>
              )}
            </motion.button>
          )}
        </AnimatePresence>

        {/* 열려 있을 때: 드래그·리사이즈 창 */}
        {open && rect && (
          <div
            className={cn(
              'fixed z-50 flex flex-col overflow-hidden rounded-xl border bg-card shadow-2xl',
              // 드래그 중에는 그림자를 키워 떠 있는 느낌
              interacting && 'shadow-[0_20px_60px_-10px_rgba(0,0,0,0.4)]',
            )}
            style={{
              left: rect.x,
              top: rect.y,
              width: rect.w,
              height: rect.h,
            }}
          >
            {/* ---- 타이틀 바 (드래그 핸들) ---- */}
            <div
              {...dragProps}
              onDoubleClick={() => setOpen(false)}
              className={cn(
                // min-h로 고정해 버튼/배지가 눌리거나 잘리지 않게 한다
                'flex h-11 shrink-0 items-center gap-2 border-b bg-muted/40 px-3 select-none',
                interacting ? 'cursor-grabbing' : 'cursor-grab',
              )}
            >
              <GripHorizontal className="size-3.5 shrink-0 text-muted-foreground/60" />
              <MessageCircle className="size-3.5 shrink-0 text-primary" />
              <span className="flex-1 truncate text-xs font-semibold">
                {t.chat.title}
              </span>
              {draftCount > 0 && (
                <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                  {draftCount}
                </Badge>
              )}
              {/* 창 조작 버튼 — 드래그 시작 방지 위해 pointerDown 전파 차단 */}
              <div
                className="flex items-center gap-0.5"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <button
                  title="기본 위치로"
                  aria-label="기본 위치로"
                  onClick={reset}
                  className="flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                >
                  <RotateCcw className="size-3.5" />
                </button>
                <button
                  title="아이콘으로 접기"
                  aria-label="아이콘으로 접기"
                  onClick={() => setOpen(false)}
                  className="flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                >
                  <Minus className="size-4" />
                </button>
                <button
                  title="닫기"
                  aria-label="닫기"
                  onClick={() => setOpen(false)}
                  className="flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>

            <>
                <ScrollArea className="min-h-0 flex-1 px-4 py-3">
                  {hasMessages ? (
                    messageList
                  ) : (
                    <p className="py-8 text-center text-xs text-muted-foreground">
                      {t.chat.welcomeMessage}
                    </p>
                  )}
                </ScrollArea>
                {attachedChip}
                {inputBar}
            </>

            {/* ---- 8방향 리사이즈 손잡이 ---- */}
            {RESIZE_HANDLES.map(({ dir, className }) => (
                <div
                  key={dir}
                  {...resizeProps(dir)}
                  className={cn('absolute z-10', className)}
                />
              ))}
          </div>
        )}
      </>
    );
  }

  /* ================================================================ */
  /*  변형 2: 하단 시트 (모바일)                                        */
  /* ================================================================ */
  //
  // 메시지 영역이 레이아웃을 밀어내면 캘린더가 눌리므로, 시트는 본문 위로
  // 겹쳐서(overlay) 올라온다. 입력 바만 항상 자리를 차지한다.

  return (
    <>
      {/* 펼쳐졌을 때 뒤 배경 — 탭하면 닫힘 */}
      <AnimatePresence>
        {open && hasMessages && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            data-testid="chat-backdrop"
            className="fixed inset-0 z-30 bg-black/20"
            onClick={() => setOpen(false)}
          />
        )}
      </AnimatePresence>

      <div className="relative z-40 flex flex-col">
        {/* 메시지 시트 — 입력 바 위로 겹쳐 올라온다 */}
        <AnimatePresence>
          {open && hasMessages && (
            <motion.div
              initial={{ y: 12, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 12, opacity: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              data-testid="chat-sheet"
              className="absolute bottom-full inset-x-0 flex max-h-[55vh] flex-col overflow-hidden rounded-t-2xl border-x border-t bg-card shadow-2xl"
            >
              <div className="flex shrink-0 items-center justify-between border-b px-4 py-2">
                <div className="flex items-center gap-2">
                  <MessageCircle className="size-3.5 text-primary" />
                  <span className="text-xs font-semibold">{t.chat.title}</span>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="닫기"
                  className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>
              <ScrollArea className="min-h-0 flex-1 px-4 py-3">
                {messageList}
              </ScrollArea>
            </motion.div>
          )}
        </AnimatePresence>

        {attachedChip}
        {inputBar}
      </div>
    </>
  );
}