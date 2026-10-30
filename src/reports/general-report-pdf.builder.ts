import { existsSync } from 'fs';
import PDFDocument from 'pdfkit';

import {
  contentWidth,
  drawDivider,
  renderFullRow,
  renderSectionTitle,
  resetCursorX,
} from './report-pdf.builder';
import {
  CESMAC_LOGO_PATH,
  REPORT_PDF_COLORS,
  REPORT_PDF_LAYOUT,
} from './report-pdf.constants';
import type {
  GeneralReportCountRow,
  GeneralReportInstrumentSection,
  GeneralReportPdfData,
} from './general-report.types';

type PdfDoc = InstanceType<typeof PDFDocument>;

const FOOTER_RESERVED_HEIGHT = 62;
const SECTION_TITLE_HEIGHT = 48;
const TABLE_HEADER_HEIGHT = 22;
const TABLE_ROW_HEIGHT = 20;
const TABLE_NOTE_HEIGHT = 18;
const ROW_LABEL_WIDTH = 190;
const NO_DATA_MESSAGE = 'Nenhuma avaliação no período.';

const FOOTER_TEXT =
  'Sênior Teste Funcional — Centro Universitário CESMAC · Dados agregados, sem identificação de pacientes';

/** Colunas relativas à margem esquerda, como no modelo aprovado pela professora. */
const TABLE_COLUMNS = {
  countRight: 267,
  percentRight: 317,
  barLeft: 327,
  columnWidth: 60,
} as const;

export async function buildGeneralReportPdf(
  data: GeneralReportPdfData,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      bufferPages: true,
      margins: {
        top: REPORT_PDF_LAYOUT.pageMargin,
        left: REPORT_PDF_LAYOUT.pageMargin,
        right: REPORT_PDF_LAYOUT.pageMargin,
        bottom: FOOTER_RESERVED_HEIGHT,
      },
      info: {
        Title: 'Relatório Geral de Atendimentos',
        Author: 'Sênior Teste Funcional',
        Subject: `Período: ${data.periodLabel}`,
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    renderReport(doc, data);
    renderFooters(doc);
    doc.end();
  });
}

function renderReport(doc: PdfDoc, data: GeneralReportPdfData): void {
  const { aggregate } = data;

  renderHeader(doc, data);

  renderSectionTitle(doc, '1. Parâmetros do relatório');
  renderFullRow(doc, 'Período analisado', data.periodLabel, ROW_LABEL_WIDTH);
  renderFullRow(doc, 'Alunos (avaliadores)', 'Todos', ROW_LABEL_WIDTH);
  renderFullRow(
    doc,
    'Regra de contagem',
    'Cada paciente é contado uma vez por instrumento, considerando a avaliação mais recente do período.',
    ROW_LABEL_WIDTH,
  );
  doc.moveDown(0.3);
  renderNote(
    doc,
    'As classificações de cada teste seguem os mesmos pontos de corte já usados no app e no relatório individual.',
  );

  renderSectionTitle(doc, '2. Visão geral dos atendimentos');
  renderCards(doc, [
    { value: String(aggregate.patientsServed), label: 'Pacientes atendidos' },
    {
      value: String(aggregate.assessmentsPerformed),
      label: 'Avaliações realizadas',
    },
    { value: String(aggregate.evaluators), label: 'Alunos avaliadores' },
    { value: formatDecimal(aggregate.meanAge), label: 'Idade média (anos)' },
  ]);

  renderSubtitle(doc, 'Perfil dos pacientes atendidos');
  renderTable(doc, 'Sexo', '%', aggregate.gender);
  renderTable(doc, 'Faixa etária', '%', aggregate.ageBands);
  renderTable(doc, 'Escolaridade', '%', aggregate.schooling);
  renderNote(
    doc,
    `Total de pacientes atendidos no período: ${aggregate.patientsServed}`,
  );

  ensureSpace(
    doc,
    tableHeight(aggregate.byInstrument.length) + TABLE_NOTE_HEIGHT + 24,
  );
  renderSubtitle(doc, 'Avaliações por instrumento');
  renderTable(doc, 'Instrumento', '% do total', aggregate.byInstrument);
  renderNote(
    doc,
    `Percentual sobre ${formatServedPatients(aggregate.patientsServed)}; um paciente pode ter feito mais de um instrumento.`,
  );

  renderBandSection(doc, '3. Equilíbrio — Escala de Equilíbrio de Berg', {
    section: aggregate.berg,
    finding: 'déficit de equilíbrio (pontuação de 0 a 20)',
    statsLabel: 'Pontuação média',
    formatStats: formatPointsStats,
  });

  renderBandSection(doc, '4. Equilíbrio e marcha — Tinetti (POMA)', {
    section: aggregate.tinetti,
    finding: 'alto risco de quedas (pontuação abaixo de 19)',
    statsLabel: 'Pontuação média',
    formatStats: formatPointsStats,
  });

  renderBandSection(doc, '5. Mobilidade — Timed Up and Go (TUG)', {
    section: aggregate.tug,
    finding: 'maior risco de quedas (média de 13,5 segundos ou mais)',
    statsLabel: 'Tempo médio',
    formatStats: formatSecondsStats,
  });

  renderMeemSection(doc, data);
  renderKatzSection(doc, data);
  renderCrossings(doc, data);
}

