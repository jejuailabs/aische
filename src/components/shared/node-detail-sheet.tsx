'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import {
  useNodeStore,
  useCategoryStore,
  useProjectStore,
} from '@/lib/store';
import { useLocale } from '@/hooks/use-locale';
import { generateId } from '@/lib/services';
import { format } from 'date-fns';
import { Trash2, Plus, X, CheckSquare, Square, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import type {
  Node, NodeStatus, ScheduleInfo, CompletionCriteria, ChecklistItem,
} from '@/lib/types';

type CompletionMode = 'manual' | 'deliverable' | 'checklist';

/** Radix Select rejects an empty string value, so blank options need a sentinel. */
const NO_CATEGORY = '__none__';
const UNSORTED = 'unsorted';

const ALL_STATUSES: NodeStatus[] = [
  'scheduled', 'in_progress', 'waiting', 'review', 'completed', 'on_hold', 'cancelled',
];

function toDateInput(value: unknown): string {
  if (!value) return '';
  const d = new Date(value as any);
  if (Number.isNaN(d.getTime())) return '';
  return format(d, 'yyyy-MM-dd');
}

function toTimeInput(value: unknown): string {
  if (!value) return '';
  const d = new Date(value as any);
  if (Number.isNaN(d.getTime())) return '';
  return format(d, 'HH:mm');
}

/** 폼 값 → 완전한 ScheduleInfo. reminders/attendees는 절대 undefined로 두지 않는다. */
function buildSchedule(
  prev: ScheduleInfo | null,
  form: {
    date: string;
    startTime: string;
    endTime: string;
    allDay: boolean;
    location: string;
    attendees: string;
    category: string;
  }
): ScheduleInfo | null {
  if (!form.date) return null;

  const startAt = form.allDay
    ? new Date(`${form.date}T00:00:00`)
    : new Date(`${form.date}T${form.startTime || '09:00'}:00`);
  let endAt = form.allDay
    ? new Date(`${form.date}T23:59:59`)
    : new Date(`${form.date}T${form.endTime || form.startTime || '10:00'}:00`);
  if (Number.isNaN(startAt.getTime())) return prev;
  if (Number.isNaN(endAt.getTime()) || endAt < startAt) endAt = startAt;

  return {
    startAt,
    endAt,
    // 기존에 마감일이 있던 항목(투두)만 마감일을 유지·갱신한다.
    dueAt: prev?.dueAt ? endAt : null,
    allDay: form.allDay,
    category: form.category === NO_CATEGORY ? '' : form.category,
    location: form.location.trim() || null,
    attendees: form.attendees
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean),
    reminders: prev?.reminders ?? [],
  };
}

function buildCompletion(
  mode: CompletionMode,
  deliverableRef: string,
  deliverableNote: string,
  items: ChecklistItem[]
): CompletionCriteria {
  if (mode === 'deliverable') {
    return {
      mode: 'deliverable',
      deliverableRef: deliverableRef.trim() || null,
      deliverableNote,
    };
  }
  if (mode === 'checklist') return { mode: 'checklist', items };
  return { mode: 'manual' };
}

