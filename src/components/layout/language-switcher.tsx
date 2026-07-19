'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { usePrefStore } from '@/lib/store';

export function LanguageSwitcher() {
  const language = usePrefStore((s) => s.language);
  const setLanguage = usePrefStore((s) => s.setLanguage);

  return (
    <Select value={language} onValueChange={(v) => setLanguage(v as 'ko' | 'en')}>
      <SelectTrigger size="sm" className="h-7 w-[90px] text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="ko">한국어</SelectItem>
        <SelectItem value="en">English</SelectItem>
      </SelectContent>
    </Select>
  );
}