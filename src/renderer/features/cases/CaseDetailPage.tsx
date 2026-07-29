import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import clsx from 'clsx';
import {
  ArrowLeft, Mail, ShieldCheck, FileText, MessageSquare,
  StickyNote, ClipboardList, Send, Upload, Paperclip, Pencil, Check, X, Save,
} from 'lucide-react';
import { platform } from '../../platform';
import type {
  DsrCase, CaseNote, Communication, CaseDocument, AuditEvent, SourceEmail,
} from '@shared/types';
import {
  CASE_STATUSES, INTAKE_CHANNELS, CLIENT_CENTER_STATUSES,
  RELATIONSHIP_TYPES, REQUEST_TYPES,
} from '@shared/constants';
import {
  GlassPanel, GlassBadge, GlassButton, GlassInput, GlassSelect, GlassTextarea,
  Spinner, EmptyState, Field,
} from '../../components/glass';
import { fmtDate, fmtDateTime, statusTone } from '../../lib/format';
import { useAuth, can } from '../../store/auth';
import { sourceEmailFromFile, sourceEmailSummary } from '../../lib/emailSource';

type TabKey = 'overview' | 'documents' | 'communications' | 'notes' | 'audit';

const TABS: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'overview', label: 'Overview', icon: ClipboardList },
  { key: 'documents', label: 'Documents', icon: FileText },
  { key: 'communications', label: 'Communications', icon: MessageSquare },
  { key: 'notes', label: 'Notes', icon: StickyNote },
  { key: 'audit', label: 'Audit', icon: ShieldCheck },
];

const DOC_CATEGORIES = ['General', 'Evidence'];
const NOTE_CATEGORIES = ['General'];

interface EditDraft {
  // Request
  requestTypes: string[];
  description: string;
  intakeChannel: string;
  // Requester
  requestId: string;
  lastName: string;
  email: string;
  relationship: string;
  minor: boolean;
  authorizedAgent: boolean;
  clientCenterStatus: string;
  emailedFA: string;
  // Intake timeline
  dateClientServiceReceivedEmail: string;
  dateDppReceivedEmail: string;
  standardResponseSent: string;
  forwardedEmailToRon: string;
  followUpEmailSent: string;
  closedDate: string;
}

