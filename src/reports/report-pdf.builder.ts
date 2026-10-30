import { existsSync } from 'fs';
import PDFDocument from 'pdfkit';

import {
  CESMAC_LOGO_PATH,
  REPORT_CHART_IMPROVEMENT_HINT,
  REPORT_EVOLUTION_EMPTY_MESSAGE,
  REPORT_PDF_COLORS,
  REPORT_PDF_LAYOUT,
} from './report-pdf.constants';
import type { ReportPdfData, ReportTimeseriesPoint } from './report-pdf.types';

type PdfDoc = InstanceType<typeof PDFDocument>;

/** Título + assinatura/carimbo + rodapé — a seção 5 nunca é quebrada entre páginas. */
const SIGNATURE_SECTION_MIN_HEIGHT = 260;

export async function buildReportPdf(data: ReportPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: REPORT_PDF_LAYOUT.pageMargin,
      info: {
        Title: `Relatório de Avaliação Funcional — ${data.assessment.instrumentName}`,
        Author: data.therapistName,
        Subject: 'Sênior Teste Funcional — RF013',
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    renderReport(doc, data);
    doc.end();
  });
}

function renderReport(doc: PdfDoc, data: ReportPdfData): void {
  renderHeader(doc, data);
  renderSectionTitle(doc, '1. Identificação do paciente');
  renderPatientBlock(doc, data);
  renderSectionTitle(doc, '2. Dados da avaliação');
  renderAssessmentBlock(doc, data);
  renderSectionTitle(doc, '3. Interpretação clínica automática');
  renderInterpretationBlock(doc, data);
  renderSectionTitle(doc, '4. Gráfico de evolução clínica');
  renderEvolutionBlock(doc, data);
  ensureSpace(doc, SIGNATURE_SECTION_MIN_HEIGHT);
  renderSectionTitle(doc, '5. Área de assinatura e carimbo');
  renderSignatureBlock(doc, data);
  renderFooter(doc, data);
}

function renderHeader(doc: PdfDoc, data: ReportPdfData): void {
  const margin = REPORT_PDF_LAYOUT.pageMargin;
  const width = contentWidth(doc);
  const headerTop = doc.y;
  const metaWidth = 156;
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
    .text('Fisioterapeuta responsável', metaX + 8, headerTop + 8, {
      width: metaWidth - 16,
    });

  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(REPORT_PDF_COLORS.text)
    .text(`Dr(a). ${data.therapistName}`, metaX + 8, headerTop + 22, {
      width: metaWidth - 16,
    });

  doc
    .fontSize(8)
    .fillColor(REPORT_PDF_COLORS.muted)
    .text(
      `Data de emissão: ${data.issuedAtDateLabel}`,
      metaX + 8,
      headerTop + 38,
      {
        width: metaWidth - 16,
      },
    );

  doc.text(`Horário: ${data.issuedAtTimeLabel}`, metaX + 8, headerTop + 50, {
    width: metaWidth - 16,
  });

  const titleTop = headerTop + logoRowHeight + 6;

  doc.x = margin;
  doc.y = titleTop;

  doc
    .font('Helvetica-Bold')
    .fontSize(13)
    .fillColor(REPORT_PDF_COLORS.text)
    .text('Relatório de Avaliação Funcional', { width });

  doc.moveDown(0.25);

  doc
    .font('Helvetica')
    .fontSize(9.5)
    .fillColor(REPORT_PDF_COLORS.muted)
    .text('Sênior Teste Funcional', { width });

  doc.moveDown(0.15);

  doc
    .fontSize(9)
    .fillColor(REPORT_PDF_COLORS.light)
    .text('Centro Universitário CESMAC', { width });

  doc.moveDown(0.55);
  drawDivider(doc);
}

export function renderSectionTitle(doc: PdfDoc, title: string): void {
  ensureSpace(doc, 48);
  resetCursorX(doc);
  doc.moveDown(0.45);

  const titleY = doc.y;
  doc
    .font('Helvetica-Bold')
    .fontSize(10.5)
    .fillColor(REPORT_PDF_COLORS.text)
    .text(title.toUpperCase(), doc.x, titleY, { width: contentWidth(doc) });

  const lineY = titleY + 14;
  doc
    .strokeColor(REPORT_PDF_COLORS.border)
    .lineWidth(0.75)
    .moveTo(doc.x, lineY)
    .lineTo(doc.x + contentWidth(doc), lineY)
    .stroke();

  doc.y = lineY + 10;
}

