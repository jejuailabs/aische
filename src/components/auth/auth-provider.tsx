'use client';

import { useEffect, useRef } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import {
  useAuthStore,
  useNodeStore,
  useCategoryStore,
  useProjectStore,
  useLogStore,
  usePrefStore,
} from '@/lib/store';
import {
  getOrCreateUser,
  fetchAllNodes,
  fetchAllCategories,
  fetchAllProjects,
  fetchRecentLogs,
  saveAllNodes,
  saveAllCategories,
  saveAllProjects,
  saveAllLogs,
} from '@/lib/firestore';
import {
  generateDemoNodes,
  generateDemoCategories,
} from '@/lib/services';
import type { UserProfile, ProjectSummary, LogEntry } from '@/lib/types';

/**
 * Firebase Auth 상태를 감시하고, 로그인 시 Firestore에서 데이터를 로드.
 * 신규 유저면 데모 데이터를 시드합니다.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const login = useAuthStore((s) => s.login);
  const logout = useAuthStore((s) => s.logout);
  const setLoading = useAuthStore((s) => s.setLoading);
  const setNodes = useNodeStore((s) => s.setNodes);
  const setCategories = useCategoryStore((s) => s.setCategories);
  const setProjects = useProjectStore((s) => s.setProjects);
  const addLog = useLogStore((s) => s.addLog);
  const setLanguage = usePrefStore((s) => s.setLanguage);
  const setHomeMode = usePrefStore((s) => s.setHomeMode);

  // 중복 시드 방지
  const seeded = useRef(false);

  useEffect(() => {
    setLoading(true);

    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        logout();
        setNodes([]);
        setCategories([]);
        setProjects([]);
        return;
      }

      try {
        // 1. 유저 프로필 가져오기 (없으면 생성)
        const defaults: UserProfile = {
          uid: firebaseUser.uid,
          displayName: firebaseUser.displayName ?? '사용자',
          email: firebaseUser.email ?? '',
          photoURL: firebaseUser.photoURL ?? null,
          role: 'user',
          preferences: {
            theme: 'light',
            language: 'ko',
            homeMode: 'dashboard',
            avatarAssetRef: '',
            backgroundAssetRef: '',
            pcWorkspaceLayout: [],
          },
          createdAt: new Date(),
        };

        const profile = await getOrCreateUser(firebaseUser.uid, defaults);

        // Auth store 업데이트
        login(profile);

        // Pref store 동기화
        setLanguage(profile.preferences.language);
        setHomeMode(profile.preferences.homeMode);

        // 2. Firestore 데이터 로드
        const [nodes, categories, projects, logs] = await Promise.all([
          fetchAllNodes(firebaseUser.uid),
          fetchAllCategories(firebaseUser.uid),
          fetchAllProjects(firebaseUser.uid),
          fetchRecentLogs(firebaseUser.uid),
        ]);

        // 3. 신규 유저 → 데모 데이터 시드
        if (nodes.length === 0 && !seeded.current) {
          seeded.current = true;
          const demoNodes = generateDemoNodes();
          const demoCats = generateDemoCategories();
          const demoProjects: ProjectSummary[] = [
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
          ];

          // 데모 로그
          const now = Date.now();
          const demoLogDefs = [
            { nodeId: 'evt-1', action: 'create' as const },
            { nodeId: 'todo-1', action: 'update' as const },
            { nodeId: 'evt-3', action: 'complete' as const },
            { nodeId: 'sub-1', action: 'create' as const },
            { nodeId: 'todo-6', action: 'complete' as const },
            { nodeId: 'evt-7', action: 'create' as const },
            { nodeId: 'sub-3', action: 'update' as const },
            { nodeId: 'evt-9', action: 'complete' as const },
          ];
          const demoLogs: LogEntry[] = demoLogDefs.map((l, i) => {
            const node = demoNodes.find((n) => n.id === l.nodeId);
            return {
              id: `log-${i}`,
              nodeId: l.nodeId,
              workspaceId: node?.workspaceId ?? 'demo-workspace',
              action: l.action,
              before: l.action === 'update' ? { status: 'scheduled' } : null,
              after: l.action === 'update' ? { status: 'in_progress' } : null,
              actor: firebaseUser.uid,
              timestamp: new Date(now - (demoLogDefs.length - i) * 3600000 * 2),
            };
          });

          // Firestore에 저장 (병렬)
          await Promise.all([
            saveAllNodes(firebaseUser.uid, demoNodes),
            saveAllCategories(firebaseUser.uid, demoCats),
            saveAllProjects(firebaseUser.uid, demoProjects),
            saveAllLogs(firebaseUser.uid, demoLogs),
          ]);

          // Zustand에 반영
          setNodes(demoNodes);
          setCategories(demoCats);
          setProjects(demoProjects);
          demoLogs.forEach((log) => addLog(log));
        } else {
          // 기존 유저 — Firestore 데이터를 Zustand에 반영
          setNodes(nodes);
          setCategories(categories);
          setProjects(projects);
          logs.forEach((log) => addLog(log));
        }
      } catch (err) {
        console.error('[AuthProvider] 데이터 로드 실패:', err);
        logout();
      }
    });

    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <>{children}</>;
}
