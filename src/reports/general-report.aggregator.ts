import { Prisma } from '@prisma/client';

import { SCHOOLING_BAND_VALUES } from '../common/constants/schooling-band';
import { BRUCKI_CUTOFF } from '../scoring-rules';
import { GENDER_LABELS, SCHOOLING_LABELS } from './report-pdf.constants';
import { REPORT_INSTRUMENT_ITEMS } from './report-instrument-items.constants';
import type {
  GeneralReportAggregate,
  GeneralReportCountRow,
  GeneralReportCrossing,
  GeneralReportInstrumentSection,
} from './general-report.types';

export type GeneralReportAssessment = {
  patientId: string;
  therapistId: string;
  instrumentCode: string;
  finalizedAt: Date;
  schoolingBandUsed: string | null;
  payload: Prisma.JsonValue;
  result: {
    rawValue: Prisma.Decimal | number;
    classificationCode: string;
  };
  patient: {
    age: number;
    gender: string;
    schoolingBand: string | null;
  };
};

type LatestByPatient = Map<string, GeneralReportAssessment>;

const INSTRUMENT_NAMES: Record<string, string> = {
  BERG: 'Escala de Equilíbrio de Berg',
  MEEM: 'Mini-Exame do Estado Mental (MEEM)',
  TUG: 'Timed Up and Go (TUG)',
  KATZ: 'Índice de Katz',
  TINETTI: 'Tinetti (POMA)',
};

const BERG_DEFICIT = 'BERG_SEVERE';
const TINETTI_HIGH_RISK = 'TINETTI_HIGH';
const TUG_HIGH_RISK = 'TUG_HIGH_RISK';
const MEEM_BELOW_CUTOFF = 'MEEM_BELOW_CUTOFF';

const BERG_BANDS = [
  { code: BERG_DEFICIT, label: 'Prejuízo do equilíbrio (0–20)' },
  { code: 'BERG_MODERATE', label: 'Equilíbrio aceitável (21–40)' },
  { code: 'BERG_LOW', label: 'Bom equilíbrio (41–56)' },
];

const TINETTI_BANDS = [
  { code: TINETTI_HIGH_RISK, label: 'Alto risco de quedas (menos de 19)' },
  { code: 'TINETTI_MODERATE', label: 'Risco moderado de quedas (19–24)' },
  { code: 'TINETTI_LOW', label: 'Baixo risco de quedas (25–28)' },
];

const TUG_BANDS = [
  { code: 'TUG_EXCELLENT', label: 'Muito bom (abaixo de 10 s)' },
  { code: 'TUG_EXPECTED', label: 'Esperado (10 a 13,4 s)' },
  { code: TUG_HIGH_RISK, label: 'Maior risco de quedas (13,5 s ou mais)' },
];

const MEEM_BANDS = [
  { code: MEEM_BELOW_CUTOFF, label: 'Abaixo do ponto de corte' },
  { code: 'MEEM_ABOVE_CUTOFF', label: 'Igual ou acima do ponto de corte' },
];

const KATZ_STRATUM_ROW_LABELS = [
  'Independente em todas as atividades',
  'Dependente em 1 atividade',
  'Dependente em 2 atividades',
  'Dependente em 3 atividades',
  'Dependente em 4 atividades',
  'Dependente em 5 atividades',
  'Dependente em todas (6)',
];

/** Sem data de nascimento no cadastro: usa a idade registrada no paciente. */
const AGE_BANDS: { label: string; min: number; max: number }[] = [
  { label: 'Menos de 60 anos', min: 0, max: 59 },
  { label: '60 a 69 anos', min: 60, max: 69 },
  { label: '70 a 79 anos', min: 70, max: 79 },
  { label: '80 anos ou mais', min: 80, max: Number.POSITIVE_INFINITY },
];

const TOP_KATZ_ACTIVITIES = 3;

/**
 * Agrega avaliações finalizadas do período: conta cada paciente uma vez por
 * instrumento (avaliação mais recente) e nunca devolve dado identificável.
 */