function renderHeader(doc: PdfDoc, data: GeneralReportPdfData): void {
  const margin = REPORT_PDF_LAYOUT.pageMargin;
  const width = contentWidth(doc);
  const headerTop = doc.y;
  const metaWidth = 176;
  const metaX = margin + width - metaWidth;
  const logoRowHeight = 46;

  if (existsSync(CESMAC_LOGO_PATH)) {
    doc.image(CESMAC_LOGO_PATH, margin, headerTop, {
      width: REPORT_PDF_LAYOUT.logoWidth,
    });
  }

  doc
    .roundedRect(metaX, headerTop, metaWidth, logoRowHeight + 28, 4)
    .lineWidth(0.75)
    .strokeColor(REPORT_PDF_COLORS.border)
    .stroke();

  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(REPORT_PDF_COLORS.muted)
    .text('Emitido por', metaX + 8, headerTop + 8, { width: metaWidth - 16 });

  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(REPORT_PDF_COLORS.text)
    .text(data.issuedByLabel, metaX + 8, headerTop + 22, {
      width: metaWidth - 16,
      height: 12,
      ellipsis: true,
    });

  doc
    .fontSize(8)
    .fillColor(REPORT_PDF_COLORS.muted)
    .text(
      `Data de emissão: ${data.issuedAtDateLabel}`,
      metaX + 8,
      headerTop + 38,
      { width: metaWidth - 16 },
    );

  doc.text(`Período: ${data.periodLabel}`, metaX + 8, headerTop + 50, {
    width: metaWidth - 16,
  });

  doc.x = margin;
  doc.y = headerTop + logoRowHeight + 30;

  doc
    .font('Helvetica-Bold')
    .fontSize(13)
    .fillColor(REPORT_PDF_COLORS.text)
    .text('Relatório Geral de Atendimentos', { width });

  doc.moveDown(0.25);

  doc
    .font('Helvetica')
    .fontSize(9.5)
    .fillColor(REPORT_PDF_COLORS.muted)
    .text('Sênior Teste Funcional — Clínica-escola de Fisioterapia', { width });

  doc.moveDown(0.15);

  doc
    .fontSize(9)
    .fillColor(REPORT_PDF_COLORS.light)
    .text('Centro Universitário CESMAC', { width });

  doc.moveDown(0.55);
  drawDivider(doc);
}

function renderCards(
  doc: PdfDoc,
  cards: { value: string; label: string }[],
): void {
  const gap = 8;
  const height = 57;
  const width = (contentWidth(doc) - gap * (cards.length - 1)) / cards.length;
  const top = doc.y;

  cards.forEach((card, index) => {
    const x = REPORT_PDF_LAYOUT.pageMargin + index * (width + gap);

    doc
      .roundedRect(x, top, width, height, 4)
      .lineWidth(0.75)
      .fillAndStroke(REPORT_PDF_COLORS.panelBg, REPORT_PDF_COLORS.border);

    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .fillColor(REPORT_PDF_COLORS.text)
      .text(card.value, x + 8, top + 9, {
        width: width - 16,
        lineBreak: false,
      });

    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(REPORT_PDF_COLORS.muted)
      .text(card.label, x + 8, top + 32, { width: width - 16 });
  });

  doc.y = top + height + 10;
  resetCursorX(doc);
}

