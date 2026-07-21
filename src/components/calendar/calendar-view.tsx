'use client';

import { useState, useMemo, useCallback, useRef, useLayoutEffect } from 'react';
import { cn } from '@/lib/utils';
import {
  useNavStore,
  useNodeStore,
  useCategoryStore,
  usePrefStore,
  useFixedCostStore,
  usePaymentMethodStore,
} from '@/lib/store';
import {
  costsOnDate,
  monthlyTotal,
  totalsByMethod,
  formatAmount,
  describeMethod,
  describeCycle,
} from '@/lib/fixed-cost';
import { useLocale } from '@/hooks/use-locale';
import { useIsMobile } from '@/hooks/use-mobile';
import { format } from 'date-fns';
import { ko as koLocale } from 'date-fns/locale';
import {
  ChevronLeft,
  ChevronRight,
  Pin,
  Plus,
  CalendarDays,
  Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { NodeDetailSheet } from '@/components/shared/node-detail-sheet';
import { toast } from 'sonner';
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameDay,
  addMonths,
} from 'date-fns';
import type { Node, FixedCost } from '@/lib/types';

/**
 * 캘린더 표시 모드.
 * 'schedule'  — 기존 일정 타임라인 (기본값)
 * 'fixedcost' — 고정비 결제만. 일정과 섞어 보여주지 않는다.
 */
type CalendarMode = 'schedule' | 'fixedcost';

/** 결제수단이 없는 고정비(현금 등)에 쓰는 중립 회색 */
const UNASSIGNED_METHOD_COLOR = '#94a3b8';

// Month cells render a miniature day timeline, so the cell height has to be
// large enough for a short event to stay legible: at 14px/hour a 1-hour block
// is 14px tall, which fits a 10px label.
const DAY_START_HOUR = 6;
const DAY_END_HOUR = 22;
const DAY_HOURS = DAY_END_HOUR - DAY_START_HOUR;
// 데스크톱은 14px/시간(=224px 셀)로 여유 있게, 모바일은 6px/시간(=96px 셀)로 줄여
// 스크롤 없이 한 달이 최대한 한 화면에 들어오게 한다.
const HOUR_PX_DESKTOP = 14;
const HOUR_PX_MOBILE = 6;
const MIN_BAR_PX_DESKTOP = 14;
const MIN_BAR_PX_MOBILE = 8;
const GUIDE_HOURS = [10, 14, 18];

/** Spread overlapping events across side-by-side lanes so none are hidden. */
function assignLanes(events: Node[]) {
  const sorted = events
    .filter((e) => e.schedule)
    .sort((a, b) => a.schedule!.startAt.getTime() - b.schedule!.startAt.getTime());

  const laneEndsAt: number[] = [];
  const placed = sorted.map((evt) => {
    const start = evt.schedule!.startAt.getTime();
    let lane = laneEndsAt.findIndex((endsAt) => endsAt <= start);
    if (lane === -1) lane = laneEndsAt.length;
    laneEndsAt[lane] = evt.schedule!.endAt.getTime();
    return { evt, lane };
  });

  return { placed, laneCount: Math.max(laneEndsAt.length, 1) };
}

