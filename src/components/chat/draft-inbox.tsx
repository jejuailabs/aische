'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useNodeStore, useCategoryStore } from '@/lib/store';
import { useLocale } from '@/hooks/use-locale';
import { format } from 'date-fns';
import { ko as koLocale } from 'date-fns/locale';
import {
  CheckCircle2,
  Trash2,
  CalendarDays,
  ListChecks,
  Clock,
  MapPin,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import type { Node } from '@/lib/types';

export function DraftInbox() {
  const { t, locale } = useLocale();
  const nodes = useNodeStore((s) => s.nodes);
  const updateNode = useNodeStore((s) => s.updateNode);
  const removeNode = useNodeStore((s) => s.removeNode);
  const dateLocale = locale === 'ko' ? koLocale : undefined;

  const drafts = useMemo(
    () =>
      Object.values(nodes)
        .filter((n) => n.aiMeta?.status === 'draft')
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    [nodes]
  );

  const typeIcon = (type: string) => {
    if (type === 'calendar_event') return CalendarDays;
    return ListChecks;
  };

  const typeLabel = (type: string) => {
    if (type === 'calendar_event') return t.chat.typeEvent;
    return t.chat.typeTodo;
  };

  const handleConfirm = (node: Node) => {
    if (!node.aiMeta) return;
    updateNode(node.id, {
      aiMeta: { ...node.aiMeta, status: 'confirmed' },
    });
    toast.success(t.chat.draftSaved);
  };

  const handleDelete = (node: Node) => {
    removeNode(node.id);
  };

  const formatSchedule = (node: Node) => {
    if (!node.schedule) return null;
    const s = node.schedule;
    if (s.allDay) return format(s.startAt, 'M/d (EEE)', { locale: dateLocale });
    return `${format(s.startAt, 'M/d (EEE)', { locale: dateLocale })} ${format(s.startAt, 'HH:mm')}~${format(s.endAt, 'HH:mm')}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t.chat.draftBox}</h2>
        {drafts.length > 0 && (
          <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
            {drafts.length}
          </Badge>
        )}
      </div>

      {drafts.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
          <CheckCircle2 className="size-10 opacity-30" />
          <p className="text-sm">{t.chat.noDrafts}</p>
        </div>
      ) : (
        <ScrollArea className="max-h-[calc(100dvh-280px)]">
          <div className="space-y-3 pr-3">
            <AnimatePresence>
              {drafts.map((node, idx) => {
                const Icon = typeIcon(node.type);
                return (
                  <motion.div
                    key={node.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ duration: 0.2, delay: idx * 0.04 }}
                    className="rounded-lg border p-4"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <Icon className="size-4 text-primary" />
                      <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
                        {typeLabel(node.type)}
                      </Badge>
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {format(node.createdAt, 'MM/dd HH:mm')}
                      </span>
                    </div>
                    <p className="text-sm font-medium">{node.title}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      {formatSchedule(node) && (
                        <span className="flex items-center gap-1">
                          <Clock className="size-3" />
                          {formatSchedule(node)}
                        </span>
                      )}
                      {node.schedule?.location && (
                        <span className="flex items-center gap-1">
                          <MapPin className="size-3" />
                          {node.schedule.location}
                        </span>
                      )}
                      {node.schedule?.attendees &&
                        node.schedule.attendees.length > 0 && (
                          <span className="flex items-center gap-1">
                            <Users className="size-3" />
                            {node.schedule.attendees.join(', ')}
                          </span>
                        )}
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <Button
                        size="sm"
                        className="h-7 gap-1 bg-primary text-xs text-primary-foreground hover:bg-primary/90"
                        onClick={() => handleConfirm(node)}
                      >
                        {t.chat.confirmDraft}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 text-xs text-muted-foreground"
                        onClick={() => handleDelete(node)}
                      >
                        <Trash2 className="size-3" />
                        {t.chat.deleteDraft}
                      </Button>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </ScrollArea>
      )}
    </div>
  );
}