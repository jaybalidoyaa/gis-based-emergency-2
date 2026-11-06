import type { MapUnit } from '@/types';
import { resolveUnitStatus } from '@/lib/opsVisuals';
import { getGpsFreshness, formatGpsStatus } from '@/constants/gps-config';
import { QueryState } from '@/components/ui/QueryState';
import { OpsSectionHeader } from '@/components/ui/OpsSection';
import { MapPin, Radio } from 'lucide-react';
import clsx from 'clsx';

interface UnitTrackingPanelProps {
  units: MapUnit[];
  isLoading: boolean;
  isError: boolean;
  error?: Error | null;
  onRetry: () => void;
  selectedUnitId?: string | null;
  onSelectUnit: (unit: MapUnit) => void;
}

function unitDisplayName(unit: MapUnit) {
  return unit.unitNo || unit.callsign || unit.vehicleType || 'Unit';
}

function locationLabel(unit: MapUnit) {
  const loc = unit.currentLocation;
  if (!loc) return 'No GPS fix';

  const freshness = getGpsFreshness(loc.updatedAt);

  if (freshness === 'LIVE') {
    return `${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}`;
  }
  if (freshness === 'DELAYED') {
    return `${formatGpsStatus(loc.updatedAt)} (approx)`;
  }
  // OFFLINE
  return 'GPS Offline';
}

export function UnitTrackingPanel({
  units,
  isLoading,
  isError,
  error,
  onRetry,
  selectedUnitId,
  onSelectUnit,
}: UnitTrackingPanelProps) {
  return (
    <div className="card flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden p-3 sm:p-4">
      <OpsSectionHeader title="Unit tracking" href="/admin/map" linkLabel="Live map" className="shrink-0" />
      <QueryState
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={onRetry}
        isEmpty={units.length === 0}
        emptyTitle="No units reporting"
        emptyHint="Vehicle and responder GPS will appear when units are online."
        showLastUpdated={false}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        skeleton={
          <div className="space-y-3" aria-busy="true" aria-label="Loading units">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-md bg-navy-800" />
            ))}
          </div>
        }
      >
        <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto sidebar-scroll pr-1" role="listbox" aria-label="Units">
          {units.map((unit) => {
            const status = resolveUnitStatus(unit.status || unit.operationalStatus || unit.availabilityStatus);
            const selected = selectedUnitId === unit._id;
            const name = unitDisplayName(unit);
            const gpsFreshness = getGpsFreshness(unit.currentLocation?.updatedAt);
            return (
              <li key={unit._id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => onSelectUnit(unit)}
                  className={clsx(
                    'w-full rounded-md border p-2.5 text-left transition-colors sm:p-3',
                    selected
                      ? 'border-gold-500 bg-navy-800'
                      : 'border-navy-700 bg-navy-900/70 hover:border-navy-600 hover:bg-navy-800',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-950'
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-sm font-semibold text-ink-50">{name}</p>
                      <p className="truncate text-xs text-ink-400">{unit.vehicleType || 'Responder unit'}</p>
                    </div>
                    <span
                      title={status.label}
                      className={clsx(
                        'inline-flex shrink-0 max-w-[120px] items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium',
                        status.bgClass,
                        status.textClass
                      )}
                    >
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: status.color }} aria-hidden="true" />
                      <Radio className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span className="truncate">{status.label}</span>
                    </span>
                  </div>
                  <div className="mt-2 space-y-1 text-[11px] text-ink-400">
                    <p className="flex min-w-0 items-center gap-1.5">
                      <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span
                        className={clsx(
                          'truncate',
                          gpsFreshness === 'DELAYED' && 'text-gold-400',
                          gpsFreshness === 'OFFLINE' && 'text-ink-500'
                        )}
                      >
                        {locationLabel(unit)}
                      </span>
                    </p>
                    {unit.currentLocation?.updatedAt && (
                      <p className="font-mono text-ink-500">GPS {formatGpsStatus(unit.currentLocation.updatedAt)}</p>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </QueryState>
    </div>
  );
}
