import { useEffect, useState } from 'react';
import { reverseGeocode } from '@/lib/geocode';
import { useMapConfig } from '@/hooks/useMapConfig';
import clsx from 'clsx';

interface LocationDisplayProps {
  addressText?: string | null;
  landmark?: string | null;
  lat?: number | null;
  lng?: number | null;
  /** When true, attempt reverse geocode if addressText is missing. */
  resolvePlaceName?: boolean;
  className?: string;
  primaryClassName?: string;
  secondaryClassName?: string;
}

function formatCoords(lat: number, lng: number) {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

/**
 * Place / address as primary location presentation; coordinates secondary.
 * Does not invent a place name — falls back to coords clearly labeled.
 */
export function LocationDisplay({
  addressText,
  landmark,
  lat,
  lng,
  resolvePlaceName = true,
  className,
  primaryClassName,
  secondaryClassName,
}: LocationDisplayProps) {
  const { data: mapConfig } = useMapConfig();
  const [resolved, setResolved] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  const hasCoords = typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng);
  const trimmedAddress = addressText?.trim() || '';

  useEffect(() => {
    let cancelled = false;
    if (!resolvePlaceName || trimmedAddress || !hasCoords || !mapConfig?.mapboxToken) {
      setResolved(null);
      return;
    }
    setResolving(true);
    void reverseGeocode(mapConfig.mapboxToken, lat!, lng!).then((name) => {
      if (!cancelled) {
        setResolved(name);
        setResolving(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [resolvePlaceName, trimmedAddress, hasCoords, lat, lng, mapConfig?.mapboxToken]);

  const primary =
    trimmedAddress ||
    resolved ||
    (resolving ? 'Resolving place name…' : hasCoords ? 'Location available (coordinates only)' : 'Location unavailable');

  return (
    <div className={clsx('min-w-0', className)}>
      <p className={clsx('text-sm text-ink-100', primaryClassName)}>{primary}</p>
      {landmark ? <p className="text-xs text-ink-400">Near: {landmark}</p> : null}
      {hasCoords ? (
        <p className={clsx('font-mono text-[11px] text-ink-500', secondaryClassName)}>
          Coords: {formatCoords(lat!, lng!)}
        </p>
      ) : null}
    </div>
  );
}