export function CalendarView() {
  const calendarSubView = useNavStore((s) => s.calendarSubView);
  const setCalendarSubView = useNavStore((s) => s.setCalendarSubView);
  const selectedDate = useNavStore((s) => s.selectedDate);
  const setSelectedDate = useNavStore((s) => s.setSelectedDate);
  const getNodesByDate = useNodeStore((s) => s.getNodesByDate);
  const allNodes = useNodeStore((s) => s.nodes);
  const getColor = useCategoryStore((s) => s.getColor);
  const categories = useCategoryStore((s) => s.categories);
  const language = usePrefStore((s) => s.language);
  const { t } = useLocale();
  const [monthOffset, setMonthOffset] = useState(0);
  const [filterCats, setFilterCats] = useState<Set<string>>(new Set());
  const [detailNodeId, setDetailNodeId] = useState<string | null>(null);
  const [mode, setMode] = useState<CalendarMode>('schedule');
  const [detailCost, setDetailCost] = useState<FixedCost | null>(null);

  const costsRecord = useFixedCostStore((s) => s.costs);
  const methods = usePaymentMethodStore((s) => s.methods);

  const dateLocale = language === 'ko' ? koLocale : undefined;
  const currentMonth = addMonths(new Date(), monthOffset);
  const isFixedCostMode = mode === 'fixedcost';

  const costList = useMemo(() => Object.values(costsRecord), [costsRecord]);

  /** 결제수단 색상. 미지정(현금 등)은 중립 회색. */
  const methodColor = useCallback(
    (methodId: string | null) =>
      (methodId ? methods[methodId]?.color : undefined) ??
      UNASSIGNED_METHOD_COLOR,
    [methods]
  );

  // 화면에 보이는 달의 고정비 합계 / 결제수단별 내역
  const fcSummary = useMemo(() => {
    if (!isFixedCostMode) return null;
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const byMethod = totalsByMethod(costList, year, month);
    return {
      total: monthlyTotal(costList, year, month),
      rows: Array.from(byMethod.entries())
        .map(([methodId, amount]) => ({
          methodId,
          amount,
          label: describeMethod(methodId ? methods[methodId] : null),
          color: methodColor(methodId),
        }))
        .sort((a, b) => b.amount - a.amount),
    };
    // currentMonth는 매 렌더 새 Date라 getTime()으로 고정한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFixedCostMode, costList, methods, methodColor, monthOffset]);

  // Build the calendar grid days (including padding from prev/next months)
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    // Monday-based week start
    const start = startOfWeek(monthStart, { weekStartsOn: 1 });
    const end = endOfWeek(monthEnd, { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  const weekdayLabels = t.days.weekdays;

  // Get events for a specific day
  const getEventsForDay = useCallback(
    (day: Date): Node[] => {
      const events = getNodesByDate(day);
      if (filterCats.size === 0) return events;
      return events.filter(
        (n) => n.schedule && filterCats.has(n.schedule.category)
      );
    },
    [getNodesByDate, filterCats]
  );

  const toggleFilter = (catId: string) => {
    setFilterCats((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  };

  /* ---------------- 연속 스크롤 달력 ---------------- */
  //
  // 휠을 가로채 월을 갈아끼우던 방식을 버렸다. 임계값을 아무리 올려도
  // "느리게 툭 바뀌는" 것일 뿐, 한 달을 차분히 들여다볼 수가 없었다.
  //
  // 이제 달을 세로로 이어 붙이고 브라우저 기본 스크롤에 맡긴다.
  // 스크롤하면서 위쪽/아래쪽에 달을 계속 채워 넣는다.

  const scrollRef = useRef<HTMLDivElement>(null);
  /** 렌더할 달의 범위 (오늘 기준 오프셋) */
  const [range, setRange] = useState({ from: -1, to: 2 });
  /** 위로 달을 덧붙였을 때 스크롤 위치를 보정하려고 직전 높이를 기억한다 */
  const prependRef = useRef<number | null>(null);

  const monthOffsets = useMemo(() => {
    const out: number[] = [];
    for (let i = range.from; i <= range.to; i++) out.push(i);
    return out;
  }, [range]);

  /** 한 달치 날짜 (앞뒤 주 채움 포함) */
  const daysForMonth = useCallback((month: Date) => {
    const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, []);

  /**
   * 스크롤에 따라 (1) 헤더에 보일 달을 갱신하고 (2) 범위를 넓힌다.
   *
   * 위로 덧붙일 때는 스크롤 위치를 보정해야 한다. 안 그러면 콘텐츠가
   * 위로 밀리면서 화면이 갑자기 점프한다.
   */
  const handleMonthScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    // 컨테이너 상단에 가장 가까운 달을 '보고 있는 달'로 친다.
    const top = el.getBoundingClientRect().top;
    let best: number | null = null;
    let bestDist = Infinity;
    el.querySelectorAll<HTMLElement>('[data-month-offset]').forEach((m) => {
      const d = Math.abs(m.getBoundingClientRect().top - top);
      if (d < bestDist) {
        bestDist = d;
        best = Number(m.dataset.monthOffset);
      }
    });
    if (best !== null && best !== monthOffset) setMonthOffset(best);

    // 끝에 가까워지면 미리 더 만들어 둔다.
    if (el.scrollTop < 300) {
      prependRef.current = el.scrollHeight;
      setRange((r) => ({ ...r, from: r.from - 2 }));
    } else if (el.scrollHeight - el.clientHeight - el.scrollTop < 600) {
      setRange((r) => ({ ...r, to: r.to + 2 }));
    }
  }, [monthOffset]);

  // 위에 달이 추가된 만큼 스크롤을 내려 화면이 그대로 있게 한다.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || prependRef.current === null) return;
    const added = el.scrollHeight - prependRef.current;
    prependRef.current = null;
    if (added > 0) el.scrollTop += added;
  }, [range]);

  /** 특정 오프셋의 달로 스크롤한다 (이전/다음/오늘 버튼용) */
  const scrollToMonth = useCallback((offset: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const target = el.querySelector<HTMLElement>(
      `[data-month-offset="${offset}"]`
    );
    if (!target) return;
    el.scrollTo({
      top: el.scrollTop + (target.getBoundingClientRect().top - el.getBoundingClientRect().top),
      behavior: 'smooth',
    });
  }, []);


  // 모바일에서는 달력 한 칸이 너무 길어지지 않도록 시간당 픽셀을 줄인다.
  const isMobile = useIsMobile();
  const hourPx = isMobile ? HOUR_PX_MOBILE : HOUR_PX_DESKTOP;
  const minBarPx = isMobile ? MIN_BAR_PX_MOBILE : MIN_BAR_PX_DESKTOP;
  const timelinePx = DAY_HOURS * hourPx;

  // Event bar geometry in px, so a bar's size tracks its real duration
  // instead of collapsing with the cell.
  const eventBarStyle = (node: Node, lane: number, laneCount: number) => {
    if (!node.schedule) return {};
    const rawStart = node.schedule.startAt.getHours() + node.schedule.startAt.getMinutes() / 60;
    const rawEnd = node.schedule.endAt.getHours() + node.schedule.endAt.getMinutes() / 60;
    const startH = Math.min(Math.max(rawStart, DAY_START_HOUR), DAY_END_HOUR);
    const endH = Math.min(Math.max(rawEnd, startH), DAY_END_HOUR);
    const laneWidth = 100 / laneCount;
    return {
      top: `${(startH - DAY_START_HOUR) * hourPx}px`,
      height: `${Math.max((endH - startH) * hourPx, minBarPx)}px`,
      left: `${lane * laneWidth}%`,
      width: `calc(${laneWidth}% - 2px)`,
    };
  };

  if (calendarSubView === 'daily') {
    return <DailyView />;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Category legend chips — 일정 모드에서만. 고정비는 카테고리 필터와 무관하다. */}
      {!isFixedCostMode && (
      <div className="flex flex-wrap gap-1.5">
        {Object.values(categories)
          .sort((a, b) => a.order - b.order)
          .map((cat) => (
            <button
              key={cat.id}
              onClick={() => toggleFilter(cat.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                filterCats.has(cat.id)
                  ? 'border-transparent bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:bg-muted'
              )}
            >
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: cat.color }}
              />
              {cat.label}
            </button>
          ))}
      </div>
      )}

      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => scrollToMonth(monthOffset - 1)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <h2 className="min-w-[120px] text-center text-sm font-semibold">
            {format(currentMonth, 'yyyy년 M월', { locale: dateLocale })}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => scrollToMonth(monthOffset + 1)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              scrollToMonth(0);
              setSelectedDate(new Date());
            }}
          >
            {t.calendar.today}
          </Button>
          {/* 일정 / 고정비 전용 모드 토글 */}
          <div className="flex items-center rounded-lg border p-0.5">
            {([
              {
                value: 'schedule' as CalendarMode,
                icon: CalendarDays,
                label: t.calendar.modeSchedule,
              },
              {
                value: 'fixedcost' as CalendarMode,
                icon: Wallet,
                label: t.calendar.modeFixedCost,
              },
            ]).map(({ value, icon: Icon, label }) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
                className={cn(
                  'flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
                  mode === value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="size-3" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 고정비 모드: 월 합계 + 결제수단별 내역 */}
      {isFixedCostMode && fcSummary && (
        <div className="rounded-lg border bg-muted/30 px-3 py-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {t.calendar.fcMonthlyTotal}
            </span>
            <span className="text-base font-semibold tabular-nums">
              {formatAmount(fcSummary.total)}
            </span>
          </div>
          {fcSummary.rows.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {fcSummary.rows.map((row) => (
                <span
                  key={row.methodId ?? '__none__'}
                  className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
                >
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: row.color }}
                  />
                  <span>{row.label}</span>
                  <span className="font-medium tabular-nums text-foreground">
                    {formatAmount(row.amount)}
                  </span>
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t.calendar.fcNoPayments}
            </p>
          )}
        </div>
      )}

      {/*
        달력 — 달을 세로로 이어 붙이고 그냥 스크롤한다.

        예전엔 휠을 가로채서 월을 툭 갈아끼웠다. 한 칸만 굴려도 다음 달로
        튀어서 한 달을 제대로 볼 수가 없었다. 임계값을 올려봐야 "느리게 툭"이
        될 뿐 근본이 같다.

        그래서 휠 가로채기를 없앴다. 달과 달 사이를 넉넉히 띄우고, 월 이름을
        상단에 붙여둔다(sticky). 지금 보고 있는 달이 뭔지는 늘 보이고,
        스크롤 속도는 브라우저 기본값이라 손에 익은 대로 움직인다.
      */}
      <div
        ref={scrollRef}
        onScroll={handleMonthScroll}
        className="overflow-y-auto rounded-lg border max-h-[calc(100dvh-200px)]"
      >
        {monthOffsets.map((offset) => {
          const month = addMonths(new Date(), offset);
          const days = daysForMonth(month);
          // mb-8 = 달 사이 여백. 스크롤하면서 경계가 눈에 보여야 한다.
          return (
            <div
              key={offset}
              data-month-offset={offset}
              className="mb-8 last:mb-0"
            >
              {/* 월 이름 — 스크롤해도 위에 붙어 있다 */}
              <div className="sticky top-0 z-10 border-b bg-card/95 px-3 py-2 backdrop-blur">
                <span className="text-sm font-semibold">
                  {format(month, 'yyyy년 M월', { locale: dateLocale })}
                </span>
              </div>

              {/* Weekday headers */}
              <div className="grid grid-cols-7 border-b bg-muted/50">
                {weekdayLabels.map((day, i) => (
                  <div
                    key={i}
                    className="px-1 py-2 text-center text-xs font-medium text-muted-foreground"
                  >
                    {day}
                  </div>
                ))}
              </div>

              {/* Day cells */}
              <div className="grid grid-cols-7">
          {days.map((day, idx) => {
            const isCurrentMonth = day.getMonth() === month.getMonth();
            const isToday = isSameDay(day, new Date());
            const events = isFixedCostMode ? [] : getEventsForDay(day);
            const { placed, laneCount } = assignLanes(events);
            const dayCosts = isFixedCostMode
              ? costsOnDate(costList, day)
              : [];

            return (
              <button
                key={idx}
                onClick={() => {
                  setSelectedDate(day);
                  // 고정비 모드에는 일간 화면이 없다. 여기서 일간으로 넘기면
                  // 일정 화면이 떠서 맥락이 끊기므로, 월 단위 조회만 유지한다.
                  if (!isFixedCostMode) setCalendarSubView('daily');
                }}
                className={cn(
                  'relative border-b border-r p-1 text-left align-top transition-colors hover:bg-muted/50 last:border-r-0',
                  !isCurrentMonth && 'text-muted-foreground/50'
                )}
              >
                <span
                  className={cn(
                    'inline-flex size-6 items-center justify-center rounded-full text-xs',
                    isToday &&
                      'bg-primary font-bold text-primary-foreground'
                  )}
                >
                  {format(day, 'd')}
                </span>
                {/* 고정비 모드: 시점 결제이므로 타임라인 대신 짧은 행으로 쌓는다 */}
                {isFixedCostMode ? (
                  <div className="mt-0.5 flex min-h-10 w-full flex-col gap-0.5">
                    {dayCosts.map((cost) => (
                      <div
                        key={cost.id}
                        title={`${cost.title} ${formatAmount(cost.amount)}`}
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          setDetailCost(cost);
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return;
                          e.stopPropagation();
                          e.preventDefault();
                          setDetailCost(cost);
                        }}
                        className="flex cursor-pointer items-center gap-1 overflow-hidden rounded-sm px-1 py-0.5 text-[10px] leading-[13px] text-white"
                        style={{
                          backgroundColor: methodColor(cost.paymentMethodId),
                        }}
                      >
                        <span className="truncate">{cost.title}</span>
                        <span className="ml-auto shrink-0 tabular-nums">
                          {formatAmount(cost.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                <div
                  className="relative mt-0.5 w-full"
                  style={{ height: `${timelinePx}px` }}
                >
                  {/* Hour guides make an event's time position readable at a glance */}
                  {GUIDE_HOURS.map((hour) => (
                    <div
                      key={hour}
                      className="absolute inset-x-0 border-t border-dashed border-border/40"
                      style={{ top: `${(hour - DAY_START_HOUR) * hourPx}px` }}
                    />
                  ))}
                  {placed.map(({ evt, lane }) => (
                    <div
                      key={evt.id}
                      title={evt.title}
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        // 날짜 셀의 "일간 뷰로 이동"이 같이 발동하지 않도록 막는다.
                        e.stopPropagation();
                        setDetailNodeId(evt.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' && e.key !== ' ') return;
                        e.stopPropagation();
                        e.preventDefault();
                        setDetailNodeId(evt.id);
                      }}
                      className={cn(
                        'absolute cursor-pointer overflow-hidden rounded-sm px-1 text-[10px] leading-[14px] text-white',
                        evt.status === 'completed' && 'opacity-50 line-through'
                      )}
                      style={{
                        ...eventBarStyle(evt, lane, laneCount),
                        backgroundColor: getColor(
                          evt.schedule!.category,
                          document.documentElement.classList.contains('dark')
                        ),
                      }}
                    >
                      {evt.title}
                    </div>
                  ))}
                </div>
                )}
              </button>
            );
          })}
              </div>
            </div>
          );
        })}
      </div>

      <NodeDetailSheet
        nodeId={detailNodeId}
        open={detailNodeId !== null}
        onOpenChange={(o) => !o && setDetailNodeId(null)}
      />

      {/* 고정비 결제 상세 (읽기 전용). 편집은 고정비 뷰에서 한다. */}
      <Dialog
        open={detailCost !== null}
        onOpenChange={(o) => !o && setDetailCost(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{
                  backgroundColor: detailCost
                    ? methodColor(detailCost.paymentMethodId)
                    : UNASSIGNED_METHOD_COLOR,
                }}
              />
              {detailCost?.title ?? t.calendar.fcDetailTitle}
            </DialogTitle>
          </DialogHeader>
          {detailCost && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">{t.calendar.fcAmount}</dt>
              <dd className="font-medium tabular-nums">
                {formatAmount(detailCost.amount, detailCost.currency)}
              </dd>
              <dt className="text-muted-foreground">{t.calendar.fcCycle}</dt>
              <dd>{describeCycle(detailCost)}</dd>
              <dt className="text-muted-foreground">{t.calendar.fcMethod}</dt>
              <dd>
                {detailCost.paymentMethodId
                  ? describeMethod(methods[detailCost.paymentMethodId])
                  : t.calendar.fcUnassigned}
              </dd>
              {detailCost.memo && (
                <>
                  <dt className="text-muted-foreground">{t.calendar.fcMemo}</dt>
                  <dd className="whitespace-pre-wrap">{detailCost.memo}</dd>
                </>
              )}
            </dl>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* =============== Daily View =============== */
function DailyView() {
  const selectedDate = useNavStore((s) => s.selectedDate);
  const setCalendarSubView = useNavStore((s) => s.setCalendarSubView);
  const getNodesByDate = useNodeStore((s) => s.getNodesByDate);
  const getColor = useCategoryStore((s) => s.getColor);
  const language = usePrefStore((s) => s.language);
  const { t } = useLocale();
  const [detailNodeId, setDetailNodeId] = useState<string | null>(null);

  const dateLocale = language === 'ko' ? koLocale : undefined;
  const dateStr = format(selectedDate, 'M월 d일 EEEE', { locale: dateLocale });
  const events = getNodesByDate(selectedDate);

  // Build 30-min slots from 06:00 to 22:00
  const hours = Array.from({ length: 17 }, (_, i) => i + 6); // 6..22

  const handleAddEvent = () => {
    toast.info(t.todo.phase2Note);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => setCalendarSubView('monthly')}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <h2 className="text-sm font-semibold">{dateStr}</h2>
        </div>
        <Button variant="outline" size="sm" onClick={handleAddEvent}>
          <Plus className="mr-1.5 size-3.5" />
          {t.calendar.addEvent}
        </Button>
      </div>

      {/* Timeline */}
      <div className="overflow-y-auto rounded-lg border max-h-[calc(100dvh-180px)]">
        <div className="relative">
          {hours.map((hour) => (
            <div
              key={hour}
              className="flex border-b last:border-b-0"
            >
              {/* Time label */}
              <div className="w-14 shrink-0 border-r py-1 pr-2 text-right text-[10px] text-muted-foreground">
                {hour.toString().padStart(2, '0')}:00
              </div>
              {/* Slot area */}
              <div className="relative h-12 flex-1">
                {/* Half-hour line */}
                <div className="absolute inset-x-0 top-1/2 border-b border-dashed border-border/50" />
              </div>
            </div>
          ))}

          {/* Event blocks positioned absolutely */}
          <div className="pointer-events-none absolute inset-0 ml-14">
            {events.map((evt) => {
              if (!evt.schedule) return null;
              const startH =
                evt.schedule.startAt.getHours() +
                evt.schedule.startAt.getMinutes() / 60;
              const endH =
                evt.schedule.endAt.getHours() +
                evt.schedule.endAt.getMinutes() / 60;
              const topPx = ((Math.max(startH, 6) - 6) / 16) * (17 * 48); // 17 hours * 48px per hour
              const heightPx = ((Math.min(endH, 22) - Math.max(startH, 6)) / 16) * (17 * 48);
              const color = getColor(evt.schedule.category, document.documentElement.classList.contains('dark'));
              const isCompleted = evt.status === 'completed';
              const startStr = format(evt.schedule.startAt, 'HH:mm');
              const endStr = format(evt.schedule.endAt, 'HH:mm');

              return (
                <div
                  key={evt.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setDetailNodeId(evt.id)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    setDetailNodeId(evt.id);
                  }}
                  className={cn(
                    'pointer-events-auto absolute left-1 right-1 cursor-pointer overflow-hidden rounded-md border-l-4 bg-card px-2 py-1.5 shadow-sm transition-opacity hover:brightness-95',
                    isCompleted && 'opacity-50'
                  )}
                  style={{
                    top: `${topPx}px`,
                    height: `${Math.max(heightPx, 24)}px`,
                    borderLeftColor: color,
                  }}
                >
                  <p className={cn('text-xs font-medium leading-tight', isCompleted && 'line-through')}>
                    {evt.title}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {startStr} - {endStr}
                  </p>
                  {evt.schedule.location && (
                    <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Pin className="size-2.5" />
                      {evt.schedule.location}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <NodeDetailSheet
        nodeId={detailNodeId}
        open={detailNodeId !== null}
        onOpenChange={(o) => !o && setDetailNodeId(null)}
      />
    </div>
  );
}