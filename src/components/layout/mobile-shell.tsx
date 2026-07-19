'use client';

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

const tabs: { view: AppView; icon: typeof LayoutDashboard; labelKey: 'dashboard' | 'calendar' | 'todo' | 'mandarat' | 'drafts' | 'settings' }[] = [
  { view: 'dashboard', icon: LayoutDashboard, labelKey: 'dashboard' },
  { view: 'calendar', icon: CalendarDays, labelKey: 'calendar' },
  { view: 'todo', icon: CheckSquare, labelKey: 'todo' },
];

function ViewSwitcher({ view }: { view: AppView }) {
  switch (view) {
    case 'dashboard':
      return <DashboardView />;
    case 'calendar':
      return <CalendarView />;
    case 'todo':
      return <TodoView />;
    case 'mandarat':
      return <MandaratView />;
    case 'drafts':
      return <DraftInbox />;
    case 'admin':
      return <AdminView />;
    case 'log':
      return <ActivityLogView />;
    case 'settings':
      return <SettingsView />;
    default:
      return <DashboardView />;
  }
}

export function MobileShell() {
  const mobileTab = useNavStore((s) => s.mobileTab);
  const setMobileTab = useNavStore((s) => s.setMobileTab);
  const { t } = useLocale();

  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* Content area */}
      <main className="flex-1 overflow-y-auto">
        <ViewSwitcher view={mobileTab} />
      </main>

      {/* Bottom tab bar */}
      <nav className="sticky bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm">
        <div className="flex h-14 items-center justify-around px-2">
          {tabs.map(({ view, icon: Icon, labelKey }) => (
            <button
              key={view}
              onClick={() => setMobileTab(view)}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 rounded-lg px-3 py-1.5 text-[10px] font-medium transition-colors',
                mobileTab === view
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="size-5" />
              <span>{t.nav[labelKey]}</span>
            </button>
          ))}

          {/* More button */}
          <Sheet>
            <SheetTrigger asChild>
              <button
                className={cn(
                  'flex flex-col items-center justify-center gap-0.5 rounded-lg px-3 py-1.5 text-[10px] font-medium transition-colors',
                  'text-muted-foreground hover:text-foreground'
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
                  onClick={() => {
                    setMobileTab('mandarat');
                  }}
                >
                  <LayoutGrid className="size-5 text-muted-foreground" />
                  {t.nav.mandarat}
                </Button>
                <Button
                  variant="ghost"
                  className="justify-start gap-3"
                  onClick={() => {
                    setMobileTab('drafts');
                  }}
                >
                  <FileText className="size-5 text-muted-foreground" />
                  {t.nav.drafts}
                </Button>
                <Button
                  variant="ghost"
                  className="justify-start gap-3"
                  onClick={() => {
                    setMobileTab('settings');
                  }}
                >
                  <Settings className="size-5 text-muted-foreground" />
                  {t.nav.settings}
                </Button>
                <Button
                  variant="ghost"
                  className="justify-start gap-3"
                  onClick={() => {
                    setMobileTab('log');
                  }}
                >
                  <ScrollText className="size-5 text-muted-foreground" />
                  {t.log.title}
                </Button>
                <Button
                  variant="ghost"
                  className="justify-start gap-3"
                  onClick={() => {
                    setMobileTab('admin');
                  }}
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