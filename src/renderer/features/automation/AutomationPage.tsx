import React from 'react';
import {
  Mail, Zap, Save, Check, Plus, Trash2, Pencil, Users,
} from 'lucide-react';
import { platform } from '../../platform';
import type { OrgSettings, EmailTemplate, AutomationRule, AutomationRecipient } from '@shared/types';
import { CASE_STATUSES } from '@shared/constants';
import { PageHeader } from '../../layouts/AppShell';
import {
  GlassPanel, GlassButton, GlassBadge, GlassInput, GlassSelect, GlassTextarea, Field, Spinner,
} from '../../components/glass';
import { useAuth, can } from '../../store/auth';

const uid = () =>
  (globalThis.crypto?.randomUUID?.() ?? `id-${Math.random().toString(36).slice(2)}-${Date.now()}`);

const PLACEHOLDERS = [
  '{{requester.lastName}}', '{{requester.email}}',
  '{{case.number}}', '{{case.types}}', '{{case.status}}',
  '{{case.receivedDate}}', '{{org.name}}', '{{rule.department}}',
];

type Tab = 'emails' | 'recipients';

export function AutomationPage() {
  const { user } = useAuth();
  const [settings, setSettings] = React.useState<OrgSettings | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [tab, setTab] = React.useState<Tab>('emails');
  const [editingTemplate, setEditingTemplate] = React.useState<EmailTemplate | null>(null);

  React.useEffect(() => {
    platform().system.settings().then(setSettings);
  }, []);

  if (!settings) return <Spinner label="Loading automation settings…" />;

  const editable = can(user?.role, 'settings.manage');

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

  function updateAutomationRule(id: string, p: Partial<AutomationRule>) {
    patch({ automationRules: settings!.automationRules.map((r) => (r.id === id ? { ...r, ...p } : r)) });
  }

  function addAutomationRule() {
    const tpl = settings!.emailTemplates[0];
    if (!tpl) return;
    patch({
      automationRules: [
        ...settings!.automationRules,
        { id: uid(), name: 'New rule', trigger: 'case.created', templateId: tpl.id, enabled: true },
      ],
    });
  }

  function deleteAutomationRule(id: string) {
    patch({ automationRules: settings!.automationRules.filter((r) => r.id !== id) });
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
    });
    setSettings(s);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  }

  const templateName = (id: string) => settings.emailTemplates.find((t) => t.id === id)?.name ?? '-';
  const recipientNames = settings.automationRecipients.map((recipient) => recipient.name).filter(Boolean);

  return (
    <div>
      <PageHeader
        title="Automation"
        subtitle="Automated template emails to requesters and departments."
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
          <p className="text-sm text-muted">You have read-only access. Contact an administrator or privacy manager to change automation.</p>
        </GlassPanel>
      )}

      <div className="mb-4 flex gap-1 border-b border-line pb-2">
        {([
          ['emails', 'Email automation', Mail],
          ['recipients', 'Recipients', Users],
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
        <div className="grid gap-4 lg:grid-cols-2">
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
            Templates support placeholders like <code className="text-accent">{'{{case.number}}'}</code> and{' '}
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
                <GlassTextarea rows={7} value={editingTemplate.body} onChange={(e) => setEditingTemplate({ ...editingTemplate, body: e.target.value })} />
              </Field>
              <div className="flex flex-wrap gap-1">
                {PLACEHOLDERS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setEditingTemplate({ ...editingTemplate, body: `${editingTemplate.body}${editingTemplate.body ? ' ' : ''}${p}` })}
                    className="rounded-capsule border border-line px-2 py-1 text-[11px] text-muted hover:text-ink focus-ring"
                  >
                    {p}
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
          <p className="mb-3 text-xs text-muted">Rules run saved email templates when requests are created, details change, or status changes are logged.</p>

          <div className="flex flex-col gap-2">
            {settings.automationRules.map((r) => (
              <div key={r.id} className="rounded-xl border border-line px-4 py-3">
                <div className="flex items-center gap-2">
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
                  {r.trigger === 'case.created'
                    ? 'When a request is created'
                    : r.trigger === 'case.updated'
                      ? 'When request details change'
                      : `When status changes to ${r.toStatus ?? '-'}`}
                  {' '}send <span className="text-accent">{templateName(r.templateId)}</span>
                </p>
                {editable && (
                  <div className="mt-3 grid gap-2 md:grid-cols-4">
                    <GlassInput value={r.name} onChange={(e) => updateAutomationRule(r.id, { name: e.target.value })} />
                    <GlassSelect value={r.trigger} onChange={(e) => updateAutomationRule(r.id, { trigger: e.target.value as AutomationRule['trigger'] })}>
                      <option value="case.created">On request created</option>
                      <option value="case.updated">On request details changed</option>
                      <option value="status.changed">On status change</option>
                    </GlassSelect>
                    {r.trigger === 'status.changed' ? (
                      <GlassSelect value={String(r.toStatus ?? 'Email Response Sent')} onChange={(e) => updateAutomationRule(r.id, { toStatus: e.target.value })}>
                        {CASE_STATUSES.map((s) => <option key={s}>{s}</option>)}
                      </GlassSelect>
                    ) : (
                      <div />
                    )}
                    <GlassSelect value={r.templateId} onChange={(e) => updateAutomationRule(r.id, { templateId: e.target.value })}>
                      {settings.emailTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </GlassSelect>
                  </div>
                )}
              </div>
            ))}
            {settings.automationRules.length === 0 && (
              <p className="py-6 text-center text-sm text-muted">No rules yet. Rules send templates automatically when their trigger fires.</p>
            )}
          </div>
          </GlassPanel>
        </div>
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

      <GlassPanel className="mt-4">
        <p className="text-xs text-muted">
          All automation changes are recorded in the audit trail and take effect immediately after saving.
          Automation results appear on each request's Communications tab as draft/log entries.
        </p>
      </GlassPanel>
    </div>
  );
}
