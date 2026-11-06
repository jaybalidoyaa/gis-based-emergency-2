import { useRef, useState } from 'react';
import {
  FileText,
  ClipboardList,
  HeartPulse,
  Truck,
  Flame,
  CalendarRange,
} from 'lucide-react';
import { toast } from 'sonner';
import { reportsApi } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { Button } from '@/components/ui/button';
import { OpsSectionHeader } from '@/components/ui/OpsSection';
import type { LucideIcon } from 'lucide-react';

interface ReportAction {
  id: string;
  label: string;
  icon: LucideIcon;
  reportType: string;
}

/** Featured six tiles matching Figma documentation module */
const FEATURED: ReportAction[] = [
  { id: 'incident', label: 'Incident Reports', icon: FileText, reportType: 'incident' },
  { id: 'dispatch', label: 'Daily Dispatch Logs', icon: ClipboardList, reportType: 'dispatch' },
  { id: 'sitrep', label: 'Situation Reports', icon: CalendarRange, reportType: 'daily-ops' },
  { id: 'resource', label: 'Resource Inventory', icon: Truck, reportType: 'checklist' },
  { id: 'fire', label: 'Damage Assessment', icon: Flame, reportType: 'fire' },
  { id: 'summary', label: 'Export Reports', icon: HeartPulse, reportType: 'incident-summary' },
];

export function DigitalDocumentationPanel() {
  const { accessToken, user } = useAuthStore();
  const [busyId, setBusyId] = useState<string | null>(null);
  const inflight = useRef(false);

  const role = user?.role ?? '';
  const canExport = ['SYSTEM_ADMINISTRATOR', 'CENTRAL_DISPATCHER', 'DEPARTMENT_DISPATCHER'].includes(role);

  async function generate(action: ReportAction) {
    if (!accessToken || inflight.current) return;
    inflight.current = true;
    setBusyId(action.id);
    try {
      const blob = await reportsApi.exportPdf(accessToken, { reportType: action.reportType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${action.reportType}-${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${action.label} downloaded`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Report generation failed');
    } finally {
      inflight.current = false;
      setBusyId(null);
    }
  }

  if (!canExport) {
    return (
      <div className="card flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden p-3 sm:p-4">
        <OpsSectionHeader title="Digital documentation" href="/admin/reports" />
        <p className="text-sm text-ink-400">Report export requires dispatcher or administrator access.</p>
      </div>
    );
  }

  return (
    <div className="card flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden p-3 sm:p-4">
      <OpsSectionHeader title="Digital documentation" href="/admin/reports" linkLabel="View all" className="shrink-0" />
      <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-2 overflow-y-auto sidebar-scroll pr-0.5">
        {FEATURED.map((action) => {
          const Icon = action.icon;
          const busy = busyId === action.id;
          return (
            <Button
              key={action.id}
              type="button"
              variant="outline"
              className="h-auto min-h-[56px] flex-col items-start justify-center gap-1 whitespace-normal px-2.5 py-2 text-left sm:min-h-[64px] sm:px-3"
              disabled={!!busyId}
              aria-busy={busy}
              onClick={() => void generate(action)}
            >
              <Icon className="h-4 w-4 shrink-0 text-gold-500" aria-hidden="true" />
              <span className="text-[11px] font-medium leading-tight">{busy ? 'Generating…' : action.label}</span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}
