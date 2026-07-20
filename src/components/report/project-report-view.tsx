'use client';

// ==========================================
// 프로젝트 리포트 — 화면 + 인쇄(PDF)
// ==========================================
//
// PDF는 별도 라이브러리 없이 브라우저 인쇄로 만든다.
// jsPDF 계열은 한글 폰트를 따로 임베딩해야 해서(수 MB) 번들이 커지고,
// 브라우저 인쇄는 시스템 폰트를 그대로 써서 한글이 깨지지 않는다.
//
// 리포트 본문(#report-sheet)만 인쇄되도록 @media print에서
// 나머지를 전부 숨긴다.

import { useState, useMemo, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import {
  useProjectStore,
  useNodeStore,
  useLogStore,
  usePersonStore,
  useOrgStore,
  useTopicStore,
} from '@/lib/store';
import { buildDossier, detectSignals, actualProgress } from '@/lib/report';
import type { ProjectDossier, ProjectSignal } from '@/lib/report';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  Sparkles, Printer, Loader2, AlertTriangle, TriangleAlert,
  Info, CheckCircle2, FileText,
} from 'lucide-react';
import { toast } from 'sonner';

interface AiReport {
  headline: string;
  summary: string;
  progressReading: string;
  risks: { title: string; detail: string; severity: 'info' | 'warn' | 'risk' }[];
  nextActions: { action: string; why: string }[];
  closing: string;
  generatedAt: string;
}

const SEVERITY_STYLE = {
  risk: 'border-red-500/30 bg-red-50 dark:bg-red-950/30',
  warn: 'border-amber-500/30 bg-amber-50 dark:bg-amber-950/30',
  info: 'border-border bg-muted/40',
} as const;

const SEVERITY_ICON = {
  risk: TriangleAlert,
  warn: AlertTriangle,
  info: Info,
} as const;

const STATUS_LABEL: Record<string, string> = {
  scheduled: '예정', in_progress: '진행중', waiting: '대기', review: '검토',
  completed: '완료', on_hold: '보류', cancelled: '취소',
};

