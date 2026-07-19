'use client';

import { useMemo, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  useNodeStore,
  useCategoryStore,
  useProjectStore,
  useNavStore,
  usePrefStore,
} from '@/lib/store';
import { useLocale } from '@/hooks/use-locale';
import { createNode, formatTime, isSameDay } from '@/lib/services';
import { parseUserInput, createDraftNode } from '@/lib/ai-parser';
import { endOfDay, startOfDay } from 'date-fns';
import { motion } from 'framer-motion';
import {
  Pin,
  ArrowRight,
  Plus,
  CheckCircle2,
  Inbox,
  Send,
  MessageCircle,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

const cardVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.25, ease: 'easeOut' },
  }),
};

export function DashboardView() {
  const { t } = useLocale();
  const allNodes = useNodeStore((s) => s.nodes);
  const toggleNodeStatus = useNodeStore((s) => s.toggleNodeStatus);
  const addNode = useNodeStore((s) => s.addNode);
  const getColor = useCategoryStore((s) => s.getColor);
  const projects = useProjectStore((s) => s.projects);
  const setView = useNavStore((s) => s.setView);
  const setSelectedProject = useNavStore((s) => s.setSelectedProject);
  const language = usePrefStore((s) => s.language);

  const today = new Date();

  const todayEvents = useMemo(() => {
    return Object.values(allNodes)
      .filter(
        (n) =>
          n.type === 'calendar_event' &&
          n.schedule?.startAt &&
          isSameDay(n.schedule.startAt, today)
      )
      .sort((a, b) => {
        const aH = a.schedule!.startAt.getHours();
        const bH = b.schedule!.startAt.getHours();
        return aH - bH;
      });
  }, [allNodes, today]);

  const todayTodos = useMemo(() => {
    return Object.values(allNodes).filter((n) => {
      if (n.status === 'completed') return false;
      if (n.type !== 'todo') return false;
      if (n.schedule?.dueAt && isSameDay(n.schedule.dueAt, today)) return true;
      return false;
    });
  }, [allNodes, today]);

  const unsortedNodes = useMemo(() => {
    return Object.values(allNodes).filter(
      (n) => n.projectId === 'unsorted'
    );
  }, [allNodes]);

  const [quickTodo, setQuickTodo] = useState('');
  const [aiInput, setAiInput] = useState('');
  const [aiProcessing, setAiProcessing] = useState(false);

  const handleQuickAdd = useCallback(() => {
    const title = quickTodo.trim();
    if (!title) return;
    const node = createNode({
      title,
      workspaceId: 'demo-workspace',
      type: 'todo',
      status: 'scheduled',
      schedule: {
        startAt: startOfDay(today),
        endAt: endOfDay(today),
        dueAt: endOfDay(today),
        allDay: true,
        category: '',
        location: null,
        attendees: [],
        reminders: [],
      },
    });
    addNode(node);
    setQuickTodo('');
  }, [quickTodo, addNode, today]);

  const handleAiSend = useCallback(async () => {
    const text = aiInput.trim();
    if (!text) return;
    setAiProcessing(true);
    await new Promise((r) => setTimeout(r, 1000));
    const result = parseUserInput(text, language);
    const draft = createDraftNode(result, 'demo-workspace');
    addNode(draft);
    setAiInput('');
    setAiProcessing(false);
    toast.success(t.chat.draftCreated);
  }, [aiInput, language, addNode, t.chat.draftCreated]);

  const isDark = document.documentElement.classList.contains('dark');

  return (
    <div className="flex flex-col gap-4">
      {/* AI Assistant Widget */}
      <motion.div
        custom={-1}
        variants={cardVariants}
        initial="hidden"
        animate="visible"
        className="md:col-span-2 xl:col-span-3"
      >
        <Card className="overflow-hidden">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-teal-500 to-emerald-600">
                <MessageCircle className="size-3.5 text-white" />
              </div>
              <CardTitle className="text-sm font-semibold">{t.chat.title}</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t.chat.welcomeMessage}
            </p>
            <div className="flex gap-2">
              <Input
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAiSend();
                }}
                placeholder={t.chat.placeholder}
                className="h-8 text-xs"
                disabled={aiProcessing}
              />
              <Button
                size="sm"
                className="h-8 bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={handleAiSend}
                disabled={aiProcessing || !aiInput.trim()}
              >
                {aiProcessing ? (
                  <span className="flex items-center gap-1">
                    <Inbox className="size-3 animate-spin" />
                    {t.chat.thinking}
                  </span>
                ) : (
                  <Send className="size-3.5" />
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {/* Today's Schedule */}
        <motion.div
          custom={0}
          variants={cardVariants}
          initial="hidden"
          animate="visible"
          className="md:col-span-1"
        >
          <Card className="h-full">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">
                {t.dashboard.todaySchedule}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {todayEvents.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  {t.calendar.noEvents}
                </p>
              ) : (
                todayEvents.map((evt) => (
                  <div
                    key={evt.id}
                    className={cn(
                      'flex gap-3 rounded-md border-l-4 p-2 transition-opacity',
                      evt.status === 'completed' && 'opacity-50'
                    )}
                    style={{
                      borderLeftColor: evt.schedule
                        ? getColor(evt.schedule.category, isDark)
                        : undefined,
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          'text-sm font-medium',
                          evt.status === 'completed' && 'line-through'
                        )}
                      >
                        {evt.title}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {evt.schedule &&
                          `${formatTime(evt.schedule.startAt)} - ${formatTime(evt.schedule.endAt)}`}
                      </p>
                      {evt.schedule?.location && (
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                          <Pin className="size-2.5" />
                          {evt.schedule.location}
                        </p>
                      )}
                    </div>
                  </div>
                ))
              )}
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 w-full text-xs text-muted-foreground"
                onClick={() => setView('calendar')}
              >
                {t.calendar.viewInCalendar}
                <ArrowRight className="ml-1 size-3" />
              </Button>
            </CardContent>
          </Card>
        </motion.div>

        {/* Today's Todos */}
        <motion.div
          custom={1}
          variants={cardVariants}
          initial="hidden"
          animate="visible"
          className="md:col-span-1"
        >
          <Card className="h-full">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">
                {t.dashboard.todayTodos}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {todayTodos.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  {t.todo.noTodos}
                </p>
              ) : (
                todayTodos.map((todo) => (
                  <div
                    key={todo.id}
                    className="flex items-center gap-2.5 rounded-md p-2 transition-colors hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={todo.status === 'completed'}
                      onCheckedChange={() => toggleNodeStatus(todo.id)}
                    />
                    <span className="flex-1 text-sm">{todo.title}</span>
                    <span
                      className={cn(
                        'size-2 shrink-0 rounded-full',
                        todo.priority.urgency >= 4
                          ? 'bg-red-500'
                          : todo.priority.urgency >= 2
                            ? 'bg-amber-500'
                            : 'bg-gray-400'
                      )}
                    />
                  </div>
                ))
              )}
              <div className="flex gap-1.5 pt-1">
                <Input
                  placeholder={t.todo.placeholder}
                  value={quickTodo}
                  onChange={(e) => setQuickTodo(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleQuickAdd();
                  }}
                  className="h-8 text-xs"
                />
                <Button size="sm" className="h-8 px-2" onClick={handleQuickAdd}>
                  <Plus className="size-3.5" />
                </Button>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs text-muted-foreground"
                onClick={() => setView('todo')}
              >
                {t.calendar.viewInTodo}
                <ArrowRight className="ml-1 size-3" />
              </Button>
            </CardContent>
          </Card>
        </motion.div>

        {/* Project Progress */}
        <motion.div
          custom={2}
          variants={cardVariants}
          initial="hidden"
          animate="visible"
          className="md:col-span-2 xl:col-span-1"
        >
          <Card className="h-full">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">
                {t.dashboard.projectProgress}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {projects.map((proj) => (
                <button
                  key={proj.id}
                  onClick={() => {
                    setSelectedProject(proj.id);
                  }}
                  className="w-full rounded-md p-2 text-left transition-colors hover:bg-muted/50"
                >
                  <p className="text-sm font-medium">{proj.title}</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <Progress value={proj.progress} className="h-1.5 flex-1" />
                    <span className="text-xs text-muted-foreground">
                      {proj.progress}%
                    </span>
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>
        </motion.div>

        {/* Unsorted */}
        <motion.div
          custom={3}
          variants={cardVariants}
          initial="hidden"
          animate="visible"
          className="md:col-span-2 xl:col-span-3"
        >
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">
                  {t.dashboard.unsorted}
                </CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => toast.info(t.common.error)}
                >
                  {t.calendar.addToProject}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {unsortedNodes.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                  <Inbox className="size-5 opacity-40" />
                  <p className="text-xs">{t.common.noData}</p>
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {unsortedNodes.map((node) => (
                    <div
                      key={node.id}
                      className="flex items-center gap-2 rounded-md border p-2.5"
                    >
                      {node.schedule?.category && (
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{
                            backgroundColor: getColor(
                              node.schedule.category,
                              isDark
                            ),
                          }}
                        />
                      )}
                      <span className="truncate text-sm">{node.title}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}