function renderBandSection(
  doc: PdfDoc,
  title: string,
  options: {
    section: GeneralReportInstrumentSection;
    finding: string;
    statsLabel: string;
    formatStats: (
      stats: NonNullable<GeneralReportInstrumentSection['stats']>,
    ) => string;
  },
): void {
  const { section, finding, statsLabel, formatStats } = options;

  if (!renderSectionStart(doc, title, section, finding, 26)) return;

  renderTable(doc, 'Classificação', '%', section.rows);
  renderNote(
    doc,
    `Total de pacientes avaliados no instrumento: ${section.evaluated}`,
  );

  if (section.stats) {
    renderFullRow(doc, statsLabel, formatStats(section.stats), ROW_LABEL_WIDTH);
  }
}

function renderMeemSection(doc: PdfDoc, data: GeneralReportPdfData): void {
  const { meem } = data.aggregate;
  const finding =
    'pontuação sugestiva de comprometimento cognitivo (abaixo do ponto de corte de Brucki et al., 2003, para a escolaridade)';

  if (
    !renderSectionStart(
      doc,
      '6. Cognição — Mini-Exame do Estado Mental (MEEM)',
      meem,
      finding,
      0,
    )
  ) {
    return;
  }

  renderTable(doc, 'Classificação', '%', meem.rows);
  renderNote(
    doc,
    `Total de pacientes avaliados no instrumento: ${meem.evaluated}`,
  );

  if (meem.highlightedCount > 0) {
    ensureSpace(
      doc,
      tableHeight(meem.belowCutoffBySchooling.length) + TABLE_NOTE_HEIGHT + 24,
    );
    renderSubtitle(doc, 'Pacientes abaixo do ponto de corte, por escolaridade');
    renderTable(
      doc,
      'Escolaridade',
      `% dos ${meem.highlightedCount}`,
      meem.belowCutoffBySchooling,
    );
    renderNote(
      doc,
      `Distribuição de ${formatPatients(meem.highlightedCount)} abaixo do ponto de corte.`,
    );
  }

  if (meem.stats) {
    renderFullRow(
      doc,
      'Pontuação média',
      formatPointsStats(meem.stats),
      ROW_LABEL_WIDTH,
    );
  }
}

function renderKatzSection(doc: PdfDoc, data: GeneralReportPdfData): void {
  const { katz } = data.aggregate;
  const finding =
    'dependência em pelo menos uma atividade básica de vida diária';

  if (
    !renderSectionStart(
      doc,
      '7. Capacidade funcional — Índice de Katz',
      katz,
      finding,
      26,
    )
  ) {
    return;
  }

  renderTable(doc, 'Classificação', '%', katz.rows);
  renderNote(
    doc,
    `Total de pacientes avaliados no instrumento: ${katz.evaluated}`,
  );

  if (katz.topDependentActivities.length > 0) {
    renderFullRow(
      doc,
      'Atividades mais comprometidas',
      katz.topDependentActivities
        .map((activity, index) =>
          index === 0
            ? `${activity.label} (${formatPatients(activity.count)})`
            : `${activity.label} (${activity.count})`,
        )
        .join(', '),
      ROW_LABEL_WIDTH,
    );
  }
}

function renderCrossings(doc: PdfDoc, data: GeneralReportPdfData): void {
  ensureSpace(doc, SECTION_TITLE_HEIGHT + 120);
  renderSectionTitle(doc, '8. Cruzamentos');

  for (const crossing of data.aggregate.crossings) {
    const value =
      crossing.evaluatedInBoth === 0
        ? 'Nenhum paciente avaliado nos dois instrumentos'
        : `${formatPatients(crossing.affected)} (avaliados nos dois instrumentos: ${crossing.evaluatedInBoth})`;
    renderFullRow(doc, crossing.label, value, ROW_LABEL_WIDTH);
  }

  renderNote(
    doc,
    'Os cruzamentos só consideram pacientes que fizeram os dois instrumentos no período.',
  );
}

