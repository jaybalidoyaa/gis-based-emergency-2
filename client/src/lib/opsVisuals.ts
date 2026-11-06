import type { LucideIcon } from 'lucide-react';
import {
  Flame,
  HeartPulse,
  Ambulance,
  Car,
  Bandage,
  Truck,
  Droplets,
  LifeBuoy,
  AlertTriangle,
  Siren,
} from 'lucide-react';

export interface IncidentTypeVisual {
  icon: LucideIcon;
  label: string;
  colorClass: string;
}

/** Hex accents for Map Monitoring callouts / pins / route glow (Figma palette). */
export function getIncidentMonitorColor(typeName?: string | null, priority?: string | null): string {
  const t = (typeName ?? '').toLowerCase();
  if (t.includes('fire') || t.includes('alarm') || t.includes('structural')) return '#ef4444';
  if (t.includes('medical') || t.includes('ems') || t.includes('cardiac') || t.includes('illness') || t.includes('ambulance')) {
    return '#f97316';
  }
  if (t.includes('oil') || t.includes('spill') || t.includes('leak') || t.includes('hazmat') || t.includes('hazard')) {
    return '#eab308';
  }
  if (t.includes('flood') || t.includes('water') || t.includes('inundat')) return '#22c55e';
  if (t.includes('disturb') || t.includes('assault') || t.includes('crime') || t.includes('police') || t.includes('security')) {
    return '#3b82f6';
  }
  if (t.includes('rescue') || t.includes('trapped')) return '#38bdf8';
  if (t.includes('vehicular') || t.includes('vehicle') || t.includes('mva') || t.includes('traffic')) return '#f0c75e';
  if (priority === 'Critical' || priority === 'High') return '#ef4444';
  if (priority === 'Moderate') return '#f97316';
  return '#e8b84a';
}

export function getIncidentTypeVisual(typeName?: string | null): IncidentTypeVisual {
  const t = (typeName ?? '').toLowerCase();

  if (t.includes('fire') || t.includes('alarm') || t.includes('structural')) {
    return { icon: Flame, label: typeName || 'Fire', colorClass: 'text-alert-400 bg-alert-500/15' };
  }
  if (t.includes('medical') || t.includes('ems') || t.includes('cardiac') || t.includes('illness')) {
    return { icon: HeartPulse, label: typeName || 'Medical', colorClass: 'text-ok-400 bg-ok-500/15' };
  }
  if (t.includes('ambulance')) {
    return { icon: Ambulance, label: typeName || 'Ambulance', colorClass: 'text-ok-400 bg-ok-500/15' };
  }
  if (t.includes('vehicular') || t.includes('vehicle') || t.includes('mva') || t.includes('rta') || t.includes('traffic') || t.includes('road')) {
    return { icon: Car, label: typeName || 'Vehicular accident', colorClass: 'text-gold-400 bg-gold-500/15' };
  }
  if (t.includes('trauma') || t.includes('injury') || t.includes('wound')) {
    return { icon: Bandage, label: typeName || 'Trauma', colorClass: 'text-alert-400 bg-alert-500/15' };
  }
  if (t.includes('conduction') || t.includes('transport') || t.includes('patient')) {
    return { icon: Truck, label: typeName || 'Patient transport', colorClass: 'text-gold-400 bg-gold-500/15' };
  }
  if (t.includes('oil') || t.includes('spill') || t.includes('leak') || t.includes('hazmat') || t.includes('hazard')) {
    return { icon: Droplets, label: typeName || 'Hazmat / oil spill', colorClass: 'text-gold-400 bg-gold-500/15' };
  }
  if (t.includes('flood') || t.includes('inundat')) {
    return { icon: Droplets, label: typeName || 'Flood', colorClass: 'text-ok-400 bg-ok-500/15' };
  }
  if (t.includes('disturb') || t.includes('assault') || t.includes('crime')) {
    return { icon: AlertTriangle, label: typeName || 'Disturbance', colorClass: 'text-[#7aa2d4] bg-[#7aa2d4]/15' };
  }
  if (t.includes('rescue') || t.includes('trapped') || t.includes('water rescue')) {
    return { icon: LifeBuoy, label: typeName || 'Rescue', colorClass: 'text-[#7aa2d4] bg-[#7aa2d4]/15' };
  }
  if (t.includes('sos')) {
    return { icon: Siren, label: typeName || 'SOS', colorClass: 'text-alert-400 bg-alert-500/15' };
  }
  return { icon: AlertTriangle, label: typeName || 'Other emergency', colorClass: 'text-ink-300 bg-navy-700' };
}

