import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { platform } from '../../platform';
import type { NewProjectInput } from '../../platform/types';
import type { NoteTemplate, Project } from '@shared/types';
import { PROJECT_STATUSES } from '@shared/constants';
import { boolText, replacePlaceholders } from '@shared/placeholders';
import { PageHeader } from '../../layouts/AppShell';
import { GlassButton, GlassInput, GlassSelect, GlassTextarea, GlassPanel, Field } from '../../components/glass';
import { useAuth, can } from '../../store/auth';
import { insertTextAtCursor } from '../../lib/textInsert';

const SOURCES = ['DD', 'SSDS', 'Lighthouse'];
const INVESTMENT_CLASSES = ['CTB', 'KTLO', 'RTB', 'Not Listed'];

export function NewProjectPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [submitError, setSubmitError] = React.useState('');
  const [existingProjects, setExistingProjects] = React.useState<Project[]>([]);
  const [commentTemplates, setCommentTemplates] = React.useState<NoteTemplate[]>([]);
  const [orgName, setOrgName] = React.useState('');
  const appliedProjectNumber = React.useRef('');

  // Data Notification Information
  const [projectNumber, setProjectNumber] = React.useState('');
  const [projectName, setProjectName] = React.useState('');
  const [status, setStatus] = React.useState<string>('New');
  const [source, setSource] = React.useState('DD');
  const [dateNotificationReceived, setDateNotificationReceived] = React.useState('');
  const [notificationCancelled, setNotificationCancelled] = React.useState(false);
  const [ritmNumber, setRitmNumber] = React.useState('');
  const [investmentClass, setInvestmentClass] = React.useState('CTB');
  const [description, setDescription] = React.useState('');
  const [piaNumber, setPiaNumber] = React.useState('');
  const [oneTrustProjectId, setOneTrustProjectId] = React.useState('');
  const [oneTrustUrl, setOneTrustUrl] = React.useState('');

  const [comments, setComments] = React.useState('');
  const commentsRef = React.useRef<HTMLTextAreaElement | null>(null);

  React.useEffect(() => {
    platform().projects.list().then(setExistingProjects).catch(() => setExistingProjects([]));
    platform().system.settings()
      .then((settings) => {
        setOrgName(settings.organizationName);
        setCommentTemplates((settings.noteTemplates ?? []).filter((template) => template.target === 'comments'));
      })
      .catch(() => setCommentTemplates([]));
  }, []);

  const matchedProject = React.useMemo(() => {
    const trimmed = projectNumber.trim().toLowerCase();
    if (!trimmed) return null;
    return existingProjects
      .filter((project) => project.projectNumber.trim().toLowerCase() === trimmed)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  }, [existingProjects, projectNumber]);

  React.useEffect(() => {
    if (!matchedProject) {
      appliedProjectNumber.current = '';
      return;
    }
    const normalizedNumber = matchedProject.projectNumber.trim().toLowerCase();
    if (appliedProjectNumber.current === normalizedNumber) return;
    appliedProjectNumber.current = normalizedNumber;

    setProjectName(matchedProject.projectName);
    setPiaNumber(matchedProject.piaNumber ?? '');
    setOneTrustProjectId(matchedProject.oneTrustProjectId ?? '');
    setOneTrustUrl(matchedProject.oneTrustUrl ?? '');
  }, [matchedProject]);

  if (!can(user?.role, 'projects.create')) {
    return (
      <GlassPanel><p className="text-sm text-muted">You do not have permission to create data notifications.</p></GlassPanel>
    );
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!projectName.trim()) e.projectName = 'Required';
    if (!description.trim()) e.description = 'Describe the request';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!validate()) return;
    setBusy(true);
    setSubmitError('');
    const input: NewProjectInput = {
      projectNumber: projectNumber.trim() || undefined,
      projectName: projectName.trim(),
      status: status as NewProjectInput['status'],
      source,
      dateNotificationReceived: notificationCancelled
        ? undefined
        : dateNotificationReceived || undefined,
      notificationCancelled,
      ritmNumber: ritmNumber.trim() || undefined,
      investmentClass,
      description,
      piaNumber: piaNumber || undefined,
      oneTrustProjectId: oneTrustProjectId.trim() || undefined,
      oneTrustUrl: oneTrustUrl.trim() || undefined,
      ssdsType: 'N/A',
      comments: comments || undefined,
    };
    try {
      const created = await platform().projects.create(input);
      setBusy(false);
      navigate(`/projects/${created.id}`);
    } catch (e) {
      setBusy(false);
      setSubmitError(e instanceof Error ? e.message : 'Unable to create the data notification.');
    }
  }

  function insertCommentTemplate(template: NoteTemplate) {
    const values: Record<string, string> = {
      'project.number': projectNumber,
      'project.name': projectName,
      'project.status': status,
      'project.source': source,
      'project.dateNotificationReceived': dateNotificationReceived,
      'project.notificationCancelled': boolText(notificationCancelled),
      'project.ritmNumber': ritmNumber,
      'project.investmentClass': investmentClass,
      'project.description': description,
      'project.piaNumber': piaNumber,
      'project.comments': comments,
      'project.createdBy': user?.name ?? user?.username ?? '',
      'project.createdAt': '',
      'org.name': orgName,
    };
    const body = replacePlaceholders(template.body, values);
    setComments((current) => {
      return insertTextAtCursor(commentsRef.current, current, body);
    });
  }

  return (
    <div>
      <button onClick={() => navigate('/')} className="mb-3 flex items-center gap-1.5 text-sm text-muted hover:text-ink focus-ring">
        <ArrowLeft className="h-4 w-4" /> Back to dashboard
      </button>
      <PageHeader title="New Data Notification" subtitle="Log a new data notification for privacy review." />

      <form onSubmit={submit} className="grid gap-4 lg:grid-cols-2">
        <GlassPanel>
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted">Data Notification Information</h3>
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Project Number" hint="Leave blank to auto-assign. May be shared by grouped entries with the same project name.">
                <GlassInput value={projectNumber} onChange={(e) => setProjectNumber(e.target.value)} placeholder="Auto-assigned" />
              </Field>
              <Field label="Project Name" error={errors.projectName} hint="Entries with the same name are grouped together on the Data Notifications list.">
                <GlassInput value={projectName} onChange={(e) => setProjectName(e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Status" hint="New → Reviewing → Needs Assessment → Assessment Sent → Approved / Denied / Closed.">
                <GlassSelect value={status} onChange={(e) => setStatus(e.target.value)}>
                  {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </GlassSelect>
              </Field>
              <Field label="Source Information">
                <GlassSelect value={source} onChange={(e) => setSource(e.target.value)}>
                  {SOURCES.map((s) => <option key={s}>{s}</option>)}
                </GlassSelect>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date Notification Rec'd">
                <GlassInput
                  type="date"
                  value={dateNotificationReceived}
                  onChange={(e) => setDateNotificationReceived(e.target.value)}
                  disabled={notificationCancelled}
                />
              </Field>
              <Field label="Notification cancelled">
                <label className="flex h-[38px] items-center gap-2 rounded-xl border border-line bg-[var(--pf-surface)] px-3 text-sm text-ink">
                  <input
                    type="checkbox"
                    className="h-4 w-4 focus-ring"
                    checked={notificationCancelled}
                    onChange={(e) => setNotificationCancelled(e.target.checked)}
                  />
                  Notification cancelled
                </label>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="RITM Number" hint="Must be unique for each data notification. Duplicate RITM numbers are rejected.">
                <GlassInput value={ritmNumber} onChange={(e) => setRitmNumber(e.target.value)} />
              </Field>
              <Field label="Investment Class">
                <GlassSelect value={investmentClass} onChange={(e) => setInvestmentClass(e.target.value)}>
                  {INVESTMENT_CLASSES.map((c) => <option key={c}>{c}</option>)}
                </GlassSelect>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="PIA Number">
                <GlassInput value={piaNumber} onChange={(e) => setPiaNumber(e.target.value)} />
              </Field>
              <Field label="OneTrust Project ID">
                <GlassInput value={oneTrustProjectId} onChange={(e) => setOneTrustProjectId(e.target.value)} />
              </Field>
            </div>
            <Field label="OneTrust Link" hint="Optional full URL for this OneTrust project.">
              <GlassInput
                type="url"
                value={oneTrustUrl}
                onChange={(e) => setOneTrustUrl(e.target.value)}
                placeholder="https://...onetrust.com/..."
              />
            </Field>
            <Field label="Request Description/Explanation" error={errors.description}>
              <GlassTextarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Summarise the data notification…" />
            </Field>
          </div>
        </GlassPanel>

        <GlassPanel>
          <Field label="Comments">
            <GlassTextarea
              ref={commentsRef}
              rows={4}
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              placeholder="Additional comments…"
            />
          </Field>
          {commentTemplates.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Insert</span>
              {commentTemplates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => insertCommentTemplate(template)}
                  className="rounded-capsule border border-line px-2.5 py-1 text-[11px] text-muted hover:text-ink focus-ring"
                  title={`Insert ${template.name}`}
                >
                  {template.name}
                </button>
              ))}
            </div>
          )}
          {submitError && <p className="mt-3 text-xs text-red-400">{submitError}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <GlassButton type="button" onClick={() => navigate('/')}>Cancel</GlassButton>
            <GlassButton type="submit" variant="primary" loading={busy}>Create data notification</GlassButton>
          </div>
        </GlassPanel>
      </form>
    </div>
  );
}
