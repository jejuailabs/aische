'use client';

// ==========================================
// 일기 뷰
// ==========================================
//
// ⚠️ 이 화면의 핵심 규칙: **원문이 곧 내용이다.**
// - rawText는 어떤 경우에도 AI 결과로 덮어쓰지 않는다.
// - 저장은 AI를 기다리지 않는다. 분석이 실패해도 글은 이미 안전하다.
// - AI가 낸 정보는 원문 아래 시각적으로 분리된 보조 영역에만 둔다.
// - 근거(quote)를 원문에서 못 찾은 인물 판정은 기본 OFF로 두고
//   사용자가 직접 확인해서 켜게 한다. 조용히 사실로 저장하지 않는다.

import { useMemo, useState } from 'react';
import { addMonths, format } from 'date-fns';
import { ko as koLocale } from 'date-fns/locale';
import {
  ChevronLeft,
  ChevronRight,
  BookOpen,
  Trash2,
  Pencil,
  Sparkles,
  Flame,
  AlertTriangle,
  MessageSquareQuote,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
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
  useDiaryStore,
  useRelationshipStore,
  usePersonStore,
  useOrgStore,
} from '@/lib/store';
import {
  createDiaryEntry,
  createRelationshipLog,
  createPerson,
} from '@/lib/services';
import {
  entriesInMonth,
  moodByMonth,
  writingStreak,
  topEmotions,
  moodLabel,
  sentimentLabel,
} from '@/lib/diary';
import { VoiceButton } from '@/components/chat/voice-input';
import type { DiaryEntry, Mood } from '@/lib/types';

const WS = 'demo-workspace';

const MOOD_EMOJI: Record<number, string> = {
  [-2]: '😩',
  [-1]: '😔',
  [0]: '😐',
  [1]: '🙂',
  [2]: '😄',
};

const toDateInput = (d: Date) => format(d, 'yyyy-MM-dd');

/** AI가 뽑아낸 인물 후보 — 확인 단계에서 켜고 끈다 */
interface PendingPerson {
  name: string;
  matchedPersonId: string | null;
  event: string;
  feeling: string | null;
  sentiment: number;
  quote: string | null;
  /** false면 AI가 낸 근거를 원문에서 찾지 못했다는 뜻 */
  quoteVerified: boolean;
  checked: boolean;
}

interface ConfirmState {
  entryId: string;
  occurredAt: Date;
  people: PendingPerson[];
}