/** Canonical unit operational status colors (map + cards + legend). */
export const UNIT_STATUS_META: Record<
  string,
  { color: string; label: string; textClass: string; bgClass: string }
> = {
  Available: { color: '#4fb87e', label: 'Available', textClass: 'text-ok-400', bgClass: 'bg-ok-500/15' },
  Ready: { color: '#4fb87e', label: 'Available', textClass: 'text-ok-400', bgClass: 'bg-ok-500/15' },
  'En Route': { color: '#f0c75e', label: 'En Route', textClass: 'text-gold-400', bgClass: 'bg-gold-500/15' },
  EnRoute: { color: '#f0c75e', label: 'En Route', textClass: 'text-gold-400', bgClass: 'bg-gold-500/15' },
  'On Scene': { color: '#d4453a', label: 'On Scene', textClass: 'text-alert-400', bgClass: 'bg-alert-500/15' },
  OnScene: { color: '#d4453a', label: 'On Scene', textClass: 'text-alert-400', bgClass: 'bg-alert-500/15' },
  Transporting: { color: '#c9842a', label: 'Transporting', textClass: 'text-gold-600', bgClass: 'bg-gold-500/10' },
  'Out of Service': { color: '#6b7280', label: 'Out of Service', textClass: 'text-ink-400', bgClass: 'bg-navy-700' },
  Assigned: { color: '#e8b84a', label: 'Assigned', textClass: 'text-gold-400', bgClass: 'bg-gold-500/15' },
  Dispatched: { color: '#e8b84a', label: 'Dispatched', textClass: 'text-gold-400', bgClass: 'bg-gold-500/15' },
  Deployed: { color: '#e8b84a', label: 'Deployed', textClass: 'text-gold-400', bgClass: 'bg-gold-500/15' },
  Returning: { color: '#7aa2d4', label: 'Returning', textClass: 'text-[#7aa2d4]', bgClass: 'bg-[#7aa2d4]/15' },
};

export function resolveUnitStatus(status?: string | null) {
  if (!status) return UNIT_STATUS_META['Out of Service'];
  return UNIT_STATUS_META[status] ?? {
    color: '#e8b84a',
    label: status,
    textClass: 'text-gold-400',
    bgClass: 'bg-gold-500/15',
  };
}

/** Map / list icon for unit vehicle type or callsign. */
export function getUnitTypeVisual(unit: {
  vehicleType?: string | null;
  unitNo?: string | null;
  callsign?: string | null;
}): { icon: 'fire' | 'ambulance' | 'rescue' | 'fleet' | 'generic'; label: string; color: string } {
  const hay = `${unit.vehicleType ?? ''} ${unit.unitNo ?? ''} ${unit.callsign ?? ''}`.toLowerCase();
  if (hay.includes('fire') || hay.includes('truck')) {
    return { icon: 'fire', label: unit.vehicleType || unit.unitNo || 'Fire unit', color: '#d4453a' };
  }
  if (hay.includes('ambulance') || hay.includes('ems') || hay.includes('medic')) {
    return { icon: 'ambulance', label: unit.vehicleType || unit.unitNo || 'Ambulance', color: '#4fb87e' };
  }
  if (hay.includes('rescue')) {
    return { icon: 'rescue', label: unit.vehicleType || unit.unitNo || 'Rescue', color: '#7aa2d4' };
  }
  return { icon: 'generic', label: unit.unitNo || unit.callsign || 'Unit', color: '#e8b84a' };
}

export const FACILITY_MARKER_META: Record<
  string,
  { color: string; label: string; icon: 'hospital' | 'health' | 'police' | 'fire' | 'hall' | 'school' | 'base' | 'hydrant' | 'water' | 'risk' | 'generic' }
> = {
  Hospital: { color: '#4fb87e', label: 'Hospital', icon: 'hospital' },
  'Health Center': { color: '#34d399', label: 'Health center', icon: 'health' },
  'Police Station': { color: '#7aa2d4', label: 'Police station', icon: 'police' },
  'Fire Station': { color: '#d4453a', label: 'Fire station', icon: 'fire' },
  'Barangay Hall': { color: '#e8b84a', label: 'Barangay hall', icon: 'hall' },
  'Evacuation Center': { color: '#c9842a', label: 'Evacuation / school', icon: 'school' },
  'Emergency Base': { color: '#f0c75e', label: 'Emergency base', icon: 'base' },
  'Fire Hydrant': { color: '#60a5fa', label: 'Fire hydrant', icon: 'hydrant' },
  'Water Source': { color: '#38bdf8', label: 'Water source', icon: 'water' },
  'High-Risk Area': { color: '#ef4444', label: 'High-risk area', icon: 'risk' },
};
