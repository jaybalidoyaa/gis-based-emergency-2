import { useState, useEffect, useRef, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuthStore } from '@/store/authStore';
import { sosApi, mediaApi, profileApi } from '@/services/api';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { MapView } from '@/components/map/MapView';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { QueryState } from '@/components/ui/QueryState';
import { LocationDisplay } from '@/components/ui/LocationDisplay';
import { ConfirmActionDialog } from '@/components/ui/ConfirmActionDialog';
import { useMapConfig } from '@/hooks/useMapConfig';
import { reverseGeocode } from '@/lib/geocode';
import { LIVE } from '@/lib/liveTiming';
import { citizenText } from '@/lib/citizenLocale';
import { SUN_VALLEY_CENTER } from '@/lib/validation';

const HOTLINE = '117 / Barangay Sun Valley BDRRMO';
const HOTLINE_TEL = 'tel:117';

const STEPS = [
  { n: 1, label: 'Type', hint: 'What kind of emergency' },
  { n: 2, label: 'Location', hint: 'Where help is needed' },
  { n: 3, label: 'Details', hint: 'Contact and description' },
  { n: 4, label: 'Send', hint: 'Review and hold to send' },
] as const;

const STATUS_MEANING: Record<string, string> = {
  Pending: 'Your request reached Dispatch and is waiting for review.',
  'Pending Verification': 'Dispatchers are verifying your report.',
  Verified: 'Your report was verified.',
  Open: 'Dispatchers are coordinating a response.',
  Assigned: 'A responder unit has been assigned.',
  Dispatched: 'Help has been dispatched toward your location.',
  'En Route': 'Responders are on the way.',
  'On Scene': 'Responders have arrived at the scene.',
  Transporting: 'Someone is being transported for care.',
  Resolved: 'The emergency response is complete.',
  Closed: 'This request is closed.',
  Cancelled: 'This request was cancelled.',
  'False Alarm': 'Marked as a false alarm.',
  'In Progress': 'Your request is being handled.',
  'Converted to Incident': 'Your SOS became an active incident.',
};

function statusMeaning(status?: string) {
  if (!status) return 'Waiting for the next update from Dispatch.';
  return STATUS_MEANING[status] ?? `Current status: ${status}. Keep this phone nearby.`;
}