export function CaseDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [c, setC] = React.useState<DsrCase | null | undefined>(undefined);
  const [tab, setTab] = React.useState<TabKey>('overview');
  const [notes, setNotes] = React.useState<CaseNote[]>([]);
  const [comms, setComms] = React.useState<Communication[]>([]);
  const [docs, setDocs] = React.useState<CaseDocument[]>([]);
  const [audit, setAudit] = React.useState<AuditEvent[]>([]);
  const [noteText, setNoteText] = React.useState('');
  const [noteCat, setNoteCat] = React.useState('General');
  const [statusReason, setStatusReason] = React.useState('');

  // Overview editing
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState<EditDraft | null>(null);
  const [saveBusy, setSaveBusy] = React.useState(false);
  const [saveError, setSaveError] = React.useState('');

  // Case number (ServiceNow) editing
  const [editingNumber, setEditingNumber] = React.useState(false);
  const [numberDraft, setNumberDraft] = React.useState('');
  const [numberError, setNumberError] = React.useState('');
  const [numberBusy, setNumberBusy] = React.useState(false);

  // Add Document form
  const [addingDoc, setAddingDoc] = React.useState(false);
  const [docName, setDocName] = React.useState('');
  const [docCategory, setDocCategory] = React.useState('General');
  const [docFile, setDocFile] = React.useState<File | null>(null);
  const [docError, setDocError] = React.useState('');
  const [docBusy, setDocBusy] = React.useState(false);

  // Add File (communications) form
  const [addingComm, setAddingComm] = React.useState(false);
  const [commSubject, setCommSubject] = React.useState('');
  const [commSummary, setCommSummary] = React.useState('');
  const [commFile, setCommFile] = React.useState<File | null>(null);
  const [commSourceEmail, setCommSourceEmail] = React.useState<SourceEmail | null>(null);
  const [commError, setCommError] = React.useState('');
  const [commBusy, setCommBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const found = await platform().cases.getById(id);
    setC(found);
    if (found) {
      const p = platform().cases;
      setNotes(await p.notes(id));
      setComms(await p.communications(id));
      setDocs(await p.documents(id));
      setAudit(await platform().audit.byCase(id));
    }
  }, [id]);

  React.useEffect(() => { load(); }, [load]);

  if (c === undefined) return <Spinner label="Loading request…" />;
  if (c === null) {
    return (
      <GlassPanel>
        <EmptyState title="Request not found" description="This request may have been removed." />
        <div className="mt-4 flex justify-center">
          <GlassButton onClick={() => navigate('/cases')}>Back to requests</GlassButton>
        </div>
      </GlassPanel>
    );
  }

  const canEdit = can(user?.role, 'requests.update');

  const requestIdValue =
    c.subject.identifiers.find((i) => i.label === 'Request ID')?.value ?? c.subject.firstName ?? '—';

  function startEdit() {
    setDraft({
      requestTypes: c!.requestTypes.map(String),
      description: c!.description,
      intakeChannel: String(c!.intakeChannel),
      requestId:
        c!.subject.identifiers.find((i) => i.label === 'Request ID')?.value ?? c!.subject.firstName ?? '',
      lastName: c!.subject.lastName,
      email: c!.subject.emails[0] ?? '',
      relationship: String(c!.subject.relationship),
      minor: c!.subject.minor,
      authorizedAgent: c!.subject.authorizedAgent,
      clientCenterStatus: c!.subject.clientCenterStatus ?? 'Not located',
      emailedFA: (c!.subject.emailedFA ?? '').slice(0, 10),
      dateClientServiceReceivedEmail: (c!.intakeDates?.dateClientServiceReceivedEmail ?? '').slice(0, 10),
      dateDppReceivedEmail: (c!.intakeDates?.dateDppReceivedEmail ?? '').slice(0, 10),
      standardResponseSent: (c!.intakeDates?.standardResponseSent ?? '').slice(0, 10),
      forwardedEmailToRon: (c!.intakeDates?.forwardedEmailToRon ?? '').slice(0, 10),
      followUpEmailSent: (c!.intakeDates?.followUpEmailSent ?? '').slice(0, 10),
      closedDate: (c!.sla.closureDate ?? c!.resolutionDate ?? '').slice(0, 10),
    });
    setSaveError('');
    setEditing(true);
  }

  async function saveEdit() {
    if (!draft) return;
    if (draft.requestTypes.length === 0) { setSaveError('Select at least one request type.'); return; }
    if (!draft.requestId.trim()) { setSaveError('Request ID is required.'); return; }
    if (!draft.lastName.trim()) { setSaveError('Last name is required.'); return; }
    if (!draft.email.trim() || !/.+@.+\..+/.test(draft.email)) { setSaveError('A valid email is required.'); return; }
    if (!draft.description.trim()) { setSaveError('Description is required.'); return; }
    setSaveBusy(true);
    setSaveError('');
    try {
      const identifiers = c!.subject.identifiers.filter((i) => i.label !== 'Request ID');
      identifiers.unshift({ label: 'Request ID', value: draft.requestId.trim() });
      await platform().cases.update(id, {
        requestTypes: draft.requestTypes,
        description: draft.description,
        intakeChannel: draft.intakeChannel,
        subject: {
          ...c!.subject,
          lastName: draft.lastName.trim(),
          emails: [draft.email.trim(), ...c!.subject.emails.slice(1)],
          relationship: draft.relationship,
          minor: draft.minor,
          authorizedAgent: draft.authorizedAgent,
          identifiers,
          clientCenterStatus: draft.clientCenterStatus || undefined,
          emailedFA: draft.emailedFA || undefined,
        },
        intakeDates: {
          dateClientServiceReceivedEmail: draft.dateClientServiceReceivedEmail || undefined,
          dateDppReceivedEmail: draft.dateDppReceivedEmail || undefined,
          standardResponseSent: draft.standardResponseSent || undefined,
          forwardedEmailToRon: draft.forwardedEmailToRon || undefined,
          followUpEmailSent: draft.followUpEmailSent || undefined,
        },
        sla: {
          ...c!.sla,
          closureDate: draft.closedDate || undefined,
          fulfillmentDate: draft.closedDate || undefined,
        },
        resolutionDate: draft.closedDate || undefined,
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
    await platform().cases.transition(id, to as DsrCase['status'], statusReason || undefined);
    setStatusReason('');
    await load();
  }

  async function addNote() {
    if (!noteText.trim()) return;
    await platform().cases.addNote(id, noteText.trim(), noteCat);
    setNoteText('');
    await load();
  }

  async function saveCaseNumber() {
    const trimmed = numberDraft.trim();
    if (!trimmed) {
      setNumberError('Request number cannot be empty.');
      return;
    }
    setNumberBusy(true);
    setNumberError('');
    try {
      await platform().cases.updateCaseNumber(id, trimmed);
      setEditingNumber(false);
      await load();
    } catch (e) {
      setNumberError(e instanceof Error ? e.message : 'Unable to update the request number.');
    } finally {
      setNumberBusy(false);
    }
  }

  async function submitDocument(ev: React.FormEvent) {
    ev.preventDefault();
    const name = docName.trim() || docFile?.name || '';
    if (!name) {
      setDocError('Choose a file or enter a file name.');
      return;
    }
    setDocBusy(true);
    setDocError('');
    try {
      await platform().cases.addDocument(id, {
        originalFilename: name,
        mimeType: docFile?.type || undefined,
        sizeBytes: docFile?.size ?? 0,
        category: docCategory,
      });
      setAddingDoc(false);
      setDocName('');
      setDocFile(null);
      setDocCategory('General');
      await load();
    } catch (e) {
      setDocError(e instanceof Error ? e.message : 'Unable to add the document.');
    } finally {
      setDocBusy(false);
    }
  }

  async function submitCommunication(ev: React.FormEvent) {
    ev.preventDefault();
    const subject = commSubject.trim() || commFile?.name || '';
    if (!subject) {
      setCommError('Choose a file or enter a subject.');
      return;
    }
    setCommBusy(true);
    setCommError('');
    try {
      const parsedEmail = commSourceEmail ?? (commFile && /\.eml$/i.test(commFile.name) ? await sourceEmailFromFile(commFile) : null);
      await platform().cases.addCommunication(id, {
        subject: parsedEmail?.subject || subject,
        summary: commSummary.trim() || (parsedEmail ? sourceEmailSummary(parsedEmail) : `Attached file: ${subject}${commFile ? ` (${(commFile.size / 1024).toFixed(0)} KB)` : ''}`),
        direction: 'Inbound',
        channel: parsedEmail ? 'Uploaded email' : 'File attachment',
        sourceEmail: parsedEmail ?? undefined,
      });
      setAddingComm(false);
      setCommSubject('');
      setCommSummary('');
      setCommFile(null);
      setCommSourceEmail(null);
      await load();
    } catch (e) {
      setCommError(e instanceof Error ? e.message : 'Unable to add the file.');
    } finally {
      setCommBusy(false);
    }
  }

  const setD = (patch: Partial<EditDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  function toggleDraftType(t: string) {
    setDraft((d) => {
      if (!d) return d;
      const has = d.requestTypes.includes(t);
      return { ...d, requestTypes: has ? d.requestTypes.filter((x) => x !== t) : [...d.requestTypes, t] };
    });
  }

  return (
    <div>
      <button onClick={() => navigate('/cases')} className="mb-3 flex items-center gap-1.5 text-sm text-muted hover:text-ink focus-ring">
        <ArrowLeft className="h-4 w-4" /> Back to requests
      </button>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          {editingNumber ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <GlassInput
                  className="w-64 text-lg font-bold"
                  value={numberDraft}
                  onChange={(e) => setNumberDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); saveCaseNumber(); }
                    if (e.key === 'Escape') setEditingNumber(false);
                  }}
                  autoFocus
                />
                <GlassButton variant="primary" className="px-3 py-2" loading={numberBusy} onClick={saveCaseNumber}>
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
              {c.caseNumber}
              {canEdit && (
                <button
                  onClick={() => { setNumberDraft(c.caseNumber); setNumberError(''); setEditingNumber(true); }}
                  className="rounded-lg p-1.5 text-muted hover:bg-[var(--pf-highlight)] hover:text-ink focus-ring"
                  title="Edit request number (e.g. the number ServiceNow assigns)"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              )}
            </h1>
          )}
          <p className="mt-1 text-sm text-muted">{c.subject.lastName} · {c.requestTypes.join(', ')}</p>
        </div>
        <div className="flex items-center gap-2">
          <GlassBadge tone={statusTone(c.status)}>{c.status}</GlassBadge>
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
                    <h3 className="mb-2 text-sm font-semibold text-ink">Request description</h3>
                    <p className="text-sm text-muted">{c.description}</p>
                  </GlassPanel>
                  <GlassPanel>
                    <h3 className="mb-3 text-sm font-semibold text-ink">Details</h3>
                    <dl className="grid gap-2 text-sm sm:grid-cols-2">
                      <Row k="Request types" v={c.requestTypes.join(', ')} />
                      <Row k="Intake channel" v={c.intakeChannel} />
                      <Row k="Client Center Status" v={c.subject.clientCenterStatus ?? '—'} />
                      <Row k="Emailed FA" v={fmtDate(c.subject.emailedFA)} />
                      <Row k="Date received" v={fmtDate(c.intakeDates?.dateDppReceivedEmail ?? c.sla.receivedDate)} />
                      <Row k="Logged" v={fmtDate(c.createdAt)} />
                    </dl>
                  </GlassPanel>
                  {((c.intakeDates && Object.values(c.intakeDates).some(Boolean)) || c.sla.closureDate || c.resolutionDate) && (
                    <GlassPanel>
                      <h3 className="mb-3 text-sm font-semibold text-ink">Intake timeline</h3>
                      <dl className="grid gap-2 text-sm sm:grid-cols-2">
                        <Row k="Client Svcs. rec'd email" v={fmtDate(c.intakeDates.dateClientServiceReceivedEmail)} />
                        <Row k="DPP rec'd email from Client Svcs." v={fmtDate(c.intakeDates.dateDppReceivedEmail)} />
                        <Row k="Standard Response sent" v={fmtDate(c.intakeDates.standardResponseSent)} />
                        <Row k="Forwarded email to Ron K." v={fmtDate(c.intakeDates.forwardedEmailToRon)} />
                        <Row k="Follow-up sent" v={fmtDate(c.intakeDates.followUpEmailSent)} />
                        <Row k="Closed" v={fmtDate(c.sla.closureDate ?? c.resolutionDate)} />
                      </dl>
                    </GlassPanel>
                  )}
                </>
              ) : draft && (
                <>
                  <GlassPanel>
                    <h3 className="mb-3 text-sm font-semibold text-ink">Request</h3>
                    <div className="flex flex-col gap-3">
                      <Field label="Request types">
                        <div className="flex flex-wrap gap-2">
                          {REQUEST_TYPES.map((t) => (
                            <button
                              type="button"
                              key={t}
                              onClick={() => toggleDraftType(t)}
                              className={`rounded-capsule border px-3 py-1 text-xs transition-all focus-ring ${
                                draft.requestTypes.includes(t)
                                  ? 'border-transparent bg-accent text-accent-ink'
                                  : 'border-line text-muted hover:text-ink'
                              }`}
                            >
                              {t}
                            </button>
                          ))}
                        </div>
                      </Field>
                      <div className="grid grid-cols-1 gap-3">
                        <Field label="Intake channel">
                          <GlassSelect value={draft.intakeChannel} onChange={(e) => setD({ intakeChannel: e.target.value })}>
                            {INTAKE_CHANNELS.map((ch) => <option key={ch}>{ch}</option>)}
                          </GlassSelect>
                        </Field>
                      </div>
                      <Field label="Request description">
                        <GlassTextarea rows={4} value={draft.description} onChange={(e) => setD({ description: e.target.value })} />
                      </Field>
                    </div>
                  </GlassPanel>

                  <GlassPanel>
                    <h3 className="mb-3 text-sm font-semibold text-ink">Requester</h3>
                    <div className="flex flex-col gap-3">
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Request ID">
                          <GlassInput value={draft.requestId} onChange={(e) => setD({ requestId: e.target.value })} />
                        </Field>
                        <Field label="Last name">
                          <GlassInput value={draft.lastName} onChange={(e) => setD({ lastName: e.target.value })} />
                        </Field>
                      </div>
                      <Field label="Email">
                        <GlassInput type="email" value={draft.email} onChange={(e) => setD({ email: e.target.value })} />
                      </Field>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Relationship">
                          <GlassSelect value={draft.relationship} onChange={(e) => setD({ relationship: e.target.value })}>
                            {RELATIONSHIP_TYPES.map((r) => <option key={r}>{r}</option>)}
                          </GlassSelect>
                        </Field>
                        <Field label="Client Center Status">
                          <GlassSelect value={draft.clientCenterStatus} onChange={(e) => setD({ clientCenterStatus: e.target.value })}>
                            {CLIENT_CENTER_STATUSES.map((s) => <option key={s}>{s}</option>)}
                          </GlassSelect>
                        </Field>
                      </div>
                      <Field label="Emailed FA">
                        <GlassInput type="date" value={draft.emailedFA} onChange={(e) => setD({ emailedFA: e.target.value })} />
                      </Field>
                      <div className="flex gap-4">
                        <label className="flex items-center gap-2 text-sm text-ink">
                          <input type="checkbox" className="h-4 w-4 focus-ring" checked={draft.minor} onChange={(e) => setD({ minor: e.target.checked })} /> Minor
                        </label>
                        <label className="flex items-center gap-2 text-sm text-ink">
                          <input type="checkbox" className="h-4 w-4 focus-ring" checked={draft.authorizedAgent} onChange={(e) => setD({ authorizedAgent: e.target.checked })} /> Authorized agent
                        </label>
                      </div>
                    </div>
                  </GlassPanel>

                  <GlassPanel>
                    <h3 className="mb-3 text-sm font-semibold text-ink">Intake timeline</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Client Svcs. rec'd email">
                        <GlassInput type="date" value={draft.dateClientServiceReceivedEmail} onChange={(e) => setD({ dateClientServiceReceivedEmail: e.target.value })} />
                      </Field>
                      <Field label="DPP rec'd email from Client Svcs.">
                        <GlassInput type="date" value={draft.dateDppReceivedEmail} onChange={(e) => setD({ dateDppReceivedEmail: e.target.value })} />
                      </Field>
                      <Field label="Standard Response sent">
                        <GlassInput type="date" value={draft.standardResponseSent} onChange={(e) => setD({ standardResponseSent: e.target.value })} />
                      </Field>
                      <Field label="Forwarded email to Ron K.">
                        <GlassInput type="date" value={draft.forwardedEmailToRon} onChange={(e) => setD({ forwardedEmailToRon: e.target.value })} />
                      </Field>
                      <Field label="Follow-up sent">
                        <GlassInput type="date" value={draft.followUpEmailSent} onChange={(e) => setD({ followUpEmailSent: e.target.value })} />
                      </Field>
                      <Field label="Closed">
                        <GlassInput type="date" value={draft.closedDate} onChange={(e) => setD({ closedDate: e.target.value })} />
                      </Field>
                    </div>
                  </GlassPanel>
                </>
              )}
            </div>
          )}

          {tab === 'documents' && (
            <GlassPanel>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-ink">Documents</h3>
                {canEdit && !addingDoc && (
                  <GlassButton variant="primary" className="px-3 py-1.5 text-xs" onClick={() => { setAddingDoc(true); setDocError(''); }}>
                    <Upload className="h-3.5 w-3.5" /> Add Document
                  </GlassButton>
                )}
              </div>

              {addingDoc && canEdit && (
                <form onSubmit={submitDocument} className="mb-4 flex flex-col gap-3 rounded-xl border border-accent/40 bg-[var(--pf-surface)] p-4">
                  <p className="text-sm font-semibold text-ink">Add a document</p>
                  <Field label="File" hint="Pick a file from your computer, or just enter a file name below to log a reference.">
                    <input
                      type="file"
                      className="block w-full text-sm text-muted file:mr-3 file:rounded-capsule file:border file:border-line file:bg-[var(--pf-highlight)] file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-ink hover:file:brightness-110"
                      onChange={(e) => {
                        const f = e.target.files?.[0] ?? null;
                        setDocFile(f);
                        if (f && !docName) setDocName(f.name);
                      }}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="File name">
                      <GlassInput value={docName} onChange={(e) => setDocName(e.target.value)} placeholder="e.g. signed-authorization.pdf" />
                    </Field>
                    <Field label="Category">
                      <GlassSelect value={docCategory} onChange={(e) => setDocCategory(e.target.value)}>
                        {DOC_CATEGORIES.map((x) => <option key={x}>{x}</option>)}
                      </GlassSelect>
                    </Field>
                  </div>
                  {docError && <p className="text-xs text-red-400">{docError}</p>}
                  <div className="flex justify-end gap-2">
                    <GlassButton type="button" onClick={() => { setAddingDoc(false); setDocError(''); }}>Cancel</GlassButton>
                    <GlassButton type="submit" variant="primary" loading={docBusy}>
                      <Upload className="h-4 w-4" /> Add document
                    </GlassButton>
                  </div>
                </form>
              )}

              {docs.length === 0 ? <EmptyState title="No documents" icon={<FileText className="h-6 w-6" />} /> : (
                <div className="flex flex-col gap-2">
                  {docs.map((d) => (
                    <div key={d.id} className="flex items-center gap-3 rounded-xl border border-line px-4 py-3">
                      <FileText className="h-4 w-4 text-accent" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">{d.originalFilename}</p>
                        <p className="text-xs text-muted">{(d.sizeBytes / 1024).toFixed(0)} KB · {d.category} · uploaded {fmtDate(d.uploadedAt)}</p>
                      </div>
                      {d.encrypted && <GlassBadge tone="success">Encrypted</GlassBadge>}
                    </div>
                  ))}
                </div>
              )}
            </GlassPanel>
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
                        setCommSourceEmail(null);
                        if (f && !commSubject) setCommSubject(f.name);
                        if (f && /\.eml$/i.test(f.name)) {
                          void sourceEmailFromFile(f)
                            .then((parsed) => {
                              setCommSourceEmail(parsed);
                              setCommSubject(parsed.subject || f.name);
                              if (!commSummary.trim()) setCommSummary(sourceEmailSummary(parsed));
                            })
                            .catch((err) => setCommError(err instanceof Error ? err.message : 'Unable to read the uploaded email.'));
                        }
                      }}
                    />
                  </Field>
                  <Field label="Subject">
                    <GlassInput value={commSubject} onChange={(e) => setCommSubject(e.target.value)} placeholder="e.g. Requester email of 12 Mar" />
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

          {tab === 'notes' && (
            <GlassPanel>
              {canEdit && (
                <div className="mb-4 flex flex-col gap-2 rounded-xl border border-line p-3">
                  <div className="flex items-center gap-2">
                    <GlassSelect className="w-40" value={noteCat} onChange={(e) => setNoteCat(e.target.value)}>
                      {NOTE_CATEGORIES.map((x) => <option key={x}>{x}</option>)}
                    </GlassSelect>
                  </div>
                  <GlassTextarea rows={3} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Add a request note…" />
                  <div className="flex justify-end">
                    <GlassButton variant="primary" onClick={addNote}><Send className="h-4 w-4" /> Add note</GlassButton>
                  </div>
                </div>
              )}
              {notes.length === 0 ? <EmptyState title="No notes yet" icon={<StickyNote className="h-6 w-6" />} /> : (
                <div className="flex flex-col gap-2">
                  {notes.map((n) => (
                    <div key={n.id} className="rounded-xl border border-line px-4 py-3">
                      <div className="mb-1 flex items-center gap-2">
                        <GlassBadge tone="info">{n.category}</GlassBadge>
                        <span className="ml-auto text-xs text-muted">{fmtDateTime(n.createdAt)}</span>
                      </div>
                      <p className="text-sm text-ink/90">{n.content}</p>
                    </div>
                  ))}
                </div>
              )}
            </GlassPanel>
          )}

          {tab === 'audit' && (
            <GlassPanel>
              {audit.length === 0 ? <EmptyState title="No audit events" icon={<ShieldCheck className="h-6 w-6" />} /> : (
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
            <h3 className="mb-3 text-sm font-semibold text-ink">Requester</h3>
            <p className="text-sm font-medium text-ink">{c.subject.lastName}</p>
            <p className="mb-3 text-xs text-muted">{c.subject.relationship}{c.subject.minor ? ' · Minor' : ''}{c.subject.authorizedAgent ? ' · Agent' : ''}</p>
            <div className="flex flex-col gap-1.5 text-sm text-muted">
              <span className="flex items-center gap-2">ID: <span className="text-ink">{requestIdValue}</span></span>
              {c.subject.emails.map((e) => <span key={e} className="flex items-center gap-2"><Mail className="h-3.5 w-3.5" /> {e}</span>)}
              {c.subject.clientCenterStatus && (
                <span className="flex items-center gap-2">Client Center: <GlassBadge tone={c.subject.clientCenterStatus === 'Located' ? 'success' : 'warn'}>{c.subject.clientCenterStatus}</GlassBadge></span>
              )}
            </div>
          </GlassPanel>

          {canEdit && (
            <GlassPanel>
              <h3 className="mb-3 text-sm font-semibold text-ink">Change status</h3>
              <div className="flex flex-col gap-2">
                <Field label="Reason / note (optional)">
                  <GlassTextarea rows={2} value={statusReason} onChange={(e) => setStatusReason(e.target.value)} />
                </Field>
                <GlassSelect defaultValue="" onChange={(e) => e.target.value && changeStatus(e.target.value)}>
                  <option value="">Move to…</option>
                  {CASE_STATUSES.filter((s) => s !== c.status).map((s) => <option key={s} value={s}>{s}</option>)}
                </GlassSelect>
              </div>
              <p className="mt-2 text-[11px] text-muted">
                All status changes are recorded in the audit trail.
              </p>
            </GlassPanel>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{k}</dt>
      <dd className="text-right font-medium text-ink">{v}</dd>
    </div>
  );
}
