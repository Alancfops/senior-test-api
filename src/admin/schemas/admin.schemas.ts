import { z } from 'zod';
import { AdminAuditAction, TherapistRole } from '@prisma/client';

export const listTherapistsQuerySchema = z.object({
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  sortBy: z.enum(['fullName', 'email', 'createdAt']).default('fullName'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
  role: z.nativeEnum(TherapistRole).optional(),
});

export const listPatientAssessmentsQuerySchema = z.object({
  status: z.enum(['DRAFT', 'FINALIZED']).optional(),
  instrumentCode: z.enum(['TUG', 'KATZ', 'BERG', 'TINETTI', 'MEEM']).optional(),
});

export const transferPatientSchema = z.object({
  targetTherapistId: z
    .string()
    .uuid('Informe um fisioterapeuta de destino válido.'),
});

export const listAuditLogsQuerySchema = z.object({
  action: z
    .enum([
      'DELETE_PATIENT',
      'TRANSFER_PATIENT',
      'DELETE_THERAPIST',
      'DOWNLOAD_REPORT',
      'DOWNLOAD_GENERAL_REPORT',
      'CREATE_THERAPIST',
    ])
    .optional(),
  /** Várias ações separadas por vírgula; tem precedência sobre `action`. */
  actions: z
    .string()
    .transform((value) => value.split(','))
    .pipe(z.array(z.nativeEnum(AdminAuditAction)).min(1))
    .optional(),
  adminId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/** Um semestre letivo (jul–dez tem 184 dias): limita o volume lido ao agregar. */
export const GENERAL_REPORT_MAX_DAYS = 184;

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data no formato AAAA-MM-DD.')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
    );
  }, 'Informe uma data válida.');

export const generalReportSchema = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .refine((period) => period.to >= period.from, {
    message: 'A data final deve ser igual ou posterior à data inicial.',
    path: ['to'],
  })
  .refine(
    (period) =>
      (Date.parse(period.to) - Date.parse(period.from)) / 86_400_000 + 1 <=
      GENERAL_REPORT_MAX_DAYS,
    { message: 'O período máximo é de um semestre.', path: ['to'] },
  );

export const listAccessRequestsQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).default('PENDING'),
});

export type ListTherapistsQuery = z.infer<typeof listTherapistsQuerySchema>;
export type ListPatientAssessmentsQuery = z.infer<
  typeof listPatientAssessmentsQuerySchema
>;
export type TransferPatientInput = z.infer<typeof transferPatientSchema>;
export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
export type GeneralReportInput = z.infer<typeof generalReportSchema>;
export type ListAccessRequestsQuery = z.infer<
  typeof listAccessRequestsQuerySchema
>;
