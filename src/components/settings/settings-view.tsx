'use client';

import { useTheme } from 'next-themes';
import { usePrefStore, useAuthStore } from '@/lib/store';
import { useLocale } from '@/hooks/use-locale';
import {
  Card, CardContent, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { User, Bell, Palette, Link2, Shield, LogOut } from 'lucide-react';
import { NotificationSettings } from './notification-settings';
import { signOut } from 'firebase/auth';
import { getClientAuth } from '@/lib/firebase';
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
    <div className="mx-auto max-w-2xl">
      <Tabs defaultValue="general" className="w-full">
        <TabsList className="w-full grid grid-cols-4 mb-4">
          <TabsTrigger value="general" className="gap-1.5 text-xs">
            <Palette className="size-3" />
            <span className="hidden sm:inline">{t.settings.title}</span>
          </TabsTrigger>
          <TabsTrigger value="notifications" className="gap-1.5 text-xs">
            <Bell className="size-3" />
            <span className="hidden sm:inline">{t.notification.title}</span>
          </TabsTrigger>
          <TabsTrigger value="integrations" className="gap-1.5 text-xs">
            <Link2 className="size-3" />
            <span className="hidden sm:inline">연동</span>
          </TabsTrigger>
          <TabsTrigger value="account" className="gap-1.5 text-xs">
            <Shield className="size-3" />
            <span className="hidden sm:inline">{t.nav.profile}</span>
          </TabsTrigger>
        </TabsList>

        {/* General Settings */}
        <TabsContent value="general" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">{t.settings.theme}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <Label className="text-sm">{isDark ? t.settings.darkMode : t.settings.lightMode}</Label>
                <Switch checked={isDark} onCheckedChange={(c) => setTheme(c ? 'dark' : 'light')} />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">{t.settings.language}</CardTitle>
            </CardHeader>
            <CardContent>
              <Select value={language} onValueChange={(v) => setLanguage(v as Language)}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ko">한국어</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">{t.settings.homeMode}</CardTitle>
            </CardHeader>
            <CardContent>
              <Select value={homeMode} onValueChange={(v) => setHomeMode(v as HomeMode)}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="calendar">{t.nav.calendar}</SelectItem>
                  <SelectItem value="dashboard">{t.nav.dashboard}</SelectItem>
                  <SelectItem value="mandarat">{t.nav.mandarat}</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notifications */}
        <TabsContent value="notifications">
          <NotificationSettings />
        </TabsContent>

        {/* Integrations (Phase 5 demo) */}
        <TabsContent value="integrations" className="space-y-4">
          <IntegrationsSection />
        </TabsContent>

        {/* Account */}
        <TabsContent value="account">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">{t.nav.profile}</CardTitle>
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
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">UID</span>
                      <span className="text-xs font-mono text-muted-foreground">{user.uid}</span>
                    </div>
                  </div>
                  <Separator />
                  <Button
                    variant="destructive"
                    size="sm"
                    className="w-full gap-2"
                    onClick={() => signOut(getClientAuth())}
                  >
                    <LogOut className="size-4" />
                    로그아웃
                  </Button>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{t.common.noData}</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Phase 5: External Integrations (Demo)
function IntegrationsSection() {
  const { t, locale } = useLocale();
  const [gmailConnected, setGmailConnected] = useState(false);
  const [kakaoConnected, setKakaoConnected] = useState(false);

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-red-100 dark:bg-red-950">
              <svg className="size-4 text-red-600" viewBox="0 0 24 24" fill="currentColor">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
            </div>
            <div>
              <CardTitle className="text-sm font-semibold">Gmail</CardTitle>
              <p className="text-xs text-muted-foreground">
                {locale === 'ko' ? '일정성 이메일에서 자동 추출' : 'Auto-extract from scheduling emails'}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {gmailConnected ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <div className="size-2 rounded-full bg-emerald-500" />
                <span>{locale === 'ko' ? '연결됨' : 'Connected'}</span>
              </div>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setGmailConnected(false)}>
                {locale === 'ko' ? '연동 해제' : 'Disconnect'}
              </Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => {
              // Demo: simulate OAuth
              setGmailConnected(true);
              toast.success(locale === 'ko' ? 'Gmail 연동이 완료되었습니다 (데모)' : 'Gmail connected (demo)');
            }}>
              <Link2 className="size-3" />
              {locale === 'ko' ? 'Google 계정으로 연동' : 'Connect with Google'}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-950">
              <svg className="size-4 text-amber-600" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 3C6.5 3 2 6.5 2 11c0 2.8 1.7 5.2 4.2 6.7L5 22l4.5-2.3c.8.2 1.7.3 2.5.3 5.5 0 10-3.5 10-8s-4.5-9-10-9z"/>
              </svg>
            </div>
            <div>
              <CardTitle className="text-sm font-semibold">
                {locale === 'ko' ? '카카오톡' : 'KakaoTalk'}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {locale === 'ko' ? '"공유하기"로 대화 텍스트 인입' : 'Share conversations via "Share"'}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {kakaoConnected ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <div className="size-2 rounded-full bg-emerald-500" />
                <span>{locale === 'ko' ? '연결됨' : 'Connected'}</span>
              </div>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setKakaoConnected(false)}>
                {locale === 'ko' ? '연동 해제' : 'Disconnect'}
              </Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => {
              setKakaoConnected(true);
              toast.success(locale === 'ko' ? '카카오톡 연동이 완료되었습니다 (데모)' : 'KakaoTalk connected (demo)');
            }}>
              <Link2 className="size-3" />
              {locale === 'ko' ? '카카오 계정으로 연동' : 'Connect with Kakao'}
            </Button>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed">
            {locale === 'ko'
              ? '카카오톡 대화방에서 "공유하기" → GoalFlow 선택으로 텍스트를 전달할 수 있습니다. 카카오톡 API로 대화 자동 수집은 정책상 불가하여 공유하기 방식만 지원합니다.'
              : 'Share text from KakaoTalk chat rooms via "Share" → GoalFlow. Auto-collection via KakaoTalk API is not supported due to policy restrictions.'}
          </p>
        </CardContent>
      </Card>
    </>
  );
}

import { useState } from 'react';
import { toast } from 'sonner';