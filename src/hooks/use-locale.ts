'use client';

import { usePrefStore } from '@/lib/store';
import { getTranslation } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n';

export function useLocale() {
  const language = usePrefStore((s) => s.language);
  const t = getTranslation(language as Locale);
  return { locale: language, t };
}