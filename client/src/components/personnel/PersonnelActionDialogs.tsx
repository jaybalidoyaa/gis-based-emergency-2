import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { personnelApi, trainingApi, reportsApi } from '@/services/api';
import type { PersonnelMember } from '@/types';
import { formatRole } from '@/lib/incidentState';
import { formatManilaDate, formatManilaDateTime } from '@/lib/timezone';
import { normalizePhPhone, passwordIssues } from '@/lib/validation';
import clsx from 'clsx';

export type PersonnelDialog =
  | 'add'
  | 'edit'
  | 'assign'
  | 'training'
  | 'certs'
  | 'attendance'
  | 'report'
  | 'import'
  | 'activity'
  | null;

const TEAM_OPTIONS = ['Team Alpha', 'Team Bravo', 'Team Charlie', 'Team Delta', 'Unassigned'];

const DEPT_OPTIONS = [
  { id: 'dept-fire', label: 'Brigada Onse Sun Valley Fire and Rescue', code: 'FIRE' },
  { id: 'dept-medical', label: 'Medical / Ambulance', code: 'MEDICAL' },
  { id: 'dept-bemo', label: 'BEMO / BDRRMO', code: 'BEMO' },
  { id: 'dept-popsmo', label: 'POPSMO / Tanod', code: 'POPSMO' },
  { id: 'dept-police', label: 'Police / Security', code: 'POLICE' },
  { id: 'dept-hospital', label: 'Hospital / Health Center', code: 'HOSPITAL' },
];

type TrainingRow = {
  id: string;
  responderId?: string;
  trainingName: string;
  completedAt?: string;
  expiresAt?: string;
  certificationStatus?: string;
  fullName?: string;
  callsign?: string;
};

type AttendanceRow = {
  _id?: string;
  date: string;
  checkInTime?: string;
  checkOutTime?: string;
  status: string;
  callsign?: string;
  fullName?: string;
};

type DeptOption = { id: string; label: string; code: string };

