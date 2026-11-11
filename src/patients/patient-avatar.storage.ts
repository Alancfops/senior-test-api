import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';

import { AvatarImageInput } from './schemas/patient.schemas';

const UPLOADS_DIR = join(process.cwd(), 'uploads', 'patients');

export async function savePatientAvatar(
  patientId: string,
  image: AvatarImageInput,
): Promise<string> {
  const extension = image.mimeType === 'image/png' ? 'png' : 'jpg';
  const fileName = `${patientId}.${extension}`;
  const absolutePath = join(UPLOADS_DIR, fileName);

  // Aceita base64 puro ou data-URL (`data:image/jpeg;base64,...`).
  const rawBase64 = image.base64.includes(',')
    ? image.base64.slice(image.base64.indexOf(',') + 1)
    : image.base64;

  await mkdir(UPLOADS_DIR, { recursive: true });
  await writeFile(absolutePath, Buffer.from(rawBase64, 'base64'));

  return `/uploads/patients/${fileName}`;
}

/** Apaga o arquivo da foto (jpg ou png); não falha se já não existir. */
export async function removePatientAvatar(patientId: string): Promise<void> {
  await Promise.all(
    ['jpg', 'png'].map((extension) =>
      rm(join(UPLOADS_DIR, `${patientId}.${extension}`), { force: true }),
    ),
  );
}