function renderPatientBlock(doc: PdfDoc, data: ReportPdfData): void {
  renderFullRow(doc, 'Nome completo', data.patient.fullName);
  renderFullRow(doc, 'Idade', `${data.patient.age} anos`);
  renderFullRow(doc, 'Sexo', data.patient.genderLabel);

  if (data.patient.schoolingLabel) {
    renderFullRow(doc, 'Escolaridade', data.patient.schoolingLabel);
  }

  doc.moveDown(0.15);
}

function renderAssessmentBlock(doc: PdfDoc, data: ReportPdfData): void {
  const { assessment } = data;

  renderFullRow(doc, 'Instrumento', assessment.instrumentName);
  renderFullRow(
    doc,
    'Autores do protocolo',
    assessment.instrumentAuthors.join('; '),
  );
  renderFullRow(doc, 'Data da sessão', assessment.sessionDateLabel);
  renderFullRow(doc, 'Horário', assessment.sessionTimeLabel);
  renderFullRow(doc, 'Resultado bruto', assessment.rawLabel);

  if (assessment.notesObservation) {
    renderFullRow(doc, 'Observações', assessment.notesObservation);
  }

  doc.moveDown(0.15);
}

function renderInterpretationBlock(doc: PdfDoc, data: ReportPdfData): void {
  const { assessment } = data;

  doc
    .font('Helvetica-Bold')
    .fontSize(9.5)
    .fillColor(REPORT_PDF_COLORS.muted)
    .text('Classificação do resultado');

  doc.moveDown(0.35);
  renderFullRow(doc, 'Resultado obtido', assessment.resultDetailLabel);
  renderFullRow(doc, 'Classificação clínica', assessment.classificationLabel);
  renderFullRow(doc, 'Referência utilizada', assessment.referenceLabel);

  if (assessment.difficultyHighlight) {
    doc.moveDown(0.15);
    resetCursorX(doc);
    doc
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .fillColor(REPORT_PDF_COLORS.muted)
      .text('Foco clínico');

    doc.moveDown(0.25);
    resetCursorX(doc);
    doc
      .font('Helvetica')
      .fontSize(9.5)
      .fillColor(REPORT_PDF_COLORS.text)
      .text(assessment.difficultyHighlight, {
        width: contentWidth(doc),
        lineGap: 3,
      });
  }

  doc.moveDown(0.15);
  resetCursorX(doc);
  doc
    .font('Helvetica')
    .fontSize(9.5)
    .fillColor(REPORT_PDF_COLORS.text)
    .text(assessment.interpretation, { width: contentWidth(doc), lineGap: 3 });

  doc.moveDown(0.45);
}

function renderEvolutionBlock(doc: PdfDoc, data: ReportPdfData): void {
  const { evolution, patient, assessment } = data;
  const chartTitle = `Evolução — ${assessment.instrumentName} — ${patient.fullName}`;

  ensureSpace(doc, 210);
  resetCursorX(doc);

  doc
    .font('Helvetica-Bold')
    .fontSize(9.5)
    .fillColor(REPORT_PDF_COLORS.text)
    .text(chartTitle, { width: contentWidth(doc) });

  doc.moveDown(0.45);

  if (!evolution.canShowChart || evolution.points.length < 2) {
    const boxTop = doc.y;
    const boxHeight = 68;

    doc
      .rect(doc.x, boxTop, contentWidth(doc), boxHeight)
      .fillAndStroke(REPORT_PDF_COLORS.warningBg, REPORT_PDF_COLORS.border);

    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(REPORT_PDF_COLORS.muted)
      .text(REPORT_EVOLUTION_EMPTY_MESSAGE, doc.x + 12, boxTop + 16, {
        width: contentWidth(doc) - 24,
        lineGap: 2,
      });

    doc.y = boxTop + boxHeight + 8;
    return;
  }

  ensureSpace(doc, 168);
  resetCursorX(doc);
  renderEvolutionChart(doc, evolution.points, evolution.yAxisLabel);

  const chartLegend =
    evolution.improvementHint ??
    (evolution.instrumentCode
      ? REPORT_CHART_IMPROVEMENT_HINT[evolution.instrumentCode.toLowerCase()]
      : undefined);

  if (chartLegend) {
    doc.moveDown(0.55);
    resetCursorX(doc);
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(REPORT_PDF_COLORS.muted)
      .text(chartLegend, { width: contentWidth(doc), lineGap: 2 });
  }

  doc.moveDown(0.45);
}

