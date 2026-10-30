-- Geração do relatório geral (agregado, sem paciente) passa a ser auditada.
-- AlterEnum
ALTER TYPE "AdminAuditAction" ADD VALUE 'DOWNLOAD_GENERAL_REPORT';
