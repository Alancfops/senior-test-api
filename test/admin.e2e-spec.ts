import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AssessmentStatus, TherapistRole } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { hashPassword } from '../src/auth/auth.crypto';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Admin (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let adminToken: string;
  let therapistToken: string;
  let adminId: string;
  let therapistAId: string;
  let therapistBId: string;
  const adminEmail = 'professora-e2e@test.com';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    prisma = moduleFixture.get(PrismaService);
    await app.init();

    const admin = await prisma.therapist.upsert({
      where: { email: adminEmail },
      update: {
        fullName: 'Professora E2E',
        passwordHash: await hashPassword('Abcd1234'),
        mustChangePassword: false,
      },
      create: {
        email: adminEmail,
        fullName: 'Professora E2E',
        passwordHash: await hashPassword('Abcd1234'),
        role: TherapistRole.ADMIN,
      },
    });
    adminId = admin.id;

    const therapistA = await prisma.therapist.create({
      data: {
        email: 'fisio-admin-a@test.com',
        fullName: 'Fisio Admin A',
        passwordHash: await hashPassword('Abcd1234'),
      },
    });
    therapistAId = therapistA.id;

    const therapistB = await prisma.therapist.create({
      data: {
        email: 'fisio-admin-b@test.com',
        fullName: 'Fisio Admin B',
        passwordHash: await hashPassword('Abcd1234'),
      },
    });
    therapistBId = therapistB.id;

    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password: 'Abcd1234', panel: 'web' })
      .expect(201);

    adminToken = adminLogin.body.accessToken;
    expect(adminLogin.body.user.role).toBe('ADMIN');
    expect(adminLogin.body.user.canManageAccessRequests).toBe(true);

    const therapistLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'fisio-admin-a@test.com', password: 'Abcd1234' })
      .expect(201);

    therapistToken = therapistLogin.body.accessToken;
    expect(therapistLogin.body.user.role).toBe('THERAPIST');
  });

  afterEach(async () => {
    await prisma.adminAuditLog.deleteMany();
    await prisma.assessmentResult.deleteMany();
    await prisma.assessment.deleteMany();
    await prisma.patient.deleteMany();
    await prisma.adminAccessRequest.deleteMany();
  });

  afterAll(async () => {
    await prisma.adminAuditLog.deleteMany();
    await prisma.assessmentResult.deleteMany();
    await prisma.assessment.deleteMany();
    await prisma.patient.deleteMany();
    await prisma.adminAccessRequest.deleteMany();
    await prisma.passwordResetToken.deleteMany();
    await prisma.therapist.deleteMany();
    await app.close();
  });

  it('GET /admin/therapists exige role de gerenciador (ASSISTANT/ADMIN)', async () => {
    await request(app.getHttpServer())
      .get('/admin/therapists')
      .set('Authorization', `Bearer ${therapistToken}`)
      .expect(403);

    const response = await request(app.getHttpServer())
      .get('/admin/therapists')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.data.length).toBeGreaterThanOrEqual(2);
    expect(response.body.meta.total).toBeGreaterThanOrEqual(2);
    // A professora também atende pelo app: a própria conta aparece na lista.
    expect(
      response.body.data.some((t: { id: string }) => t.id === adminId),
    ).toBe(true);
  });

  describe('POST /admin/reports/general', () => {
    const period = { from: '2026-07-01', to: '2026-07-31' };

    it('exige role de gerenciador', async () => {
      await request(app.getHttpServer())
        .post('/admin/reports/general')
        .set('Authorization', `Bearer ${therapistToken}`)
        .send(period)
        .expect(403);
    });

    it('rejeita período invertido ou maior que um semestre', async () => {
      await request(app.getHttpServer())
        .post('/admin/reports/general')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ from: '2026-07-31', to: '2026-07-01' })
        .expect(400);

      await request(app.getHttpServer())
        .post('/admin/reports/general')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ from: '2026-01-01', to: '2026-07-04' })
        .expect(400);
    });

    it('responde 404 sem avaliação finalizada no período e não audita', async () => {
      await request(app.getHttpServer())
        .post('/admin/reports/general')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ from: '2020-01-01', to: '2020-01-31' })
        .expect(404);

      const auditCount = await prisma.adminAuditLog.count({
        where: { action: 'DOWNLOAD_GENERAL_REPORT' },
      });
      expect(auditCount).toBe(0);
    });

    it('gera PDF e audita só o período, respeitando o limite do último dia em Maceió', async () => {
      const patient = await prisma.patient.create({
        data: {
          therapistId: therapistAId,
          fullName: 'Paciente Relatorio Geral',
          age: 70,
          gender: 'masculino',
          contact: '(11) 99999-0000',
        },
      });
      const assessment = await prisma.assessment.create({
        data: {
          therapistId: therapistAId,
          patientId: patient.id,
          instrumentCode: 'TUG',
          status: AssessmentStatus.FINALIZED,
          // 31/07 às 23:30 em Maceió já é 01/08 em UTC.
          finalizedAt: new Date('2026-08-01T02:30:00.000Z'),
          payload: {},
        },
      });
      await prisma.assessmentResult.create({
        data: {
          assessmentId: assessment.id,
          rawValue: 14,
          rawLabel: '14.0 s',
          classificationLabel: 'Maior risco',
          classificationCode: 'TUG_HIGH_RISK',
          classificationMeta: {},
        },
      });

      const response = await request(app.getHttpServer())
        .post('/admin/reports/general')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(period)
        .expect(201);

      expect(response.headers['content-type']).toContain('application/pdf');
      expect(response.headers['content-disposition']).toContain(
        'relatorio-geral_2026-07-01_a_2026-07-31.pdf',
      );

      const logs = await request(app.getHttpServer())
        .get('/admin/audit-logs')
        .query({ actions: 'DOWNLOAD_REPORT,DOWNLOAD_GENERAL_REPORT' })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(logs.body.data[0]).toMatchObject({
        action: 'DOWNLOAD_GENERAL_REPORT',
        targetType: 'GeneralReport',
        metadata: period,
      });
    });
  });

  it('POST /admin/patients/:id/transfer atualiza patient e assessments', async () => {
    const patient = await prisma.patient.create({
      data: {
        therapistId: therapistAId,
        fullName: 'Paciente Transfer',
        age: 70,
        gender: 'masculino',
        contact: '(11) 99999-0000',
      },
    });

    const assessment = await prisma.assessment.create({
      data: {
        therapistId: therapistAId,
        patientId: patient.id,
        instrumentCode: 'TUG',
        status: AssessmentStatus.FINALIZED,
        finalizedAt: new Date(),
        payload: {},
      },
    });

    await prisma.assessmentResult.create({
      data: {
        assessmentId: assessment.id,
        rawValue: 12,
        rawLabel: '12 s',
        classificationLabel: 'Normal',
        classificationCode: 'NORMAL',
        classificationMeta: {},
      },
    });

    const transfer = await request(app.getHttpServer())
      .post(`/admin/patients/${patient.id}/transfer`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ targetTherapistId: therapistBId })
      .expect(201);

    expect(transfer.body.fromTherapistId).toBe(therapistAId);
    expect(transfer.body.toTherapistId).toBe(therapistBId);
    expect(transfer.body.assessmentsUpdated).toBe(1);

    const updatedPatient = await prisma.patient.findUniqueOrThrow({
      where: { id: patient.id },
    });
    expect(updatedPatient.therapistId).toBe(therapistBId);

    const updatedAssessment = await prisma.assessment.findUniqueOrThrow({
      where: { id: assessment.id },
    });
    expect(updatedAssessment.therapistId).toBe(therapistBId);

    const audit = await prisma.adminAuditLog.findFirst({
      where: { action: 'TRANSFER_PATIENT', targetId: patient.id },
    });
    expect(audit).not.toBeNull();
  });

  it('DELETE /admin/therapists/:id bloqueia fisio com pacientes', async () => {
    await prisma.patient.create({
      data: {
        therapistId: therapistAId,
        fullName: 'Bloqueio Delete',
        age: 80,
        gender: 'feminino',
        contact: '(11) 88888-0000',
      },
    });

    await request(app.getHttpServer())
      .delete(`/admin/therapists/${therapistAId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);
  });

  it('DELETE /admin/therapists/:id exclui aluno que já baixou PDF no app e preserva a auditoria', async () => {
    const student = await prisma.therapist.create({
      data: {
        email: 'aluno-pdf@test.com',
        fullName: 'Aluno PDF',
        passwordHash: await hashPassword('Abcd1234'),
      },
    });
    const download = await prisma.adminAuditLog.create({
      data: {
        adminId: student.id,
        action: 'DOWNLOAD_REPORT',
        targetType: 'Assessment',
        targetId: student.id,
      },
    });

    await request(app.getHttpServer())
      .delete(`/admin/therapists/${student.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    expect(
      await prisma.therapist.findUnique({ where: { id: student.id } }),
    ).toBeNull();
    const kept = await prisma.adminAuditLog.findUnique({
      where: { id: download.id },
    });
    expect(kept).not.toBeNull();
    expect(kept?.adminId).toBeNull();

    const logs = await request(app.getHttpServer())
      .get('/admin/audit-logs')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const listed = logs.body.data.find(
      (log: { id: string }) => log.id === download.id,
    );
    expect(listed).toMatchObject({
      adminId: null,
      adminName: 'Conta removida',
    });
  });

  it('GET /patients do fisio continua isolado após transferência', async () => {
    const patient = await prisma.patient.create({
      data: {
        therapistId: therapistAId,
        fullName: 'Isolamento Pós Transfer',
        age: 75,
        gender: 'feminino',
        contact: '(11) 77777-0000',
      },
    });

    await request(app.getHttpServer())
      .post(`/admin/patients/${patient.id}/transfer`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ targetTherapistId: therapistBId })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/patients/${patient.id}`)
      .set('Authorization', `Bearer ${therapistToken}`)
      .expect(404);
  });

  it('DELETE /admin/therapists/:id não permite excluir a conta da professora (ADMIN)', async () => {
    await request(app.getHttpServer())
      .delete(`/admin/therapists/${adminId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(403);

    const stored = await prisma.therapist.findUnique({
      where: { id: adminId },
    });
    expect(stored).not.toBeNull();
  });

  it('professora usa a mesma conta no app: login sem panel, cadastro bloqueado e pacientes no painel', async () => {
    const appLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password: 'Abcd1234' })
      .expect(201);
    expect(appLogin.body.user.role).toBe('ADMIN');

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: adminEmail,
        fullName: 'Professora Duplicada',
        password: 'Abcd1234',
      })
      .expect(409);

    const created = await request(app.getHttpServer())
      .post('/patients')
      .set('Authorization', `Bearer ${appLogin.body.accessToken}`)
      .send({
        fullName: 'Paciente Professora',
        age: 81,
        gender: 'feminino',
        contact: 'paciente@email.com',
        schoolingBand: '9_11_anos',
      })
      .expect(201);

    const list = await request(app.getHttpServer())
      .get('/admin/therapists')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(list.body.data.some((t: { id: string }) => t.id === adminId)).toBe(
      true,
    );

    const detail = await request(app.getHttpServer())
      .get(`/admin/therapists/${adminId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(detail.body.patients.map((p: { id: string }) => p.id)).toContain(
      created.body.id,
    );

    await prisma.patient.delete({ where: { id: created.body.id } });
  });

  it('fluxo ajudante: conta do app → solicitação com senha → approve promove a mesma conta → revoke', async () => {
    const email = 'aluno-ajudante@test.com';
    const password = 'Abcd1234';

    const registered = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, fullName: 'Aluno Ajudante', password })
      .expect(201);
    expect(registered.body.user.role).toBe('THERAPIST');

    // Antes da aprovação, o gerenciador não autentica a conta do app.
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password, panel: 'web' })
      .expect(401);

    // Senha errada: resposta genérica, nenhuma solicitação criada.
    await request(app.getHttpServer())
      .post('/auth/admin-access-request')
      .send({ email, fullName: 'Aluno Ajudante', password: 'Errada1234' })
      .expect(201)
      .expect((res) => {
        expect(res.body.message).toMatch(/solicitação será analisada/i);
      });
    expect(await prisma.adminAccessRequest.count({ where: { email } })).toBe(0);

    await request(app.getHttpServer())
      .post('/auth/admin-access-request')
      .send({ email, fullName: 'Aluno Ajudante', password })
      .expect(201);

    // Duplicata PENDING: mensagem genérica, sem novo registro.
    await request(app.getHttpServer())
      .post('/auth/admin-access-request')
      .send({ email, fullName: 'Aluno Ajudante', password })
      .expect(201);

    const appAccount = await prisma.therapist.findUniqueOrThrow({
      where: { email },
    });
    const stored = await prisma.adminAccessRequest.findMany({
      where: { email },
    });
    expect(stored).toHaveLength(1);
    expect(stored[0].therapistId).toBe(appAccount.id);

    const approved = await request(app.getHttpServer())
      .post(`/admin/access-requests/${stored[0].id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    expect(approved.body).toMatchObject({
      id: appAccount.id,
      role: 'ASSISTANT',
      notificationSent: true,
    });

    const accounts = await prisma.therapist.findMany({ where: { email } });
    expect(accounts).toHaveLength(1);
    expect(accounts[0].role).toBe('ASSISTANT');
    expect(accounts[0].mustChangePassword).toBe(false);

    const promoteAudit = await prisma.adminAuditLog.findFirst({
      where: { action: 'PROMOTE_ASSISTANT', targetId: appAccount.id },
    });
    expect(promoteAudit).not.toBeNull();

    // Mesma senha no gerenciador e no app.
    const webLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password, panel: 'web' })
      .expect(201);
    expect(webLogin.body.user.role).toBe('ASSISTANT');
    expect(webLogin.body.user.mustChangePassword).toBe(false);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);

    // Aluno promovido não consegue criar segunda conta no app com o mesmo e-mail.
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, fullName: 'Aluno Duplicado', password })
      .expect(409);

    const revoked = await request(app.getHttpServer())
      .post(`/admin/assistants/${appAccount.id}/revoke`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    expect(revoked.body).toEqual({ id: appAccount.id, role: 'THERAPIST' });

    const revokeAudit = await prisma.adminAuditLog.findFirst({
      where: { action: 'REVOKE_ASSISTANT', targetId: appAccount.id },
    });
    expect(revokeAudit).not.toBeNull();

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password, panel: 'web' })
      .expect(401);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);

    await prisma.therapist.delete({ where: { id: appAccount.id } });
  });

  it('POST /admin/access-requests/:id/reject marca REJECTED, audita e avisa por e-mail', async () => {
    const created = await prisma.adminAccessRequest.create({
      data: {
        email: 'fisio-admin-b@test.com',
        fullName: 'Reject Me',
        therapistId: therapistBId,
      },
    });

    const rejected = await request(app.getHttpServer())
      .post(`/admin/access-requests/${created.id}/reject`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    expect(rejected.body.status).toBe('REJECTED');
    expect(rejected.body.notificationSent).toBe(true);

    const stored = await prisma.adminAccessRequest.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(stored.status).toBe('REJECTED');
    expect(stored.resolvedById).toBe(adminId);

    const rejectAudit = await prisma.adminAuditLog.findFirst({
      where: { action: 'REJECT_ACCESS_REQUEST', targetId: created.id },
    });
    expect(rejectAudit).toMatchObject({
      adminId,
      targetType: 'AccessRequest',
      metadata: { fullName: 'Reject Me', email: 'fisio-admin-b@test.com' },
    });

    const account = await prisma.therapist.findUniqueOrThrow({
      where: { id: therapistBId },
    });
    expect(account.role).toBe('THERAPIST');
  });

  it('approve retorna 409 para solicitação antiga sem conta do app vinculada', async () => {
    const created = await prisma.adminAccessRequest.create({
      data: { email: 'legado@test.com', fullName: 'Pedido Legado' },
    });

    await request(app.getHttpServer())
      .post(`/admin/access-requests/${created.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);

    const stored = await prisma.adminAccessRequest.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(stored.status).toBe('PENDING');
  });

  it('revoke retorna 409 para conta que não é ajudante e 403 para ASSISTANT', async () => {
    await request(app.getHttpServer())
      .post(`/admin/assistants/${therapistAId}/revoke`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);

    await request(app.getHttpServer())
      .post(`/admin/assistants/${adminId}/revoke`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);

    const assistant = await prisma.therapist.create({
      data: {
        email: 'ajudante-revoke@test.com',
        fullName: 'Ajudante Revoke',
        passwordHash: await hashPassword('Abcd1234'),
        role: TherapistRole.ASSISTANT,
      },
    });

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: assistant.email, password: 'Abcd1234', panel: 'web' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/admin/assistants/${assistant.id}/revoke`)
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(403);

    await prisma.therapist.delete({ where: { id: assistant.id } });
  });

  it('ADMIN (professora) pode listar/aprovar solicitações de acesso', async () => {
    const manager = await prisma.therapist.create({
      data: {
        email: 'professora-acesso@test.com',
        fullName: 'Professora Acesso',
        passwordHash: await hashPassword('Abcd1234'),
        role: TherapistRole.ADMIN,
      },
    });

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: manager.email, password: 'Abcd1234', panel: 'web' })
      .expect(201);

    expect(login.body.user.canManageAccessRequests).toBe(true);

    await request(app.getHttpServer())
      .get('/admin/access-requests')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);

    await prisma.therapist.delete({ where: { id: manager.id } });
  });

  it('ASSISTANT não pode listar/aprovar solicitações de acesso, mas pode ver audit-logs (leitura)', async () => {
    const assistant = await prisma.therapist.create({
      data: {
        email: 'ajudante-sem-permissao@test.com',
        fullName: 'Ajudante Sem Permissão',
        passwordHash: await hashPassword('Abcd1234'),
        role: TherapistRole.ASSISTANT,
      },
    });

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: assistant.email, password: 'Abcd1234', panel: 'web' })
      .expect(201);

    expect(login.body.user.canManageAccessRequests).toBe(false);

    await request(app.getHttpServer())
      .get('/admin/access-requests')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(403);

    const pending = await prisma.adminAccessRequest.create({
      data: {
        email: 'pedido@test.com',
        fullName: 'Pedido Teste',
      },
    });

    await request(app.getHttpServer())
      .post(`/admin/access-requests/${pending.id}/approve`)
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .get('/admin/audit-logs')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);

    await prisma.therapist.delete({ where: { id: assistant.id } });
  });

  describe('escopo por hierarquia (ADMIN/ASSISTANT)', () => {
    let managerId: string;
    let managerToken: string;
    let assistantId: string;
    let assistantToken: string;
    let scopedTherapistId: string;

    beforeAll(async () => {
      const manager = await prisma.therapist.create({
        data: {
          email: 'professora-escopo@test.com',
          fullName: 'Professora Escopo',
          passwordHash: await hashPassword('Abcd1234'),
          role: TherapistRole.ADMIN,
        },
      });
      managerId = manager.id;

      const assistant = await prisma.therapist.create({
        data: {
          email: 'ajudante-escopo@test.com',
          fullName: 'Ajudante Escopo',
          passwordHash: await hashPassword('Abcd1234'),
          role: TherapistRole.ASSISTANT,
        },
      });
      assistantId = assistant.id;

      const scopedTherapist = await prisma.therapist.create({
        data: {
          email: 'fisio-escopo@test.com',
          fullName: 'Fisio Escopo',
          passwordHash: await hashPassword('Abcd1234'),
        },
      });
      scopedTherapistId = scopedTherapist.id;

      const managerLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: manager.email, password: 'Abcd1234', panel: 'web' })
        .expect(201);
      managerToken = managerLogin.body.accessToken;

      const assistantLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: assistant.email, password: 'Abcd1234', panel: 'web' })
        .expect(201);
      assistantToken = assistantLogin.body.accessToken;
    });

    afterAll(async () => {
      await prisma.therapist.deleteMany({
        where: { id: { in: [managerId, assistantId, scopedTherapistId] } },
      });
    });

    it('ADMIN vê a própria conta, mas não pode excluí-la', async () => {
      await request(app.getHttpServer())
        .get(`/admin/therapists/${managerId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/admin/therapists/${managerId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(403);
    });

    it('ADMIN pode listar filtrando por role=ASSISTANT e role=ADMIN', async () => {
      await request(app.getHttpServer())
        .get('/admin/therapists')
        .query({ role: 'ASSISTANT' })
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);

      const admins = await request(app.getHttpServer())
        .get('/admin/therapists')
        .query({ role: 'ADMIN' })
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);
      expect(
        admins.body.data.some((t: { id: string }) => t.id === managerId),
      ).toBe(true);
    });

    it('ASSISTANT vê todas as contas (com pacientes), mas só gerencia THERAPIST', async () => {
      const list = await request(app.getHttpServer())
        .get('/admin/therapists')
        .set('Authorization', `Bearer ${assistantToken}`)
        .expect(200);

      const ids = list.body.data.map((t: { id: string }) => t.id);
      expect(ids).toEqual(
        expect.arrayContaining([managerId, assistantId, scopedTherapistId]),
      );

      await request(app.getHttpServer())
        .get('/admin/therapists')
        .query({ role: 'ASSISTANT' })
        .set('Authorization', `Bearer ${assistantToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/admin/therapists/${managerId}`)
        .set('Authorization', `Bearer ${assistantToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/admin/therapists/${managerId}`)
        .set('Authorization', `Bearer ${assistantToken}`)
        .expect(403);

      await request(app.getHttpServer())
        .delete(`/admin/therapists/${assistantId}`)
        .set('Authorization', `Bearer ${assistantToken}`)
        .expect(403);
    });

    it('ASSISTANT pode excluir THERAPIST sem pacientes', async () => {
      await request(app.getHttpServer())
        .delete(`/admin/therapists/${scopedTherapistId}`)
        .set('Authorization', `Bearer ${assistantToken}`)
        .expect(204);

      const stored = await prisma.therapist.findUnique({
        where: { id: scopedTherapistId },
      });
      expect(stored).toBeNull();
    });
  });

  it('POST /admin/therapists não existe — conta ADMIN só via script admin:set', async () => {
    await request(app.getHttpServer())
      .post('/admin/therapists')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'nova-professora@test.com', fullName: 'Nova Professora' })
      .expect(404);
  });
});
