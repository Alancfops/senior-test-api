# STF API — Sênior Teste Funcional

API **NestJS + Prisma + PostgreSQL** do Sênior Teste Funcional. Atende o app mobile ([senior-test-funcional](https://github.com/Alancfops/senior-test-funcional)) e o painel admin ([stf-gerenciador-web](https://github.com/Alancfops/stf-gerenciador-web)).

## O ecossistema STF

O STF são três repositórios, clonados lado a lado na mesma pasta. **Esta API é o centro:** os outros dois são clientes que só exibem o que ela devolve.

| Sistema | Quem usa | O que faz |
|---------|----------|-----------|
| **STF API** (este repo) | Os dois clientes abaixo | Contas e login (JWT), pacientes, avaliações, cálculo de pontuação e classificação dos instrumentos (TUG, Katz, Berg, Tinetti, MEEM), geração de PDF, e-mails (recuperação de senha, senha temporária), permissões e trilha de auditoria |
| **App mobile** (`../senior-test-funcional`) | Fisioterapeutas (alunos) — papel `THERAPIST` | Cadastrar pacientes, aplicar os testes, ver histórico/gráfico e baixar o PDF. Cada aluno só enxerga os próprios pacientes |
| **Gerenciador web** (`../stf-gerenciador-web`) | Professora (`ADMIN`) e ajudantes (`ASSISTANT`) | Supervisão de toda a equipe pelas rotas `/admin/*`: transferir/excluir, aprovar ajudantes, relatórios individuais e geral, auditoria |

```
App mobile ──┐  /auth, /patients, /assessments, /reports
             ├──► STF API (NestJS) ──► PostgreSQL
Gerenciador ─┘  /auth, /admin/*
```

Toda regra clínica (pontuação, interpretação, PDF) vive **só aqui** — nenhum cliente a duplica.

## Início rápido

Pré-requisitos: Node.js LTS, Docker (Postgres) e `make`.

```bash
make setup      # primeira vez: deps, .env, Postgres
make migrate    # migrations Prisma
make start      # Postgres + API em watch (http://localhost:3000)
```

Swagger (dev): [http://localhost:3000/api/docs](http://localhost:3000/api/docs) · Health: `curl http://localhost:3000/health`

Com a API rodando, suba os clientes nos repositórios deles: `make start-frontend` no app (Expo) e `npm run dev` no gerenciador.

## Configuração

`make setup` cria `.env` a partir de `.env.example`:

| Variável | Uso |
|----------|-----|
| `DATABASE_URL` | PostgreSQL (Docker: `senior:senior@localhost:5432/senior_test`) |
| `JWT_ACCESS_SECRET` | Segredo JWT — `make secrets` |
| `MAIL_PROVIDER` | `gmail`, `console` (código no terminal) ou `resend` |
| `CORS_ORIGINS` | Origens do gerenciador web (ex.: `http://localhost:5173`) |

Verifique o e-mail (RF003): `make mail-check`.

## Comandos

| Comando | Descrição |
|---------|-----------|
| `make start` | Postgres + API em watch |
| `make db-up` / `make db-down` | Sobe / para o Postgres |
| `make migrate` / `make generate` | `prisma migrate dev` / `prisma generate` |
| `make test` | Unitários + e2e (banco isolado `senior_test_e2e`) |
| `make lint` | ESLint |
| `npm run admin:set -- --email <e-mail> --name "<nome>"` | Define/recupera a conta da professora (ADMIN) |

## Documentação

| Tema | Onde |
|------|------|
| Comportamento da API (RFs) | [docs/backend/README.md](docs/backend/README.md) |
| Modelo de dados | [docs/engineering/data-model.md](docs/engineering/data-model.md) |
| Protocolos clínicos (TUG, Katz, Berg, Tinetti, MEEM) | `senior-test-funcional/docs/clinical-protocols/` — especificação de produto, fica no repo do app |
| Regras do backend | [docs/rules/](docs/rules/) |
| Contrato admin (`/admin/*`) | `stf-gerenciador-web/docs/contracts/admin-api.md` |
| Requisitos e LGPD | `senior-test-funcional/docs/product/` |
