'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import {
  useNodeStore,
  useCategoryStore,
  useProjectStore,
  useCaptureStore,
} from '@/lib/store';
import { useLocale } from '@/hooks/use-locale';
import { generateId } from '@/lib/services';
import { format } from 'date-fns';
import {
  Trash2, Plus, X, CheckSquare, Square, Check, MessageSquareText, ChevronDown,
} from 'lucide-react';
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
    // 반복 규칙은 편집 시 유실되지 않도록 그대로 보존한다
    recurrence: prev?.recurrence ?? null,
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
  const captures = useCaptureStore((s) => s.captures);
  const removeNodeWithLog = useNodeStore((s) => s.removeNodeWithLog);
  const propagateCompletion = useNodeStore((s) => s.propagateCompletion);
  const recalcParentProgress = useNodeStore((s) => s.recalcParentProgress);
  const categories = useCategoryStore((s) => s.categories);
  const projects = useProjectStore((s) => s.projects);

  const node: Node | null = nodeId ? allNodes[nodeId] ?? null : null;

  // --- form state ---
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  /** 원문 섹션 펼침 여부 — 기본은 접힘 */
  const [showSource, setShowSource] = useState(false);

  /**
   * 이 항목을 만들어낸 입력 원문.
   *
   * 노드 생성 시 capturedInputId로 연결돼 있다(ingest.ts).
   * 옛 데이터에는 연결이 없을 수 있으므로 없으면 섹션 자체를 안 그린다.
   */
  const source = node?.capturedInputId
    ? captures[node.capturedInputId] ?? null
    : null;
  const sourceText = source?.rawText?.trim() || '';
  const sourceDate = source
    ? format(
        source.createdAt instanceof Date
          ? source.createdAt
          : new Date(source.createdAt),
        'yyyy-MM-dd HH:mm'
      )
    : '';
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
    // 다른 항목으로 넘어가면 원문 섹션은 다시 접는다 —
    // 이전 항목에서 펼쳐둔 상태가 따라오면 엉뚱한 원문을 펼친 것처럼 보인다.
    setShowSource(false);
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

              {/*
                원문 보기.

                제목과 설명은 AI가 요약한 것이라 뉘앙스가 빠진다.
                "그 미팅 왜 잡았더라"는 결국 내가 실제로 뭐라고 말했는지를
                봐야 풀린다. 그래서 이 항목을 만들어낸 입력 원문을 그대로 보여준다.

                기본은 접어둔다 — 늘 펴져 있으면 편집 화면이 길어지기만 한다.
              */}
              {sourceText && (
                <div className="rounded-md border bg-muted/30">
                  <button
                    type="button"
                    onClick={() => setShowSource((v) => !v)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground hover:text-foreground"
                    aria-expanded={showSource}
                  >
                    <MessageSquareText className="h-3.5 w-3.5 shrink-0" />
                    <span className="flex-1">{t.nodeDetail.sourceLabel}</span>
                    <ChevronDown
                      className={cn(
                        'h-3.5 w-3.5 shrink-0 transition-transform',
                        showSource && 'rotate-180'
                      )}
                    />
                  </button>

                  {showSource && (
                    <div className="border-t px-3 py-2.5">
                      {/*
                        whitespace-pre-wrap: 원문의 줄바꿈을 살린다.
                        요약이 아니라 원문이라는 게 눈에 보여야 한다.
                      */}
                      <p className="whitespace-pre-wrap text-xs leading-relaxed">
                        {sourceText}
                      </p>
                      {sourceDate && (
                        <p className="mt-2 text-[10px] text-muted-foreground">
                          {sourceDate} · {t.nodeDetail.sourceHint}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

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
                  {/*
                    시간을 말하지 않은 입력은 allDay=true로 들어온다.
                    예전엔 그 상태에서 시작/종료 칸을 아예 숨겼는데, 그러면
                    "나중에 시간을 넣는 방법"이 화면에 없어서 막힌다.
                    그래서 토글을 '시간 지정'으로 뒤집고, 칸은 항상 보이되
                    꺼져 있을 때 비활성화만 한다.
                  */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {t.nodeDetail.setTime}
                    </span>
                    <Switch
                      checked={!allDay}
                      onCheckedChange={(on) => setAllDay(!on)}
                    />
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

                <div className="flex gap-2">
                  <div className="flex-1 space-y-1.5">
                    <label className="block text-[10px] text-muted-foreground">
                      {t.nodeDetail.startTime}
                    </label>
                    <Input
                      type="time"
                      value={startTime}
                      disabled={allDay}
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
                      disabled={allDay}
                      onChange={(e) => setEndTime(e.target.value)}
                      className="h-9 text-xs"
                    />
                  </div>
                </div>
                {allDay && (
                  <p className="text-[10px] leading-relaxed text-muted-foreground">
                    {t.nodeDetail.timeUnset}
                  </p>
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
