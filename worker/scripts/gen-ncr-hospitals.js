/**
 * Build NCR hospital facility rows from Overpass OSM JSON.
 * Input: worker/data/ncr-hospitals-osm.json
 * Output: migrate-v12 SQL, ncr-hospitals.json, lib/ncrHospitals.ts
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const raw = JSON.parse(fs.readFileSync(path.join(root, 'data/ncr-hospitals-osm.json'), 'utf8'));

function slug(s) {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ñ/g, 'n')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

const skipRe =
  /veterinary|animal|pet clinic|dental clinic|optical|aesthetic|cosmetic/i;
const preferRe =
  /hospital|ospital|medical center|medical centre|medical city|infirmary|sanitarium|trauma|emergency|general hospital|district hospital|memorial/i;

const items = [];
for (const e of raw.elements || []) {
  const t = e.tags || {};
  const name = (t.name || t['name:en'] || '').trim();
  if (!name || name.length < 4) continue;
  if (skipRe.test(name)) continue;
  if (t.healthcare === 'veterinary') continue;
  const lat = e.lat ?? e.center?.lat;
  const lng = e.lon ?? e.center?.lon;
  if (lat == null || lng == null) continue;
  if (lat < 14.35 || lat > 14.8 || lng < 120.9 || lng > 121.15) continue;
  const city = t['addr:city'] || t['addr:municipality'] || '';
  const street = t['addr:street'] || '';
  const address = [street, city].filter(Boolean).join(', ') || city || 'Metro Manila (NCR)';
  const phoneRaw = t.phone || t['contact:phone'] || null;
  const phone = phoneRaw ? String(phoneRaw).replace(/[;\n\r]+/g, ' / ').trim() : null;
  items.push({
    name,
    lat: Math.round(lat * 1e6) / 1e6,
    lng: Math.round(lng * 1e6) / 1e6,
    address,
    phone,
    osm: `${e.type}/${e.id}`,
    score: preferRe.test(name) ? 2 : 1,
  });
}

const groups = new Map();
for (const it of items) {
  const key = `${it.name.toLowerCase()}|${it.lat.toFixed(3)}|${it.lng.toFixed(3)}`;
  const prev = groups.get(key);
  if (!prev || it.score > prev.score) groups.set(key, it);
}
let list = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));

const ops = [
  {
    id: 'fac-hospital-doctors',
    name: 'Parañaque Doctors Hospital',
    lat: 14.485753,
    lng: 121.028259,
    address: 'Parañaque City',
    phone: null,
  },
  {
    id: 'fac-ospital-d2',
    name: 'Ospital ng Parañaque District II',
    lat: 14.487723,
    lng: 121.024143,
    address: 'Parañaque City',
    phone: null,
  },
  {
    id: 'fac-ospital-d1',
    name: 'Ospital ng Parañaque District I',
    lat: 14.500476,
    lng: 120.991391,
    address: 'Parañaque City',
    phone: null,
  },
];

function near(a, b) {
  return Math.hypot(a.lat - b.lat, a.lng - b.lng) < 0.008;
}
function similar(a, b) {
  const na = a.toLowerCase();
  const nb = b.toLowerCase();
  return na.includes(nb.slice(0, 12)) || nb.includes(na.slice(0, 12)) || na === nb;
}

list = list.filter((h) => {
  for (const o of ops) {
    if (similar(h.name, o.name) || near(h, o)) return false;
  }
  return true;
});

const usedIds = new Set(ops.map((o) => o.id));
const hospitals = [
  ...ops.map((o) => ({
    ...o,
    operatingHours: '24/7 emergency',
    verificationSource: 'Ops coordinates 2026-09-05',
    lastVerifiedAt: '2026-09-05',
    verificationStatus: 'verified',
  })),
  ...list.map((h) => {
    let id = `fac-ncr-h-${slug(h.name)}`;
    let n = 2;
    while (usedIds.has(id)) {
      id = `fac-ncr-h-${slug(h.name)}-${n++}`;
    }
    usedIds.add(id);
    return {
      id,
      name: h.name,
      lat: h.lat,
      lng: h.lng,
      address: h.address,
      phone: h.phone,
      operatingHours: '24/7 emergency',
      verificationSource: `OpenStreetMap ${h.osm}`,
      lastVerifiedAt: '2026-09-06',
      verificationStatus: 'osm_import',
    };
  }),
];

function esc(s) {
  return String(s ?? '').replace(/'/g, "''");
}
function sqlVal(v) {
  if (v == null || v === '') return 'NULL';
  // Keep apply-sql.js statement splitter safe (no bare ';')
  return `'${esc(String(v).replace(/;/g, ','))}'`;
}

const BATCH = 25;
const batches = [];
for (let i = 0; i < hospitals.length; i += BATCH) {
  const chunk = hospitals.slice(i, i + BATCH);
  const values = chunk
    .map(
      (h) =>
        `(${sqlVal(h.id)}, ${sqlVal(h.name)}, 'Hospital', ${h.lat}, ${h.lng}, ${sqlVal(h.address)}, ${sqlVal(h.phone)}, ${sqlVal(h.operatingHours)}, ${sqlVal(h.verificationSource)}, ${sqlVal(h.lastVerifiedAt)}, ${sqlVal(h.verificationStatus)})`
    )
    .join(',\n  ');
  batches.push(
    `INSERT OR REPLACE INTO facilities (id, name, category, lat, lng, address, contact_number, operating_hours, verification_source, last_verified_at, verification_status) VALUES\n  ${values};`
  );
}

fs.writeFileSync(
  path.join(root, 'migrate-v12-ncr-hospitals.sql'),
  `-- NCR hospital pins from OpenStreetMap amenity=hospital (Metro Manila bbox)\n-- Ops-verified Parañaque hospitals retained.\n-- npm run db:migrate:v12\n\n${batches.join('\n\n')}\n`
);

fs.writeFileSync(path.join(root, 'data/ncr-hospitals.json'), JSON.stringify(hospitals, null, 2));

const rows = hospitals.map((h) => ({
  id: h.id,
  name: h.name,
  category: 'Hospital',
  lat: h.lat,
  lng: h.lng,
  address: h.address,
  contactNumber: h.phone,
  operatingHours: h.operatingHours,
  verificationSource: h.verificationSource,
  lastVerifiedAt: h.lastVerifiedAt,
  verificationStatus: h.verificationStatus,
}));

fs.writeFileSync(
  path.join(root, 'lib/ncrHospitals.ts'),
  `/** Auto-generated NCR hospitals (OSM + ops Parañaque). Regenerate via worker/scripts/gen-ncr-hospitals.js */\nexport const NCR_HOSPITALS = ${JSON.stringify(rows, null, 2)} as const;\n`
);

console.log(`hospitals=${hospitals.length}`);
console.log(hospitals.slice(0, 8).map((h) => h.name).join('\n'));