export function ProjectReportView() {
  const projects = useProjectStore((s) => s.projects);
  const allNodes = useNodeStore((s) => s.nodes);
  const logs = useLogStore((s) => s.logs);
  const people = usePersonStore((s) => s.people);
  const orgs = useOrgStore((s) => s.orgs);
  const topics = useTopicStore((s) => s.topics);

  const [projectId, setProjectId] = useState<string>('');
  const [report, setReport] = useState<AiReport | null>(null);
  const [loading, setLoading] = useState(false);

  // 프로젝트가 있으면 첫 번째를 미리 골라둔다. 빈 화면을 보여주는 것보다
  // 뭐라도 띄워놓고 사용자가 바꾸게 하는 편이 낫다.
  useEffect(() => {
    if (!projectId && projects.length > 0) setProjectId(projects[0].id);
  }, [projects, projectId]);

  const selected = projects.find((p) => p.id === projectId) ?? null;

  // 사실 집계는 항상 로컬에서 계산한다 (AI가 숫자를 만들지 못하게)
  const dossier: ProjectDossier | null = useMemo(() => {
    if (!selected) return null;
    const nodes = Object.values(allNodes).filter(
      (n) => n.projectId === selected.id || n.id === selected.id,
    );
    const nodeIds = new Set(nodes.map((n) => n.id));
    const projectLogs = Object.values(logs).filter((l) => nodeIds.has(l.nodeId));
    const topic =
      Object.values(topics).find((t) => t.promotedProjectId === selected.id) ?? null;
    return buildDossier({
      project: selected,
      nodes,
      logs: projectLogs,
      people: Object.values(people),
      orgs: Object.values(orgs),
      topic,
    });
  }, [selected, allNodes, logs, people, orgs, topics]);

  const signals: ProjectSignal[] = useMemo(
    () => (dossier ? detectSignals(dossier) : []),
    [dossier],
  );

  const generate = useCallback(async () => {
    if (!dossier) return;
    setLoading(true);
    setReport(null);
    try {
      const res = await fetch('/api/ai/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dossier,
          signals,
          actualProgress: actualProgress(dossier),
        }),
      });
      if (!res.ok) throw new Error('생성 실패');
      setReport(await res.json());
    } catch {
      toast.error('리포트 생성에 실패했습니다');
    } finally {
      setLoading(false);
    }
  }, [dossier, signals]);

  const maxActivity = Math.max(
    1,
    ...(dossier?.activity.map((a) => a.created + a.completed + a.updated) ?? [1]),
  );

  return (
    <div className="flex flex-col gap-4">
      {/* 인쇄 스타일 — 리포트 본문만 남기고 전부 숨긴다 */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #report-sheet, #report-sheet * { visibility: visible !important; }
          #report-sheet {
            position: absolute; left: 0; top: 0; width: 100%;
            padding: 0; margin: 0; box-shadow: none; border: none;
          }
          .no-print { display: none !important; }
          .print-break { break-inside: avoid; page-break-inside: avoid; }
          @page { margin: 16mm; }
        }
      `}</style>

      {/* ── 조작 바 (인쇄 제외) ── */}
      <div className="no-print flex flex-wrap items-center gap-2">
        <Select value={projectId} onValueChange={(v) => { setProjectId(v); setReport(null); }}>
          <SelectTrigger className="h-9 w-[240px] text-sm">
            <SelectValue placeholder="프로젝트를 선택하세요" />
          </SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button size="sm" className="h-9 gap-1.5" onClick={generate} disabled={!dossier || loading}>
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          {loading ? '분석 중...' : report ? '다시 생성' : '리포트 생성'}
        </Button>

        <Button
          variant="outline" size="sm" className="h-9 gap-1.5"
          onClick={() => window.print()}
          disabled={!report}
          title="브라우저 인쇄 창에서 'PDF로 저장'을 선택하세요"
        >
          <Printer className="size-3.5" />
          PDF로 저장
        </Button>
      </div>

      {projects.length === 0 && (
        <div className="no-print flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-muted-foreground">
          <FileText className="size-10 opacity-20" />
          <p className="text-sm">프로젝트가 없습니다. 먼저 프로젝트를 만들어 주세요.</p>
        </div>
      )}

      {!dossier && projects.length > 0 && (
        <div className="no-print flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-muted-foreground">
          <FileText className="size-10 opacity-20" />
          <p className="text-sm">
            프로젝트를 선택하면 진행 상황·관계자·정체 구간을 분석한 리포트를 만듭니다.
          </p>
        </div>
      )}

      {/* ── 리포트 본문 ── */}
      {dossier && (
        <div id="report-sheet" className="rounded-lg border bg-card p-6 print:p-0">
          {/* 표지 */}
          <header className="print-break">
            <p className="text-xs text-muted-foreground">프로젝트 리포트</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight">
              {dossier.project.title}
            </h1>
            {dossier.project.description && (
              <p className="mt-1 text-sm text-muted-foreground">
                {dossier.project.description}
              </p>
            )}
            <p className="mt-2 text-[11px] text-muted-foreground">
              생성일 {new Date(report?.generatedAt ?? Date.now()).toLocaleString('ko-KR')}
              {dossier.timeline.startedAt && ` · 시작 ${dossier.timeline.startedAt}`}
            </p>
          </header>

          {report && (
            <div className="mt-4 rounded-lg border-l-4 border-primary bg-primary/5 p-3 print-break">
              <p className="text-sm font-semibold">{report.headline}</p>
            </div>
          )}

          <Separator className="my-5" />

          {/* 진행 현황 */}
          <section className="print-break">
            <h2 className="mb-3 text-sm font-semibold">진행 현황</h2>
            <div className="mb-3 flex items-center gap-3">
              <Progress value={actualProgress(dossier)} className="h-2 flex-1" />
              <span className="text-sm font-medium tabular-nums">
                {actualProgress(dossier)}%
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: '전체', value: dossier.counts.total },
                { label: '완료', value: dossier.counts.completed },
                { label: '진행중', value: dossier.counts.inProgress },
                { label: '미착수', value: dossier.counts.notStarted },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border p-2.5 text-center">
                  <p className="text-lg font-bold tabular-nums">{s.value}</p>
                  <p className="text-[11px] text-muted-foreground">{s.label}</p>
                </div>
              ))}
            </div>
            {(dossier.counts.overdue > 0 ||
              dossier.counts.blocked > 0 ||
              dossier.counts.missingDeliverable > 0) && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {dossier.counts.overdue > 0 && (
                  <Badge variant="outline" className="border-red-500/40 text-red-600 dark:text-red-400">
                    마감 초과 {dossier.counts.overdue}
                  </Badge>
                )}
                {dossier.counts.blocked > 0 && (
                  <Badge variant="outline" className="border-amber-500/40 text-amber-600 dark:text-amber-400">
                    차단됨 {dossier.counts.blocked}
                  </Badge>
                )}
                {dossier.counts.missingDeliverable > 0 && (
                  <Badge variant="outline">
                    결과물 미등록 {dossier.counts.missingDeliverable}
                  </Badge>
                )}
              </div>
            )}
            {report && (
              <p className="mt-3 text-sm leading-relaxed">{report.progressReading}</p>
            )}
          </section>

          {report?.summary && (
            <>
              <Separator className="my-5" />
              <section className="print-break">
                <h2 className="mb-2 text-sm font-semibold">개요</h2>
                <p className="text-sm leading-relaxed">{report.summary}</p>
              </section>
            </>
          )}

          {/* 활동 추이 */}
          {dossier.activity.length > 0 && (
            <>
              <Separator className="my-5" />
              <section className="print-break">
                <h2 className="mb-3 text-sm font-semibold">활동 추이</h2>
                <div className="space-y-1.5">
                  {dossier.activity.map((a) => {
                    const total = a.created + a.completed + a.updated;
                    return (
                      <div key={a.period} className="flex items-center gap-2">
                        <span className="w-16 shrink-0 text-[11px] tabular-nums text-muted-foreground">
                          {a.period}
                        </span>
                        <div className="flex h-4 flex-1 overflow-hidden rounded bg-muted">
                          <div className="bg-emerald-500" style={{ width: `${(a.completed / maxActivity) * 100}%` }} />
                          <div className="bg-sky-500" style={{ width: `${(a.created / maxActivity) * 100}%` }} />
                          <div className="bg-muted-foreground/30" style={{ width: `${(a.updated / maxActivity) * 100}%` }} />
                        </div>
                        <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                          {total}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2 flex gap-3 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-emerald-500" />완료</span>
                  <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-sky-500" />생성</span>
                  <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-muted-foreground/30" />수정</span>
                </div>
                {dossier.timeline.daysSinceLastActivity != null && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    마지막 활동: {dossier.timeline.lastActivityAt} (
                    {dossier.timeline.daysSinceLastActivity}일 전)
                  </p>
                )}
              </section>
            </>
          )}

          {/* 리스크 */}
          {(report?.risks.length || signals.length) > 0 && (
            <>
              <Separator className="my-5" />
              <section className="print-break">
                <h2 className="mb-3 text-sm font-semibold">주의할 점</h2>
                <div className="space-y-2">
                  {(report?.risks.length
                    ? report.risks
                    : signals.map((s) => ({
                        title: s.message, detail: '', severity: s.severity,
                      }))
                  ).map((r, i) => {
                    const Icon = SEVERITY_ICON[r.severity] ?? Info;
                    return (
                      <div key={i} className={cn('flex gap-2 rounded-lg border p-2.5', SEVERITY_STYLE[r.severity])}>
                        <Icon className="mt-0.5 size-3.5 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs font-medium">{r.title}</p>
                          {r.detail && (
                            <p className="mt-0.5 text-xs text-muted-foreground">{r.detail}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </>
          )}

          {/* 다음 액션 */}
          {report && report.nextActions.length > 0 && (
            <>
              <Separator className="my-5" />
              <section className="print-break">
                <h2 className="mb-3 text-sm font-semibold">다음 액션</h2>
                <ol className="space-y-2">
                  {report.nextActions.map((a, i) => (
                    <li key={i} className="flex gap-2.5">
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{a.action}</p>
                        <p className="text-xs text-muted-foreground">{a.why}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            </>
          )}

          {/* 항목 목록 */}
          {dossier.tasks.length > 0 && (
            <>
              <Separator className="my-5" />
              <section className="print-break">
                <h2 className="mb-2 text-sm font-semibold">
                  항목 ({dossier.tasks.length})
                </h2>
                <table className="w-full text-left text-xs">
                  <thead className="border-b text-muted-foreground">
                    <tr>
                      <th className="py-1.5 font-medium">항목</th>
                      <th className="w-16 py-1.5 font-medium">상태</th>
                      <th className="w-24 py-1.5 font-medium">마감</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dossier.tasks.map((t) => (
                      <tr key={t.id} className="border-b last:border-0">
                        <td className="py-1.5">
                          <span className={cn(t.status === 'completed' && 'text-muted-foreground line-through')}>
                            {t.title || '(제목 없음)'}
                          </span>
                          {t.missingDeliverable && (
                            <span className="ml-1.5 text-[10px] text-muted-foreground">결과물 미등록</span>
                          )}
                        </td>
                        <td className="py-1.5">
                          <span className={cn(
                            'rounded px-1.5 py-0.5 text-[10px]',
                            t.status === 'completed' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400' : 'bg-muted',
                          )}>
                            {STATUS_LABEL[t.status] ?? t.status}
                          </span>
                        </td>
                        <td className={cn('py-1.5 tabular-nums', t.overdue && 'font-medium text-red-600 dark:text-red-400')}>
                          {t.dueAt ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </>
          )}

          {/* 관계자 */}
          {(dossier.people.length > 0 || dossier.orgs.length > 0) && (
            <>
              <Separator className="my-5" />
              <section className="print-break">
                <h2 className="mb-2 text-sm font-semibold">관계자</h2>
                <div className="flex flex-wrap gap-1.5">
                  {dossier.people.map((p) => (
                    <Badge key={p.name} variant="secondary" className="font-normal">
                      {p.name}
                      {p.role && <span className="ml-1 opacity-60">{p.role}</span>}
                    </Badge>
                  ))}
                  {dossier.orgs.map((o) => (
                    <Badge key={o.name} variant="outline" className="font-normal">
                      {o.name}
                    </Badge>
                  ))}
                </div>
              </section>
            </>
          )}

          {/* 시작 배경 */}
          {dossier.origin && dossier.origin.notes.length > 0 && (
            <>
              <Separator className="my-5" />
              <section className="print-break">
                <h2 className="mb-2 text-sm font-semibold">
                  시작 배경 — &lsquo;{dossier.origin.topicLabel}&rsquo;에서 시작
                </h2>
                <ul className="space-y-1">
                  {dossier.origin.notes.map((n, i) => (
                    <li key={i} className="text-xs text-muted-foreground">· {n}</li>
                  ))}
                </ul>
              </section>
            </>
          )}

          {report?.closing && (
            <>
              <Separator className="my-5" />
              <p className="text-sm leading-relaxed">{report.closing}</p>
            </>
          )}

          {!report && (
            <p className="no-print mt-5 rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
              위 &lsquo;리포트 생성&rsquo;을 누르면 AI가 이 데이터를 해석해 개요·리스크·다음 액션을 덧붙입니다.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
