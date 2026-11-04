import { existsSync } from 'fs';
import { join } from 'path';

/** Paleta neutra — relatório clínico (sem destaques azuis de produto). */
export const REPORT_PDF_COLORS = {
  text: '#222222',
  muted: '#555555',
  light: '#777777',
  border: '#CCCCCC',
  panelBg: '#F7F7F7',
  chartGrid: '#DDDDDD',
  chartLine: '#333333',
  chartHighlight: '#111111',
  warningBg: '#FAFAFA',
  barFill: '#B8B8B8',
} as const;

export const REPORT_PDF_LAYOUT = {
  pageMargin: 48,
  logoWidth: 112,
} as const;

export const REPORT_EVOLUTION_EMPTY_MESSAGE =
  'Sem dados suficientes para evolução: são necessárias pelo menos 2 avaliações do mesmo instrumento para exibir o gráfico de linha evolutiva.';

/** Legenda de leitura da curva — alinhada ao app (`chart-config.ts`). */
export const REPORT_CHART_IMPROVEMENT_HINT: Record<string, string> = {
  tug: 'Para TUG, queda da curva costuma indicar melhora (menos segundos).',
  katz: 'Para Katz, queda da curva costuma indicar melhora (menos domínios dependentes).',
  berg: 'Para Berg, subida da curva costuma indicar melhora.',
  tinetti: 'Para Tinetti, subida da curva costuma indicar melhora.',
  meem: 'Para MEEM, subida da curva costuma indicar melhora.',
};

const REPORTS_ASSETS_DIR = join(process.cwd(), 'assets', 'reports');

export const CESMAC_LOGO_PATH =
  [
    join(REPORTS_ASSETS_DIR, 'cesmac-logo.png'),
    join(REPORTS_ASSETS_DIR, 'cesmac-logo.jpeg'),
  ].find((candidate) => existsSync(candidate)) ??
  join(REPORTS_ASSETS_DIR, 'cesmac-logo.png');

export const SCHOOLING_LABELS: Record<string, string> = {
  analfabeto: 'Analfabeto',
  '1_4_anos': '1 a 4 anos de estudo',
  '5_8_anos': '5 a 8 anos de estudo',
  '9_11_anos': '9 a 11 anos de estudo',
  mais_11_anos: 'Mais de 11 anos de estudo',
};

export const GENDER_LABELS: Record<string, string> = {
  masculino: 'Masculino',
  feminino: 'Feminino',
  outro: 'Outro',
};

export function formatSchoolingLabel(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  return SCHOOLING_LABELS[value] ?? value;
}

export function formatGenderLabel(value: string): string {
  return GENDER_LABELS[value] ?? value;
}