function certTone(expiresAt?: string, certificationStatus?: string) {
  const base = (certificationStatus || 'passed').toLowerCase();
  if (!expiresAt) return { label: base === 'passed' ? 'Active' : certificationStatus || 'Active', tone: 'ok' as const };
  const days = (new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  if (Number.isFinite(days) && days < 0) return { label: 'Expired', tone: 'alert' as const };
  if (Number.isFinite(days) && days <= 60) return { label: 'Expiring Soon', tone: 'warn' as const };
  return { label: 'Active', tone: 'ok' as const };
}

async function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const emptyAddForm = {
  fullName: '',
  email: '',
  contactNumber: '',
  password: '',
  confirmPassword: '',
  role: 'EMERGENCY_RESPONDER',
  callsign: '',
  departmentId: 'dept-fire',
  team: 'Team Alpha',
};

interface Props {
  open: PersonnelDialog;
  onOpenChange: (next: PersonnelDialog) => void;
  accessToken: string | null;
  selected: PersonnelMember | null;
  people: PersonnelMember[];
  training: TrainingRow[];
  attendance: AttendanceRow[];
  activity?: Array<{ id: string; text: string; at?: string; tone: string }>;
  departments?: DeptOption[];
}

export function PersonnelActionDialogs({
  open,
  onOpenChange,
  accessToken,
  selected,
  people,
  training,
  attendance,
  activity = [],
  departments,
}: Props) {
  const queryClient = useQueryClient();
  const depts = departments?.length ? departments : DEPT_OPTIONS;
  const [busy, setBusy] = useState(false);

  const [addForm, setAddForm] = useState(emptyAddForm);
  const [editForm, setEditForm] = useState({
    fullName: '',
    contactNumber: '',
    callsign: '',
    teamName: '',
    departmentId: '',
    status: 'active',
  });
  const [assignForm, setAssignForm] = useState({ userId: '', teamName: 'Team Alpha' });
  const [trainForm, setTrainForm] = useState({
    responderId: '',
    trainingName: '',
    expiresAt: '',
    certificationStatus: 'passed',
  });
  const [importText, setImportText] = useState('');
  const [reportType, setReportType] = useState('personnel');

  const responders = useMemo(() => people.filter((p) => p.responderId), [people]);

  useEffect(() => {
    if (open === 'edit' && selected) {
      const dept =
        depts.find((d) => d.label === selected.departmentName || d.code === selected.departmentCode)?.id || '';
      setEditForm({
        fullName: selected.fullName || '',
        contactNumber: selected.contactNumber || '',
        callsign: selected.callsign || '',
        teamName: selected.teamName || '',
        departmentId: dept,
        status: selected.accountStatus || selected.status || 'active',
      });
    }
    if (open === 'assign') {
      setAssignForm({
        userId: selected?.id || responders[0]?.id || '',
        teamName: selected?.teamName || 'Team Alpha',
      });
    }
    if (open === 'training' || open === 'certs') {
      setTrainForm({
        responderId: selected?.responderId || responders[0]?.responderId || '',
        trainingName: '',
        expiresAt: '',
        certificationStatus: 'passed',
      });
    }
    if (open === 'add') setAddForm(emptyAddForm);
    if (open === 'import') setImportText('');
    if (open === 'report') setReportType('personnel');
  }, [open, selected, responders, depts]);

  function close() {
    onOpenChange(null);
  }

  const addPhoneOk = !!normalizePhPhone(addForm.contactNumber);
  const addPwdIssues = passwordIssues(addForm.password);
  const addValid =
    addForm.fullName.trim().length >= 2 &&
    addForm.email.includes('@') &&
    addPhoneOk &&
    addPwdIssues.length === 0 &&
    addForm.password === addForm.confirmPassword &&
    !!addForm.role;

  const editPhoneOk = !editForm.contactNumber || !!normalizePhPhone(editForm.contactNumber);

  async function saveAdd() {
    if (!accessToken || !addValid || busy) return;
    setBusy(true);
    try {
      await personnelApi.create(accessToken, {
        fullName: addForm.fullName,
        email: addForm.email,
        contactNumber: normalizePhPhone(addForm.contactNumber),
        password: addForm.password,
        role: addForm.role,
        callsign: addForm.callsign,
        departmentId: addForm.departmentId,
        teamName: addForm.team === 'Unassigned' ? '' : addForm.team,
      });
      toast.success('Personnel account created');
      queryClient.invalidateQueries({ queryKey: ['personnel'] });
      close();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save personnel');
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    if (!accessToken || !selected || !editPhoneOk || busy) return;
    if (editForm.fullName.trim().length < 2) {
      toast.error('Full name is required');
      return;
    }
    setBusy(true);
    try {
      await personnelApi.update(accessToken, selected.id, {
        fullName: editForm.fullName.trim(),
        contactNumber: editForm.contactNumber ? normalizePhPhone(editForm.contactNumber) : undefined,
        callsign: editForm.callsign,
        teamName: editForm.teamName === 'Unassigned' ? '' : editForm.teamName,
        departmentId: editForm.departmentId || undefined,
        status: editForm.status,
      });
      toast.success(`${editForm.fullName} updated`);
      queryClient.invalidateQueries({ queryKey: ['personnel'] });
      close();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update personnel');
    } finally {
      setBusy(false);
    }
  }

  async function saveAssign() {
    if (!accessToken || !assignForm.userId || busy) return;
    const target = people.find((p) => p.id === assignForm.userId);
    if (!target) return;
    if (!target.responderId) {
      toast.error('Only emergency responders can be assigned to a team');
      return;
    }
    setBusy(true);
    try {
      await personnelApi.update(accessToken, assignForm.userId, {
        teamName: assignForm.teamName === 'Unassigned' ? '' : assignForm.teamName,
      });
      toast.success(`${target.fullName} assigned to ${assignForm.teamName}`);
      queryClient.invalidateQueries({ queryKey: ['personnel'] });
      close();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not assign team');
    } finally {
      setBusy(false);
    }
  }

  async function saveTraining() {
    if (!accessToken || !trainForm.responderId || !trainForm.trainingName.trim() || busy) return;
    setBusy(true);
    try {
      await trainingApi.create(accessToken, {
        responderId: trainForm.responderId,
        trainingName: trainForm.trainingName.trim(),
        expiresAt: trainForm.expiresAt || undefined,
        certificationStatus: trainForm.certificationStatus,
      });
      toast.success('Training / certification recorded');
      queryClient.invalidateQueries({ queryKey: ['training'] });
      queryClient.invalidateQueries({ queryKey: ['personnel'] });
      close();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save training');
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

  async function runImport() {
    if (!accessToken || busy) return;
    const lines = importText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      toast.error('Paste CSV rows to import');
      return;
    }
    const start = lines[0].toLowerCase().includes('email') ? 1 : 0;
    let ok = 0;
    let fail = 0;
    setBusy(true);
    try {
      for (let i = start; i < lines.length; i += 1) {
        const cols = lines[i].split(',').map((c) => c.replace(/^"|"$/g, '').trim());
        const [fullName, email, contactNumber, password, role, callsign, department, team] = cols;
        if (!fullName || !email || !contactNumber || !password) {
          fail += 1;
          continue;
        }
        try {
          await personnelApi.create(accessToken, {
            fullName,
            email,
            contactNumber: normalizePhPhone(contactNumber) || contactNumber,
            password,
            role: role || 'EMERGENCY_RESPONDER',
            callsign: callsign || '',
            department: department || '',
            teamName: team || '',
          });
          ok += 1;
        } catch {
          fail += 1;
        }
      }
      queryClient.invalidateQueries({ queryKey: ['personnel'] });
      toast.success(`Imported ${ok} personnel${fail ? `, ${fail} failed` : ''}`);
      if (ok > 0) close();
    } finally {
      setBusy(false);
    }
  }

  const certList = useMemo(() => {
    if (open === 'certs' && selected?.responderId) {
      return training.filter((t) => t.responderId === selected.responderId);
    }
    return training;
  }, [open, selected, training]);

  return (
    <>
      {/* Add */}
      <Dialog open={open === 'add'} onOpenChange={(v) => !v && close()}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New personnel account</DialogTitle>
            <DialogDescription>Create a login for admin, dispatcher, or responder staff.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Full name" required>
              <Input value={addForm.fullName} onChange={(e) => setAddForm({ ...addForm, fullName: e.target.value })} />
            </Field>
            <Field label="Email" required>
              <Input type="email" value={addForm.email} onChange={(e) => setAddForm({ ...addForm, email: e.target.value })} />
            </Field>
            <Field label="Temporary password" required>
              <Input type="password" autoComplete="new-password" value={addForm.password} onChange={(e) => setAddForm({ ...addForm, password: e.target.value })} />
              {addForm.password && addPwdIssues.length > 0 && (
                <p className="text-xs text-alert-400">Needs {addPwdIssues.join(', ')}</p>
              )}
            </Field>
            <Field label="Confirm password" required>
              <Input type="password" autoComplete="new-password" value={addForm.confirmPassword} onChange={(e) => setAddForm({ ...addForm, confirmPassword: e.target.value })} />
            </Field>
            <Field label="Contact number" required>
              <Input type="tel" placeholder="09XXXXXXXXX" value={addForm.contactNumber} onChange={(e) => setAddForm({ ...addForm, contactNumber: e.target.value })} />
            </Field>
            <Field label="Callsign">
              <Input value={addForm.callsign} onChange={(e) => setAddForm({ ...addForm, callsign: e.target.value })} />
            </Field>
            <Field label="Department">
              <select className="input-field" value={addForm.departmentId} onChange={(e) => setAddForm({ ...addForm, departmentId: e.target.value })}>
                {depts.map((d) => (
                  <option key={d.id} value={d.id}>{d.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Team">
              <select className="input-field" value={addForm.team} onChange={(e) => setAddForm({ ...addForm, team: e.target.value })}>
                {TEAM_OPTIONS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field label="Account role" required>
              <select className="input-field" value={addForm.role} onChange={(e) => setAddForm({ ...addForm, role: e.target.value })}>
                <option value="EMERGENCY_RESPONDER">{formatRole('EMERGENCY_RESPONDER')}</option>
                <option value="CENTRAL_DISPATCHER">{formatRole('CENTRAL_DISPATCHER')}</option>
                <option value="DEPARTMENT_DISPATCHER">{formatRole('DEPARTMENT_DISPATCHER')}</option>
              </select>
            </Field>
            <Button type="button" className="w-full min-h-[44px]" disabled={!addValid || busy} onClick={() => void saveAdd()}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit */}
      <Dialog open={open === 'edit'} onOpenChange={(v) => !v && close()}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit personnel{selected ? ` — ${selected.fullName}` : ''}</DialogTitle>
          </DialogHeader>
          {!selected ? (
            <p className="text-sm text-ink-400">Select a person in the directory first.</p>
          ) : (
            <div className="space-y-3">
              <Field label="Full name" required>
                <Input value={editForm.fullName} onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })} />
              </Field>
              <Field label="Contact number">
                <Input type="tel" value={editForm.contactNumber} onChange={(e) => setEditForm({ ...editForm, contactNumber: e.target.value })} />
                {editForm.contactNumber && !editPhoneOk && (
                  <p className="text-xs text-alert-400">Enter a valid PH mobile number</p>
                )}
              </Field>
              <Field label="Callsign">
                <Input value={editForm.callsign} onChange={(e) => setEditForm({ ...editForm, callsign: e.target.value })} disabled={!selected.responderId} />
              </Field>
              <Field label="Team">
                <select
                  className="input-field"
                  value={editForm.teamName || 'Unassigned'}
                  disabled={!selected.responderId}
                  onChange={(e) => setEditForm({ ...editForm, teamName: e.target.value })}
                >
                  {TEAM_OPTIONS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field label="Department">
                <select
                  className="input-field"
                  value={editForm.departmentId}
                  disabled={!selected.responderId}
                  onChange={(e) => setEditForm({ ...editForm, departmentId: e.target.value })}
                >
                  <option value="">—</option>
                  {depts.map((d) => (
                    <option key={d.id} value={d.id}>{d.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Account status">
                <select className="input-field" value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}>
                  <option value="active">active</option>
                  <option value="inactive">inactive</option>
                </select>
              </Field>
              <p className="text-xs text-ink-500">Email / role changes require an admin database update.</p>
              <Button type="button" className="w-full min-h-[44px]" disabled={!editPhoneOk || busy} onClick={() => void saveEdit()}>
                {busy ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Assign team */}
      <Dialog open={open === 'assign'} onOpenChange={(v) => !v && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign team</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Personnel">
              <select className="input-field" value={assignForm.userId} onChange={(e) => setAssignForm({ ...assignForm, userId: e.target.value })}>
                {responders.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}{p.callsign ? ` (${p.callsign})` : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Team">
              <select className="input-field" value={assignForm.teamName} onChange={(e) => setAssignForm({ ...assignForm, teamName: e.target.value })}>
                {TEAM_OPTIONS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Button type="button" className="w-full min-h-[44px]" disabled={!assignForm.userId || busy} onClick={() => void saveAssign()}>
              {busy ? 'Saving…' : 'Assign team'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Schedule training */}
      <Dialog open={open === 'training'} onOpenChange={(v) => !v && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule training</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Responder">
              <select className="input-field" value={trainForm.responderId} onChange={(e) => setTrainForm({ ...trainForm, responderId: e.target.value })}>
                {responders.map((p) => (
                  <option key={p.responderId} value={p.responderId}>
                    {p.fullName}{p.callsign ? ` (${p.callsign})` : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Training / certification name" required>
              <Input
                placeholder="e.g. EMT Certification"
                value={trainForm.trainingName}
                onChange={(e) => setTrainForm({ ...trainForm, trainingName: e.target.value })}
              />
            </Field>
            <Field label="Valid until">
              <Input type="date" value={trainForm.expiresAt} onChange={(e) => setTrainForm({ ...trainForm, expiresAt: e.target.value })} />
            </Field>
            <Field label="Status">
              <select className="input-field" value={trainForm.certificationStatus} onChange={(e) => setTrainForm({ ...trainForm, certificationStatus: e.target.value })}>
                <option value="passed">Active / Passed</option>
                <option value="scheduled">Scheduled</option>
                <option value="expired">Expired</option>
              </select>
            </Field>
            <Button
              type="button"
              className="w-full min-h-[44px]"
              disabled={!trainForm.responderId || !trainForm.trainingName.trim() || busy}
              onClick={() => void saveTraining()}
            >
              {busy ? 'Saving…' : 'Save training record'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Manage certifications */}
      <Dialog open={open === 'certs'} onOpenChange={(v) => !v && close()}>
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage certifications</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="overflow-x-auto rounded-lg border border-navy-700">
              <table className="w-full min-w-[360px] text-left text-xs">
                <thead className="bg-navy-900 text-ink-500">
                  <tr>
                    <th className="px-2 py-2 font-medium">Name</th>
                    <th className="px-2 py-2 font-medium">Training</th>
                    <th className="px-2 py-2 font-medium">Valid Until</th>
                    <th className="px-2 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {certList.map((t) => {
                    const st = certTone(t.expiresAt, t.certificationStatus);
                    return (
                      <tr key={t.id} className="border-t border-navy-800">
                        <td className="px-2 py-2 text-ink-200">{t.fullName || '—'}</td>
                        <td className="px-2 py-2 text-ink-100">{t.trainingName}</td>
                        <td className="px-2 py-2 text-ink-400">{t.expiresAt ? formatManilaDate(t.expiresAt) : '—'}</td>
                        <td className="px-2 py-2">
                          <span
                            className={clsx(
                              'inline-flex items-center gap-1',
                              st.tone === 'ok' && 'text-ok-300',
                              st.tone === 'warn' && 'text-gold-300',
                              st.tone === 'alert' && 'text-alert-300'
                            )}
                          >
                            <span
                              className={clsx(
                                'h-1.5 w-1.5 rounded-full',
                                st.tone === 'ok' && 'bg-ok-400',
                                st.tone === 'warn' && 'bg-gold-400',
                                st.tone === 'alert' && 'bg-alert-400'
                              )}
                            />
                            {st.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {certList.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-2 py-6 text-center text-ink-500">
                        No certification records yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="space-y-3 rounded-lg border border-navy-700 bg-navy-900/40 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Add certification</p>
              <Field label="Responder">
                <select className="input-field" value={trainForm.responderId} onChange={(e) => setTrainForm({ ...trainForm, responderId: e.target.value })}>
                  {responders.map((p) => (
                    <option key={p.responderId} value={p.responderId}>
                      {p.fullName}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Certification name">
                <Input value={trainForm.trainingName} onChange={(e) => setTrainForm({ ...trainForm, trainingName: e.target.value })} />
              </Field>
              <Field label="Valid until">
                <Input type="date" value={trainForm.expiresAt} onChange={(e) => setTrainForm({ ...trainForm, expiresAt: e.target.value })} />
              </Field>
              <Button
                type="button"
                className="w-full min-h-[40px]"
                disabled={!trainForm.responderId || !trainForm.trainingName.trim() || busy}
                onClick={() => void saveTraining()}
              >
                {busy ? 'Saving…' : 'Add certification'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Attendance */}
      <Dialog open={open === 'attendance'} onOpenChange={(v) => !v && close()}>
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Attendance logs</DialogTitle>
          </DialogHeader>
          <div className="overflow-x-auto rounded-lg border border-navy-700">
            <table className="w-full min-w-[420px] text-left text-xs">
              <thead className="bg-navy-900 text-ink-500">
                <tr>
                  <th className="px-2 py-2 font-medium">Name</th>
                  <th className="px-2 py-2 font-medium">Date</th>
                  <th className="px-2 py-2 font-medium">In</th>
                  <th className="px-2 py-2 font-medium">Out</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {attendance.slice(0, 40).map((r, i) => (
                  <tr key={r._id || `${r.date}-${i}`} className="border-t border-navy-800">
                    <td className="px-2 py-2 text-ink-100">{r.fullName || '—'}</td>
                    <td className="px-2 py-2 text-ink-400">{r.date ? formatManilaDate(r.date) : '—'}</td>
                    <td className="px-2 py-2 text-ink-400">{r.checkInTime ? formatManilaDateTime(r.checkInTime) : '—'}</td>
                    <td className="px-2 py-2 text-ink-400">{r.checkOutTime ? formatManilaDateTime(r.checkOutTime) : '—'}</td>
                    <td className="px-2 py-2 text-ink-200">{r.status}</td>
                  </tr>
                ))}
                {attendance.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-2 py-8 text-center text-ink-500">
                      No attendance records yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Button
            type="button"
            variant="outline"
            className="mt-3 w-full min-h-[40px]"
            disabled={busy || !accessToken}
            onClick={() => {
              setReportType('attendance');
              void (async () => {
                if (!accessToken) return;
                setBusy(true);
                try {
                  const blob = await reportsApi.exportPdf(accessToken, { reportType: 'attendance' });
                  await downloadBlob(blob, `attendance-${new Date().toISOString().slice(0, 10)}.pdf`);
                  toast.success('Attendance report downloaded');
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Export failed');
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            Export attendance PDF
          </Button>
        </DialogContent>
      </Dialog>

      {/* Generate report */}
      <Dialog open={open === 'report'} onOpenChange={(v) => !v && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate report</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Report type">
              <select className="input-field" value={reportType} onChange={(e) => setReportType(e.target.value)}>
                <option value="personnel">Personnel Roster</option>
                <option value="attendance">Personnel Attendance</option>
                <option value="shift">Shift Report</option>
                <option value="unit-activity">Unit Activity</option>
              </select>
            </Field>
            <p className="text-xs text-ink-500">Downloads a PDF from live system data.</p>
            <Button type="button" className="w-full min-h-[44px]" disabled={busy} onClick={() => void generateReport()}>
              {busy ? 'Generating…' : 'Download PDF'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Import */}
      <Dialog open={open === 'import'} onOpenChange={(v) => !v && close()}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import personnel</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-ink-400">
              CSV columns: Full Name, Email, Contact, Password, Role, Callsign, Department, Team
            </p>
            <textarea
              className="input-field min-h-[180px] font-mono text-xs"
              placeholder={'Juan Dela Cruz,juan@example.com,09171234567,TempPass1!,EMERGENCY_RESPONDER,FIRE 01,FIRE,Team Alpha'}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
            <Button type="button" className="w-full min-h-[44px]" disabled={!importText.trim() || busy} onClick={() => void runImport()}>
              {busy ? 'Importing…' : 'Import rows'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Activity log */}
      <Dialog open={open === 'activity'} onOpenChange={(v) => !v && close()}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Activity log</DialogTitle>
          </DialogHeader>
          <ul className="space-y-2.5">
            {activity.map((a) => (
              <li key={a.id} className="flex gap-2 text-xs">
                <span
                  className={clsx(
                    'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                    a.tone === 'alert' && 'bg-alert-400',
                    a.tone === 'warn' && 'bg-gold-400',
                    a.tone === 'info' && 'bg-blue-400',
                    a.tone === 'ok' && 'bg-ok-400'
                  )}
                />
                <span className="min-w-0">
                  <span className="block text-ink-200">{a.text}</span>
                  <span className="text-[10px] text-ink-500">{a.at ? formatManilaDateTime(a.at) : '—'}</span>
                </span>
              </li>
            ))}
            {activity.length === 0 && <li className="py-6 text-center text-sm text-ink-500">No recent activity</li>}
          </ul>
          <Button
            type="button"
            variant="outline"
            className="mt-3 w-full"
            disabled={busy || !accessToken}
            onClick={() => {
              void (async () => {
                if (!accessToken) return;
                setBusy(true);
                try {
                  const blob = await reportsApi.exportPdf(accessToken, { reportType: 'audit' });
                  await downloadBlob(blob, `audit-${new Date().toISOString().slice(0, 10)}.pdf`);
                  toast.success('Audit report downloaded');
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Export failed');
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            Export audit PDF
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label>
        {label}
        {required ? <span className="text-alert-400"> *</span> : null}
      </Label>
      {children}
    </div>
  );
}
