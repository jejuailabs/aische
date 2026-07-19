'use client';

import { useEffect } from 'react';
import {
  useAuthStore,
  useNodeStore,
  useCategoryStore,
  useProjectStore,
} from '@/lib/store';
import { generateDemoNodes, generateDemoCategories } from '@/lib/services';
import { LoginScreen } from '@/components/auth/login-screen';
import { PcDashboard } from '@/components/layout/pc-dashboard';
import { MobileShell } from '@/components/layout/mobile-shell';
import { ChatPanel } from '@/components/chat/chat-panel';
import { Toaster } from '@/components/ui/sonner';

export default function Home() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const setNodes = useNodeStore((s) => s.setNodes);
  const setCategories = useCategoryStore((s) => s.setCategories);
  const setProjects = useProjectStore((s) => s.setProjects);

  useEffect(() => {
    // Load demo data
    setNodes(generateDemoNodes());
    setCategories(generateDemoCategories());
    setProjects([
      {
        id: 'proj-1',
        title: '2026 상반기 목표 달성',
        progress: 35,
        memberCount: 1,
        updatedAt: new Date(),
      },
      {
        id: 'proj-2',
        title: '건강 관리 루틴',
        progress: 60,
        memberCount: 1,
        updatedAt: new Date(),
      },
    ]);
  }, [setNodes, setCategories, setProjects]);

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  return (
    <>
      <div className="hidden lg:block">
        <PcDashboard />
      </div>
      <div className="lg:hidden">
        <MobileShell />
      </div>
      <Toaster />
      <ChatPanel />
    </>
  );
}