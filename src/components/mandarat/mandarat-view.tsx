'use client';

import { useState, useMemo } from 'react';
import { useNodeStore, useProjectStore } from '@/lib/store';
import { useLocale } from '@/hooks/use-locale';
import { ChevronRight, ChevronDown, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { motion } from 'framer-motion';

export function MandaratView() {
  const { t } = useLocale();
  const allNodes = useNodeStore((s) => s.nodes);
  const projects = useProjectStore((s) => s.projects);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const statusLabel = (status: string) => {
    const key = status as keyof typeof t.status;
    return t.status[key] ?? status;
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Get project root nodes (goals with parentId === null that match project IDs)
  const projectGoals = useMemo(() => {
    return projects.map((proj) => {
      const rootGoal = Object.values(allNodes).find(
        (n) => n.id === proj.id && n.type === 'goal'
      );
      const children = rootGoal
        ? Object.values(allNodes).filter(
            (n) => n.parentId === proj.id && n.type === 'goal'
          )
        : [];
      return { project: proj, rootGoal, children };
    });
  }, [projects, allNodes]);

  const handleNewGoal = () => {
    toast.info(t.todo.phase2Note);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t.mandarat.title}</h2>
        <Button variant="outline" size="sm" onClick={handleNewGoal}>
          <Plus className="mr-1.5 size-3.5" />
          {t.mandarat.newGoal}
        </Button>
      </div>

      <div className="space-y-2">
        {projectGoals.map(({ project, rootGoal, children }, idx) => {
          const isExpanded = expanded.has(project.id);
          const hasChildren = children.length > 0;

          return (
            <motion.div
              key={project.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: idx * 0.05 }}
              className="rounded-lg border"
            >
              {/* Root level */}
              <button
                onClick={() => hasChildren && toggleExpand(project.id)}
                className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted/50"
              >
                {hasChildren ? (
                  isExpanded ? (
                    <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  )
                ) : (
                  <span className="w-4" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {rootGoal?.title ?? project.title}
                    </span>
                    {rootGoal && (
                      <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
                        {statusLabel(rootGoal.status)}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <Progress
                      value={rootGoal?.progress ?? project.progress}
                      className="h-1.5 flex-1"
                    />
                    <span className="text-xs text-muted-foreground">
                      {rootGoal?.progress ?? project.progress}%
                    </span>
                  </div>
                </div>
              </button>

              {/* Expanded children */}
              {isExpanded && hasChildren && (
                <div className="border-t px-4 pb-3 pt-1">
                  {children.map((child) => (
                    <div
                      key={child.id}
                      className="flex items-center gap-3 py-2 pl-7"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{child.title}</span>
                          <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
                            {statusLabel(child.status)}
                          </Badge>
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <Progress
                            value={child.progress}
                            className="h-1 flex-1"
                          />
                          <span className="text-[10px] text-muted-foreground">
                            {child.progress}%
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}