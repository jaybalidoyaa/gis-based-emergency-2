/** Formal multi-page operations PDF for Cloudflare Workers (no native deps). */

import { brandLogoJpegBytes, BRAND_LOGO_WIDTH, BRAND_LOGO_HEIGHT } from './brandLogo';

function escapePdfText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function sanitize(value: string, max = 120): string {
  const cleaned = value.replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 3)}...` : cleaned;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** Approximate string width in PDF points for Helvetica/Times at given size. */
function textWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.48;
}

function fitText(text: string, maxWidth: number, fontSize: number): string {
  const clean = sanitize(text, 200);
  if (textWidth(clean, fontSize) <= maxWidth) return clean;
  let out = clean;
  while (out.length > 3 && textWidth(`${out}...`, fontSize) > maxWidth) out = out.slice(0, -1);
  return `${out}...`;
}

export interface PdfReportInput {
  orgName: string;
  title: string;
  reportNo: string;
  generatedLabel: string;
  filtersLine: string;
  columns: string[];
  rows: string[][];
  footerNote?: string;
  includeLogo?: boolean;
}

function columnWidths(colCount: number, tableWidth: number): number[] {
  if (colCount <= 0) return [tableWidth];
  // Prefer slightly wider first/last columns (IDs / timestamps) when possible
  if (colCount === 1) return [tableWidth];
  if (colCount === 2) return [tableWidth * 0.38, tableWidth * 0.62];
  if (colCount === 3) return [tableWidth * 0.28, tableWidth * 0.36, tableWidth * 0.36];
  if (colCount === 4) return [tableWidth * 0.22, tableWidth * 0.34, tableWidth * 0.2, tableWidth * 0.24];
  if (colCount === 5) return [tableWidth * 0.18, tableWidth * 0.3, tableWidth * 0.14, tableWidth * 0.16, tableWidth * 0.22];
  const base = tableWidth / colCount;
  return Array.from({ length: colCount }, () => base);
}

/**
 * Builds a multi-page government-style PDF: letterhead, meta block,
 * bordered data table, page footers, and signature boxes.
 */
export function buildOperationsPdf(input: PdfReportInput): Uint8Array {
  const pageWidth = 612;
  const pageHeight = 792;
  const marginX = 36;
  const marginTop = 36;
  const marginBottom = 40;
  const tableWidth = pageWidth - marginX * 2;
  const includeLogo = input.includeLogo !== false;
  const logoJpeg = includeLogo ? brandLogoJpegBytes() : null;
  const logoSize = 52;

  const columns = input.columns.length ? input.columns : ['Record'];
  const colW = columnWidths(columns.length, tableWidth);
  const rowH = 16;
  const headerRowH = 18;
  const cellPad = 4;
  const tableFont = 8;
  const headerFont = 8;

  const letterheadBottom = pageHeight - marginTop - (includeLogo ? 70 : 58);
  const metaBlockH = 44;
  const tableTopY = letterheadBottom - 18 - metaBlockH - 14;
  const signatureReserve = 118;
  const usableBottom = marginBottom + 22;

  const rows = input.rows.length
    ? input.rows.map((r) => columns.map((_, i) => String(r[i] ?? '')))
    : [columns.map((_, i) => (i === 0 ? '(No detail rows)' : ''))];

  // Pack rows into pages (reserve signature space on last page only — estimate conservatively)
  const pages: string[][][] = [];
  let remaining = [...rows];
  while (remaining.length || !pages.length) {
    const isLastEstimate = remaining.length <= 40;
    const bottom = isLastEstimate ? usableBottom + signatureReserve : usableBottom;
    const avail = tableTopY - bottom - headerRowH;
    const maxRows = Math.max(1, Math.floor(avail / rowH));
    pages.push(remaining.splice(0, maxRows));
    if (!remaining.length) break;
  }

  // Re-pack if last page too full for signatures
  const last = pages[pages.length - 1];
  const lastAvail = tableTopY - (usableBottom + signatureReserve) - headerRowH;
  const lastMax = Math.max(1, Math.floor(lastAvail / rowH));
  if (last.length > lastMax) {
    const overflow = last.splice(lastMax);
    pages.push(overflow);
  }

  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0];
  let cursor = 0;

  const pushText = (s: string) => {
    const b = enc.encode(s);
    chunks.push(b);
    cursor += b.length;
  };
  const pushRaw = (b: Uint8Array) => {
    chunks.push(b);
    cursor += b.length;
  };
  const beginObj = (id: number) => {
    offsets[id] = cursor;
  };

  // Fonts: 3=Times-Roman, 4=Times-Bold, 5=Helvetica, 6=Helvetica-Bold; image=7 optional
  const imageId = logoJpeg ? 7 : 0;
  let nextId = logoJpeg ? 8 : 7;
  const pageObjectIds: number[] = [];
  const pageContent: { pageId: number; contentId: number; stream: Uint8Array }[] = [];

  const ops: string[] = [];
  const drawText = (
    font: string,
    size: number,
    x: number,
    y: number,
    text: string,
    color: 'black' | 'white' = 'black'
  ) => {
    const fill = color === 'white' ? '1 1 1 rg' : '0 0 0 rg';
    ops.push(
      fill,
      'BT',
      `/${font} ${size} Tf`,
      `1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm`,
      `(${escapePdfText(text)}) Tj`,
      'ET'
    );
  };
  const drawRect = (x: number, y: number, w: number, h: number, fill?: string, stroke = true) => {
    if (fill) {
      ops.push(fill, `${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re`, 'f');
    }
    if (stroke) {
      ops.push('0 0 0 RG', '0.6 w', `${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re`, 'S');
    }
  };
  const drawLine = (x1: number, y1: number, x2: number, y2: number, width = 0.8) => {
    ops.push('0 0 0 RG', `${width} w`, `${x1.toFixed(2)} ${y1.toFixed(2)} m`, `${x2.toFixed(2)} ${y2.toFixed(2)} l`, 'S');
  };

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    ops.length = 0;
    const pageId = nextId++;
    const contentId = nextId++;
    pageObjectIds.push(pageId);
    const pageRows = pages[pageIndex];
    const isLast = pageIndex === pages.length - 1;

    // --- Letterhead ---
    const headerY = pageHeight - marginTop;
    if (logoJpeg && imageId) {
      ops.push('q', `${logoSize} 0 0 ${logoSize} ${marginX} ${headerY - logoSize} cm`, '/Im1 Do', 'Q');
    }
    const textLeft = includeLogo ? marginX + logoSize + 12 : marginX;
    drawText('F2', 12, textLeft, headerY - 14, 'REPUBLIC OF THE PHILIPPINES');
    drawText('F2', 10, textLeft, headerY - 28, 'CITY OF PARANAQUE');
    drawText('F2', 9, textLeft, headerY - 42, sanitize(input.orgName, 70));
    drawText('F1', 8, textLeft, headerY - 54, 'Barangay Sun Valley - Emergency Dispatch & Responder Coordination');

    drawLine(marginX, letterheadBottom, pageWidth - marginX, letterheadBottom, 1.2);
    drawLine(marginX, letterheadBottom - 2.5, pageWidth - marginX, letterheadBottom - 2.5, 0.4);

    // --- Document title ---
    const title = sanitize(input.title.toUpperCase(), 60);
    const titleW = textWidth(title, 13);
    drawText('F2', 13, (pageWidth - titleW) / 2, letterheadBottom - 16, title);

    // --- Meta block ---
    const metaY = letterheadBottom - 22 - metaBlockH;
    drawRect(marginX, metaY, tableWidth, metaBlockH, '0.94 0.94 0.96 rg');
    const metaPad = 8;
    drawText('F4', 8, marginX + metaPad, metaY + metaBlockH - 14, 'Document Control');
    drawText('F1', 8, marginX + metaPad, metaY + metaBlockH - 26, `Reference No.: ${sanitize(input.reportNo, 40)}`);
    drawText('F1', 8, marginX + metaPad + 250, metaY + metaBlockH - 26, `Generated: ${sanitize(input.generatedLabel, 45)}`);
    drawText('F1', 8, marginX + metaPad, metaY + 10, `Scope / Filters: ${sanitize(input.filtersLine, 95)}`);

    // --- Table ---
    let y = tableTopY;
    // Header row
    drawRect(marginX, y - headerRowH, tableWidth, headerRowH, '0.15 0.22 0.32 rg', false);
    drawRect(marginX, y - headerRowH, tableWidth, headerRowH, undefined, true);
    let x = marginX;
    for (let c = 0; c < columns.length; c += 1) {
      const w = colW[c];
      if (c > 0) drawLine(x, y, x, y - headerRowH, 0.5);
      const label = fitText(columns[c].toUpperCase(), w - cellPad * 2, headerFont);
      drawText('F4', headerFont, x + cellPad, y - headerRowH + 5.5, label, 'white');
      x += w;
    }
    y -= headerRowH;

    for (let r = 0; r < pageRows.length; r += 1) {
      const fill = r % 2 === 0 ? '0.97 0.97 0.97 rg' : '1 1 1 rg';
      drawRect(marginX, y - rowH, tableWidth, rowH, fill, false);
      drawRect(marginX, y - rowH, tableWidth, rowH, undefined, true);
      x = marginX;
      for (let c = 0; c < columns.length; c += 1) {
        const w = colW[c];
        if (c > 0) drawLine(x, y, x, y - rowH, 0.4);
        const cell = fitText(pageRows[r][c] ?? '', w - cellPad * 2, tableFont);
        drawText('F3', tableFont, x + cellPad, y - rowH + 4.5, cell, 'black');
        x += w;
      }
      y -= rowH;
    }

    // Outer border emphasis
    const tableH = headerRowH + pageRows.length * rowH;
    ops.push('0 0 0 RG', '1.1 w', `${marginX} ${y} ${tableWidth} ${tableH} re`, 'S');

    // --- Signatures (last page) ---
    if (isLast) {
      const sigTop = Math.min(y - 20, usableBottom + signatureReserve - 8);
      drawText('F2', 9, marginX, sigTop, 'CERTIFICATION / AUTHORIZED SIGNATURES');
      drawText(
        'F1',
        7.5,
        marginX,
        sigTop - 12,
        sanitize(input.footerNote || 'This document is an official operations report of Barangay Sun Valley BDRRMO.', 100)
      );

      const boxW = (tableWidth - 16) / 2;
      const boxH = 72;
      const boxY = sigTop - 28 - boxH;
      drawRect(marginX, boxY, boxW, boxH);
      drawRect(marginX + boxW + 16, boxY, boxW, boxH);
      drawText('F4', 8, marginX + 8, boxY + boxH - 14, 'Prepared / Released by');
      drawText('F4', 8, marginX + boxW + 24, boxY + boxH - 14, 'Noted / Approved by');
      drawLine(marginX + 16, boxY + 28, marginX + boxW - 16, boxY + 28, 0.7);
      drawLine(marginX + boxW + 32, boxY + 28, marginX + tableWidth - 16, boxY + 28, 0.7);
      drawText('F1', 8, marginX + 8, boxY + 14, 'Dispatcher / Duty Officer');
      drawText('F1', 8, marginX + boxW + 24, boxY + 14, 'Chief / BDRRMO Officer');
      drawText('F1', 7.5, marginX, boxY - 14, `Date signed: ____________________     Report No. ${sanitize(input.reportNo, 30)}`);
    }

    // --- Page footer ---
    drawLine(marginX, marginBottom + 14, pageWidth - marginX, marginBottom + 14, 0.5);
    drawText('F1', 7, marginX, marginBottom + 4, 'Confidential - For official use only');
    const pageLabel = `Page ${pageIndex + 1} of ${pages.length}`;
    drawText('F1', 7, pageWidth - marginX - textWidth(pageLabel, 7), marginBottom + 4, pageLabel);

    pageContent.push({ pageId, contentId, stream: enc.encode(ops.join('\n')) });
  }

  pushText('%PDF-1.4\n');

  beginObj(1);
  pushText('1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n');

  beginObj(2);
  pushText(
    `2 0 obj<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageObjectIds.length} >>endobj\n`
  );

  beginObj(3);
  pushText('3 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>endobj\n');
  beginObj(4);
  pushText('4 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold >>endobj\n');
  beginObj(5);
  pushText('5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n');
  beginObj(6);
  pushText('6 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>endobj\n');

  if (logoJpeg && imageId) {
    beginObj(imageId);
    pushText(
      `${imageId} 0 obj<< /Type /XObject /Subtype /Image /Width ${BRAND_LOGO_WIDTH} /Height ${BRAND_LOGO_HEIGHT} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logoJpeg.length} >>stream\n`
    );
    pushRaw(logoJpeg);
    pushText('\nendstream\nendobj\n');
  }

  const fontRes = '/Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R >>';
  for (const pc of pageContent) {
    beginObj(pc.contentId);
    pushText(`${pc.contentId} 0 obj<< /Length ${pc.stream.length} >>stream\n`);
    pushRaw(pc.stream);
    pushText('\nendstream\nendobj\n');

    const xobj = imageId ? `/XObject << /Im1 ${imageId} 0 R >>` : '';
    beginObj(pc.pageId);
    pushText(
      `${pc.pageId} 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents ${pc.contentId} 0 R /Resources << ${fontRes} ${xobj} >> >>endobj\n`
    );
  }

  const xrefPos = cursor;
  const size = nextId;
  let xref = `xref\n0 ${size}\n`;
  xref += '0000000000 65535 f \n';
  for (let i = 1; i < size; i += 1) {
    xref += `${String(offsets[i] ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  pushText(xref);

  return concatBytes(chunks);
}

/** Asia/Manila calendar date as YYYY-MM-DD (ops timezone). */
export function manilaYmd(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
