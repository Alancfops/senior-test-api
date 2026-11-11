import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import {
  removePatientAvatar,
  savePatientAvatar,
} from './patient-avatar.storage';
import {
  CreatePatientInput,
  ListPatientsQuery,
  UpdatePatientInput,
} from './schemas/patient.schemas';

export type PatientResponse = {
  id: string;
  fullName: string;
  age: number;
  gender: string;
  contact: string;
  schoolingBand: string | null;
  avatarUrl: string | null;
  createdAt: string;
};

export type PatientsListResponse = {
  data: PatientResponse[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

@Injectable()
export class PatientsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    therapistId: string,
    input: CreatePatientInput,
  ): Promise<PatientResponse> {
    const patient = await this.prisma.patient.create({
      data: {
        therapistId,
        fullName: input.fullName.trim(),
        age: input.age,
        gender: input.gender,
        contact: input.contact.trim(),
        schoolingBand: input.schoolingBand,
      },
    });

    if (input.avatarImage) {
      const avatarUrl = await savePatientAvatar(patient.id, input.avatarImage);
      const updated = await this.prisma.patient.update({
        where: { id: patient.id },
        data: { avatarUrl },
      });
      return this.toResponse(updated);
    }

    return this.toResponse(patient);
  }

  async update(
    therapistId: string,
    patientId: string,
    input: UpdatePatientInput,
  ): Promise<PatientResponse> {
    const existing = await this.prisma.patient.findFirst({
      where: { id: patientId, therapistId },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Paciente não encontrado.');
    }

    const patient = await this.prisma.patient.update({
      where: { id: patientId },
      data: {
        fullName: input.fullName.trim(),
        age: input.age,
        gender: input.gender,
        contact: input.contact.trim(),
        schoolingBand: input.schoolingBand,
        ...(input.removeAvatar ? { avatarUrl: null } : {}),
      },
    });

    if (input.removeAvatar) {
      await removePatientAvatar(patient.id);
    }

    if (input.avatarImage) {
      const avatarUrl = await savePatientAvatar(patient.id, input.avatarImage);
      const updated = await this.prisma.patient.update({
        where: { id: patient.id },
        data: { avatarUrl },
      });
      return this.toResponse(updated);
    }

    return this.toResponse(patient);
  }

  async findById(
    therapistId: string,
    patientId: string,
  ): Promise<PatientResponse> {
    const patient = await this.prisma.patient.findFirst({
      where: {
        id: patientId,
        therapistId,
      },
    });

    if (!patient) {
      throw new NotFoundException('Paciente não encontrado.');
    }

    return this.toResponse(patient);
  }

  async list(
    therapistId: string,
    query: ListPatientsQuery,
  ): Promise<PatientsListResponse> {
    const search = query.search?.trim();
    const where = {
      therapistId,
      ...(search
        ? {
            fullName: {
              contains: search,
              mode: 'insensitive' as const,
            },
          }
        : {}),
      ...(query.gender ? { gender: query.gender } : {}),
    };

    const [total, patients] = await Promise.all([
      this.prisma.patient.count({ where }),
      this.prisma.patient.findMany({
        where,
        orderBy: { [query.sortBy]: query.sortOrder },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    const totalPages = total === 0 ? 0 : Math.ceil(total / query.limit);

    return {
      data: patients.map((patient) => this.toResponse(patient)),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages,
      },
    };
  }

  private toResponse(patient: {
    id: string;
    fullName: string;
    age: number;
    gender: string;
    contact: string;
    schoolingBand: string | null;
    avatarUrl: string | null;
    createdAt: Date;
  }): PatientResponse {
    return {
      id: patient.id,
      fullName: patient.fullName,
      age: patient.age,
      gender: patient.gender,
      contact: patient.contact,
      schoolingBand: patient.schoolingBand,
      avatarUrl: patient.avatarUrl,
      createdAt: patient.createdAt.toISOString(),
    };
  }
}
