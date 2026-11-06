import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { attendanceApi, leaveApi, reportsApi, type AttendanceRecord, type LeaveRequest } from '@/services/api';
import type { PersonnelMember } from '@/types';
import { formatManilaDate } from '@/lib/timezone';
import clsx from 'clsx';

export type AttendanceDialog =
  | 'add'
  | 'edit'
  | 'import'
  | 'leave'
  | 'report'
  | 'view'
  | null;

const STATUS_OPTIONS = ['Present', 'Late', 'Absent', 'On Leave', 'Rest Day', 'On Duty', 'Off Duty'];
const LEAVE_TYPES = ['Sick Leave', 'Vacation Leave', 'Emergency Leave', 'Other Leave'];

async function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

interface Props {
  open: AttendanceDialog;
  onOpenChange: (next: AttendanceDialog) => void;
  accessToken: string | null;
  selectedDate: string;
  selectedRecord: AttendanceRecord | null;
  responders: PersonnelMember[];
  leaveRequests: LeaveRequest[];
}

export function AttendanceActionDialogs({
  open,
  onOpenChange,
  accessToken,
  selectedDate,
  selectedRecord,
  responders,
  leaveRequests,
}: Props) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    responderId: '',
    date: selectedDate,
    checkInTime: '',
    checkOutTime: '',
    status: 'Present',
    remarks: '',
    leaveType: '',
  });
  const [importText, setImportText] = useState('');
  const [leaveForm, setLeaveForm] = useState({
    responderId: '',
    leaveType: 'Sick Leave',
    startDate: selectedDate,
    endDate: selectedDate,
    reason: '',
    status: 'Approved',
  });
  const [reportType, setReportType] = useState('attendance');

  const withResponder = useMemo(() => responders.filter((p) => p.responderId), [responders]);

  useEffect(() => {
    if (open === 'add') {
      setForm({
        responderId: withResponder[0]?.responderId || '',
        date: selectedDate,
        checkInTime: '',
        checkOutTime: '',
        status: 'Present',
        remarks: 'On Time',
        leaveType: '',
      });
    }
    if (open === 'edit' || open === 'view') {
      setForm({
        responderId: selectedRecord?.responderId || '',
        date: selectedRecord?.date || selectedDate,
        checkInTime: selectedRecord?.checkInTime?.slice(0, 16) || '',
        checkOutTime: selectedRecord?.checkOutTime?.slice(0, 16) || '',
        status: selectedRecord?.status || 'Present',
        remarks: selectedRecord?.remarks || '',
        leaveType: selectedRecord?.leaveType || '',
      });
    }
    if (open === 'import') setImportText('');
    if (open === 'leave') {
      setLeaveForm({
        responderId: withResponder[0]?.responderId || '',
        leaveType: 'Sick Leave',
        startDate: selectedDate,
        endDate: selectedDate,
        reason: '',
        status: 'Approved',
      });
    }
    if (open === 'report') setReportType('attendance');
  }, [open, selectedDate, selectedRecord, withResponder]);

  function close() {
    onOpenChange(null);
  }

  function toSqlDateTime(value: string) {
    if (!value) return undefined;
    if (value.includes('T')) return value.replace('T', ' ') + (value.length === 16 ? ':00' : '');
    return value;
  }

  async function saveRecord(isEdit: boolean) {
    if (!accessToken || !form.responderId || !form.date || busy) return;
    setBusy(true);
    try {
      const body = {
        responderId: form.responderId,
        date: form.date,
        checkInTime: toSqlDateTime(form.checkInTime),
        checkOutTime: toSqlDateTime(form.checkOutTime),
        status: form.status,
        remarks: form.remarks || undefined,
        leaveType: form.leaveType || undefined,
      };
      if (isEdit && selectedRecord?._id) {
        await attendanceApi.update(accessToken, selectedRecord._id, body);
        toast.success('Attendance updated');
      } else {
        await attendanceApi.create(accessToken, body);
        toast.success('Attendance recorded');
      }
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
      close();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save attendance');
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (!accessToken || busy) return;
    const lines = importText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) {
      toast.error('Paste CSV rows to import');
      return;
    }
    const start = lines[0].toLowerCase().includes('status') || lines[0].toLowerCase().includes('name') ? 1 : 0;
    let ok = 0;
    let fail = 0;
    setBusy(true);
    try {
      for (let i = start; i < lines.length; i += 1) {
        const cols = lines[i].split(',').map((c) => c.replace(/^"|"$/g, '').trim());
        const [nameOrId, date, status, checkIn, remarks] = cols;
        const person =
          withResponder.find((p) => p.responderId === nameOrId) ||
          withResponder.find((p) => p.fullName.toLowerCase() === nameOrId.toLowerCase()) ||
          withResponder.find((p) => (p.callsign || '').toLowerCase() === nameOrId.toLowerCase());
        if (!person?.responderId || !date) {
          fail += 1;
          continue;
        }
        try {
          await attendanceApi.create(accessToken, {
            responderId: person.responderId,
            date,
            status: status || 'Present',
            checkInTime: checkIn || undefined,
            remarks: remarks || undefined,
          });
          ok += 1;
        } catch {
          fail += 1;
        }
      }
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
      toast.success(`Imported ${ok} records${fail ? `, ${fail} failed` : ''}`);
      if (ok) close();
    } finally {
      setBusy(false);
    }
  }

  async function saveLeave() {
    if (!accessToken || !leaveForm.responderId || busy) return;
    setBusy(true);
    try {
      await leaveApi.create(accessToken, leaveForm);
      await attendanceApi.create(accessToken, {
        responderId: leaveForm.responderId,
        date: leaveForm.startDate,
        status: 'On Leave',
        leaveType: leaveForm.leaveType,
        remarks: leaveForm.reason || leaveForm.leaveType,
      });
      toast.success('Leave request saved');
      queryClient.invalidateQueries({ queryKey: ['leave-requests'] });
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
      close();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save leave request');
    } finally {
      setBusy(false);
    }
  }

  async function generateReport() {
    if (!accessToken || busy) return;
    setBusy(true);
    try {
      const blob = await reportsApi.exportPdf(accessToken, { reportType });
      await downloadBlob(blob, `${reportType}-${new Date().toISOString().slice(0, 10)}.pdf`);
      toast.success('Report downloaded');
      close();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not generate report');
    } finally {
      setBusy(false);
    }
  }

  async function patchLeave(id: string, status: string) {
    if (!accessToken || busy) return;
    setBusy(true);
    try {
      await leaveApi.update(accessToken, id, { status });
      toast.success(`Leave marked ${status}`);
      queryClient.invalidateQueries({ queryKey: ['leave-requests'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  const readOnly = open === 'view';

  return (
    <>
      <Dialog open={open === 'add' || open === 'edit' || open === 'view'} onOpenChange={(v) => !v && close()}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {open === 'view' ? 'Attendance detail' : open === 'edit' ? 'Edit attendance' : 'Add attendance record'}
            </DialogTitle>
            <DialogDescription>
              {open === 'view'
                ? 'Read-only attendance entry.'
                : open === 'edit'
                  ? 'Update check-in, check-out, and status.'
                  : 'Log a personnel attendance entry.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Personnel">
              <select
                className="input-field"
                disabled={readOnly || open === 'edit'}
                value={form.responderId}
                onChange={(e) => setForm({ ...form, responderId: e.target.value })}
              >
                {withResponder.map((p) => (
                  <option key={p.responderId} value={p.responderId}>
                    {p.fullName}{p.callsign ? ` (${p.callsign})` : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Date">
              <Input type="date" disabled={readOnly} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </Field>
            <Field label="Check in">
              <Input
                type="datetime-local"
                disabled={readOnly}
                value={form.checkInTime}
                onChange={(e) => setForm({ ...form, checkInTime: e.target.value })}
              />
            </Field>
            <Field label="Check out">
              <Input
                type="datetime-local"
                disabled={readOnly}
                value={form.checkOutTime}
                onChange={(e) => setForm({ ...form, checkOutTime: e.target.value })}
              />
            </Field>
            <Field label="Status">
              <select
                className="input-field"
                disabled={readOnly}
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="Remarks">
              <Input disabled={readOnly} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
            </Field>
            {!readOnly && (
              <Button type="button" className="w-full min-h-[44px]" disabled={busy || !form.responderId} onClick={() => void saveRecord(open === 'edit')}>
                {busy ? 'Saving…' : 'Save'}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={open === 'import'} onOpenChange={(v) => !v && close()}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import attendance</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-ink-400">CSV: Name or Callsign, Date (YYYY-MM-DD), Status, Check-in, Remarks</p>
            <textarea
              className="input-field min-h-[160px] font-mono text-xs"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={`EMT Cruz,${selectedDate},Present,2026-04-01 06:02:00,On Time`}
            />
            <Button type="button" className="w-full min-h-[44px]" disabled={!importText.trim() || busy} onClick={() => void runImport()}>
              {busy ? 'Importing…' : 'Import rows'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={open === 'leave'} onOpenChange={(v) => !v && close()}>
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage leave requests</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <ul className="max-h-48 space-y-2 overflow-y-auto sidebar-scroll">
              {leaveRequests.slice(0, 20).map((lr) => (
                <li key={lr.id} className="rounded-lg border border-navy-700 bg-navy-900/50 px-2.5 py-2 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-ink-100">{lr.fullName}</p>
                      <p className="text-ink-500">
                        {lr.leaveType} · {formatManilaDate(lr.startDate)} – {formatManilaDate(lr.endDate)}
                      </p>
                    </div>
                    <span className={clsx(
                      'shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase',
                      /approv/i.test(lr.status) && 'border-ok-500/40 text-ok-300',
                      /pend/i.test(lr.status) && 'border-gold-500/40 text-gold-300',
                      /reject|deny/i.test(lr.status) && 'border-alert-500/40 text-alert-300'
                    )}>
                      {lr.status}
                    </span>
                  </div>
                  {/pend/i.test(lr.status) && (
                    <div className="mt-2 flex gap-2">
                      <Button type="button" size="sm" className="h-8 text-xs" onClick={() => void patchLeave(lr.id, 'Approved')}>Approve</Button>
                      <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => void patchLeave(lr.id, 'Rejected')}>Reject</Button>
                    </div>
                  )}
                </li>
              ))}
              {leaveRequests.length === 0 && (
                <li className="py-4 text-center text-ink-500">No leave requests yet</li>
              )}
            </ul>
            <div className="space-y-3 rounded-lg border border-navy-700 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">New leave request</p>
              <Field label="Personnel">
                <select className="input-field" value={leaveForm.responderId} onChange={(e) => setLeaveForm({ ...leaveForm, responderId: e.target.value })}>
                  {withResponder.map((p) => (
                    <option key={p.responderId} value={p.responderId}>{p.fullName}</option>
                  ))}
                </select>
              </Field>
              <Field label="Leave type">
                <select className="input-field" value={leaveForm.leaveType} onChange={(e) => setLeaveForm({ ...leaveForm, leaveType: e.target.value })}>
                  {LEAVE_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Start">
                  <Input type="date" value={leaveForm.startDate} onChange={(e) => setLeaveForm({ ...leaveForm, startDate: e.target.value })} />
                </Field>
                <Field label="End">
                  <Input type="date" value={leaveForm.endDate} onChange={(e) => setLeaveForm({ ...leaveForm, endDate: e.target.value })} />
                </Field>
              </div>
              <Field label="Reason">
                <Input value={leaveForm.reason} onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })} />
              </Field>
              <Button type="button" className="w-full min-h-[40px]" disabled={busy || !leaveForm.responderId} onClick={() => void saveLeave()}>
                {busy ? 'Saving…' : 'Submit leave'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={open === 'report'} onOpenChange={(v) => !v && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate attendance report</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Report type">
              <select className="input-field" value={reportType} onChange={(e) => setReportType(e.target.value)}>
                <option value="attendance">Attendance Logs</option>
                <option value="personnel">Personnel Roster</option>
                <option value="shift">Shift Report</option>
              </select>
            </Field>
            <Button type="button" className="w-full min-h-[44px]" disabled={busy} onClick={() => void generateReport()}>
              {busy ? 'Generating…' : 'Download PDF'}
            </Button>
          </div>
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
