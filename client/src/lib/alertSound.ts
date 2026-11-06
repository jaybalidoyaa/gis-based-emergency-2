/** Unlock + play notification tones by urgency (iOS/Safari need a prior user gesture). */

export type AlertTone = 'sos' | 'urgent' | 'assignment' | 'alert' | 'chat' | 'status' | 'info';

let audioCtx: AudioContext | null = null;
let unlocked = false;

function getCtx(): AudioContext | null {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtx) audioCtx = new Ctx();
    return audioCtx;
  } catch {
    return null;
  }
}

/** Call from any pointer/keydown so later alerts can play without a gesture. */
export function unlockAlertAudio() {
  if (unlocked) return;
  unlocked = true;
  const ctx = getCtx();
  if (!ctx) return;
  void ctx.resume().then(() => {
    try {
      const buf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      /* ignore */
    }
  });
}

function beep(
  ctx: AudioContext,
  freq: number,
  start: number,
  dur: number,
  gain = 0.22,
  type: OscillatorType = 'sawtooth'
) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(gain, ctx.currentTime + start);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
  o.connect(g);
  g.connect(ctx.destination);
  o.start(ctx.currentTime + start);
  o.stop(ctx.currentTime + start + dur + 0.05);
}

const VIBRATE: Record<AlertTone, number[]> = {
  sos: [300, 80, 300, 80, 300, 80, 500],
  urgent: [220, 70, 220, 70, 400],
  assignment: [200, 80, 200, 80, 320],
  alert: [180, 60, 180, 60, 180],
  chat: [70, 40, 90],
  status: [100],
  info: [50],
};

function playTonePattern(ctx: AudioContext, tone: AlertTone) {
  switch (tone) {
    case 'sos':
      // Rising siren-style burst
      beep(ctx, 720, 0, 0.14, 0.32);
      beep(ctx, 960, 0.16, 0.14, 0.32);
      beep(ctx, 720, 0.32, 0.14, 0.32);
      beep(ctx, 1100, 0.5, 0.28, 0.34);
      beep(ctx, 880, 0.82, 0.35, 0.3);
      break;
    case 'urgent':
      beep(ctx, 1040, 0, 0.12, 0.3);
      beep(ctx, 1040, 0.16, 0.12, 0.3);
      beep(ctx, 780, 0.36, 0.22, 0.28);
      beep(ctx, 1040, 0.64, 0.18, 0.3);
      break;
    case 'assignment':
      beep(ctx, 880, 0, 0.2, 0.28);
      beep(ctx, 1175, 0.25, 0.22, 0.28);
      beep(ctx, 988, 0.52, 0.35, 0.3);
      break;
    case 'alert':
      beep(ctx, 920, 0, 0.18, 0.26);
      beep(ctx, 690, 0.22, 0.2, 0.26);
      beep(ctx, 920, 0.46, 0.22, 0.26);
      break;
    case 'chat':
      beep(ctx, 1200, 0, 0.08, 0.14, 'sine');
      beep(ctx, 1500, 0.12, 0.1, 0.14, 'sine');
      break;
    case 'status':
      beep(ctx, 660, 0, 0.16, 0.16, 'triangle');
      beep(ctx, 880, 0.18, 0.2, 0.14, 'triangle');
      break;
    case 'info':
    default:
      beep(ctx, 740, 0, 0.12, 0.12, 'sine');
      break;
  }
  if (navigator.vibrate) navigator.vibrate(VIBRATE[tone] || VIBRATE.info);
}

/** Map DB notification fields → tone. */
export function toneFromNotification(n: { type?: string; priority?: string }): AlertTone {
  const t = (n.type || '').toLowerCase();
  const p = (n.priority || '').toLowerCase();
  if (t.includes('sos') || t.includes('emergency')) return 'sos';
  if (t.includes('chat') || t.includes('message')) return 'chat';
  if (t.includes('assignment') && !t.includes('declin')) return 'assignment';
  if (t.includes('status') || t.includes('update')) return 'status';
  if (t.includes('backup') || t.includes('declin') || p === 'critical') return 'urgent';
  if (p === 'urgent') return 'urgent';
  if (p === 'important' || t.includes('alert') || t.includes('reply')) return 'alert';
  return 'info';
}

export async function playNotificationTone(tone: AlertTone = 'alert') {
  unlockAlertAudio();
  const ctx = getCtx();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') await ctx.resume();
    playTonePattern(ctx, tone);
  } catch {
    /* autoplay blocked */
  }
}

/** @deprecated Prefer playNotificationTone('assignment') */
export async function playDispatchAlertSound() {
  return playNotificationTone('assignment');
}

export function showSystemNotification(
  title: string,
  body: string,
  opts?: { tag?: string; url?: string; requireInteraction?: boolean }
) {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, {
      body,
      tag: opts?.tag || 'brigada-alert',
      icon: '/logo.png',
      badge: '/logo.png',
      requireInteraction: opts?.requireInteraction ?? true,
      silent: false,
    });
    n.onclick = () => {
      window.focus();
      if (opts?.url) {
        try {
          window.location.assign(opts.url);
        } catch {
          /* ignore */
        }
      }
      n.close();
    };
  } catch {
    /* Safari may throw if not from gesture / not installed PWA */
  }
}
