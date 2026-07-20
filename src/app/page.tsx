'use client';

import { useAuthStore } from '@/lib/store';
import { AuthProvider } from '@/components/auth/auth-provider';
import { LoginScreen } from '@/components/auth/login-screen';
import { PcDashboard } from '@/components/layout/pc-dashboard';
import { MobileShell } from '@/components/layout/mobile-shell';
import { ChatPanel } from '@/components/chat/chat-panel';
import { Toaster } from '@/components/ui/sonner';

function AppContent() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">로딩 중...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  return (
    <>
      {/* Desktop */}
      <div className="hidden lg:block">
        <PcDashboard />
      </div>
      {/* Mobile: shell includes swipeable views, chat bar is between content and nav */}
      <div className="lg:hidden">
        <MobileShell />
      </div>
      <Toaster />
    </>
  );
}

export default function Home() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
