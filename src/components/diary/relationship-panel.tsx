'use client';

// ==========================================
// 관계 로그 패널
// ==========================================
//
// 설계 원칙: **사람을 단일 점수로 규정하지 않는다.**
// 기록이 적을 때는 평균을 결론처럼 보여주지 않고,
// "판단하기 이르다"고 말한다. 그리고 모든 판정 옆에는
// 근거가 된 원문 인용을 함께 둔다.

import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import {
  Plus,
  Trash2,
  Pencil,
  MessageSquareQuote,
  TrendingUp,
  TrendingDown,
  Minus,
  BookOpen,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useLocale } from '@/hooks/use-locale';
import { useRelationshipStore } from '@/lib/store';
import { createRelationshipLog } from '@/lib/services';
import {
  summarizeRelationship,
  logsForPerson,
  sentimentLabel,
  isSummaryReliable,
} from '@/lib/diary';
import type { RelationshipLog } from '@/lib/types';

const WS = 'demo-workspace';

const SENTIMENTS = [-2, -1, 0, 1, 2] as const;

/** 감정 점수 → 배지 색 */
function sentimentTone(v: number): string {
  if (v >= 1) return 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400';
  if (v <= -1) return 'border-rose-500/40 text-rose-600 dark:text-rose-400';
  return 'border-muted-foreground/30 text-muted-foreground';
}

interface LogDraft {
  event: string;
  feeling: string;
  sentiment: string;
  occurredAt: string;
}

const emptyDraft = (): LogDraft => ({
  event: '',
  feeling: '',
  sentiment: '0',
  occurredAt: format(new Date(), 'yyyy-MM-dd'),
});

const toDraft = (l: RelationshipLog): LogDraft => ({
  event: l.event,
  feeling: l.feeling ?? '',
  sentiment: String(l.sentiment),
  occurredAt: format(l.occurredAt, 'yyyy-MM-dd'),
});

