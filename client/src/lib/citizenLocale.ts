/** Critical citizen-facing strings. Filipino covers SOS + profile disclosure only — not full UI i18n. */

export type CitizenLang = 'en' | 'fil';

const SOS_FIL: Record<string, string> = {
  'Emergency SOS': 'Emergency SOS',
  'Calm, guided request — four short steps.': 'Tahimik at gabay na kahilingan — apat na maikling hakbang.',
  'False emergency reports are prohibited and may be referred to barangay authorities.':
    'Bawal ang pekeng emergency report; maaaring i-refer sa barangay.',
  'Choose emergency type': 'Piliin ang uri ng emergency',
  'Confirm your location': 'Kumpirmahin ang iyong lokasyon',
  'Hold the button about one second to send (mouse, touch, or Space/Enter). This prevents accidental taps without delaying a real emergency.':
    'Pindutin nang humigit-kumulang isang segundo (mouse, touch, o Space/Enter). Pinipigilan nito ang aksidenteng padala nang hindi naantala ang tunay na emergency.',
  'Emergency fallback': 'Backup kung hindi gumana ang app',
  'Emergency types unavailable': 'Walang emergency types',
  'Profile language: Filipino covers SOS and profile notes only. Most screens remain in English.':
    'Wika: Filipino sa SOS at profile notes lang. Karamihan ng screen ay English pa.',
};

export function citizenText(lang: CitizenLang | string | undefined, en: string): string {
  if (lang === 'fil' || lang === 'Filipino') return SOS_FIL[en] ?? en;
  return en;
}

export function isFilipinoLang(lang: string | undefined | null): boolean {
  return lang === 'fil' || lang === 'Filipino';
}
