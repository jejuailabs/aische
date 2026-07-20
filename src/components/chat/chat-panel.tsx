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
} from '@/lib/store';
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
  Building2,
  FileText,
  Minus,
  RotateCcw,
  GripHorizontal,
  ChevronDown,
  ChevronUp,
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
  role: 'user' | 'ai' | 'draft' | 'project_match' | 'plan';
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
  const [minimized, setMinimized] = useState(false);

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
  const inputRef = useRef<HTMLInputElement>(null);
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
  const addCapture = useCaptureStore((s) => s.addCapture);
  const updateCapture = useCaptureStore((s) => s.updateCapture);

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

  /** 계획을 실제로 저장 — 각 층으로 분산 저장 */
  const handleApplyPlan = useCallback(
    (msgId: string) => {
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
      });

      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, planApplied: true } : m)),
      );

      const parts: string[] = [];
      if (result.nodeIds.length) parts.push(`일정/실행 ${result.nodeIds.length}`);
      if (result.personIds.length) parts.push(`인물 ${result.personIds.length}`);
      if (result.orgIds.length) parts.push(`조직 ${result.orgIds.length}`);
      toast.success(
        parts.length ? `저장 완료 — ${parts.join(', ')}` : '저장 완료',
      );
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
    ],
  );

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
      // 다가오는 일정 요약 — 대화/질의 담당이 근거로 쓴다
      const now = new Date();
      const upcoming = Object.values(nodes)
        .filter((n) => n.schedule && n.aiMeta?.status !== 'draft')
        .map((n) => ({ n, s: n.schedule! }))
        .filter(({ s }) => s.recurrence || s.startAt >= now)
        .sort((a, b) => a.s.startAt.getTime() - b.s.startAt.getTime())
        .slice(0, 12)
        .map(({ n, s }) => ({
          title: n.title,
          when: `${s.startAt.getMonth() + 1}/${s.startAt.getDate()}`,
          recurrence: describeRecurrence(s.recurrence) || null,
        }));

      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: text,
          // 직전 대화 — 라우터가 맥락을 보고 판단하도록
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
            upcoming,
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
      console.warn('[AI] 실패, 로컬 파서로 폴백:', err);
      const result = parseUserInput(text, language);
      const draft = createDraftNode(result, 'demo-workspace');
      addNode(draft);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === thinkId
            ? {
                id: thinkId,
                role: 'draft' as const,
                content: t.chat.parsedSummary,
                draftNodeId: draft.id,
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
      default: return 'text-muted-foreground bg-muted';
    }
  };

  const actionLabel = (action: string) => {
    if (action === 'link') return '기존에 연결';
    if (action === 'merge') return '기존에 배치';
    return '신규';
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

    const order: PlanLayer[] = ['schedule', 'task', 'person', 'organization', 'project', 'note'];
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
        return (
          <div key={msg.id} className="flex gap-2">
            <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted">
              <MessageCircle className="size-3 text-muted-foreground" />
            </div>
            <p className="max-w-[85%] text-sm leading-relaxed text-foreground">
              {msg.content}
            </p>
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
        'border-t bg-card px-3 py-2.5',
        !isFloating && 'pb-[max(0.625rem,env(safe-area-inset-bottom))]',
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

        <div className="flex flex-1 items-center gap-1 rounded-full border bg-background px-3 py-1.5">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !isProcessing) {
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
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
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
              height: minimized ? undefined : rect.h,
            }}
          >
            {/* ---- 타이틀 바 (드래그 핸들) ---- */}
            <div
              {...dragProps}
              onDoubleClick={() => setMinimized((m) => !m)}
              className={cn(
                'flex shrink-0 items-center gap-2 border-b bg-muted/40 px-3 py-2 select-none',
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
                  title={minimized ? '펼치기' : '접기'}
                  aria-label={minimized ? '펼치기' : '접기'}
                  onClick={() => setMinimized((m) => !m)}
                  className="flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                >
                  {minimized ? (
                    <ChevronUp className="size-4" />
                  ) : (
                    <ChevronDown className="size-4" />
                  )}
                </button>
                <button
                  title="아이콘으로 최소화"
                  aria-label="아이콘으로 최소화"
                  onClick={() => setOpen(false)}
                  className="flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                >
                  <Minus className="size-4" />
                </button>
                <button
                  title="닫기"
                  aria-label="닫기"
                  onClick={() => {
                    setOpen(false);
                    setMinimized(false);
                  }}
                  className="flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>

            {!minimized && (
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
            )}

            {/* ---- 8방향 리사이즈 손잡이 ---- */}
            {!minimized &&
              RESIZE_HANDLES.map(({ dir, className }) => (
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
  /*  변형 2: 하단 고정 바 (모바일)                                     */
  /* ================================================================ */

  return (
    <div className="flex flex-col">
      <AnimatePresence>
        {open && hasMessages && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden border-t bg-card"
          >
            <div className="flex items-center justify-between border-b px-4 py-2">
              <div className="flex items-center gap-2">
                <MessageCircle className="size-3.5 text-primary" />
                <span className="text-xs font-semibold">{t.chat.title}</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                onClick={() => setOpen(false)}
              >
                <X className="size-3.5" />
              </Button>
            </div>
            <ScrollArea className="max-h-[40vh] px-4 py-3">
              {messageList}
            </ScrollArea>
          </motion.div>
        )}
      </AnimatePresence>

      {attachedChip}
      {inputBar}
    </div>
  );
}