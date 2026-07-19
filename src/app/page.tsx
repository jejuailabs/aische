'use client';

import { useEffect } from 'react';
import {
  useAuthStore,
  useNodeStore,
  useCategoryStore,
  useProjectStore,
  useLogStore,
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
  const addLog = useLogStore((s) => s.addLog);

  useEffect(() => {
    // Load demo data
    const nodes = generateDemoNodes();
    setNodes(nodes);
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

    // Seed demo activity logs
    const demoLogs = [
      { nodeId: 'evt-1', action: 'create' as const, note: '팀 미팅 생성' },
      { nodeId: 'todo-1', action: 'update' as const, note: 'Q3 보고서 진행중으로 변경' },
      { nodeId: 'evt-3', action: 'complete' as const, note: '헬스장 완료' },
      { nodeId: 'sub-1', action: 'create' as const, note: '프로젝트 A 성공적 론칭 목표 추가' },
      { nodeId: 'todo-6', action: 'complete' as const, note: 'UI 디자인 피드백 반영 완료' },
      { nodeId: 'evt-7', action: 'create' as const, note: '기술 세미나 일정 추가' },
      { nodeId: 'sub-3', action: 'update' as const, note: '주 3회 운동 루틴 유지 진행률 70%' },
      { nodeId: 'evt-9', action: 'complete' as const, note: '코드 리뷰 완료' },
    ];

    // Stagger log timestamps
    const now = Date.now();
    demoLogs.forEach((log, i) => {
      const node = nodes.find((n) => n.id === log.nodeId);
      if (!node) return;
      // Set timestamp in the past
      const ts = new Date(now - (demoLogs.length - i) * 3600000 * 2);
      const entry = {
        nodeId: log.nodeId,
        workspaceId: node.workspaceId,
        action: log.action,
        before: log.action === 'update' ? { status: 'scheduled' } : null,
        after: log.action === 'update' ? { status: 'in_progress' } : null,
        actor: 'demo-user',
        timestamp: ts,
        id: `log-${i}`,
      };
      addLog(entry);
    });
  }, [setNodes, setCategories, setProjects, addLog]);

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