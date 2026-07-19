'use client';

import { useState, useMemo, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  useNodeStore,
  useProjectStore,
  useNavStore,
  useLogStore,
  useAuthStore,
} from '@/lib/store';
import { useLocale } from '@/hooks/use-locale';
import { createNode, generateId } from '@/lib/services';
import { format } from 'date-fns';
import { ko as koLocale } from 'date-fns/locale';
import {
  Plus, Trash2, Pencil, ChevronRight, ChevronDown, ChevronLeft,
  LayoutGrid, GitBranch, List, Sparkles, Target, Loader2,
  Inbox, Check, X, AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import type { Node, NodeStatus } from '@/lib/types';

type ViewMode = 'grid' | 'tree' | 'list';

export function MandaratView() {
  const { t, locale } = useLocale();
  const allNodes = useNodeStore((s) => s.nodes);
  const addNodeWithLog = useNodeStore((s) => s.addNodeWithLog);
  const updateNodeWithLog = useNodeStore((s) => s.updateNodeWithLog);
  const removeNodeWithLog = useNodeStore((s) => s.removeNodeWithLog);
  const moveNode = useNodeStore((s) => s.moveNode);
  const getChildNodes = useNodeStore((s) => s.getChildNodes);
  const recalcParentProgress = useNodeStore((s) => s.recalcParentProgress);
  const getDescendantNodes = useNodeStore((s) => s.getDescendantNodes);
  const projects = useProjectStore((s) => s.projects);
  const selectedProjectId = useNavStore((s) => s.selectedProjectId);
  const setSelectedProject = useNavStore((s) => s.setSelectedProject);
  const user = useAuthStore((s) => s.user);
  const dateLocale = locale === 'ko' ? koLocale : undefined;

  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [zoomedNodeId, setZoomedNodeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [addingChildFor, setAddingChildFor] = useState<string | null>(null);
  const [newChildTitle, setNewChildTitle] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Node | null>(null);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  const [inlineTitle, setInlineTitle] = useState('');

  // Detail panel state
  const [detailTitle, setDetailTitle] = useState('');
  const [detailDesc, setDetailDesc] = useState('');
  const [detailStatus, setDetailStatus] = useState<string>('');
  const [detailUrgency, setDetailUrgency] = useState(3);
  const [detailImportance, setDetailImportance] = useState(3);
  const [detailProgress, setDetailProgress] = useState(0);

  const statusLabel = (status: string) => {
    const key = status as keyof typeof t.status;
    return t.status[key] ?? status;
  };

  const allStatuses: NodeStatus[] = [
    'scheduled', 'in_progress', 'waiting', 'review', 'completed', 'on_hold', 'cancelled',
  ];

  // Current effective project
  const effectiveProjectId = selectedProjectId ?? projects[0]?.id ?? null;

  // Root node for the selected project
  const rootNode = useMemo(() => {
    if (!effectiveProjectId) return null;
    return Object.values(allNodes).find(
      (n) => n.id === effectiveProjectId && (n.type === 'goal' || n.type === 'task')
    );
  }, [allNodes, effectiveProjectId]);

  // Currently zoomed node (for grid ring-2 navigation)
  const zoomedNode = useMemo(() => {
    if (!zoomedNodeId) return rootNode;
    return allNodes[zoomedNodeId] ?? rootNode;
  }, [allNodes, zoomedNodeId, rootNode]);

  // Children of the current zoom/root node
  const coreGoals = useMemo(() => {
    if (!zoomedNode) return [];
    return getChildNodes(zoomedNode.id);
  }, [allNodes, zoomedNode, getChildNodes]);

  // Unsorted nodes
  const unsortedNodes = useMemo(() => {
    return Object.values(allNodes).filter(
      (n) => n.projectId === 'unsorted' && n.aiMeta?.status !== 'draft'
    );
  }, [allNodes]);

  // --- Handlers ---
  const handleAddChild = useCallback(
    (parentId: string, title: string) => {
      if (!title.trim()) return;
      const parent = allNodes[parentId];
      if (!parent) return;
      const child = createNode({
        workspaceId: parent.workspaceId,
        type: 'goal',
        title: title.trim(),
        projectId: parent.projectId,
        parentId: parent.id,
      });
      addNodeWithLog(child);
      // Update parent's childrenIds
      updateNodeWithLog(parentId, {
        childrenIds: [...parent.childrenIds, child.id],
      });
      recalcParentProgress(parentId);
      setAddingChildFor(null);
      setNewChildTitle('');
    },
    [allNodes, addNodeWithLog, updateNodeWithLog, recalcParentProgress]
  );

  const handleDelete = useCallback(
    (node: Node) => {
      const descendants = getDescendantNodes(node.id);
      // Remove all descendants
      for (const d of descendants) removeNodeWithLog(d.id);
      // Remove from parent
      if (node.parentId) {
        const parent = allNodes[node.parentId];
        if (parent) {
          updateNodeWithLog(node.parentId, {
            childrenIds: parent.childrenIds.filter((c) => c !== node.id),
          });
          recalcParentProgress(node.parentId);
        }
      }
      removeNodeWithLog(node.id);
      if (selectedNodeId === node.id) setSelectedNodeId(null);
      if (zoomedNodeId === node.id) setZoomedNodeId(null);
      setDeleteTarget(null);
    },
    [allNodes, removeNodeWithLog, updateNodeWithLog, recalcParentProgress, getDescendantNodes, selectedNodeId, zoomedNodeId]
  );

  const handleExpandToGrid = useCallback(
    (node: Node) => {
      if (node.childrenIds.length > 0) {
        setZoomedNodeId(node.id);
        return;
      }
      // Create 8 empty children
      const newChildren: Node[] = [];
      for (let i = 0; i < 8; i++) {
        const child = createNode({
          workspaceId: node.workspaceId,
          type: 'goal',
          title: '',
          projectId: node.projectId,
          parentId: node.id,
        });
        newChildren.push(child);
        addNodeWithLog(child);
      }
      updateNodeWithLog(node.id, {
        childrenIds: newChildren.map((c) => c.id),
      });
      setZoomedNodeId(node.id);
    },
    [addNodeWithLog, updateNodeWithLog]
  );

  const handleAIGenerate = useCallback(
    (node: Node) => {
      setAiGenerating(true);
      setTimeout(() => {
        const templates = locale === 'ko'
          ? ['세부 계획 수립', '실행 일정 정리', '필요 리소스 파악', '위험 요소 분석', '성과 지표 설정', '관계자 소통', '중간 점검 일정', '최종 목표 달성']
          : ['Detail Planning', 'Schedule Execution', 'Resource Assessment', 'Risk Analysis', 'KPI Setting', 'Stakeholder Comms', 'Mid-term Review', 'Final Achievement'];
        const newChildren: Node[] = [];
        for (let i = 0; i < 8; i++) {
          if (node.childrenIds[i]) continue; // Skip existing
          const child = createNode({
            workspaceId: node.workspaceId,
            type: 'goal',
            title: templates[i],
            projectId: node.projectId,
            parentId: node.id,
            aiMeta: {
              status: 'draft',
              sourceInput: { channel: 'text', rawRef: 'ai-generate' },
              suggestedProjectId: null,
              matchConfidence: null,
              clarificationLog: [],
            },
          });
          newChildren.push(child);
          addNodeWithLog(child);
        }
        const allChildIds = [
          ...node.childrenIds.filter((id) => allNodes[id]),
          ...newChildren.map((c) => c.id),
        ];
        updateNodeWithLog(node.id, { childrenIds: allChildIds });
        setAiGenerating(false);
        toast.success(locale === 'ko' ? '하위 목표가 생성되었습니다' : 'Sub-goals generated');
      }, 1500);
    },
    [locale, addNodeWithLog, updateNodeWithLog, allNodes]
  );

  const handleSelectNode = useCallback(
    (node: Node) => {
      setSelectedNodeId(node.id);
      setDetailTitle(node.title);
      setDetailDesc(node.description);
      setDetailStatus(node.status);
      setDetailUrgency(node.priority.urgency);
      setDetailImportance(node.priority.importance);
      setDetailProgress(node.progress);
    },
    []
  );

  const handleSaveDetail = useCallback(() => {
    if (!selectedNodeId) return;
    const oldProgress = allNodes[selectedNodeId]?.progress ?? 0;
    updateNodeWithLog(selectedNodeId, {
      title: detailTitle,
      description: detailDesc,
      status: detailStatus as NodeStatus,
      priority: {
        urgency: detailUrgency,
        importance: detailImportance,
        score: Math.round(detailUrgency * 0.4 + detailImportance * 0.6),
      },
      progress: detailProgress,
    });
    if (detailProgress !== oldProgress) {
      const node = allNodes[selectedNodeId];
      if (node?.parentId) recalcParentProgress(node.parentId);
    }
    toast.success(t.common.save);
  }, [selectedNodeId, detailTitle, detailDesc, detailStatus, detailUrgency, detailImportance, detailProgress, allNodes, updateNodeWithLog, recalcParentProgress, t]);

  const handleMergeToProject = useCallback(
    (node: Node, projectId: string) => {
      moveNode(node.id, projectId, zoomedNode?.id ?? rootNode?.id ?? null);
    },
    [moveNode, zoomedNode, rootNode]
  );

  const handleNewRootGoal = useCallback(() => {
    if (!projects[0]?.id) return;
    const goal = createNode({
      workspaceId: 'demo-workspace',
      type: 'goal',
      title: '',
      projectId: projects[0].id,
      parentId: null,
    });
    addNodeWithLog(goal);
    setSelectedNodeId(goal.id);
    setDetailTitle('');
    setDetailDesc('');
    setDetailStatus('scheduled');
    setDetailUrgency(3);
    setDetailImportance(3);
    setDetailProgress(0);
    setInlineEditId(goal.id);
    setInlineTitle('');
  }, [projects, addNodeWithLog]);

  const selectedNode = selectedNodeId ? allNodes[selectedNodeId] : null;

  // ===== RENDER =====
  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Top bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-lg font-semibold mr-2">{t.mandarat.title}</h2>
        <Select
          value={effectiveProjectId ?? ''}
          onValueChange={(v) => {
            setSelectedProject(v === '' ? null : v);
            setZoomedNodeId(null);
            setSelectedNodeId(null);
          }}
        >
          <SelectTrigger className="w-[200px] h-8 text-xs">
            <SelectValue placeholder={t.mandarat.selectProject} />
          </SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* View mode toggle */}
        <div className="flex items-center rounded-lg border p-0.5">
          {([
            { mode: 'grid' as ViewMode, icon: LayoutGrid, label: t.mandarat.grid },
            { mode: 'tree' as ViewMode, icon: GitBranch, label: t.mandarat.tree },
            { mode: 'list' as ViewMode, icon: List, label: t.mandarat.list },
          ]).map(({ mode, icon: Icon, label }) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={cn(
                'flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors',
                viewMode === mode
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="size-3" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {selectedNode && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              disabled={aiGenerating}
              onClick={() => handleAIGenerate(selectedNode)}
            >
              {aiGenerating ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
              {aiGenerating ? t.mandarat.aiGenerating : t.mandarat.aiGenerate}
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={handleNewRootGoal}>
            <Plus className="size-3" />
            {t.mandarat.newGoal}
          </Button>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex gap-4 min-h-0 overflow-hidden">
        {/* Left: View content */}
        <div className="flex-1 min-w-0 overflow-auto">
          {!effectiveProjectId ? (
            <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
              <Target className="size-12 opacity-20" />
              <p className="text-sm">{t.mandarat.noGoals}</p>
            </div>
          ) : viewMode === 'grid' ? (
            <MandaratGrid
              rootNode={rootNode}
              zoomedNode={zoomedNode}
              coreGoals={coreGoals}
              selectedNodeId={selectedNodeId}
              inlineEditId={inlineEditId}
              inlineTitle={inlineTitle}
              addingChildFor={addingChildFor}
              newChildTitle={newChildTitle}
              allNodes={allNodes}
              t={t}
              locale={locale}
              onZoomIn={(n) => setZoomedNodeId(n.id)}
              onZoomOut={() => setZoomedNodeId(null)}
              onSelect={handleSelectNode}
              onInlineEditStart={(n) => { setInlineEditId(n.id); setInlineTitle(n.title); }}
              onInlineEditSave={(id, title) => {
                if (title.trim()) updateNodeWithLog(id, { title: title.trim() });
                setInlineEditId(null);
              }}
              onInlineEditCancel={() => setInlineEditId(null)}
              onAddChildStart={(id) => { setAddingChildFor(id); setNewChildTitle(''); }}
              onAddChildCancel={() => { setAddingChildFor(null); setNewChildTitle(''); }}
              onAddChildSave={handleAddChild}
              onNewChildTitleChange={setNewChildTitle}
              onInlineTitleChange={setInlineTitle}
            />
          ) : viewMode === 'tree' ? (
            <MandaratTree
              rootNode={rootNode}
              allNodes={allNodes}
              selectedNodeId={selectedNodeId}
              expanded={zoomedNodeId ? new Set([zoomedNodeId, ...(rootNode?.id ? [rootNode.id] : [])]) : new Set(rootNode?.id ? [rootNode.id] : [])}
              t={t}
              locale={locale}
              dateLocale={dateLocale}
              onToggle={(id) => setZoomedNodeId(zoomedNodeId === id ? null : id)}
              onSelect={handleSelectNode}
              onAddChild={(parentId) => handleAddChild(parentId, '')}
              onDelete={setDeleteTarget}
            />
          ) : (
            <MandaratList
              projectId={effectiveProjectId}
              allNodes={allNodes}
              selectedNodeId={selectedNodeId}
              t={t}
              locale={locale}
              dateLocale={dateLocale}
              onSelect={handleSelectNode}
            />
          )}

          {/* Unsorted items */}
          {unsortedNodes.length > 0 && (
            <div className="mt-6">
              <Separator className="mb-4" />
              <div className="flex items-center gap-2 mb-3">
                <Inbox className="size-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">{t.mandarat.unsortedItems}</h3>
                <Badge variant="secondary" className="text-[10px] h-5 px-1.5">{unsortedNodes.length}</Badge>
              </div>
              <div className="space-y-2">
                {unsortedNodes.map((node) => (
                  <div key={node.id} className="flex items-center gap-2 rounded-lg border p-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{node.title || t.mandarat.nodeTitlePlaceholder}</p>
                      <p className="text-xs text-muted-foreground">{format(node.createdAt, 'MM/dd HH:mm', { locale: dateLocale })}</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs shrink-0"
                      onClick={() => handleMergeToProject(node, effectiveProjectId)}
                    >
                      {t.mandarat.mergeToProject}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Detail panel */}
        {selectedNode && (
          <div className="hidden w-72 shrink-0 flex-col border rounded-lg p-4 lg:flex">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">{t.mandarat.editNode}</h3>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => setSelectedNodeId(null)}>
                <X className="size-3.5" />
              </Button>
            </div>
            <ScrollArea className="flex-1">
              <div className="space-y-3 pr-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">{t.mandarat.nodeTitlePlaceholder.replace('목표를 입력하세요', '제목')}</label>
                  <Input
                    value={detailTitle}
                    onChange={(e) => setDetailTitle(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">{t.mandarat.nodeDescPlaceholder.replace('설명을 입력하세요', '설명')}</label>
                  <Textarea
                    value={detailDesc}
                    onChange={(e) => setDetailDesc(e.target.value)}
                    className="text-sm min-h-[60px]"
                    placeholder={t.mandarat.nodeDescPlaceholder}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">{t.todo.priority}</label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <label className="text-[10px] text-muted-foreground">
                        {locale === 'ko' ? '긴급도' : 'Urgency'}: {detailUrgency}
                      </label>
                      <Input
                        type="range" min={1} max={5} step={1}
                        value={detailUrgency}
                        onChange={(e) => setDetailUrgency(Number(e.target.value))}
                        className="h-6 p-0"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-[10px] text-muted-foreground">
                        {locale === 'ko' ? '중요도' : 'Importance'}: {detailImportance}
                      </label>
                      <Input
                        type="range" min={1} max={5} step={1}
                        value={detailImportance}
                        onChange={(e) => setDetailImportance(Number(e.target.value))}
                        className="h-6 p-0"
                      />
                    </div>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">{t.status.scheduled.replace('예정', '상태')}</label>
                  <Select value={detailStatus} onValueChange={setDetailStatus}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {allStatuses.map((s) => (
                        <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">{t.mandarat.progress}: {detailProgress}%</label>
                  <Input
                    type="range" min={0} max={100} step={5}
                    value={detailProgress}
                    onChange={(e) => setDetailProgress(Number(e.target.value))}
                    className="h-6 p-0"
                  />
                </div>
                <div className="flex gap-1.5 pt-2">
                  <Button size="sm" className="h-7 flex-1 text-xs bg-primary text-primary-foreground" onClick={handleSaveDetail}>
                    <Check className="size-3 mr-1" />
                    {t.common.save}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => selectedNode && handleExpandToGrid(selectedNode)}
                  >
                    <LayoutGrid className="size-3 mr-1" />
                    {t.mandarat.expandToGrid}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setDeleteTarget(selectedNode)}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              </div>
            </ScrollArea>
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.mandarat.deleteNode}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.mandarat.confirmDelete}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && handleDelete(deleteTarget)}
            >
              {t.common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ===== Mandarat Grid Component =====
function MandaratGrid({
  rootNode, zoomedNode, coreGoals, selectedNodeId, inlineEditId, inlineTitle,
  addingChildFor, newChildTitle, allNodes, t, locale,
  onZoomIn, onZoomOut, onSelect, onInlineEditStart, onInlineEditSave, onInlineEditCancel,
  onAddChildStart, onAddChildCancel, onAddChildSave, onNewChildTitleChange, onInlineTitleChange,
}: {
  rootNode: Node | null; zoomedNode: Node | null; coreGoals: Node[];
  selectedNodeId: string | null; inlineEditId: string | null; inlineTitle: string;
  addingChildFor: string | null; newChildTitle: string; allNodes: Record<string, Node>;
  t: any; locale: string;
  onZoomIn: (n: Node) => void; onZoomOut: () => void;
  onSelect: (n: Node) => void;
  onInlineEditStart: (n: Node) => void;
  onInlineEditSave: (id: string, title: string) => void;
  onInlineEditCancel: () => void;
  onAddChildStart: (id: string) => void;
  onAddChildCancel: () => void;
  onAddChildSave: (parentId: string, title: string) => void;
  onNewChildTitleChange: (v: string) => void;
  onInlineTitleChange: (v: string) => void;
}) {
  if (!zoomedNode) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <p className="text-sm">{t.mandarat.noGoals}</p>
      </div>
    );
  }

  const isZoomed = zoomedNode.id !== rootNode?.id;
  // Build 3x3 grid: positions 0-8, position 4 is center
  const grid: (Node | null)[] = new Array(9).fill(null);
  grid[4] = zoomedNode;
  coreGoals.slice(0, 8).forEach((child, i) => {
    const pos = i < 4 ? i : i + 1; // Skip center (pos 4)
    if (pos < 9) grid[pos] = child;
  });

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Breadcrumb / Back button */}
      {isZoomed && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Button variant="ghost" size="sm" className="h-6 gap-1 text-xs" onClick={onZoomOut}>
            <ChevronLeft className="size-3" />
            {rootNode?.title?.substring(0, 20) ?? '...'}
          </Button>
          <ChevronRight className="size-3" />
          <span className="font-medium text-foreground">{zoomedNode.title?.substring(0, 20) || t.mandarat.centerGoal}</span>
        </div>
      )}

      {/* 3x3 Grid */}
      <div className="grid grid-cols-3 gap-2 w-full max-w-[480px]">
        {grid.map((node, idx) => {
          const isCenter = idx === 4;
          const isEmpty = !node || !node.title;

          if (isCenter && node) {
            return (
              <CenterCell
                key="center"
                node={node}
                isSelected={selectedNodeId === node.id}
                isEditing={inlineEditId === node.id}
                editTitle={inlineTitle}
                t={t}
                onEditTitleChange={onInlineTitleChange}
                onSelect={() => onSelect(node)}
                onDoubleClick={() => onInlineEditStart(node)}
                onEditSave={() => onInlineEditSave(node.id, inlineTitle)}
                onEditCancel={onInlineEditCancel}
              />
            );
          }

          if (isEmpty) {
            return (
              <button
                key={`empty-${idx}`}
                onClick={() => zoomedNode && onAddChildStart(zoomedNode.id)}
                className="aspect-square rounded-lg border-2 border-dashed border-muted-foreground/20 flex items-center justify-center text-muted-foreground/40 hover:border-primary/40 hover:text-primary/60 transition-colors"
              >
                <Plus className="size-5" />
              </button>
            );
          }

          return (
            <GoalCell
              key={node.id}
              node={node}
              isSelected={selectedNodeId === node.id}
              isEditing={inlineEditId === node.id}
              editTitle={inlineTitle}
              addingChild={addingChildFor === node.id}
              newChildTitle={newChildTitle}
              childCount={node.childrenIds.length}
              t={t}
              locale={locale}
              onEditTitleChange={onInlineTitleChange}
              onNewChildTitleChange={onNewChildTitleChange}
              onSelect={() => onSelect(node)}
              onDoubleClick={() => onInlineEditStart(node)}
              onZoomIn={() => onZoomIn(node)}
              onEditSave={() => onInlineEditSave(node.id, inlineTitle)}
              onEditCancel={onInlineEditCancel}
              onAddChildStart={() => onAddChildStart(node.id)}
              onAddChildCancel={onAddChildCancel}
              onAddChildSave={() => onAddChildSave(node.id, newChildTitle)}
            />
          );
        })}
      </div>

      {/* Label */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>{t.mandarat.coreGoals} ({coreGoals.length}/8)</span>
      </div>
    </div>
  );
}

// ===== Center Cell =====
function CenterCell({ node, isSelected, isEditing, editTitle, t, onEditTitleChange, onSelect, onDoubleClick, onEditSave, onEditCancel }: {
  node: Node; isSelected: boolean; isEditing: boolean; editTitle: string; t: any;
  onEditTitleChange: (v: string) => void; onSelect: () => void;
  onDoubleClick: () => void; onEditSave: () => void; onEditCancel: () => void;
}) {
  const statusLabel = (status: string) => {
    const key = status as keyof typeof t.status;
    return t.status[key] ?? status;
  };

  return (
    <motion.div
      layout
      className={cn(
        'aspect-square rounded-xl border-2 p-3 flex flex-col items-center justify-center text-center transition-all cursor-pointer',
        isSelected
          ? 'border-primary bg-primary/10 shadow-md'
          : 'border-primary/50 bg-gradient-to-br from-primary/5 to-primary/10 hover:border-primary hover:shadow-sm'
      )}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
    >
      {isEditing ? (
        <div className="flex flex-col gap-1 w-full" onClick={(e) => e.stopPropagation()}>
          <input
            autoFocus
            value={editTitle}
            onChange={(e) => onEditTitleChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onEditSave(); if (e.key === 'Escape') onEditCancel(); }}
            className="w-full text-sm font-semibold bg-transparent border-b border-primary outline-none text-center"
            placeholder={t.mandarat.nodeTitlePlaceholder}
          />
          <div className="flex gap-1 justify-center mt-1">
            <Button size="sm" className="h-5 w-5 p-0" onClick={onEditSave}><Check className="size-3" /></Button>
            <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={onEditCancel}><X className="size-3" /></Button>
          </div>
        </div>
      ) : (
        <>
          <Target className="size-5 text-primary mb-1.5" />
          <p className="text-sm font-semibold leading-tight line-clamp-3">{node.title || t.mandarat.centerGoal}</p>
          <Badge variant="secondary" className="mt-1.5 text-[10px] h-4 px-1">
            {statusLabel(node.status)}
          </Badge>
          <div className="mt-1.5 w-full">
            <Progress value={node.progress} className="h-1" />
            <span className="text-[10px] text-muted-foreground">{node.progress}%</span>
          </div>
        </>
      )}
    </motion.div>
  );
}

// ===== Goal Cell =====
function GoalCell({ node, isSelected, isEditing, editTitle, addingChild, newChildTitle, childCount, t, locale, onEditTitleChange, onNewChildTitleChange, onSelect, onDoubleClick, onZoomIn, onEditSave, onEditCancel, onAddChildStart, onAddChildCancel, onAddChildSave }: {
  node: Node; isSelected: boolean; isEditing: boolean; editTitle: string;
  addingChild: boolean; newChildTitle: string; childCount: number; t: any; locale: string;
  onEditTitleChange: (v: string) => void; onNewChildTitleChange: (v: string) => void;
  onSelect: () => void; onDoubleClick: () => void; onZoomIn: () => void;
  onEditSave: () => void; onEditCancel: () => void;
  onAddChildStart: () => void; onAddChildCancel: () => void; onAddChildSave: () => void;
}) {
  const statusLabel = (status: string) => {
    const key = status as keyof typeof t.status;
    return t.status[key] ?? status;
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        'aspect-square rounded-lg border p-2 flex flex-col text-center transition-all cursor-pointer relative group',
        isSelected
          ? 'border-primary bg-primary/5 shadow-sm'
          : 'border-border bg-card hover:border-primary/40 hover:shadow-sm',
        node.aiMeta?.status === 'draft' && 'border-amber-400/50 bg-amber-50 dark:bg-amber-950/20'
      )}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
    >
      {isEditing ? (
        <div className="flex flex-col gap-1 w-full h-full" onClick={(e) => e.stopPropagation()}>
          <input
            autoFocus
            value={editTitle}
            onChange={(e) => onEditTitleChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onEditSave(); if (e.key === 'Escape') onEditCancel(); }}
            className="w-full text-xs font-medium bg-transparent border-b border-primary outline-none text-center"
            placeholder={t.mandarat.nodeTitlePlaceholder}
          />
          <div className="flex gap-1 justify-center mt-auto">
            <Button size="sm" className="h-5 w-5 p-0" onClick={onEditSave}><Check className="size-3" /></Button>
            <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={onEditCancel}><X className="size-3" /></Button>
          </div>
        </div>
      ) : addingChild ? (
        <div className="flex flex-col gap-1 w-full h-full" onClick={(e) => e.stopPropagation()}>
          <span className="text-[10px] text-muted-foreground">{t.mandarat.addChild}</span>
          <input
            autoFocus
            value={newChildTitle}
            onChange={(e) => onNewChildTitleChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onAddChildSave(); if (e.key === 'Escape') onAddChildCancel(); }}
            className="w-full text-xs bg-transparent border-b border-primary outline-none text-center"
            placeholder={t.mandarat.nodeTitlePlaceholder}
          />
          <div className="flex gap-1 justify-center mt-auto">
            <Button size="sm" className="h-5 w-5 p-0" onClick={onAddChildSave}><Check className="size-3" /></Button>
            <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={onAddChildCancel}><X className="size-3" /></Button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-xs font-medium leading-tight line-clamp-3 flex-1 flex items-center justify-center">
            {node.title || t.mandarat.nodeTitlePlaceholder}
          </p>
          <div className="mt-1 w-full">
            <Progress value={node.progress} className="h-1" />
          </div>
          <div className="flex items-center justify-center gap-1 mt-0.5">
            <span className="text-[10px] text-muted-foreground">{node.progress}%</span>
            {childCount > 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); onZoomIn(); }}
                className="text-[10px] text-primary hover:underline"
              >
                ({childCount})
              </button>
            )}
          </div>
          {/* Hover action buttons */}
          <div className="absolute top-1 right-1 hidden group-hover:flex gap-0.5">
            <button
              onClick={(e) => { e.stopPropagation(); onAddChildStart(); }}
              className="size-4 flex items-center justify-center rounded bg-background/80 text-muted-foreground hover:text-primary"
            >
              <Plus className="size-2.5" />
            </button>
          </div>
        </>
      )}
    </motion.div>
  );
}

// ===== Tree View =====
function MandaratTree({ rootNode, allNodes, selectedNodeId, expanded, t, locale, dateLocale, onToggle, onSelect, onAddChild, onDelete }: {
  rootNode: Node | null; allNodes: Record<string, Node>; selectedNodeId: string | null;
  expanded: Set<string>; t: any; locale: string; dateLocale: Locale | undefined;
  onToggle: (id: string) => void; onSelect: (n: Node) => void;
  onAddChild: (parentId: string) => void; onDelete: (n: Node) => void;
}) {
  const getChildNodes = (parentId: string) =>
    Object.values(allNodes).filter((n) => n.parentId === parentId);

  const renderNode = (node: Node, depth: number) => {
    const children = getChildNodes(node.id);
    const isExpanded = expanded.has(node.id);
    const isSelected = selectedNodeId === node.id;
    const statusLabel = (status: string) => {
      const key = status as keyof typeof t.status;
      return t.status[key] ?? status;
    };

    return (
      <div key={node.id}>
        <div
          className={cn(
            'flex items-center gap-2 py-1.5 px-2 rounded-lg cursor-pointer transition-colors',
            isSelected ? 'bg-primary/10' : 'hover:bg-muted/50'
          )}
          style={{ paddingLeft: `${depth * 20 + 8}px` }}
          onClick={() => onSelect(node)}
        >
          {children.length > 0 ? (
            <button onClick={(e) => { e.stopPropagation(); onToggle(node.id); }} className="shrink-0">
              {isExpanded ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevronRight className="size-3.5 text-muted-foreground" />}
            </button>
          ) : (
            <span className="w-3.5 shrink-0" />
          )}
          <Target className="size-3.5 text-primary shrink-0" />
          <span className="text-sm font-medium truncate flex-1">{node.title || t.mandarat.nodeTitlePlaceholder}</span>
          <Badge variant="secondary" className="text-[10px] h-4 px-1 shrink-0">
            {statusLabel(node.status)}
          </Badge>
          <Progress value={node.progress} className="h-1 w-12 shrink-0" />
          <span className="text-[10px] text-muted-foreground w-7 text-right shrink-0">{node.progress}%</span>
          <div className="flex gap-0.5 shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); onAddChild(node.id); }}
              className="size-5 flex items-center justify-center rounded text-muted-foreground hover:text-primary"
            >
              <Plus className="size-3" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(node); }}
              className="size-5 flex items-center justify-center rounded text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-3" />
            </button>
          </div>
        </div>
        {isExpanded && children.length > 0 && (
          <AnimatePresence>
            {children.map((child) => (
              <motion.div
                key={child.id}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.15 }}
              >
                {renderNode(child, depth + 1)}
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
    );
  };

  if (!rootNode) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <p className="text-sm">{t.mandarat.noGoals}</p>
      </div>
    );
  }

  return <div className="space-y-0.5">{renderNode(rootNode, 0)}</div>;
}

// ===== List View =====
function MandaratList({ projectId, allNodes, selectedNodeId, t, locale, dateLocale, onSelect }: {
  projectId: string; allNodes: Record<string, Node>; selectedNodeId: string | null;
  t: any; locale: string; dateLocale: Locale | undefined;
  onSelect: (n: Node) => void;
}) {
  const nodes = Object.values(allNodes)
    .filter((n) => n.projectId === projectId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const getParentChain = (node: Node): string[] => {
    const chain: string[] = [];
    let current = node;
    while (current.parentId) {
      const parent = allNodes[current.parentId];
      if (!parent) break;
      chain.unshift(parent.title || '...');
      current = parent;
    }
    return chain;
  };

  const statusLabel = (status: string) => {
    const key = status as keyof typeof t.status;
    return t.status[key] ?? status;
  };

  const typeLabel = (type: string) => {
    if (type === 'calendar_event') return t.chat.typeEvent;
    if (type === 'todo') return t.chat.typeTodo;
    return t.chat.typeGoal;
  };

  return (
    <div className="space-y-1.5">
      {nodes.map((node, idx) => {
        const chain = getParentChain(node);
        const isSelected = selectedNodeId === node.id;
        return (
          <motion.div
            key={node.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15, delay: idx * 0.02 }}
            className={cn(
              'flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors',
              isSelected ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
            )}
            onClick={() => onSelect(node)}
          >
            <div className="min-w-0 flex-1">
              {chain.length > 0 && (
                <p className="text-[10px] text-muted-foreground truncate mb-0.5">
                  {chain.join(' > ')}
                </p>
              )}
              <p className="text-sm font-medium truncate">{node.title || t.mandarat.nodeTitlePlaceholder}</p>
            </div>
            <Badge variant="secondary" className="text-[10px] h-5 px-1.5 shrink-0">
              {typeLabel(node.type)}
            </Badge>
            <Badge variant="outline" className="text-[10px] h-5 px-1.5 shrink-0">
              {statusLabel(node.status)}
            </Badge>
            <div className="flex items-center gap-1.5 w-20 shrink-0">
              <Progress value={node.progress} className="h-1.5 flex-1" />
              <span className="text-[10px] text-muted-foreground">{node.progress}%</span>
            </div>
          </motion.div>
        );
      })}
      {nodes.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <p className="text-sm">{t.mandarat.noGoals}</p>
        </div>
      )}
    </div>
  );
}