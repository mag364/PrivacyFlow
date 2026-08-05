import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import clsx from 'clsx';
import {
  ArrowLeft, ClipboardList, MessageSquare, ShieldCheck, Paperclip,
  Pencil, Check, X, Save, ExternalLink, Plus,
} from 'lucide-react';
import { platform } from '../../platform';
import type { Project, AuditEvent, Communication, NoteTemplate } from '@shared/types';
import { PROJECT_STATUSES } from '@shared/constants';
import { projectPlaceholderValues, replacePlaceholders } from '@shared/placeholders';
import {
  GlassPanel, GlassBadge, GlassButton, GlassInput, GlassSelect, GlassTextarea,
  Spinner, EmptyState, Field,
} from '../../components/glass';
import { fmtDate, fmtDateTime, statusTone } from '../../lib/format';
import { useAuth, can } from '../../store/auth';
import { insertTextAtCursor } from '../../lib/textInsert';
import { isWebUrl, openExternalUrl } from '../../platform/workspace';
import { appendProjectComment } from '../../lib/projectComments';

type TabKey = 'overview' | 'communications' | 'comments' | 'audit';

const TABS: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'overview', label: 'Overview', icon: ClipboardList },
  { key: 'communications', label: 'Communications', icon: MessageSquare },
  { key: 'comments', label: 'Comments', icon: MessageSquare },
  { key: 'audit', label: 'Audit', icon: ShieldCheck },
];

const SOURCES = ['DD', 'SSDS', 'Lighthouse'];
const INVESTMENT_CLASSES = ['CTB', 'KTLO', 'RTB', 'Not Listed'];

