'use client';

import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import {
  FolderOpen,
  Tags,
  Inbox,
  AlertTriangle,
  Plus,
  Trash2,
  Pencil,
  Download,
  ChevronDown,
  ChevronRight,
  Lightbulb,
  Sparkles,
  Archive,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useLocale } from '@/hooks/use-locale';
import {
  useProjectStore,
  useCategoryStore,
  useCaptureStore,
  useNodeStore,
  usePersonStore,
  useOrgStore,
  useTopicStore,
} from '@/lib/store';
import { createCategory } from '@/lib/services';
import { shouldPromoteTopic } from '@/lib/types';
import type {
  ProjectSummary,
  Category,
  CapturedInput,
  ExtractionResult,
  Topic,
} from '@/lib/types';

const WS = 'demo-workspace';

// ─── Extraction renderer ──────────────────────────────────

function LayerBlock({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="text-xs">{children}</div>
    </div>
  );
}

function ExtractionDetail({ ex }: { ex: ExtractionResult }) {
  const { t } = useLocale();
  return (
    <div className="flex flex-col gap-3 rounded-md bg-muted/40 p-3">
      <LayerBlock label={t.data.summary}>
        <span>{ex.summary || '—'}</span>
        <Badge variant="outline" className="ml-2 text-[10px]">
          {ex.intent}
        </Badge>
      </LayerBlock>

      {ex.schedule && (
        <LayerBlock label={t.data.layerSchedule}>
          <div className="flex flex-col">
            <span className="font-medium">{ex.schedule.title}</span>
            <span className="text-muted-foreground">
              {[
                ex.schedule.startAt ?? ex.schedule.dateExpr,
                ex.schedule.allDay ? '종일' : null,
                ex.schedule.location,
              ]
                .filter(Boolean)
                .join(' · ') || '—'}
            </span>
          </div>
        </LayerBlock>
      )}

      {ex.people.length > 0 && (
        <LayerBlock label={t.data.layerPeople}>
          <div className="flex flex-wrap gap-1">
            {ex.people.map((p, i) => (
              <Badge key={`${p.name}-${i}`} variant="secondary" className="text-[10px]">
                {[p.name, p.role, p.org, p.phone, p.email]
                  .filter(Boolean)
                  .join(' · ')}
              </Badge>
            ))}
          </div>
        </LayerBlock>
      )}

      {ex.organizations.length > 0 && (
        <LayerBlock label={t.data.layerOrgs}>
          <div className="flex flex-wrap gap-1">
            {ex.organizations.map((o, i) => (
              <Badge key={`${o.name}-${i}`} variant="secondary" className="text-[10px]">
                {[o.name, o.orgType].filter(Boolean).join(' · ')}
              </Badge>
            ))}
          </div>
        </LayerBlock>
      )}

      {ex.project && (
        <LayerBlock label={t.data.layerProject}>
          <span>
            {ex.project.matchedProjectId
              ? `${ex.project.matchedProjectId} (${ex.project.matchConfidence}%)`
              : (ex.project.newProjectSuggestion ?? '—')}
          </span>
        </LayerBlock>
      )}

      {ex.tasks.length > 0 && (
        <LayerBlock label={t.data.layerTasks}>
          <ul className="list-inside list-disc space-y-0.5">
            {ex.tasks.map((tk, i) => (
              <li key={`${tk.title}-${i}`}>
                {tk.title}
                <span className="ml-1 text-muted-foreground">
                  ({[tk.kind, tk.dueAt ?? tk.dueExpr, tk.completionMode]
                    .filter(Boolean)
                    .join(' · ')})
                </span>
              </li>
            ))}
          </ul>
        </LayerBlock>
      )}

      {ex.notes.length > 0 && (
        <LayerBlock label={t.data.layerNotes}>
          <ul className="list-inside list-disc space-y-0.5">
            {ex.notes.map((n, i) => (
              <li key={`${n}-${i}`}>{n}</li>
            ))}
          </ul>
        </LayerBlock>
      )}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────

export function DataView() {
  const { t } = useLocale();

  const projects = useProjectStore((s) => s.projects);
  const updateProject = useProjectStore((s) => s.updateProject);
  const removeProject = useProjectStore((s) => s.removeProject);

  const categories = useCategoryStore((s) => s.categories);
  const addCategory = useCategoryStore((s) => s.addCategory);
  const updateCategory = useCategoryStore((s) => s.updateCategory);
  const removeCategory = useCategoryStore((s) => s.removeCategory);

  const captures = useCaptureStore((s) => s.captures);
  const removeCapture = useCaptureStore((s) => s.removeCapture);

  const nodes = useNodeStore((s) => s.nodes);
  const removeNode = useNodeStore((s) => s.removeNode);
  const people = usePersonStore((s) => s.people);
  const removePerson = usePersonStore((s) => s.removePerson);
  const orgs = useOrgStore((s) => s.orgs);
  const removeOrg = useOrgStore((s) => s.removeOrg);

  const topics = useTopicStore((s) => s.topics);
  const updateTopic = useTopicStore((s) => s.updateTopic);
  const removeTopic = useTopicStore((s) => s.removeTopic);
  const promoteTopic = useTopicStore((s) => s.promote);

  // project state
  const [editingProject, setEditingProject] = useState<ProjectSummary | null>(
    null,
  );
  const [projectTitle, setProjectTitle] = useState('');
  const [projectToDelete, setProjectToDelete] = useState<ProjectSummary | null>(
    null,
  );
  const [deleteMode, setDeleteMode] = useState<'unsort' | 'cascade'>('unsort');

  // category state
  const [catOpen, setCatOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<Category | null>(null);
  const [catDraft, setCatDraft] = useState({
    label: '',
    color: '#10b981',
    darkColor: '#34d399',
  });
  const [catError, setCatError] = useState<string | null>(null);
  const [catToDelete, setCatToDelete] = useState<Category | null>(null);

  // capture state
  const [expanded, setExpanded] = useState<string | null>(null);
  const [captureToDelete, setCaptureToDelete] = useState<CapturedInput | null>(
    null,
  );

  // topic state
  const [expandedTopic, setExpandedTopic] = useState<string | null>(null);
  const [editingTopic, setEditingTopic] = useState<Topic | null>(null);
  const [topicLabel, setTopicLabel] = useState('');
  const [topicToPromote, setTopicToPromote] = useState<Topic | null>(null);
  const [topicToDelete, setTopicToDelete] = useState<Topic | null>(null);

  // danger state
  const [resetOpen, setResetOpen] = useState(false);
  const [resetInput, setResetInput] = useState('');

  const nodeList = useMemo(() => Object.values(nodes), [nodes]);

  const projectNodeCount = (id: string) =>
    nodeList.filter((n) => n.projectId === id).length;

  const categoryList = useMemo(
    () => Object.values(categories).sort((a, b) => a.order - b.order),
    [categories],
  );

  const categoryUsage = (id: string) =>
    nodeList.filter((n) => n.schedule?.category === id).length;

  const captureList = useMemo(
    () =>
      Object.values(captures).sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      ),
    [captures],
  );

  // 수집 중 → 승격됨 → 보관됨 순으로 묶고, 각 묶음 안은 최근 수정순
  const topicList = useMemo(() => {
    const rank: Record<Topic['status'], number> = {
      collecting: 0,
      promoted: 1,
      archived: 2,
    };
    return Object.values(topics).sort((a, b) => {
      if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });
  }, [topics]);

  const topicStatusLabel = (s: Topic['status']) =>
    s === 'collecting'
      ? t.data.topicStatusCollecting
      : s === 'promoted'
        ? t.data.topicStatusPromoted
        : t.data.topicStatusArchived;

  // ── topic handlers ──
  const saveTopicLabel = () => {
    if (!editingTopic || !topicLabel.trim()) return;
    updateTopic(editingTopic.id, { label: topicLabel.trim() });
    setEditingTopic(null);
  };

  const confirmPromoteTopic = () => {
    if (!topicToPromote) return;
    const label = topicToPromote.label;
    const projectId = promoteTopic(topicToPromote.id);
    setTopicToPromote(null);
    if (projectId) toast.success(t.data.topicPromoted.replace('{label}', label));
  };

  const archiveTopic = (topic: Topic) => {
    updateTopic(topic.id, { status: 'archived' });
    toast.success(t.data.topicArchived.replace('{label}', topic.label));
  };

  // ── project handlers ──
  const saveProjectTitle = () => {
    if (!editingProject || !projectTitle.trim()) return;
    updateProject(editingProject.id, { title: projectTitle.trim() });
    // 프로젝트 루트 노드 제목도 함께 맞춰준다
    if (nodes[editingProject.id]) {
      useNodeStore
        .getState()
        .updateNode(editingProject.id, { title: projectTitle.trim() });
    }
    setEditingProject(null);
  };

  const confirmDeleteProject = () => {
    if (!projectToDelete) return;
    removeProject(projectToDelete.id, deleteMode);
    setProjectToDelete(null);
    setDeleteMode('unsort');
  };

  // ── category handlers ──
  const openNewCat = () => {
    setEditingCat(null);
    setCatDraft({ label: '', color: '#10b981', darkColor: '#34d399' });
    setCatError(null);
    setCatOpen(true);
  };

  const openEditCat = (c: Category) => {
    setEditingCat(c);
    setCatDraft({ label: c.label, color: c.color, darkColor: c.darkColor });
    setCatError(null);
    setCatOpen(true);
  };

  const saveCat = () => {
    if (!catDraft.label.trim()) {
      setCatError(t.data.labelRequired);
      return;
    }
    if (editingCat) {
      updateCategory(editingCat.id, {
        label: catDraft.label.trim(),
        color: catDraft.color,
        darkColor: catDraft.darkColor,
      });
    } else {
      addCategory(
        createCategory({
          workspaceId: WS,
          label: catDraft.label.trim(),
          color: catDraft.color,
          darkColor: catDraft.darkColor,
          order: categoryList.length,
        }),
      );
    }
    setCatOpen(false);
  };

  // ── export ──
  const exportJson = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      count: captureList.length,
      capturedInputs: captureList.map((c) => ({
        ...c,
        createdAt: c.createdAt.toISOString(),
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `captured-inputs-${format(new Date(), 'yyyyMMdd-HHmmss')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ── reset ──
  const resetAll = () => {
    for (const n of Object.values(useNodeStore.getState().nodes)) removeNode(n.id);
    for (const p of useProjectStore.getState().projects) {
      // 노드는 위에서 이미 지웠으므로 프로젝트 레코드만 제거하면 된다
      removeProject(p.id, 'unsort');
    }
    for (const c of Object.values(useCategoryStore.getState().categories))
      removeCategory(c.id);
    for (const p of Object.values(usePersonStore.getState().people))
      removePerson(p.id);
    for (const o of Object.values(useOrgStore.getState().orgs)) removeOrg(o.id);
    for (const tp of Object.values(useTopicStore.getState().topics))
      removeTopic(tp.id);
    for (const c of Object.values(useCaptureStore.getState().captures))
      removeCapture(c.id);
    setResetInput('');
    setResetOpen(false);
  };

  return (
    <div className="flex flex-col gap-4">
      <Tabs defaultValue="projects" className="w-full">
        <TabsList className="flex-wrap">
          <TabsTrigger value="projects" className="gap-1.5">
            <FolderOpen className="size-3.5" />
            {t.data.tabProjects}
            <span className="text-muted-foreground">({projects.length})</span>
          </TabsTrigger>
          <TabsTrigger value="categories" className="gap-1.5">
            <Tags className="size-3.5" />
            {t.data.tabCategories}
            <span className="text-muted-foreground">
              ({categoryList.length})
            </span>
          </TabsTrigger>
          <TabsTrigger value="topics" className="gap-1.5">
            <Lightbulb className="size-3.5" />
            {t.data.tabTopics}
            <span className="text-muted-foreground">({topicList.length})</span>
          </TabsTrigger>
          <TabsTrigger value="captures" className="gap-1.5">
            <Inbox className="size-3.5" />
            {t.data.tabCaptures}
            <span className="text-muted-foreground">({captureList.length})</span>
          </TabsTrigger>
          <TabsTrigger value="danger" className="gap-1.5 text-destructive">
            <AlertTriangle className="size-3.5" />
            {t.data.tabDanger}
          </TabsTrigger>
        </TabsList>

        {/* ── Projects ─────────────────────────────── */}
        <TabsContent value="projects" className="mt-4 flex flex-col gap-2">
          {projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
              <FolderOpen className="size-8 opacity-30" />
              <p className="text-sm">{t.data.noProjects}</p>
            </div>
          ) : (
            projects.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
              >
                <div className="min-w-[160px] flex-1">
                  <p className="truncate text-sm font-medium">{p.title}</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <Progress value={p.progress} className="h-1.5 w-24" />
                    <span className="text-xs text-muted-foreground">
                      {p.progress}%
                    </span>
                    <span className="text-xs text-muted-foreground">
                      · {t.data.projectNodeCount} {projectNodeCount(p.id)}
                    </span>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => {
                      setEditingProject(p);
                      setProjectTitle(p.title);
                    }}
                  >
                    <Pencil className="size-3.5" />
                    {t.common.edit}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5 text-destructive hover:text-destructive"
                    onClick={() => {
                      setDeleteMode('unsort');
                      setProjectToDelete(p);
                    }}
                  >
                    <Trash2 className="size-3.5" />
                    {t.common.delete}
                  </Button>
                </div>
              </div>
            ))
          )}
        </TabsContent>

        {/* ── Categories ───────────────────────────── */}
        <TabsContent value="categories" className="mt-4 flex flex-col gap-2">
          <div className="flex justify-end">
            <Button size="sm" className="h-9 gap-1.5" onClick={openNewCat}>
              <Plus className="size-4" />
              {t.data.addCategory}
            </Button>
          </div>

          {categoryList.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
              <Tags className="size-8 opacity-30" />
              <p className="text-sm">{t.data.noCategories}</p>
            </div>
          ) : (
            categoryList.map((c) => (
              <div
                key={c.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
              >
                <span
                  className="size-5 shrink-0 rounded-full border"
                  style={{ backgroundColor: c.color }}
                  aria-hidden
                />
                <span className="min-w-[100px] flex-1 text-sm font-medium">
                  {c.label}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {c.color} / {c.darkColor}
                </span>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => openEditCat(c)}
                  >
                    <Pencil className="size-3.5" />
                    {t.common.edit}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5 text-destructive hover:text-destructive"
                    onClick={() => setCatToDelete(c)}
                  >
                    <Trash2 className="size-3.5" />
                    {t.common.delete}
                  </Button>
                </div>
              </div>
            ))
          )}
        </TabsContent>

        {/* ── Topics ───────────────────────────────── */}
        <TabsContent value="topics" className="mt-4 flex flex-col gap-2">
          {topicList.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center text-muted-foreground">
              <Lightbulb className="size-8 opacity-30" />
              <p className="text-sm">{t.data.noTopics}</p>
              <p className="max-w-md text-xs">{t.data.topicEmptyHint}</p>
            </div>
          ) : (
            topicList.map((tp) => {
              const isOpen = expandedTopic === tp.id;
              const ready = shouldPromoteTopic(tp);
              const promotedProject = tp.promotedProjectId
                ? projects.find((p) => p.id === tp.promotedProjectId)
                : undefined;
              return (
                <div
                  key={tp.id}
                  className={
                    ready
                      ? 'rounded-lg border border-primary/50 bg-primary/5'
                      : 'rounded-lg border'
                  }
                >
                  <div className="flex flex-wrap items-start gap-2 p-3">
                    <button
                      type="button"
                      onClick={() => setExpandedTopic(isOpen ? null : tp.id)}
                      className="mt-0.5 shrink-0 text-muted-foreground"
                      aria-expanded={isOpen}
                    >
                      {isOpen ? (
                        <ChevronDown className="size-4" />
                      ) : (
                        <ChevronRight className="size-4" />
                      )}
                    </button>
                    <div className="min-w-[160px] flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p
                          className={
                            tp.status === 'archived'
                              ? 'truncate text-sm font-medium text-muted-foreground'
                              : 'truncate text-sm font-medium'
                          }
                        >
                          {tp.label}
                        </p>
                        <Badge
                          variant={
                            tp.status === 'collecting' ? 'secondary' : 'outline'
                          }
                          className="text-[10px]"
                        >
                          {topicStatusLabel(tp.status)}
                        </Badge>
                        {ready && (
                          <Badge className="gap-1 text-[10px]">
                            <Sparkles className="size-3" />
                            {t.data.topicReady}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>
                          {t.data.topicNoteCount} {tp.notes.length}
                        </span>
                        <span>
                          {t.data.topicNodeCount} {tp.nodeIds.length}
                        </span>
                        <span>
                          {t.data.topicUpdatedAt}{' '}
                          {format(tp.updatedAt, 'yyyy-MM-dd')}
                        </span>
                        {tp.status === 'promoted' && (
                          <span>
                            {t.data.topicPromotedTo}:{' '}
                            {promotedProject?.title ?? tp.promotedProjectId ?? '—'}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {tp.status === 'collecting' && (
                        <Button
                          variant={ready ? 'default' : 'ghost'}
                          size="sm"
                          className="h-8 gap-1.5"
                          onClick={() => setTopicToPromote(tp)}
                        >
                          <Sparkles className="size-3.5" />
                          {t.data.topicPromote}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1.5"
                        onClick={() => {
                          setEditingTopic(tp);
                          setTopicLabel(tp.label);
                        }}
                      >
                        <Pencil className="size-3.5" />
                        {t.data.topicRename}
                      </Button>
                      {tp.status !== 'archived' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1.5"
                          onClick={() => archiveTopic(tp)}
                        >
                          <Archive className="size-3.5" />
                          {t.data.topicArchive}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1.5 text-destructive hover:text-destructive"
                        onClick={() => setTopicToDelete(tp)}
                      >
                        <Trash2 className="size-3.5" />
                        {t.common.delete}
                      </Button>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="flex flex-col gap-3 px-3 pb-3 pl-9">
                      <LayerBlock label={t.data.topicNotes}>
                        {tp.notes.length === 0 ? (
                          <span className="text-muted-foreground">
                            {t.data.topicNoNotes}
                          </span>
                        ) : (
                          <ul className="space-y-0.5">
                            {tp.notes.map((n) => (
                              <li key={n.id} className="flex gap-2">
                                <span className="shrink-0 text-muted-foreground">
                                  {format(n.createdAt, 'MM-dd')}
                                </span>
                                <span className="whitespace-pre-wrap">
                                  {n.text}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </LayerBlock>

                      <LayerBlock label={t.data.topicAliases}>
                        {tp.aliases.length === 0 ? (
                          <span className="text-muted-foreground">
                            {t.data.topicNoAliases}
                          </span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {tp.aliases.map((a) => (
                              <Badge
                                key={a}
                                variant="secondary"
                                className="text-[10px]"
                              >
                                {a}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </LayerBlock>

                      <LayerBlock label={t.data.topicLinkedNodes}>
                        {tp.nodeIds.length === 0 ? (
                          <span className="text-muted-foreground">
                            {t.data.topicNoLinkedNodes}
                          </span>
                        ) : (
                          <ul className="list-inside list-disc space-y-0.5">
                            {tp.nodeIds.map((nid) => (
                              <li key={nid}>
                                {nodes[nid]?.title ?? nid}
                              </li>
                            ))}
                          </ul>
                        )}
                      </LayerBlock>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </TabsContent>

        {/* ── Captured inputs ──────────────────────── */}
        <TabsContent value="captures" className="mt-4 flex flex-col gap-2">
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5"
              onClick={exportJson}
              disabled={captureList.length === 0}
            >
              <Download className="size-4" />
              {t.data.exportJson}
            </Button>
          </div>

          {captureList.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
              <Inbox className="size-8 opacity-30" />
              <p className="text-sm">{t.data.noCaptures}</p>
            </div>
          ) : (
            captureList.map((c) => {
              const isOpen = expanded === c.id;
              return (
                <div key={c.id} className="rounded-lg border">
                  <div className="flex items-start gap-2 p-3">
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : c.id)}
                      className="mt-0.5 shrink-0 text-muted-foreground"
                      aria-expanded={isOpen}
                    >
                      {isOpen ? (
                        <ChevronDown className="size-4" />
                      ) : (
                        <ChevronRight className="size-4" />
                      )}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p
                        className={
                          isOpen
                            ? 'whitespace-pre-wrap text-sm'
                            : 'line-clamp-2 text-sm'
                        }
                      >
                        {c.rawText}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>
                          {t.data.captureCreatedAt}{' '}
                          {format(c.createdAt, 'yyyy-MM-dd HH:mm')}
                        </span>
                        <Badge variant="outline" className="text-[10px]">
                          {c.channel}
                        </Badge>
                        <span>
                          {t.data.captureOutputs}: {c.appliedNodeIds.length}{' '}
                          {t.data.outNodes} · {c.appliedPersonIds.length}{' '}
                          {t.data.outPeople} · {c.appliedOrgIds.length}{' '}
                          {t.data.outOrgs}
                        </span>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0 text-destructive hover:text-destructive"
                      onClick={() => setCaptureToDelete(c)}
                      aria-label={t.common.delete}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>

                  {isOpen && (
                    <div className="px-3 pb-3 pl-9">
                      {c.extraction ? (
                        <ExtractionDetail ex={c.extraction} />
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          {t.data.extractionEmpty}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </TabsContent>

        {/* ── Danger zone ──────────────────────────── */}
        <TabsContent value="danger" className="mt-4">
          <div className="rounded-lg border border-destructive/40 p-4">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-4" />
              <h3 className="text-sm font-semibold">{t.data.dangerTitle}</h3>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {t.data.resetAllDesc}
            </p>
            <Separator className="my-3" />
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span>
                {t.data.tabProjects} {projects.length}
              </span>
              <span>
                {t.data.tabCategories} {categoryList.length}
              </span>
              <span>
                {t.people.tabPeople} {Object.keys(people).length}
              </span>
              <span>
                {t.people.tabOrgs} {Object.keys(orgs).length}
              </span>
              <span>
                {t.data.tabCaptures} {captureList.length}
              </span>
              <span>
                {t.admin.totalNodes} {nodeList.length}
              </span>
            </div>
            <Button
              variant="destructive"
              size="sm"
              className="mt-4 gap-1.5"
              onClick={() => {
                setResetInput('');
                setResetOpen(true);
              }}
            >
              <Trash2 className="size-4" />
              {t.data.resetAll}
            </Button>
          </div>
        </TabsContent>
      </Tabs>

      {/* ── Project title dialog ───────────────────── */}
      <Dialog
        open={editingProject !== null}
        onOpenChange={(o) => !o && setEditingProject(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t.data.editProject}</DialogTitle>
            <DialogDescription className="sr-only">
              {t.data.editProject}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="proj-title">{t.data.projectTitle}</Label>
            <Input
              id="proj-title"
              value={projectTitle}
              onChange={(e) => setProjectTitle(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditingProject(null)}
            >
              {t.common.cancel}
            </Button>
            <Button size="sm" onClick={saveProjectTitle}>
              {t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Project delete (mode select) ───────────── */}
      <AlertDialog
        open={projectToDelete !== null}
        onOpenChange={(o) => !o && setProjectToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.data.deleteProjectTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {projectToDelete?.title} — {t.data.deleteProjectDesc}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <RadioGroup
            value={deleteMode}
            onValueChange={(v) => setDeleteMode(v as 'unsort' | 'cascade')}
            className="gap-3"
          >
            <div className="flex items-start gap-2">
              <RadioGroupItem value="unsort" id="mode-unsort" className="mt-0.5" />
              <Label htmlFor="mode-unsort" className="flex flex-col items-start gap-0.5 font-normal">
                <span className="text-sm font-medium">{t.data.modeUnsort}</span>
                <span className="text-xs text-muted-foreground">
                  {t.data.modeUnsortDesc}
                </span>
              </Label>
            </div>
            <div className="flex items-start gap-2">
              <RadioGroupItem
                value="cascade"
                id="mode-cascade"
                className="mt-0.5"
              />
              <Label htmlFor="mode-cascade" className="flex flex-col items-start gap-0.5 font-normal">
                <span className="text-sm font-medium text-destructive">
                  {t.data.modeCascade}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t.data.modeCascadeDesc}
                </span>
              </Label>
            </div>
          </RadioGroup>

          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteProject}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t.common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Topic rename dialog ────────────────────── */}
      <Dialog
        open={editingTopic !== null}
        onOpenChange={(o) => !o && setEditingTopic(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t.data.topicRenameTitle}</DialogTitle>
            <DialogDescription className="sr-only">
              {t.data.topicRenameTitle}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="topic-label">{t.data.topicLabel}</Label>
            <Input
              id="topic-label"
              value={topicLabel}
              onChange={(e) => setTopicLabel(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditingTopic(null)}
            >
              {t.common.cancel}
            </Button>
            <Button size="sm" onClick={saveTopicLabel}>
              {t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Topic promote confirm ──────────────────── */}
      <AlertDialog
        open={topicToPromote !== null}
        onOpenChange={(o) => !o && setTopicToPromote(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.data.topicPromoteTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {topicToPromote?.label} — {t.data.topicPromoteDesc}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmPromoteTopic}>
              {t.data.topicPromote}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Topic delete ───────────────────────────── */}
      <AlertDialog
        open={topicToDelete !== null}
        onOpenChange={(o) => !o && setTopicToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.data.topicDeleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.data.topicDeleteConfirm}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (topicToDelete) removeTopic(topicToDelete.id);
                setTopicToDelete(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t.common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Category dialog ────────────────────────── */}
      <Dialog open={catOpen} onOpenChange={setCatOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingCat ? t.data.editCategory : t.data.newCategory}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t.data.editCategory}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cat-label">{t.data.categoryLabel}</Label>
              <Input
                id="cat-label"
                value={catDraft.label}
                onChange={(e) =>
                  setCatDraft((d) => ({ ...d, label: e.target.value }))
                }
              />
              {catError && (
                <p className="text-xs text-destructive">{catError}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cat-color">{t.data.categoryColor}</Label>
                <Input
                  id="cat-color"
                  type="color"
                  className="h-9 p-1"
                  value={catDraft.color}
                  onChange={(e) =>
                    setCatDraft((d) => ({ ...d, color: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cat-dark">{t.data.categoryDarkColor}</Label>
                <Input
                  id="cat-dark"
                  type="color"
                  className="h-9 p-1"
                  value={catDraft.darkColor}
                  onChange={(e) =>
                    setCatDraft((d) => ({ ...d, darkColor: e.target.value }))
                  }
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCatOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button size="sm" onClick={saveCat}>
              {t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Category delete ────────────────────────── */}
      <AlertDialog
        open={catToDelete !== null}
        onOpenChange={(o) => !o && setCatToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.data.deleteCategoryTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.data.deleteCategoryConfirm}
              {catToDelete && categoryUsage(catToDelete.id) > 0 && (
                <span className="mt-2 block text-destructive">
                  {t.data.categoryInUse.replace(
                    '{count}',
                    String(categoryUsage(catToDelete.id)),
                  )}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (catToDelete) removeCategory(catToDelete.id);
                setCatToDelete(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t.common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Capture delete ─────────────────────────── */}
      <AlertDialog
        open={captureToDelete !== null}
        onOpenChange={(o) => !o && setCaptureToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.data.deleteCaptureTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.data.deleteCaptureConfirm}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (captureToDelete) removeCapture(captureToDelete.id);
                setCaptureToDelete(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t.common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Reset all ──────────────────────────────── */}
      <AlertDialog
        open={resetOpen}
        onOpenChange={(o) => {
          setResetOpen(o);
          if (!o) setResetInput('');
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">
              {t.data.resetAll}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t.data.resetAllDesc}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reset-confirm">
              {t.data.resetTypeToConfirm.replace(
                '{word}',
                t.data.resetConfirmWord,
              )}
            </Label>
            <Input
              id="reset-confirm"
              value={resetInput}
              onChange={(e) => setResetInput(e.target.value)}
              placeholder={t.data.resetConfirmWord}
              autoComplete="off"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              disabled={resetInput.trim() !== t.data.resetConfirmWord}
              onClick={resetAll}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t.data.resetAll}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