/**
 * Título + frase de destaque, mantidos junto da tabela principal.
 * Retorna `false` quando o teste não tem dados (seção fica só com o aviso).
 */
function renderSectionStart(
  doc: PdfDoc,
  title: string,
  section: GeneralReportInstrumentSection,
  finding: string,
  extraHeight: number,
): boolean {
  if (section.evaluated === 0) {
    ensureSpace(doc, SECTION_TITLE_HEIGHT + 24);
    renderSectionTitle(doc, title);
    renderNote(doc, NO_DATA_MESSAGE);
    return false;
  }

  const headline = buildHeadline(section, finding);
  ensureSpace(
    doc,
    SECTION_TITLE_HEIGHT +
      headlineHeight(doc, headline) +
      tableHeight(section.rows.length) +
      TABLE_NOTE_HEIGHT +
      extraHeight,
  );
  renderSectionTitle(doc, title);
  renderHeadline(doc, headline);
  return true;
}

function buildHeadline(
  section: GeneralReportInstrumentSection,
  finding: string,
): string {
  const { highlightedCount, evaluated } = section;
  const evaluatedLabel =
    evaluated === 1 ? 'paciente avaliado' : 'pacientes avaliados';
  const verb = highlightedCount <= 1 ? 'apresentou' : 'apresentaram';
  const percent = evaluated > 0 ? (highlightedCount / evaluated) * 100 : 0;

  return `${highlightedCount} de ${evaluated} ${evaluatedLabel} (${formatPercent(percent)}) ${verb} ${finding}.`;
}

function headlineTextHeight(doc: PdfDoc, text: string): number {
  doc.font('Helvetica-Bold').fontSize(9.5);
  return doc.heightOfString(text, {
    width: contentWidth(doc) - 28,
    lineGap: 2,
  });
}

function headlineHeight(doc: PdfDoc, text: string): number {
  return headlineTextHeight(doc, text) + 28;
}

function renderHeadline(doc: PdfDoc, text: string): void {
  resetCursorX(doc);
  const x = doc.x;
  const top = doc.y;
  const boxHeight = headlineTextHeight(doc, text) + 18;
  const width = contentWidth(doc);

  doc.rect(x, top, width, boxHeight).fill(REPORT_PDF_COLORS.panelBg);
  doc.rect(x, top, 3, boxHeight).fill(REPORT_PDF_COLORS.chartLine);

  doc
    .font('Helvetica-Bold')
    .fontSize(9.5)
    .fillColor(REPORT_PDF_COLORS.text)
    .text(text, x + 14, top + 9, { width: width - 28, lineGap: 2 });

  doc.y = top + boxHeight + 10;
  resetCursorX(doc);
}

function renderSubtitle(doc: PdfDoc, text: string): void {
  resetCursorX(doc);
  doc
    .font('Helvetica-Bold')
    .fontSize(9.5)
    .fillColor(REPORT_PDF_COLORS.muted)
    .text(text, { width: contentWidth(doc) });
  doc.moveDown(0.2);
}

function renderNote(doc: PdfDoc, text: string): void {
  resetCursorX(doc);
  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(REPORT_PDF_COLORS.light)
    .text(text, { width: contentWidth(doc), lineGap: 2 });
  doc.moveDown(0.7);
  resetCursorX(doc);
}

