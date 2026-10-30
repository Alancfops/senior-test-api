import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AdminAccessRequestStatus,
  AdminAuditAction,
  AssessmentStatus,
  Prisma,
  TherapistRole,
} from '@prisma/client';

import { AssessmentsService } from '../assessments/assessments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AssistantAccessDecision } from '../notifications/templates/assistant-access.email';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAuditService } from './admin-audit.service';
import {
  ListAccessRequestsQuery,
  ListAuditLogsQuery,
  ListPatientAssessmentsQuery,
  ListTherapistsQuery,
  TransferPatientInput,
} from './schemas/admin.schemas';

/**
 * Todas as contas atendem pacientes pelo app (fisio, ajudante, professora), então o
 * painel mostra todas. Gerenciar (excluir) segue a hierarquia: ADMIN → ASSISTANT/THERAPIST,
 * ASSISTANT → THERAPIST. A conta ADMIN só muda via `npm run admin:set`.
 */
const MANAGED_ROLES: Record<TherapistRole, TherapistRole[]> = {
  [TherapistRole.ADMIN]: [TherapistRole.ASSISTANT, TherapistRole.THERAPIST],
  [TherapistRole.ASSISTANT]: [TherapistRole.THERAPIST],
  [TherapistRole.THERAPIST]: [],
};

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly assessmentsService: AssessmentsService,
    private readonly notifications: NotificationsService,
  ) {}

  async listTherapists(query: ListTherapistsQuery) {
    const search = query.search?.trim();

    const where: Prisma.TherapistWhereInput = {
      ...(search
        ? {
            OR: [
              { fullName: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.role ? { role: query.role } : {}),
    };

    const [total, therapists] = await Promise.all([
      this.prisma.therapist.count({ where }),
      this.prisma.therapist.findMany({
        where,
        orderBy: { [query.sortBy]: query.sortOrder },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: {
          _count: {
            select: {
              patients: true,
              assessments: { where: { status: AssessmentStatus.FINALIZED } },
            },
          },
          assessments: {
            where: {
              status: AssessmentStatus.FINALIZED,
              finalizedAt: { not: null },
            },
            orderBy: { finalizedAt: 'desc' },
            take: 1,
            select: { finalizedAt: true },
          },
        },
      }),
    ]);

    const totalPages = total === 0 ? 0 : Math.ceil(total / query.limit);

    return {
      data: therapists.map((therapist) => ({
        id: therapist.id,
        fullName: therapist.fullName,
        email: therapist.email,
        role: therapist.role,
        createdAt: therapist.createdAt.toISOString(),
        patientCount: therapist._count.patients,
        assessmentCount: therapist._count.assessments,
        lastActivityAt:
          therapist.assessments[0]?.finalizedAt?.toISOString() ?? null,
      })),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages,
      },
    };
  }

  async getTherapist(id: string) {
    const therapist = await this.prisma.therapist.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            patients: true,
            assessments: { where: { status: AssessmentStatus.FINALIZED } },
          },
        },
        patients: {
          orderBy: { fullName: 'asc' },
          include: {
            _count: {
              select: {
                assessments: { where: { status: AssessmentStatus.FINALIZED } },
              },
            },
            assessments: {
              where: {
                status: AssessmentStatus.FINALIZED,
                finalizedAt: { not: null },
              },
              orderBy: { finalizedAt: 'desc' },
              take: 1,
              select: { finalizedAt: true },
            },
          },
        },
      },
    });

    if (!therapist) {
      throw new NotFoundException('Fisioterapeuta não encontrado.');
    }

    return {
      id: therapist.id,
      fullName: therapist.fullName,
      email: therapist.email,
      role: therapist.role,
      createdAt: therapist.createdAt.toISOString(),
      patients: therapist.patients.map((patient) => ({
        id: patient.id,
        fullName: patient.fullName,
        age: patient.age,
        gender: patient.gender,
        assessmentCount: patient._count.assessments,
        lastAssessmentAt:
          patient.assessments[0]?.finalizedAt?.toISOString() ?? null,
      })),
      meta: {
        patientCount: therapist._count.patients,
        assessmentCount: therapist._count.assessments,
      },
    };
  }

  async deleteTherapist(
    adminId: string,
    id: string,
    requesterRole: TherapistRole,
  ): Promise<void> {
    const therapist = await this.prisma.therapist.findUnique({
      where: { id },
      include: { _count: { select: { patients: true } } },
    });

    if (!therapist) {
      throw new NotFoundException('Fisioterapeuta não encontrado.');
    }

    if (!MANAGED_ROLES[requesterRole].includes(therapist.role)) {
      throw new ForbiddenException('Fora do escopo de gestão desta conta.');
    }

    if (therapist._count.patients > 0) {
      throw new ConflictException(
        `Este fisioterapeuta ainda possui ${therapist._count.patients} paciente(s). Transfira ou exclua os pacientes antes de remover a conta.`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.therapist.delete({ where: { id } });
      await this.audit.log(
        adminId,
        AdminAuditAction.DELETE_THERAPIST,
        'Therapist',
        id,
        {
          therapistName: therapist.fullName,
          fullName: therapist.fullName,
          email: therapist.email,
        },
        tx,
      );
    });
  }

  async getPatient(id: string) {
    const patient = await this.prisma.patient.findUnique({
      where: { id },
      include: {
        therapist: { select: { id: true, fullName: true, email: true } },
      },
    });

    if (!patient) {
      throw new NotFoundException('Paciente não encontrado.');
    }

    return {
      id: patient.id,
      fullName: patient.fullName,
      age: patient.age,
      gender: patient.gender,
      contact: patient.contact,
      schoolingBand: patient.schoolingBand,
      avatarUrl: patient.avatarUrl,
      createdAt: patient.createdAt.toISOString(),
      therapist: patient.therapist,
    };
  }

  async listPatientAssessments(
    patientId: string,
    query: ListPatientAssessmentsQuery,
  ) {
    await this.assertPatientExists(patientId);

    const assessments = await this.prisma.assessment.findMany({
      where: {
        patientId,
        status: AssessmentStatus.FINALIZED,
        ...(query.instrumentCode
          ? { instrumentCode: query.instrumentCode }
          : {}),
      },
      include: {
        result: true,
        therapist: { select: { id: true, fullName: true } },
      },
    });

    assessments.sort((a, b) => {
      const aDate = (a.finalizedAt ?? a.startedAt).getTime();
      const bDate = (b.finalizedAt ?? b.startedAt).getTime();
      return bDate - aDate;
    });

    return {
      data: assessments.map((assessment) =>
        this.toAdminAssessmentSummary(assessment),
      ),
    };
  }

  async getPatientAssessment(patientId: string, assessmentId: string) {
    await this.assertPatientExists(patientId);

    const assessment = await this.prisma.assessment.findFirst({
      where: { id: assessmentId, patientId },
      include: {
        result: true,
        therapist: { select: { id: true, fullName: true } },
      },
    });

    if (!assessment) {
      throw new NotFoundException('Avaliação não encontrada.');
    }

    return this.toAdminAssessmentDetail(assessment);
  }

  async getPatientTimeseries(patientId: string, codeInput: string) {
    await this.assertPatientExists(patientId);
    return this.assessmentsService.getTimeseriesForPatient(
      patientId,
      codeInput,
    );
  }

  async deletePatient(adminId: string, patientId: string): Promise<void> {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: { id: true, fullName: true },
    });

    if (!patient) {
      throw new NotFoundException('Paciente não encontrado.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.patient.delete({ where: { id: patientId } });
      await this.audit.log(
        adminId,
        AdminAuditAction.DELETE_PATIENT,
        'Patient',
        patientId,
        { patientName: patient.fullName },
        tx,
      );
    });
  }

  async transferPatient(
    adminId: string,
    patientId: string,
    input: TransferPatientInput,
  ) {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: { id: true, therapistId: true, fullName: true },
    });

    if (!patient) {
      throw new NotFoundException('Paciente não encontrado.');
    }

    if (patient.therapistId === input.targetTherapistId) {
      throw new BadRequestException(
        'O paciente já pertence a este fisioterapeuta.',
      );
    }

    const targetTherapist = await this.prisma.therapist.findUnique({
      where: { id: input.targetTherapistId },
      select: { id: true },
    });

    if (!targetTherapist) {
      throw new NotFoundException('Fisioterapeuta de destino não encontrado.');
    }

    const fromTherapistId = patient.therapistId;

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.patient.update({
        where: { id: patientId },
        data: { therapistId: input.targetTherapistId },
      });

      const assessmentsUpdated = await tx.assessment.updateMany({
        where: { patientId },
        data: { therapistId: input.targetTherapistId },
      });

      await this.audit.log(
        adminId,
        AdminAuditAction.TRANSFER_PATIENT,
        'Patient',
        patientId,
        {
          patientName: patient.fullName,
          fromTherapistId,
          toTherapistId: input.targetTherapistId,
        },
        tx,
      );

      return { updated, assessmentsUpdated: assessmentsUpdated.count };
    });

    return {
      patientId: result.updated.id,
      fromTherapistId,
      toTherapistId: input.targetTherapistId,
      assessmentsUpdated: result.assessmentsUpdated,
    };
  }

  async listAuditLogs(query: ListAuditLogsQuery) {
    const where: Prisma.AdminAuditLogWhereInput = {
      ...(query.actions
        ? { action: { in: query.actions } }
        : query.action
          ? { action: query.action }
          : {}),
      ...(query.adminId ? { adminId: query.adminId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    const [total, logs] = await Promise.all([
      this.prisma.adminAuditLog.count({ where }),
      this.prisma.adminAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: {
          admin: { select: { fullName: true } },
        },
      }),
    ]);

    const totalPages = total === 0 ? 0 : Math.ceil(total / query.limit);

    const downloadLogsMissingMeta = logs.filter((log) => {
      if (log.action !== AdminAuditAction.DOWNLOAD_REPORT) return false;
      const meta = log.metadata as Record<string, unknown>;
      return !meta.patientName || !meta.instrumentCode || !meta.patientId;
    });

    const assessmentById = new Map<
      string,
      {
        patientId: string;
        patientName: string;
        instrumentCode: string;
        finalizedAt: string | null;
      }
    >();

    if (downloadLogsMissingMeta.length > 0) {
      const assessments = await this.prisma.assessment.findMany({
        where: {
          id: { in: downloadLogsMissingMeta.map((log) => log.targetId) },
        },
        select: {
          id: true,
          instrumentCode: true,
          finalizedAt: true,
          patient: { select: { id: true, fullName: true } },
        },
      });
      for (const assessment of assessments) {
        assessmentById.set(assessment.id, {
          patientId: assessment.patient.id,
          patientName: assessment.patient.fullName,
          instrumentCode: assessment.instrumentCode,
          finalizedAt: assessment.finalizedAt?.toISOString() ?? null,
        });
      }
    }

    const patientLogsMissingName = logs.filter((log) => {
      if (log.targetType !== 'Patient') return false;
      const meta = log.metadata as Record<string, unknown>;
      return !meta.patientName;
    });

    const patientNameById = new Map<string, string>();
    if (patientLogsMissingName.length > 0) {
      const patients = await this.prisma.patient.findMany({
        where: {
          id: { in: patientLogsMissingName.map((log) => log.targetId) },
        },
        select: { id: true, fullName: true },
      });
      for (const patient of patients) {
        patientNameById.set(patient.id, patient.fullName);
      }
    }

    return {
      data: logs.map((log) => {
        let metadata = log.metadata as Record<string, unknown>;
        if (log.action === AdminAuditAction.DOWNLOAD_REPORT) {
          const fallback = assessmentById.get(log.targetId);
          if (fallback) {
            metadata = {
              ...metadata,
              patientId: metadata.patientId ?? fallback.patientId,
              patientName: metadata.patientName ?? fallback.patientName,
              instrumentCode:
                metadata.instrumentCode ?? fallback.instrumentCode,
              finalizedAt: metadata.finalizedAt ?? fallback.finalizedAt,
            };
          }
        }

        if (log.targetType === 'Patient' && !metadata.patientName) {
          const name = patientNameById.get(log.targetId);
          if (name) {
            metadata = { ...metadata, patientName: name };
          }
        }

        return {
          id: log.id,
          adminId: log.adminId,
          adminName: log.admin.fullName,
          action: log.action,
          targetType: log.targetType,
          targetId: log.targetId,
          metadata,
          createdAt: log.createdAt.toISOString(),
        };
      }),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages,
      },
    };
  }

  async listAccessRequests(
    adminId: string,
    requesterRole: TherapistRole,
    query: ListAccessRequestsQuery,
  ) {
    this.assertCanManageAccessRequests(requesterRole);
    const status = query.status;
    const requests = await this.prisma.adminAccessRequest.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
      include: {
        resolvedBy: { select: { id: true, fullName: true, email: true } },
      },
    });

    return {
      data: requests.map((request) => ({
        id: request.id,
        email: request.email,
        fullName: request.fullName,
        status: request.status,
        createdAt: request.createdAt.toISOString(),
        resolvedAt: request.resolvedAt?.toISOString() ?? null,
        resolvedBy: request.resolvedBy
          ? {
              id: request.resolvedBy.id,
              fullName: request.resolvedBy.fullName,
              email: request.resolvedBy.email,
            }
          : null,
      })),
    };
  }

  /** Aprova: promove a própria conta do app (THERAPIST) a ASSISTANT — mesma senha. */
  async approveAccessRequest(
    adminId: string,
    requestId: string,
    requesterRole: TherapistRole,
  ) {
    this.assertCanManageAccessRequests(requesterRole);
    const request = await this.findPendingAccessRequest(requestId);

    if (!request.therapistId) {
      throw new ConflictException(
        'Solicitação antiga, sem conta do aplicativo vinculada. Peça para o aluno solicitar novamente pelo gerenciador.',
      );
    }

    const account = await this.prisma.therapist.findUnique({
      where: { id: request.therapistId },
    });

    if (!account || account.role !== TherapistRole.THERAPIST) {
      throw new ConflictException(
        'A conta do aplicativo vinculada a esta solicitação não está mais disponível para promoção.',
      );
    }

    const now = new Date();

    const promoted = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.therapist.update({
        where: { id: account.id },
        data: { role: TherapistRole.ASSISTANT },
      });

      await tx.adminAccessRequest.update({
        where: { id: request.id },
        data: {
          status: AdminAccessRequestStatus.APPROVED,
          resolvedAt: now,
          resolvedById: adminId,
        },
      });

      await this.audit.log(
        adminId,
        AdminAuditAction.PROMOTE_ASSISTANT,
        'Therapist',
        updated.id,
        {
          requestId: request.id,
          fullName: updated.fullName,
          email: updated.email,
          fromRole: TherapistRole.THERAPIST,
          toRole: TherapistRole.ASSISTANT,
        },
        tx,
      );

      return updated;
    });

    const notificationSent = await this.notifyAccessDecision(
      promoted.email,
      promoted.fullName,
      'approved',
    );

    return {
      id: promoted.id,
      email: promoted.email,
      fullName: promoted.fullName,
      role: promoted.role,
      createdAt: promoted.createdAt.toISOString(),
      notificationSent,
    };
  }

  async rejectAccessRequest(
    adminId: string,
    requestId: string,
    requesterRole: TherapistRole,
  ) {
    this.assertCanManageAccessRequests(requesterRole);
    await this.findPendingAccessRequest(requestId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const rejected = await tx.adminAccessRequest.update({
        where: { id: requestId },
        data: {
          status: AdminAccessRequestStatus.REJECTED,
          resolvedAt: new Date(),
          resolvedById: adminId,
        },
      });

      await this.audit.log(
        adminId,
        AdminAuditAction.REJECT_ACCESS_REQUEST,
        'AccessRequest',
        rejected.id,
        { fullName: rejected.fullName, email: rejected.email },
        tx,
      );

      return rejected;
    });

    const notificationSent = await this.notifyAccessDecision(
      updated.email,
      updated.fullName,
      'rejected',
    );

    return {
      id: updated.id,
      email: updated.email,
      fullName: updated.fullName,
      status: updated.status,
      resolvedAt: updated.resolvedAt!.toISOString(),
      notificationSent,
    };
  }

  /** Revoga o acesso de ajudante: a conta volta a THERAPIST e mantém pacientes/avaliações no app. */
  async revokeAssistant(
    adminId: string,
    assistantId: string,
    requesterRole: TherapistRole,
  ) {
    this.assertCanManageAccessRequests(requesterRole);

    const assistant = await this.prisma.therapist.findUnique({
      where: { id: assistantId },
    });

    if (!assistant) {
      throw new NotFoundException('Ajudante não encontrado.');
    }

    if (assistant.role !== TherapistRole.ASSISTANT) {
      throw new ConflictException('Esta conta não é de ajudante.');
    }

    const revoked = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.therapist.update({
        where: { id: assistant.id },
        data: { role: TherapistRole.THERAPIST },
      });

      await this.audit.log(
        adminId,
        AdminAuditAction.REVOKE_ASSISTANT,
        'Therapist',
        updated.id,
        {
          fullName: updated.fullName,
          email: updated.email,
          fromRole: TherapistRole.ASSISTANT,
          toRole: TherapistRole.THERAPIST,
        },
        tx,
      );

      return updated;
    });

    return { id: revoked.id, role: revoked.role };
  }

  async logReportDownload(
    adminId: string,
    assessmentId: string,
  ): Promise<void> {
    await this.audit.logReportDownload(adminId, assessmentId);
  }

  async logGeneralReportDownload(
    adminId: string,
    period: { from: string; to: string },
  ): Promise<void> {
    // Relatório agregado não tem entidade-alvo: o próprio emissor ocupa targetId.
    await this.audit.log(
      adminId,
      AdminAuditAction.DOWNLOAD_GENERAL_REPORT,
      'GeneralReport',
      adminId,
      { from: period.from, to: period.to },
    );
  }

  private async findPendingAccessRequest(requestId: string) {
    const request = await this.prisma.adminAccessRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException('Solicitação não encontrada.');
    }

    if (request.status !== AdminAccessRequestStatus.PENDING) {
      throw new ConflictException('Esta solicitação já foi resolvida.');
    }

    return request;
  }

  /** E-mail pós-commit: falha não desfaz a decisão, só sinaliza `notificationSent: false`. */
  private async notifyAccessDecision(
    email: string,
    fullName: string,
    decision: AssistantAccessDecision,
  ): Promise<boolean> {
    try {
      await this.notifications.sendAssistantAccessDecisionEmail(email, {
        fullName,
        decision,
      });
      return true;
    } catch {
      this.logger.warn(
        `Falha ao enviar e-mail de decisão de acesso (${decision}).`,
      );
      return false;
    }
  }

  private assertCanManageAccessRequests(requesterRole: TherapistRole): void {
    if (requesterRole !== TherapistRole.ADMIN) {
      throw new ForbiddenException(
        'Apenas administradores podem gerenciar solicitações de acesso.',
      );
    }
  }

  private async assertPatientExists(patientId: string): Promise<void> {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: { id: true },
    });

    if (!patient) {
      throw new NotFoundException('Paciente não encontrado.');
    }
  }

  private toAdminAssessmentSummary(assessment: {
    id: string;
    patientId: string;
    instrumentCode: string;
    status: AssessmentStatus;
    startedAt: Date;
    finalizedAt: Date | null;
    therapist: { id: string; fullName: string };
    result: {
      rawValue: Prisma.Decimal;
      rawLabel: string;
      classificationLabel: string;
      classificationCode: string;
      classificationMeta: Prisma.JsonValue;
      computedAt: Date;
    } | null;
  }) {
    return {
      id: assessment.id,
      patientId: assessment.patientId,
      instrumentCode: assessment.instrumentCode,
      status: assessment.status,
      startedAt: assessment.startedAt.toISOString(),
      finalizedAt: assessment.finalizedAt?.toISOString() ?? null,
      therapistId: assessment.therapist.id,
      therapistName: assessment.therapist.fullName,
      result: assessment.result
        ? {
            rawValue: Number(assessment.result.rawValue),
            rawLabel: assessment.result.rawLabel,
            classificationLabel: assessment.result.classificationLabel,
            classificationCode: assessment.result.classificationCode,
            classificationMeta: assessment.result.classificationMeta as Record<
              string,
              unknown
            >,
            computedAt: assessment.result.computedAt.toISOString(),
          }
        : null,
    };
  }

  private toAdminAssessmentDetail(assessment: {
    id: string;
    patientId: string;
    instrumentCode: string;
    status: AssessmentStatus;
    startedAt: Date;
    finalizedAt: Date | null;
    payload: Prisma.JsonValue;
    schoolingBandUsed: string | null;
    notesObservation: string | null;
    therapist: { id: string; fullName: string };
    result: {
      rawValue: Prisma.Decimal;
      rawLabel: string;
      classificationLabel: string;
      classificationCode: string;
      classificationMeta: Prisma.JsonValue;
      computedAt: Date;
    } | null;
  }) {
    return {
      ...this.toAdminAssessmentSummary(assessment),
      payload: this.asRecord(assessment.payload),
      schoolingBandUsed: assessment.schoolingBandUsed,
      notesObservation: assessment.notesObservation,
    };
  }

  private asRecord(value: Prisma.JsonValue): Record<string, unknown> {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value;
    }
    return {};
  }
}
