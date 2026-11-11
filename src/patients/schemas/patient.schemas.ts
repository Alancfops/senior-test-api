import { z } from 'zod';

export const GENDER_VALUES = ['masculino', 'feminino', 'outro'] as const;

export const SCHOOLING_BAND_VALUES = [
  'analfabeto',
  '1_4_anos',
  '5_8_anos',
  '9_11_anos',
  'mais_11_anos',
] as const;

const phoneRegex = /^\(\d{2}\) 9 \d{4}-\d{4}$/;
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const avatarImageSchema = z.object({
  mimeType: z.enum(['image/jpeg', 'image/png'], {
    message: 'Use JPG ou PNG para a foto.',
  }),
  base64: z
    .string()
    .min(1, 'Imagem inválida.')
    .max(350_000, 'Imagem muito grande (máx. ~250 KB).'),
});

export type AvatarImageInput = z.infer<typeof avatarImageSchema>;

export const createPatientSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(1, 'Informe o nome completo.')
    .max(250, 'Nome muito longo (máx. 250 caracteres).')
    .regex(/^[A-Za-zÀ-ÿ\s]+$/, 'Nome não pode conter números.'),
  age: z.coerce
    .number()
    .int('Informe uma idade válida.')
    .min(0, 'Digite um valor válido.')
    .max(120, 'Digite um valor válido.'),
  gender: z.enum(GENDER_VALUES, { message: 'Selecione o sexo.' }),
  contact: z
    .string()
    .trim()
    .min(1, 'Informe e-mail ou telefone.')
    .refine((value) => phoneRegex.test(value) || emailRegex.test(value), {
      message: 'Informe um e-mail ou telefone celular válido.',
    }),
  schoolingBand: z.enum(SCHOOLING_BAND_VALUES, {
    message: 'Selecione a escolaridade.',
  }),
  avatarImage: avatarImageSchema.optional(),
});

export type CreatePatientInput = z.infer<typeof createPatientSchema>;

/** RF004 — atualização de cadastro (campos do create + remoção da foto). */
export const updatePatientSchema = createPatientSchema
  .extend({
    /** `true` apaga a foto salva — o paciente volta a exibir as iniciais. */
    removeAvatar: z.boolean().optional(),
  })
  .refine((input) => !(input.removeAvatar && input.avatarImage), {
    message: 'Envie uma nova foto ou remova a atual, não as duas coisas.',
    path: ['removeAvatar'],
  });

export type UpdatePatientInput = z.infer<typeof updatePatientSchema>;

export const listPatientsQuerySchema = z.object({
  search: z.string().trim().optional(),
  gender: z.enum(GENDER_VALUES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  sortBy: z.enum(['fullName', 'age', 'gender']).default('fullName'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

export type ListPatientsQuery = z.infer<typeof listPatientsQuerySchema>;
