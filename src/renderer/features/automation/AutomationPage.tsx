import React from 'react';
import {
  Mail, Zap, Clock, Bell, PauseCircle, ArrowUpCircle, Save, Check, Plus, X, Trash2, Pencil,
} from 'lucide-react';
import { platform } from '../../platform';
import type { OrgSettings, SlaRule, EmailTemplate, AutomationRule } from '@shared/types';
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
  '{{case.number}}', '{{case.types}}', '{{case.status}}', '{{case.dueDate}}',
  '{{case.receivedDate}}', '{{org.name}}', '{{rule.department}}',
];

const DEPARTMENTS = ['Customer Support', 'Marketing', 'Sales', 'People', 'Finance', 'Legal', 'IT', 'Engineering'];

function Toggle({
  checked, onChange, disabled,
}: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full border border-line transition-all focus-ring disabled:opacity-50 ${
        checked ? 'bg-accent' : 'bg-[var(--pf-highlight)]'
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
          checked ? 'left-[22px]' : 'left-0.5'
        }`}
      />
    </button>
  );
}

type Tab = 'emails' | 'sla';

export function AutomationPage() {
  const { user } = useAuth();
  const [settings, setSettings] = React.useState<OrgSettings | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [newCadence, setNewCadence] = React.useState('');
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

  // ---- SLA helpers ----
  function updateRule(jurisdiction: string, p: Partial<SlaRule>) {
    patch({ slaRules: settings!.slaRules.map((r) => r.jurisdiction === jurisdiction ? { ...r, ...p } : r) });
  }
  function addCadence() {
    const n = parseInt(newCadence, 10);
    if (!Number.isFinite(n) || n <= 0 || settings!.reminderCadenceDays.includes(n)) { setNewCadence(''); return; }
    patch({ reminderCadenceDays: [...settings!.reminderCadenceDays, n].sort((a, b) => b - a) });
    setNewCadence('');
  }
  function removeCadence(d: number) {
    patch({ reminderCadenceDays: settings!.reminderCadenceDays.filter((x) => x !== d) });
  }

  // ---- Template helpers ----
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

  // ---- Rule helpers ----
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

  async function save() {
    const s = await platform().system.updateSettings({
      slaRules: settings!.slaRules,
      reminderCadenceDays: settings!.reminderCadenceDays,
      dueSoonThresholdDays: settings!.dueSoonThresholdDays,
      autoPauseSla: settings!.autoPauseSla,
      escalationAlerts: settings!.escalationAlerts,
      emailTemplates: settings!.emailTemplates,
      automationRules: settings!.automationRules,
    });
    setSettings(s);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  }

  const templateName = (id: string) => settings.emailTemplates.find((t) => t.id === id)?.name ?? '—';

  return (
    <div>
      <PageHeader
        title="Automation"
        subtitle="Automated template emails to requesters and departments, plus SLA rules that drive deadlines."
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
        {([['emails', 'Email automation', Mail], ['sla', 'SLA rules', Clock]] as const).map(([key, label, Icon]) => (
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
          {/* ------------------------- Templates ------------------------- */}
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
                      <option value="requester">Data subject requester</option>
                      <option value="department">Internal department</option>
                    </GlassSelect>
                  </Field>
                  {editingTemplate.audience === 'department' && (
                    <Field label="Department">
                      <GlassSelect
                        value={editingTemplate.department ?? DEPARTMENTS[0]}
                        onChange={(e) => setEditingTemplate({ ...editingTemplate, department: e.target.value })}
                      >
                        {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
                      </GlassSelect>
                    </Field>
                  )}
                </div>
                <Field label="Subject">
                  <GlassInput value={editingTemplate.subject} onChange={(e) => setEditingTemplate({ ...editingTemplate, subject: e.target.value })} />
                </Field>
                <Field label="Body">
                  <GlassTextarea rows={6} value={editingTemplate.body} onChange={(e) => setEditingTemplate({ ...editingTemplate, body: e.target.value })} />
                </Field>
                <div className="flex flex-wrap gap-1">
                  {PLACEHOLDERS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setEditingTemplate({ ...editingTemplate, body: `${editingTemplate.body}${p}` })}
                      className="rounded-capsule border border-line px-2 py-0.5 font-mono text-[10px] text-muted hover:text-ink focus-ring"
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <div className="flex justify-end gap-2">
                  <GlassButton onClick={() => setEditingTemplate(null)}>Cancel</GlassButton>
                  <GlassButton
                    variant="primary"
                    disabled={!editingTemplate.name.trim() || !editingTemplate.subject.trim()}
                    onClick={() => saveTemplate(editingTemplate)}
                  >
                    Save template
                  </GlassButton>
                </div>
              </div>
            )}
          </GlassPanel>

          {/* --------------------------- Rules --------------------------- */}
          <GlassPanel>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-accent" />
                <h3 className="text-sm font-semibold text-ink">Automation rules</h3>
              </div>
              {editable && (
                <GlassButton variant="ghost" className="px-2 py-1 text-xs" onClick={addAutomationRule} disabled={!settings.emailTemplates.length}>
                  <Plus className="h-3.5 w-3.5" /> New rule
                </GlassButton>
              )}
            </div>
            <p className="mb-3 text-xs text-muted">
              When a rule fires, the template is rendered and logged as an automated send on the request's
              Communications tab and in the audit trail.
            </p>

            <div className="flex flex-col gap-2">
              {settings.automationRules.map((r) => (
                <div key={r.id} className="rounded-xl border border-line px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Toggle
                      checked={r.enabled}
                      disabled={!editable}
                      onChange={(v) => updateAutomationRule(r.id, { enabled: v })}
                    />
                    <div className="min-w-0 flex-1">
                      {editable ? (
                        <GlassInput
                          className="mb-1 px-2 py-1 text-sm"
                          value={r.name}
                          onChange={(e) => updateAutomationRule(r.id, { name: e.target.value })}
                        />
                      ) : (
                        <p className="text-sm font-medium text-ink">{r.name}</p>
                      )}
                      <p className="text-xs text-muted">
                        When{' '}
                        {r.trigger === 'case.created'
                          ? 'a request is created'
                          : `status changes to "${r.toStatus ?? 'any'}"`}
                        {' '}→ send "{templateName(r.templateId)}"
                      </p>
                    </div>
                    {editable && (
                      <button onClick={() => deleteAutomationRule(r.id)} className="rounded-lg p-1.5 text-muted hover:text-red-400 focus-ring" title="Delete rule">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  {editable && (
                    <div className="mt-2 grid grid-cols-2 gap-2 border-t border-line/60 pt-2">
                      <GlassSelect
                        value={r.trigger}
                        onChange={(e) => updateAutomationRule(r.id, { trigger: e.target.value as AutomationRule['trigger'], toStatus: e.target.value === 'status.changed' ? (r.toStatus ?? 'In Progress') : undefined })}
                      >
                        <option value="case.created">Request created</option>
                        <option value="status.changed">Status changes to…</option>
                      </GlassSelect>
                      {r.trigger === 'status.changed' ? (
                        <GlassSelect
                          value={String(r.toStatus ?? 'In Progress')}
                          onChange={(e) => updateAutomationRule(r.id, { toStatus: e.target.value })}
                        >
                          {CASE_STATUSES.map((s) => <option key={s}>{s}</option>)}
                        </GlassSelect>
                      ) : (
                        <div />
                      )}
                      <GlassSelect
                        className="col-span-2"
                        value={r.templateId}
                        onChange={(e) => updateAutomationRule(r.id, { templateId: e.target.value })}
                      >
                        {settings.emailTemplates.map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
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

      {tab === 'sla' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <GlassPanel>
            <div className="mb-3 flex items-center gap-2">
              <Clock className="h-4 w-4 text-accent" />
              <h3 className="text-sm font-semibold text-ink">Statutory deadlines</h3>
            </div>
            <p className="mb-3 text-xs text-muted">
              Applied to every <strong className="text-ink">new request</strong> — the due date is computed
              from the rule matching its jurisdiction.
            </p>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                  <th className="py-2">Jurisdiction</th>
                  <th className="py-2 w-24">Period (days)</th>
                  <th className="py-2 w-36">Basis</th>
                </tr>
              </thead>
              <tbody>
                {settings.slaRules.map((r) => (
                  <tr key={r.jurisdiction} className="border-b border-line/60">
                    <td className="py-2 pr-2 text-ink">{r.jurisdiction}</td>
                    <td className="py-2 pr-2">
                      <GlassInput
                        type="number" min={1} disabled={!editable} value={r.periodDays}
                        onChange={(e) => updateRule(r.jurisdiction, { periodDays: Math.max(1, Number(e.target.value) || 1) })}
                      />
                    </td>
                    <td className="py-2">
                      <GlassSelect
                        disabled={!editable}
                        value={r.businessDays ? 'business' : 'calendar'}
                        onChange={(e) => updateRule(r.jurisdiction, { businessDays: e.target.value === 'business' })}
                      >
                        <option value="calendar">Calendar days</option>
                        <option value="business">Business days</option>
                      </GlassSelect>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-[11px] text-muted">
              Existing requests keep their original due dates; changes apply to requests created after saving.
            </p>
          </GlassPanel>

          <div className="flex flex-col gap-4">
            <GlassPanel>
              <div className="mb-3 flex items-center gap-2">
                <Bell className="h-4 w-4 text-accent" />
                <h3 className="text-sm font-semibold text-ink">Reminder cadence</h3>
              </div>
              <p className="mb-3 text-sm text-muted">
                Days before a request falls due at which owners should be reminded. Shown on the Notifications tab.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {settings.reminderCadenceDays.map((d) => (
                  <GlassBadge key={d} tone="warn" className="gap-1.5">
                    {d} day{d === 1 ? '' : 's'} before
                    {editable && (
                      <button onClick={() => removeCadence(d)} className="rounded-full hover:text-ink focus-ring" aria-label={`Remove ${d} days`}>
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </GlassBadge>
                ))}
                {editable && (
                  <div className="flex items-center gap-1.5">
                    <GlassInput
                      type="number" min={1} className="w-20 px-2 py-1 text-xs" placeholder="Days"
                      value={newCadence} onChange={(e) => setNewCadence(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCadence())}
                    />
                    <GlassButton variant="ghost" className="px-2 py-1" onClick={addCadence}>
                      <Plus className="h-3.5 w-3.5" /> Add
                    </GlassButton>
                  </div>
                )}
              </div>
              <div className="mt-4 border-t border-line pt-3">
                <Field label="Due-soon threshold (days)" hint="Requests within this many days of their due date are flagged 'Due soon' on the dashboard and notifications.">
                  <GlassInput
                    type="number" min={1} className="w-28" disabled={!editable}
                    value={settings.dueSoonThresholdDays}
                    onChange={(e) => patch({ dueSoonThresholdDays: Math.max(1, Number(e.target.value) || 1) })}
                  />
                </Field>
              </div>
            </GlassPanel>

            <GlassPanel>
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-start gap-2">
                  <PauseCircle className="mt-0.5 h-4 w-4 text-accent" />
                  <div>
                    <h3 className="text-sm font-semibold text-ink">Automatic clock pausing</h3>
                    <p className="mt-1 text-sm text-muted">
                      Moving a request to <strong className="text-ink">Awaiting Identity Verification</strong> or
                      <strong className="text-ink"> Waiting on Requester</strong> pauses the SLA clock; paused days
                      are added back to the due date when it resumes.
                    </p>
                  </div>
                </div>
                <Toggle checked={settings.autoPauseSla} disabled={!editable} onChange={(v) => patch({ autoPauseSla: v })} />
              </div>
            </GlassPanel>

            <GlassPanel>
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-start gap-2">
                  <ArrowUpCircle className="mt-0.5 h-4 w-4 text-accent" />
                  <div>
                    <h3 className="text-sm font-semibold text-ink">Escalation alerts</h3>
                    <p className="mt-1 text-sm text-muted">
                      Surface high-risk and critical requests on the Notifications tab so managers can
                      reassign or escalate before a statutory breach.
                    </p>
                  </div>
                </div>
                <Toggle checked={settings.escalationAlerts} disabled={!editable} onChange={(v) => patch({ escalationAlerts: v })} />
              </div>
            </GlassPanel>
          </div>
        </div>
      )}

      <GlassPanel className="mt-4">
        <p className="text-xs text-muted">
          All automation changes are recorded in the audit trail and take effect immediately after saving.
          Automated sends appear on each request's Communications tab marked "Sent (automated)".
        </p>
      </GlassPanel>
    </div>
  );
}