export function ProjectDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [project, setProject] = React.useState<Project | null | undefined>(undefined);
  const [tab, setTab] = React.useState<TabKey>('overview');
  const [audit, setAudit] = React.useState<AuditEvent[]>([]);
  const [comms, setComms] = React.useState<Communication[]>([]);

  // Editable overview (draft mirrors the project when edit mode opens)
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState<Project | null>(null);
  const [saveBusy, setSaveBusy] = React.useState(false);
  const [saveError, setSaveError] = React.useState('');
  const [commentTemplates, setCommentTemplates] = React.useState<NoteTemplate[]>([]);
  const [orgName, setOrgName] = React.useState('');
  const commentsRef = React.useRef<HTMLTextAreaElement | null>(null);

  // Append-only comment form on the Comments tab
  const [addingComment, setAddingComment] = React.useState(false);
  const [commentText, setCommentText] = React.useState('');
  const [commentError, setCommentError] = React.useState('');
  const [commentBusy, setCommentBusy] = React.useState(false);
  const newCommentRef = React.useRef<HTMLTextAreaElement | null>(null);

  // Workflow status change
  const [statusReason, setStatusReason] = React.useState('');
  const [statusBusy, setStatusBusy] = React.useState(false);

  // Project number (ServiceNow) editing
  const [editingNumber, setEditingNumber] = React.useState(false);
  const [numberDraft, setNumberDraft] = React.useState('');
  const [numberError, setNumberError] = React.useState('');
  const [numberBusy, setNumberBusy] = React.useState(false);

  // Add File (communications) form
  const [addingComm, setAddingComm] = React.useState(false);
  const [commSubject, setCommSubject] = React.useState('');
  const [commSummary, setCommSummary] = React.useState('');
  const [commFile, setCommFile] = React.useState<File | null>(null);
  const [commError, setCommError] = React.useState('');
  const [commBusy, setCommBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const list = await platform().projects.list();
    const found = list.find((p) => p.id === id) ?? null;
    setProject(found);
    if (found) {
      const all = await platform().audit.list();
      setAudit(all.filter((e) => e.entityType === 'project' && e.entityId === id));
      setComms(await platform().projects.communications(id));
    }
  }, [id]);

  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => {
    platform().system.settings()
      .then((settings) => {
        setOrgName(settings.organizationName);
        setCommentTemplates((settings.noteTemplates ?? []).filter((template) => template.target === 'comments'));
      })
      .catch(() => setCommentTemplates([]));
  }, []);

  if (project === undefined) return <Spinner label="Loading data notification…" />;
  if (project === null) {
    return (
      <GlassPanel>
        <EmptyState title="Data notification not found" description="This data notification may have been removed." />
        <div className="mt-4 flex justify-center">
          <GlassButton onClick={() => navigate('/tasks')}>Back to data notifications</GlassButton>
        </div>
      </GlassPanel>
    );
  }

  const p = project;
  const canEdit = can(user?.role, 'projects.update');

  function startEdit() {
    setDraft(JSON.parse(JSON.stringify(p)) as Project);
    setSaveError('');
    setEditing(true);
  }

  async function saveEdit() {
    if (!draft) return;
    if (!draft.projectName.trim()) { setSaveError('Project Name is required.'); return; }
    if (!draft.description.trim()) { setSaveError('Description is required.'); return; }
    if (draft.oneTrustUrl?.trim() && !isWebUrl(draft.oneTrustUrl)) { setSaveError('OneTrust Link must be a complete HTTP or HTTPS URL.'); return; }
    setSaveBusy(true);
    setSaveError('');
    try {
      await platform().projects.update(id, {
        projectName: draft.projectName,
        status: draft.status,
        source: draft.source,
        dateNotificationReceived: draft.notificationCancelled ? undefined : draft.dateNotificationReceived || undefined,
        notificationCancelled: draft.notificationCancelled,
        ritmNumber: draft.ritmNumber || undefined,
        investmentClass: draft.investmentClass,
        description: draft.description,
        piaNumber: draft.piaNumber || undefined,
        oneTrustProjectId: draft.oneTrustProjectId?.trim() || undefined,
        oneTrustUrl: draft.oneTrustUrl?.trim() || undefined,
        comments: draft.comments ?? undefined,
      });
      setEditing(false);
      setDraft(null);
      await load();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Unable to save changes.');
    } finally {
      setSaveBusy(false);
    }
  }

  async function changeStatus(to: string) {
    setStatusBusy(true);
    try {
      await platform().projects.update(id, { status: to as Project['status'] }, statusReason || undefined);
      setStatusReason('');
      await load();
    } finally {
      setStatusBusy(false);
    }
  }

  async function saveProjectNumber() {
    const trimmed = numberDraft.trim();
    if (!trimmed) { setNumberError('Project number cannot be empty.'); return; }
    setNumberBusy(true);
    setNumberError('');
    try {
      await platform().projects.updateProjectNumber(id, trimmed);
      setEditingNumber(false);
      await load();
    } catch (e) {
      setNumberError(e instanceof Error ? e.message : 'Unable to update the project number.');
    } finally {
      setNumberBusy(false);
    }
  }

  async function submitCommunication(ev: React.FormEvent) {
    ev.preventDefault();
    const subject = commSubject.trim() || commFile?.name || '';
    if (!subject) { setCommError('Choose a file or enter a subject.'); return; }
    setCommBusy(true);
    setCommError('');
    try {
      await platform().projects.addCommunication(id, {
        subject,
        summary: commSummary.trim() || `Attached file: ${subject}${commFile ? ` (${(commFile.size / 1024).toFixed(0)} KB)` : ''}`,
        direction: 'Inbound',
        channel: 'File attachment',
      });
      setAddingComm(false);
      setCommSubject('');
      setCommSummary('');
      setCommFile(null);
      await load();
    } catch (e) {
      setCommError(e instanceof Error ? e.message : 'Unable to add the file.');
    } finally {
      setCommBusy(false);
    }
  }

  const setD = (patch: Partial<Project>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  function insertCommentTemplate(template: NoteTemplate) {
    setDraft((current) => {
      if (!current) return current;
      const body = replacePlaceholders(template.body, projectPlaceholderValues(current, orgName));
      return {
        ...current,
        comments: insertTextAtCursor(commentsRef.current, current.comments ?? '', body),
      };
    });
  }

  function insertNewCommentTemplate(template: NoteTemplate) {
    const body = replacePlaceholders(template.body, projectPlaceholderValues(p, orgName));
    setCommentText((current) => insertTextAtCursor(newCommentRef.current, current, body));
  }

  async function submitComment(ev: React.FormEvent) {
    ev.preventDefault();
    if (!commentText.trim()) {
      setCommentError('Enter a comment.');
      return;
    }
    setCommentBusy(true);
    setCommentError('');
    try {
      const actor = user?.name || user?.username || 'User';
      const timestamp = new Intl.DateTimeFormat('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      }).format(new Date());
      await platform().projects.update(id, {
        comments: appendProjectComment(p.comments, commentText, actor, timestamp),
      }, 'Added a comment');
      setCommentText('');
      setAddingComment(false);
      await load();
    } catch (e) {
      setCommentError(e instanceof Error ? e.message : 'Unable to add the comment.');
    } finally {
      setCommentBusy(false);
    }
  }

  return (
    <div>
      <button onClick={() => navigate('/tasks')} className="mb-3 flex items-center gap-1.5 text-sm text-muted hover:text-ink focus-ring">
        <ArrowLeft className="h-4 w-4" /> Back to data notifications
      </button>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Data Notification Details</p>
          {editingNumber ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <GlassInput
                  className="w-64 text-lg font-bold"
                  value={numberDraft}
                  onChange={(e) => setNumberDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); saveProjectNumber(); }
                    if (e.key === 'Escape') setEditingNumber(false);
                  }}
                  autoFocus
                />
                <GlassButton variant="primary" className="px-3 py-2" loading={numberBusy} onClick={saveProjectNumber}>
                  <Check className="h-4 w-4" />
                </GlassButton>
                <GlassButton variant="ghost" className="px-3 py-2" onClick={() => { setEditingNumber(false); setNumberError(''); }}>
                  <X className="h-4 w-4" />
                </GlassButton>
              </div>
              {numberError
                ? <p className="text-xs text-red-400">{numberError}</p>
                : <p className="text-xs text-muted">Enter the number assigned by ServiceNow.</p>}
            </div>
          ) : (
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-ink">
              {p.projectNumber}
              {canEdit && (
                <button
                  onClick={() => { setNumberDraft(p.projectNumber); setNumberError(''); setEditingNumber(true); }}
                  className="rounded-lg p-1.5 text-muted hover:bg-[var(--pf-highlight)] hover:text-ink focus-ring"
                  title="Edit project number (e.g. the number ServiceNow assigns)"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              )}
            </h1>
          )}
          <p className="mt-1 text-sm text-muted">{p.projectName} · {p.source}</p>
        </div>
        <div className="flex items-center gap-2">
          <GlassBadge tone={statusTone(p.status)}>{p.status}</GlassBadge>
          {p.notificationCancelled && <GlassBadge tone="danger">Cancelled</GlassBadge>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        <div className="lg:col-span-3">
          <div className="mb-4 flex flex-wrap gap-1 border-b border-line pb-2">
            {TABS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={clsx(
                  'flex items-center gap-1.5 rounded-capsule px-3 py-1.5 text-sm font-medium transition-all focus-ring',
                  tab === key ? 'bg-accent/15 text-ink' : 'text-muted hover:text-ink',
                )}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <div className="flex flex-col gap-4">
              <div className="flex justify-end gap-2">
                {canEdit && !editing && (
                  <GlassButton className="px-3 py-1.5 text-xs" onClick={startEdit}>
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </GlassButton>
                )}
                {editing && (
                  <>
                    <GlassButton className="px-3 py-1.5 text-xs" onClick={() => { setEditing(false); setDraft(null); setSaveError(''); }}>
                      Cancel
                    </GlassButton>
                    <GlassButton variant="primary" className="px-3 py-1.5 text-xs" loading={saveBusy} onClick={saveEdit}>
                      <Save className="h-3.5 w-3.5" /> Save changes
                    </GlassButton>
                  </>
                )}
              </div>

              {saveError && <p className="text-xs text-red-400">{saveError}</p>}

              {!editing ? (
                <>
                  <GlassPanel>
                    <h3 className="mb-2 text-sm font-semibold text-ink">Request Description/Explanation</h3>
                    <p className="text-sm text-muted">{p.description}</p>
                  </GlassPanel>

                  <GlassPanel>
                    <h3 className="mb-3 text-sm font-semibold text-ink">Data Notification Information</h3>
                    <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
                      <Row k="Status" v={p.status} />
                      <Row k="Project Name" v={p.projectName} />
                      <Row k="Source Information" v={p.source} />
                      <Row k="Date Notification Rec'd" v={p.notificationCancelled ? 'Cancelled' : fmtDate(p.dateNotificationReceived)} />
                      <Row k="RITM Number" v={p.ritmNumber ?? '—'} />
                      <Row k="Investment Class" v={p.investmentClass} />
                      <Row k="PIA Number" v={p.piaNumber ?? '—'} />
                      <Row
                        k="OneTrust Project ID"
                        v={p.oneTrustProjectId && p.oneTrustUrl && isWebUrl(p.oneTrustUrl) ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-accent hover:underline focus-ring"
                            onClick={() => void openExternalUrl(p.oneTrustUrl!)}
                            title="Open this project in OneTrust"
                          >
                            {p.oneTrustProjectId} <ExternalLink className="h-3.5 w-3.5" />
                          </button>
                        ) : (p.oneTrustProjectId ?? '—')}
                      />
                    </dl>
                  </GlassPanel>
                </>
              ) : draft && (
                <>
                  <GlassPanel>
                    <h3 className="mb-3 text-sm font-semibold text-ink">Data Notification Information</h3>
                    <div className="flex flex-col gap-3">
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Project Name">
                          <GlassInput value={draft.projectName} onChange={(e) => setD({ projectName: e.target.value })} />
                        </Field>
                        <Field label="Status">
                          <GlassSelect value={draft.status} onChange={(e) => setD({ status: e.target.value })}>
                            {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                          </GlassSelect>
                        </Field>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Source Information">
                          <GlassSelect value={draft.source} onChange={(e) => setD({ source: e.target.value })}>
                            {SOURCES.map((s) => <option key={s}>{s}</option>)}
                          </GlassSelect>
                        </Field>
                        <Field label="Date Notification Rec'd">
                          <GlassInput
                            type="date"
                            value={(draft.dateNotificationReceived ?? '').slice(0, 10)}
                            onChange={(e) => setD({ dateNotificationReceived: e.target.value || undefined })}
                            disabled={draft.notificationCancelled}
                          />
                        </Field>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="RITM Number">
                          <GlassInput value={draft.ritmNumber ?? ''} onChange={(e) => setD({ ritmNumber: e.target.value || undefined })} />
                        </Field>
                        <Field label="Investment Class">
                          <GlassSelect value={draft.investmentClass} onChange={(e) => setD({ investmentClass: e.target.value })}>
                            {INVESTMENT_CLASSES.map((c) => <option key={c}>{c}</option>)}
                          </GlassSelect>
                        </Field>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="PIA Number">
                          <GlassInput value={draft.piaNumber ?? ''} onChange={(e) => setD({ piaNumber: e.target.value || undefined })} />
                        </Field>
                        <Field label="OneTrust Project ID">
                          <GlassInput value={draft.oneTrustProjectId ?? ''} onChange={(e) => setD({ oneTrustProjectId: e.target.value || undefined })} />
                        </Field>
                      </div>
                      <Field label="OneTrust Link" hint="Optional full URL for this OneTrust project.">
                        <GlassInput
                          type="url"
                          value={draft.oneTrustUrl ?? ''}
                          onChange={(e) => setD({ oneTrustUrl: e.target.value || undefined })}
                          placeholder="https://...onetrust.com/..."
                        />
                      </Field>
                      <Field label="Notification cancelled">
                        <label className="flex h-[38px] items-center gap-2 rounded-xl border border-line bg-[var(--pf-surface)] px-3 text-sm text-ink">
                          <input
                            type="checkbox"
                            className="h-4 w-4 focus-ring"
                            checked={draft.notificationCancelled}
                            onChange={(e) => setD({ notificationCancelled: e.target.checked })}
                          />
                          Notification cancelled
                        </label>
                      </Field>
                      <Field label="Request Description/Explanation">
                        <GlassTextarea rows={4} value={draft.description} onChange={(e) => setD({ description: e.target.value })} />
                      </Field>
                    </div>
                  </GlassPanel>

                  <GlassPanel>
                    <h3 className="mb-3 text-sm font-semibold text-ink">Comments</h3>
                    <div className="flex flex-col gap-3">
                      <Field label="Comments">
                        <GlassTextarea
                          ref={commentsRef}
                          rows={3}
                          value={draft.comments ?? ''}
                          onChange={(e) => setD({ comments: e.target.value || undefined })}
                        />
                      </Field>
                      {commentTemplates.length > 0 && (
                        <div className="-mt-1 flex flex-wrap gap-2">
                          {commentTemplates.map((template) => (
                            <button
                              key={template.id}
                              type="button"
                              onClick={() => insertCommentTemplate(template)}
                              className="rounded-capsule border border-line px-2.5 py-1 text-xs text-muted hover:text-ink focus-ring"
                            >
                              Insert {template.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </GlassPanel>
                </>
              )}
            </div>
          )}

          {tab === 'communications' && (
            <GlassPanel>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-ink">Communications</h3>
                {canEdit && !addingComm && (
                  <GlassButton variant="primary" className="px-3 py-1.5 text-xs" onClick={() => { setAddingComm(true); setCommError(''); }}>
                    <Paperclip className="h-3.5 w-3.5" /> Add File
                  </GlassButton>
                )}
              </div>

              {addingComm && canEdit && (
                <form onSubmit={submitCommunication} className="mb-4 flex flex-col gap-3 rounded-xl border border-accent/40 bg-[var(--pf-surface)] p-4">
                  <p className="text-sm font-semibold text-ink">Add a file</p>
                  <Field label="File" hint="Pick a file from your computer, or just enter a subject below to log a reference.">
                    <input
                      type="file"
                      className="block w-full text-sm text-muted file:mr-3 file:rounded-capsule file:border file:border-line file:bg-[var(--pf-highlight)] file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-ink hover:file:brightness-110"
                      onChange={(e) => {
                        const f = e.target.files?.[0] ?? null;
                        setCommFile(f);
                        if (f && !commSubject) setCommSubject(f.name);
                      }}
                    />
                  </Field>
                  <Field label="Subject">
                    <GlassInput value={commSubject} onChange={(e) => setCommSubject(e.target.value)} placeholder="e.g. Kickoff notes of 12 Mar" />
                  </Field>
                  <Field label="Summary (optional)">
                    <GlassTextarea rows={2} value={commSummary} onChange={(e) => setCommSummary(e.target.value)} placeholder="Brief note about this file…" />
                  </Field>
                  {commError && <p className="text-xs text-red-400">{commError}</p>}
                  <div className="flex justify-end gap-2">
                    <GlassButton type="button" onClick={() => { setAddingComm(false); setCommError(''); }}>Cancel</GlassButton>
                    <GlassButton type="submit" variant="primary" loading={commBusy}>
                      <Paperclip className="h-4 w-4" /> Add file
                    </GlassButton>
                  </div>
                </form>
              )}

              {comms.length === 0 ? <EmptyState title="No communications" icon={<MessageSquare className="h-6 w-6" />} /> : (
                <div className="flex flex-col gap-2">
                  {comms.map((m) => (
                    <div key={m.id} className="min-w-0 overflow-hidden rounded-xl border border-line px-4 py-3">
                      <div className="mb-1 flex min-w-0 items-center gap-2">
                        <GlassBadge tone={m.direction === 'Inbound' ? 'info' : 'neutral'}>{m.direction}</GlassBadge>
                        <span className="min-w-0 flex-1 break-words text-sm font-medium text-ink">{m.subject}</span>
                        <span className="shrink-0 text-xs text-muted">{fmtDateTime(m.sentAt)}</span>
                      </div>
                      <p className="min-w-0 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted [overflow-wrap:anywhere]">{m.summary}</p>
                    </div>
                  ))}
                </div>
              )}
            </GlassPanel>
          )}

          {tab === 'comments' && (
            <GlassPanel>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-ink">Comments</h3>
                {canEdit && !addingComment && (
                  <GlassButton variant="primary" className="px-3 py-1.5 text-xs" onClick={() => { setAddingComment(true); setCommentError(''); }}>
                    <Plus className="h-3.5 w-3.5" /> Add Comment
                  </GlassButton>
                )}
              </div>
              {addingComment && canEdit && (
                <form onSubmit={submitComment} className="mb-4 flex flex-col gap-3 rounded-xl border border-accent/40 bg-[var(--pf-surface)] p-4">
                  <Field label="New comment">
                    <GlassTextarea
                      ref={newCommentRef}
                      rows={4}
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      autoFocus
                    />
                  </Field>
                  {commentTemplates.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Insert</span>
                      {commentTemplates.map((template) => (
                        <button
                          key={template.id}
                          type="button"
                          onClick={() => insertNewCommentTemplate(template)}
                          className="rounded-capsule border border-line px-2.5 py-1 text-xs text-muted hover:text-ink focus-ring"
                        >
                          {template.name}
                        </button>
                      ))}
                    </div>
                  )}
                  {commentError && <p className="text-xs text-red-400">{commentError}</p>}
                  <div className="flex justify-end gap-2">
                    <GlassButton type="button" onClick={() => { setAddingComment(false); setCommentText(''); setCommentError(''); }}>Cancel</GlassButton>
                    <GlassButton type="submit" variant="primary" loading={commentBusy}>Add Comment</GlassButton>
                  </div>
                </form>
              )}
              {p.comments?.trim() ? (
                <div className="rounded-xl border border-line px-4 py-3">
                  <p className="whitespace-pre-wrap break-words text-sm text-ink/90">{p.comments}</p>
                </div>
              ) : (
                <EmptyState
                  title="No comments"
                  description="Comments added to this data notification will appear here."
                  icon={<MessageSquare className="h-6 w-6" />}
                />
              )}
            </GlassPanel>
          )}

          {tab === 'audit' && (
            <GlassPanel>
              {audit.length === 0 ? (
                <EmptyState title="No audit events" icon={<ShieldCheck className="h-6 w-6" />} />
              ) : (
                <div className="flex flex-col gap-1.5">
                  {[...audit].reverse().map((e) => (
                    <div key={e.id} className="flex items-center gap-3 border-b border-line/60 py-2 text-sm">
                      <span className="text-muted">#{e.seq}</span>
                      <span className="flex-1 text-ink/90">{e.summary}</span>
                      <span className="text-xs text-muted">{fmtDateTime(e.utc)}</span>
                    </div>
                  ))}
                </div>
              )}
            </GlassPanel>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <GlassPanel>
            <h3 className="mb-3 text-sm font-semibold text-ink">Summary</h3>
            <dl className="flex flex-col gap-2 text-sm">
              <Row k="Status" v={p.status} />
              <Row k="Source" v={p.source} />
              <Row k="Logged" v={fmtDate(p.createdAt)} />
            </dl>
          </GlassPanel>

          {canEdit ? (
            <GlassPanel>
              <h3 className="mb-3 text-sm font-semibold text-ink">Change status</h3>
              <div className="flex flex-col gap-2">
                <Field label="Reason / note (optional)">
                  <GlassTextarea rows={2} value={statusReason} onChange={(e) => setStatusReason(e.target.value)} />
                </Field>
                <GlassSelect
                  defaultValue=""
                  disabled={statusBusy}
                  onChange={(e) => { if (e.target.value) changeStatus(e.target.value); e.target.value = ''; }}
                >
                  <option value="">Move to…</option>
                  {PROJECT_STATUSES.filter((s) => s !== p.status).map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </GlassSelect>
              </div>
              <p className="mt-2 text-[11px] text-muted">
                Workflow: New → Reviewing → Needs Assessment → Assessment Sent → Approved / Denied / Closed.
                Status changes are recorded in the audit trail.
              </p>
            </GlassPanel>
          ) : (
            <GlassPanel>
              <p className="text-xs text-muted">You have read-only access to this data notification.</p>
            </GlassPanel>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{k}</dt>
      <dd className="text-right font-medium text-ink">{v}</dd>
    </div>
  );
}
