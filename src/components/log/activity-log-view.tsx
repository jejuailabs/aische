'use client';

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import {
  Clock,
  Plus,
  Pencil,
  Trash2,
  ArrowRight,
  CheckCircle2,
  CalendarDays,
  User,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useLocale } from '@/hooks/use-locale';
import { useLogStore, useNodeStore } from '@/lib/store';
import type { LogAction } from '@/lib/types';

// ─── Filter Tab Definition ────────────────────────────────

type FilterTab = 'all' | 'create' | 'update' | 'delete' | 'complete';

const FILTER_TABS: { key: FilterTab; labelKey: keyof typeof import('@/lib/i18n').default.ko.log }[] = [
  { key: 'all', labelKey: 'filterAll' },
  { key: 'create', labelKey: 'created' },
  { key: 'update', labelKey: 'updated' },
  { key: 'delete', labelKey: 'deleted' },
  { key: 'complete', labelKey: 'completed' },
];

// ─── Helpers ──────────────────────────────────────────────

function getActionLabel(action: LogAction, t: ReturnType<typeof useLocale>['t']): string {
  switch (action) {
    case 'create':
      return t.log.created;
    case 'update':
      return t.log.updated;
    case 'delete':
      return t.log.deleted;
    case 'move':
      return t.log.moved;
    case 'complete':
      return t.log.completed;
    case 'schedule_change':
      return t.log.scheduleChanged;
    case 'assignee_change':
      return t.log.assigneeChanged;
    default:
      return action;
  }
}

function getActionBadgeStyle(action: LogAction): string {
  switch (action) {
    case 'create':
      return 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-400';
    case 'update':
      return 'border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-400';
    case 'delete':
      return 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400';
    case 'move':
      return 'border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-400';
    case 'complete':
      return 'border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-400';
    case 'schedule_change':
      return 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400';
    case 'assignee_change':
      return 'border-pink-300 bg-pink-50 text-pink-700 dark:border-pink-800 dark:bg-pink-950 dark:text-pink-400';
    default:
      return '';
  }
}

function getActionIcon(action: LogAction) {
  switch (action) {
    case 'create':
      return <Plus className="size-3" />;
    case 'update':
      return <Pencil className="size-3" />;
    case 'delete':
      return <Trash2 className="size-3" />;
    case 'move':
      return <ArrowRight className="size-3" />;
    case 'complete':
      return <CheckCircle2 className="size-3" />;
    case 'schedule_change':
      return <CalendarDays className="size-3" />;
    case 'assignee_change':
      return <User className="size-3" />;
    default:
      return <Clock className="size-3" />;
  }
}

// ─── Animation Variants ───────────────────────────────────

const listItemVariants = {
  hidden: { opacity: 0, x: -8 },
  visible: (i: number) => ({
    opacity: 1,
    x: 0,
    transition: { delay: i * 0.04, duration: 0.2, ease: 'easeOut' },
  }),
  exit: { opacity: 0, x: 8, transition: { duration: 0.15 } },
};

// ─── Component ────────────────────────────────────────────

export function ActivityLogView() {
  const { t } = useLocale();
  const logs = useLogStore((s) => s.logs);
  const nodes = useNodeStore((s) => s.nodes);
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');

  const sortedLogs = useMemo(() => {
    const allLogs = Object.values(logs);
    const filtered =
      activeFilter === 'all'
        ? allLogs
        : allLogs.filter((l) => l.action === activeFilter);

    return filtered.sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
    );
  }, [logs, activeFilter]);

  const getNodeTitle = (nodeId: string): string => {
    const node = nodes[nodeId];
    return node?.title ?? nodeId;
  };

  return (
    <div className="flex flex-col gap-4">
      {/* ── Filter Tabs ────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {FILTER_TABS.map((tab) => (
          <Button
            key={tab.key}
            size="sm"
            variant={activeFilter === tab.key ? 'default' : 'outline'}
            className="h-8 text-xs"
            onClick={() => setActiveFilter(tab.key)}
          >
            {t.log[tab.labelKey as keyof typeof t.log]}
          </Button>
        ))}
      </div>

      {/* ── Log List ───────────────────────────────── */}
      {sortedLogs.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
          <Clock className="size-8 opacity-30" />
          <p className="text-sm">{t.log.noLogs}</p>
        </div>
      ) : (
        <ScrollArea className="h-[calc(100vh-220px)] max-h-[600px]">
          <AnimatePresence mode="popLayout">
            <div className="flex flex-col gap-2 pr-4">
              {sortedLogs.map((entry, idx) => (
                <motion.div
                  key={entry.id}
                  custom={idx}
                  variants={listItemVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  layout
                  className="flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors hover:bg-muted/50"
                >
                  {/* Timestamp */}
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {format(entry.timestamp, 'MM/dd HH:mm')}
                  </span>

                  {/* Action Badge */}
                  <Badge
                    variant="outline"
                    className={`shrink-0 gap-1 ${getActionBadgeStyle(entry.action)}`}
                  >
                    {getActionIcon(entry.action)}
                    {getActionLabel(entry.action, t)}
                  </Badge>

                  {/* Node Title */}
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    &ldquo;{getNodeTitle(entry.nodeId)}&rdquo;
                  </span>

                  {/* Actor */}
                  <span className="shrink-0 text-xs text-muted-foreground">
                    — {entry.actor}
                  </span>
                </motion.div>
              ))}
            </div>
          </AnimatePresence>
        </ScrollArea>
      )}
    </div>
  );
}