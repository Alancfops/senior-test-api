export type GeneralReportCountRow = {
  label: string;
  count: number;
  /** Percentual (0–100) sobre a base da tabela. */
  percent: number;
  highlighted: boolean;
};

export type GeneralReportStats = {
  mean: number;
  min: number;
  max: number;
};

export type GeneralReportInstrumentSection = {
  evaluated: number;
  highlightedCount: number;
  rows: GeneralReportCountRow[];
  stats: GeneralReportStats | null;
};

export type GeneralReportCrossing = {
  label: string;
  /** Pacientes alterados nos dois instrumentos. */
  affected: number;
  /** Pacientes avaliados nos dois instrumentos. */
  evaluatedInBoth: number;
};

export type GeneralReportAggregate = {
  patientsServed: number;
  assessmentsPerformed: number;
  evaluators: number;
  meanAge: number;
  gender: GeneralReportCountRow[];
  ageBands: GeneralReportCountRow[];
  schooling: GeneralReportCountRow[];
  byInstrument: GeneralReportCountRow[];
  berg: GeneralReportInstrumentSection;
  tinetti: GeneralReportInstrumentSection;
  tug: GeneralReportInstrumentSection;
  meem: GeneralReportInstrumentSection & {
    belowCutoffBySchooling: GeneralReportCountRow[];
  };
  katz: GeneralReportInstrumentSection & {
    /** Até 3 atividades com mais pacientes "dependente". */
    topDependentActivities: { label: string; count: number }[];
  };
  crossings: GeneralReportCrossing[];
};

export type GeneralReportPdfData = {
  issuedByLabel: string;
  issuedAtDateLabel: string;
  periodLabel: string;
  aggregate: GeneralReportAggregate;
};