function renderEvolutionChart(
  doc: PdfDoc,
  points: ReportTimeseriesPoint[],
  yAxisLabel: string,
): void {
  resetCursorX(doc);
  const chartX = doc.x;
  const chartY = doc.y;
  const chartWidth = contentWidth(doc);
  const chartHeight = 142;
  const paddingLeft = 34;
  const paddingRight = 10;
  const paddingTop = 14;
  const paddingBottom = 26;
  const plotWidth = chartWidth - paddingLeft - paddingRight;
  const plotHeight = chartHeight - paddingTop - paddingBottom;

  doc
    .rect(chartX, chartY, chartWidth, chartHeight)
    .lineWidth(0.75)
    .strokeColor(REPORT_PDF_COLORS.border)
    .stroke();

  const values = points.map((point) => point.rawValue);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const valueRange = maxValue - minValue || 1;
  const paddedMin = minValue - valueRange * 0.12;
  const paddedMax = maxValue + valueRange * 0.12;
  const plotRange = paddedMax - paddedMin;

  const plotLeft = chartX + paddingLeft;
  const plotTop = chartY + paddingTop;
  const plotBottom = plotTop + plotHeight;

  doc.save();
  doc.strokeColor(REPORT_PDF_COLORS.chartGrid).lineWidth(0.5);

  for (let index = 0; index <= 4; index += 1) {
    const y = plotTop + (plotHeight / 4) * index;
    doc
      .moveTo(plotLeft, y)
      .lineTo(plotLeft + plotWidth, y)
      .stroke();
  }

  doc.restore();

  doc.save();
  doc.rotate(-90, { origin: [chartX + 12, plotTop + plotHeight / 2] });
  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(REPORT_PDF_COLORS.light)
    .text(yAxisLabel, chartX + 12, plotTop + plotHeight / 2, {
      width: plotHeight,
      align: 'center',
    });
  doc.restore();

  const coordinates = points.map((point, index) => {
    const x =
      plotLeft +
      (points.length === 1
        ? plotWidth / 2
        : (plotWidth / (points.length - 1)) * index);
    const y =
      plotBottom - ((point.rawValue - paddedMin) / plotRange) * plotHeight;

    return { point, x, y };
  });

  doc.save();
  doc.strokeColor(REPORT_PDF_COLORS.chartLine).lineWidth(1.5);

  coordinates.forEach(({ x, y }, index) => {
    if (index === 0) {
      doc.moveTo(x, y);
      return;
    }

    doc.lineTo(x, y);
  });

  doc.stroke();
  doc.restore();

  coordinates.forEach(({ point, x, y }) => {
    const radius = point.isCurrent ? 4 : 3;
    const fill = point.isCurrent
      ? REPORT_PDF_COLORS.chartHighlight
      : REPORT_PDF_COLORS.chartLine;

    doc.circle(x, y, radius).fill(fill);

    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(REPORT_PDF_COLORS.text)
      .text(point.rawLabel, x - 16, y - 14, { width: 32, align: 'center' });

    doc
      .font('Helvetica')
      .fontSize(6.5)
      .fillColor(REPORT_PDF_COLORS.light)
      .text(point.dateLabel, x - 16, plotBottom + 5, {
        width: 32,
        align: 'center',
      });
  });

  doc.y = chartY + chartHeight + 2;
}