function renderTable(
  doc: PdfDoc,
  firstColumn: string,
  percentColumn: string,
  rows: GeneralReportCountRow[],
): void {
  ensureSpace(doc, tableHeight(rows.length));
  resetCursorX(doc);

  const margin = REPORT_PDF_LAYOUT.pageMargin;
  const width = contentWidth(doc);
  const headerY = doc.y;
  const maxCount = Math.max(...rows.map((row) => row.count), 1);

  doc.font('Helvetica-Bold').fontSize(8).fillColor(REPORT_PDF_COLORS.muted);
  doc.text(firstColumn, margin, headerY, { width: 200, lineBreak: false });
  renderRightAligned(doc, 'Pacientes', TABLE_COLUMNS.countRight, headerY);
  renderRightAligned(doc, percentColumn, TABLE_COLUMNS.percentRight, headerY);

  const lineY = headerY + 13;
  doc
    .strokeColor(REPORT_PDF_COLORS.border)
    .lineWidth(0.5)
    .moveTo(margin, lineY)
    .lineTo(margin + width, lineY)
    .stroke();

  rows.forEach((row, index) => {
    const rowY = lineY + 7 + index * TABLE_ROW_HEIGHT;
    const font = row.highlighted ? 'Helvetica-Bold' : 'Helvetica';

    doc.font(font).fontSize(9).fillColor(REPORT_PDF_COLORS.text);
    doc.text(row.label, margin, rowY, { width: 215, lineBreak: false });
    renderRightAligned(doc, String(row.count), TABLE_COLUMNS.countRight, rowY);
    renderRightAligned(
      doc,
      formatPercent(row.percent),
      TABLE_COLUMNS.percentRight,
      rowY,
    );

    const barX = margin + TABLE_COLUMNS.barLeft;
    const barWidth = width - TABLE_COLUMNS.barLeft;
    const barY = rowY - 1;
    const barHeight = 11;

    doc.rect(barX, barY, barWidth, barHeight).fill(REPORT_PDF_COLORS.panelBg);
    if (row.count > 0) {
      doc
        .rect(barX, barY, barWidth * (row.count / maxCount), barHeight)
        .fill(
          row.highlighted
            ? REPORT_PDF_COLORS.chartLine
            : REPORT_PDF_COLORS.barFill,
        );
    }
  });

  doc.y = lineY + 7 + rows.length * TABLE_ROW_HEIGHT;
  resetCursorX(doc);
}

function renderRightAligned(
  doc: PdfDoc,
  text: string,
  rightOffset: number,
  y: number,
): void {
  doc.text(
    text,
    REPORT_PDF_LAYOUT.pageMargin + rightOffset - TABLE_COLUMNS.columnWidth,
    y,
    { width: TABLE_COLUMNS.columnWidth, align: 'right', lineBreak: false },
  );
}

function renderFooters(doc: PdfDoc): void {
  const { start, count } = doc.bufferedPageRange();

  for (let index = start; index < start + count; index += 1) {
    doc.switchToPage(index);
    // Sem a margem inferior, escrever abaixo dela não abre página nova.
    doc.page.margins.bottom = 0;

    const margin = REPORT_PDF_LAYOUT.pageMargin;
    const width = contentWidth(doc);
    const lineY = doc.page.height - 50;

    doc
      .strokeColor(REPORT_PDF_COLORS.border)
      .lineWidth(0.75)
      .moveTo(margin, lineY)
      .lineTo(margin + width, lineY)
      .stroke();

    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(REPORT_PDF_COLORS.light)
      .text(
        `${FOOTER_TEXT} · Página ${index - start + 1} de ${count}`,
        margin,
        lineY + 6,
        { width, align: 'center', lineBreak: false },
      );
  }
}

function tableHeight(rowCount: number): number {
  return TABLE_HEADER_HEIGHT + rowCount * TABLE_ROW_HEIGHT;
}

function ensureSpace(doc: PdfDoc, requiredHeight: number): void {
  if (doc.y + requiredHeight > doc.page.height - FOOTER_RESERVED_HEIGHT) {
    doc.addPage();
    resetCursorX(doc);
  }
}

function formatPointsStats(stats: {
  mean: number;
  min: number;
  max: number;
}): string {
  return `${formatDecimal(stats.mean)} pontos (mín. ${formatScore(stats.min)} — máx. ${formatScore(stats.max)})`;
}

function formatSecondsStats(stats: {
  mean: number;
  min: number;
  max: number;
}): string {
  return `${formatDecimal(stats.mean)} segundos (mín. ${formatDecimal(stats.min)} — máx. ${formatDecimal(stats.max)})`;
}

function formatPatients(count: number): string {
  return `${count} ${count === 1 ? 'paciente' : 'pacientes'}`;
}

function formatServedPatients(count: number): string {
  return count === 1 ? '1 paciente atendido' : `${count} pacientes atendidos`;
}

function formatDecimal(value: number): string {
  return value.toFixed(1).replace('.', ',');
}

function formatPercent(value: number): string {
  return `${formatDecimal(value)}%`;
}

function formatScore(value: number): string {
  return String(value).replace('.', ',');
}