export function DiaryView() {
  const { t, locale } = useLocale();
  const dateLocale = locale === 'ko' ? koLocale : undefined;

  const entryMap = useDiaryStore((s) => s.entries);
  const addEntry = useDiaryStore((s) => s.addEntry);
  const updateEntry = useDiaryStore((s) => s.updateEntry);
  const removeEntry = useDiaryStore((s) => s.removeEntry);

  const addRelLog = useRelationshipStore((s) => s.addLog);
  const people = usePersonStore((s) => s.people);
  const addPerson = usePersonStore((s) => s.addPerson);
  const orgs = useOrgStore((s) => s.orgs);

  // ── 작성 영역 ──
  const [text, setText] = useState('');
  const [channel, setChannel] = useState<'text' | 'voice'>('text');
  const [writeDate, setWriteDate] = useState(toDateInput(new Date()));
  const [busy, setBusy] = useState<'idle' | 'saving' | 'analyzing'>('idle');

  // ── 목록 ──
  const [monthOffset, setMonthOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // ── 확인 단계 / 편집 / 삭제 ──
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [editing, setEditing] = useState<DiaryEntry | null>(null);
  const [editDraft, setEditDraft] = useState({ rawText: '', entryDate: '' });
  const [toDelete, setToDelete] = useState<DiaryEntry | null>(null);

  const entryList = useMemo(() => Object.values(entryMap), [entryMap]);

  const currentMonth = useMemo(
    () => addMonths(new Date(), monthOffset),
    [monthOffset],
  );
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  const monthEntries = useMemo(
    () => entriesInMonth(entryList, year, month),
    [entryList, year, month],
  );

  const streak = useMemo(() => writingStreak(entryList), [entryList]);
  const emotions = useMemo(() => topEmotions(entryList, 8), [entryList]);
  const moodTrend = useMemo(
    () => moodByMonth(entryList).slice(-6),
    [entryList],
  );

  const monthLabel =
    locale === 'ko'
      ? format(currentMonth, 'yyyy년 M월', { locale: dateLocale })
      : format(currentMonth, 'MMMM yyyy');

  // ─────────────────────────────────────────
  // 저장 — 원문 먼저, AI는 나중에
  // ─────────────────────────────────────────
  const handleSave = async () => {
    const raw = text;
    if (!raw.trim()) {
      toast.error(t.diary.emptyText);
      return;
    }

    setBusy('saving');

    // 1) 원문을 먼저 확정 저장한다. AI를 기다리지 않는다.
    const entry = createDiaryEntry({
      workspaceId: WS,
      rawText: raw,
      channel,
      entryDate: new Date(`${writeDate}T00:00:00`),
    });
    addEntry(entry);
    setText('');
    setChannel('text');
    toast.success(t.diary.savedRaw);

    // 2) 그 다음에 분석을 시도한다. 실패해도 위에서 이미 저장이 끝났다.
    setBusy('analyzing');
    try {
      const res = await fetch('/api/ai/diary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: raw,
          channel,
          people: Object.values(people).map((p) => ({
            id: p.id,
            name: p.name,
            org: p.org,
          })),
          organizations: Object.values(orgs).map((o) => ({
            id: o.id,
            name: o.name,
          })),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // rawText는 절대 포함하지 않는다 — 원문은 건드리지 않는 게 이 화면의 전부다
      const updates: Partial<DiaryEntry> = {
        title: data.title || entry.title,
        mood: (data.mood ?? null) as Mood | null,
        emotions: data.emotions ?? [],
        events: data.events ?? [],
        places: data.places ?? [],
        tags: data.tags ?? [],
        analyzed: !!data.analyzed,
      };
      // "어제" 같은 날짜 표현을 API가 해석했으면 그 날짜로 옮긴다
      const occurredAt = data.entryDate
        ? new Date(`${data.entryDate}T00:00:00`)
        : entry.entryDate;
      if (data.entryDate) updates.entryDate = occurredAt;

      updateEntry(entry.id, updates);

      const extracted: any[] = Array.isArray(data.people) ? data.people : [];
      if (extracted.length > 0) {
        setConfirmState({
          entryId: entry.id,
          occurredAt,
          people: extracted.map((p) => ({
            name: String(p.name ?? ''),
            matchedPersonId: p.matchedPersonId ?? null,
            event: String(p.event ?? ''),
            feeling: p.feeling ?? null,
            sentiment: Number(p.sentiment) || 0,
            quote: p.quote ?? null,
            quoteVerified: p.quoteVerified !== false,
            // 근거를 확인하지 못한 항목은 기본 OFF — 사용자가 직접 켜야 한다
            checked: p.quoteVerified !== false,
          })),
        });
      }
    } catch (err) {
      console.warn('[diary] analyze failed', err);
      toast.error(t.diary.analyzeFailed);
    } finally {
      setBusy('idle');
    }
  };

  // ─────────────────────────────────────────
  // 확인 단계 → 관계 기록 생성
  // ─────────────────────────────────────────
  const applyConfirm = () => {
    if (!confirmState) return;
    const personIds: string[] = [];
    let count = 0;

    for (const p of confirmState.people) {
      if (!p.checked || !p.name.trim()) continue;

      // 기존 인물 우선 — AI가 같은 사람을 새로 만들지 않게
      let pid =
        p.matchedPersonId && people[p.matchedPersonId]
          ? p.matchedPersonId
          : null;
      if (!pid) {
        const found = usePersonStore.getState().findByName(p.name);
        if (found) {
          pid = found.id;
        } else {
          const created = createPerson({ workspaceId: WS, name: p.name.trim() });
          addPerson(created);
          pid = created.id;
        }
      }

      addRelLog(
        createRelationshipLog({
          workspaceId: WS,
          personId: pid,
          diaryEntryId: confirmState.entryId,
          occurredAt: confirmState.occurredAt,
          event: p.event,
          feeling: p.feeling,
          sentiment: p.sentiment,
          quote: p.quote,
        }),
      );
      if (!personIds.includes(pid)) personIds.push(pid);
      count += 1;
    }

    if (personIds.length > 0) {
      updateEntry(confirmState.entryId, { personIds });
    }
    setConfirmState(null);
    if (count > 0) {
      toast.success(t.diary.logsCreated.replace('{count}', String(count)));
    }
  };

  const togglePending = (idx: number) => {
    setConfirmState((s) =>
      s
        ? {
            ...s,
            people: s.people.map((p, i) =>
              i === idx ? { ...p, checked: !p.checked } : p,
            ),
          }
        : s,
    );
  };

  // ─────────────────────────────────────────
  // 수정 / 삭제
  // ─────────────────────────────────────────
  const openEdit = (e: DiaryEntry) => {
    setEditing(e);
    setEditDraft({ rawText: e.rawText, entryDate: toDateInput(e.entryDate) });
  };

  const saveEdit = () => {
    if (!editing) return;
    if (!editDraft.rawText.trim()) {
      toast.error(t.diary.emptyText);
      return;
    }
    // 사용자가 자기 글을 고치는 것은 허용된다. AI가 고치는 것과는 다르다.
    updateEntry(editing.id, {
      rawText: editDraft.rawText,
      entryDate: new Date(`${editDraft.entryDate}T00:00:00`),
    });
    setEditing(null);
    toast.success(t.diary.saved);
  };

  // ─────────────────────────────────────────
  // 렌더 조각
  // ─────────────────────────────────────────
  const isEmpty = entryList.length === 0;

  const writeArea = (
    <div className="flex flex-col gap-2.5 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t.diary.writeTitle}</h2>
        <span className="text-[11px] text-muted-foreground">
          {t.diary.writeHint}
        </span>
      </div>

      <Textarea
        rows={5}
        value={text}
        placeholder={t.diary.placeholder}
        onChange={(e) => setText(e.target.value)}
        className="resize-y"
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Label htmlFor="diary-date" className="text-xs text-muted-foreground">
            {t.diary.entryDate}
          </Label>
          <Input
            id="diary-date"
            type="date"
            value={writeDate}
            onChange={(e) => setWriteDate(e.target.value)}
            className="h-9 w-[150px]"
          />
        </div>

        <div className="flex items-center gap-2">
          <VoiceButton
            onTranscript={(tr) => {
              // 받아쓴 문장은 기존 글 뒤에 이어 붙인다 (덮어쓰지 않는다)
              setText((prev) => (prev ? `${prev}\n${tr}` : tr));
              setChannel('voice');
            }}
          />
          <Button
            size="sm"
            className="h-9 gap-1.5"
            onClick={handleSave}
            disabled={busy !== 'idle'}
          >
            {busy !== 'idle' && <Loader2 className="size-3.5 animate-spin" />}
            {busy === 'saving'
              ? t.diary.saving
              : busy === 'analyzing'
                ? t.diary.analyzing
                : t.diary.saveEntry}
          </Button>
        </div>
      </div>
    </div>
  );

  const statsArea = (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-lg border p-4">
        <div className="flex items-center gap-2">
          <Flame className="size-4 text-orange-500" />
          <p className="text-sm font-semibold">
            {streak > 0
              ? t.diary.streak.replace('{days}', String(streak))
              : t.diary.noStreak}
          </p>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {t.diary.thisMonth.replace('{count}', String(monthEntries.length))}
        </p>

        <p className="mt-3 text-xs text-muted-foreground">
          {t.diary.moodTrend}
        </p>
        {moodTrend.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {t.diary.noMoodTrend}
          </p>
        ) : (
          <div className="mt-1.5 flex flex-wrap items-end gap-3">
            {moodTrend.map((m) => (
              <span key={m.period} className="flex flex-col items-center gap-0.5">
                <span className="text-base leading-none">
                  {MOOD_EMOJI[Math.round(m.avgMood)] ?? '😐'}
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {m.period.slice(5)}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border p-4">
        <p className="text-xs text-muted-foreground">{t.diary.topEmotions}</p>
        {emotions.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {t.diary.noEmotions}
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {emotions.map((e) => (
              <Badge key={e.emotion} variant="secondary" className="text-[10px]">
                {e.emotion} · {e.count}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const emptyState = (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <BookOpen className="size-10 text-muted-foreground opacity-30" />
      <h2 className="text-base font-semibold">{t.diary.emptyTitle}</h2>
      <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
        {t.diary.emptyHint}
      </p>
    </div>
  );

  // ── 확인 다이얼로그 (엘리먼트로 한 번만 생성 — 리마운트 방지) ──
  const confirmDialog = (
    <Dialog
      open={confirmState !== null}
      onOpenChange={(o) => !o && setConfirmState(null)}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.diary.confirmTitle}</DialogTitle>
          <DialogDescription>{t.diary.confirmHint}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2.5">
          {confirmState?.people.map((p, i) => (
            <div
              key={`${p.name}-${i}`}
              className={`rounded-lg border p-3 ${
                p.quoteVerified ? '' : 'border-amber-500/50 bg-amber-500/5'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <Checkbox
                  id={`pp-${i}`}
                  checked={p.checked}
                  onCheckedChange={() => togglePending(i)}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Label
                      htmlFor={`pp-${i}`}
                      className="cursor-pointer text-sm font-semibold"
                    >
                      {p.name}
                    </Label>
                    <Badge variant="outline" className="text-[10px]">
                      {sentimentLabel(p.sentiment)}
                    </Badge>
                    {!p.quoteVerified && (
                      <Badge
                        variant="outline"
                        className="gap-1 border-amber-500/50 text-[10px] text-amber-600 dark:text-amber-400"
                      >
                        <AlertTriangle className="size-3" />
                        {t.diary.unverified}
                      </Badge>
                    )}
                  </div>

                  <p className="mt-1 text-xs">{p.event}</p>
                  {p.feeling && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {p.feeling}
                    </p>
                  )}

                  {p.quote ? (
                    <blockquote className="mt-1.5 flex gap-1.5 border-l-2 border-muted-foreground/30 pl-2.5 text-xs italic text-muted-foreground">
                      <MessageSquareQuote className="mt-0.5 size-3 shrink-0" />
                      <span className="whitespace-pre-wrap">{p.quote}</span>
                    </blockquote>
                  ) : (
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      {t.diary.noQuote}
                    </p>
                  )}

                  {!p.quoteVerified && (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
                      {t.diary.unverifiedHint}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmState(null)}
          >
            {t.diary.confirmSkip}
          </Button>
          <Button size="sm" onClick={applyConfirm}>
            {t.diary.confirmSave}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  const editDialog = (
    <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.diary.editTitle}</DialogTitle>
          <DialogDescription>{t.diary.editRawHint}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="de-date">{t.diary.entryDate}</Label>
            <Input
              id="de-date"
              type="date"
              value={editDraft.entryDate}
              onChange={(e) =>
                setEditDraft((d) => ({ ...d, entryDate: e.target.value }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="de-raw">{t.diary.rawTextLabel}</Label>
            <Textarea
              id="de-raw"
              rows={10}
              value={editDraft.rawText}
              onChange={(e) =>
                setEditDraft((d) => ({ ...d, rawText: e.target.value }))
              }
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
            {t.common.cancel}
          </Button>
          <Button size="sm" onClick={saveEdit}>
            {t.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return (
    <div className="flex flex-col gap-4">
      {writeArea}

      {isEmpty ? (
        emptyState
      ) : (
        <>
          {statsArea}

          {/* ── 월 이동 ─────────────────────────────── */}
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

          {/* ── 목록 ────────────────────────────────── */}
          {monthEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
              <BookOpen className="size-8 opacity-30" />
              <p className="text-sm">{t.diary.noEntriesThisMonth}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {monthEntries.map((e) => {
                const expanded = expandedId === e.id;
                return (
                  <div key={e.id} className="rounded-lg border">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setExpandedId(expanded ? null : e.id)}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter' || ev.key === ' ') {
                          ev.preventDefault();
                          setExpandedId(expanded ? null : e.id);
                        }
                      }}
                      className="cursor-pointer p-3 transition-colors hover:bg-muted/50"
                    >
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {format(e.entryDate, 'MM.dd')}
                        </span>
                        <span className="text-sm font-semibold">{e.title}</span>
                        <span className="text-xs text-muted-foreground">
                          {MOOD_EMOJI[e.mood ?? 0] ?? '😐'} {moodLabel(e.mood)}
                        </span>
                      </div>

                      {e.emotions.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {e.emotions.map((em) => (
                            <Badge
                              key={em}
                              variant="secondary"
                              className="text-[10px]"
                            >
                              {em}
                            </Badge>
                          ))}
                        </div>
                      )}

                      {!expanded && (
                        <p className="mt-1.5 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">
                          {e.rawText}
                        </p>
                      )}
                    </div>

                    {expanded && (
                      <div className="border-t p-3">
                        {/* ── 원문: 이 화면의 주인공 ── */}
                        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          {t.diary.rawTextLabel}
                        </p>
                        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">
                          {e.rawText}
                        </p>

                        <Separator className="my-3" />

                        {/* ── AI 메타: 시각적으로 분리된 보조 영역 ── */}
                        <div className="rounded-lg bg-muted/40 p-3">
                          <div className="flex items-center gap-1.5">
                            <Sparkles className="size-3.5 text-muted-foreground" />
                            <p className="text-[11px] font-medium text-muted-foreground">
                              {t.diary.aiMetaLabel}
                            </p>
                          </div>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {t.diary.aiMetaHint}
                          </p>

                          {!e.analyzed ? (
                            <p className="mt-2 text-xs text-muted-foreground">
                              {t.diary.notAnalyzed}
                            </p>
                          ) : (
                            <div className="mt-2 flex flex-col gap-2 text-xs">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-muted-foreground">
                                  {t.diary.mood}
                                </span>
                                <span>
                                  {MOOD_EMOJI[e.mood ?? 0] ?? '😐'}{' '}
                                  {moodLabel(e.mood)}
                                </span>
                              </div>

                              {e.events.length > 0 && (
                                <div>
                                  <span className="text-muted-foreground">
                                    {t.diary.events}
                                  </span>
                                  <ul className="mt-1 list-inside list-disc space-y-0.5">
                                    {e.events.map((ev, i) => (
                                      <li key={`${ev}-${i}`}>{ev}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {e.places.length > 0 && (
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-muted-foreground">
                                    {t.diary.places}
                                  </span>
                                  {e.places.map((pl) => (
                                    <Badge
                                      key={pl}
                                      variant="outline"
                                      className="text-[10px]"
                                    >
                                      {pl}
                                    </Badge>
                                  ))}
                                </div>
                              )}

                              {e.tags.length > 0 && (
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-muted-foreground">
                                    {t.diary.tags}
                                  </span>
                                  {e.tags.map((tg) => (
                                    <Badge
                                      key={tg}
                                      variant="outline"
                                      className="text-[10px]"
                                    >
                                      {tg}
                                    </Badge>
                                  ))}
                                </div>
                              )}

                              {e.personIds.length > 0 && (
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-muted-foreground">
                                    {t.people.tabPeople}
                                  </span>
                                  {e.personIds.map((pid) => (
                                    <Badge
                                      key={pid}
                                      variant="secondary"
                                      className="text-[10px]"
                                    >
                                      {people[pid]?.name ?? pid}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="mt-3 flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5"
                            onClick={() => openEdit(e)}
                          >
                            <Pencil className="size-3.5" />
                            {t.common.edit}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1.5 text-destructive hover:text-destructive"
                            onClick={() => setToDelete(e)}
                          >
                            <Trash2 className="size-3.5" />
                            {t.common.delete}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {confirmDialog}
      {editDialog}

      <AlertDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.diary.deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.diary.deleteConfirm}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (toDelete) {
                  removeEntry(toDelete.id);
                  toast.success(t.diary.deleted);
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
