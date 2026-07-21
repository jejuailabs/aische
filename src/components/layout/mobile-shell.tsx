'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useNavStore } from '@/lib/store';
import { useLocale } from '@/hooks/use-locale';
import {
  LayoutDashboard,
  CalendarDays,
  CheckSquare,
  MoreHorizontal,
  LayoutGrid,
  Settings,
  FileText,
  ScrollText,
  Shield,
  Users,
  Database,
  Wallet,
  FileBarChart,
  ChevronLeft,
  ChevronRight,
  BookOpen,
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import type { AppView } from '@/lib/types';
import { DraftInbox } from '@/components/chat/draft-inbox';
import { CalendarView } from '@/components/calendar/calendar-view';
import { TodoView } from '@/components/todo/todo-view';
import { DashboardView } from '@/components/dashboard/dashboard-view';
import { MandaratView } from '@/components/mandarat/mandarat-view';
import { SettingsView } from '@/components/settings/settings-view';
import { AdminView } from '@/components/admin/admin-view';
import { ActivityLogView } from '@/components/log/activity-log-view';
import { PeopleView } from '@/components/people/people-view';
import { DataView } from '@/components/data/data-view';
import { FixedCostView } from '@/components/fixedcost/fixed-cost-view';
import { ProjectReportView } from '@/components/report/project-report-view';
import { DiaryView } from '@/components/diary/diary-view';
import { ChatPanel } from '@/components/chat/chat-panel';

const SWIPE_VIEWS = ['todo', 'calendar', 'mandarat'] as const;
type SwipeView = (typeof SWIPE_VIEWS)[number];

const swipeLabels: Record<SwipeView, { icon: typeof CalendarDays; labelKey: string }> = {
  todo: { icon: CheckSquare, labelKey: 'todo' },
  calendar: { icon: CalendarDays, labelKey: 'calendar' },
  mandarat: { icon: LayoutGrid, labelKey: 'mandarat' },
};

function SwipeContent({ view }: { view: SwipeView }) {
  switch (view) {
    case 'todo':
      return <TodoView />;
    case 'calendar':
      return <CalendarView />;
    case 'mandarat':
      return <MandaratView />;
  }
}

function OtherContent({ view }: { view: AppView }) {
  switch (view) {
    case 'dashboard':
      return <DashboardView />;
    case 'drafts':
      return <DraftInbox />;
    case 'admin':
      return <AdminView />;
    case 'log':
      return <ActivityLogView />;
    case 'people':
      return <PeopleView />;
    case 'data':
      return <DataView />;
    case 'fixedcost':
      return <FixedCostView />;
    case 'report':
      return <ProjectReportView />;
    case 'diary':
      return <DiaryView />;
    case 'settings':
      return <SettingsView />;
    default:
      return null;
  }
}

export function MobileShell() {
  const { t } = useLocale();

  const [swipeIndex, setSwipeIndex] = useState(1); // 0=todo, 1=calendar, 2=mandarat
  const [otherView, setOtherView] = useState<AppView | null>(null);

  // activeView를 단일 진실 원천으로 유지한다.
  // 모바일 자체 네비게이션도 setView를 호출하므로, 다른 화면(예: 관리자의
  // "데이터 관리 열기")에서 setView로 들어오는 요청과 상태가 어긋나지 않는다.
  const activeView = useNavStore((s) => s.activeView);
  const setView = useNavStore((s) => s.setView);
  useEffect(() => {
    if ((SWIPE_VIEWS as readonly string[]).includes(activeView)) {
      setSwipeIndex(SWIPE_VIEWS.indexOf(activeView as SwipeView));
      setOtherView(null);
    } else {
      setOtherView(activeView);
    }
  }, [activeView]);

  // Swipe handling
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const dx = e.changedTouches[0].clientX - touchStartX.current;
      const dy = e.changedTouches[0].clientY - touchStartY.current;
      if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;

      const next =
        dx > 0 && swipeIndex > 0
          ? swipeIndex - 1
          : dx < 0 && swipeIndex < SWIPE_VIEWS.length - 1
            ? swipeIndex + 1
            : swipeIndex;
      if (next !== swipeIndex) setView(SWIPE_VIEWS[next]);
    },
    [swipeIndex, setView],
  );

  const currentSwipeView = SWIPE_VIEWS[swipeIndex];

  const handleNavSwipe = (idx: number) => setView(SWIPE_VIEWS[idx]);
  const handleOtherNav = (view: AppView) => setView(view);

  const isSwipeMode = otherView === null;
  const showView = isSwipeMode ? currentSwipeView : otherView;

  return (
    // overflow-x-hidden: 어떤 자식이든 가로로 넘치면 화면 전체가 옆으로 밀리고,
    // 그러면 오른쪽 끝에 있는 것(전송 버튼, 모드 토글)이 잘려 보인다.
    // 원인을 하나하나 쫓는 것보다 여기서 한 번 막는 게 확실하다.
    <div className="flex h-dvh flex-col overflow-x-hidden bg-background">
      {/* Swipe indicator dots */}
      {isSwipeMode && (
        <div className="flex items-center justify-center gap-3 border-b bg-background/95 px-4 py-2 backdrop-blur-sm">
          {SWIPE_VIEWS.map((v, i) => {
            const info = swipeLabels[v];
            const Icon = info.icon;
            const active = i === swipeIndex;
            return (
              <button
                key={v}
                onClick={() => handleNavSwipe(i)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all',
                  active
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground',
                )}
              >
                <Icon className="size-3.5" />
                {(t.nav as any)[info.labelKey]}
              </button>
            );
          })}
        </div>
      )}

      {/* Content area */}
      <main
        className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden"
        onTouchStart={isSwipeMode ? handleTouchStart : undefined}
        onTouchEnd={isSwipeMode ? handleTouchEnd : undefined}
      >
        {isSwipeMode ? (
          <SwipeContent view={currentSwipeView} />
        ) : (
          <OtherContent view={otherView} />
        )}
      </main>

      {/* AI 채팅 — 입력 바만 자리를 차지하고, 메시지 시트는 본문 위로 겹쳐 올라온다 */}
      <ChatPanel />

      {/* Bottom tab bar */}
      <nav className="sticky bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm">
        <div className="flex h-14 items-center justify-around px-2">
          {/* Calendar (main) */}
          <button
            onClick={() => setView('calendar')}
            className={cn(
              'flex flex-col items-center justify-center gap-0.5 rounded-lg px-3 py-1.5 text-[10px] font-medium transition-colors',
              isSwipeMode
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <CalendarDays className="size-5" />
            <span>{t.nav.calendar}</span>
          </button>

          {/* Dashboard */}
          <button
            onClick={() => handleOtherNav('dashboard')}
            className={cn(
              'flex flex-col items-center justify-center gap-0.5 rounded-lg px-3 py-1.5 text-[10px] font-medium transition-colors',
              otherView === 'dashboard'
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <LayoutDashboard className="size-5" />
            <span>{t.nav.dashboard}</span>
          </button>

          {/* More button */}
          <Sheet>
            <SheetTrigger asChild>
              <button
                className={cn(
                  'flex flex-col items-center justify-center gap-0.5 rounded-lg px-3 py-1.5 text-[10px] font-medium transition-colors',
                  'text-muted-foreground hover:text-foreground',
                )}
              >
                <MoreHorizontal className="size-5" />
                <span>{t.nav.more}</span>
              </button>
            </SheetTrigger>
            <SheetContent side="bottom" className="max-h-[60vh] rounded-t-2xl">
              <SheetHeader>
                <SheetTitle>{t.nav.more}</SheetTitle>
              </SheetHeader>
              <div className="flex flex-col gap-1 px-4 pb-8">
                <Button
                  variant="ghost"
                  className="justify-start gap-3"
                  onClick={() => handleOtherNav('drafts')}
                >
                  <FileText className="size-5 text-muted-foreground" />
                  {t.nav.drafts}
                </Button>
                <Button
                  variant="ghost"
                  className="justify-start gap-3"
                  onClick={() => handleOtherNav('fixedcost')}
                >
                  <Wallet className="size-5 text-muted-foreground" />
                  {t.nav.fixedCost}
                </Button>
                <Button
                  variant="ghost"
                  className="justify-start gap-3"
                  onClick={() => handleOtherNav('report')}
                >
                  <FileBarChart className="size-5 text-muted-foreground" />
                  {t.nav.report}
                </Button>
                <Button
                  variant="ghost"
                  className="justify-start gap-3"
                  onClick={() => handleOtherNav('diary')}
                >
                  <BookOpen className="size-5 text-muted-foreground" />
                  {t.nav.diary}
                </Button>
                <Button
                  variant="ghost"
                  className="justify-start gap-3"
                  onClick={() => handleOtherNav('people')}
                >
                  <Users className="size-5 text-muted-foreground" />
                  {t.nav.people}
                </Button>
                <Button
                  variant="ghost"
                  className="justify-start gap-3"
                  onClick={() => handleOtherNav('data')}
                >
                  <Database className="size-5 text-muted-foreground" />
                  {t.nav.data}
                </Button>
                <Button
                  variant="ghost"
                  className="justify-start gap-3"
                  onClick={() => handleOtherNav('settings')}
                >
                  <Settings className="size-5 text-muted-foreground" />
                  {t.nav.settings}
                </Button>
                <Button
                  variant="ghost"
                  className="justify-start gap-3"
                  onClick={() => handleOtherNav('log')}
                >
                  <ScrollText className="size-5 text-muted-foreground" />
                  {t.log.title}
                </Button>
                <Button
                  variant="ghost"
                  className="justify-start gap-3"
                  onClick={() => handleOtherNav('admin')}
                >
                  <Shield className="size-5 text-muted-foreground" />
                  {t.admin.title}
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </div>
  );
}
