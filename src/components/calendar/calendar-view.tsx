'use client';

import { useState, useMemo, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { useNavStore, useNodeStore, useCategoryStore, usePrefStore } from '@/lib/store';
import { useLocale } from '@/hooks/use-locale';
import { format } from 'date-fns';
import { ko as koLocale } from 'date-fns/locale';
import {
  ChevronLeft,
  ChevronRight,
  Pin,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import type { Node } from '@/lib/types';

// Month cells render a miniature day timeline, so the cell height has to be
// large enough for a short event to stay legible: at 14px/hour a 1-hour block
// is 14px tall, which fits a 10px label.
const DAY_START_HOUR = 6;
const DAY_END_HOUR = 22;
const HOUR_PX = 14;
const TIMELINE_PX = (DAY_END_HOUR - DAY_START_HOUR) * HOUR_PX;
const MIN_BAR_PX = 14;
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

  const dateLocale = language === 'ko' ? koLocale : undefined;
  const currentMonth = addMonths(new Date(), monthOffset);

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
      top: `${(startH - DAY_START_HOUR) * HOUR_PX}px`,
      height: `${Math.max((endH - startH) * HOUR_PX, MIN_BAR_PX)}px`,
      left: `${lane * laneWidth}%`,
      width: `calc(${laneWidth}% - 2px)`,
    };
  };

  if (calendarSubView === 'daily') {
    return <DailyView />;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Category legend chips */}
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

      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => setMonthOffset((p) => p - 1)}
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
            onClick={() => setMonthOffset((p) => p + 1)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setMonthOffset(0);
            setSelectedDate(new Date());
          }}
        >
          {t.calendar.today}
        </Button>
      </div>

      {/* Calendar grid */}
      <div className="overflow-hidden rounded-lg border">
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
          {calendarDays.map((day, idx) => {
            const isCurrentMonth =
              day.getMonth() === currentMonth.getMonth();
            const isToday = isSameDay(day, new Date());
            const events = getEventsForDay(day);
            const { placed, laneCount } = assignLanes(events);

            return (
              <button
                key={idx}
                onClick={() => {
                  setSelectedDate(day);
                  setCalendarSubView('daily');
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
                {/* Mini vertical timeline for events (06:00-22:00) */}
                <div
                  className="relative mt-0.5 w-full"
                  style={{ height: `${TIMELINE_PX}px` }}
                >
                  {/* Hour guides make an event's time position readable at a glance */}
                  {GUIDE_HOURS.map((hour) => (
                    <div
                      key={hour}
                      className="absolute inset-x-0 border-t border-dashed border-border/40"
                      style={{ top: `${(hour - DAY_START_HOUR) * HOUR_PX}px` }}
                    />
                  ))}
                  {placed.map(({ evt, lane }) => (
                    <div
                      key={evt.id}
                      title={evt.title}
                      className={cn(
                        'absolute overflow-hidden rounded-sm px-1 text-[10px] leading-[14px] text-white',
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
              </button>
            );
          })}
        </div>
      </div>
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
                  className={cn(
                    'pointer-events-auto absolute left-1 right-1 overflow-hidden rounded-md border-l-4 bg-card px-2 py-1.5 shadow-sm transition-opacity',
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
    </div>
  );
}