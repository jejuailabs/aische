'use client';

import { useTheme } from 'next-themes';
import { usePrefStore, useAuthStore } from '@/lib/store';
import { useLocale } from '@/hooks/use-locale';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { User } from 'lucide-react';
import type { Language, HomeMode } from '@/lib/types';

export function SettingsView() {
  const { t } = useLocale();
  const { theme, setTheme } = useTheme();
  const language = usePrefStore((s) => s.language);
  const setLanguage = usePrefStore((s) => s.setLanguage);
  const homeMode = usePrefStore((s) => s.homeMode);
  const setHomeMode = usePrefStore((s) => s.setHomeMode);
  const user = useAuthStore((s) => s.user);

  const isDark = theme === 'dark';

  return (
    <div className="mx-auto max-w-xl space-y-4">
      {/* Theme */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">
            {t.settings.theme}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <Label className="text-sm">
              {isDark ? t.settings.darkMode : t.settings.lightMode}
            </Label>
            <Switch
              checked={isDark}
              onCheckedChange={(checked) =>
                setTheme(checked ? 'dark' : 'light')
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Language */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">
            {t.settings.language}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Select
            value={language}
            onValueChange={(v) => setLanguage(v as Language)}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ko">한국어</SelectItem>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Home Mode */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">
            {t.settings.homeMode}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Select
            value={homeMode}
            onValueChange={(v) => setHomeMode(v as HomeMode)}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="calendar">{t.nav.calendar}</SelectItem>
              <SelectItem value="dashboard">{t.nav.dashboard}</SelectItem>
              <SelectItem value="mandarat">{t.nav.mandarat}</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Profile */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">
            {t.nav.profile}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {user ? (
            <>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                  <User className="size-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium">{user.displayName}</p>
                  <p className="text-xs text-muted-foreground">{user.email}</p>
                </div>
              </div>
              <Separator />
              <div className="grid gap-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t.nav.name}</span>
                  <span>{user.displayName}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t.nav.email}</span>
                  <span className="text-right">{user.email}</span>
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t.common.noData}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}