export function aggregateGeneralReport(
  assessments: GeneralReportAssessment[],
): GeneralReportAggregate {
  const patients = new Map<string, GeneralReportAssessment['patient']>();
  const evaluators = new Set<string>();
  const latest = new Map<string, LatestByPatient>();

  for (const assessment of assessments) {
    patients.set(assessment.patientId, assessment.patient);
    evaluators.add(assessment.therapistId);

    const byPatient =
      latest.get(assessment.instrumentCode) ??
      new Map<string, GeneralReportAssessment>();
    const current = byPatient.get(assessment.patientId);
    if (!current || assessment.finalizedAt > current.finalizedAt) {
      byPatient.set(assessment.patientId, assessment);
    }
    latest.set(assessment.instrumentCode, byPatient);
  }

  const profiles = [...patients.values()];
  const patientsServed = profiles.length;
  const latestOf = (code: string): LatestByPatient =>
    latest.get(code) ?? new Map<string, GeneralReportAssessment>();

  const berg = latestOf('BERG');
  const tinetti = latestOf('TINETTI');
  const tug = latestOf('TUG');
  const meem = latestOf('MEEM');
  const katz = latestOf('KATZ');

  return {
    patientsServed,
    assessmentsPerformed: assessments.length,
    evaluators: evaluators.size,
    meanAge: mean(profiles.map((profile) => profile.age)),
    gender: buildGenderRows(profiles),
    ageBands: buildAgeRows(profiles),
    schooling: buildSchoolingRows(profiles),
    byInstrument: buildInstrumentRows(latest, patientsServed),
    berg: buildBandSection(berg, BERG_BANDS, [BERG_DEFICIT]),
    tinetti: buildBandSection(tinetti, TINETTI_BANDS, [TINETTI_HIGH_RISK]),
    tug: buildBandSection(tug, TUG_BANDS, [TUG_HIGH_RISK]),
    meem: {
      ...buildBandSection(meem, MEEM_BANDS, [MEEM_BELOW_CUTOFF]),
      belowCutoffBySchooling: buildBelowCutoffRows(meem),
    },
    katz: buildKatzSection(katz),
    crossings: [
      buildCrossing(
        'Déficit de equilíbrio (Berg) e comprometimento cognitivo (MEEM)',
        berg,
        meem,
        hasCode(BERG_DEFICIT),
        hasCode(MEEM_BELOW_CUTOFF),
      ),
      buildCrossing(
        'Déficit de equilíbrio (Berg) e maior risco de quedas (TUG)',
        berg,
        tug,
        hasCode(BERG_DEFICIT),
        hasCode(TUG_HIGH_RISK),
      ),
      buildCrossing(
        'Alto risco de quedas (Tinetti) e dependência (Katz)',
        tinetti,
        katz,
        hasCode(TINETTI_HIGH_RISK),
        isKatzDependent,
      ),
    ],
  };
}

function buildGenderRows(
  profiles: GeneralReportAssessment['patient'][],
): GeneralReportCountRow[] {
  const known = ['feminino', 'masculino'];
  const others = [...new Set(profiles.map((profile) => profile.gender))]
    .filter((gender) => !known.includes(gender))
    .sort();

  return [...known, ...others]
    .map((gender) => ({
      label: GENDER_LABELS[gender] ?? gender,
      count: profiles.filter((profile) => profile.gender === gender).length,
      optional: !known.includes(gender),
    }))
    .filter((row) => !row.optional || row.count > 0)
    .map((row) => toRow(row.label, row.count, profiles.length));
}

function buildAgeRows(
  profiles: GeneralReportAssessment['patient'][],
): GeneralReportCountRow[] {
  return AGE_BANDS.map((band) => ({
    label: band.label,
    count: profiles.filter(
      (profile) => profile.age >= band.min && profile.age <= band.max,
    ).length,
    optional: band.max < 60,
  }))
    .filter((row) => !row.optional || row.count > 0)
    .map((row) => toRow(row.label, row.count, profiles.length));
}

function buildSchoolingRows(
  profiles: GeneralReportAssessment['patient'][],
): GeneralReportCountRow[] {
  const rows = SCHOOLING_BAND_VALUES.map((band) =>
    toRow(
      SCHOOLING_LABELS[band],
      profiles.filter((profile) => profile.schoolingBand === band).length,
      profiles.length,
    ),
  );
  const missing = profiles.filter((profile) => !profile.schoolingBand).length;

  return missing > 0
    ? [...rows, toRow('Não informada', missing, profiles.length)]
    : rows;
}

