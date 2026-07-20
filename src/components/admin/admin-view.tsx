'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import {
  Users,
  Building2,
  FolderOpen,
  Tags,
  Inbox,
  FileText,
  Layers,
  Database,
  Clock,
} from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import { useLocale } from '@/hooks/use-locale';
import {
  useNodeStore,
  useProjectStore,
  useCategoryStore,
  usePersonStore,
  useOrgStore,
  useCaptureStore,
  useLogStore,
  useNavStore,
} from '@/lib/store';
import { NODE_STATUS_LABELS } from '@/lib/types';
import type { LogAction, NodeStatus, NodeType } from '@/lib/types';

// ─── Animation Variants ───────────────────────────────────

const EASE = [0.16, 1, 0.3, 1] as const;

const cardVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.3, ease: EASE },
  }),
};

const sectionVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { delay: 0.35, duration: 0.35, ease: EASE },
  },
};

// ─── Helpers ──────────────────────────────────────────────

function actionLabel(action: LogAction, t: ReturnType<typeof useLocale>['t']) {
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

// ─── Component ────────────────────────────────────────────

export function AdminView() {
  const { t } = useLocale();

  const nodes = useNodeStore((s) => s.nodes);
  const projects = useProjectStore((s) => s.projects);
  const categories = useCategoryStore((s) => s.categories);
  const people = usePersonStore((s) => s.people);
  const orgs = useOrgStore((s) => s.orgs);
  const captures = useCaptureStore((s) => s.captures);
  const logs = useLogStore((s) => s.logs);
  const setView = useNavStore((s) => s.setView);

  const stats = useMemo(() => {
    const list = Object.values(nodes);
    const byType: Record<NodeType, number> = {
      goal: 0,
      task: 0,
      calendar_event: 0,
      todo: 0,
    };
    const byStatus = {} as Record<NodeStatus, number>;
    let drafts = 0;

    for (const n of list) {
      if (byType[n.type] !== undefined) byType[n.type] += 1;
      byStatus[n.status] = (byStatus[n.status] ?? 0) + 1;
      if (n.aiMeta?.status === 'draft') drafts += 1;
    }

    const completed = byStatus.completed ?? 0;
    return {
      total: list.length,
      byType,
      byStatus,
      drafts,
      completed,
      completedRatio: list.length
        ? Math.round((completed / list.length) * 100)
        : 0,
    };
  }, [nodes]);

  const recentLogs = useMemo(
    () =>
      Object.values(logs)
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        .slice(0, 12),
    [logs],
  );

  const typeCards: { key: NodeType; label: string }[] = [
    { key: 'goal', label: t.admin.typeGoal },
    { key: 'task', label: t.admin.typeTask },
    { key: 'calendar_event', label: t.admin.typeCalendarEvent },
    { key: 'todo', label: t.admin.typeTodo },
  ];

  const layerCards: { icon: typeof Users; label: string; value: number }[] = [
    { icon: FolderOpen, label: t.admin.projectCount, value: projects.length },
    {
      icon: Tags,
      label: t.admin.categoryCount,
      value: Object.keys(categories).length,
    },
    { icon: Users, label: t.admin.peopleCount, value: Object.keys(people).length },
    {
      icon: Building2,
      label: t.admin.orgCount,
      value: Object.keys(orgs).length,
    },
    {
      icon: Inbox,
      label: t.admin.captureCount,
      value: Object.keys(captures).length,
    },
    { icon: FileText, label: t.admin.draftPending, value: stats.drafts },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* ── Overview ───────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {/* Total nodes */}
        <motion.div custom={0} variants={cardVariants} initial="hidden" animate="visible">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t.admin.totalNodes}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-end justify-between">
                <span className="text-2xl font-bold tracking-tight">
                  {stats.total.toLocaleString()}
                </span>
                <div className="flex size-8 items-center justify-center rounded-lg bg-sky-100 text-sky-600 dark:bg-sky-950 dark:text-sky-400">
                  <Layers className="size-4" />
                </div>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{t.admin.completedRatio}</span>
                  <span>{stats.completedRatio}%</span>
                </div>
                <Progress value={stats.completedRatio} className="h-1.5" />
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* By type */}
        <motion.div custom={1} variants={cardVariants} initial="hidden" animate="visible">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t.admin.byType}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                {typeCards.map((c) => (
                  <div key={c.key} className="flex justify-between">
                    <span className="text-muted-foreground">{c.label}</span>
                    <span className="font-medium">{stats.byType[c.key]}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* By status */}
        <motion.div custom={2} variants={cardVariants} initial="hidden" animate="visible">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t.admin.byStatus}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {Object.keys(stats.byStatus).length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t.common.noData}
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {(
                    Object.entries(stats.byStatus) as [NodeStatus, number][]
                  ).map(([status, count]) => (
                    <Badge
                      key={status}
                      variant="outline"
                      className="gap-1 text-[11px]"
                    >
                      {t.status[status] ?? NODE_STATUS_LABELS[status]}
                      <span className="font-semibold">{count}</span>
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* ── Information layers ─────────────────────── */}
      <motion.div variants={sectionVariants} initial="hidden" animate="visible">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
            <CardTitle className="text-sm font-semibold">
              {t.admin.infoLayers}
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => setView('data')}
            >
              <Database className="size-3.5" />
              {t.admin.manageData}
            </Button>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
              {layerCards.map(({ icon: Icon, label, value }) => (
                <div
                  key={label}
                  className="flex flex-col gap-1 rounded-lg border p-3"
                >
                  <Icon className="size-4 text-muted-foreground" />
                  <span className="text-xl font-bold tracking-tight">
                    {value.toLocaleString()}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {label}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ── Recent activity ────────────────────────── */}
      <motion.div
        variants={sectionVariants}
        initial="hidden"
        animate="visible"
        transition={{ delay: 0.5, duration: 0.35, ease: EASE }}
      >
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">
              {t.admin.recentActivity}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {recentLogs.length === 0 ? (
              <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Clock className="size-4 opacity-40" />
                {t.admin.noActivity}
              </p>
            ) : (
              <div className="max-h-72 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[130px] text-xs">
                        {t.data.captureCreatedAt}
                      </TableHead>
                      <TableHead className="w-[110px] text-xs">
                        {t.log.title}
                      </TableHead>
                      <TableHead className="text-xs">
                        {t.data.projectTitle}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentLogs.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {format(entry.timestamp, 'MM/dd HH:mm')}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            {actionLabel(entry.action, t)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {nodes[entry.nodeId]?.title ??
                            entry.before?.title ??
                            entry.after?.title ??
                            entry.nodeId}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