export function RelationshipPanel({ personId }: { personId: string }) {
  const { t } = useLocale();

  const logMap = useRelationshipStore((s) => s.logs);
  const addLog = useRelationshipStore((s) => s.addLog);
  const updateLog = useRelationshipStore((s) => s.updateLog);
  const removeLog = useRelationshipStore((s) => s.removeLog);

  const allLogs = useMemo(() => Object.values(logMap), [logMap]);

  const summary = useMemo(
    () => summarizeRelationship(allLogs, personId),
    [allLogs, personId],
  );
  const logs = useMemo(
    () => logsForPerson(allLogs, personId),
    [allLogs, personId],
  );

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<LogDraft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<RelationshipLog | null>(null);

  const reliable = isSummaryReliable(summary);

  const openNew = () => {
    setEditingId(null);
    setDraft(emptyDraft());
    setError(null);
    setFormOpen(true);
  };

  const openEdit = (l: RelationshipLog) => {
    setEditingId(l.id);
    setDraft(toDraft(l));
    setError(null);
    setFormOpen(true);
  };

  const save = () => {
    if (!draft.event.trim()) {
      setError(t.relationship.eventRequired);
      return;
    }
    const fields = {
      event: draft.event.trim(),
      feeling: draft.feeling.trim() || null,
      sentiment: Number(draft.sentiment) || 0,
      occurredAt: new Date(`${draft.occurredAt}T00:00:00`),
    };

    if (editingId) {
      updateLog(editingId, fields);
    } else {
      // 직접 추가한 기록은 일기 출처가 없다 (diaryEntryId = null).
      // 근거 인용도 없다 — 사용자가 직접 쓴 것 자체가 근거다.
      addLog(
        createRelationshipLog({
          workspaceId: WS,
          personId,
          diaryEntryId: null,
          quote: null,
          ...fields,
        }),
      );
    }
    setFormOpen(false);
    setEditingId(null);
    toast.success(t.relationship.logSaved);
  };

  // ── 추이 화살표 ──
  const trendIcon =
    summary.trend > 0.3 ? (
      <TrendingUp className="size-3.5 text-emerald-600 dark:text-emerald-400" />
    ) : summary.trend < -0.3 ? (
      <TrendingDown className="size-3.5 text-rose-600 dark:text-rose-400" />
    ) : (
      <Minus className="size-3.5 text-muted-foreground" />
    );

  const trendLabel =
    summary.trend > 0.3
      ? t.relationship.trendUp
      : summary.trend < -0.3
        ? t.relationship.trendDown
        : t.relationship.trendFlat;

  return (
    <div className="flex flex-col gap-3">
      {/* ── 요약 헤더 ─────────────────────────────── */}
      <div className="rounded-lg border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t.relationship.title}</h3>
          <span className="text-xs text-muted-foreground">
            {t.relationship.logCount.replace('{count}', String(summary.logCount))}
          </span>
        </div>

        {summary.logCount === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {t.relationship.noLogs}
          </p>
        ) : !reliable ? (
          // ⚠️ 기록이 적을 때는 평균을 결론으로 내놓지 않는다.
          // 하루의 나쁜 기분이 실존 인물의 낙인이 되면 안 된다.
          <div className="mt-2">
            <p className="text-xs font-medium">
              {t.relationship.unreliable.replace(
                '{count}',
                String(summary.logCount),
              )}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {t.relationship.unreliableHint}
            </p>
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
            <span className="flex items-center gap-1.5">
              <span className="text-muted-foreground">
                {t.relationship.recentSentiment}
              </span>
              <Badge
                variant="outline"
                className={`text-[10px] ${sentimentTone(summary.recentSentiment)}`}
              >
                {sentimentLabel(summary.recentSentiment)}
              </Badge>
            </span>
            <span className="flex items-center gap-1">
              {trendIcon}
              <span className="text-muted-foreground">{trendLabel}</span>
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="text-emerald-600 dark:text-emerald-400">
                +{summary.positive}
              </span>
              <span>/</span>
              <span>{summary.neutral}</span>
              <span>/</span>
              <span className="text-rose-600 dark:text-rose-400">
                -{summary.negative}
              </span>
            </span>
          </div>
        )}

        {summary.daysSinceLast != null && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            {summary.daysSinceLast === 0
              ? t.relationship.lastSeenToday
              : t.relationship.lastSeen.replace(
                  '{days}',
                  String(summary.daysSinceLast),
                )}
          </p>
        )}
      </div>

      {/* ── 직접 추가 / 수정 폼 ───────────────────── */}
      {formOpen ? (
        <div className="flex flex-col gap-2.5 rounded-lg border border-dashed p-3">
          <div className="space-y-1.5">
            <Label htmlFor="rl-event" className="text-xs">
              {t.relationship.event}
            </Label>
            <Textarea
              id="rl-event"
              rows={2}
              value={draft.event}
              placeholder={t.relationship.eventPlaceholder}
              onChange={(e) =>
                setDraft((d) => ({ ...d, event: e.target.value }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rl-feeling" className="text-xs">
              {t.relationship.feeling}
            </Label>
            <Textarea
              id="rl-feeling"
              rows={2}
              value={draft.feeling}
              placeholder={t.relationship.feelingPlaceholder}
              onChange={(e) =>
                setDraft((d) => ({ ...d, feeling: e.target.value }))
              }
            />
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="space-y-1.5">
              <Label className="text-xs">{t.relationship.sentiment}</Label>
              <Select
                value={draft.sentiment}
                onValueChange={(v) => setDraft((d) => ({ ...d, sentiment: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SENTIMENTS.map((s) => (
                    <SelectItem key={s} value={String(s)}>
                      {sentimentLabel(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rl-date" className="text-xs">
                {t.relationship.occurredAt}
              </Label>
              <Input
                id="rl-date"
                type="date"
                value={draft.occurredAt}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, occurredAt: e.target.value }))
                }
              />
            </div>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setFormOpen(false);
                setEditingId(null);
              }}
            >
              {t.common.cancel}
            </Button>
            <Button size="sm" onClick={save}>
              {t.common.save}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 self-start"
          onClick={openNew}
        >
          <Plus className="size-3.5" />
          {t.relationship.addManual}
        </Button>
      )}

      {/* ── 타임라인 ──────────────────────────────── */}
      {logs.length > 0 && (
        <ul className="flex flex-col gap-2">
          {logs.map((l) => (
            <li key={l.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium tabular-nums">
                    {format(l.occurredAt, 'yyyy.MM.dd')}
                  </span>
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${sentimentTone(l.sentiment)}`}
                  >
                    {sentimentLabel(l.sentiment)}
                  </Badge>
                  <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                    {l.diaryEntryId ? (
                      <>
                        <BookOpen className="size-3" />
                        {t.relationship.fromDiary}
                      </>
                    ) : (
                      <>
                        <Pencil className="size-3" />
                        {t.relationship.manualSource}
                      </>
                    )}
                  </span>
                </span>
                <span className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => openEdit(l)}
                    aria-label={t.common.edit}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-destructive hover:text-destructive"
                    onClick={() => setToDelete(l)}
                    aria-label={t.common.delete}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </span>
              </div>

              <p className="mt-1.5 text-sm">{l.event}</p>
              {l.feeling && (
                <p className="mt-1 text-xs text-muted-foreground">{l.feeling}</p>
              )}

              {/* 판정의 근거 — 원문 인용은 인용문 스타일로 분리해서 보여준다 */}
              {l.quote && (
                <blockquote className="mt-2 flex gap-1.5 border-l-2 border-muted-foreground/30 pl-2.5 text-xs italic text-muted-foreground">
                  <MessageSquareQuote className="mt-0.5 size-3 shrink-0" />
                  <span className="whitespace-pre-wrap">{l.quote}</span>
                </blockquote>
              )}
            </li>
          ))}
        </ul>
      )}

      <AlertDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t.relationship.deleteLogTitle}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t.relationship.deleteLogConfirm}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (toDelete) {
                  removeLog(toDelete.id);
                  toast.success(t.relationship.logDeleted);
                }
                setToDelete(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t.common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