export function CitizenSOSPage() {
  const { accessToken, user } = useAuthStore();
  const queryClient = useQueryClient();
  const profileQuery = useQuery({
    queryKey: ['profile'],
    queryFn: () => profileApi.get(accessToken!),
    enabled: !!accessToken,
    staleTime: 60_000,
  });
  const lang = String(profileQuery.data?.data?.language ?? 'en');
  const t = (en: string) => citizenText(lang, en);
  const [searchParams] = useSearchParams();
  const { data: mapConfig } = useMapConfig();
  const [step, setStep] = useState(1);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locError, setLocError] = useState('');
  const [manualAddress, setManualAddress] = useState('');
  const [landmark, setLandmark] = useState('');
  const [incidentTypeId, setIncidentTypeId] = useState('');
  const [description, setDescription] = useState('');
  const [victims, setVictims] = useState('1');
  const [hazards, setHazards] = useState('');
  const [contact, setContact] = useState(user?.contactNumber ?? '');
  const [holdMs, setHoldMs] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [queuedOnly, setQueuedOnly] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const holdRef = useRef<number | null>(null);

  const typesQuery = useQuery({ queryKey: ['sos-types'], queryFn: () => sosApi.types() });
  const statusQuery = useQuery({
    queryKey: ['citizen-sos'],
    queryFn: () => sosApi.myStatus(accessToken!),
    enabled: !!accessToken,
    refetchInterval: LIVE.hotMs,
  });

  useEffect(() => {
    const types = typesQuery.data?.data ?? [];
    if (!types.length || incidentTypeId) return;
    const hint = (searchParams.get('type') || '').toLowerCase();
    if (!hint) return;
    const matchers: Record<string, RegExp> = {
      fire: /fire/i,
      medical: /medical|injury|illness/i,
      vehicular: /vehicle|vehicular|road|crash|accident/i,
      crime: /crime|security|theft|assault/i,
    };
    const re = matchers[hint];
    const found = re ? types.find((t) => re.test(t.typeName)) : null;
    if (found) {
      setIncidentTypeId(found._id);
      setStep(2);
    }
  }, [typesQuery.data, searchParams, incidentTypeId]);

  useEffect(() => {
    if (step === 2 && !coords) {
      navigator.geolocation?.getCurrentPosition(
        (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => setLocError('Location permission denied. Enter an address or drag the pin in Sun Valley.')
      );
    }
  }, [step, coords]);

  useEffect(() => {
    let cancelled = false;
    async function resolve() {
      if (!coords || !mapConfig?.mapboxToken || manualAddress.trim()) return;
      const name = await reverseGeocode(mapConfig.mapboxToken, coords.lat, coords.lng);
      if (!cancelled && name) setManualAddress(name);
    }
    void resolve();
    return () => {
      cancelled = true;
    };
  }, [coords?.lat, coords?.lng, mapConfig?.mapboxToken]);

  const latest = statusQuery.data?.data;
  const viewStatus = searchParams.get('view') === 'status' || searchParams.get('view') === 'history';
  const active =
    latest &&
    !['Cancelled', 'Closed', 'Resolved'].includes(String(latest.status)) &&
    !['Closed', 'Resolved', 'Cancelled', 'False Alarm'].includes(String(latest.incidentId?.status ?? ''));

  const showTracking = Boolean(submittedId || active || queuedOnly || (viewStatus && latest));

  function startHold() {
    const start = Date.now();
    holdRef.current = window.setInterval(() => {
      const ms = Date.now() - start;
      setHoldMs(ms);
      if (ms >= LIVE.sosHoldMs) {
        stopHold();
        void submitSOS();
      }
    }, 50);
  }

  function stopHold() {
    if (holdRef.current) window.clearInterval(holdRef.current);
    holdRef.current = null;
    setHoldMs(0);
  }

  function onHoldKeyDown(e: KeyboardEvent) {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    if (holdRef.current) return;
    startHold();
  }

  function onHoldKeyUp(e: KeyboardEvent) {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    stopHold();
  }

  async function submitSOS() {
    if (!accessToken || !incidentTypeId || submitting) return;
    const lat = coords?.lat ?? SUN_VALLEY_CENTER.lat;
    const lng = coords?.lng ?? SUN_VALLEY_CENTER.lng;
    setSubmitting(true);
    const payload = {
      incidentTypeId,
      description,
      latitude: lat,
      longitude: lng,
      addressText: manualAddress || undefined,
      landmark: landmark || undefined,
      autoLocationFlag: !!coords,
      priorityLevel: 'High',
      victimCount: Number(victims) || 0,
      hazards,
      contactNumber: contact,
    };
    try {
      if (!navigator.onLine) {
        const { enqueue } = await import('@/lib/offlineQueue');
        const item = await enqueue({
          id: crypto.randomUUID(),
          kind: 'sos',
          payload,
          idempotencyKey: crypto.randomUUID(),
        });
        toast.message(`SOS queued offline (${item.id.slice(0, 8)}). Not sent yet — will sync when online.`);
        setSubmittedId(`QUEUED:${item.id}`);
        setQueuedOnly(true);
        return;
      }
      const res = await sosApi.create(accessToken, payload);
      setSubmittedId(res.data.sos._id ?? res.data.sos.displayId);
      setQueuedOnly(false);
      toast.success(`SOS ${res.data.sos.displayId} sent`);
      queryClient.invalidateQueries({ queryKey: ['citizen-sos'] });
    } catch (err) {
      if (!navigator.onLine) {
        toast.error('Offline — SOS was not confirmed as sent');
      } else {
        toast.error(err instanceof Error ? err.message : 'Failed to submit SOS');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (showTracking) {
    const inc = latest?.incidentId;
    const liveStatus = String(inc?.status ?? latest?.status ?? (queuedOnly ? 'Queued offline' : 'Pending'));
    const assigned =
      ['Assigned', 'Dispatched', 'En Route', 'On Scene', 'Transporting'].includes(String(inc?.status ?? '')) ||
      Boolean(inc?.assignments?.length);

    return (
      <div className="space-y-4">
        <header>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-500">Emergency SOS</p>
          <h2 className="text-lg font-bold text-ink-50">Live tracking</h2>
          <p className="text-sm text-ink-400">Status updates from Dispatch for your request.</p>
        </header>

        <HotlineBanner />

        <div
          className={`card p-4 text-center ${
            queuedOnly ? 'border-gold-600/40 bg-gold-500/10' : 'border-ok-500/30 bg-ok-500/10'
          }`}
        >
          <h3 className={`text-lg font-bold ${queuedOnly ? 'text-gold-400' : 'text-ok-400'}`}>
            {queuedOnly ? 'SOS saved on this device' : 'Emergency request received'}
          </h3>
          <p className="mt-1 font-mono text-sm text-ink-200">
            {queuedOnly ? submittedId : latest?.displayId ?? submittedId}
          </p>
          <p className="mt-2 text-sm text-ink-300">
            {queuedOnly
              ? 'Your request is not yet with Dispatch. It will send automatically when this phone is online again. Call the hotline if you need help now.'
              : 'Dispatchers have your request. Keep this screen open if you can. Help is being coordinated.'}
          </p>
          <p className="mt-2 text-xs text-ink-400">False reports are prohibited under barangay emergency ordinances.</p>
        </div>

        <div className="card space-y-3 p-4">
          <h3 className="font-semibold">Live status</h3>
          <QueryState
            isLoading={statusQuery.isLoading && !latest && !queuedOnly}
            isError={statusQuery.isError && !latest && !queuedOnly}
            error={statusQuery.error as Error}
            onRetry={() => statusQuery.refetch()}
            isEmpty={false}
            showLastUpdated={false}
          >
            <StatusBadge status={liveStatus} />
            <p className="mt-2 text-sm text-ink-300">
              {queuedOnly ? 'Waiting to sync.' : statusMeaning(liveStatus)}
            </p>
            {assigned ? (
              <div className="mt-2 space-y-2 rounded-md border border-ok-500/30 bg-ok-500/10 px-3 py-2" role="status">
                <p className="text-sm text-ok-400">Help is coming — a unit has been assigned or is responding.</p>
                {(inc?.assignments ?? []).length > 0 ? (
                  <ul className="space-y-1 text-sm text-ink-200">
                    {(inc?.assignments ?? []).map((a) => {
                      const callsign = a.responderId?.callsign;
                      const name = a.responderId?.userId?.fullName;
                      return (
                        <li key={a._id} className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{callsign || name || 'Unit'}</span>
                          {name && callsign ? <span className="text-ink-400">· {name}</span> : null}
                          <StatusBadge status={a.assignmentStatus} />
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            ) : !queuedOnly ? (
              <p className="mt-2 text-sm text-ink-400">
                Unit assignment appears here after Dispatch assigns help.
              </p>
            ) : null}

            {inc?.locationId ? (
              <>
                <LocationDisplay
                  addressText={inc.locationId.addressText}
                  lat={inc.locationId.latitude}
                  lng={inc.locationId.longitude}
                />
                <div className="overflow-hidden rounded-md">
                  <MapView
                    selectedIncident={inc}
                    height="200px"
                    zoom={16}
                    pin={{ lat: inc.locationId.latitude, lng: inc.locationId.longitude }}
                    showFacilities={false}
                  />
                </div>
              </>
            ) : coords ? (
              <LocationDisplay addressText={manualAddress} landmark={landmark} lat={coords.lat} lng={coords.lng} />
            ) : null}

            {!queuedOnly && latest?._id && (
              <div className="mt-3 flex flex-col gap-2">
                {inc?._id ? (
                  <label className="btn-secondary flex min-h-[48px] cursor-pointer items-center justify-center">
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      disabled={uploading}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file || !accessToken || !inc._id) return;
                        setUploading(true);
                        void mediaApi
                          .upload(accessToken, inc._id, file, 'Citizen evidence')
                          .then(() => toast.success('Photo sent to Dispatch'))
                          .catch((err) => toast.error(err instanceof Error ? err.message : 'Upload failed'))
                          .finally(() => setUploading(false));
                      }}
                    />
                    {uploading ? 'Uploading…' : 'Send scene photo'}
                  </label>
                ) : null}
                <Button type="button" variant="outline" className="min-h-[48px]" onClick={() => setUpdateOpen(true)}>
                  Send more information
                </Button>
                <Button type="button" variant="outline" className="min-h-[48px]" onClick={() => setCancelOpen(true)}>
                  Cancel request
                </Button>
              </div>
            )}
          </QueryState>
        </div>

        <div className="card space-y-2 p-4 text-sm">
          <h3 className="font-semibold">What the statuses mean</h3>
          <ul className="space-y-1 text-ink-400">
            <li>
              <span className="text-ink-200">Pending / Verifying</span> — Dispatch is reviewing your SOS.
            </li>
            <li>
              <span className="text-ink-200">Assigned / En Route</span> — Help is on the way.
            </li>
            <li>
              <span className="text-ink-200">On Scene</span> — Responders have arrived.
            </li>
          </ul>
        </div>

        <ConfirmActionDialog
          open={updateOpen}
          request={{
            title: 'Send more information?',
            description: 'Add details that help Dispatch (hazards, landmarks, people involved).',
            confirmLabel: 'Send update',
            requireReason: true,
            reasonLabel: 'Update for Dispatch',
            reasonPlaceholder: 'Describe what changed…',
          }}
          onCancel={() => setUpdateOpen(false)}
          onConfirm={async (reason) => {
            if (!accessToken || !latest?._id || !reason) return;
            try {
              await sosApi.update(accessToken, latest._id, reason);
              toast.success('Update sent');
              setUpdateOpen(false);
              queryClient.invalidateQueries({ queryKey: ['citizen-sos'] });
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Could not send update');
            }
          }}
        />
        <ConfirmActionDialog
          open={cancelOpen}
          request={{
            title: 'Cancel this SOS request?',
            description: 'Only cancel if help is no longer needed. False-alarm cancellations are logged.',
            confirmLabel: 'Cancel request',
            tone: 'destructive',
            requireReason: true,
            reasonLabel: 'Reason',
          }}
          onCancel={() => setCancelOpen(false)}
          onConfirm={async (reason) => {
            if (!accessToken || !latest?._id || !reason) return;
            try {
              await sosApi.cancel(accessToken, latest._id, reason);
              toast.message('Cancellation sent');
              setCancelOpen(false);
              setSubmittedId(null);
              setQueuedOnly(false);
              queryClient.invalidateQueries({ queryKey: ['citizen-sos'] });
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Could not cancel');
            }
          }}
        />
      </div>
    );
  }

  const typeName = (typesQuery.data?.data ?? []).find((t) => t._id === incidentTypeId)?.typeName;

  return (
    <div className="space-y-4">
      <header>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-500">Barangay Sun Valley</p>
        <h2 className="text-lg font-bold text-ink-50">{t('Emergency SOS')}</h2>
        <p className="text-sm text-ink-400">{t('Calm, guided request — four short steps.')}</p>
      </header>
      <HotlineBanner lang={lang} />
      <p className="text-xs text-alert-400">
        {t('False emergency reports are prohibited and may be referred to barangay authorities.')}
      </p>

      <ol className="flex gap-1" aria-label="SOS progress">
        {STEPS.map((s) => (
          <li key={s.n} className="min-w-0 flex-1">
            <div
              className={`rounded-md border px-2 py-2 text-center ${
                step === s.n ? 'border-gold-600 bg-navy-800' : step > s.n ? 'border-navy-600' : 'border-navy-800 text-ink-500'
              }`}
              aria-current={step === s.n ? 'step' : undefined}
            >
              <p className="font-mono text-[10px]">{s.n}</p>
              <p className="truncate text-xs font-medium">{s.label}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="font-mono text-[11px] text-ink-500">
        Step {step} of 4 — {STEPS[step - 1].hint}
      </p>

      {step === 1 && (
        <div className="space-y-3">
          <p className="text-sm font-medium">{t('Choose emergency type')}</p>
          <QueryState
            isLoading={typesQuery.isLoading}
            isError={typesQuery.isError}
            error={typesQuery.error as Error}
            onRetry={() => typesQuery.refetch()}
            isEmpty={!typesQuery.isLoading && (typesQuery.data?.data ?? []).length === 0}
            emptyTitle={t('Emergency types unavailable')}
            emptyHint={`Call ${HOTLINE} if you cannot continue in the app.`}
            showLastUpdated={false}
          >
            <div className="grid grid-cols-1 gap-2">
              {(typesQuery.data?.data ?? []).map((t) => (
                <button
                  key={t._id}
                  type="button"
                  onClick={() => {
                    setIncidentTypeId(t._id);
                    setStep(2);
                  }}
                  className="btn-secondary min-h-[52px] justify-start text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500"
                >
                  {t.typeName}
                </button>
              ))}
            </div>
          </QueryState>
        </div>
      )}

      {step === 2 && (
        <div className="card space-y-4 p-4">
          <h3 className="font-medium">{t('Confirm your location')}</h3>
          <div className="overflow-hidden rounded-md">
            <MapView
              height="220px"
              zoom={15}
              pin={{ lat: coords?.lat ?? SUN_VALLEY_CENTER.lat, lng: coords?.lng ?? SUN_VALLEY_CENTER.lng, label: 'You' }}
              onPinMove={(lat, lng) => {
                setCoords({ lat, lng });
                setManualAddress('');
              }}
              showFacilities={false}
            />
          </div>
          {locError && <p className="text-sm text-gold-400" role="status">{locError}</p>}
          <div className="space-y-1">
            <Label htmlFor="sos-addr">Address or place name</Label>
            <Input id="sos-addr" placeholder="Street, building, or landmark area" value={manualAddress} onChange={(e) => setManualAddress(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sos-land">Nearby landmark</Label>
            <Input id="sos-land" placeholder="Landmark" value={landmark} onChange={(e) => setLandmark(e.target.value)} />
          </div>
          <LocationDisplay addressText={manualAddress} landmark={landmark} lat={coords?.lat} lng={coords?.lng} resolvePlaceName={false} />
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="min-h-[48px]" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button type="button" className="min-h-[48px] flex-1" onClick={() => setStep(3)} disabled={!coords && !manualAddress.trim()}>
              Continue
            </Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="card space-y-4 p-4">
          <h3 className="font-medium">Contact and details</h3>
          <div className="space-y-1">
            <Label htmlFor="sos-desc">What is happening?</Label>
            <textarea
              id="sos-desc"
              className="input-field min-h-[80px]"
              placeholder="Short description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sos-vic">People involved</Label>
            <Input id="sos-vic" type="number" min={0} value={victims} onChange={(e) => setVictims(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sos-haz">Immediate hazards</Label>
            <Input id="sos-haz" placeholder="Fire, wires, flood…" value={hazards} onChange={(e) => setHazards(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sos-contact">Callback number</Label>
            <Input id="sos-contact" type="tel" placeholder="Callback number" value={contact} onChange={(e) => setContact(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="min-h-[48px]" onClick={() => setStep(2)}>
              Back
            </Button>
            <Button type="button" className="min-h-[48px] flex-1" onClick={() => setStep(4)} disabled={description.trim().length < 3}>
              Review
            </Button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="card space-y-4 p-4">
          <h3 className="font-medium">Review and send</h3>
          <p className="text-sm text-ink-400">After you send, Dispatch reviews your SOS and assigns help. Call the hotline if the app fails.</p>
          <ul className="space-y-1 text-sm text-ink-300">
            <li>Type: {typeName ?? '—'}</li>
            <li>
              Location: {manualAddress || (coords ? 'Map pin set' : '—')}
              {!coords && manualAddress ? ' (address only — GPS not confirmed)' : ''}
              {coords && !manualAddress.trim() ? ' (map pin; reverse-geocode pending)' : ''}
            </li>
            <li>Landmark: {landmark || '—'}</li>
            <li>Description: {description.trim() || '—'}</li>
            <li>People involved: {victims}</li>
            <li>Hazards: {hazards.trim() || 'None reported'}</li>
            <li>Callback: {contact || '—'}</li>
          </ul>
          {coords && (
            <p className="font-mono text-[11px] text-ink-500">
              Confirmed pin: {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
            </p>
          )}
          {!coords && (
            <p className="text-xs text-gold-400">
              No confirmed GPS pin — send will use the Sun Valley map center unless you set a pin on the Location step.
            </p>
          )}
          <p className="text-xs text-ink-500">
            {t(
              'Hold the button about one second to send (mouse, touch, or Space/Enter). This prevents accidental taps without delaying a real emergency.'
            )}
          </p>
          <button
            type="button"
            disabled={submitting || !incidentTypeId}
            onMouseDown={startHold}
            onMouseUp={stopHold}
            onMouseLeave={stopHold}
            onTouchStart={(e) => {
              e.preventDefault();
              startHold();
            }}
            onTouchEnd={stopHold}
            onKeyDown={onHoldKeyDown}
            onKeyUp={onHoldKeyUp}
            aria-label="Hold to send SOS emergency request"
            className="min-h-[88px] w-full rounded-2xl bg-alert-500 text-lg font-bold text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-gold-500/40"
            style={{ opacity: 0.85 + Math.min(holdMs, LIVE.sosHoldMs) / 4000 }}
          >
            {submitting
              ? 'Sending…'
              : holdMs
                ? `Hold… ${Math.round((holdMs / LIVE.sosHoldMs) * 100)}%`
                : 'HOLD TO SEND SOS'}
          </button>
          <Button type="button" variant="outline" className="min-h-[48px] w-full" onClick={() => setStep(3)}>
            Back to details
          </Button>
          <a
            className="flex min-h-[44px] items-center justify-center text-center text-sm text-gold-500 underline"
            href={HOTLINE_TEL}
          >
            Call emergency hotline instead
          </a>
        </div>
      )}
    </div>
  );
}

function HotlineBanner({ lang }: { lang?: string }) {
  return (
    <div className="card p-4 text-sm" role="note">
      <p className="font-medium text-ink-100">{citizenText(lang, 'Emergency fallback')}</p>
      <p className="text-ink-400">
        If this app fails, call{' '}
        <a
          className="inline-flex min-h-[44px] items-center font-semibold text-gold-500 underline"
          href={HOTLINE_TEL}
        >
          {HOTLINE}
        </a>
        .
      </p>
    </div>
  );
}
