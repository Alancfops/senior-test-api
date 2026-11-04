import { aggregateGeneralReport } from './general-report.aggregator';
import { buildGeneralReportPdf } from './general-report-pdf.builder';

describe('buildGeneralReportPdf', () => {
  it('gera PDF válido mesmo sem dados na maioria dos instrumentos', async () => {
    const buffer = await buildGeneralReportPdf({
      issuedByLabel: 'Prof(a). Exemplo',
      issuedAtDateLabel: '30/10/2026',
      periodLabel: '01/07/2026 a 30/10/2026',
      aggregate: aggregateGeneralReport([
        {
          patientId: 'p1',
          therapistId: 't1',
          instrumentCode: 'BERG',
          finalizedAt: new Date('2026-08-01T12:00:00Z'),
          schoolingBandUsed: null,
          payload: {},
          result: { rawValue: 15, classificationCode: 'BERG_SEVERE' },
          patient: { age: 72, gender: 'feminino', schoolingBand: null },
        },
      ]),
    });

    expect(buffer.subarray(0, 4).toString('utf8')).toBe('%PDF');
    expect(buffer.length).toBeGreaterThan(500);
  });
});
