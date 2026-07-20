'use client';

import { useMemo, useState } from 'react';
import {
  Users,
  Building2,
  Plus,
  Search,
  Phone,
  Mail,
  Trash2,
  Link2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
import { usePersonStore, useOrgStore, useNodeStore } from '@/lib/store';
import { createPerson, createOrganization } from '@/lib/services';
import type { Person, Organization } from '@/lib/types';

const WS = 'demo-workspace';

// ─── Person Editor ────────────────────────────────────────

interface PersonDraft {
  name: string;
  role: string;
  org: string;
  phone: string;
  email: string;
  tags: string;
  note: string;
}

function toPersonDraft(p: Person | null): PersonDraft {
  return {
    name: p?.name ?? '',
    role: p?.role ?? '',
    org: p?.org ?? '',
    phone: p?.phone ?? '',
    email: p?.email ?? '',
    tags: (p?.tags ?? []).join(', '),
    note: p?.note ?? '',
  };
}

function splitTags(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function nullable(v: string): string | null {
  const trimmed = v.trim();
  return trimmed.length ? trimmed : null;
}

// ─── Component ────────────────────────────────────────────

export function PeopleView() {
  const { t } = useLocale();

  const people = usePersonStore((s) => s.people);
  const addPerson = usePersonStore((s) => s.addPerson);
  const updatePerson = usePersonStore((s) => s.updatePerson);
  const removePerson = usePersonStore((s) => s.removePerson);

  const orgs = useOrgStore((s) => s.orgs);
  const addOrg = useOrgStore((s) => s.addOrg);
  const updateOrg = useOrgStore((s) => s.updateOrg);
  const removeOrg = useOrgStore((s) => s.removeOrg);

  const nodes = useNodeStore((s) => s.nodes);

  const [search, setSearch] = useState('');

  // person dialog state
  const [personOpen, setPersonOpen] = useState(false);
  const [editingPerson, setEditingPerson] = useState<Person | null>(null);
  const [personDraft, setPersonDraft] = useState<PersonDraft>(toPersonDraft(null));
  const [personError, setPersonError] = useState<string | null>(null);
  const [personToDelete, setPersonToDelete] = useState<Person | null>(null);

  // org dialog state
  const [orgOpen, setOrgOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null);
  const [orgDraft, setOrgDraft] = useState({ name: '', orgType: '', note: '' });
  const [orgError, setOrgError] = useState<string | null>(null);
  const [orgToDelete, setOrgToDelete] = useState<Organization | null>(null);

  const peopleList = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = Object.values(people).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    if (!q) return all;
    return all.filter((p) =>
      [p.name, p.org ?? '', p.phone ?? '']
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [people, search]);

  const orgList = useMemo(
    () => Object.values(orgs).sort((a, b) => a.name.localeCompare(b.name)),
    [orgs],
  );

  const relatedTitles = (ids: string[]): string[] =>
    ids.map((id) => nodes[id]?.title).filter((v): v is string => !!v);

  // ── person handlers ──
  const openNewPerson = () => {
    setEditingPerson(null);
    setPersonDraft(toPersonDraft(null));
    setPersonError(null);
    setPersonOpen(true);
  };

  const openEditPerson = (p: Person) => {
    setEditingPerson(p);
    setPersonDraft(toPersonDraft(p));
    setPersonError(null);
    setPersonOpen(true);
  };

  const savePerson = () => {
    if (!personDraft.name.trim()) {
      setPersonError(t.people.nameRequired);
      return;
    }
    const orgName = nullable(personDraft.org);
    const matchedOrg = orgName
      ? orgList.find(
          (o) =>
            o.name.replace(/\s+/g, '').toLowerCase() ===
            orgName.replace(/\s+/g, '').toLowerCase(),
        ) ?? null
      : null;

    const fields = {
      name: personDraft.name.trim(),
      role: nullable(personDraft.role),
      org: orgName,
      orgId: matchedOrg?.id ?? null,
      phone: nullable(personDraft.phone),
      email: nullable(personDraft.email),
      tags: splitTags(personDraft.tags),
      note: personDraft.note.trim(),
    };

    if (editingPerson) {
      updatePerson(editingPerson.id, fields);
      // 소속이 바뀌었으면 조직 멤버 목록 정리
      if (editingPerson.orgId !== fields.orgId) {
        if (editingPerson.orgId) {
          const prev = orgs[editingPerson.orgId];
          if (prev) {
            updateOrg(prev.id, {
              memberIds: prev.memberIds.filter((m) => m !== editingPerson.id),
            });
          }
        }
        if (matchedOrg && !matchedOrg.memberIds.includes(editingPerson.id)) {
          updateOrg(matchedOrg.id, {
            memberIds: [...matchedOrg.memberIds, editingPerson.id],
          });
        }
      }
    } else {
      const created = createPerson({ workspaceId: WS, ...fields });
      addPerson(created);
      if (matchedOrg) {
        updateOrg(matchedOrg.id, {
          memberIds: [...matchedOrg.memberIds, created.id],
        });
      }
    }
    setPersonOpen(false);
  };

  const confirmDeletePerson = () => {
    if (!personToDelete) return;
    // 이 인물이 속한 모든 조직의 memberIds에서 제거
    for (const o of Object.values(orgs)) {
      if (o.memberIds.includes(personToDelete.id)) {
        updateOrg(o.id, {
          memberIds: o.memberIds.filter((m) => m !== personToDelete.id),
        });
      }
    }
    removePerson(personToDelete.id);
    setPersonToDelete(null);
    setPersonOpen(false);
  };

  // ── org handlers ──
  const openNewOrg = () => {
    setEditingOrg(null);
    setOrgDraft({ name: '', orgType: '', note: '' });
    setOrgError(null);
    setOrgOpen(true);
  };

  const openEditOrg = (o: Organization) => {
    setEditingOrg(o);
    setOrgDraft({
      name: o.name,
      orgType: o.orgType ?? '',
      note: o.note ?? '',
    });
    setOrgError(null);
    setOrgOpen(true);
  };

  const saveOrg = () => {
    if (!orgDraft.name.trim()) {
      setOrgError(t.people.nameRequired);
      return;
    }
    const fields = {
      name: orgDraft.name.trim(),
      orgType: nullable(orgDraft.orgType),
      note: orgDraft.note.trim(),
    };
    if (editingOrg) {
      updateOrg(editingOrg.id, fields);
    } else {
      addOrg(createOrganization({ workspaceId: WS, ...fields }));
    }
    setOrgOpen(false);
  };

  const confirmDeleteOrg = () => {
    if (!orgToDelete) return;
    // 이 조직을 참조하던 인물의 orgId 해제
    for (const p of Object.values(people)) {
      if (p.orgId === orgToDelete.id) {
        updatePerson(p.id, { orgId: null });
      }
    }
    removeOrg(orgToDelete.id);
    setOrgToDelete(null);
    setOrgOpen(false);
  };

  return (
    <div className="flex flex-col gap-4">
      <Tabs defaultValue="people" className="w-full">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="people" className="gap-1.5">
              <Users className="size-3.5" />
              {t.people.tabPeople}
              <span className="text-muted-foreground">
                ({Object.keys(people).length})
              </span>
            </TabsTrigger>
            <TabsTrigger value="orgs" className="gap-1.5">
              <Building2 className="size-3.5" />
              {t.people.tabOrgs}
              <span className="text-muted-foreground">({orgList.length})</span>
            </TabsTrigger>
          </TabsList>
        </div>

        {/* ── People tab ───────────────────────────── */}
        <TabsContent value="people" className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.people.searchPlaceholder}
                className="h-9 pl-8"
              />
            </div>
            <Button size="sm" className="h-9 gap-1.5" onClick={openNewPerson}>
              <Plus className="size-4" />
              {t.people.addPerson}
            </Button>
          </div>

          {peopleList.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
              <Users className="size-8 opacity-30" />
              <p className="text-sm">{t.people.noPeople}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {peopleList.map((p) => {
                const titles = relatedTitles(p.relatedNodeIds);
                return (
                  <div
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openEditPerson(p)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') openEditPerson(p);
                    }}
                    className="cursor-pointer rounded-lg border p-3 text-left transition-colors hover:bg-muted/50"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="text-sm font-semibold">{p.name}</span>
                      {p.role && (
                        <span className="text-xs text-muted-foreground">
                          {p.role}
                        </span>
                      )}
                      {p.org && (
                        <Badge variant="secondary" className="text-[10px]">
                          {p.org}
                        </Badge>
                      )}
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      {p.phone && (
                        <a
                          href={`tel:${p.phone}`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          <Phone className="size-3" />
                          {p.phone}
                        </a>
                      )}
                      {p.email && (
                        <a
                          href={`mailto:${p.email}`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          <Mail className="size-3" />
                          {p.email}
                        </a>
                      )}
                    </div>

                    {p.tags.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {p.tags.map((tag) => (
                          <Badge
                            key={tag}
                            variant="outline"
                            className="text-[10px]"
                          >
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {p.note && (
                      <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
                        {p.note}
                      </p>
                    )}

                    <div className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
                      <Link2 className="mt-0.5 size-3 shrink-0" />
                      <span className="min-w-0">
                        {titles.length === 0
                          ? t.people.noRelated
                          : titles.join(' · ')}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── Orgs tab ─────────────────────────────── */}
        <TabsContent value="orgs" className="mt-4 flex flex-col gap-3">
          <div className="flex justify-end">
            <Button size="sm" className="h-9 gap-1.5" onClick={openNewOrg}>
              <Plus className="size-4" />
              {t.people.addOrg}
            </Button>
          </div>

          {orgList.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
              <Building2 className="size-8 opacity-30" />
              <p className="text-sm">{t.people.noOrgs}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {orgList.map((o) => {
                const members = o.memberIds
                  .map((id) => people[id])
                  .filter((v): v is Person => !!v);
                return (
                  <div
                    key={o.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openEditOrg(o)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') openEditOrg(o);
                    }}
                    className="cursor-pointer rounded-lg border p-3 text-left transition-colors hover:bg-muted/50"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="text-sm font-semibold">{o.name}</span>
                      {o.orgType && (
                        <Badge variant="secondary" className="text-[10px]">
                          {o.orgType}
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {t.people.memberCount}: {members.length}
                      </span>
                    </div>

                    {o.note && (
                      <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
                        {o.note}
                      </p>
                    )}

                    <div className="mt-2 flex flex-wrap gap-1">
                      {members.length === 0 ? (
                        <span className="text-xs text-muted-foreground">
                          {t.people.noMembers}
                        </span>
                      ) : (
                        members.map((m) => (
                          <Badge
                            key={m.id}
                            variant="outline"
                            className="text-[10px]"
                          >
                            {m.name}
                            {m.role ? ` · ${m.role}` : ''}
                          </Badge>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Person Dialog ──────────────────────────── */}
      <Dialog open={personOpen} onOpenChange={setPersonOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingPerson ? t.people.editPerson : t.people.newPerson}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t.people.editPerson}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="p-name">{t.people.name}</Label>
              <Input
                id="p-name"
                value={personDraft.name}
                onChange={(e) =>
                  setPersonDraft((d) => ({ ...d, name: e.target.value }))
                }
              />
              {personError && (
                <p className="text-xs text-destructive">{personError}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="p-role">{t.people.role}</Label>
                <Input
                  id="p-role"
                  value={personDraft.role}
                  onChange={(e) =>
                    setPersonDraft((d) => ({ ...d, role: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-org">{t.people.org}</Label>
                <Input
                  id="p-org"
                  value={personDraft.org}
                  onChange={(e) =>
                    setPersonDraft((d) => ({ ...d, org: e.target.value }))
                  }
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="p-phone">{t.people.phone}</Label>
                <Input
                  id="p-phone"
                  value={personDraft.phone}
                  onChange={(e) =>
                    setPersonDraft((d) => ({ ...d, phone: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-email">{t.people.email}</Label>
                <Input
                  id="p-email"
                  value={personDraft.email}
                  onChange={(e) =>
                    setPersonDraft((d) => ({ ...d, email: e.target.value }))
                  }
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-tags">{t.people.tags}</Label>
              <Input
                id="p-tags"
                value={personDraft.tags}
                placeholder={t.people.tagsPlaceholder}
                onChange={(e) =>
                  setPersonDraft((d) => ({ ...d, tags: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-note">{t.people.note}</Label>
              <Textarea
                id="p-note"
                rows={3}
                value={personDraft.note}
                onChange={(e) =>
                  setPersonDraft((d) => ({ ...d, note: e.target.value }))
                }
              />
            </div>

            {editingPerson && (
              <>
                <Separator />
                <div className="space-y-1.5">
                  <Label>{t.people.relatedNodes}</Label>
                  <div className="flex flex-wrap gap-1">
                    {relatedTitles(editingPerson.relatedNodeIds).length === 0 ? (
                      <span className="text-xs text-muted-foreground">
                        {t.people.noRelated}
                      </span>
                    ) : (
                      relatedTitles(editingPerson.relatedNodeIds).map(
                        (title, i) => (
                          <Badge
                            key={`${title}-${i}`}
                            variant="outline"
                            className="text-[10px]"
                          >
                            {title}
                          </Badge>
                        ),
                      )
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            {editingPerson ? (
              <Button
                variant="destructive"
                size="sm"
                className="gap-1.5"
                onClick={() => setPersonToDelete(editingPerson)}
              >
                <Trash2 className="size-4" />
                {t.common.delete}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPersonOpen(false)}
              >
                {t.common.cancel}
              </Button>
              <Button size="sm" onClick={savePerson}>
                {t.common.save}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Org Dialog ─────────────────────────────── */}
      <Dialog open={orgOpen} onOpenChange={setOrgOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingOrg ? t.people.editOrg : t.people.newOrg}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t.people.editOrg}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="o-name">{t.people.name}</Label>
              <Input
                id="o-name"
                value={orgDraft.name}
                onChange={(e) =>
                  setOrgDraft((d) => ({ ...d, name: e.target.value }))
                }
              />
              {orgError && (
                <p className="text-xs text-destructive">{orgError}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="o-type">{t.people.orgType}</Label>
              <Input
                id="o-type"
                value={orgDraft.orgType}
                onChange={(e) =>
                  setOrgDraft((d) => ({ ...d, orgType: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="o-note">{t.people.note}</Label>
              <Textarea
                id="o-note"
                rows={3}
                value={orgDraft.note}
                onChange={(e) =>
                  setOrgDraft((d) => ({ ...d, note: e.target.value }))
                }
              />
            </div>

            {editingOrg && (
              <>
                <Separator />
                <div className="space-y-1.5">
                  <Label>{t.people.members}</Label>
                  <div className="flex flex-wrap gap-1">
                    {editingOrg.memberIds.filter((id) => people[id]).length ===
                    0 ? (
                      <span className="text-xs text-muted-foreground">
                        {t.people.noMembers}
                      </span>
                    ) : (
                      editingOrg.memberIds
                        .map((id) => people[id])
                        .filter((v): v is Person => !!v)
                        .map((m) => (
                          <Badge
                            key={m.id}
                            variant="outline"
                            className="text-[10px]"
                          >
                            {m.name}
                          </Badge>
                        ))
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            {editingOrg ? (
              <Button
                variant="destructive"
                size="sm"
                className="gap-1.5"
                onClick={() => setOrgToDelete(editingOrg)}
              >
                <Trash2 className="size-4" />
                {t.common.delete}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOrgOpen(false)}
              >
                {t.common.cancel}
              </Button>
              <Button size="sm" onClick={saveOrg}>
                {t.common.save}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmations ───────────────────── */}
      <AlertDialog
        open={personToDelete !== null}
        onOpenChange={(o) => !o && setPersonToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.people.deletePersonTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.people.deletePersonConfirm}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeletePerson}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t.common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={orgToDelete !== null}
        onOpenChange={(o) => !o && setOrgToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.people.deleteOrgTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.people.deleteOrgConfirm}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteOrg}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t.common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
