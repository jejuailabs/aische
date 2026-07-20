'use client';

import { cn } from '@/lib/utils';
import {
  useNavStore,
  useProjectStore,
  useAuthStore,
} from '@/lib/store';
import { useLocale } from '@/hooks/use-locale';
import {
  Leaf,
  CalendarDays,
  CheckSquare,
  LayoutGrid,
  LayoutDashboard,
  Settings,
  Inbox,
  FileText,
  Shield,
  ScrollText,
  Users,
  Database,
  Wallet,
  FileBarChart,
  BookOpen,
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ThemeToggle } from './theme-toggle';
import { LanguageSwitcher } from './language-switcher';
import { ViewHeader } from '@/components/shared/view-header';
import { Button } from '@/components/ui/button';
import type { AppView } from '@/lib/types';
import { CalendarView } from '@/components/calendar/calendar-view';
import { TodoView } from '@/components/todo/todo-view';
import { DashboardView } from '@/components/dashboard/dashboard-view';
import { MandaratView } from '@/components/mandarat/mandarat-view';
import { SettingsView } from '@/components/settings/settings-view';
import { DraftInbox } from '@/components/chat/draft-inbox';
import { AdminView } from '@/components/admin/admin-view';
import { ActivityLogView } from '@/components/log/activity-log-view';
import { PeopleView } from '@/components/people/people-view';
import { DataView } from '@/components/data/data-view';
import { FixedCostView } from '@/components/fixedcost/fixed-cost-view';
import { ProjectReportView } from '@/components/report/project-report-view';
import { DiaryView } from '@/components/diary/diary-view';
import { ChatPanel } from '@/components/chat/chat-panel';
import { usePrefStore } from '@/lib/store';

const navItems: { view: AppView; icon: typeof CalendarDays; labelKey: 'calendar' | 'todo' | 'mandarat' | 'dashboard' | 'drafts' | 'settings' | 'people' | 'fixedCost' | 'report' | 'diary' }[] = [
  { view: 'calendar', icon: CalendarDays, labelKey: 'calendar' },
  { view: 'todo', icon: CheckSquare, labelKey: 'todo' },
  { view: 'mandarat', icon: LayoutGrid, labelKey: 'mandarat' },
  { view: 'dashboard', icon: LayoutDashboard, labelKey: 'dashboard' },
  { view: 'fixedcost', icon: Wallet, labelKey: 'fixedCost' },
  { view: 'people', icon: Users, labelKey: 'people' },
  { view: 'diary', icon: BookOpen, labelKey: 'diary' },
  { view: 'report', icon: FileBarChart, labelKey: 'report' },
  { view: 'drafts', icon: FileText, labelKey: 'drafts' },
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
      return <CalendarView />;
  }
}

export function PcDashboard() {
  const activeView = useNavStore((s) => s.activeView);
  const setView = useNavStore((s) => s.setView);
  const setSelectedProject = useNavStore((s) => s.setSelectedProject);
  const selectedProjectId = useNavStore((s) => s.selectedProjectId);
  const projects = useProjectStore((s) => s.projects);
  const user = useAuthStore((s) => s.user);
  const language = usePrefStore((s) => s.language);
  const { t } = useLocale();

  const viewTitleMap: Record<AppView, string> = {
    dashboard: t.nav.dashboard,
    calendar: t.nav.calendar,
    todo: t.nav.todo,
    mandarat: t.nav.mandarat,
    drafts: t.nav.drafts,
    settings: t.nav.settings,
    admin: t.admin.title,
    log: t.log.title,
    people: t.people.title,
    data: t.data.title,
    fixedcost: t.fixedCost.title,
    report: t.nav.report,
    diary: t.diary.title,
  };

  const headerAction =
    activeView === 'calendar' ? (
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          useNavStore.getState().setSelectedDate(new Date());
          useNavStore.getState().setCalendarSubView('daily');
        }}
      >
        {t.calendar.today}
      </Button>
    ) : undefined;

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      {/* Left Sidebar */}
      <aside className="hidden w-56 shrink-0 flex-col border-r lg:flex">
        {/* Logo */}
        <div className="flex h-12 items-center gap-2 px-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-teal-500 to-emerald-600">
            <Leaf className="size-4 text-white" />
          </div>
          <span className="text-base font-bold tracking-tight">
            <span className="bg-gradient-to-r from-teal-600 to-emerald-600 bg-clip-text text-transparent">
              GoalFlow
            </span>
          </span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-0.5 px-2 pt-2">
          {navItems.map(({ view, icon: Icon, labelKey }) => (
            <button
              key={view}
              onClick={() => setView(view)}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                activeView === view
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <Icon className="size-4" />
              {t.nav[labelKey]}
            </button>
          ))}
        </nav>

        {/* Bottom section: Settings, Theme, Language, User */}
        <div className="space-y-1 border-t p-2">
          <button
            onClick={() => setView('log')}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              activeView === 'log'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <ScrollText className="size-4" />
            {t.log.title}
          </button>
          <button
            onClick={() => setView('data')}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              activeView === 'data'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <Database className="size-4" />
            {t.nav.data}
          </button>
          <button
            onClick={() => setView('admin')}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              activeView === 'admin'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <Shield className="size-4" />
            {t.admin.title}
          </button>
          <button
            onClick={() => setView('settings')}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              activeView === 'settings'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <Settings className="size-4" />
            {t.nav.settings}
          </button>
          <div className="flex items-center justify-between px-2 py-1">
            <ThemeToggle />
            <LanguageSwitcher />
          </div>
          {user && (
            <div className="flex items-center gap-2 px-2 py-1.5">
              <Avatar className="size-7">
                <AvatarFallback className="bg-primary/10 text-xs text-primary">
                  {user.displayName.charAt(0)}
                </AvatarFallback>
              </Avatar>
              <span className="truncate text-xs font-medium">{user.displayName}</span>
            </div>
          )}
        </div>
      </aside>

      {/* Central Workspace */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center border-b px-4">
          <ViewHeader
            title={viewTitleMap[activeView]}
            action={headerAction}
          />
        </header>
        <div className="flex-1 overflow-y-auto p-4 lg:p-6">
          <ViewSwitcher view={activeView} />
        </div>
      </main>

      {/* Right Sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-l xl:flex">
        <div className="flex h-12 items-center px-4">
          <h2 className="text-sm font-semibold">{t.nav.projects}</h2>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          <div className="space-y-1">
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => setSelectedProject(project.id)}
                className={cn(
                  'w-full rounded-lg p-3 text-left transition-colors',
                  selectedProjectId === project.id
                    ? 'bg-primary/10'
                    : 'hover:bg-muted'
                )}
              >
                <p className="truncate text-sm font-medium">{project.title}</p>
                <div className="mt-2 flex items-center gap-2">
                  <Progress value={project.progress} className="h-1.5 flex-1" />
                  <span className="text-xs text-muted-foreground">
                    {project.progress}%
                  </span>
                </div>
              </button>
            ))}
          </div>

          {/* Unsorted */}
          <button
            onClick={() => setSelectedProject('unsorted')}
            className={cn(
              'mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
              selectedProjectId === 'unsorted'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <Inbox className="size-4" />
            {t.dashboard.unsortedLabel}
          </button>
        </div>
      </aside>

      {/* AI 채팅 — 드래그·리사이즈 되는 독립 창 (레이아웃 공간 차지 안 함) */}
      <ChatPanel variant="floating" />
    </div>
  );
}