import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  ImagePlus,
  RotateCcw,
  ShieldAlert,
  Trash2,
  XCircle,
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmActionDialog, type ConfirmActionRequest } from '@/components/ui/ConfirmActionDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { incidentsApi, mediaApi, type MediaAttachment } from '@/services/api';
import { allowedNextStatuses, canCancelIncident, canReopenIncident, canVerifyIncident } from '@/lib/incidentState';
import type { Incident } from '@/types';

export type IncidentDialog = null | 'edit' | 'more';

const PRIORITIES = ['Critical', 'High', 'Moderate', 'Low'] as const;

type IncidentType = { _id: string; typeName: string };

type Props = {
  dialog: IncidentDialog;
  onClose: () => void;
  incident: Incident | null;
  token: string;
  types: IncidentType[];
  onSaved: () => void;
};

type EditForm = {
  priorityLevel: string;
  incidentTypeId: string;
  description: string;
  callerName: string;
  callerPhone: string;
  subcategory: string;
  victimCount: string;
  patientCondition: string;
  knownHazards: string;
  accessibility: string;
  dispatcherNotes: string;
  addressText: string;
  landmark: string;
};

function buildForm(inc: Incident): EditForm {
  return {
    priorityLevel: inc.priorityLevel === 'Medium' ? 'Moderate' : inc.priorityLevel || 'High',
    incidentTypeId: (inc.incidentTypeId as { _id?: string } | undefined)?._id || inc.incidentTypeId?.typeName || '',
    description: inc.description ?? '',
    callerName: inc.callerName ?? '',
    callerPhone: inc.callerPhone ?? '',
    subcategory: inc.subcategory ?? '',
    victimCount: inc.victimCount != null ? String(inc.victimCount) : '',
    patientCondition: inc.patientCondition ?? '',
    knownHazards: inc.knownHazards ?? '',
    accessibility: inc.accessibility ?? '',
    dispatcherNotes: inc.dispatcherNotes ?? '',
    addressText: inc.locationId?.addressText ?? '',
    landmark: inc.locationId?.landmark ?? '',
  };
}

const fieldClass =
  'flex h-9 w-full rounded-md border border-navy-600 bg-navy-800 px-2.5 text-sm text-ink-50 outline-none focus-visible:ring-1 focus-visible:ring-gold-500';
const areaClass =
  'w-full rounded-md border border-navy-600 bg-navy-800 px-2.5 py-2 text-sm text-ink-50 outline-none focus-visible:ring-1 focus-visible:ring-gold-500';