function renderSignatureBlock(doc: PdfDoc, data: ReportPdfData): void {
  ensureSpace(doc, 150);
  const columnGap = 20;
  const columnWidth = (contentWidth(doc) - columnGap) / 2;
  const leftX = doc.x;
  const rightX = leftX + columnWidth + columnGap;
  const blockTop = doc.y;

  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(REPORT_PDF_COLORS.muted)
    .text('Assinatura do fisioterapeuta', leftX, blockTop, {
      width: columnWidth,
    });

  doc.text('Local e data', rightX, blockTop, { width: columnWidth });

  const lineY = blockTop + 34;

  doc
    .strokeColor(REPORT_PDF_COLORS.text)
    .lineWidth(0.75)
    .moveTo(leftX, lineY)
    .lineTo(leftX + columnWidth, lineY)
    .stroke();

  doc
    .moveTo(rightX, lineY)
    .lineTo(rightX + columnWidth, lineY)
    .stroke();

  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(REPORT_PDF_COLORS.text)
    .text(data.therapistName, leftX, lineY + 10, { width: columnWidth });

  let leftBottom = lineY + 24;

  if (data.therapistCrefito) {
    doc
      .fontSize(8.5)
      .fillColor(REPORT_PDF_COLORS.muted)
      .text(`CREFITO: ${data.therapistCrefito}`, leftX, lineY + 24, {
        width: columnWidth,
      });
    leftBottom = lineY + 38;
  }

  const locationLine = [data.issueLocation, data.issuedAtDateLabel]
    .filter(Boolean)
    .join(', ');
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(REPORT_PDF_COLORS.text)
    .text(locationLine || data.issuedAtDateLabel, rightX, lineY + 10, {
      width: columnWidth,
    });

  const stampTop = Math.max(leftBottom, lineY + 34) + 8;
  const stampHeight = 48;

  doc
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .fillColor(REPORT_PDF_COLORS.muted)
    .text('Carimbo do profissional', rightX, stampTop, { width: columnWidth });

  doc
    .rect(rightX, stampTop + 14, columnWidth, stampHeight)
    .lineWidth(0.75)
    .dash(4, { space: 3 })
    .strokeColor(REPORT_PDF_COLORS.border)
    .stroke()
    .undash();

  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(REPORT_PDF_COLORS.light)
    .text('(Área reservada para carimbo)', rightX + 8, stampTop + 30, {
      width: columnWidth - 16,
      align: 'center',
    });

  doc.y = stampTop + stampHeight + 20;
  resetCursorX(doc);
}

function renderFooter(doc: PdfDoc, data: ReportPdfData): void {
  ensureSpace(doc, 28);
  drawDivider(doc);
  doc.moveDown(0.35);

  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(REPORT_PDF_COLORS.light)
    .text(
      `Documento gerado automaticamente pelo sistema Sênior Teste Funcional — Centro Universitário CESMAC · ${data.generatedAtLabel}`,
      { width: contentWidth(doc), align: 'center', lineGap: 2 },
    );
}

export function renderFullRow(
  doc: PdfDoc,
  label: string,
  value: string,
  labelWidth = 128,
): void {
  resetCursorX(doc);
  const rowTop = doc.y;
  const valueWidth = contentWidth(doc) - labelWidth;

  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(REPORT_PDF_COLORS.muted);

  const labelHeight = doc.heightOfString(`${label}:`, { width: labelWidth });
  doc.text(`${label}:`, doc.x, rowTop, { width: labelWidth });

  doc.font('Helvetica').fontSize(9.5).fillColor(REPORT_PDF_COLORS.text);

  const valueHeight = doc.heightOfString(value, { width: valueWidth });
  doc.text(value, doc.x + labelWidth, rowTop, {
    width: valueWidth,
    lineGap: 2,
  });

  doc.y = rowTop + Math.max(14, valueHeight, labelHeight) + 4;
  resetCursorX(doc);
}

export function drawDivider(doc: PdfDoc): void {
  resetCursorX(doc);
  const y = doc.y;
  doc
    .strokeColor(REPORT_PDF_COLORS.border)
    .lineWidth(0.75)
    .moveTo(doc.x, y)
    .lineTo(doc.x + contentWidth(doc), y)
    .stroke();
  doc.y = y + 8;
}

export function contentWidth(doc: PdfDoc): number {
  return doc.page.width - REPORT_PDF_LAYOUT.pageMargin * 2;
}

export function resetCursorX(doc: PdfDoc): void {
  doc.x = REPORT_PDF_LAYOUT.pageMargin;
}

function ensureSpace(doc: PdfDoc, requiredHeight: number): void {
  const bottomLimit = doc.page.height - REPORT_PDF_LAYOUT.pageMargin;

  if (doc.y + requiredHeight > bottomLimit) {
    doc.addPage();
  }
}
