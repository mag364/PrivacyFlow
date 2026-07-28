import React from 'react';
import { Search, Server } from 'lucide-react';
import { APP_CONFIG } from '@shared/config';
import { PageHeader } from '../../layouts/AppShell';
import { GlassPanel, GlassBadge, GlassInput } from '../../components/glass';

export function SystemsPage() {
  const [q, setQ] = React.useState('');
  const systems = APP_CONFIG.systemsOfRecord.filter(
    (s) => s.name.toLowerCase().includes(q.toLowerCase()) || s.category.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div>
      <PageHeader
        title="Systems of Record"
        subtitle="Reference catalogue of systems searched during data subject requests."
      />

      <div className="mb-4 relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <GlassInput className="pl-9" placeholder="Search systems…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {systems.map((s) => (
          <GlassPanel key={s.name} className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--pf-highlight)] text-accent">
                <Server className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold text-ink">{s.name}</p>
                <p className="text-xs text-muted">{s.category}</p>
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-line pt-3 text-sm">
              <span className="text-muted">Data owner</span>
              <span className="font-medium text-ink">{s.owner}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted">Avg. response</span>
              <GlassBadge tone={s.avgResponseDays > 5 ? 'warn' : 'success'}>{s.avgResponseDays} days</GlassBadge>
            </div>
          </GlassPanel>
        ))}
      </div>
    </div>
  );
}