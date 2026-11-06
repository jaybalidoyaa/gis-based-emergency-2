import { useEffect, useRef, useState, useMemo } from 'react';

type Target = { id: string; lat: number; lng: number };

type Anim = {
  lat: number;
  lng: number;
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  start: number;
  dur: number;
};

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function haversineM(aLat: number, aLng: number, bLat: number, bLng: number) {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLng - aLng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function targetsKey(targets: Target[]) {
  return targets.map((t) => `${t.id}:${t.lat.toFixed(5)},${t.lng.toFixed(5)}`).join('|');
}

/**
 * Life360-style smooth marker motion between GPS samples.
 * RAF runs only while a pin is mid-lerp so navigation stays responsive.
 */
export function useSmoothCoordMap(targets: Target[], lerpMs = 1100): Map<string, { lat: number; lng: number }> {
  const anims = useRef(new Map<string, Anim>());
  const [, setDisplayTick] = useState(0);
  const [motionGen, setMotionGen] = useState(0);
  const key = useMemo(() => targetsKey(targets), [targets]);

  useEffect(() => {
    const now = performance.now();
    const seen = new Set<string>();
    let startedMotion = false;
    let structuralChange = false;

    for (const t of targets) {
      if (!Number.isFinite(t.lat) || !Number.isFinite(t.lng)) continue;
      seen.add(t.id);
      const prev = anims.current.get(t.id);
      if (!prev) {
        anims.current.set(t.id, {
          lat: t.lat,
          lng: t.lng,
          fromLat: t.lat,
          fromLng: t.lng,
          toLat: t.lat,
          toLng: t.lng,
          start: now,
          dur: 0,
        });
        structuralChange = true;
        continue;
      }
      const dist = haversineM(prev.toLat, prev.toLng, t.lat, t.lng);
      if (dist < 2) continue;
      if (dist > 1200) {
        anims.current.set(t.id, {
          lat: t.lat,
          lng: t.lng,
          fromLat: t.lat,
          fromLng: t.lng,
          toLat: t.lat,
          toLng: t.lng,
          start: now,
          dur: 0,
        });
        structuralChange = true;
        continue;
      }
      const dur = Math.min(lerpMs, Math.max(400, dist * 16));
      anims.current.set(t.id, {
        lat: prev.lat,
        lng: prev.lng,
        fromLat: prev.lat,
        fromLng: prev.lng,
        toLat: t.lat,
        toLng: t.lng,
        start: now,
        dur,
      });
      startedMotion = true;
    }

    for (const id of [...anims.current.keys()]) {
      if (!seen.has(id)) {
        anims.current.delete(id);
        structuralChange = true;
      }
    }

    if (structuralChange) setDisplayTick((n) => n + 1);
    if (startedMotion) setMotionGen((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by serialized GPS snapshot
  }, [key, lerpMs]);

  useEffect(() => {
    if (motionGen === 0) return;
    let raf = 0;
    let lastPublish = 0;
    let running = true;

    const loop = (now: number) => {
      if (!running) return;
      let moving = false;
      for (const a of anims.current.values()) {
        if (a.dur <= 0) continue;
        const p = Math.min(1, (now - a.start) / a.dur);
        const e = easeInOut(p);
        a.lat = a.fromLat + (a.toLat - a.fromLat) * e;
        a.lng = a.fromLng + (a.toLng - a.fromLng) * e;
        if (p < 1) moving = true;
        else {
          a.dur = 0;
          a.lat = a.toLat;
          a.lng = a.toLng;
        }
      }
      if (moving) {
        if (now - lastPublish >= 40) {
          lastPublish = now;
          setDisplayTick((n) => n + 1);
        }
        raf = requestAnimationFrame(loop);
      } else {
        setDisplayTick((n) => n + 1);
      }
    };

    raf = requestAnimationFrame(loop);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
    };
  }, [motionGen]);

  const out = new Map<string, { lat: number; lng: number }>();
  for (const [id, a] of anims.current) {
    out.set(id, { lat: a.lat, lng: a.lng });
  }
  return out;
}
