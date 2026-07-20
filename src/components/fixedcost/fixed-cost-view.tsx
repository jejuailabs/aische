'use client';

import { useMemo, useState } from 'react';
import { addMonths, format } from 'date-fns';
import { ko as koLocale } from 'date-fns/locale';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Wallet,
  Trash2,
  CircleSlash,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import {
  useFixedCostStore,
  usePaymentMethodStore,
  useCategoryStore,
} from '@/lib/store';
import { createFixedCost } from '@/lib/services';
import {
  costsInMonth,
  monthlyTotal,
  normalizedMonthlyTotal,
  totalsByMethod,
  totalsByCategory,
  nextPaymentDate,
  daysUntilNextPayment,
  formatAmount,
  describeMethod,
  describeCycle,
} from '@/lib/fixed-cost';
import type { FixedCost } from '@/lib/types';

const WS = 'demo-workspace';
const NONE = 'none';

interface Draft {
  title: string;
  amount: string;
  cycle: FixedCost['cycle'];
  paymentMonth: string;
  paymentDay: string;
  paymentMethodId: string;
  categoryId: string;
  memo: string;
  startedAt: string;
}

const toDateInput = (d: Date) => format(d, 'yyyy-MM-dd');

const emptyDraft = (): Draft => ({
  title: '',
  amount: '',
  cycle: 'monthly',
  paymentMonth: String(new Date().getMonth() + 1),
  paymentDay: String(new Date().getDate()),
  paymentMethodId: NONE,
  categoryId: NONE,
  memo: '',
  startedAt: toDateInput(new Date()),
});

