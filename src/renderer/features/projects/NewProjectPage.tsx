import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { platform } from '../../platform';
import type { NewProjectInput } from '../../platform/types';
import type { Project } from '@shared/types';
import { PROJECT_STATUSES } from '@shared/constants';
import { PageHeader } from '../../layouts/AppShell';
import { GlassButton, GlassInput, GlassSelect, GlassTextarea, GlassPanel, Field } from '../../components/glass';
import { useAuth, can } from '../../store/auth';

const SOURCES = ['DD', 'SSDS', 'Lighthouse'];
const INVESTMENT_CLASSES = ['CTB', 'KTLO', 'RTB', 'Not Listed'];
const SSDS_TYPES = ['User', 'Application', 'N/A'];

export function NewProjectPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [submitError, setSubmitError] = React.useState('');
  const [existingProjects, setExistingProjects] = React.useState<Project[]>([]);
  const appliedProjectNumber = React.useRef('');

  // Project Information
  const [projectNumber, setProjectNumber] = React.useState('');
  const [projectName, setProjectName] = React.useState('');
  const [status, setStatus] = React.useState<string>('New');
  const [source, setSource] = React.useState('DD');
  const [dateNotificationReceived, setDateNotificationReceived] = React.useState('');
  const [notificationCancelled, setNotificationCancelled] = React.useState(false);
  const [ritmNumber, setRitmNumber] = React.useState('');
  const [investmentClass, setInvestmentClass] = React.useState('CTB');
  const [description, setDescription] = React.useState('');

  // Project Details
  const [fiscalYear, setFiscalYear] = React.useState('');
  const [piaNumber, setPiaNumber] = React.useState('');
  const [ssdsTask, setSsdsTask] = React.useState('');
  const [ssdsType, setSsdsType] = React.useState('User');
  const [projectUid, setProjectUid] = React.useState('');
  const [businessUnit, setBusinessUnit] = React.useState('');
  const [businessSponsors, setBusinessSponsors] = React.useState('');
  const [demandNumber, setDemandNumber] = React.useState('');
  const [assetsMentioned, setAssetsMentioned] = React.useState('');

  const [comments, setComments] = React.useState('');

  React.useEffect(() => {
    platform().projects.list().then(setExistingProjects).catch(() => setExistingProjects([]));
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
    setFiscalYear(matchedProject.fiscalYear ?? '');
    setPiaNumber(matchedProject.piaNumber ?? '');
    setSsdsTask(matchedProject.ssdsTask ?? '');
    setSsdsType(matchedProject.ssdsType ?? 'User');
    setProjectUid(matchedProject.projectUid ?? '');
    setBusinessUnit(matchedProject.businessUnit ?? '');
    setBusinessSponsors(matchedProject.businessSponsors ?? '');
    setDemandNumber(matchedProject.demandNumber ?? '');
    setAssetsMentioned(matchedProject.assetsMentioned ?? '');
  }, [matchedProject]);

  if (!can(user?.role, 'projects.create')) {
    return (
      <GlassPanel><p className="text-sm text-muted">You do not have permission to create projects.</p></GlassPanel>
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
      fiscalYear: fiscalYear || undefined,
      piaNumber: piaNumber || undefined,
      ssdsTask: ssdsTask || undefined,
      ssdsType,
      projectUid: projectUid || undefined,
      businessUnit: businessUnit || undefined,
      businessSponsors: businessSponsors || undefined,
      demandNumber: demandNumber || undefined,
      assetsMentioned: assetsMentioned || undefined,
      comments: comments || undefined,
    };
    try {
      const created = await platform().projects.create(input);
      setBusy(false);
      navigate(`/projects/${created.id}`);
    } catch (e) {
      setBusy(false);
      setSubmitError(e instanceof Error ? e.message : 'Unable to create the project.');
    }
  }

  return (
    <div>
      <button onClick={() => navigate('/')} className="mb-3 flex items-center gap-1.5 text-sm text-muted hover:text-ink focus-ring">
        <ArrowLeft className="h-4 w-4" /> Back to dashboard
      </button>
      <PageHeader title="New Project" subtitle="Log a new project for privacy review." />

      <form onSubmit={submit} className="grid gap-4 lg:grid-cols-2">
        <GlassPanel>
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted">Project Information</h3>
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Project Number" hint="Leave blank to auto-assign. May be shared by grouped entries with the same project name.">
                <GlassInput value={projectNumber} onChange={(e) => setProjectNumber(e.target.value)} placeholder="Auto-assigned" />
              </Field>
              <Field label="Project Name" error={errors.projectName} hint="Entries with the same name are grouped together on the Projects list.">
                <GlassInput value={projectName} onChange={(e) => setProjectName(e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Status" hint="New → Reviewing → Needs Assessment → Assessment Sent → Approved / Denied / Closed.">
                <GlassSelect value={status} onChange={(e) => setStatus(e.target.value)}>
                  {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </GlassSelect>
              </Field>
              <Field label="Source">
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
              <Field label="Project cancelled">
                <label className="flex h-[38px] items-center gap-2 rounded-xl border border-line bg-[var(--pf-surface)] px-3 text-sm text-ink">
                  <input
                    type="checkbox"
                    className="h-4 w-4 focus-ring"
                    checked={notificationCancelled}
                    onChange={(e) => setNotificationCancelled(e.target.checked)}
                  />
                  Project cancelled
                </label>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="RITM Number" hint="Must be unique — this is the project's identifier. Duplicate RITM numbers are rejected.">
                <GlassInput value={ritmNumber} onChange={(e) => setRitmNumber(e.target.value)} />
              </Field>
              <Field label="Investment Class">
                <GlassSelect value={investmentClass} onChange={(e) => setInvestmentClass(e.target.value)}>
                  {INVESTMENT_CLASSES.map((c) => <option key={c}>{c}</option>)}
                </GlassSelect>
              </Field>
            </div>
            <Field label="Request Description/Explanation" error={errors.description}>
              <GlassTextarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Summarise the project request…" />
            </Field>
          </div>
        </GlassPanel>

        <GlassPanel>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Project Details</h3>
            {matchedProject && (
              <span className="rounded-capsule border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-[11px] font-medium text-emerald-200">
                Matched {matchedProject.projectNumber}; details populated
              </span>
            )}
          </div>
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Fiscal Year">
                <GlassInput value={fiscalYear} onChange={(e) => setFiscalYear(e.target.value)} placeholder="e.g. FY26" />
              </Field>
              <Field label="PIA Number">
                <GlassInput value={piaNumber} onChange={(e) => setPiaNumber(e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="SSDS Task">
                <GlassInput value={ssdsTask} onChange={(e) => setSsdsTask(e.target.value)} />
              </Field>
              <Field label="SSDS Type">
                <GlassSelect value={ssdsType} onChange={(e) => setSsdsType(e.target.value)}>
                  {SSDS_TYPES.map((t) => <option key={t}>{t}</option>)}
                </GlassSelect>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Project UID">
                <GlassInput value={projectUid} onChange={(e) => setProjectUid(e.target.value)} />
              </Field>
              <Field label="Business Unit">
                <GlassInput value={businessUnit} onChange={(e) => setBusinessUnit(e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Business Sponsors">
                <GlassInput value={businessSponsors} onChange={(e) => setBusinessSponsors(e.target.value)} />
              </Field>
              <Field label="Demand Number">
                <GlassInput value={demandNumber} onChange={(e) => setDemandNumber(e.target.value)} />
              </Field>
            </div>
            <Field label="Assets Mentioned">
              <GlassInput value={assetsMentioned} onChange={(e) => setAssetsMentioned(e.target.value)} />
            </Field>
          </div>
        </GlassPanel>

        <GlassPanel className="lg:col-span-2">
          <Field label="Comments">
            <GlassTextarea rows={4} value={comments} onChange={(e) => setComments(e.target.value)} placeholder="Additional comments…" />
          </Field>
          {submitError && <p className="mt-3 text-xs text-red-400">{submitError}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <GlassButton type="button" onClick={() => navigate('/')}>Cancel</GlassButton>
            <GlassButton type="submit" variant="primary" loading={busy}>Create project</GlassButton>
          </div>
        </GlassPanel>
      </form>
    </div>
  );
}
