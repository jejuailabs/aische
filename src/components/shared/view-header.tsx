'use client';

import { cn } from '@/lib/utils';

interface ViewHeaderProps {
  title: string;
  action?: React.ReactNode;
  className?: string;
}

export function ViewHeader({ title, action, className }: ViewHeaderProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-between py-2',
        className
      )}
    >
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  );
}