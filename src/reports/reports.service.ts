import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AssessmentStatus, TherapistRole } from '@prisma/client';

import { AssessmentsService } from '../assessments/assessments.service';
import { PrismaService } from '../prisma/prisma.service';
import { aggregateGeneralReport } from './general-report.aggregator';
import { buildGeneralReportPdf } from './general-report-pdf.builder';
import { buildReportPdf } from './report-pdf.builder';
import { buildAssessmentReportFilename } from './report-filename.util';
import {
  assertFinalizedAssessment,
  mapAssessmentToReportPdfData,
} from './report-pdf.mapper';

/** Maceió não tem horário de verão: o offset é fixo. */
const REPORT_TIME_ZONE = 'America/Maceio';
const REPORT_UTC_OFFSET = '-03:00';

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assessmentsService: AssessmentsService,
  ) {}

  async generateAssessmentReport(
    therapistId: string,
    assessmentId: string,
  ): Promise<{ pdf: Buffer; filename: string }> {
    const assessment = await this.prisma.assessment.findFirst({
      where: {
        id: assessmentId,
        therapistId,
        status: AssessmentStatus.FINALIZED,
        result: { isNot: null },
        finalizedAt: { not: null },
      },
      include: {
        result: true,
        instrument: true,
        patient: true,
        therapist: { select: { fullName: true } },
      },
    });

    if (!assessment || !assessment.result || !assessment.finalizedAt) {
      throw new NotFoundException('Avaliação não encontrada.');
    }

    try {
      assertFinalizedAssessment(assessment.status);
    } catch {
      throw new BadRequestException(
        'Somente avaliações finalizadas geram relatório.',
      );
    }

    const timeseries = await this.assessmentsService.getTimeseriesForPatient(
      assessment.patientId,
      assessment.instrumentCode,
    );

    const reportData = mapAssessmentToReportPdfData(
      {
        ...assessment,
        payload: assessment.payload,
        result: assessment.result,
      },
      timeseries,
      new Date(),
    );

    // RF013 / LGPD: PDF gerado on-the-fly; sem persistência em disco/S3 no MVP.
    const pdf = await buildReportPdf(reportData);
    const filename = buildAssessmentReportFilename(assessment.patient.fullName);

    return { pdf, filename };
  }

  async generateAssessmentReportForAdmin(
    assessmentId: string,
  ): Promise<{ pdf: Buffer; filename: string }> {
    const assessment = await this.prisma.assessment.findFirst({
      where: {
        id: assessmentId,
        status: AssessmentStatus.FINALIZED,
        result: { isNot: null },
        finalizedAt: { not: null },
      },
      include: {
        result: true,
        instrument: true,
        patient: true,
        therapist: { select: { fullName: true } },
      },
    });

    if (!assessment || !assessment.result || !assessment.finalizedAt) {
      throw new NotFoundException('Avaliação não encontrada.');
    }

    try {
      assertFinalizedAssessment(assessment.status);
    } catch {
      throw new BadRequestException(
        'Somente avaliações finalizadas geram relatório.',
      );
    }

    const timeseries = await this.assessmentsService.getTimeseriesForPatient(
      assessment.patientId,
      assessment.instrumentCode,
    );

    const reportData = mapAssessmentToReportPdfData(
      {
        ...assessment,
        payload: assessment.payload,
        result: assessment.result,
      },
      timeseries,
      new Date(),
    );

    const pdf = await buildReportPdf(reportData);
    const filename = buildAssessmentReportFilename(assessment.patient.fullName);

    return { pdf, filename };
  }

  /** Relatório agregado do período — sem dado identificável de paciente. */
  async generateGeneralReport(
    issuerId: string,
    period: { from: string; to: string },
  ): Promise<{ pdf: Buffer; filename: string }> {
    const issuer = await this.prisma.therapist.findUniqueOrThrow({
      where: { id: issuerId },
      select: { fullName: true, role: true },
    });

    const assessments = await this.prisma.assessment.findMany({
      where: {
        status: AssessmentStatus.FINALIZED,
        result: { isNot: null },
        finalizedAt: {
          gte: new Date(`${period.from}T00:00:00.000${REPORT_UTC_OFFSET}`),
          lte: new Date(`${period.to}T23:59:59.999${REPORT_UTC_OFFSET}`),
        },
      },
      select: {
        patientId: true,
        therapistId: true,
        instrumentCode: true,
        finalizedAt: true,
        schoolingBandUsed: true,
        payload: true,
        result: { select: { rawValue: true, classificationCode: true } },
        patient: { select: { age: true, gender: true, schoolingBand: true } },
      },
    });

    if (assessments.length === 0) {
      throw new NotFoundException('Nenhuma avaliação finalizada no período.');
    }

    const aggregate = aggregateGeneralReport(
      assessments.flatMap(({ finalizedAt, result, ...assessment }) =>
        finalizedAt && result ? [{ ...assessment, finalizedAt, result }] : [],
      ),
    );

    const pdf = await buildGeneralReportPdf({
      issuedByLabel:
        issuer.role === TherapistRole.ADMIN
          ? `Prof(a). ${issuer.fullName}`
          : issuer.fullName,
      issuedAtDateLabel: new Date().toLocaleDateString('pt-BR', {
        timeZone: REPORT_TIME_ZONE,
      }),
      periodLabel: `${formatIsoDateLabel(period.from)} a ${formatIsoDateLabel(period.to)}`,
      aggregate,
    });

    return {
      pdf,
      filename: `relatorio-geral_${period.from}_a_${period.to}.pdf`,
    };
  }
}

function formatIsoDateLabel(isoDate: string): string {
  return isoDate.split('-').reverse().join('/');
}