/** 합계 막대 한 줄 */
function BarRow({
  label,
  amount,
  total,
  color,
}: {
  label: string;
  amount: number;
  total: number;
  color?: string;
}) {
  const pct = total > 0 ? Math.round((amount / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className="size-2.5 shrink-0 rounded-full border"
            style={{ backgroundColor: color ?? 'var(--muted-foreground)' }}
            aria-hidden
          />
          <span className="truncate">{label}</span>
        </span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {formatAmount(amount)} · {pct}%
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full"
          style={{
            width: `${pct}%`,
            backgroundColor: color ?? 'hsl(var(--primary))',
          }}
        />
      </div>
    </div>
  );
}

export function FixedCostView() {
  const { t, locale } = useLocale();
  const dateLocale = locale === 'ko' ? koLocale : undefined;

  const costs = useFixedCostStore((s) => s.costs);
  const addCost = useFixedCostStore((s) => s.addCost);
  const updateCost = useFixedCostStore((s) => s.updateCost);
  const removeCost = useFixedCostStore((s) => s.removeCost);
  const endCost = useFixedCostStore((s) => s.endCost);

  const methods = usePaymentMethodStore((s) => s.methods);
  const categories = useCategoryStore((s) => s.categories);

  const [monthOffset, setMonthOffset] = useState(0);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FixedCost | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<FixedCost | null>(null);
  const [toEnd, setToEnd] = useState<FixedCost | null>(null);

  const costList = useMemo(() => Object.values(costs), [costs]);

  const currentMonth = useMemo(
    () => addMonths(new Date(), monthOffset),
    [monthOffset],
  );
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  const monthly = useMemo(
    () => costsInMonth(costList, year, month),
    [costList, year, month],
  );
  const total = useMemo(
    () => monthlyTotal(costList, year, month),
    [costList, year, month],
  );
  const normalized = useMemo(
    () => normalizedMonthlyTotal(costList),
    [costList],
  );

  // 다가오는 결제 3건 — 오늘 기준으로 가장 가까운 순
  const upcoming = useMemo(() => {
    return costList
      .map((c) => ({ cost: c, next: nextPaymentDate(c) }))
      .filter((x): x is { cost: FixedCost; next: Date } => x.next !== null)
      .sort((a, b) => a.next.getTime() - b.next.getTime())
      .slice(0, 3);
  }, [costList]);

  const methodTotals = useMemo(
    () => Array.from(totalsByMethod(costList, year, month).entries()),
    [costList, year, month],
  );
  const categoryTotals = useMemo(
    () => Array.from(totalsByCategory(costList, year, month).entries()),
    [costList, year, month],
  );

  const activeMethods = useMemo(
    () => Object.values(methods).filter((m) => m.active),
    [methods],
  );
  const categoryList = useMemo(
    () => Object.values(categories).sort((a, b) => a.order - b.order),
    [categories],
  );

  const dueLabel = (cost: FixedCost) => {
    const days = daysUntilNextPayment(cost);
    if (days === null) return '';
    if (days === 0) return t.fixedCost.dueToday;
    if (days === 1) return t.fixedCost.dueTomorrow;
    return t.fixedCost.dueInDays.replace('{days}', String(days));
  };

  // ── 다이얼로그 ──
  const openNew = () => {
    setEditing(null);
    setDraft(emptyDraft());
    setError(null);
    setOpen(true);
  };

  const openEdit = (c: FixedCost) => {
    setEditing(c);
    setDraft({
      title: c.title,
      amount: String(c.amount),
      cycle: c.cycle,
      paymentMonth: String(c.paymentMonth ?? 1),
      paymentDay: String(c.paymentDay),
      paymentMethodId: c.paymentMethodId ?? NONE,
      categoryId: c.categoryId ?? NONE,
      memo: c.memo,
      startedAt: toDateInput(c.startedAt),
    });
    setError(null);
    setOpen(true);
  };

  const save = () => {
    if (!draft.title.trim()) {
      setError(t.fixedCost.nameRequired);
      return;
    }
    const amount = Number(draft.amount.replace(/[^\d]/g, ''));
    if (!amount || amount <= 0) {
      setError(t.fixedCost.amountRequired);
      return;
    }

    const shared = {
      title: draft.title.trim(),
      amount,
      cycle: draft.cycle,
      paymentDay: Math.min(31, Math.max(1, Number(draft.paymentDay) || 1)),
      // 연 결제일 때만 결제월이 의미가 있다
      paymentMonth:
        draft.cycle === 'yearly' ? Number(draft.paymentMonth) || 1 : null,
      paymentMethodId:
        draft.paymentMethodId === NONE ? null : draft.paymentMethodId,
      categoryId: draft.categoryId === NONE ? null : draft.categoryId,
      memo: draft.memo,
      startedAt: new Date(`${draft.startedAt}T00:00:00`),
    };

    if (editing) {
      updateCost(editing.id, shared);
    } else {
      addCost(createFixedCost({ workspaceId: WS, ...shared }));
    }
    setOpen(false);
    toast.success(t.fixedCost.saved);
  };

  const monthLabel =
    locale === 'ko'
      ? format(currentMonth, 'yyyy년 M월', { locale: dateLocale })
      : format(currentMonth, 'MMMM yyyy');

  const isEmpty = costList.length === 0;

  // 렌더 중에 컴포넌트를 새로 정의하면 매 렌더마다 리마운트되어 입력 포커스가 날아간다.
  // 그래서 다이얼로그는 컴포넌트가 아니라 엘리먼트로 한 번만 만들어 붙인다.
  const costDialog = (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing ? t.fixedCost.editCost : t.fixedCost.newCost}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t.fixedCost.editCost}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="fc-title">{t.fixedCost.name}</Label>
              <Input
                id="fc-title"
                value={draft.title}
                placeholder={t.fixedCost.namePlaceholder}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, title: e.target.value }))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="fc-amount">{t.fixedCost.amount}</Label>
              <Input
                id="fc-amount"
                value={draft.amount}
                inputMode="numeric"
                placeholder={t.fixedCost.amountPlaceholder}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    amount: e.target.value.replace(/[^\d]/g, ''),
                  }))
                }
              />
            </div>

            {/* 주기 — 월/연 토글 */}
            <div className="space-y-1.5">
              <Label>{t.fixedCost.cycle}</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={draft.cycle === 'monthly' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setDraft((d) => ({ ...d, cycle: 'monthly' }))}
                >
                  {t.fixedCost.cycleMonthly}
                </Button>
                <Button
                  type="button"
                  variant={draft.cycle === 'yearly' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setDraft((d) => ({ ...d, cycle: 'yearly' }))}
                >
                  {t.fixedCost.cycleYearly}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* 결제월은 연 결제일 때만 의미가 있다 */}
              {draft.cycle === 'yearly' && (
                <div className="space-y-1.5">
                  <Label>{t.fixedCost.paymentMonth}</Label>
                  <Select
                    value={draft.paymentMonth}
                    onValueChange={(v) =>
                      setDraft((d) => ({ ...d, paymentMonth: v }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-64">
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                        <SelectItem key={m} value={String(m)}>
                          {m}
                          {t.fixedCost.monthUnit}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>{t.fixedCost.paymentDay}</Label>
                <Select
                  value={draft.paymentDay}
                  onValueChange={(v) =>
                    setDraft((d) => ({ ...d, paymentDay: v }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {d}
                        {t.fixedCost.dayUnit}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>{t.fixedCost.method}</Label>
              <Select
                value={draft.paymentMethodId}
                onValueChange={(v) =>
                  setDraft((d) => ({ ...d, paymentMethodId: v }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t.payment.unassigned}</SelectItem>
                  {activeMethods.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {describeMethod(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>{t.fixedCost.category}</Label>
              <Select
                value={draft.categoryId}
                onValueChange={(v) => setDraft((d) => ({ ...d, categoryId: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t.fixedCost.noCategory}</SelectItem>
                  {categoryList.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="fc-started">{t.fixedCost.startedAt}</Label>
              <Input
                id="fc-started"
                type="date"
                value={draft.startedAt}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, startedAt: e.target.value }))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="fc-memo">{t.fixedCost.memo}</Label>
              <Textarea
                id="fc-memo"
                rows={2}
                value={draft.memo}
                placeholder={t.fixedCost.memoPlaceholder}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, memo: e.target.value }))
                }
              />
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}

            {/* 해지 / 삭제는 수정 중일 때만 */}
            {editing && (
              <div className="flex flex-wrap gap-2 border-t pt-3">
                {editing.active && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => {
                      setToEnd(editing);
                      setOpen(false);
                    }}
                  >
                    <CircleSlash className="size-3.5" />
                    {t.fixedCost.endCost}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-destructive hover:text-destructive"
                  onClick={() => {
                    setToDelete(editing);
                    setOpen(false);
                  }}
                >
                  <Trash2 className="size-3.5" />
                  {t.common.delete}
                </Button>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button size="sm" onClick={save}>
              {t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  );

  // ── 완전히 비어 있을 때: 고정비가 뭔지부터 설명한다 ──
  const emptyState = (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
      <Wallet className="size-10 text-muted-foreground opacity-30" />
      <h2 className="text-base font-semibold">{t.fixedCost.emptyTitle}</h2>
      <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
        {t.fixedCost.emptyHint}
      </p>
      <Button className="mt-2 gap-1.5" onClick={openNew}>
        <Plus className="size-4" />
        {t.fixedCost.addCost}
      </Button>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {isEmpty ? emptyState : (
        <>
      {/* ── 헤더: 월 이동 + 추가 ─────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => setMonthOffset((p) => p - 1)}
            aria-label={t.calendar.prevMonth}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <h2 className="min-w-[120px] text-center text-sm font-semibold">
            {monthLabel}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => setMonthOffset((p) => p + 1)}
            aria-label={t.calendar.nextMonth}
          >
            <ChevronRight className="size-4" />
          </Button>
          {monthOffset !== 0 && (
            <Button
              variant="outline"
              size="sm"
              className="ml-1 h-8"
              onClick={() => setMonthOffset(0)}
            >
              {t.calendar.today}
            </Button>
          )}
        </div>
        <Button size="sm" className="h-9 gap-1.5" onClick={openNew}>
          <Plus className="size-4" />
          {t.fixedCost.addCost}
        </Button>
      </div>

      {/* ── 요약 ─────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">
            {t.fixedCost.monthTotal}
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums">
            {formatAmount(total)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t.fixedCost.monthTotalHint}
          </p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">
            {t.fixedCost.normalizedTotal}
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums">
            {formatAmount(normalized)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t.fixedCost.normalizedTotalHint}
          </p>
        </div>
      </div>

      {/* ── 다가오는 결제 ────────────────────────────── */}
      <div className="rounded-lg border p-4">
        <h3 className="text-sm font-semibold">{t.fixedCost.upcoming}</h3>
        {upcoming.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {t.fixedCost.noUpcoming}
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {upcoming.map(({ cost, next }) => (
              <li
                key={cost.id}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium">{cost.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {format(next, 'M/d')}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Badge variant="secondary" className="text-[10px]">
                    {dueLabel(cost)}
                  </Badge>
                  <span className="tabular-nums">
                    {formatAmount(cost.amount, cost.currency)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── 이 달의 고정비 목록 ──────────────────────── */}
      <div className="flex flex-col gap-2">
        {monthly.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
            <Wallet className="size-8 opacity-30" />
            <p className="text-sm">{t.fixedCost.noCostsThisMonth}</p>
          </div>
        ) : (
          monthly.map(({ cost, date }) => {
            const method = cost.paymentMethodId
              ? methods[cost.paymentMethodId]
              : undefined;
            const category = cost.categoryId
              ? categories[cost.categoryId]
              : undefined;
            return (
              <button
                key={cost.id}
                type="button"
                onClick={() => openEdit(cost)}
                className="flex w-full flex-wrap items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50"
              >
                <span className="flex size-9 shrink-0 flex-col items-center justify-center rounded-md bg-muted text-xs font-semibold tabular-nums">
                  {date.getDate()}
                </span>
                <span className="min-w-[140px] flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {cost.title}
                    </span>
                    {category && (
                      <Badge
                        variant="outline"
                        className="text-[10px]"
                        style={{
                          borderColor: category.color,
                          color: category.color,
                        }}
                      >
                        {category.label}
                      </Badge>
                    )}
                    {!cost.active && (
                      <Badge variant="secondary" className="text-[10px]">
                        {t.fixedCost.ended}
                      </Badge>
                    )}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      {method && (
                        <span
                          className="size-2 rounded-full border"
                          style={{ backgroundColor: method.color }}
                          aria-hidden
                        />
                      )}
                      {describeMethod(method)}
                    </span>
                    <span>{describeCycle(cost)}</span>
                  </span>
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {formatAmount(cost.amount, cost.currency)}
                </span>
              </button>
            );
          })
        )}
      </div>

      {/* ── 합계 분해 ────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border p-4">
          <h3 className="text-sm font-semibold">{t.fixedCost.byMethod}</h3>
          {methodTotals.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {t.fixedCost.noBreakdown}
            </p>
          ) : (
            <div className="mt-3 flex flex-col gap-2.5">
              {methodTotals
                .sort((a, b) => b[1] - a[1])
                .map(([id, amount]) => {
                  const m = id ? methods[id] : undefined;
                  return (
                    <BarRow
                      key={id ?? NONE}
                      label={m ? describeMethod(m) : t.payment.unassigned}
                      amount={amount}
                      total={total}
                      color={m?.color}
                    />
                  );
                })}
            </div>
          )}
        </div>

        <div className="rounded-lg border p-4">
          <h3 className="text-sm font-semibold">{t.fixedCost.byCategory}</h3>
          {categoryTotals.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {t.fixedCost.noBreakdown}
            </p>
          ) : (
            <div className="mt-3 flex flex-col gap-2.5">
              {categoryTotals
                .sort((a, b) => b[1] - a[1])
                .map(([id, amount]) => {
                  const c = id ? categories[id] : undefined;
                  return (
                    <BarRow
                      key={id ?? NONE}
                      label={c ? c.label : t.fixedCost.noCategory}
                      amount={amount}
                      total={total}
                      color={c?.color}
                    />
                  );
                })}
            </div>
          )}
        </div>
      </div>
        </>
      )}

      {costDialog}

      {/* ── 해지 확인 ────────────────────────────────── */}
      <AlertDialog
        open={toEnd !== null}
        onOpenChange={(o) => !o && setToEnd(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.fixedCost.endCostTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {toEnd?.title} — {t.fixedCost.endCostConfirm}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (toEnd) {
                  endCost(toEnd.id);
                  toast.success(t.fixedCost.endedToast);
                }
                setToEnd(null);
              }}
            >
              {t.fixedCost.endCost}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── 삭제 확인 ────────────────────────────────── */}
      <AlertDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.fixedCost.deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.fixedCost.deleteConfirm}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (toDelete) {
                  removeCost(toDelete.id);
                  toast.success(t.fixedCost.deleted);
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
