import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Body,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentTherapist } from '../common/decorators/current-therapist.decorator';
import type { AuthenticatedTherapist } from '../common/decorators/current-therapist.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { toContentDispositionValue } from '../reports/report-filename.util';
import { ReportsService } from '../reports/reports.service';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import {
  generalReportSchema,
  listAccessRequestsQuerySchema,
  listAuditLogsQuerySchema,
  listPatientAssessmentsQuerySchema,
  listTherapistsQuerySchema,
  transferPatientSchema,
} from './schemas/admin.schemas';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly reportsService: ReportsService,
  ) {}

  @Get('access-requests')
  @ApiOperation({ summary: 'Lista solicitações de acesso admin (ADMIN)' })
  listAccessRequests(
    @CurrentTherapist() admin: AuthenticatedTherapist,
    @Query(new ZodValidationPipe(listAccessRequestsQuerySchema))
    query: z.infer<typeof listAccessRequestsQuerySchema>,
  ) {
    return this.adminService.listAccessRequests(
      admin.therapistId,
      admin.role,
      query,
    );
  }

  @Post('access-requests/:id/approve')
  @ApiOperation({
    summary: 'Aprova solicitação — promove a conta do app a ASSISTANT',
  })
  approveAccessRequest(
    @CurrentTherapist() admin: AuthenticatedTherapist,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adminService.approveAccessRequest(
      admin.therapistId,
      id,
      admin.role,
    );
  }

  @Post('access-requests/:id/reject')
  @ApiOperation({ summary: 'Rejeita solicitação de acesso admin' })
  rejectAccessRequest(
    @CurrentTherapist() admin: AuthenticatedTherapist,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adminService.rejectAccessRequest(
      admin.therapistId,
      id,
      admin.role,
    );
  }

  @Post('assistants/:id/revoke')
  @ApiOperation({
    summary: 'Revoga acesso de ajudante — conta volta a THERAPIST (ADMIN)',
  })
  revokeAssistant(
    @CurrentTherapist() admin: AuthenticatedTherapist,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adminService.revokeAssistant(admin.therapistId, id, admin.role);
  }

  @Get('therapists')
  @ApiOperation({
    summary:
      'GW002 — Lista todas as contas do app (fisio, ajudante, professora)',
  })
  listTherapists(
    @Query(new ZodValidationPipe(listTherapistsQuerySchema))
    query: z.infer<typeof listTherapistsQuerySchema>,
  ) {
    return this.adminService.listTherapists(query);
  }

  @Get('therapists/:id')
  @ApiOperation({ summary: 'GW003 — Detalhe do fisioterapeuta + pacientes' })
  getTherapist(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.getTherapist(id);
  }

  @Delete('therapists/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'GW006 — Exclui conta de fisioterapeuta' })
  deleteTherapist(
    @CurrentTherapist() admin: AuthenticatedTherapist,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adminService.deleteTherapist(admin.therapistId, id, admin.role);
  }

  @Get('patients/:id')
  @ApiOperation({ summary: 'GW007 — Perfil completo do paciente' })
  getPatient(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.getPatient(id);
  }

  @Get('patients/:id/assessments')
  @ApiOperation({ summary: 'GW008 — Histórico de avaliações do paciente' })
  listPatientAssessments(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(listPatientAssessmentsQuerySchema))
    query: z.infer<typeof listPatientAssessmentsQuerySchema>,
  ) {
    return this.adminService.listPatientAssessments(id, query);
  }

  @Get('patients/:id/assessments/:assessmentId')
  @ApiOperation({ summary: 'GW007/GW008 — Detalhe de avaliação' })
  getPatientAssessment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
  ) {
    return this.adminService.getPatientAssessment(id, assessmentId);
  }

  @Get('patients/:id/instruments/:code/timeseries')
  @ApiOperation({ summary: 'GW008 — Série temporal para gráfico (RF012)' })
  getPatientTimeseries(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('code') code: string,
  ) {
    return this.adminService.getPatientTimeseries(id, code);
  }

  @Delete('patients/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'GW004 — Exclui paciente e avaliações' })
  deletePatient(
    @CurrentTherapist() admin: { therapistId: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adminService.deletePatient(admin.therapistId, id);
  }

  @Post('patients/:id/transfer')
  @ApiOperation({
    summary: 'GW005 — Transfere paciente para outro fisioterapeuta',
  })
  transferPatient(
    @CurrentTherapist() admin: { therapistId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(transferPatientSchema))
    body: z.infer<typeof transferPatientSchema>,
  ) {
    return this.adminService.transferPatient(admin.therapistId, id, body);
  }

  @Post('reports/assessments/:assessmentId')
  @ApiOperation({
    summary: 'GW009 — Gera PDF de avaliação finalizada (escopo admin)',
  })
  @ApiProduces('application/pdf')
  async generateAssessmentReport(
    @CurrentTherapist() admin: { therapistId: string },
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
    @Res() response: Response,
  ) {
    const { pdf, filename } =
      await this.reportsService.generateAssessmentReportForAdmin(assessmentId);

    await this.adminService.logReportDownload(admin.therapistId, assessmentId);

    response.status(201);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader(
      'Content-Disposition',
      toContentDispositionValue(filename),
    );
    response.send(pdf);
  }

  @Post('reports/general')
  @ApiOperation({
    summary:
      'Gera PDF agregado do período (até um semestre), sem identificar pacientes',
  })
  @ApiProduces('application/pdf')
  async generateGeneralReport(
    @CurrentTherapist() admin: { therapistId: string },
    @Body(new ZodValidationPipe(generalReportSchema))
    body: z.infer<typeof generalReportSchema>,
    @Res() response: Response,
  ) {
    const { pdf, filename } = await this.reportsService.generateGeneralReport(
      admin.therapistId,
      body,
    );

    await this.adminService.logGeneralReportDownload(admin.therapistId, body);

    response.status(201);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader(
      'Content-Disposition',
      toContentDispositionValue(filename),
    );
    response.send(pdf);
  }

  @Get('audit-logs')
  @ApiOperation({
    summary:
      'GW010 — Trilha de auditoria administrativa (leitura para qualquer role web)',
  })
  listAuditLogs(
    @Query(new ZodValidationPipe(listAuditLogsQuerySchema))
    query: z.infer<typeof listAuditLogsQuerySchema>,
  ) {
    return this.adminService.listAuditLogs(query);
  }
}