function buildInstrumentRows(
  latest: Map<string, LatestByPatient>,
  patientsServed: number,
): GeneralReportCountRow[] {
  return Object.keys(INSTRUMENT_NAMES)
    .map((code) =>
      toRow(
        INSTRUMENT_NAMES[code],
        latest.get(code)?.size ?? 0,
        patientsServed,
      ),
    )
    .sort((a, b) => b.count - a.count);
}

function buildBandSection(
  latest: LatestByPatient,
  bands: { code: string; label: string }[],
  highlightedCodes: string[],
): GeneralReportInstrumentSection {
  const rows = [...latest.values()];
  const evaluated = rows.length;
  const countOf = (code: string) =>
    rows.filter((row) => row.result.classificationCode === code).length;

  return {
    evaluated,
    highlightedCount: highlightedCodes.reduce(
      (total, code) => total + countOf(code),
      0,
    ),
    rows: bands.map((band) =>
      toRow(
        band.label,
        countOf(band.code),
        evaluated,
        highlightedCodes.includes(band.code),
      ),
    ),
    stats: buildStats(rows),
  };
}

function buildBelowCutoffRows(
  latest: LatestByPatient,
): GeneralReportCountRow[] {
  const below = [...latest.values()].filter(hasCode(MEEM_BELOW_CUTOFF));

  return SCHOOLING_BAND_VALUES.map((band) =>
    toRow(
      `${shortSchoolingLabel(band)} (corte ${String(BRUCKI_CUTOFF[band]).replace('.', ',')})`,
      below.filter((row) => row.schoolingBandUsed === band).length,
      below.length,
      true,
    ),
  );
}

function shortSchoolingLabel(band: string): string {
  return SCHOOLING_LABELS[band].replace(' de estudo', '');
}

function buildKatzSection(
  latest: LatestByPatient,
): GeneralReportAggregate['katz'] {
  const rows = [...latest.values()];
  const evaluated = rows.length;
  const strata = rows.map(katzStratum);

  const topDependentActivities = (REPORT_INSTRUMENT_ITEMS.KATZ ?? [])
    .map((item) => ({
      label: item.label,
      count: rows.filter(
        (row) => asRecord(row.payload)[item.key] === 'dependente',
      ).length,
    }))
    .filter((activity) => activity.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_KATZ_ACTIVITIES);

  return {
    evaluated,
    highlightedCount: strata.filter((stratum) => stratum >= 1).length,
    rows: KATZ_STRATUM_ROW_LABELS.map((label, stratum) =>
      toRow(
        label,
        strata.filter((value) => value === stratum).length,
        evaluated,
        stratum >= 1,
      ),
    ),
    stats: null,
    topDependentActivities,
  };
}

function buildCrossing(
  label: string,
  first: LatestByPatient,
  second: LatestByPatient,
  firstAffected: (row: GeneralReportAssessment) => boolean,
  secondAffected: (row: GeneralReportAssessment) => boolean,
): GeneralReportCrossing {
  let affected = 0;
  let evaluatedInBoth = 0;

  for (const [patientId, row] of first) {
    const other = second.get(patientId);
    if (!other) continue;
    evaluatedInBoth += 1;
    if (firstAffected(row) && secondAffected(other)) {
      affected += 1;
    }
  }

  return { label, affected, evaluatedInBoth };
}

function hasCode(code: string) {
  return (row: GeneralReportAssessment) =>
    row.result.classificationCode === code;
}

function isKatzDependent(row: GeneralReportAssessment): boolean {
  return katzStratum(row) >= 1;
}

function katzStratum(row: GeneralReportAssessment): number {
  return Math.round(Number(row.result.rawValue));
}

function buildStats(
  rows: GeneralReportAssessment[],
): GeneralReportInstrumentSection['stats'] {
  if (rows.length === 0) return null;
  const values = rows.map((row) => Number(row.result.rawValue));
  return {
    mean: mean(values),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function toRow(
  label: string,
  count: number,
  base: number,
  highlighted = false,
): GeneralReportCountRow {
  return {
    label,
    count,
    percent: base > 0 ? (count / base) * 100 : 0,
    highlighted,
  };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function asRecord(value: Prisma.JsonValue): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value
    : {};
}
