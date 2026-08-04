import React from 'react';
import {
  Mail, Zap, Save, Check, Plus, Trash2, Pencil, Users, ChevronDown, ChevronRight,
  FileText,
} from 'lucide-react';
import { platform } from '../../platform';
import type { OrgSettings, EmailTemplate, AutomationRule, AutomationRecipient, NoteTemplate } from '@shared/types';
import { CASE_STATUSES, INTAKE_CHANNELS, REQUEST_TYPES } from '@shared/constants';
import { PROJECT_PLACEHOLDERS, REQUEST_PLACEHOLDERS } from '@shared/placeholders';
import { PageHeader } from '../../layouts/AppShell';
import {
  GlassPanel, GlassButton, GlassBadge, GlassInput, GlassSelect, GlassTextarea, Field, Spinner,
} from '../../components/glass';
import { useAuth } from '../../store/auth';
import { insertTextAtCursor } from '../../lib/textInsert';

const uid = () =>
  (globalThis.crypto?.randomUUID?.() ?? `id-${Math.random().toString(36).slice(2)}-${Date.now()}`);

const UPDATE_FIELD_OPTIONS = [
  ['', 'Any changed field'],
  ['requestTypes', 'Request types'],
  ['intakeChannel', 'Intake channel'],
  ['description', 'Description'],
  ['subject.identifiers.Request ID', 'Request ID'],
  ['subject.lastName', 'Last name'],
  ['subject.emails', 'Email'],
  ['subject.relationship', 'Relationship'],
  ['subject.clientCenterStatus', 'Client Center Status'],
  ['subject.emailedFA', 'Emailed FA'],
  ['intakeDates.dateClientServiceReceivedEmail', "Client Svcs. rec'd email"],
  ['intakeDates.dateDppReceivedEmail', "DPP rec'd email from Client Svcs."],
  ['intakeDates.standardResponseSent', 'Standard Response Sent'],
  ['intakeDates.forwardedEmailToRon', 'Forwarded email to Ron K.'],
  ['intakeDates.followUpEmailSent', 'Follow-up sent'],
  ['sla.closureDate', 'Closed'],
] as const;

type Tab = 'emails' | 'rules' | 'recipients' | 'notes';

