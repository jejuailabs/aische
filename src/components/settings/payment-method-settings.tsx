'use client';

import { useMemo, useState } from 'react';
import { CreditCard, Plus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
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
import { usePaymentMethodStore, useFixedCostStore } from '@/lib/store';
import { createPaymentMethod } from '@/lib/services';
import { describeMethod } from '@/lib/fixed-cost';
import type { PaymentMethod } from '@/lib/types';

const WS = 'demo-workspace';

type MethodType = PaymentMethod['type'];

interface Draft {
  issuer: string;
  label: string;
  last4: string;
  type: MethodType;
  /** '' = 결제일 지정 안 함 */
  billingDay: string;
  color: string;
  active: boolean;
}

const emptyDraft: Draft = {
  issuer: '',
  label: '',
  last4: '',
  type: 'credit',
  billingDay: '',
  color: '#6366f1',
  active: true,
};

export function PaymentMethodSettings() {
  const { t } = useLocale();

  const methods = usePaymentMethodStore((s) => s.methods);
  const addMethod = usePaymentMethodStore((s) => s.addMethod);
  const updateMethod = usePaymentMethodStore((s) => s.updateMethod);
  const removeMethod = usePaymentMethodStore((s) => s.removeMethod);
  const costs = useFixedCostStore((s) => s.costs);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PaymentMethod | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<PaymentMethod | null>(null);

  const methodList = useMemo(
    () =>
      Object.values(methods).sort((a, b) => {
        // 사용 중인 카드를 위로, 그 안에서는 등록 순
        if (a.active !== b.active) return a.active ? -1 : 1;
        return a.createdAt.getTime() - b.createdAt.getTime();
      }),
    [methods],
  );

  /** 이 결제수단을 쓰는 고정비 건수 */
  const usageCount = (id: string) =>
    Object.values(costs).filter((c) => c.paymentMethodId === id).length;

  const typeLabel = (type: MethodType) =>
    type === 'credit'
      ? t.payment.typeCredit
      : type === 'debit'
        ? t.payment.typeDebit
        : type === 'account'
          ? t.payment.typeAccount
          : type === 'cash'
            ? t.payment.typeCash
            : t.payment.typeOther;

  const openNew = () => {
    setEditing(null);
    setDraft(emptyDraft);
    setError(null);
    setOpen(true);
  };

  const openEdit = (m: PaymentMethod) => {
    setEditing(m);
    setDraft({
      issuer: m.issuer,
      label: m.label,
      last4: m.last4,
      type: m.type,
      billingDay: m.billingDay === null ? '' : String(m.billingDay),
      color: m.color,
      active: m.active,
    });
    setError(null);
    setOpen(true);
  };

  const save = () => {
    if (!draft.issuer.trim()) {
      setError(t.payment.issuerRequired);
      return;
    }
    // 끝 4자리만 저장한다. 사용자가 더 길게 넣어도 뒤 4자리만 남긴다.
    const last4 = draft.last4.replace(/\D/g, '').slice(-4);
    const billingDay =
      draft.billingDay === ''
        ? null
        : Math.min(31, Math.max(1, Number(draft.billingDay)));

    if (editing) {
      updateMethod(editing.id, {
        issuer: draft.issuer.trim(),
        label: draft.label.trim() || draft.issuer.trim(),
        last4,
        type: draft.type,
        billingDay,
        color: draft.color,
        active: draft.active,
      });
    } else {
      addMethod(
        createPaymentMethod({
          workspaceId: WS,
          issuer: draft.issuer.trim(),
          label: draft.label.trim() || draft.issuer.trim(),
          last4,
          type: draft.type,
          billingDay,
          color: draft.color,
          active: draft.active,
        }),
      );
    }
    setOpen(false);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <Button size="sm" className="h-9 gap-1.5" onClick={openNew}>
          <Plus className="size-4" />
          {t.payment.addMethod}
        </Button>
      </div>

      {methodList.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center text-muted-foreground">
          <CreditCard className="size-8 opacity-30" />
          <p className="text-sm">{t.payment.noMethods}</p>
          <p className="max-w-md text-xs">{t.payment.emptyHint}</p>
        </div>
      ) : (
        methodList.map((m) => {
          const used = usageCount(m.id);
          return (
            <div
              key={m.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
            >
              <span
                className="size-5 shrink-0 rounded-full border"
                style={{ backgroundColor: m.color }}
                aria-hidden
              />
              <div className="min-w-[140px] flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={
                      m.active
                        ? 'text-sm font-medium'
                        : 'text-sm font-medium text-muted-foreground line-through'
                    }
                  >
                    {describeMethod(m)}
                  </span>
                  <Badge variant="outline" className="text-[10px]">
                    {typeLabel(m.type)}
                  </Badge>
                  {!m.active && (
                    <Badge variant="secondary" className="text-[10px]">
                      {t.payment.inactive}
                    </Badge>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {m.label && m.label !== m.issuer && <span>{m.label}</span>}
                  <span>
                    {t.payment.billingDay}{' '}
                    {m.billingDay === null
                      ? t.payment.billingDayNone
                      : `${m.billingDay}${t.payment.dayUnit}`}
                  </span>
                  <span>
                    {t.payment.usedByCount.replace('{count}', String(used))}
                  </span>
                </div>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5"
                  onClick={() => openEdit(m)}
                >
                  <Pencil className="size-3.5" />
                  {t.common.edit}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-destructive hover:text-destructive"
                  onClick={() => setToDelete(m)}
                >
                  <Trash2 className="size-3.5" />
                  {t.common.delete}
                </Button>
              </div>
            </div>
          );
        })
      )}

      {/* ── 등록 / 수정 ─────────────────────────────── */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing ? t.payment.editMethod : t.payment.newMethod}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t.payment.editMethod}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pm-issuer">{t.payment.issuer}</Label>
              <Input
                id="pm-issuer"
                value={draft.issuer}
                placeholder={t.payment.issuerPlaceholder}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, issuer: e.target.value }))
                }
              />
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pm-label">{t.payment.label}</Label>
              <Input
                id="pm-label"
                value={draft.label}
                placeholder={t.payment.labelPlaceholder}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, label: e.target.value }))
                }
              />
            </div>

            {/* 끝 4자리만. 전체 카드번호는 어떤 경우에도 받지 않는다. */}
            <div className="space-y-1.5">
              <Label htmlFor="pm-last4">{t.payment.last4}</Label>
              <Input
                id="pm-last4"
                value={draft.last4}
                maxLength={4}
                inputMode="numeric"
                autoComplete="off"
                placeholder={t.payment.last4Placeholder}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    last4: e.target.value.replace(/\D/g, '').slice(0, 4),
                  }))
                }
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {t.payment.last4Hint}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t.payment.methodType}</Label>
                <Select
                  value={draft.type}
                  onValueChange={(v) =>
                    setDraft((d) => ({ ...d, type: v as MethodType }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="credit">{t.payment.typeCredit}</SelectItem>
                    <SelectItem value="debit">{t.payment.typeDebit}</SelectItem>
                    <SelectItem value="account">
                      {t.payment.typeAccount}
                    </SelectItem>
                    <SelectItem value="cash">{t.payment.typeCash}</SelectItem>
                    <SelectItem value="other">{t.payment.typeOther}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>{t.payment.billingDay}</Label>
                <Select
                  value={draft.billingDay === '' ? 'none' : draft.billingDay}
                  onValueChange={(v) =>
                    setDraft((d) => ({
                      ...d,
                      billingDay: v === 'none' ? '' : v,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    <SelectItem value="none">
                      {t.payment.billingDayNone}
                    </SelectItem>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {d}
                        {t.payment.dayUnit}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="pm-color">{t.payment.color}</Label>
                <Input
                  id="pm-color"
                  type="color"
                  className="h-9 p-1"
                  value={draft.color}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, color: e.target.value }))
                  }
                />
              </div>
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <Label htmlFor="pm-active" className="text-sm font-normal">
                  {t.payment.active}
                </Label>
                <Switch
                  id="pm-active"
                  checked={draft.active}
                  onCheckedChange={(c) =>
                    setDraft((d) => ({ ...d, active: c }))
                  }
                />
              </div>
            </div>
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

      {/* ── 삭제 ────────────────────────────────────── */}
      <AlertDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.payment.deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.payment.deleteConfirm}
              {toDelete && usageCount(toDelete.id) > 0 && (
                <span className="mt-2 block text-destructive">
                  {t.payment.deleteWarning.replace(
                    '{count}',
                    String(usageCount(toDelete.id)),
                  )}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (toDelete) {
                  removeMethod(toDelete.id);
                  toast.success(t.common.delete);
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
