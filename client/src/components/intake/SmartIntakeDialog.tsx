import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { incidentsApi } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmActionDialog } from '@/components/ui/ConfirmActionDialog';
import { MapView } from '@/components/map/MapView';
import { useMapConfig } from '@/hooks/useMapConfig';
import { forwardGeocode, isInsideSunValley, reverseGeocode, type GeocodeResult } from '@/lib/geocode';
import { normalizePhPhone, PRIORITIES, SUN_VALLEY_CENTER } from '@/lib/validation';

const DRAFT_KEY = 'sv-intake-draft-v1';
const STEPS = [
  { key: 'caller', label: 'Caller', hint: 'Who is reporting' },
  { key: 'location', label: 'Location', hint: 'Where help is needed' },
  { key: 'details', label: 'Details', hint: 'What happened' },
  { key: 'review', label: 'Review', hint: 'Confirm before dispatch' },
] as const;

type IntakeForm = {
  callerName: string;
  callerPhone: string;
  incidentTypeId: string;
  subcategory: string;
  priorityLevel: string;
  addressText: string;
  landmark: string;
  victimCount: string;
  patientCondition: string;
  knownHazards: string;
  accessibility: string;
  description: string;
  reportSource: string;
  anonymous: boolean;
  callbackConfirmed: boolean;
  dispatcherNotes: string;
  mediaNote: string;
};

const emptyForm = (): IntakeForm => ({
  callerName: '',
  callerPhone: '',
  incidentTypeId: '',
  subcategory: '',
  priorityLevel: 'High',
  addressText: '',
  landmark: '',
  victimCount: '1',
  patientCondition: '',
  knownHazards: '',
  accessibility: '',
  description: '',
  reportSource: 'Phone',
  anonymous: false,
  callbackConfirmed: true,
  dispatcherNotes: '',
  mediaNote: '',
});