export function AutomationPage() {
  const { user } = useAuth();
  const [settings, setSettings] = React.useState<OrgSettings | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [tab, setTab] = React.useState<Tab>('emails');
  const [editingTemplate, setEditingTemplate] = React.useState<EmailTemplate | null>(null);
  const [editingNoteTemplate, setEditingNoteTemplate] = React.useState<NoteTemplate | null>(null);
  const [expandedRules, setExpandedRules] = React.useState<string[]>([]);
  const templateBodyRef = React.useRef<HTMLTextAreaElement | null>(null);
  const noteBodyRef = React.useRef<HTMLTextAreaElement | null>(null);

  React.useEffect(() => {
    platform().system.settings().then(setSettings);
  }, []);

  if (!settings) return <Spinner label="Loading automation settings…" />;

  const editable = !!user;

  function patch(p: Partial<OrgSettings>) {
    setSettings({ ...settings!, ...p });
  }

  function saveTemplate(t: EmailTemplate) {
    const list = settings!.emailTemplates;
    const exists = list.some((x) => x.id === t.id);
    patch({ emailTemplates: exists ? list.map((x) => (x.id === t.id ? t : x)) : [...list, t] });
    setEditingTemplate(null);
  }

  function deleteTemplate(id: string) {
    patch({
      emailTemplates: settings!.emailTemplates.filter((t) => t.id !== id),
      automationRules: settings!.automationRules.filter((r) => r.templateId !== id),
    });
  }

  function saveNoteTemplate(t: NoteTemplate) {
    const list = settings!.noteTemplates ?? [];
    const exists = list.some((x) => x.id === t.id);
    patch({ noteTemplates: exists ? list.map((x) => (x.id === t.id ? t : x)) : [...list, t] });
    setEditingNoteTemplate(null);
  }

  function deleteNoteTemplate(id: string) {
    patch({ noteTemplates: (settings!.noteTemplates ?? []).filter((t) => t.id !== id) });
  }

  function updateAutomationRule(id: string, p: Partial<AutomationRule>) {
    patch({ automationRules: settings!.automationRules.map((r) => (r.id === id ? { ...r, ...p } : r)) });
  }

  function addAutomationRule() {
    const tpl = settings!.emailTemplates[0];
    if (!tpl) return;
    const id = uid();
    patch({
      automationRules: [
        ...settings!.automationRules,
        { id, name: 'New rule', trigger: 'case.created', templateId: tpl.id, enabled: true },
      ],
    });
    setExpandedRules((ids) => [...ids, id]);
  }

  function deleteAutomationRule(id: string) {
    patch({ automationRules: settings!.automationRules.filter((r) => r.id !== id) });
    setExpandedRules((ids) => ids.filter((x) => x !== id));
  }

  function toggleAutomationRule(id: string) {
    setExpandedRules((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  function updateRecipient(id: string, p: Partial<AutomationRecipient>) {
    patch({
      automationRecipients: settings!.automationRecipients.map((recipient) =>
        recipient.id === id ? { ...recipient, ...p } : recipient,
      ),
    });
  }

  function addRecipient() {
    patch({
      automationRecipients: [
        ...settings!.automationRecipients,
        { id: uid(), name: 'New recipient', email: '', enabled: true },
      ],
    });
  }

  function deleteRecipient(id: string) {
    patch({ automationRecipients: settings!.automationRecipients.filter((recipient) => recipient.id !== id) });
  }

  async function save() {
    const s = await platform().system.updateSettings({
      emailTemplates: settings!.emailTemplates,
      automationRules: settings!.automationRules,
      automationRecipients: settings!.automationRecipients,
      noteTemplates: settings!.noteTemplates ?? [],
    });
    setSettings(s);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  }

  const templateName = (id: string) => settings.emailTemplates.find((t) => t.id === id)?.name ?? '-';
  const updateFieldLabel = (field?: string) =>
    UPDATE_FIELD_OPTIONS.find(([value]) => value === (field ?? ''))?.[1] ?? field ?? 'Any changed field';
  const ruleTriggerText = (r: AutomationRule) => {
    if (r.trigger === 'case.created') return 'When a request is created';
    if (r.trigger === 'case.updated') return r.updateField ? `When ${updateFieldLabel(r.updateField).toLowerCase()} changes` : 'When request details change';
    return `When status changes to ${r.toStatus ?? '-'}`;
  };
  const ruleConditionText = (r: AutomationRule) => {
    const conditions = [
      r.requestType ? `request type is ${r.requestType}` : '',
      r.excludeRequestType ? `request type is not ${r.excludeRequestType}` : '',
      r.intakeChannel ? `intake channel is ${r.intakeChannel}` : '',
    ].filter(Boolean);
    return conditions.length ? `Only when ${conditions.join(' and ')}` : 'Applies to all requests';
  };
  const recipientNames = settings.automationRecipients.map((recipient) => recipient.name).filter(Boolean);
  const notePlaceholders = editingNoteTemplate?.target === 'comments'
    ? PROJECT_PLACEHOLDERS
    : REQUEST_PLACEHOLDERS;

  return (
    <div>
      <PageHeader
        title="Automation"
        subtitle="Your personal templates, rules, recipients, and note shortcuts."
        actions={
          editable && (
            <GlassButton variant="primary" onClick={save}>
              {saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
              {saved ? 'Saved' : 'Save changes'}
            </GlassButton>
          )
        }
      />

      {!editable && (
        <GlassPanel className="mb-4">
          <p className="text-sm text-muted">Sign in to change your personal automation settings.</p>
        </GlassPanel>
      )}

      <div className="mb-4 flex gap-1 border-b border-line pb-2">
        {([
          ['emails', 'Email automation', Mail],
          ['rules', 'Rules', Zap],
          ['recipients', 'Recipients', Users],
          ['notes', 'Notes', FileText],
        ] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 rounded-capsule px-3 py-1.5 text-sm font-medium transition-all focus-ring ${
              tab === key ? 'bg-accent/15 text-ink' : 'text-muted hover:text-ink'
            }`}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {tab === 'emails' && (
        <div className="grid gap-4">
          <GlassPanel>
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-accent" />
              <h3 className="text-sm font-semibold text-ink">Email templates</h3>
            </div>
            {editable && (
              <GlassButton
                variant="ghost"
                className="px-2 py-1 text-xs"
                onClick={() =>
                  setEditingTemplate({
                    id: uid(), name: '', subject: '', body: '', audience: 'requester',
                  })
                }
              >
                <Plus className="h-3.5 w-3.5" /> New template
              </GlassButton>
            )}
          </div>
          <p className="mb-3 text-xs text-muted">
            Templates support placeholders like <code className="text-accent">{'{{case.requestId}}'}</code>,{' '}
            <code className="text-accent">{'{{case.number}}'}</code>, and{' '}
            <code className="text-accent">{'{{requester.lastName}}'}</code>, replaced when the email sends.
          </p>

          <div className="flex flex-col gap-2">
            {settings.emailTemplates.map((t) => (
              <div key={t.id} className="rounded-xl border border-line px-4 py-3">
                <div className="flex items-center gap-2">
                  <p className="flex-1 text-sm font-medium text-ink">{t.name}</p>
                  <GlassBadge tone={t.audience === 'requester' ? 'info' : 'warn'}>
                    {t.audience === 'requester' ? 'To requester' : `To ${t.department ?? 'department'}`}
                  </GlassBadge>
                  {editable && (
                    <>
                      <button onClick={() => setEditingTemplate({ ...t })} className="rounded-lg p-1.5 text-muted hover:text-ink focus-ring" title="Edit">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => deleteTemplate(t.id)} className="rounded-lg p-1.5 text-muted hover:text-red-400 focus-ring" title="Delete">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted">Subject: {t.subject}</p>
              </div>
            ))}
            {settings.emailTemplates.length === 0 && (
              <p className="py-6 text-center text-sm text-muted">No templates yet. Create one to enable rules.</p>
            )}
          </div>

          {editingTemplate && (
            <div className="mt-4 flex flex-col gap-3 rounded-xl border border-accent/40 bg-[var(--pf-surface)] p-4">
              <p className="text-sm font-semibold text-ink">
                {settings.emailTemplates.some((t) => t.id === editingTemplate.id) ? 'Edit template' : 'New template'}
              </p>
              <Field label="Template name">
                <GlassInput value={editingTemplate.name} onChange={(e) => setEditingTemplate({ ...editingTemplate, name: e.target.value })} placeholder="e.g. Request acknowledgement" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Send to">
                  <GlassSelect
                    value={editingTemplate.audience}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, audience: e.target.value as EmailTemplate['audience'] })}
                  >
                    <option value="requester">Requester</option>
                    <option value="department">Department</option>
                  </GlassSelect>
                </Field>
                {editingTemplate.audience === 'department' && (
                  <Field label="Department">
                    <GlassSelect
                      value={editingTemplate.department ?? recipientNames[0] ?? 'Ron K.'}
                      onChange={(e) => setEditingTemplate({ ...editingTemplate, department: e.target.value })}
                    >
                      {recipientNames.map((d) => <option key={d}>{d}</option>)}
                    </GlassSelect>
                  </Field>
                )}
              </div>
              <Field label="Subject">
                <GlassInput value={editingTemplate.subject} onChange={(e) => setEditingTemplate({ ...editingTemplate, subject: e.target.value })} />
              </Field>
              <Field label="Body">
                <GlassTextarea
                  ref={templateBodyRef}
                  rows={7}
                  value={editingTemplate.body}
                  onChange={(e) => setEditingTemplate({ ...editingTemplate, body: e.target.value })}
                />
              </Field>
              <div className="flex flex-wrap gap-1">
                {REQUEST_PLACEHOLDERS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setEditingTemplate({
                      ...editingTemplate,
                      body: insertTextAtCursor(templateBodyRef.current, editingTemplate.body, p.token),
                    })}
                    className="rounded-capsule border border-line px-2 py-1 text-[11px] text-muted hover:text-ink focus-ring"
                    title={p.label}
                  >
                    {p.token}
                  </button>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <GlassButton onClick={() => setEditingTemplate(null)}>Cancel</GlassButton>
                <GlassButton variant="primary" onClick={() => saveTemplate(editingTemplate)} disabled={!editingTemplate.name.trim() || !editingTemplate.subject.trim()}>
                  Save template
                </GlassButton>
              </div>
            </div>
          )}
          </GlassPanel>

        </div>
      )}

      {tab === 'rules' && (
        <GlassPanel>
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-accent" />
              <h3 className="text-sm font-semibold text-ink">Rules</h3>
            </div>
            {editable && (
              <GlassButton variant="ghost" className="px-2 py-1 text-xs" onClick={addAutomationRule} disabled={settings.emailTemplates.length === 0}>
                <Plus className="h-3.5 w-3.5" /> New rule
              </GlassButton>
            )}
          </div>
          <p className="mb-3 text-xs text-muted">
            Rules run saved email templates when requests are created, details change, or status changes are logged. Add optional conditions or a request type exception to control when a rule runs.
          </p>

          <div className="flex flex-col gap-2">
            {settings.automationRules.map((r) => (
              <div key={r.id} className="rounded-xl border border-line px-4 py-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleAutomationRule(r.id)}
                    className="rounded-lg p-1.5 text-muted hover:text-ink focus-ring"
                    title={expandedRules.includes(r.id) ? 'Collapse rule' : 'Expand rule'}
                    aria-expanded={expandedRules.includes(r.id)}
                  >
                    {expandedRules.includes(r.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  <input
                    type="checkbox"
                    className="h-4 w-4 focus-ring"
                    checked={r.enabled}
                    disabled={!editable}
                    onChange={(e) => updateAutomationRule(r.id, { enabled: e.target.checked })}
                  />
                  <p className="min-w-0 flex-1 text-sm font-medium text-ink">{r.name}</p>
                  <GlassBadge tone={r.enabled ? 'success' : 'neutral'}>{r.enabled ? 'Enabled' : 'Off'}</GlassBadge>
                  {editable && (
                    <button onClick={() => deleteAutomationRule(r.id)} className="rounded-lg p-1.5 text-muted hover:text-red-400 focus-ring" title="Delete">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted">
                  {ruleTriggerText(r)}
                  {' '}send <span className="text-accent">{templateName(r.templateId)}</span>
                </p>
                <p className="mt-1 text-xs text-muted">{ruleConditionText(r)}</p>
                {editable && expandedRules.includes(r.id) && (
                  <div className="mt-3 flex flex-col gap-3 rounded-xl border border-line/70 bg-[var(--pf-surface)] p-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field label="Rule name">
                        <GlassInput value={r.name} onChange={(e) => updateAutomationRule(r.id, { name: e.target.value })} />
                      </Field>
                      <Field label="Send template">
                        <GlassSelect value={r.templateId} onChange={(e) => updateAutomationRule(r.id, { templateId: e.target.value })}>
                          {settings.emailTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </GlassSelect>
                      </Field>
                    </div>

                    <div className="grid gap-3 md:grid-cols-3">
                      <Field label="Run when">
                        <GlassSelect
                          value={r.trigger}
                          onChange={(e) => {
                            const trigger = e.target.value as AutomationRule['trigger'];
                            updateAutomationRule(r.id, {
                              trigger,
                              updateField: trigger === 'case.updated' ? (r.updateField ?? '') : undefined,
                              toStatus: trigger === 'status.changed' ? (r.toStatus ?? 'Email Response Sent') : undefined,
                            });
                          }}
                        >
                          <option value="case.created">Request created</option>
                          <option value="case.updated">Request detail changes</option>
                          <option value="status.changed">Status changes</option>
                        </GlassSelect>
                      </Field>
                      {r.trigger === 'case.updated' ? (
                        <Field label="Changed field">
                          <GlassSelect value={r.updateField ?? ''} onChange={(e) => updateAutomationRule(r.id, { updateField: e.target.value })}>
                            {UPDATE_FIELD_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                          </GlassSelect>
                        </Field>
                      ) : (
                        <Field label="Changed field">
                          <GlassInput value="Not used for this trigger" disabled />
                        </Field>
                      )}
                      {r.trigger === 'status.changed' ? (
                        <Field label="Status">
                          <GlassSelect value={String(r.toStatus ?? 'Email Response Sent')} onChange={(e) => updateAutomationRule(r.id, { toStatus: e.target.value })}>
                            {CASE_STATUSES.map((s) => <option key={s}>{s}</option>)}
                          </GlassSelect>
                        </Field>
                      ) : (
                        <Field label="Status">
                          <GlassInput value="Not used for this trigger" disabled />
                        </Field>
                      )}
                    </div>

                    <div className="grid gap-3 md:grid-cols-3">
                      <Field label="Request type condition">
                        <GlassSelect
                          value={r.requestType ?? ''}
                          onChange={(e) => {
                            const requestType = e.target.value || undefined;
                            updateAutomationRule(r.id, {
                              requestType,
                              excludeRequestType: requestType === r.excludeRequestType ? undefined : r.excludeRequestType,
                            });
                          }}
                        >
                          <option value="">Any request type</option>
                          {REQUEST_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                        </GlassSelect>
                      </Field>
                      <Field label="Request type exception">
                        <GlassSelect
                          value={r.excludeRequestType ?? ''}
                          onChange={(e) => {
                            const excludeRequestType = e.target.value || undefined;
                            updateAutomationRule(r.id, {
                              excludeRequestType,
                              requestType: excludeRequestType === r.requestType ? undefined : r.requestType,
                            });
                          }}
                        >
                          <option value="">No exception</option>
                          {REQUEST_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                        </GlassSelect>
                      </Field>
                      <Field label="Intake channel condition">
                        <GlassSelect value={r.intakeChannel ?? ''} onChange={(e) => updateAutomationRule(r.id, { intakeChannel: e.target.value || undefined })}>
                          <option value="">Any intake channel</option>
                          {INTAKE_CHANNELS.map((channel) => <option key={channel} value={channel}>{channel}</option>)}
                        </GlassSelect>
                      </Field>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {settings.automationRules.length === 0 && (
              <p className="py-6 text-center text-sm text-muted">No rules yet. Rules send templates automatically when their trigger fires.</p>
            )}
          </div>
        </GlassPanel>
      )}

      {tab === 'recipients' && (
        <GlassPanel>
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-accent" />
              <h3 className="text-sm font-semibold text-ink">Recipients</h3>
            </div>
            {editable && (
              <GlassButton variant="ghost" className="px-2 py-1 text-xs" onClick={addRecipient}>
                <Plus className="h-3.5 w-3.5" /> New recipient
              </GlassButton>
            )}
          </div>
          <p className="mb-3 text-xs text-muted">
            Department templates use these email addresses when PrivacyFlow opens Outlook drafts.
          </p>

          <div className="content-surface overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[var(--pf-surface-2)]">
                <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3">Enabled</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Email address</th>
                  {editable && <th className="px-4 py-3">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {settings.automationRecipients.map((recipient) => (
                  <tr key={recipient.id} className="border-b border-line/60">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        className="h-4 w-4 focus-ring"
                        checked={recipient.enabled}
                        disabled={!editable}
                        onChange={(e) => updateRecipient(recipient.id, { enabled: e.target.checked })}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <GlassInput
                        disabled={!editable}
                        value={recipient.name}
                        onChange={(e) => updateRecipient(recipient.id, { name: e.target.value })}
                        placeholder="e.g. Ron K."
                      />
                    </td>
                    <td className="px-4 py-3">
                      <GlassInput
                        disabled={!editable}
                        type="email"
                        value={recipient.email}
                        onChange={(e) => updateRecipient(recipient.id, { email: e.target.value })}
                        placeholder="name@example.com"
                      />
                    </td>
                    {editable && (
                      <td className="px-4 py-3">
                        <button
                          onClick={() => deleteRecipient(recipient.id)}
                          className="rounded-lg p-1.5 text-muted hover:text-red-400 focus-ring"
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassPanel>
      )}

      {tab === 'notes' && (
        <GlassPanel>
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-accent" />
              <h3 className="text-sm font-semibold text-ink">Note templates</h3>
            </div>
            {editable && (
              <GlassButton
                variant="ghost"
                className="px-2 py-1 text-xs"
                onClick={() => setEditingNoteTemplate({ id: uid(), name: '', target: 'description', body: '' })}
              >
                <Plus className="h-3.5 w-3.5" /> New note template
              </GlassButton>
            )}
          </div>
          <p className="mb-3 text-xs text-muted">
            Note templates appear as insert options below the New Request description or New Project comments field based on the selected target.
          </p>

          <div className="flex flex-col gap-2">
            {(settings.noteTemplates ?? []).map((t) => (
              <div key={t.id} className="rounded-xl border border-line px-4 py-3">
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 text-sm font-medium text-ink">{t.name}</p>
                  <GlassBadge tone={t.target === 'description' ? 'info' : 'success'}>
                    {t.target === 'description' ? 'Description' : 'Comments'}
                  </GlassBadge>
                  {editable && (
                    <>
                      <button onClick={() => setEditingNoteTemplate({ ...t })} className="rounded-lg p-1.5 text-muted hover:text-ink focus-ring" title="Edit">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => deleteNoteTemplate(t.id)} className="rounded-lg p-1.5 text-muted hover:text-red-400 focus-ring" title="Delete">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>
                <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-xs text-muted">{t.body}</p>
              </div>
            ))}
            {(settings.noteTemplates ?? []).length === 0 && (
              <p className="py-6 text-center text-sm text-muted">No note templates yet. Create one to add inserts to request descriptions or project comments.</p>
            )}
          </div>

          {editingNoteTemplate && (
            <div className="mt-4 flex flex-col gap-3 rounded-xl border border-accent/40 bg-[var(--pf-surface)] p-4">
              <p className="text-sm font-semibold text-ink">
                {(settings.noteTemplates ?? []).some((t) => t.id === editingNoteTemplate.id) ? 'Edit note template' : 'New note template'}
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Template name">
                  <GlassInput
                    value={editingNoteTemplate.name}
                    onChange={(e) => setEditingNoteTemplate({ ...editingNoteTemplate, name: e.target.value })}
                    placeholder="e.g. Standard intake note"
                  />
                </Field>
                <Field label="Show on">
                  <GlassSelect
                    value={editingNoteTemplate.target}
                    onChange={(e) => setEditingNoteTemplate({ ...editingNoteTemplate, target: e.target.value as NoteTemplate['target'] })}
                  >
                    <option value="description">New request description</option>
                    <option value="comments">New project comments</option>
                  </GlassSelect>
                </Field>
              </div>
              <Field label="Template text">
                <GlassTextarea
                  ref={noteBodyRef}
                  rows={6}
                  value={editingNoteTemplate.body}
                  onChange={(e) => setEditingNoteTemplate({ ...editingNoteTemplate, body: e.target.value })}
                  placeholder="Enter reusable note text..."
                />
              </Field>
              <div className="flex flex-wrap gap-1">
                {notePlaceholders.map((placeholder) => (
                  <button
                    key={placeholder.key}
                    type="button"
                    onClick={() => setEditingNoteTemplate({
                      ...editingNoteTemplate,
                      body: insertTextAtCursor(noteBodyRef.current, editingNoteTemplate.body, placeholder.token),
                    })}
                    className="rounded-capsule border border-line px-2 py-1 text-[11px] text-muted hover:text-ink focus-ring"
                    title={placeholder.label}
                  >
                    {placeholder.token}
                  </button>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <GlassButton onClick={() => setEditingNoteTemplate(null)}>Cancel</GlassButton>
                <GlassButton
                  variant="primary"
                  onClick={() => saveNoteTemplate(editingNoteTemplate)}
                  disabled={!editingNoteTemplate.name.trim() || !editingNoteTemplate.body.trim()}
                >
                  Save note template
                </GlassButton>
              </div>
            </div>
          )}
        </GlassPanel>
      )}

      <GlassPanel className="mt-4">
        <p className="text-xs text-muted">
          All automation changes are recorded in the audit trail and take effect immediately after saving.
          Automation results appear on each request's Communications tab as draft/log entries.
        </p>
      </GlassPanel>
    </div>
  );
}