export function IncidentActionDialogs({ dialog, onClose, incident, token, types, onSaved }: Props) {
  const [form, setForm] = useState<EditForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusPick, setStatusPick] = useState('');
  const [confirm, setConfirm] = useState<ConfirmActionRequest | null>(null);
  const [confirmKind, setConfirmKind] = useState<'falseAlarm' | 'cancel' | 'reopen' | 'verify' | null>(null);
  const [media, setMedia] = useState<MediaAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const nextStatuses = allowedNextStatuses(incident?.status);

  useEffect(() => {
    if (dialog === 'edit' && incident) {
      setForm(buildForm(incident));
      void loadMedia(incident._id);
    }
    if (dialog === 'more' && incident) {
      const next = allowedNextStatuses(incident.status);
      setStatusPick(next[0] ?? '');
    }
    if (!dialog) {
      setForm(null);
      setConfirm(null);
      setConfirmKind(null);
      setMedia([]);
    }
  }, [dialog, incident]);

  async function loadMedia(incidentId: string) {
    try {
      const res = await mediaApi.list(token, incidentId);
      setMedia(res.data ?? []);
    } catch {
      setMedia([]);
    }
  }

  function setField<K extends keyof EditForm>(key: K, value: EditForm[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function saveEdit() {
    if (!incident || !form) return;
    setBusy(true);
    try {
      const typeMatch =
        types.find((t) => t._id === form.incidentTypeId) ||
        types.find((t) => t.typeName === form.incidentTypeId) ||
        types.find((t) => t.typeName === incident.incidentTypeId?.typeName);

      await incidentsApi.update(token, incident._id, {
        priorityLevel: form.priorityLevel,
        incidentTypeId: typeMatch?._id || form.incidentTypeId || undefined,
        description: form.description,
        callerName: form.callerName,
        callerPhone: form.callerPhone,
        subcategory: form.subcategory,
        victimCount: form.victimCount === '' ? null : Number(form.victimCount),
        patientCondition: form.patientCondition,
        knownHazards: form.knownHazards,
        accessibility: form.accessibility,
        dispatcherNotes: form.dispatcherNotes,
        addressText: form.addressText,
        landmark: form.landmark,
      });
      toast.success('Incident updated');
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  async function applyStatus() {
    if (!incident || !statusPick) {
      toast.message('Pick a status');
      return;
    }
    if (!nextStatuses.includes(statusPick)) {
      toast.error(`Cannot move from ${incident.status} to ${statusPick}`);
      return;
    }
    setBusy(true);
    try {
      if (statusPick === 'Reopened') {
        await incidentsApi.reopen(token, incident._id, 'Status change from More actions');
        toast.success('Incident reopened');
      } else {
        await incidentsApi.status(token, incident._id, statusPick);
        toast.success(`Status → ${statusPick}`);
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Status update failed');
    } finally {
      setBusy(false);
    }
  }

  async function onPickFiles(files: FileList | null) {
    if (!incident || !files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/') && file.type !== 'video/mp4') {
          toast.error(`${file.name}: only images or MP4`);
          continue;
        }
        if (file.size > 10 * 1024 * 1024) {
          toast.error(`${file.name}: max 10MB`);
          continue;
        }
        await mediaApi.upload(token, incident._id, file);
      }
      toast.success('Photo(s) uploaded');
      await loadMedia(incident._id);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function removeMedia(id: string) {
    if (!incident) return;
    setBusy(true);
    try {
      await mediaApi.remove(token, id);
      setMedia((prev) => prev.filter((m) => m.id !== id));
      toast.message('Photo removed');
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Remove failed');
    } finally {
      setBusy(false);
    }
  }

  function openConfirm(kind: 'falseAlarm' | 'cancel' | 'reopen' | 'verify') {
    setConfirmKind(kind);
    if (kind === 'verify') {
      setConfirm({
        title: 'Verify incident',
        description: `Confirm ${incident?.displayId} as a real emergency and move it to Open.`,
        confirmLabel: 'Verify',
        tone: 'gold',
      });
    } else if (kind === 'falseAlarm') {
      setConfirm({
        title: 'Mark false alarm',
        description: 'Closes the incident as a false alarm. This cannot be undone without reopening.',
        confirmLabel: 'Mark false alarm',
        tone: 'destructive',
        requireReason: true,
        reasonLabel: 'Reason',
        reasonPlaceholder: 'Why is this a false alarm?',
      });
    } else if (kind === 'cancel') {
      setConfirm({
        title: 'Cancel incident',
        description: 'Cancellation makes the incident read-only until it is reopened.',
        confirmLabel: 'Cancel incident',
        tone: 'destructive',
        requireReason: true,
        reasonLabel: 'Reason for cancellation',
      });
    } else {
      setConfirm({
        title: 'Reopen incident',
        description: 'Reopens a closed or cancelled incident for further action.',
        confirmLabel: 'Reopen',
        tone: 'gold',
        requireReason: true,
        reasonLabel: 'Reason for reopening',
      });
    }
  }

  async function runConfirm(reason?: string) {
    if (!incident || !confirmKind) return;
    setBusy(true);
    try {
      if (confirmKind === 'verify') {
        await incidentsApi.verify(token, incident._id, { priority: incident.priorityLevel });
        toast.success('Incident verified');
      } else if (confirmKind === 'falseAlarm') {
        await incidentsApi.falseAlarm(token, incident._id, reason);
        toast.message('Marked as false alarm');
      } else if (confirmKind === 'cancel') {
        await incidentsApi.cancel(token, incident._id, reason!);
        toast.message('Incident cancelled');
      } else if (confirmKind === 'reopen') {
        await incidentsApi.reopen(token, incident._id, reason!);
        toast.success('Incident reopened');
      }
      setConfirm(null);
      setConfirmKind(null);
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  async function copyId() {
    if (!incident) return;
    try {
      await navigator.clipboard.writeText(incident.displayId);
      toast.success('Incident ID copied');
    } catch {
      toast.error('Could not copy');
    }
  }

  const canReopen = canReopenIncident(incident?.status);
  const canCancel = canCancelIncident(incident?.status);
  const canVerify = canVerifyIncident(incident?.status);
  const canFalseAlarm = canCancel; // same gate: not terminal

  return (
    <>
      <Dialog open={dialog === 'edit'} onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-hidden p-0 sm:max-w-xl">
          <div className="border-b border-navy-700 px-5 py-4 pr-12">
            <DialogHeader className="mb-0">
              <DialogTitle>Edit incident</DialogTitle>
              {incident ? (
                <DialogDescription asChild>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="font-mono text-alert-400">{incident.displayId}</span>
                    <StatusBadge status={incident.status} className="origin-left scale-90" />
                  </div>
                </DialogDescription>
              ) : (
                <DialogDescription>Update incident details and location.</DialogDescription>
              )}
            </DialogHeader>
          </div>

          {form && (
            <form
              className="max-h-[min(62vh,520px)] space-y-3 overflow-y-auto px-5 py-4 sidebar-scroll"
              onSubmit={(e) => {
                e.preventDefault();
                void saveEdit();
              }}
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="inc-priority">Priority</Label>
                  <select
                    id="inc-priority"
                    className={fieldClass}
                    value={form.priorityLevel}
                    onChange={(e) => setField('priorityLevel', e.target.value)}
                    disabled={busy}
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="inc-type">Type</Label>
                  <select
                    id="inc-type"
                    className={fieldClass}
                    value={form.incidentTypeId}
                    onChange={(e) => setField('incidentTypeId', e.target.value)}
                    disabled={busy}
                  >
                    {!types.some((t) => t._id === form.incidentTypeId || t.typeName === form.incidentTypeId) &&
                      form.incidentTypeId && (
                        <option value={form.incidentTypeId}>{incident?.incidentTypeId?.typeName || 'Current'}</option>
                      )}
                    {types.map((t) => (
                      <option key={t._id} value={t._id}>
                        {t.typeName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="inc-desc">Description</Label>
                <textarea
                  id="inc-desc"
                  rows={3}
                  className={areaClass}
                  value={form.description}
                  onChange={(e) => setField('description', e.target.value)}
                  disabled={busy}
                  placeholder="What happened?"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="inc-caller">Caller name</Label>
                  <Input
                    id="inc-caller"
                    value={form.callerName}
                    onChange={(e) => setField('callerName', e.target.value)}
                    disabled={busy}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="inc-phone">Caller phone</Label>
                  <Input
                    id="inc-phone"
                    value={form.callerPhone}
                    onChange={(e) => setField('callerPhone', e.target.value)}
                    disabled={busy}
                    className="h-9"
                    inputMode="tel"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="inc-sub">Subcategory</Label>
                  <Input
                    id="inc-sub"
                    value={form.subcategory}
                    onChange={(e) => setField('subcategory', e.target.value)}
                    disabled={busy}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="inc-victims">Victims / patients</Label>
                  <Input
                    id="inc-victims"
                    type="number"
                    min={0}
                    value={form.victimCount}
                    onChange={(e) => setField('victimCount', e.target.value)}
                    disabled={busy}
                    className="h-9"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="inc-addr">Address</Label>
                <Input
                  id="inc-addr"
                  value={form.addressText}
                  onChange={(e) => setField('addressText', e.target.value)}
                  disabled={busy}
                  className="h-9"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="inc-landmark">Landmark</Label>
                <Input
                  id="inc-landmark"
                  value={form.landmark}
                  onChange={(e) => setField('landmark', e.target.value)}
                  disabled={busy}
                  className="h-9"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="inc-hazards">Known hazards</Label>
                <textarea
                  id="inc-hazards"
                  rows={2}
                  className={areaClass}
                  value={form.knownHazards}
                  onChange={(e) => setField('knownHazards', e.target.value)}
                  disabled={busy}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="inc-access">Accessibility</Label>
                <Input
                  id="inc-access"
                  value={form.accessibility}
                  onChange={(e) => setField('accessibility', e.target.value)}
                  disabled={busy}
                  className="h-9"
                  placeholder="Gate codes, narrow roads…"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="inc-condition">Patient condition</Label>
                <Input
                  id="inc-condition"
                  value={form.patientCondition}
                  onChange={(e) => setField('patientCondition', e.target.value)}
                  disabled={busy}
                  className="h-9"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="inc-notes">Dispatcher notes</Label>
                <textarea
                  id="inc-notes"
                  rows={2}
                  className={areaClass}
                  value={form.dispatcherNotes}
                  onChange={(e) => setField('dispatcherNotes', e.target.value)}
                  disabled={busy}
                  placeholder="Internal notes for the desk"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label>Photos</Label>
                  <span className="text-[10px] text-ink-500">JPEG / PNG / WebP / GIF · max 10MB</span>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif,video/mp4"
                  multiple
                  className="sr-only"
                  onChange={(e) => void onPickFiles(e.target.files)}
                />
                <button
                  type="button"
                  disabled={busy || uploading}
                  onClick={() => fileRef.current?.click()}
                  className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-navy-600 bg-navy-950/40 px-3 py-4 text-sm text-ink-300 transition hover:border-gold-500/50 hover:text-ink-100 disabled:opacity-50"
                >
                  <ImagePlus className="h-4 w-4 text-gold-500" aria-hidden />
                  {uploading ? 'Uploading…' : 'Add photos'}
                </button>
                {media.length > 0 && (
                  <ul className="grid grid-cols-3 gap-2">
                    {media.map((m) => (
                      <li key={m.id} className="group relative overflow-hidden rounded-md border border-navy-600 bg-navy-950">
                        <MediaThumb token={token} id={m.id} contentType={m.contentType} fileName={m.fileName} />
                        <button
                          type="button"
                          className="absolute right-1 top-1 rounded bg-navy-950/80 p-1 text-alert-400 opacity-0 transition group-hover:opacity-100"
                          aria-label={`Remove ${m.fileName}`}
                          disabled={busy}
                          onClick={() => void removeMedia(m.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </form>
          )}

          <div className="flex justify-end gap-2 border-t border-navy-700 px-5 py-3">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void saveEdit()} disabled={busy || !form}>
              {busy ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === 'more'} onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent className="max-h-[90dvh] max-w-md overflow-hidden p-0">
          <div className="border-b border-navy-700 px-5 py-4 pr-12">
            <DialogHeader className="mb-0">
              <DialogTitle>More actions</DialogTitle>
              {incident ? (
                <DialogDescription asChild>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="font-mono text-alert-400">{incident.displayId}</span>
                    <StatusBadge status={incident.status} className="origin-left scale-90" />
                  </div>
                </DialogDescription>
              ) : (
                <DialogDescription>Choose a follow-up action for this incident.</DialogDescription>
              )}
            </DialogHeader>
          </div>

          <div className="max-h-[min(58vh,480px)] space-y-4 overflow-y-auto px-5 py-4 sidebar-scroll">
            <div className="space-y-2">
              <p className="font-mono text-[10px] uppercase tracking-wide text-ink-500">Status</p>
              {nextStatuses.length === 0 ? (
                <p className="rounded-md border border-navy-700 bg-navy-950/50 px-3 py-2 text-sm text-ink-400">
                  No further status changes from <span className="text-ink-200">{incident?.status}</span>.
                </p>
              ) : (
                <>
                  <div className="flex gap-2">
                    <select
                      className={`${fieldClass} flex-1`}
                      value={statusPick}
                      onChange={(e) => setStatusPick(e.target.value)}
                      disabled={busy}
                      aria-label="New status"
                    >
                      {nextStatuses.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      size="sm"
                      className="h-9 shrink-0"
                      disabled={busy || !statusPick}
                      onClick={() => void applyStatus()}
                    >
                      Apply
                    </Button>
                  </div>
                  <p className="text-[11px] text-ink-500">
                    From <span className="text-ink-300">{incident?.status}</span> you can move to:{' '}
                    {nextStatuses.join(', ')}.
                  </p>
                </>
              )}
            </div>

            <div className="space-y-2">
              <p className="font-mono text-[10px] uppercase tracking-wide text-ink-500">Workflow</p>
              <div className="grid grid-cols-1 gap-1.5">
                {canVerify && (
                  <ActionRow
                    icon={CheckCircle2}
                    label="Verify incident"
                    hint="Confirm and open for dispatch"
                    onClick={() => openConfirm('verify')}
                    disabled={busy}
                  />
                )}
                {canFalseAlarm && (
                  <ActionRow
                    icon={ShieldAlert}
                    label="False alarm"
                    hint="Close as false alarm"
                    onClick={() => openConfirm('falseAlarm')}
                    disabled={busy}
                    tone="warn"
                  />
                )}
                {canCancel && (
                  <ActionRow
                    icon={XCircle}
                    label="Cancel incident"
                    hint="Requires a reason"
                    onClick={() => openConfirm('cancel')}
                    disabled={busy}
                    tone="danger"
                  />
                )}
                {canReopen && (
                  <ActionRow
                    icon={RotateCcw}
                    label="Reopen incident"
                    hint="Return to active queue"
                    onClick={() => openConfirm('reopen')}
                    disabled={busy}
                  />
                )}
                {!canVerify && !canFalseAlarm && !canCancel && !canReopen && (
                  <p className="text-sm text-ink-500">No workflow actions for this status.</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <p className="font-mono text-[10px] uppercase tracking-wide text-ink-500">Shortcuts</p>
              <div className="grid grid-cols-1 gap-1.5">
                <ActionRow
                  icon={Copy}
                  label="Copy incident ID"
                  hint={incident?.displayId}
                  onClick={() => void copyId()}
                  disabled={busy}
                />
                {incident && (
                  <Link
                    to={`/admin/dispatch?incident=${incident._id}`}
                    className="flex items-center gap-3 rounded-md border border-navy-600 bg-navy-950/40 px-3 py-2.5 text-left transition-colors hover:border-navy-500 hover:bg-navy-800/60"
                    onClick={onClose}
                  >
                    <ExternalLink className="h-4 w-4 shrink-0 text-gold-500" aria-hidden />
                    <span>
                      <span className="block text-sm font-semibold text-ink-50">Open in Dispatch</span>
                      <span className="block text-xs text-ink-400">Assign units and run the desk</span>
                    </span>
                  </Link>
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-end border-t border-navy-700 px-5 py-3">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        open={!!confirm}
        request={confirm}
        busy={busy}
        onCancel={() => {
          if (busy) return;
          setConfirm(null);
          setConfirmKind(null);
        }}
        onConfirm={(reason) => void runConfirm(reason)}
      />
    </>
  );
}

function MediaThumb({
  token,
  id,
  contentType,
  fileName,
}: {
  token: string;
  id: string;
  contentType: string;
  fileName: string;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    void mediaApi
      .fetchBlobUrl(token, id)
      .then((u) => {
        if (cancelled) {
          URL.revokeObjectURL(u);
          return;
        }
        url = u;
        setSrc(u);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [token, id]);

  if (contentType.startsWith('video/')) {
    return src ? (
      <video src={src} className="aspect-square w-full object-cover" muted playsInline />
    ) : (
      <div className="flex aspect-square items-center justify-center text-[10px] text-ink-500">Video</div>
    );
  }

  return src ? (
    <img src={src} alt={fileName} className="aspect-square w-full object-cover" />
  ) : (
    <div className="flex aspect-square items-center justify-center text-[10px] text-ink-500">…</div>
  );
}

function ActionRow({
  icon: Icon,
  label,
  hint,
  onClick,
  disabled,
  tone,
}: {
  icon: typeof AlertTriangle;
  label: string;
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'warn' | 'danger';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-3 rounded-md border border-navy-600 bg-navy-950/40 px-3 py-2.5 text-left transition-colors hover:border-navy-500 hover:bg-navy-800/60 disabled:opacity-50"
    >
      <Icon
        className={
          tone === 'danger'
            ? 'h-4 w-4 shrink-0 text-alert-400'
            : tone === 'warn'
              ? 'h-4 w-4 shrink-0 text-amber-400'
              : 'h-4 w-4 shrink-0 text-gold-500'
        }
        aria-hidden
      />
      <span>
        <span className="block text-sm font-semibold text-ink-50">{label}</span>
        {hint ? <span className="block text-xs text-ink-400">{hint}</span> : null}
      </span>
    </button>
  );
}
