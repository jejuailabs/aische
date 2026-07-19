'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { useNodeStore, usePrefStore } from '@/lib/store';
import { useLocale } from '@/hooks/use-locale';
import { parseUserInput, createDraftNode } from '@/lib/ai-parser';
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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import type { Node } from '@/lib/types';

interface ChatMessage {
  id: string;
  role: 'user' | 'ai' | 'draft';
  content: string;
  draftNode?: Node;
  isThinking?: boolean;
}

export function ChatPanel() {
  const { t, locale } = useLocale();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [attachedFile, setAttachedFile] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDark, setIsDark] = useState(false);
  const addNode = useNodeStore((s) => s.addNode);
  const updateNode = useNodeStore((s) => s.updateNode);
  const removeNode = useNodeStore((s) => s.removeNode);
  const nodes = useNodeStore((s) => s.nodes);
  const language = usePrefStore((s) => s.language);

  // Track dark mode safely
  useEffect(() => {
    setIsDark(document.documentElement.classList.contains('dark'));
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const draftCount = Object.values(nodes).filter(
    (n) => n.aiMeta?.status === 'draft'
  ).length;

  const dateLocale = locale === 'ko' ? undefined : undefined;

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  // Welcome message on first open
  const [isFirstOpen, setIsFirstOpen] = useState(true);
  const welcomeRef = useRef<ChatMessage | null>(null);
  useEffect(() => {
    if (open && !isFirstOpen) return;
    if (welcomeRef.current) {
      setMessages((prev) => [...prev, welcomeRef.current]);
      welcomeRef.current = null;
      setIsFirstOpen(true);
    }
  }, [open, isFirstOpen]);

  const formatSchedule = (node: Node) => {
    if (!node.schedule) return null;
    const s = node.schedule;
    const parts: string[] = [];
    if (s.allDay) {
      parts.push(
        locale === 'ko'
          ? `${s.startAt.getMonth() + 1}/${s.startAt.getDate()} (${['일', '월', '화', '수', '목', '금', '토'][s.startAt.getDay()]})`
          : s.startAt.toLocaleDateString(locale, { month: 'short', weekday: 'short' })
      );
    } else {
      const fmt = (d: Date) =>
        locale === 'ko'
          ? `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
          : d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
      parts.push(fmt(s.startAt) + '~' + fmt(s.endAt));
    }
    if (s.location) parts.push('📍 ' + s.location);
    if (s.attendees.length > 0) parts.push('👥 ' + s.attendees.join(', '));
    return parts.join(' · ');
  };

  const typeLabel = (type: string) => {
    if (type === 'calendar_event') return t.chat.typeEvent;
    if (type === 'todo') return t.chat.typeTodo;
    return t.chat.typeGoal;
  };

  const typeIcon = (type: string) => {
    if (type === 'calendar_event') return CalendarDays;
    return ListChecks;
  };

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text && !attachedFile) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: text || '📎 파일',
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsProcessing(true);

    // Handle file
    if (attachedFile) {
      try {
        const { parseFileContent } = await import('@/lib/ai-parser');
        const results = parseFileContent(attachedFile);
        if (results.length === 0) {
          setMessages((prev) => [
            ...prev,
            { id: Date.now().toString() + 'e', role: 'ai', content: t.chat.fileParseError },
          ]);
        } else {
          const { createDraftNode: cfn } = await import('@/lib/ai-parser');
          for (const r of results) {
            const draft = cfn(r, 'demo-workspace');
            addNode(draft);
            setMessages((prev) => [
              ...prev,
              {
                id: Date.now().toString() + 'd' + Math.random(),
                role: 'draft',
                content: t.chat.parsedSummary,
                draftNode: draft,
              },
            ]);
          }
        }
      } catch {
        setMessages((prev) => [
          ...prev,
          { id: Date.now().toString() + 'e', role: 'ai', content: t.chat.fileParseError },
        ]);
      }
      setAttachedFile(null);
      setIsProcessing(false);
      return;
    }

    // Simulate AI thinking delay
    const thinkId = Date.now().toString() + 't';
    setMessages((prev) => [
      ...prev,
      { id: thinkId, role: 'ai', content: t.chat.thinking, isThinking: true },
    ]);

    await new Promise((r) => setTimeout(r, 600));

    // Parse input
    const { parseUserInput: parse } = await import('@/lib/ai-parser');
    const result = parse(text, language);

    // Create draft node
    const draft = createDraftNode(result, 'demo-workspace');
    addNode(draft);

    setMessages((prev) =>
      prev.map((m) =>
        m.id === thinkId
          ? {
              id: thinkId,
              role: 'draft',
              content:
                result.missingFields.length > 0 ? t.chat.missingFields : t.chat.parsedSummary,
              draftNode: draft,
            }
          : m
      )
    );
    setIsProcessing(false);
  }, [input, attachedFile, language, addNode, t]);

  const handleConfirmDraft = useCallback(
    (node: Node) => {
      if (!node.aiMeta) return;
      updateNode(node.id, {
        aiMeta: { ...node.aiMeta, status: 'confirmed' },
      });
      toast.success(t.chat.draftSaved);
      setMessages((prev) => {
        const filtered = prev.filter((m) => m.draftNode?.id !== node.id);
        return [
          ...filtered,
          {
            id: Date.now().toString() + 'c',
            role: 'ai',
            content: '✅ ' + node.title + ' — ' + t.chat.draftSaved,
          },
        ];
      });
    },
    [updateNode, t]
  );

  const handleCancelDraft = useCallback(
    (node: Node) => {
      removeNode(node.id);
      setMessages((prev) => prev.filter((m) => m.draftNode?.id !== node.id));
    },
    [removeNode]
  );

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setAttachedFile(ev.target?.result as string);
    };
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  return (
    <>
      {/* Floating trigger button */}
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

      {/* Chat panel */}
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
              {/* Header */}
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

              {/* Messages */}
              <ScrollArea className="flex-1 px-4 py-3">
                <div className="space-y-3">
                  {messages.map((msg) => {
                    if (msg.isThinking) {
                      return (
                        <div key={msg.id} className="flex gap-2">
                          <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted">
                            <Loader2 className="size-3 animate-spin text-muted-foreground" />
                          </div>
                          <p className="text-xs text-muted-foreground italic">
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

                    if (msg.role === 'draft' && msg.draftNode) {
                      const node = msg.draftNode;
                      const TypeIcon = typeIcon(node.type);
                      const scheduleStr = formatSchedule(node);

                      return (
                        <div
                          key={msg.id}
                          className="rounded-xl border border-primary/20 bg-primary/5 p-3"
                        >
                          <p className="mb-2 text-xs font-medium text-primary">
                            {msg.content}
                          </p>
                          <div className="rounded-lg border bg-card p-3">
                            <div className="mb-2 flex items-center gap-2">
                              <TypeIcon className="size-3.5 text-primary" />
                              <Badge
                                variant="secondary"
                                className="text-[10px] h-5 px-1.5"
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
                            {node.aiMeta && node.aiMeta.status === 'draft' && (
                              <>
                                {node.priority.urgency <= 2 && (
                                  <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-600">
                                    <AlertCircle className="size-3" />
                                    <span>{t.chat.clarification}</span>
                                  </div>
                                )}
                                <div className="mt-3 flex items-center gap-2">
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
                                    onClick={() => handleCancelDraft(node)}
                                  >
                                    <XCircle className="size-3" />
                                    {t.chat.cancelDraft}
                                  </Button>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    }

                    // AI message
                    return (
                      <div key={msg.id} className="flex gap-2">
                        <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted">
                          <MessageCircle className="size-3 text-muted-foreground" />
                        </div>
                        <p className="max-w-[85%] text-sm text-foreground leading-relaxed">
                          {msg.content}
                        </p>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>

              {/* Attached file chip */}
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

              {/* Input area */}
              <div className="border-t px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
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
                    placeholder={t.chat.placeholder}
                    className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
                    disabled={isProcessing}
                  />
                  <Button
                    size="icon"
                    className="size-8 shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
                    onClick={handleSend}
                    disabled={isProcessing || (!input.trim() && !attachedFile)}
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