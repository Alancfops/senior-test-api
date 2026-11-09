-- Excluir uma conta (ex.: aluno que já baixou PDF no app) não pode falhar por
-- causa da trilha de auditoria. O log é append-only: em vez de bloquear a
-- exclusão (RESTRICT), o autor passa a ser nulo e o registro é preservado.
ALTER TABLE "admin_audit_logs" DROP CONSTRAINT "admin_audit_logs_admin_id_fkey";

ALTER TABLE "admin_audit_logs" ALTER COLUMN "admin_id" DROP NOT NULL;

ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "therapists"("id") ON DELETE SET NULL ON UPDATE CASCADE;
