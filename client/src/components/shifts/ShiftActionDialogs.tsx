import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { shiftsApi, reportsApi, personnelApi, type ShiftRow } from '@/services/api';
import type { PersonnelMember } from '@/types';

export type ShiftDialog = 'add' | 'edit' | 'assign' | 'overtime' | 'report' | 'activity' | null;

const TEAM_OPTIONS = ['Team Alpha', 'Team Bravo', 'Team Charlie', 'Team Delta', 'Team Echo'];
const STATUS_OPTIONS = ['Scheduled', 'Ongoing', 'Upcoming', 'Completed', 'On Break', 'Overtime'];

async function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function manilaYmd(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

interface Props {
  open: ShiftDialog;
  onOpenChange: (next: ShiftDialog) => void;
  accessToken: string | null;
  selected: ShiftRow | null;
  activity: Array<{ id: string; text: string; at: string; tone: string }>;
}

export function ShiftActionDialogs({ open, onOpenChange, accessToken, selected, activity }: Props) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    teamName: 'Team Alpha',
    startTime: '0600H',
    endTime: '1800H',
    scheduledDate: manilaYmd(),
    shiftStatus: 'Scheduled',
  });
  const [assignIds, setAssignIds] = useState<string[]>([]);
  const [responders, setResponders] = useState<PersonnelMember[]>([]);
  const [reportType, setReportType] = useState('shift');

  useEffect(() => {
    if (!accessToken || (open !== 'assign' && open !== 'add' && open !== 'edit')) return;
    void personnelApi.list(accessToken).then((res) => {
      setResponders((res.data?.users ?? []).filter((p) => p.responderId));
    });
  }, [accessToken, open]);

  useEffect(() => {
    if (open === 'add') {
      setForm({
        teamName: 'Team Alpha',
        startTime: '0600H',
        endTime: '1800H',
        scheduledDate: manilaYmd(),
        shiftStatus: 'Scheduled',
      });
      setAssignIds([]);
    }
    if ((open === 'edit' || open === 'assign' || open === 'overtime') && selected) {
      setForm({
        teamName: selected.teamName,
        startTime: selected.startTime,
        endTime: selected.endTime,
        scheduledDate: selected.scheduledDate || manilaYmd(),
        shiftStatus: open === 'overtime' ? 'Overtime' : selected.storedStatus || selected.shiftStatus || 'Scheduled',
      });
      setAssignIds((selected.assignedPersonnel ?? []).map((p) => p.responderId));
    }
    if (open === 'report') setReportType('shift');
  }, [open, selected]);

  function close() {
    onOpenChange(null);
  }

  const withResponder = useMemo(() => responders.filter((p) => p.responderId), [responders]);

  async function saveShift(isEdit: boolean) {
    if (!accessToken || busy) return;
    setBusy(true);
    try {
      if (isEdit && selected?.id) {
        await shiftsApi.update(accessToken, selected.id, {
          ...form,
          assignResponderIds: assignIds,
        });
        toast.success('Shift updated');
      } else {
        const created = (await shiftsApi.create(accessToken, form)) as { data?: { id?: string } };
        if (assignIds.length && created?.data?.id) {
          await shiftsApi.update(accessToken, created.data.id, {
            teamName: form.teamName,
            assignResponderIds: assignIds,
          });
        }
        toast.success('Shift created');
      }
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      queryClient.invalidateQueries({ queryKey: ['personnel'] });
      close();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save shift');
    } finally {
      setBusy(false);
    }
  }

  async function approveOvertime() {
    if (!accessToken || !selected?.id || busy) return;
    setBusy(true);
    try {
      await shiftsApi.update(accessToken, selected.id, { shiftStatus: 'Overtime' });
      toast.success(`${selected.teamName} marked Overtime`);
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      close();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not approve overtime');
    } finally {
      setBusy(false);
    }
  }

  async function generateReport() {
    if (!accessToken || busy) return;
    setBusy(true);
    try {
      const blob = await reportsApi.exportPdf(accessToken, { reportType });
      await downloadBlob(blob, `${reportType}-${manilaYmd()}.pdf`);
      toast.success('Report downloaded');
      close();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not generate report');
    } finally {
      setBusy(false);
    }
  }

  function toggleAssign(id: string) {
    setAssignIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <>
      <Dialog open={open === 'add' || open === 'edit'} onOpenChange={(v) => !v && close()}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{open === 'edit' ? 'Edit schedule' : 'Add shift'}</DialogTitle>
            <DialogDescription>
              {open === 'edit' ? 'Update team coverage for this shift block.' : 'Schedule a team for a date and time window.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Team">
              <select className="input-field" value={form.teamName} onChange={(e) => setForm({ ...form, teamName: e.target.value })}>
                {TEAM_OPTIONS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Start">
                <Input value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} placeholder="0600H" />
              </Field>
              <Field label="End">
                <Input value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} placeholder="1800H" />
              </Field>
            </div>
            <Field label="Scheduled date">
              <Input type="date" value={form.scheduledDate} onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })} />
            </Field>
            <Field label="Status">
              <select className="input-field" value={form.shiftStatus} onChange={(e) => setForm({ ...form, shiftStatus: e.target.value })}>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Button type="button" className="w-full min-h-[44px]" disabled={busy} onClick={() => void saveShift(open === 'edit')}>
              {busy ? 'Saving…' : 'Save shift'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={open === 'assign'} onOpenChange={(v) => !v && close()}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Assign personnel{selected ? ` — ${selected.teamName}` : ''}</DialogTitle>
          </DialogHeader>
          {!selected ? (
            <p className="text-sm text-ink-400">Select a shift first.</p>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-ink-500">Assign responders to {form.teamName}. They will appear on this shift roster.</p>
              <ul className="max-h-64 space-y-1 overflow-y-auto sidebar-scroll">
                {withResponder.map((p) => (
                  <li key={p.responderId}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-navy-700 px-2.5 py-2 text-sm hover:bg-navy-900/60">
                      <input
                        type="checkbox"
                        checked={assignIds.includes(p.responderId!)}
                        onChange={() => toggleAssign(p.responderId!)}
                      />
                      <span className="min-w-0 flex-1 truncate text-ink-100">{p.fullName}</span>
                      <span className="text-[11px] text-ink-500">{p.callsign || p.departmentCode || ''}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <Button type="button" className="w-full min-h-[44px]" disabled={busy} onClick={() => void saveShift(true)}>
                {busy ? 'Saving…' : `Assign ${assignIds.length} personnel`}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={open === 'overtime'} onOpenChange={(v) => !v && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve overtime</DialogTitle>
          </DialogHeader>
          {!selected ? (
            <p className="text-sm text-ink-400">Select a shift first.</p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-ink-300">
                Mark <span className="font-semibold text-ink-50">{selected.teamName}</span> ({selected.startTime} – {selected.endTime}) as overtime?
              </p>
              <Button type="button" className="w-full min-h-[44px]" disabled={busy} onClick={() => void approveOvertime()}>
                {busy ? 'Saving…' : 'Approve overtime'}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={open === 'report'} onOpenChange={(v) => !v && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate shift report</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Report type">
              <select className="input-field" value={reportType} onChange={(e) => setReportType(e.target.value)}>
                <option value="shift">Shift Report</option>
                <option value="attendance">Attendance</option>
                <option value="personnel">Personnel Roster</option>
              </select>
            </Field>
            <Button type="button" className="w-full min-h-[44px]" disabled={busy} onClick={() => void generateReport()}>
              {busy ? 'Generating…' : 'Download PDF'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={open === 'activity'} onOpenChange={(v) => !v && close()}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Shift activity log</DialogTitle>
          </DialogHeader>
          <ul className="space-y-2.5">
            {activity.map((a) => (
              <li key={a.id} className="flex gap-2 text-xs">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.tone === 'alert' ? 'bg-alert-400' : a.tone === 'warn' ? 'bg-gold-400' : a.tone === 'info' ? 'bg-blue-400' : 'bg-ok-400'}`} />
                <span className="min-w-0">
                  <span className="block text-ink-200">{a.text}</span>
                  <span className="text-[10px] text-ink-500">{a.at}</span>
                </span>
              </li>
            ))}
            {activity.length === 0 && <li className="py-6 text-center text-ink-500">No activity yet</li>}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
