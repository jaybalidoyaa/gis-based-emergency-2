import { describe, expect, it } from 'vitest';
import { buildOperationsPdf, manilaYmd } from './pdf';

describe('manilaYmd', () => {
  it('returns YYYY-MM-DD', () => {
    expect(manilaYmd(new Date('2026-09-03T20:00:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('uses Asia/Manila calendar (UTC evening can be next Manila day)', () => {
    expect(manilaYmd(new Date('2026-09-03T20:00:00Z'))).toBe('2026-09-04');
  });
});

describe('buildOperationsPdf', () => {
  it('emits a formal multi-page PDF with table and letterhead', () => {
    const bytes = buildOperationsPdf({
      orgName: 'Brigada Onse SVFAR / Barangay Sun Valley BDRRMO',
      title: 'Incident Report',
      reportNo: 'RPT-TEST',
      generatedLabel: 'Sep 4, 2026',
      filtersLine: 'type=incident',
      columns: ['ID', 'Type', 'Priority', 'Status', 'Reported'],
      rows: Array.from({ length: 60 }, (_, i) => [
        `INC-${i}`,
        'Medical Emergency',
        'High',
        'Resolved',
        '2026-09-04 10:00:00',
      ]),
    });
    const text = new TextDecoder().decode(bytes);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('REPUBLIC OF THE PHILIPPINES');
    expect(text).toContain('INCIDENT REPORT');
    expect(text).toContain('Page 1 of');
    expect(text).toContain('Prepared / Released by');
    expect(text).toContain('/Times-Bold');
    expect(text).toContain('/Helvetica-Bold');
    expect(text).toContain('/DCTDecode');
    expect(text).toContain('/Im1');
    // Table drawing uses rectangle path operators
    expect(text).toMatch(/\bre\b/);
  });

  it('can omit logo when requested', () => {
    const bytes = buildOperationsPdf({
      orgName: 'Brigada Onse SVFAR',
      title: 'Incident Report',
      reportNo: 'RPT-TEST',
      generatedLabel: 'Sep 4, 2026',
      filtersLine: 'type=incident',
      columns: ['ID', 'Status'],
      rows: [['INC-1', 'Open']],
      includeLogo: false,
    });
    const text = new TextDecoder().decode(bytes);
    expect(text).not.toContain('/DCTDecode');
    expect(text).toContain('Document Control');
  });
});
