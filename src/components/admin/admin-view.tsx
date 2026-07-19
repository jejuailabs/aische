'use client';

import { motion } from 'framer-motion';
import {
  Users,
  FolderOpen,
  Cpu,
  AlertTriangle,
  TrendingUp,
  Activity,
} from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { useLocale } from '@/hooks/use-locale';

// ─── Mock Data ────────────────────────────────────────────

const MOCK_ERRORS = [
  {
    id: '1',
    timestamp: '2025-01-15 14:32:07',
    level: 'error' as const,
    message: 'LLM API rate limit exceeded — retrying in 60s',
    source: 'ai-parser.ts',
  },
  {
    id: '2',
    timestamp: '2025-01-15 13:18:44',
    level: 'warning' as const,
    message: 'STT connection timeout after 30s, retrying...',
    source: 'voice-service.ts',
  },
  {
    id: '3',
    timestamp: '2025-01-15 09:05:21',
    level: 'error' as const,
    message: 'Database write conflict on node update (id: n_8f2a)',
    source: 'node-store.ts',
  },
];

const AI_COST_THIS_MONTH = 72;
const AI_COST_LAST_MONTH = 58;

// ─── Animation Variants ───────────────────────────────────

const cardVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.3, ease: 'easeOut' },
  }),
};

const sectionVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { delay: 0.45, duration: 0.35, ease: 'easeOut' },
  },
};

// ─── Component ────────────────────────────────────────────

export function AdminView() {
  const { t } = useLocale();

  return (
    <div className="flex flex-col gap-6">
      {/* ── Stats Grid ─────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* Total Users */}
        <motion.div custom={0} variants={cardVariants} initial="hidden" animate="visible">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t.admin.userCount}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <div className="flex items-end justify-between">
                <span className="text-2xl font-bold tracking-tight">
                  1,247
                </span>
                <Badge variant="default" className="bg-emerald-600 text-white text-[10px]">
                  <TrendingUp className="size-3" />
                  +12%
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                <Users className="mr-1 inline-block size-3 text-muted-foreground/70" />
                {t.admin.activeToday}: <span className="font-medium text-foreground">89</span>
              </p>
            </CardContent>
          </Card>
        </motion.div>

        {/* Total Workspaces */}
        <motion.div custom={1} variants={cardVariants} initial="hidden" animate="visible">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t.admin.workspaceCount}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <div className="flex items-end justify-between">
                <span className="text-2xl font-bold tracking-tight">
                  342
                </span>
                <div className="flex size-8 items-center justify-center rounded-lg bg-sky-100 text-sky-600 dark:bg-sky-950 dark:text-sky-400">
                  <FolderOpen className="size-4" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {t.admin.totalWorkspaces}
              </p>
            </CardContent>
          </Card>
        </motion.div>

        {/* AI Usage */}
        <motion.div custom={2} variants={cardVariants} initial="hidden" animate="visible">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t.admin.aiUsage}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-end justify-between">
                <div className="flex size-8 items-center justify-center rounded-lg bg-violet-100 text-violet-600 dark:bg-violet-950 dark:text-violet-400">
                  <Cpu className="size-4" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t.admin.llmCalls}</span>
                  <span className="font-medium">3,456</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t.admin.sttMinutes}</span>
                  <span className="font-medium">128 min</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t.admin.ttsMinutes}</span>
                  <span className="font-medium">45 min</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t.admin.imageGenerated}</span>
                  <span className="font-medium">23</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Recent Errors */}
        <motion.div custom={3} variants={cardVariants} initial="hidden" animate="visible">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t.admin.errorLogs}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <div className="flex items-end justify-between">
                <span className="text-2xl font-bold tracking-tight text-red-600 dark:text-red-400">
                  3
                </span>
                <div className="flex size-8 items-center justify-center rounded-lg bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400">
                  <AlertTriangle className="size-4" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                <Activity className="mr-1 inline-block size-3 text-muted-foreground/70" />
                last 24h
              </p>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* ── Error Logs Table ────────────────────────── */}
      <motion.div variants={sectionVariants} initial="hidden" animate="visible">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">
              {t.admin.recentErrors}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {MOCK_ERRORS.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {t.admin.noErrors}
              </p>
            ) : (
              <div className="max-h-64 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[160px] text-xs">Timestamp</TableHead>
                      <TableHead className="w-[80px] text-xs">Level</TableHead>
                      <TableHead className="text-xs">Message</TableHead>
                      <TableHead className="w-[140px] text-xs">Source</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {MOCK_ERRORS.map((err) => (
                      <TableRow key={err.id}>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {err.timestamp}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              err.level === 'error'
                                ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400'
                                : 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400'
                            }
                          >
                            {err.level === 'error' ? (
                              <AlertTriangle className="size-3" />
                            ) : (
                              <Activity className="size-3" />
                            )}
                            {err.level.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {err.message}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {err.source}
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

      {/* ── AI Cost Monitor ─────────────────────────── */}
      <motion.div
        variants={sectionVariants}
        initial="hidden"
        animate="visible"
        transition={{ delay: 0.6 }}
      >
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">
              {t.admin.aiUsage} — Cost Monitor
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* This month bar */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">이번 달</span>
                <span className="text-muted-foreground">{AI_COST_THIS_MONTH}%</span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-violet-500 to-purple-600"
                  initial={{ width: 0 }}
                  animate={{ width: `${AI_COST_THIS_MONTH}%` }}
                  transition={{ delay: 0.7, duration: 0.8, ease: 'easeOut' }}
                />
              </div>
            </div>
            <Separator />
            {/* Last month bar */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-muted-foreground">지난 달</span>
                <span className="text-muted-foreground">{AI_COST_LAST_MONTH}%</span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                <motion.div
                  className="h-full rounded-full bg-muted-foreground/30"
                  initial={{ width: 0 }}
                  animate={{ width: `${AI_COST_LAST_MONTH}%` }}
                  transition={{ delay: 0.85, duration: 0.8, ease: 'easeOut' }}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              <TrendingUp className="mr-1 inline-block size-3" />
              이번 달 AI 사용량이 지난 달 대비 +14%p 증가했습니다.
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}