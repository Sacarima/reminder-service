#  Reminder Service

A **NestJS microservice** (API + Worker) that powers **timezone-aware appointment reminders** for the MediPulso platform. When a patient books an appointment, the service schedules reminders and delivers them via **Email/SMS** (24h and 2h before the visit) using a resilient job queue.

---

## Features

- **API + Worker separation** – scale independently for clean isolation.
- **Event-driven** – consumes `appointment.created` and related events from MediPulso.
- **Queue orchestration** – Redis + BullMQ with delayed jobs, retries, priorities, and exponential backoff.
- **Timezone-aware scheduling** – powered by Luxon; clamps reminders to local windows (e.g. 10:00–19:00).
- **Persistence** – PostgreSQL + Prisma for appointments, schedules, and delivery logs.
- **Email/SMS delivery** – Nodemailer + MailHog in dev; SendGrid/Mailgun and Twilio in production.
- **Observability** – OpenTelemetry tracing/metrics, Prometheus/Grafana dashboards, Sentry error tracking.
- **Secrets/config** – `.env` in dev; Vault/SOPS or cloud secret manager in prod.
- **Dockerized** – production-ready container builds with health/readiness checks.

---

## Architecture

## 📂 Project Structure

```text
reminder-service/
│
├── apps/
│   ├── reminder-api/     # API (accepts events, schedules reminders)
│   └── reminder-worker/  # Worker (processes queue, sends reminders)
│
├── prisma/
│   └── schema.prisma     # Postgres schema (appointments, schedules, delivery_log)
│
├── src/                  # Shared libs, DTOs, utils
│
├── docker/               # Dockerfiles and configs
│
├── .env.example          # Example environment variables
├── package.json
└── README.md


---

##  Tech Stack

- **Backend**: [NestJS](https://nestjs.com/) + TypeScript
- **Database**: PostgreSQL + [Prisma](https://www.prisma.io/)
- **Queue**: Redis + [BullMQ](https://docs.bullmq.io/)
- **Date/Time**: [Luxon](https://moment.github.io/luxon/)
- **Email**: Nodemailer (dev) / SendGrid, Mailgun (prod)
- **SMS**: Twilio (prod)
- **Observability**: OpenTelemetry · Prometheus/Grafana · Sentry
- **Containers**: Docker

---

##  Project Structure

---

##  Development

Start API & Worker locally:

# API

npm run start:dev reminder-api

# Worker

npm run start:dev reminder-worker

brew install mailhog # macOS
mailhog

# Open: http://localhost:8025

## 🐳 Docker

Build & run services:

docker-compose up --build

##  Testing

npm run test
npm run test:e2e

## 📜 License

This project is licensed under the **MIT License**.

MIT © 2025 MediPulso Team
