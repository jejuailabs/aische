'use client';

import { useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { getClientAuth, googleProvider } from '@/lib/firebase';
import { motion } from 'framer-motion';
import { Chrome, Leaf, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { useLocale } from '@/hooks/use-locale';

export function LoginScreen() {
  const { t } = useLocale();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithPopup(getClientAuth(), googleProvider);
      // onAuthStateChanged in AuthProvider handles the rest
    } catch (err: any) {
      console.error('Google 로그인 실패:', err);
      // popup 닫기는 오류 아닌 정상 케이스
      if (err?.code === 'auth/popup-closed-by-user') {
        setLoading(false);
        return;
      }
      setError(t.auth.loginFailed ?? '로그인에 실패했습니다. 다시 시도해주세요.');
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background">
      {/* Animated gradient background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-1/4 -top-1/4 h-[600px] w-[600px] rounded-full bg-teal-400/20 blur-3xl animate-pulse" />
        <div className="absolute -bottom-1/4 -right-1/4 h-[500px] w-[500px] rounded-full bg-emerald-400/15 blur-3xl animate-pulse [animation-delay:1s]" />
        <div className="absolute left-1/2 top-1/3 h-[400px] w-[400px] -translate-x-1/2 rounded-full bg-teal-300/10 blur-3xl animate-pulse [animation-delay:2s]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="relative z-10 w-full max-w-sm px-4"
      >
        <Card className="border-border/50 shadow-xl backdrop-blur-sm">
          <CardHeader className="flex flex-col items-center gap-3 pb-2 pt-8">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.3 }}
              className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-500 to-emerald-600 shadow-lg shadow-teal-500/25"
            >
              <Leaf className="size-7 text-white" />
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.3 }}
              className="text-center"
            >
              <h1 className="text-2xl font-bold tracking-tight">
                <span className="bg-gradient-to-r from-teal-600 to-emerald-600 bg-clip-text text-transparent">
                  GoalFlow
                </span>
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {t.auth.subtitle}
              </p>
            </motion.div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 pb-8 pt-4">
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.3 }}
            >
              <Button
                onClick={handleLogin}
                disabled={loading}
                className="w-full gap-2 bg-gradient-to-r from-teal-600 to-emerald-600 text-white shadow-lg shadow-teal-500/25 hover:from-teal-500 hover:to-emerald-500 hover:shadow-teal-500/30"
                size="lg"
              >
                {loading ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <Chrome className="size-5" />
                )}
                {loading ? '로그인 중...' : t.auth.signInWithGoogle}
              </Button>
              {error && (
                <p className="mt-2 text-center text-sm text-destructive">
                  {error}
                </p>
              )}
            </motion.div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
