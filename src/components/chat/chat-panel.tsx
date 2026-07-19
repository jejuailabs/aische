'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { useNodeStore, useProjectStore, usePrefStore } from '@/lib/store';
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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import type { Node } from '@/lib/types';
import { VoiceButton } from './voice-input';

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
  role: 'user' | 'ai' | 'draft' | 'project_match';
  content: string;
  /** Reference to node stored in Zustand — keeps UI in sync after edits / clarification */
  draftNodeId?: string;
  isThinking?: boolean;
  projectMatchData?: ProjectMatchData;
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

export function ChatPanel() {
  const { t, locale } = useLocale();

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
  const language = usePrefStore((s) => s.language);

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

    await new Promise((r) => setTimeout(r, 600));

    /* ---- parse & create draft ---- */
    const result = parseUserInput(text, language);
    const draft = createDraftNode(result, 'demo-workspace');
    addNode(draft);

    if (result.missingFields.length > 0) {
      // replace thinking with draft card, then start clarification
      setMessages((prev) =>
        prev.map((m) =>
          m.id === thinkId
            ? {
                id: thinkId,
                role: 'draft' as const,
                content: t.chat.clarifyingTitle,
                draftNodeId: draft.id,
              }
            : m,
        ),
      );

      const firstField = result.missingFields[0];
      setClarificationState({
        awaiting: {
          fieldName: firstField,
          nodeId: draft.id,
          remainingFields: result.missingFields,
        },
      });

      await new Promise((r) => setTimeout(r, 200));

      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString() + 'q',
          role: 'ai' as const,
          content: getFieldLabel(firstField),
        },
      ]);
    } else {
      // no missing fields → confirm card + project match
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
      runProjectMatch(draft);
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
    clarificationState,
    getFieldLabel,
    runProjectMatch,
    t,
  ]);

  /* ================================================================ */
  /*  Render helpers                                                   */
  /* ================================================================ */

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

  return (
    <>
      {/* ============ Floating Action Button ============ */}
      <AnimatePresence>
        {!open && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            onClick={() => setOpen(true)}
            className="fixed bottom-20 right-4 z-50 flex size-12 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-emerald-600 text-white shadow-lg shadow-teal-500/25 lg:bottom-6"
            aria-label={t.chat.title}
          >
            <MessageCircle className="size-5" />
            {draftCount > 0 && (
              <span className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                {draftCount}
              </span>
            )}
          </motion.button>
        )}
      </AnimatePresence>

      {/* ============ Chat Panel ============ */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-[420px] lg:inset-auto lg:right-4 lg:bottom-6 lg:top-auto"
          >
            <div className="flex h-[70vh] max-h-[560px] flex-col rounded-t-2xl border bg-card shadow-2xl lg:h-[480px] lg:rounded-2xl">
              {/* ---- Header ---- */}
              <div className="flex items-center justify-between border-b px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-teal-500 to-emerald-600">
                    <MessageCircle className="size-3.5 text-white" />
                  </div>
                  <span className="text-sm font-semibold">{t.chat.title}</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={() => setOpen(false)}
                >
                  <X className="size-4" />
                </Button>
              </div>

              {/* ---- Messages ---- */}
              <ScrollArea className="flex-1 px-4 py-3">
                <div className="space-y-3">
                  {messages.map((msg) => {
                    /* Thinking indicator */
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

                    /* User bubble */
                    if (msg.role === 'user') {
                      return (
                        <div key={msg.id} className="flex justify-end">
                          <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
                            {msg.content}
                          </div>
                        </div>
                      );
                    }

                    /* Draft card */
                    if (msg.role === 'draft' && msg.draftNodeId) {
                      return renderDraftCard(msg);
                    }

                    /* Project match suggestion */
                    if (msg.role === 'project_match') {
                      return renderProjectMatchCard(msg);
                    }

                    /* AI text message */
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
              </ScrollArea>

              {/* ---- Attached file chip ---- */}
              {attachedFile && (
                <div className="flex items-center gap-1.5 border-t px-4 py-2">
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
              )}

              {/* ---- Input area ---- */}
              <div className="border-t px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                <div className="flex items-center gap-2">
                  {/* hidden file input */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.md,.json,.csv"
                    onChange={handleFileSelect}
                    className="hidden"
                  />

                  {/* Paperclip */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0 text-muted-foreground"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Paperclip className="size-4" />
                  </Button>

                  {/* Voice input — Phase 4 */}
                  <VoiceButton onTranscript={handleVoiceTranscript} />

                  {/* Text input */}
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
                    placeholder={
                      clarificationState.awaiting
                        ? getFieldLabel(clarificationState.awaiting.fieldName)
                        : t.chat.placeholder
                    }
                    className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
                    disabled={isProcessing}
                  />

                  {/* Send */}
                  <Button
                    size="icon"
                    className="size-8 shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
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
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}