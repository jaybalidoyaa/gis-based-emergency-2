const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

(async () => {
  const root = path.join(__dirname, '..');
  const src = path.join(root, 'client', 'public', 'logo.png');
  const outTs = path.join(root, 'worker', 'lib', 'brandLogo.ts');

  // Key out near-black / dark navy background so the emblem sits on white paper.
  const { data, info } = await sharp(src)
    .ensureAlpha()
    .resize(128, 128, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const px = Buffer.from(data);
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    const a = px[i + 3];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    // Dark/near-black backdrop (low luminance, low chroma) → transparent
    if (a > 0 && max < 42 && max - min < 18) {
      px[i + 3] = 0;
    }
  }

  const buf = await sharp(px, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();

  const b64 = buf.toString('base64');
  const srcOut = `/** Compact JPEG of /logo.png for PDF headers (white background, no native deps at runtime). */
export const BRAND_LOGO_JPEG_BASE64 = '${b64}';
export const BRAND_LOGO_WIDTH = 128;
export const BRAND_LOGO_HEIGHT = 128;

export function brandLogoJpegBytes(): Uint8Array {
  const bin = atob(BRAND_LOGO_JPEG_BASE64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}
`;
  fs.writeFileSync(outTs, srcOut);
  console.log('wrote', outTs, 'jpegBytes=', buf.length);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