export interface NodeDetailSheetProps {
  nodeId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NodeDetailSheet({ nodeId, open, onOpenChange }: NodeDetailSheetProps) {
  const { t } = useLocale();
  const allNodes = useNodeStore((s) => s.nodes);
  const updateNodeWithLog = useNodeStore((s) => s.updateNodeWithLog);
  const removeNodeWithLog = useNodeStore((s) => s.removeNodeWithLog);
  const propagateCompletion = useNodeStore((s) => s.propagateCompletion);
  const recalcParentProgress = useNodeStore((s) => s.recalcParentProgress);
  const categories = useCategoryStore((s) => s.categories);
  const projects = useProjectStore((s) => s.projects);

  const node: Node | null = nodeId ? allNodes[nodeId] ?? null : null;

  // --- form state ---
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<NodeStatus>('scheduled');
  const [urgency, setUrgency] = useState(3);
  const [importance, setImportance] = useState(3);
  const [progress, setProgress] = useState(0);
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [allDay, setAllDay] = useState(false);
  const [location, setLocation] = useState('');
  const [attendees, setAttendees] = useState('');
  const [category, setCategory] = useState<string>(NO_CATEGORY);
  const [projectId, setProjectId] = useState<string>(UNSORTED);
  const [completionMode, setCompletionMode] = useState<CompletionMode>('manual');
  const [deliverableRef, setDeliverableRef] = useState('');
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [newChecklistLabel, setNewChecklistLabel] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // 시트를 열 때(또는 다른 노드로 바꿀 때)만 폼을 노드 값으로 리셋한다.
  // allNodes 변화에는 반응하지 않아야 입력 중 값이 되돌아가지 않는다.
  useEffect(() => {
    if (!open || !nodeId) return;
    const n = useNodeStore.getState().nodes[nodeId];
    if (!n) return;
    setTitle(n.title);
    setDescription(n.description);
    setStatus(n.status);
    setUrgency(n.priority.urgency);
    setImportance(n.priority.importance);
    setProgress(n.progress);
    setDate(toDateInput(n.schedule?.startAt ?? n.schedule?.dueAt));
    setStartTime(toTimeInput(n.schedule?.startAt) || '09:00');
    setEndTime(toTimeInput(n.schedule?.endAt) || '10:00');
    setAllDay(n.schedule?.allDay ?? false);
    setLocation(n.schedule?.location ?? '');
    setAttendees((n.schedule?.attendees ?? []).join(', '));
    setCategory(n.schedule?.category || NO_CATEGORY);
    setProjectId(n.projectId || UNSORTED);
    setCompletionMode((n.completion?.mode as CompletionMode) ?? 'manual');
    setDeliverableRef(
      n.completion?.mode === 'deliverable' ? n.completion.deliverableRef ?? '' : ''
    );
    setChecklist(n.completion?.mode === 'checklist' ? [...n.completion.items] : []);
    setNewChecklistLabel('');
  }, [open, nodeId]);

  const statusLabel = useCallback(
    (s: NodeStatus) => t.status[s] ?? s,
    [t]
  );

  const sortedCategories = useMemo(
    () => Object.values(categories).sort((a, b) => a.order - b.order),
    [categories]
  );

  const handleAddChecklistItem = useCallback(() => {
    const label = newChecklistLabel.trim();
    if (!label) return;
    setChecklist((prev) => [...prev, { id: generateId(), label, done: false }]);
    setNewChecklistLabel('');
  }, [newChecklistLabel]);

  const handleSave = useCallback(() => {
    if (!node) return;
    const trimmed = title.trim();
    if (!trimmed) {
      toast.warning(t.nodeDetail.titleRequired);
      return;
    }

    const schedule = buildSchedule(node.schedule, {
      date, startTime, endTime, allDay, location, attendees, category,
    });

    const isTask = node.kind === 'task';
    const completion: CompletionCriteria | null = isTask
      ? buildCompletion(
          completionMode,
          deliverableRef,
          node.completion?.mode === 'deliverable' ? node.completion.deliverableNote : '',
          checklist
        )
      : null;

    // 체크리스트 task의 진행률은 항목 비율에서 도출한다.
    let nextProgress = progress;
    if (isTask && completionMode === 'checklist' && checklist.length > 0) {
      nextProgress = Math.round(
        (checklist.filter((i) => i.done).length / checklist.length) * 100
      );
    }
    if (status === 'completed') nextProgress = 100;

    const updates: Partial<Node> = {
      title: trimmed,
      description,
      status,
      priority: {
        urgency,
        importance,
        score: Math.round(urgency * 0.4 + importance * 0.6),
      },
      progress: nextProgress,
      completedAt:
        status === 'completed' ? node.completedAt ?? new Date() : null,
      schedule,
      projectId,
      completion,
    };

    updateNodeWithLog(node.id, updates);

    if (status !== node.status || nextProgress !== node.progress) {
      propagateCompletion(node.id);
    }
    toast.success(t.nodeDetail.saved);
    onOpenChange(false);
  }, [
    node, title, description, status, urgency, importance, progress,
    date, startTime, endTime, allDay, location, attendees, category, projectId,
    completionMode, deliverableRef, checklist,
    updateNodeWithLog, propagateCompletion, onOpenChange, t,
  ]);

  const handleDelete = useCallback(() => {
    if (!node) return;
    const parentId = node.parentId;
    if (parentId) {
      const parent = useNodeStore.getState().nodes[parentId];
      if (parent) {
        updateNodeWithLog(parentId, {
          childrenIds: parent.childrenIds.filter((c) => c !== node.id),
        });
      }
    }
    removeNodeWithLog(node.id);
    if (parentId) recalcParentProgress(parentId);
    setConfirmDelete(false);
    onOpenChange(false);
    toast.success(t.nodeDetail.deleted);
  }, [node, updateNodeWithLog, removeNodeWithLog, recalcParentProgress, onOpenChange, t]);

  // 노드가 없으면(삭제됐거나 id가 null) 아무것도 그리지 않는다.
  if (!nodeId || !node) return null;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b">
            <SheetTitle className="text-base">{t.nodeDetail.title}</SheetTitle>
            <SheetDescription className="text-xs">
              {t.nodeDetail.subtitle}
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-4 p-4">
              {/* 제목 */}
              <div className="space-y-1.5">
                <label className="block text-xs text-muted-foreground">
                  {t.nodeDetail.titleLabel}
                </label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t.nodeDetail.titlePlaceholder}
                  className="h-9 text-sm"
                />
              </div>

