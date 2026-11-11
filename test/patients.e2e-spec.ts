import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { existsSync } from 'fs';
import { join } from 'path';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Patients (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    prisma = moduleFixture.get(PrismaService);
    await app.init();

    const fisioA = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        fullName: 'Fisio A',
        email: 'fisio-a@test.com',
        password: 'Abcd1234',
      })
      .expect(201);

    tokenA = fisioA.body.accessToken;

    const fisioB = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        fullName: 'Fisio B',
        email: 'fisio-b@test.com',
        password: 'Abcd1234',
      })
      .expect(201);

    tokenB = fisioB.body.accessToken;
  });

  afterEach(async () => {
    await prisma.assessmentResult.deleteMany();
    await prisma.assessment.deleteMany();
    await prisma.patient.deleteMany();
  });

  afterAll(async () => {
    await prisma.assessmentResult.deleteMany();
    await prisma.assessment.deleteMany();
    await prisma.patient.deleteMany();
    await prisma.passwordResetToken.deleteMany();
    await prisma.therapist.deleteMany();
    await app.close();
  });

  it('GET /patients exige JWT', async () => {
    await request(app.getHttpServer()).get('/patients').expect(401);
  });

  it('POST /patients exige JWT', async () => {
    await request(app.getHttpServer())
      .post('/patients')
      .send({
        fullName: 'João Idoso',
        age: 80,
        gender: 'masculino',
        contact: '(82) 9 8888-7777',
      })
      .expect(401);
  });

  it('GET /patients lista somente pacientes do therapist autenticado', async () => {
    await request(app.getHttpServer())
      .post('/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        fullName: 'Maria de Luordes',
        age: 75,
        gender: 'feminino',
        contact: 'maria@email.com',
        schoolingBand: '9_11_anos',
      })
      .expect(201);

    const listA = await request(app.getHttpServer())
      .get('/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(listA.body.data).toHaveLength(1);
    expect(listA.body.data[0]?.fullName).toBe('Maria de Luordes');
    expect(listA.body.meta.total).toBe(1);

    const listB = await request(app.getHttpServer())
      .get('/patients')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    expect(listB.body.data).toHaveLength(0);
  });

  it('GET /patients/:id retorna perfil apenas para o therapist dono', async () => {
    const created = await request(app.getHttpServer())
      .post('/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        fullName: 'João Perfil',
        age: 81,
        gender: 'masculino',
        contact: '(82) 9 3333-4444',
        schoolingBand: '5_8_anos',
      })
      .expect(201);

    const profile = await request(app.getHttpServer())
      .get(`/patients/${created.body.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(profile.body.fullName).toBe('João Perfil');
    expect(profile.body.schoolingBand).toBe('5_8_anos');

    await request(app.getHttpServer())
      .get(`/patients/${created.body.id}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
  });

  it('POST /patients grava paciente no therapist autenticado', async () => {
    const response = await request(app.getHttpServer())
      .post('/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        fullName: 'Maria de Luordes',
        age: 75,
        gender: 'feminino',
        contact: 'maria@email.com',
        schoolingBand: '1_4_anos',
      })
      .expect(201);

    expect(response.body.fullName).toBe('Maria de Luordes');
    expect(response.body.id).toBeDefined();

    const stored = await prisma.patient.findMany({
      include: { therapist: { select: { email: true } } },
    });

    expect(stored).toHaveLength(1);
    expect(stored[0]?.therapist.email).toBe('fisio-a@test.com');
    expect(stored[0]?.fullName).toBe('Maria de Luordes');
  });

  it('dois fisioterapeutas isolam pacientes por therapist_id', async () => {
    await request(app.getHttpServer())
      .post('/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        fullName: 'Paciente A',
        age: 70,
        gender: 'masculino',
        contact: '(82) 9 1111-1111',
        schoolingBand: 'analfabeto',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/patients')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        fullName: 'Paciente B',
        age: 68,
        gender: 'feminino',
        contact: '(82) 9 2222-2222',
        schoolingBand: 'mais_11_anos',
      })
      .expect(201);

    const patientsA = await prisma.patient.findMany({
      where: { therapist: { email: 'fisio-a@test.com' } },
    });
    const patientsB = await prisma.patient.findMany({
      where: { therapist: { email: 'fisio-b@test.com' } },
    });

    expect(patientsA).toHaveLength(1);
    expect(patientsB).toHaveLength(1);
    expect(patientsA[0]?.fullName).toBe('Paciente A');
    expect(patientsB[0]?.fullName).toBe('Paciente B');
  });

  it('GET /patients/:id/assessments lista avaliações finalizadas do paciente', async () => {
    const patient = await request(app.getHttpServer())
      .post('/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        fullName: 'Paciente Histórico',
        age: 79,
        gender: 'masculino',
        contact: '(82) 9 5555-6666',
        schoolingBand: '9_11_anos',
      })
      .expect(201);

    const patientId = patient.body.id as string;

    const tugDraft = await request(app.getHttpServer())
      .post('/assessments/draft')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ patientId, instrumentCode: 'TUG' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/assessments/${tugDraft.body.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        payload: { trial1Sec: 10, trial2Sec: 11, trial3Sec: 12 },
      })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/assessments/${tugDraft.body.id}/finalize`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(201);

    const bergDraft = await request(app.getHttpServer())
      .post('/assessments/draft')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ patientId, instrumentCode: 'BERG' })
      .expect(201);

    const bergPayload = Object.fromEntries(
      Array.from({ length: 14 }, (_, index) => [`berg_${index + 1}`, 3]),
    );

    await request(app.getHttpServer())
      .patch(`/assessments/${bergDraft.body.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ payload: bergPayload })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/assessments/${bergDraft.body.id}/finalize`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(201);

    const list = await request(app.getHttpServer())
      .get(`/patients/${patientId}/assessments`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(list.body.data).toHaveLength(2);
    expect(list.body.data[0]?.instrumentCode).toBe('BERG');
    expect(list.body.data[0]?.result?.rawLabel).toBeDefined();
    expect(list.body.data[1]?.instrumentCode).toBe('TUG');

    await request(app.getHttpServer())
      .get(`/patients/${patientId}/assessments`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
  });

  it('GET /patients/:id/assessments/:assessmentId retorna detalhe com timeseries', async () => {
    const patient = await request(app.getHttpServer())
      .post('/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        fullName: 'Paciente Detalhe',
        age: 77,
        gender: 'feminino',
        contact: '(82) 9 7777-8888',
        schoolingBand: '5_8_anos',
      })
      .expect(201);

    const patientId = patient.body.id as string;

    const draft = await request(app.getHttpServer())
      .post('/assessments/draft')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ patientId, instrumentCode: 'TUG' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/assessments/${draft.body.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        payload: { trial1Sec: 9, trial2Sec: 10, trial3Sec: 11 },
      })
      .expect(200);

    const finalized = await request(app.getHttpServer())
      .post(`/assessments/${draft.body.id}/finalize`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(201);

    const detail = await request(app.getHttpServer())
      .get(`/patients/${patientId}/assessments/${finalized.body.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(detail.body.instrumentCode).toBe('TUG');
    expect(detail.body.result.rawValue).toBe(10);
    expect(detail.body.timeseries.canShowChart).toBe(false);
    expect(detail.body.timeseries.points).toHaveLength(1);
  });

  it('GET /patients filtra por sexo e ordena por idade', async () => {
    await request(app.getHttpServer())
      .post('/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        fullName: 'Ana Silva',
        age: 70,
        gender: 'feminino',
        contact: '(82) 9 1111-2222',
        schoolingBand: '1_4_anos',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        fullName: 'Bruno Costa',
        age: 80,
        gender: 'masculino',
        contact: '(82) 9 3333-4444',
        schoolingBand: '5_8_anos',
      })
      .expect(201);

    const femaleOnly = await request(app.getHttpServer())
      .get('/patients?gender=feminino')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(
      femaleOnly.body.data.every(
        (item: { gender: string }) => item.gender === 'feminino',
      ),
    ).toBe(true);

    const byAgeDesc = await request(app.getHttpServer())
      .get('/patients?sortBy=age&sortOrder=desc')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(byAgeDesc.body.data[0]?.age).toBeGreaterThanOrEqual(
      byAgeDesc.body.data[1]?.age ?? 0,
    );
  });

  it('PATCH /patients/:id remove a foto salva com removeAvatar', async () => {
    const tinyPng =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const base = {
      fullName: 'Joana Lima',
      age: 70,
      gender: 'feminino',
      contact: '(82) 9 1111-2222',
      schoolingBand: '9_11_anos',
    };

    const created = await request(app.getHttpServer())
      .post('/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        ...base,
        avatarImage: { mimeType: 'image/png', base64: tinyPng },
      })
      .expect(201);

    const avatarPath = join(
      process.cwd(),
      'uploads',
      'patients',
      `${created.body.id}.png`,
    );
    expect(created.body.avatarUrl).toBe(
      `/uploads/patients/${created.body.id}.png`,
    );
    expect(existsSync(avatarPath)).toBe(true);

    await request(app.getHttpServer())
      .patch(`/patients/${created.body.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        ...base,
        removeAvatar: true,
        avatarImage: { mimeType: 'image/png', base64: tinyPng },
      })
      .expect(400);

    const updated = await request(app.getHttpServer())
      .patch(`/patients/${created.body.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ ...base, removeAvatar: true })
      .expect(200);

    expect(updated.body.avatarUrl).toBeNull();
    expect(existsSync(avatarPath)).toBe(false);

    const stored = await prisma.patient.findUnique({
      where: { id: created.body.id },
    });
    expect(stored?.avatarUrl).toBeNull();
  });
});
