'use client';

import { useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { getClientAuth } from '@/lib/firebase';
import {
  useAuthStore,
  useNodeStore,
  useCategoryStore,
  useProjectStore,
  useLogStore,
  usePrefStore,
  usePersonStore,
  useOrgStore,
  useCaptureStore,
  useTopicStore,
  usePaymentMethodStore,
  useFixedCostStore,
  useDiaryStore,
  useRelationshipStore,
} from '@/lib/store';
import {
  getOrCreateUser,
  fetchAllNodes,
  fetchAllCategories,
  fetchAllProjects,
  fetchRecentLogs,
  fetchAllPeople,
  fetchAllOrganizations,
  fetchRecentCaptures,
  fetchAllTopics,
  fetchAllPaymentMethods,
  fetchAllFixedCosts,
  fetchAllDiaryEntries,
  fetchAllRelationshipLogs,
  saveAllCategories,
} from '@/lib/firestore';
import { generateDefaultCategories } from '@/lib/services';
import type { UserProfile } from '@/lib/types';

/**
 * Firebase Auth 상태를 감시하고, 로그인 시 Firestore에서 데이터를 로드.
 * 카테고리가 없는 신규 유저에게만 기본 카테고리를 생성합니다.
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
  const setPeople = usePersonStore((s) => s.setPeople);
  const setOrgs = useOrgStore((s) => s.setOrgs);
  const setCaptures = useCaptureStore((s) => s.setCaptures);
  const setTopics = useTopicStore((s) => s.setTopics);
  const setMethods = usePaymentMethodStore((s) => s.setMethods);
  const setCosts = useFixedCostStore((s) => s.setCosts);
  const setEntries = useDiaryStore((s) => s.setEntries);
  const setLogs = useRelationshipStore((s) => s.setLogs);

  useEffect(() => {
    setLoading(true);

    const unsub = onAuthStateChanged(getClientAuth(), async (firebaseUser) => {
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
            homeMode: 'calendar',
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

        // 2. Firestore 데이터 로드 (모든 정보 레이어)
        const [
          nodes,
          categories,
          projects,
          logs,
          peopleList,
          orgList,
          captures,
          topicList,
          methodList,
          costList,
          diaryList,
          relLogList,
        ] = await Promise.all([
          fetchAllNodes(firebaseUser.uid),
          fetchAllCategories(firebaseUser.uid),
          fetchAllProjects(firebaseUser.uid),
          fetchRecentLogs(firebaseUser.uid),
          fetchAllPeople(firebaseUser.uid),
          fetchAllOrganizations(firebaseUser.uid),
          fetchRecentCaptures(firebaseUser.uid),
          fetchAllTopics(firebaseUser.uid),
          fetchAllPaymentMethods(firebaseUser.uid),
          fetchAllFixedCosts(firebaseUser.uid),
          fetchAllDiaryEntries(firebaseUser.uid),
          fetchAllRelationshipLogs(firebaseUser.uid),
        ]);

        // 카테고리가 없으면 기본 카테고리 생성 (AI 분류에 필요)
        let cats = categories;
        if (cats.length === 0) {
          cats = generateDefaultCategories();
          await saveAllCategories(firebaseUser.uid, cats);
        }

        // Firestore 데이터를 Zustand에 반영
        setNodes(nodes);
        setCategories(cats);
        setProjects(projects);
        setPeople(peopleList);
        setOrgs(orgList);
        setCaptures(captures);
        setTopics(topicList);
        setMethods(methodList);
        setCosts(costList);
        setEntries(diaryList);
        setLogs(relLogList);
        logs.forEach((log) => addLog(log));
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
