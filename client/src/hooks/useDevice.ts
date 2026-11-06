import { useMemo } from 'react';

export type DeviceType = 'ios' | 'android' | 'web';

function detectDevice(): DeviceType {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) && !(window as unknown as { MSStream?: unknown }).MSStream) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'web';
}

export function useDevice(): DeviceType {
  return useMemo(() => detectDevice(), []);
}
