import {
  aggregateGeneralReport,
  type GeneralReportAssessment,
} from './general-report.aggregator';

const profile = { age: 72, gender: 'feminino', schoolingBand: '1_4_anos' };

function assessment(
  overrides: Partial<GeneralReportAssessment> & {
    patientId: string;
    instrumentCode: string;
    rawValue: number;
    classificationCode: string;
  },
): GeneralReportAssessment {
  const { rawValue, classificationCode, ...rest } = overrides;
  return {
    therapistId: 'therapist-1',
    finalizedAt: new Date('2026-08-01T12:00:00Z'),
    schoolingBandUsed: null,
    payload: {},
    patient: profile,
    result: { rawValue, classificationCode },
    ...rest,
  };
}

const berg = (
  patientId: string,
  rawValue: number,
  code: string,
  date?: string,
) =>
  assessment({
    patientId,
    instrumentCode: 'BERG',
    rawValue,
    classificationCode: code,
    ...(date ? { finalizedAt: new Date(date) } : {}),
  });

describe('aggregateGeneralReport', () => {
  it('conta cada paciente uma vez por instrumento, pela avaliação mais recente', () => {
    const result = aggregateGeneralReport([
      berg('p1', 15, 'BERG_SEVERE', '2026-08-01T12:00:00Z'),
      berg('p1', 45, 'BERG_LOW', '2026-09-01T12:00:00Z'),
      berg('p1', 30, 'BERG_MODERATE', '2026-07-01T12:00:00Z'),
    ]);

    expect(result.patientsServed).toBe(1);
    expect(result.assessmentsPerformed).toBe(3);
    expect(result.berg.evaluated).toBe(1);
    expect(result.berg.highlightedCount).toBe(0);
    expect(result.berg.stats).toEqual({ mean: 45, min: 45, max: 45 });
  });

  it('destaca só a faixa mais grave do Berg (0–20)', () => {
    const result = aggregateGeneralReport([
      berg('p1', 15, 'BERG_SEVERE'),
      berg('p2', 30, 'BERG_MODERATE'),
      berg('p3', 50, 'BERG_LOW'),
      berg('p4', 40, 'BERG_MODERATE'),
    ]);

    expect(result.berg.highlightedCount).toBe(1);
    expect(result.berg.rows.map((row) => [row.count, row.percent])).toEqual([
      [1, 25],
      [2, 50],
      [1, 25],
    ]);
    expect(result.berg.rows.map((row) => row.highlighted)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('calcula perfil por pacientes distintos e mostra faixas opcionais só com dados', () => {
    const result = aggregateGeneralReport([
      berg('p1', 50, 'BERG_LOW'),
      assessment({
        patientId: 'p1',
        instrumentCode: 'TUG',
        rawValue: 8,
        classificationCode: 'TUG_EXCELLENT',
        therapistId: 'therapist-2',
      }),
      assessment({
        patientId: 'p2',
        instrumentCode: 'BERG',
        rawValue: 50,
        classificationCode: 'BERG_LOW',
        patient: { age: 58, gender: 'outro', schoolingBand: null },
      }),
    ]);

    expect(result.evaluators).toBe(2);
    expect(result.meanAge).toBe(65);
    expect(result.gender.map((row) => [row.label, row.count])).toEqual([
      ['Feminino', 1],
      ['Masculino', 0],
      ['Outro', 1],
    ]);
    expect(result.ageBands.map((row) => row.label)).toContain(
      'Menos de 60 anos',
    );
    expect(result.schooling.at(-1)).toMatchObject({
      label: 'Não informada',
      count: 1,
    });
    expect(result.byInstrument[0]).toMatchObject({
      label: 'Escala de Equilíbrio de Berg',
      count: 2,
      percent: 100,
    });
  });

  it('omite faixas opcionais sem pacientes', () => {
    const result = aggregateGeneralReport([berg('p1', 50, 'BERG_LOW')]);

    expect(result.gender.map((row) => row.label)).toEqual([
      'Feminino',
      'Masculino',
    ]);
    expect(result.ageBands.map((row) => row.label)).not.toContain(
      'Menos de 60 anos',
    );
    expect(result.schooling.map((row) => row.label)).not.toContain(
      'Não informada',
    );
  });

  it('distribui MEEM abaixo do corte pela escolaridade da sessão', () => {
    const meem = (patientId: string, band: string, code: string) =>
      assessment({
        patientId,
        instrumentCode: 'MEEM',
        rawValue: 18,
        classificationCode: code,
        schoolingBandUsed: band,
      });

    const result = aggregateGeneralReport([
      meem('p1', '5_8_anos', 'MEEM_BELOW_CUTOFF'),
      meem('p2', '5_8_anos', 'MEEM_BELOW_CUTOFF'),
      meem('p3', 'analfabeto', 'MEEM_ABOVE_CUTOFF'),
    ]);

    expect(result.meem.highlightedCount).toBe(2);
    expect(
      result.meem.belowCutoffBySchooling.find((row) => row.count > 0),
    ).toMatchObject({
      label: '5 a 8 anos (corte 26,5)',
      count: 2,
      percent: 100,
    });
  });

  it('Katz: destaca estrato ≥ 1 e ordena atividades por "dependente" (assistência não conta)', () => {
    const katz = (
      patientId: string,
      rawValue: number,
      payload: Record<string, string>,
    ) =>
      assessment({
        patientId,
        instrumentCode: 'KATZ',
        rawValue,
        classificationCode: `KATZ_STRATUM_${rawValue}`,
        payload: payload,
      });

    const result = aggregateGeneralReport([
      katz('p1', 0, { katz_1: 'assistencia' }),
      katz('p2', 2, { katz_1: 'dependente', katz_5: 'dependente' }),
      katz('p3', 1, { katz_5: 'dependente' }),
    ]);

    expect(result.katz.highlightedCount).toBe(2);
    expect(result.katz.rows.map((row) => row.count)).toEqual([
      1, 1, 1, 0, 0, 0, 0,
    ]);
    expect(result.katz.topDependentActivities).toEqual([
      { label: 'Continência', count: 2 },
      { label: 'Tomar banho', count: 1 },
    ]);
  });

  it('cruzamentos consideram só quem fez os dois instrumentos', () => {
    const meem = (patientId: string, code: string) =>
      assessment({
        patientId,
        instrumentCode: 'MEEM',
        rawValue: 18,
        classificationCode: code,
      });

    const result = aggregateGeneralReport([
      berg('p1', 15, 'BERG_SEVERE'),
      meem('p1', 'MEEM_BELOW_CUTOFF'),
      berg('p2', 15, 'BERG_SEVERE'),
      meem('p2', 'MEEM_ABOVE_CUTOFF'),
      berg('p3', 15, 'BERG_SEVERE'),
    ]);

    expect(result.crossings[0]).toMatchObject({
      affected: 1,
      evaluatedInBoth: 2,
    });
    expect(result.crossings[1]).toMatchObject({
      affected: 0,
      evaluatedInBoth: 0,
    });
  });

  it('não expõe identificadores de paciente no resultado', () => {
    const result = aggregateGeneralReport([
      berg('patient-secret', 15, 'BERG_SEVERE'),
    ]);

    expect(JSON.stringify(result)).not.toContain('patient-secret');
  });
});