export function SmartIntakeDialog({
  open,
  onOpenChange,
  types,
  token,
  onCreated,
  recommendedUnitLabel,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  types: { _id: string; typeName: string }[];
  token: string | null;
  onCreated: () => void;
  recommendedUnitLabel?: string;
}) {
  const { data: mapConfig } = useMapConfig();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<{ displayId: string; _id?: string }[]>([]);
  const [pin, setPin] = useState({ lat: SUN_VALLEY_CENTER.lat, lng: SUN_VALLEY_CENTER.lng });
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const [form, setForm] = useState<IntakeForm>(emptyForm);
  const [dirty, setDirty] = useState(false);

  const filteredTypes = useMemo(
    () => types.filter((t) => !/^Patient Transport/i.test(t.typeName)),
    [types]
  );

  useEffect(() => {
    if (!open) return;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { form: IntakeForm; pin: { lat: number; lng: number }; step?: number };
        setForm(parsed.form);
        setPin(parsed.pin);
        setStep(parsed.step ?? 0);
        setDirty(true);
      }
    } catch {
      /* ignore */
    }
    setCreatedId(null);
  }, [open]);

  useEffect(() => {
    if (!open || !dirty || createdId) return;
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ form, pin, step }));
  }, [form, pin, step, open, dirty, createdId]);

  useEffect(() => {
    if (!open) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (dirty && !createdId) {
        e.preventDefault();
        e.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [open, dirty, createdId]);

  function patch(partial: Partial<IntakeForm>) {
    setForm((f) => ({ ...f, ...partial }));
    setDirty(true);
  }

  const phoneOk = !form.callerPhone || !!normalizePhPhone(form.callerPhone);
  const step0Valid = !!form.incidentTypeId && (!form.callerPhone || phoneOk);
  const step1Valid = form.addressText.trim().length >= 3;
  const step2Valid = form.description.trim().length >= 5;
  const canSubmit = step0Valid && step1Valid && step2Valid && !!token;

  async function searchAddress(q: string) {
    patch({ addressText: q });
    if (!mapConfig?.mapboxToken || q.length < 3) {
      setSuggestions([]);
      return;
    }
    const results = await forwardGeocode(mapConfig.mapboxToken, q);
    setSuggestions(results);
  }

  async function applySuggestion(s: GeocodeResult) {
    setPin({ lat: s.lat, lng: s.lng });
    patch({ addressText: s.address });
    setSuggestions([]);
    if (!isInsideSunValley(s.lat, s.lng)) {
      toast.message('Pin is outside the approximate Sun Valley boundary — confirm location carefully');
    }
  }

  async function onPinMove(lat: number, lng: number) {
    setPin({ lat, lng });
    setDirty(true);
    if (mapConfig?.mapboxToken) {
      const addr = await reverseGeocode(mapConfig.mapboxToken, lat, lng);
      patch({ addressText: addr });
    }
  }

  async function useMapCenter() {
    setPin({ lat: SUN_VALLEY_CENTER.lat, lng: SUN_VALLEY_CENTER.lng });
    if (mapConfig?.mapboxToken) {
      const addr = await reverseGeocode(mapConfig.mapboxToken, SUN_VALLEY_CENTER.lat, SUN_VALLEY_CENTER.lng);
      patch({ addressText: addr });
    } else {
      patch({ addressText: 'Barangay Sun Valley, Parañaque City' });
    }
  }

  async function submit() {
    if (!token || saving || !canSubmit) return;
    setSaving(true);
    try {
      const res = await incidentsApi.create(
        token,
        {
          ...form,
          callerPhone: form.callerPhone ? normalizePhPhone(form.callerPhone) : undefined,
          victimCount: Number(form.victimCount) || 0,
          latitude: pin.lat,
          longitude: pin.lng,
          mediaNote: form.mediaNote || undefined,
        },
        crypto.randomUUID()
      );
      const dupes = res.data.duplicates as { displayId: string; _id?: string }[] | undefined;
      setCreatedId(res.data.displayId);
      localStorage.removeItem(DRAFT_KEY);
      setDirty(false);
      toast.success(`${res.data.displayId} created`);
      if (dupes?.length) {
        setDuplicateWarning(dupes);
        toast.message(`Possible duplicates: ${dupes.map((d) => d.displayId).join(', ')}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Intake failed');
    } finally {
      setSaving(false);
    }
  }

  const [discardOpen, setDiscardOpen] = useState(false);

  function resetAndClose(notifyCreated: boolean) {
    if (notifyCreated) onCreated();
    onOpenChange(false);
    setStep(0);
    setForm(emptyForm());
    setDirty(false);
    setCreatedId(null);
    setDuplicateWarning([]);
    setDiscardOpen(false);
  }

  function close() {
    if (dirty && !createdId) {
      setDiscardOpen(true);
      return;
    }
    resetAndClose(!!createdId);
  }

  function stepValidationMessage(): string | null {
    if (step === 0 && !step0Valid) {
      if (!form.incidentTypeId) return 'Select an incident category to continue.';
      if (!phoneOk) return 'Enter a valid PH mobile number or leave contact blank.';
    }
    if (step === 1 && !step1Valid) return 'Enter an address of at least 3 characters (or place the map pin).';
    if (step === 2 && !step2Valid) return 'Describe the incident in at least 5 characters.';
    return null;
  }

  return (
    <>
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New intake — guided dispatch</DialogTitle>
          <DialogDescription>
            Four-step call intake. Drafts save locally until the incident is created.
          </DialogDescription>
        </DialogHeader>

        {createdId ? (
          <div className="space-y-4 text-center" role="status">
            <p className="text-sm text-ink-400">Incident created and ready for dispatch</p>
            <p className="font-mono text-3xl font-bold text-gold-400">{createdId}</p>
            <p className="text-sm">Priority {form.priorityLevel}</p>
            <p className="font-mono text-xs text-ink-500">
              Pin {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}
            </p>
            {duplicateWarning.length > 0 && (
              <div className="rounded-md border border-gold-600/50 bg-gold-500/10 px-4 py-3 text-left text-sm">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-gold-300">⚠ Possible duplicate incident detected</p>
                  <button
                    type="button"
                    className="shrink-0 text-ink-400 hover:text-ink-100"
                    aria-label="Dismiss duplicate warning"
                    onClick={() => setDuplicateWarning([])}
                  >
                    ✕
                  </button>
                </div>
                <ul className="mt-2 space-y-1">
                  {duplicateWarning.map((d) => (
                    <li key={d.displayId}>
                      {d._id ? (
                        <Link
                          to={`/admin/incidents/${d._id}`}
                          onClick={() => resetAndClose(true)}
                          className="font-mono text-gold-400 underline hover:text-gold-300"
                        >
                          {d.displayId}
                        </Link>
                      ) : (
                        <span className="font-mono text-gold-400">{d.displayId}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Button type="button" onClick={() => resetAndClose(true)}>
              Open in Dispatch Center
            </Button>
          </div>
        ) : (
          <>
            <div className="mb-4" role="navigation" aria-label="Intake progress">
              <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-500">
                Step {step + 1} of {STEPS.length} — {STEPS[step].hint}
              </p>
              <ol className="flex flex-wrap gap-2" aria-label="Intake steps">
                {STEPS.map((s, i) => {
                  const done = i < step;
                  const current = i === step;
                  return (
                    <li key={s.key} className="min-w-0 flex-1 basis-[6.5rem]">
                      <button
                        type="button"
                        className={`flex w-full min-h-[44px] flex-col items-start rounded-md border px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 ${
                          current
                            ? 'border-gold-600 bg-navy-800 text-ink-50'
                            : done
                              ? 'border-navy-600 bg-navy-900 text-ink-200'
                              : 'border-navy-700 text-ink-400'
                        }`}
                        aria-current={current ? 'step' : undefined}
                        onClick={() => {
                          if (i <= step || (i === 1 && step0Valid) || (i === 2 && step0Valid && step1Valid) || (i === 3 && canSubmit)) {
                            setStep(i);
                          }
                        }}
                      >
                        <span className="font-mono text-[10px] text-ink-500">{i + 1}</span>
                        <span className="font-medium">{s.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>

            {step === 0 && (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="callerName">Caller name</Label>
                  <Input id="callerName" autoComplete="name" value={form.callerName} onChange={(e) => patch({ callerName: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="callerPhone">Contact number</Label>
                  <Input id="callerPhone" type="tel" autoComplete="tel" value={form.callerPhone} onChange={(e) => patch({ callerPhone: e.target.value })} />
                  {!phoneOk && <p className="text-xs text-alert-400" role="alert">Invalid PH mobile number</p>}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="type">Incident category <span className="text-alert-400">*</span></Label>
                  <select id="type" className="input-field" required value={form.incidentTypeId} onChange={(e) => patch({ incidentTypeId: e.target.value })}>
                    <option value="">Select category</option>
                    {filteredTypes.map((t) => (
                      <option key={t._id} value={t._id}>{t.typeName}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sub">Subcategory</Label>
                  <Input id="sub" value={form.subcategory} onChange={(e) => patch({ subcategory: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pri">Priority / severity</Label>
                  <select id="pri" className="input-field" value={form.priorityLevel} onChange={(e) => patch({ priorityLevel: e.target.value })}>
                    {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="src">Source of report</Label>
                  <select id="src" className="input-field" value={form.reportSource} onChange={(e) => patch({ reportSource: e.target.value })}>
                    <option>Phone</option>
                    <option>Radio</option>
                    <option>Walk-in</option>
                    <option>SOS app</option>
                    <option>Other agency</option>
                  </select>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.anonymous} onChange={(e) => patch({ anonymous: e.target.checked })} />
                  Anonymous report
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.callbackConfirmed} onChange={(e) => patch({ callbackConfirmed: e.target.checked })} />
                  Emergency contact callback confirmed
                </label>
              </div>
            )}

            {step === 1 && (
              <div className="grid gap-3">
                <div className="space-y-1 relative">
                  <Label htmlFor="addr">Exact address <span className="text-alert-400">*</span></Label>
                  <Input id="addr" value={form.addressText} onChange={(e) => void searchAddress(e.target.value)} autoComplete="street-address" />
                  {suggestions.length > 0 && (
                    <ul className="absolute z-20 mt-1 max-h-40 w-full overflow-auto rounded-md border border-navy-600 bg-navy-900 text-sm">
                      {suggestions.map((s) => (
                        <li key={s.placeName}>
                          <button type="button" className="w-full px-3 py-2 text-left hover:bg-navy-800" onClick={() => void applySuggestion(s)}>
                            {s.placeName}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="land">Nearby landmark</Label>
                  <Input id="land" value={form.landmark} onChange={(e) => patch({ landmark: e.target.value })} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => void useMapCenter()}>
                    Use Barangay Sun Valley center
                  </Button>
                  <p className="text-xs text-ink-400 self-center" role="status">
                    {isInsideSunValley(pin.lat, pin.lng) ? 'Inside approximate barangay boundary' : 'Outside approximate barangay boundary'}
                  </p>
                </div>
                <div className="space-y-1">
                  <Label>Map pin (drag to set) — reverse geocodes address</Label>
                  <MapView height="220px" zoom={15} pin={pin} onPinMove={(lat, lng) => void onPinMove(lat, lng)} showFacilities={false} />
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="vic">Number of patients</Label>
                  <Input id="vic" type="number" min={0} value={form.victimCount} onChange={(e) => patch({ victimCount: e.target.value })} />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <Label htmlFor="cond">Patient condition</Label>
                  <Input id="cond" value={form.patientCondition} onChange={(e) => patch({ patientCondition: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="haz">Known hazards</Label>
                  <Input id="haz" value={form.knownHazards} onChange={(e) => patch({ knownHazards: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="acc">Accessibility concerns</Label>
                  <Input id="acc" value={form.accessibility} onChange={(e) => patch({ accessibility: e.target.value })} />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <Label htmlFor="desc">Incident description <span className="text-alert-400">*</span></Label>
                  <textarea id="desc" className="input-field min-h-[80px]" required value={form.description} onChange={(e) => patch({ description: e.target.value })} />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <Label htmlFor="notes">Dispatcher notes</Label>
                  <textarea id="notes" className="input-field min-h-[60px]" value={form.dispatcherNotes} onChange={(e) => patch({ dispatcherNotes: e.target.value })} />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <Label htmlFor="media">Optional media / attachment note</Label>
                  <Input id="media" value={form.mediaNote} onChange={(e) => patch({ mediaNote: e.target.value })} placeholder="Describe photos/video held by caller" />
                  <p className="text-xs text-ink-400">Binary upload uses R2 when configured; note is stored on the timeline.</p>
                </div>
                {recommendedUnitLabel && (
                  <p className="md:col-span-2 rounded-md border border-navy-600 bg-navy-800 px-3 py-2 text-sm">
                    Selected unit recommendation: <strong>{recommendedUnitLabel}</strong>
                  </p>
                )}
              </div>
            )}

            {step === 3 && (
              <div className="space-y-3 text-sm">
                <h3 className="font-semibold">Review before dispatch creation</h3>
                <p className="text-ink-400">Confirm details below. Creating the incident opens it in the Dispatch Center queue.</p>
                <dl className="grid gap-2 md:grid-cols-2">
                  <div><dt className="text-ink-400">Category</dt><dd>{filteredTypes.find((t) => t._id === form.incidentTypeId)?.typeName ?? '—'}</dd></div>
                  <div><dt className="text-ink-400">Priority</dt><dd>{form.priorityLevel}</dd></div>
                  <div><dt className="text-ink-400">Caller</dt><dd>{form.callerName || '—'}</dd></div>
                  <div><dt className="text-ink-400">Phone</dt><dd>{form.callerPhone || '—'}</dd></div>
                  <div className="md:col-span-2"><dt className="text-ink-400">Address</dt><dd>{form.addressText}</dd></div>
                  <div className="md:col-span-2"><dt className="text-ink-400">Description</dt><dd>{form.description}</dd></div>
                  <div><dt className="text-ink-400">Patients</dt><dd>{form.victimCount}</dd></div>
                  <div><dt className="text-ink-400">Hazards</dt><dd>{form.knownHazards || '—'}</dd></div>
                </dl>
                <MapView height="160px" zoom={15} pin={pin} showFacilities={false} interactive={false} />
                {!canSubmit && (
                  <p className="text-sm text-alert-400" role="alert">
                    Complete Caller, Location, and Details before creating.
                  </p>
                )}
                <Button
                  type="button"
                  variant="gold"
                  className="w-full min-h-[48px]"
                  disabled={!canSubmit || saving}
                  onClick={() => void submit()}
                >
                  {saving ? 'Creating incident…' : 'Create & open for dispatch'}
                </Button>
              </div>
            )}

            {stepValidationMessage() && step < 3 && (
              <p className="mt-3 text-sm text-alert-400" role="alert">
                {stepValidationMessage()}
              </p>
            )}

            <div className="mt-4 flex justify-between gap-2">
              <Button type="button" variant="outline" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
                Back
              </Button>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setDirty(true);
                    localStorage.setItem(DRAFT_KEY, JSON.stringify({ form, pin, step }));
                    toast.success('Draft saved on this device');
                  }}
                >
                  Save draft
                </Button>
                {step < 3 && (
                  <Button
                    type="button"
                    disabled={(step === 0 && !step0Valid) || (step === 1 && !step1Valid) || (step === 2 && !step2Valid)}
                    onClick={() => setStep((s) => Math.min(3, s + 1))}
                  >
                    Next
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>

      <ConfirmActionDialog
        open={discardOpen}
        request={{
          title: 'Discard unsaved intake draft?',
          description: 'Unsaved changes will be lost unless you save a draft first.',
          confirmLabel: 'Discard draft',
          cancelLabel: 'Keep editing',
          tone: 'destructive',
        }}
        onCancel={() => setDiscardOpen(false)}
        onConfirm={() => {
          localStorage.removeItem(DRAFT_KEY);
          resetAndClose(false);
        }}
      />
    </>
  );
}