              {/* 설명 */}
              <div className="space-y-1.5">
                <label className="block text-xs text-muted-foreground">
                  {t.nodeDetail.descLabel}
                </label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t.nodeDetail.descPlaceholder}
                  className="min-h-[70px] text-sm"
                />
              </div>

              {/* 상태 */}
              <div className="space-y-1.5">
                <label className="block text-xs text-muted-foreground">
                  {t.nodeDetail.statusLabel}
                </label>
                <Select value={status} onValueChange={(v) => setStatus(v as NodeStatus)}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ALL_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {statusLabel(s)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 우선순위 */}
              <div className="space-y-1.5">
                <label className="block text-xs text-muted-foreground">
                  {t.nodeDetail.priorityLabel}
                </label>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <label className="text-[10px] text-muted-foreground">
                      {t.nodeDetail.urgency}: {urgency}
                    </label>
                    <Input
                      type="range" min={1} max={5} step={1}
                      value={urgency}
                      onChange={(e) => setUrgency(Number(e.target.value))}
                      className="h-6 p-0"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-[10px] text-muted-foreground">
                      {t.nodeDetail.importance}: {importance}
                    </label>
                    <Input
                      type="range" min={1} max={5} step={1}
                      value={importance}
                      onChange={(e) => setImportance(Number(e.target.value))}
                      className="h-6 p-0"
                    />
                  </div>
                </div>
              </div>

              {/* 진행률 */}
              <div className="space-y-1.5">
                <label className="block text-xs text-muted-foreground">
                  {t.nodeDetail.progress}: {progress}%
                </label>
                <Input
                  type="range" min={0} max={100} step={5}
                  value={progress}
                  onChange={(e) => setProgress(Number(e.target.value))}
                  className="h-6 p-0"
                />
              </div>

              <Separator />

              {/* 일정 */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium">
                    {t.nodeDetail.scheduleSection}
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {t.nodeDetail.allDay}
                    </span>
                    <Switch checked={allDay} onCheckedChange={setAllDay} />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[10px] text-muted-foreground">
                    {t.nodeDetail.date}
                  </label>
                  <Input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>

                {!allDay && (
                  <div className="flex gap-2">
                    <div className="flex-1 space-y-1.5">
                      <label className="block text-[10px] text-muted-foreground">
                        {t.nodeDetail.startTime}
                      </label>
                      <Input
                        type="time"
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                        className="h-9 text-xs"
                      />
                    </div>
                    <div className="flex-1 space-y-1.5">
                      <label className="block text-[10px] text-muted-foreground">
                        {t.nodeDetail.endTime}
                      </label>
                      <Input
                        type="time"
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        className="h-9 text-xs"
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="block text-[10px] text-muted-foreground">
                    {t.nodeDetail.location}
                  </label>
                  <Input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder={t.nodeDetail.locationPlaceholder}
                    className="h-9 text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[10px] text-muted-foreground">
                    {t.nodeDetail.attendees}
                  </label>
                  <Input
                    value={attendees}
                    onChange={(e) => setAttendees(e.target.value)}
                    placeholder={t.nodeDetail.attendeesPlaceholder}
                    className="h-9 text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[10px] text-muted-foreground">
                    {t.nodeDetail.category}
                  </label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_CATEGORY}>
                        {t.nodeDetail.noCategory}
                      </SelectItem>
                      {sortedCategories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          <span className="flex items-center gap-1.5">
                            <span
                              className="size-2 rounded-full"
                              style={{ backgroundColor: c.color }}
                            />
                            {c.label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Separator />

              {/* 프로젝트 */}
              <div className="space-y-1.5">
                <label className="block text-xs text-muted-foreground">
                  {t.nodeDetail.project}
                </label>
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNSORTED}>{t.nodeDetail.unsorted}</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 완료 기준 (task 전용) */}
              {node.kind === 'task' && (
                <div className="space-y-2 rounded-lg border p-2.5">
                  <label className="block text-xs font-medium">
                    {t.mandarat.completionCriteria}
                  </label>
                  <Select
                    value={completionMode}
                    onValueChange={(v) => setCompletionMode(v as CompletionMode)}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">{t.mandarat.completionManual}</SelectItem>
                      <SelectItem value="deliverable">{t.mandarat.completionDeliverable}</SelectItem>
                      <SelectItem value="checklist">{t.mandarat.completionChecklist}</SelectItem>
                    </SelectContent>
                  </Select>

                  {completionMode === 'deliverable' && (
                    <div className="space-y-1">
                      <label className="block text-[10px] text-muted-foreground">
                        {t.mandarat.deliverable}
                      </label>
                      <Input
                        value={deliverableRef}
                        onChange={(e) => setDeliverableRef(e.target.value)}
                        placeholder={t.mandarat.deliverablePlaceholder}
                        className="h-8 text-xs"
                      />
                    </div>
                  )}

                  {completionMode === 'checklist' && (
                    <div className="space-y-1.5">
                      {checklist.map((item) => (
                        <div key={item.id} className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              setChecklist((prev) =>
                                prev.map((i) =>
                                  i.id === item.id ? { ...i, done: !i.done } : i
                                )
                              )
                            }
                            className="shrink-0 text-muted-foreground hover:text-primary"
                          >
                            {item.done
                              ? <CheckSquare className="size-3.5 text-primary" />
                              : <Square className="size-3.5" />}
                          </button>
                          <span
                            className={cn(
                              'flex-1 truncate text-xs',
                              item.done && 'text-muted-foreground line-through'
                            )}
                          >
                            {item.label}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setChecklist((prev) => prev.filter((i) => i.id !== item.id))
                            }
                            className="shrink-0 text-muted-foreground hover:text-destructive"
                          >
                            <X className="size-3" />
                          </button>
                        </div>
                      ))}
                      <div className="flex items-center gap-1">
                        <Input
                          value={newChecklistLabel}
                          onChange={(e) => setNewChecklistLabel(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddChecklistItem();
                            }
                          }}
                          placeholder={t.mandarat.checklistItemPlaceholder}
                          className="h-7 text-xs"
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 shrink-0 px-2"
                          onClick={handleAddChecklistItem}
                        >
                          <Plus className="size-3" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </ScrollArea>

          <SheetFooter className="flex-row gap-2 border-t">
            <Button
              variant="destructive"
              size="sm"
              className="shrink-0"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="size-3.5" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => onOpenChange(false)}
            >
              {t.common.cancel}
            </Button>
            <Button size="sm" className="flex-1 gap-1" onClick={handleSave}>
              <Check className="size-3.5" />
              {t.common.save}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.nodeDetail.deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.nodeDetail.deleteConfirm}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              {t.common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
