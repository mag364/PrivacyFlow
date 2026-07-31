import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Mail } from 'lucide-react';
import { platform } from '../../platform';
import {
  REQUEST_TYPES, INTAKE_CHANNELS, CLIENT_CENTER_STATUSES, RELATIONSHIP_TYPES,
} from '@shared/constants';
import type { NewCaseInput } from '../../platform/types';
import type { NoteTemplate, SourceEmail } from '@shared/types';
import { PageHeader } from '../../layouts/AppShell';
import { GlassButton, GlassInput, GlassSelect, GlassTextarea, GlassPanel, Field } from '../../components/glass';
import { useAuth, can } from '../../store/auth';
import { isSupportedSourceEmailFile, sourceEmailFromFile } from '../../lib/emailSource';

export function NewCasePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [requestIdPrefix, setRequestIdPrefix] = React.useState('');
  const [orgName, setOrgName] = React.useState('');

  const [requestId, setRequestId] = React.useState('');
  const [dsrreqNumber, setDsrreqNumber] = React.useState('');
  const [lastName, setLastName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [clientCenterStatus, setClientCenterStatus] = React.useState<string>('Not located');
  const [emailedFA, setEmailedFA] = React.useState('');
  const [relationship, setRelationship] = React.useState<string>('Client');
  const [minor, setMinor] = React.useState(false);
  const [authorizedAgent, setAgent] = React.useState(false);

  const [requestTypes, setRequestTypes] = React.useState<string[]>([]);
  const [intakeChannel, setChannel] = React.useState<string>('Email');
  const [dateCsReceived, setDateCsReceived] = React.useState('');
  const [dateDppReceived, setDateDppReceived] = React.useState('');
  const [standardResponseSent, setStandardResponseSent] = React.useState('');
  const [forwardedToRon, setForwardedToRon] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [descriptionTemplates, setDescriptionTemplates] = React.useState<NoteTemplate[]>([]);
  const [sourceEmail, setSourceEmail] = React.useState<SourceEmail | null>(null);
  const [sourceEmailError, setSourceEmailError] = React.useState('');

  React.useEffect(() => {
    platform().system.settings().then((settings) => {
      setRequestIdPrefix(settings.caseNumberPrefix);
      setOrgName(settings.organizationName);
      setDescriptionTemplates((settings.noteTemplates ?? []).filter((template) => template.target === 'description'));
    });
  }, []);

  if (!can(user?.role, 'requests.create')) {
    return (
      <GlassPanel><p className="text-sm text-muted">You do not have permission to create requests.</p></GlassPanel>
    );
  }

  function toggleType(t: string) {
    setRequestTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (requestId.trim() && requestIdPrefix && !requestId.trim().startsWith(requestIdPrefix)) {
      e.requestId = `Must start with ${requestIdPrefix}`;
    }
    if (!lastName.trim()) e.lastName = 'Required';
    if (!email.trim() || !/.+@.+\..+/.test(email)) e.email = 'Valid email required';
    if (requestTypes.length === 0) e.requestTypes = 'Select at least one request type';
    if (!description.trim()) e.description = 'Describe the request';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSourceEmail(file: File | null) {
    setSourceEmailError('');
    setSourceEmail(null);
    if (!file) return;
    if (!isSupportedSourceEmailFile(file)) {
      setSourceEmailError('Upload an Outlook .msg file or an .eml email file.');
      return;
    }
    try {
      const parsed = await sourceEmailFromFile(file);
      setSourceEmail(parsed);
      if (parsed.fromEmail && !email.trim()) setEmail(parsed.fromEmail);
      if (parsed.fromName && !lastName.trim()) {
        const parts = parsed.fromName.trim().split(/\s+/);
        setLastName(parts[parts.length - 1]);
      }
      if (parsed.bodyText && !description.trim()) setDescription(parsed.bodyText.slice(0, 1500));
    } catch (e) {
      setSourceEmailError(e instanceof Error ? e.message : 'Unable to read the uploaded email.');
    }
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!validate()) return;
    setBusy(true);
    const input: NewCaseInput = {
      requestTypes,
      caseNumberOverride: dsrreqNumber.trim() || undefined,
      skipCaseNumberAutoAssign: !dsrreqNumber.trim(),
      intakeChannel,
      jurisdiction: 'US',
      priority: 'Medium',
      risk: 'Medium',
      description,
      subject: {
        lastName,
        emails: [email],
        phones: [],
        addresses: [],
        relationship,
        minor,
        authorizedAgent,
        identifiers: requestId.trim() ? [{ label: 'Request ID', value: requestId.trim() }] : [],
        clientCenterStatus,
        emailedFA: emailedFA || undefined,
      },
      intakeDates: {
        dateClientServiceReceivedEmail: dateCsReceived || undefined,
        dateDppReceivedEmail: dateDppReceived || undefined,
        standardResponseSent: standardResponseSent || undefined,
        forwardedEmailToRon: forwardedToRon || undefined,
      },
      sourceEmail: sourceEmail ?? undefined,
    };
    const created = await platform().cases.create(input);
    setBusy(false);
    navigate(`/cases/${created.id}`);
  }

  function insertDescriptionTemplate(template: NoteTemplate) {
    const values: Record<string, string> = {
      '{{requester.lastName}}': lastName,
      '{{requester.email}}': email,
      '{{case.number}}': dsrreqNumber,
      '{{case.types}}': requestTypes.join(', '),
      '{{case.status}}': 'New',
      '{{case.receivedDate}}': dateDppReceived || dateCsReceived || new Date().toISOString().slice(0, 10),
      '{{org.name}}': orgName,
      '{{rule.department}}': '',
    };
    const body = template.body.replace(/\{\{[^}]+\}\}/g, (match) => values[match] ?? '');
    setDescription((current) => {
      const trimmed = current.trimEnd();
      return `${trimmed}${trimmed ? '\n\n' : ''}${body}`;
    });
  }

  return (
    <div>
      <button onClick={() => navigate('/cases')} className="mb-3 flex items-center gap-1.5 text-sm text-muted hover:text-ink focus-ring">
        <ArrowLeft className="h-4 w-4" /> Back to requests
      </button>
      <PageHeader title="New request" subtitle="Log an incoming data subject request." />

      <form onSubmit={submit} className="grid gap-4 lg:grid-cols-2">
        <GlassPanel>
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted">Requester</h3>
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Request ID" error={errors.requestId}>
                <GlassInput
                  value={requestId}
                  onChange={(e) => setRequestId(e.target.value)}
                  placeholder={requestIdPrefix ? `e.g. ${requestIdPrefix}0000001` : 'e.g. PH-0000001'}
                />
              </Field>
              <Field label="Last name" error={errors.lastName}>
                <GlassInput value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </Field>
            </div>
            <Field label="Email" error={errors.email}>
              <GlassInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Client Center Status">
                <GlassSelect value={clientCenterStatus} onChange={(e) => setClientCenterStatus(e.target.value)}>
                  {CLIENT_CENTER_STATUSES.map((s) => <option key={s}>{s}</option>)}
                </GlassSelect>
              </Field>
              <Field label="Emailed FA">
                <GlassInput type="date" value={emailedFA} onChange={(e) => setEmailedFA(e.target.value)} />
              </Field>
            </div>
            <Field label="Relationship">
              <GlassSelect value={relationship} onChange={(e) => setRelationship(e.target.value)}>
                {RELATIONSHIP_TYPES.map((r) => <option key={r}>{r}</option>)}
              </GlassSelect>
            </Field>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" className="h-4 w-4 focus-ring" checked={minor} onChange={(e) => setMinor(e.target.checked)} /> Minor
              </label>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" className="h-4 w-4 focus-ring" checked={authorizedAgent} onChange={(e) => setAgent(e.target.checked)} /> Authorized agent
              </label>
            </div>
          </div>
        </GlassPanel>

        <GlassPanel>
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted">Request</h3>
          <div className="flex flex-col gap-3">
            <Field label="Request types" error={errors.requestTypes}>
              <div className="flex flex-wrap gap-2">
                {REQUEST_TYPES.map((t) => (
                  <button
                    type="button"
                    key={t}
                    onClick={() => toggleType(t)}
                    className={`rounded-capsule border px-3 py-1 text-xs transition-all focus-ring ${
                      requestTypes.includes(t)
                        ? 'border-transparent bg-accent text-accent-ink'
                        : 'border-line text-muted hover:text-ink'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Intake channel">
                <GlassSelect value={intakeChannel} onChange={(e) => setChannel(e.target.value)}>
                  {INTAKE_CHANNELS.map((c) => <option key={c}>{c}</option>)}
                </GlassSelect>
              </Field>
              <Field label="DSRREQ #">
                <GlassInput
                  value={dsrreqNumber}
                  onChange={(e) => setDsrreqNumber(e.target.value)}
                  placeholder="Optional"
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date Client Svcs. Rec'd Email">
                <GlassInput type="date" value={dateCsReceived} onChange={(e) => setDateCsReceived(e.target.value)} />
              </Field>
              <Field label="Date DPP Rec'd email from Client Svcs.">
                <GlassInput type="date" value={dateDppReceived} onChange={(e) => setDateDppReceived(e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Standard Response Sent">
                <GlassInput type="date" value={standardResponseSent} onChange={(e) => setStandardResponseSent(e.target.value)} />
              </Field>
              <Field label="Forwarded email to Ron K. (optional)">
                <GlassInput type="date" value={forwardedToRon} onChange={(e) => setForwardedToRon(e.target.value)} />
              </Field>
            </div>
            <Field label="Original email" hint="Upload the requester email as an Outlook .msg or .eml file so replies and forwards can preserve the original message context.">
              <input
                type="file"
                accept=".msg,.eml,application/vnd.ms-outlook,message/rfc822"
                className="block w-full text-sm text-muted file:mr-3 file:rounded-capsule file:border file:border-line file:bg-[var(--pf-highlight)] file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-ink hover:file:brightness-110"
                onChange={(e) => void handleSourceEmail(e.target.files?.[0] ?? null)}
              />
            </Field>
            {sourceEmail && (
              <div className="flex items-start gap-2 rounded-xl border border-line bg-[var(--pf-highlight)] px-3 py-2 text-xs text-muted">
                <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                <p>
                  Parsed <span className="text-ink">{sourceEmail.subject}</span>
                  {sourceEmail.fromEmail ? ` from ${sourceEmail.fromEmail}` : ''}. This email will be saved in Communications.
                </p>
              </div>
            )}
            {sourceEmailError && <p className="text-xs text-red-400">{sourceEmailError}</p>}
          </div>
        </GlassPanel>

        <GlassPanel className="lg:col-span-2">
          <Field label="Description" error={errors.description}>
            <GlassTextarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Summarise what the requester is asking for…" />
          </Field>
          {descriptionTemplates.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Insert</span>
              {descriptionTemplates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => insertDescriptionTemplate(template)}
                  className="rounded-capsule border border-line px-2.5 py-1 text-[11px] text-muted hover:text-ink focus-ring"
                  title={`Insert ${template.name}`}
                >
                  {template.name}
                </button>
              ))}
            </div>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <GlassButton type="button" onClick={() => navigate('/cases')}>Cancel</GlassButton>
            <GlassButton type="submit" variant="primary" loading={busy}>Create request</GlassButton>
          </div>
        </GlassPanel>
      </form>
    </div>
  );
}
