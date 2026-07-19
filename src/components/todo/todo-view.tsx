'use client';

import { useState, useMemo, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { useNodeStore, useCategoryStore, useProjectStore, useNavStore } from '@/lib/store';
import { useLocale } from '@/hooks/use-locale';
import { createNode, isSameDay } from '@/lib/services';
import { format, endOfDay, startOfDay, isAfter } from 'date-fns';
import { ko as koLocale } from 'date-fns/locale';
import {
  CheckCircle2,
  Plus,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { motion } from 'framer-motion';
import type { Node } from '@/lib/types';

export function TodoView() {
  const { t } = useLocale();
  const [tab, setTab] = useState('today');
  const [quickInput, setQuickInput] = useState('');

  const allNodes = useNodeStore((s) => s.nodes);
  const addNode = useNodeStore((s) => s.addNode);
  const toggleNodeStatus = useNodeStore((s) => s.toggleNodeStatus);
  const getColor = useCategoryStore((s) => s.getColor);
  const projects = useProjectStore((s) => s.projects);
  const setView = useNavStore((s) => s.setView);

  const today = new Date();
  const todayStart = startOfDay(today);
  const todayEnd = endOfDay(today);

  // Categorize todos
  const todos = useMemo(() => {
    return Object.values(allNodes).filter(
      (n) => n.type === 'todo' || (n.type === 'calendar_event' && n.schedule?.dueAt)
    );
  }, [allNodes]);

  const todayTodos = useMemo(() => {
    return todos.filter((n) => {
      if (n.status === 'completed') return false;
      // Todo due today
      if (n.schedule?.dueAt && isSameDay(n.schedule.dueAt, today)) return true;
      // Calendar event scheduled today
      if (n.type === 'calendar_event' && n.schedule?.startAt && isSameDay(n.schedule.startAt, today)) return true;
      return false;
    });
  }, [todos, today]);

  const upcomingTodos = useMemo(() => {
    return todos.filter((n) => {
      if (n.status === 'completed') return false;
      if (n.schedule?.dueAt) {
        return isAfter(n.schedule.dueAt, todayEnd);
      }
      return false;
    });
  }, [todos, todayEnd]);

  const completedTodos = useMemo(() => {
    return todos.filter((n) => n.status === 'completed');
  }, [todos]);

  // Group completed by completion date
  const completedGrouped = useMemo(() => {
    const groups: Record<string, Node[]> = {};
    completedTodos.forEach((n) => {
      if (!n.completedAt) return;
      const key = format(n.completedAt, 'yyyy-MM-dd');
      if (!groups[key]) groups[key] = [];
      groups[key].push(n);
    });
    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
  }, [completedTodos]);

  const handleQuickAdd = useCallback(() => {
    const title = quickInput.trim();
    if (!title) return;
    const node = createNode({
      title,
      workspaceId: 'demo-workspace',
      type: 'todo',
      status: 'scheduled',
      schedule: {
        startAt: todayStart,
        endAt: todayEnd,
        dueAt: todayEnd,
        allDay: true,
        category: '',
        location: null,
        attendees: [],
        reminders: [],
      },
    });
    addNode(node);
    setQuickInput('');
  }, [quickInput, addNode, todayStart, todayEnd]);

  const priorityDotColor = (urgency: number) => {
    if (urgency >= 4) return 'bg-red-500';
    if (urgency >= 2) return 'bg-amber-500';
    return 'bg-gray-400';
  };

  const projectName = (projectId: string) => {
    if (projectId === 'unsorted') return '';
    const p = projects.find((proj) => proj.id === projectId);
    return p?.title ?? '';
  };

  const renderTodoItem = (node: Node, index: number) => {
    const isCompleted = node.status === 'completed';
    const dueStr = node.schedule?.dueAt
      ? format(node.schedule.dueAt, 'M/d', { locale: koLocale })
      : null;
    const catColor = node.schedule?.category
      ? getColor(node.schedule.category, false)
      : null;
    const projName = projectName(node.projectId);

    return (
      <motion.div
        key={node.id}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, delay: index * 0.03 }}
        className={cn(
          'flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50',
          isCompleted && 'opacity-60'
        )}
      >
        <Checkbox
          checked={isCompleted}
          onCheckedChange={() => toggleNodeStatus(node.id)}
          className="mt-0.5"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'text-sm',
                isCompleted && 'line-through text-muted-foreground'
              )}
            >
              {node.title}
            </span>
            <span
              className={cn(
                'size-2 shrink-0 rounded-full',
                priorityDotColor(node.priority.urgency)
              )}
            />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {dueStr && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5">
                {dueStr}
              </Badge>
            )}
            {catColor && (
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: catColor }}
              />
            )}
            {projName && (
              <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">
                {projName}
              </span>
            )}
          </div>
        </div>
      </motion.div>
    );
  };

  const renderEmpty = () => (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
      <CheckCircle2 className="size-10 opacity-30" />
      <p className="text-sm">{t.todo.noTodos}</p>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Quick Add */}
      <div className="flex gap-2">
        <Input
          placeholder={t.todo.placeholder}
          value={quickInput}
          onChange={(e) => setQuickInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleQuickAdd();
          }}
          className="h-9"
        />
        <Button size="sm" onClick={handleQuickAdd} className="h-9 gap-1.5">
          <Plus className="size-4" />
          {t.todo.quickAdd}
        </Button>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="today">{t.todo.today}</TabsTrigger>
          <TabsTrigger value="upcoming">{t.todo.upcoming}</TabsTrigger>
          <TabsTrigger value="completed">{t.todo.completed}</TabsTrigger>
        </TabsList>

        <TabsContent value="today" className="mt-3">
          <div className="space-y-2 max-h-[calc(100dvh-280px)] overflow-y-auto custom-scrollbar">
            {todayTodos.length === 0
              ? renderEmpty()
              : todayTodos.map((n, i) => renderTodoItem(n, i))}
          </div>
        </TabsContent>

        <TabsContent value="upcoming" className="mt-3">
          <div className="space-y-2 max-h-[calc(100dvh-280px)] overflow-y-auto custom-scrollbar">
            {upcomingTodos.length === 0
              ? renderEmpty()
              : upcomingTodos.map((n, i) => renderTodoItem(n, i))}
          </div>
        </TabsContent>

        <TabsContent value="completed" className="mt-3">
          <div className="space-y-4 max-h-[calc(100dvh-280px)] overflow-y-auto custom-scrollbar">
            {completedGrouped.length === 0
              ? renderEmpty()
              : completedGrouped.map(([dateKey, items]) => (
                  <div key={dateKey}>
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      {format(new Date(dateKey), 'M월 d일 EEEE', { locale: koLocale })}
                    </p>
                    <div className="space-y-2">
                      {items.map((n, i) => renderTodoItem(n, i))}
                    </div>
                  </div>
                ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}