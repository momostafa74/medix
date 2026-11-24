# Medix — منصة خدمات طبية

Medical services marketplace for Egypt: patients find doctors (and labs, radiology centers, pharmacies), book real schedule slots, and manage their medical record; providers run their schedule and appointments; admins approve providers and watch the platform.

**Arabic RTL first**, English-ready (i18n layer in `frontend/src/i18n`).

> **ملخص سريع بالعربي**
> - التشغيل المحلي: شغّل PostgreSQL، ثم `cd backend && npm i && cp .env.example .env && npm run migration:run && npm run seed && npm run start:dev`، وفي ترمينال تاني `cd frontend && npm i && npm run dev` وافتح http://localhost:5173
> - لا توجد بيانات تجريبية: الـ seed يضيف الصلاحيات، حساب السوبر أدمن (من `SEED_ADMIN_*`)، الباقات، المواقع، التخصصات وكتالوج الأدوية فقط.
> - التسليم ده يغطي **المراحل الثمانية كلها**: المعامل، مراكز الأشعة، الروشتات والصيدليات، الدفع والعمولة والكوبونات واشتراكات مقدمي الخدمة، والتحليلات المتقدمة والأمان (التحقق بخطوتين وقفل الحساب) وسجل المراجعة وصحة النظام.
> - **الاشتراكات:** الدكاترة والمعامل ومراكز الأشعة والصيدليات ليهم اشتراك (شهري افتراضياً) — لو خلص ومدفعش بعد فترة السماح، الحساب يتقفل (يقدر يدخل بس على صفحة التجديد) ويختفي من البحث والحجز. المريض مجاني دائماً، وبيسجل برقم الموبايل وكلمة سر بس.
> - للتحديث من نسخة سابقة: `npm run migration:run` ثم `npm run seed -- --rbac-only`.
> - تقارير الـ PDF العربي والروشتات محتاجة Chromium على السيرفر (موجود تلقائياً في Docker؛ على Ubuntu: `sudo apt install chromium-browser`).

---

## Contents
1. [Delivery status](#1-delivery-status)
2. [Architecture](#2-architecture)
3. [Folder structure](#3-folder-structure)
4. [Requirements](#4-requirements)
5. [Setup & development](#5-setup--development)
6. [Environment variables](#6-environment-variables)
7. [Database, migrations & seed](#7-database-migrations--seed)
8. [First login](#8-first-login)
9. [Commands](#9-commands)
10. [Production build & deployment](#10-production-build--deployment)
11. [Backup & restore](#11-backup--restore)
12. [API documentation](#12-api-documentation)
13. [Roles & permissions](#13-roles--permissions)
14. [Security checklist](#14-security-checklist)
15. [Design system](#15-design-system)
16. [Laboratories (Phase 4)](#16-laboratories-phase-4)
17. [Radiology (Phase 5)](#17-radiology-phase-5)
18. [Prescriptions & pharmacies (Phase 6)](#18-prescriptions--pharmacies-phase-6)
19. [Payments, coupons & subscriptions (Phase 7)](#19-payments-coupons--subscriptions-phase-7)
20. [Analytics, security, audit & performance (Phase 8)](#20-analytics-security-audit--performance-phase-8)
21. [Before going live & next steps](#21-before-going-live--next-steps)

---

## 1. Delivery status

| Phase | Scope | Status |
|---|---|---|
| **1** | Project setup, auth (register / login / logout / refresh rotation / forgot / reset / change password / email+phone verification / sessions), users, roles, permissions, patients, doctors, specialties (+ sub-specialties), provider profiles, branches, services, verification documents, admin approval, admin dashboard, audit logs, files | ✅ implemented, tested, connected end-to-end |
| **2** | Doctor schedules (weekly blocks, breaks, holidays, vacations, custom hours, manual slot blocks), availability engine, booking with DB-level double-booking prevention, cancellation, rescheduling, status workflow, patient dashboard, doctor dashboard & reports, CSV export | ✅ implemented, tested, connected end-to-end |
| **3** | Real-time chat (patient ↔ doctor/lab/radiology/pharmacy, admin ↔ provider, support inbox) with typing, presence, read receipts, private attachments, block & report + moderation; notifications (in-app + Socket.IO + email/SMS/WhatsApp adapters, per-user preferences, **global admin rules**); WhatsApp booking; reviews + moderation; favorites | ✅ implemented, tested, connected end-to-end |
| **4** | Laboratories: self sign-up (labs / radiology / pharmacies), per-lab catalog (tests, parameters, gender/age reference ranges, critical limits, categories, packages), cross-lab price comparison, booking at a branch or home collection with per-window capacity, full order workflow (payment → sample collection with barcodes & printable tube labels → receipt → processing → result entry → review / return → approval → delivery), sample rejection & re-collection, server-side flagging, critical-value alerts, four-eyes approval option, professional **Arabic PDF report with QR verification**, public verification page, lab dashboard & reports, lab team accounts, lab results in the medical record for treating doctors, admin lab-order oversight (no medical data) | ✅ implemented, tested, connected end-to-end |
| **5** | Radiology centers: services per modality (price, exam duration, preparation, referral requirement, report template), machines per branch, booking that holds a machine for the whole exam, referral upload, check-in → examination → reporting → approval → delivery, no-show, structured reports (technique / comparison / findings / impression / recommendations, critical flag) with return-for-correction and optional "approver ≠ author", key-image attachments, Arabic PDF report with QR verification, DICOM Accession Number + Study Instance UID at check-in, Modality Worklist JSON feed and PACS link field, center dashboard & reports (services, revenue, branches, turnaround), reports in the medical record, admin oversight without medical data | ✅ implemented, tested, connected end-to-end |
| **6** | E-prescriptions (doctor writer with catalog autocomplete or free text, validity, revoke, A5 Arabic PDF with QR, public verification by state, single dispensing), shared medicines & products catalog with price comparison, alternatives and pharmacy-added items (deduplicated), pharmacy profile & store, cart & checkout (pickup / delivery with fee, free-delivery threshold and minimum), prescription-only rules (e-prescription or uploaded photo), quote orders priced by the pharmacist, "fill this prescription" comparison across pharmacies, order workflow with atomic stock reservation, driver details, live tracking, pharmacist QR/code verification & dispensing, inventory with low-stock tracking, delivery & hours settings, pharmacy dashboard (orders by stage, sales, top items, customers, delivery times, low stock), prescriptions in the medical record, admin order oversight (no medicines) and catalog moderation | ✅ implemented, tested, connected end-to-end |
| Also included | Medical record (patient-owned, provider access by relationship/consent), emergency/nearby page, appointment reminders job | ✅ |
| **7** | Payments: gateway abstraction (Paymob adapter + built-in sandbox), online payment for appointments, lab, radiology and pharmacy orders, desk (cash/card) payments in the same ledger, commission rules with per-payment snapshots, full/partial refunds (automatic on cancellation of online-paid bookings), coupons (all services + subscriptions, limits, atomic redemption), Arabic PDF receipts, provider earnings & balance, settlements, finance dashboard. **Provider subscriptions**: plans per provider type, free trial, reminders, grace period, automatic lockout + hiding when unpaid, renewal online or by InstaPay / Vodafone Cash / bank transfer with receipt review, manual payments & extensions by finance. **Patients:** free, sign up with phone + password only | ✅ implemented, tested, connected end-to-end |
| **8** | **Analytics** for the platform and for every provider: KPIs with comparison to the previous period or the same period last year, trends by day/week/month, service mix, channels, payment methods, specialties, governorates, busiest hours heatmap, booking funnels, monthly patient retention cohorts, gender/age mix, top items, provider leaderboard, Excel export and a one-page Arabic PDF report. **Security:** account lockout after repeated wrong passwords (with owner notification and support unlock), two-step verification (TOTP apps + one-time backup codes, encrypted secrets, optional enforcement for platform staff), new-device sign-in alerts, personal sign-in history, admin security centre (failed logins, suspicious IPs, locked accounts, staff 2FA adoption, force sign-out, 2FA reset). **Audit:** categories, actor/IP/date/record filters, before/after diff, record history, formula-safe CSV export, retention job. **Performance & operations:** response caching with tag invalidation + HTTP cache headers/ETags, gzip, analytics view + new indexes, slow request/query tracking, statement timeout, system health page | ✅ implemented, tested, connected end-to-end |

**Stack note:** the brief allowed *Prisma or TypeORM*. Prisma's engine binaries could not be downloaded in the build environment, so the backend uses **TypeORM 0.3** — real migrations, zero schema drift (verified), and everything was run and tested against PostgreSQL 16. NestJS is written in **TypeScript** (decorators); the frontend is **JavaScript** as required.

**Verified:** 158 automated tests (unit + integration against a real database, incl. real Socket.IO clients), including 10 concurrent patients racing for one slot (exactly one wins), direct SQL inserts rejected by the exclusion constraint, provider isolation, medical-record authorization, file authorization, refresh-token reuse detection, chat isolation (outsiders — even admins — get 404 on private patient↔provider chats), live message/typing/read-receipt delivery, lab capacity under concurrency (5 patients race for a 2-place window — exactly 2 win), the whole lab workflow with role separation, server-side flags, critical alerts, PDF generation and verification; radiology machine capacity (4 patients race for one MRI — exactly 1 wins; overlapping start times disappear for the exam's full duration), referral ownership, the reporting/approval workflow with DICOM identifiers, image privacy before approval; prescriptions only for treated patients, QR/number+phone lookup, 5 concurrent dispense attempts from 2 pharmacies — exactly 1 wins, 3 concurrent confirmations for the last packs — exactly 1 wins and stock never goes negative, cancellation restores stock, prescription-only rules, server-side pricing and delivery rules, pharmacy isolation and metadata-only admin view. Browser end-to-end: login → search → pick slot → book → reschedule; patient ↔ doctor live chat with attachment; compare test prices → book lab tests → technician collects/enters results → manager approves → patient sees results and downloads the PDF; book an MRI → check-in/exam → radiologist writes the report from the template and attaches an image → center manager approves → patient reads the report; doctor writes an e-prescription → patient compares pharmacies for it → checkout → pharmacist confirms (stock reserved) → prepares → out for delivery with driver → delivered (prescription dispensed); pharmacist verifies a prescription by QR code. Phase 7: phone-only patient signup and login; an expired lab is blocked (402) and hidden from search while its staff keep access only to the renewal page; renewal through the sandbox gateway with a 50 % coupon unlocks it instantly; a manual Vodafone Cash transfer is approved by finance; a coupon with one use left raced by 4 patients — exactly 1 wins; a lab order paid online with a coupon (declined card first, then approved) is cancelled and refunded automatically with the commission reversed; desk payments, the most specific commission rule, partial refunds, settlements bringing the balance to zero, PDF receipts and payment isolation. Phase 8: TOTP against the RFC 6238 test vectors, lockout after 5 wrong passwords (the right password is refused while locked) and support unlock, 2FA enrolment/challenge/one-time codes/backup codes/disable, a 2FA challenge token rejected as an access token, support 2FA reset ending all sessions, new-device alerts, staff 2FA enforcement, platform vs provider analytics scopes and numbers, Excel/PDF exports, audit categories/history/CSV, system health permissions, cached public responses invalidated by writes; in the browser: analytics tabs and exports, security centre unlock, audit filters and diff drawer, accountant enrolling 2FA by QR and signing in with a code, the lockout message on mobile, doctor and pharmacy analytics.

## 2. Architecture

```
React SPA (Vite, MUI RTL, React Query)
   │  HTTPS  /api/*  (Bearer access token in memory; refresh token = httpOnly SameSite=Strict cookie)
   │  WSS    /realtime (Socket.IO, JWT handshake)
   ▼
NestJS API ── global guards: Throttler → JWT (principal reloaded from DB) → Permissions
   │          global pipes: Sanitize → ValidationPipe(whitelist, forbidNonWhitelisted)
   │          global filter: friendly Arabic errors, no internals leaked
   │          services: ownership / provider-relationship checks (AccessPolicyService)
   ├── PostgreSQL (TypeORM, migrations only; exclusion constraint for bookings; append-only audit)
   ├── Storage driver (local disk | S3-compatible) — private files streamed only after authorization
   ├── Notification channels (in-app + Socket.IO | email SMTP | SMS adapter | WhatsApp adapter)
   └── Job queue (in-process with retries; same API as BullMQ for later) + cron (reminders)
```

Key design decisions
- **One `providers` table for every provider kind**; type-specific tables (`doctors`, `laboratories`, …) hang off it 1:1. A new provider kind is an enum value, not a redesign.
- **Specialty is data, not a role.** Doctors have one primary + any number of (sub-)specialties.
- **Schedules are stored in clinic-local minutes** (`APP_TIMEZONE`, default `Africa/Cairo`); slots are generated by a pure, unit-tested engine and converted to UTC with Luxon (DST-safe).
- **Booking = validate slot against schedule → per-doctor advisory lock → overlap checks → insert**, with the database exclusion constraint as the final, race-proof guard.
- **The request principal is rebuilt from the database** (10 s cache), so suspension, role changes and logout-all take effect immediately.
- **Admins cannot read medical records by default** — only the patient, and providers with a booking relationship or explicit consent grant. Every access is audited.
- **Chat follows the same privacy rule:** patient↔provider conversations are visible only to the two parties. The platform team can open one only after a participant reports it (read-only, audited as `CHAT_REPORTED_VIEWED`). Support and admin↔provider rooms form a shared team inbox (`chat.support`).

## 3. Folder structure

```
medix/
├── backend/                         NestJS API (TypeScript)
│   ├── src/
│   │   ├── main.ts / bootstrap.ts   HTTP setup (helmet, CORS, cookies, validation, Swagger)
│   │   ├── app.module.ts            module wiring + global guards/pipes/filter
│   │   ├── config/                  typed configuration, fails fast on missing secrets
│   │   ├── common/
│   │   │   ├── access/              AccessPolicyService (ownership & relationship checks)
│   │   │   ├── decorators/          @Public, @RequirePermissions, @CurrentUser …
│   │   │   ├── guards/              JWT + permissions guards (+ SubscriptionGuard in modules/subscriptions)
│   │   │   ├── filters/             AllExceptionsFilter (Arabic messages, DB error mapping)
│   │   │   ├── pipes/               input sanitisation
│   │   │   ├── jobs/                background job queue abstraction
│   │   │   ├── utils/               codes, phone normalisation, commission calculator, TOTP + secret encryption, device labels
│   │   │   ├── cache/               CacheService (TTL, tags, single-flight) + public HTTP response cache
│   │   │   └── permissions.ts       permission catalog + role → permission map
│   │   ├── database/
│   │   │   ├── entities/            81 entities + enums
│   │   │   ├── migrations/          Init, IntegrityConstraints (exclusion, checks, trigram, audit trigger), ChatRooms, LabsPhase4, RadiologyPhase5, PharmacyPhase6, CommercePhase7, SecurityAnalyticsPhase8 (+ analytics_bookings view)
│   │   │   ├── seeds/seed.ts        RBAC, locations, specialties, medicines
│   │   │   └── data-source.ts       shared by app and TypeORM CLI
│   │   └── modules/
│   │       ├── auth/                register, login, refresh rotation, reset, verification, sessions
│   │       ├── users/               admin users, staff accounts, roles & permission matrix
│   │       ├── providers/           public search/profile, branches, services, documents, admin approval
│   │       ├── doctors/             doctor search & public profile, own profile
│   │       ├── schedules/           slot-engine.ts, availability, weekly schedule/exceptions/blocks
│   │       ├── appointments/        booking engine, cancel, reschedule, status workflow, reminders cron
│   │       ├── patients/            patient profile, medical record, documents, consent grants, provider views
│   │       ├── specialties/ locations/ files/ reviews/ (+favorites)
│   │       ├── notifications/       service, Socket.IO gateway (auth + presence), email/SMS/WhatsApp adapters, preferences, global rules
│   │       ├── chat/                rooms, messages, typing/read/presence over Socket.IO, block/report/moderation
│   │       ├── labs/                lab-logic.ts (ranges, flags, windows, state machine), catalog, orders, results, dashboard, PDF template
│   │       ├── radiology/           radiology-logic.ts (machine-capacity slots, state machine, DICOM ids), catalog, bookings, reports, worklist, dashboard, PDF template
│   │       ├── prescriptions/ pharmacy/  e-prescriptions, medicines catalog, pharmacy store, orders, inventory
│   │       ├── payments/            payments-logic.ts (coupons, refunds split, balances, HMAC), gateways/ (sandbox, Paymob), checkout, ledger, refunds, receipts, coupons, finance & settlements
│   │       ├── subscriptions/       plans, trial → grace → lockout, renewals (online / transfer review), SubscriptionGuard (402), sync & reminders job
│   │       ├── analytics/           analytics-logic.ts (ranges, comparisons, buckets, cohorts), platform & provider analytics, Excel/PDF export
│   │       ├── security/            security centre, staff 2FA policy guard, audit retention job
│   │       ├── system/              request/SQL metrics, system health
│   │       ├── verify/              public QR verification for every report type
│   │       ├── pdf/                 PdfService — headless Chromium, embedded Arabic font, QR codes
│   │       ├── dashboards/          admin / doctor / patient dashboards + CSV export
│   │       └── audit/ settings/ health/
│   ├── test/unit, test/integration
│   ├── assets/fonts/                IBM Plex Sans Arabic (embedded into PDFs)
│   ├── scripts/export-openapi.ts
│   ├── Dockerfile, .env.example
├── frontend/                        React + Vite (JavaScript)
│   ├── src/
│   │   ├── api/                     axios client (in-memory token, single-flight refresh), shared queries
│   │   ├── auth/                    AuthProvider (session restore, socket), RequireAuth
│   │   ├── components/              SlotPicker, DoctorCard, DataTable, AppointmentsManager, Charts, lab/ (results table, range gauge, status track), payments/ (coupon field, payment panel, subscription banner), …
│   │   ├── layouts/                 PublicLayout, DashboardLayout (patient/doctor/provider/admin nav)
│   │   ├── pages/public|patient|doctor|provider|lab|radiology|admin|chat|shared
│   │   ├── i18n/                    ar (primary) + en dictionaries
│   │   ├── utils/                   formatting (Cairo timezone), labels, WhatsApp links
│   │   ├── theme.js, App.jsx, main.jsx
│   ├── Dockerfile, deploy-nginx.conf, .env.example
├── deploy/                          PM2 ecosystem, host nginx (TLS) config
├── scripts/                         backup.sh, restore.sh, check-backup.sh
├── docs/                            API.md, openapi.json, DATABASE.md
└── docker-compose.yml
```

## 4. Requirements
- Node.js 20+ (built and tested on 22)
- PostgreSQL 14+ (tested on 16) with the bundled `btree_gist`, `pg_trgm`, `uuid-ossp` extensions (standard in every distribution)
- Chromium or Google Chrome for PDF reports (auto-detected; `CHROMIUM_PATH` to override). Included in the Docker image.
- Optional: Docker 24+, PM2, an S3-compatible bucket, SMTP account

## 5. Setup & development

```bash
# 1) Database
createuser -P medix            # password: medix (dev)
createdb -O medix medix
createdb -O medix medix_test   # for integration tests

# 2) API
cd backend
npm install
cp .env.example .env           # set DATABASE_URL, JWT secrets
npm run migration:run
npm run seed                   # roles, permissions, admin, reference data
npm run start:dev              # http://localhost:4000/api  — docs: http://localhost:4000/api/docs

# 3) Web
cd ../frontend
npm install
npm run dev                    # http://localhost:5173 (proxies /api and /socket.io to :4000)
```
On Windows use the same commands in PowerShell; `createuser/createdb` can be replaced with pgAdmin.

## 6. Environment variables

All variables are documented in `backend/.env.example`. The important ones:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✓ | `postgresql://user:pass@host:5432/medix` |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | ✓ | ≥ 32 random chars in production (`openssl rand -base64 48`) — the app refuses to start otherwise |
| `FRONTEND_URL` | ✓ | CORS allow-list (comma-separated) and links in emails |
| `BACKEND_URL` |  | Public API URL |
| `APP_TIMEZONE` |  | Clinic timezone, default `Africa/Cairo` |
| `COOKIE_SECURE` |  | `true` behind HTTPS (default in production) |
| `UPLOAD_STORAGE` |  | `local` (default) or `s3` (+ `S3_*`). Cloudinary has an adapter slot. |
| `SMTP_*` |  | Empty → emails are logged (dev) |
| `WHATSAPP_*` |  | `link` = wa.me deep links (default); `cloud_api` reserved for WhatsApp Business API |
| `PAYMENT_GATEWAY` |  | `sandbox` (default outside production — built-in test checkout page, no real money), `paymob`, or `none` (online payment hidden; desk payments and manual subscription transfers still work). `PAYMENT_SANDBOX_SECRET` signs sandbox links. |
| `PAYMOB_API_KEY`, `PAYMOB_INTEGRATION_ID`, `PAYMOB_IFRAME_ID`, `PAYMOB_HMAC_SECRET` |  | Paymob Accept credentials. Set the dashboard's *transaction processed callback* to `{BACKEND_URL}/api/payments/paymob/callback` and *response callback* to `{BACKEND_URL}/api/payments/paymob/return`. |
| `THROTTLE_TTL`, `THROTTLE_LIMIT` |  | Global rate limit; auth routes have stricter per-route limits (chat sends: 40/min per user) |
| `SEED_ADMIN_*` |  | First super admin (used by `npm run seed -- --rbac-only` in production) |
| `CHROMIUM_PATH` |  | Chromium binary for Arabic PDF reports. Empty = auto-detect (`/usr/bin/chromium(-browser)`, Chrome). Without it, PDF endpoints answer 503 and everything else keeps working. |
| `ENCRYPTION_KEY` | prod | Encrypts two-step-verification secrets at rest (32+ random chars). Defaults to `JWT_REFRESH_SECRET`; changing it later disables existing 2FA enrolments. |
| `SLOW_REQUEST_MS`, `SLOW_QUERY_MS` |  | Requests / SQL statements slower than these (default 1000 / 500 ms) are logged and listed on **صحة النظام** |
| `DB_STATEMENT_TIMEOUT_MS` |  | Hard limit for any single query from the API (default 30000) |
| `CACHE_DISABLED` |  | `true` turns the in-process response cache off (debugging) |

Frontend (`frontend/.env.example`): `VITE_API_URL`, `VITE_SOCKET_URL` — leave empty when the SPA and API share an origin (recommended). **No secrets ever go to the frontend.**

## 7. Database, migrations & seed
Full schema reference: [`docs/DATABASE.md`](docs/DATABASE.md).

```bash
npm run migration:run         # apply pending migrations
npm run migration:revert      # roll back the last migration
npm run migration:generate -- src/database/migrations/AddSomething   # after editing entities
npm run seed                  # RBAC + super admin + plans + reference data (idempotent)
npm run seed -- --reset       # dev only: wipe every table, then seed
npm run seed -- --rbac-only   # production-safe: sync roles/permissions + ensure the super admin
```
**Upgrading from Phase 7 → 8:** `npm i` (adds `exceljs`, `compression`), `npm run migration:run` (lockout and 2FA columns on `users`, reporting indexes, the `analytics_bookings` view) then `npm run seed -- --rbac-only` (adds `analytics.read`, `security.read`, `security.manage`, `system.health`). Set `ENCRYPTION_KEY` before anyone enrols in 2FA.

**Upgrading from Phase 6 → 7:** `npm run migration:run` (payments ledger columns, refunds/commission reversal, coupon fields, `subscription_plans`, `provider_subscriptions`, `subscription_invoices`, `provider_settlements`, discount/coupon on every order type, `users.profile_completed`; **every existing provider starts a 30-day trial**) then `npm run seed -- --rbac-only` (adds the 7 payments/finance/subscription permissions and the default plans). Review plan prices in **المالية → الاشتراكات → الباقات**, set the transfer instructions (`payments.instapay`, `payments.vodafoneCash`, `payments.bankAccount`) in **إعدادات النظام**, and choose `PAYMENT_GATEWAY`.

**Upgrading from Phase 5 → 6:** `npm run migration:run` (prescription validity/dispensing fields, medicine kind/category/barcode + Arabic trigram index, pharmacy delivery rules, order workflow fields, `pharmacy_order_status_history`; existing order lines get a name snapshot) then `npm run seed -- --rbac-only` (adds the 7 `prescriptions.*` / `pharmacy.*` / `medicines.manage` permissions). Pharmacies then add their items from **الأدوية والمخزون** and set delivery rules and hours from **التوصيل والمواعيد**.

**Upgrading from Phase 4 → 5:** `npm run migration:run` (radiology settings, machines per branch, booking/report fields, `NO_SHOW` status — existing bookings are back-filled) then `npm run seed -- --rbac-only` (adds the 6 `radiology.*` permissions). Centers then set their branch hours and machines from **الفروع والأجهزة**.

**Upgrading an existing install (Phase 1–3 → 4):** `npm run migration:run` (adds lab booking/workflow columns, `lab_order_status_history`, branch `opening_hours`) then `npm run seed -- --rbac-only` (adds the 7 `lab.*` permissions to the roles). No data is touched. Existing labs then set their branch hours from **إعدادات الحجز** — a branch without hours is not bookable.

Seed contents (no demo/mock data): 12 roles, 64 permissions, the super admin from `SEED_ADMIN_*`, subscription plans for every provider type, Egypt locations (5 governorates / 12 cities / areas), 14 specialties + 3 sub-specialties, a 10 % global commission rule, the `WELCOME20` coupon, and a shared catalog of 45 medicines & products.

## 8. First login

Sign in with the super admin from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (login accepts phone **or** email). Doctors, labs, radiology centers, pharmacies and patients register from the site; approve providers from the admin dashboard.

Sandbox payment card (`PAYMENT_GATEWAY=sandbox`): any number (prefilled `4242 4242 4242 4242`) is approved; `4000 0000 0000 0002` is declined.

## 9. Commands

| Where | Command | What it does |
|---|---|---|
| backend | `npm run start:dev` | API with watch mode |
| backend | `npm test` | all tests (unit + integration; uses `TEST_DATABASE_URL` or `medix_test`) |
| backend | `npm run test:unit` / `npm run test:int` | one suite type |
| backend | `npm run lint` / `npm run format` | ESLint / Prettier |
| backend | `npx ts-node scripts/export-openapi.ts` | regenerate `docs/openapi.json` |
| frontend | `npm run dev` | Vite dev server with API proxy |
| frontend | `npm run lint` / `npm run format` | ESLint / Prettier |

## 10. Production build & deployment

### Build
```bash
cd backend  && npm ci && npm run build              # → dist/
cd frontend && npm ci && npm run build              # → dist/ (static files, code-split per route)
```

### Option A — Docker Compose (recommended)
```bash
cp backend/.env.example backend/.env   # production values, NODE_ENV=production, COOKIE_SECURE=true
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" > .env
docker compose up -d --build           # db + api (runs migrations on start) + web on :8080
docker compose exec backend npm run seed:prod -- --rbac-only    # first super admin
```
Put a TLS proxy (Caddy / Traefik / host nginx + certbot) in front of port 8080.

### Option B — Linux server with PM2 + nginx
```bash
sudo apt install -y chromium-browser || sudo snap install chromium   # Arabic PDF reports
# API
cd backend && npm ci && npm run build && npm run migration:run:prod && npm run seed:prod -- --rbac-only
pm2 start ../deploy/ecosystem.config.js && pm2 save && pm2 startup
# Web
cd ../frontend && npm ci && npm run build && sudo cp -r dist/* /var/www/medix/
sudo cp ../deploy/nginx-host.conf /etc/nginx/sites-available/medix   # edit server_name & certs
sudo ln -s /etc/nginx/sites-available/medix /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx
```
Run a single API instance while jobs use the in-process queue; to scale horizontally, swap `JobQueueService` for a BullMQ implementation (same `register/add` API) and move Socket.IO to the Redis adapter.

Production checklist: strong unique JWT secrets · `COOKIE_SECURE=true` · HTTPS + HSTS · `FRONTEND_URL` set to the real origin · private S3 bucket (or a persistent volume for `storage/`) · `SWAGGER_ENABLED=false` · daily backups scheduled and monitored.

## 11. Backup & restore
Scripts in `scripts/` (tested: backup → restore into a fresh database → counts and migration state verified).

```bash
# Daily backup, 14-day retention, integrity check, SHA-256, uploads archive, optional webhook alert
DATABASE_URL=postgresql://... BACKUP_DIR=/var/backups/medix RETENTION_DAYS=14 ./scripts/backup.sh
# cron:   15 3 * * *  cd /opt/medix && ./scripts/backup.sh >> logs/backup.log 2>&1

# Monitoring: fails (and alerts via ALERT_WEBHOOK_URL) if the last good backup is older than 26h
BACKUP_DIR=/var/backups/medix ./scripts/check-backup.sh
# cron:   0 * * * *   cd /opt/medix && ./scripts/check-backup.sh

# Restore (destructive for the target DB — asks for confirmation, verifies checksum)
DATABASE_URL=postgresql://.../medix ./scripts/restore.sh /var/backups/medix/medix-20261004T031500Z.dump
```
**Restore procedure:** stop the API → restore into the database (or a new database and switch `DATABASE_URL`) → `tar -xzf uploads-<stamp>.tar.gz -C backend/storage` if using local storage → start the API (pending migrations run automatically) → check `/api/health` and log in as admin.
Also enable your provider's PITR/WAL archiving if available (e.g. managed PostgreSQL), and keep one off-site copy (S3 bucket with versioning).

## 12. API documentation
- Swagger UI: `http://localhost:4000/api/docs` (dev; enable in prod with `SWAGGER_ENABLED=true`)
- Endpoint table + Socket.IO events: [`docs/API.md`](docs/API.md) (311 endpoints) · OpenAPI 3 spec: [`docs/openapi.json`](docs/openapi.json)

Core examples:
```
POST   /api/auth/register | /api/auth/register/doctor | /api/auth/login | /api/auth/refresh
GET    /api/doctors?specialtySlug=cardiology&cityId=…&minRating=4&availableOn=2026-10-08&sort=price_asc
GET    /api/doctors/:id/availability?from=2026-10-05&days=7&type=CLINIC
POST   /api/appointments            { doctorId, startAt, type?, notes?, homeAddress? }
PATCH  /api/appointments/:id/cancel | /reschedule | /status
GET    /api/patients/me/medical-record      GET /api/patients/:id/medical-record (providers, audited)
PATCH  /api/admin/providers/:id/status      { action: APPROVE | REJECT | SUSPEND | ACTIVATE, note? }
GET    /api/dashboards/admin | /doctor | /patient       GET /api/reports/appointments.csv
POST   /api/chat/rooms              { type: PATIENT_PROVIDER | ADMIN_PROVIDER | SUPPORT, providerId?, patientId?, message? }
GET    /api/chat/rooms/:id/messages?before=…   POST /api/chat/rooms/:id/messages | /read | /block | /report
GET    /api/lab-tests/search?search=CBC        GET /api/labs/:key/catalog   GET /api/labs/:key/slots?date=&mode=BRANCH|HOME&branchId=
POST   /api/lab-orders          { laboratoryId, testIds?, packageIds?, mode, branchId?, scheduledAt, homeAddress? }
POST   /api/lab-orders/:id/status { status }   PUT /api/lab-orders/:id/results { items:[{ parameterId, value }] }
POST   /api/lab-orders/:id/results/submit | /review | /return | /approve      GET /api/lab-orders/:id/report.pdf
GET    /api/radiology-services/search?search=&modality=   GET /api/radiology/:key/slots?date=&serviceId=&branchId=
POST   /api/radiology-orders    { serviceId, branchId, scheduledAt, referralFileId?, clinicalIndication? }
POST   /api/radiology-orders/:id/status { CHECKED_IN | EXAMINATION | REPORTING | NO_SHOW | DELIVERED }
PUT    /api/radiology-orders/:id/report   POST …/report/submit | /return | /approve    GET …/report.pdf
GET    /api/radiology-center/me/worklist?date=   (DICOM Modality Worklist JSON)
GET    /api/medicines/search?search=&kind=&category=&available=true&cityId=    GET /api/medicines/:id (offers + alternatives)
GET    /api/pharmacies/:key/profile | /items?search=&kind=&category=
POST   /api/prescriptions        { patientId, diagnosis?, items:[{ medicineId|medicineName, dose, frequency, duration, quantity? }] }
GET    /api/prescriptions/mine | /written | /:id | /:id/pdf      POST /api/prescriptions/:id/revoke { reason }
POST   /api/pharmacy-prescriptions/lookup | /dispense   { code, phone? }
POST   /api/pharmacy-orders      { pharmacy, items:[{ medicineId, quantity }], prescriptionId?, prescriptionFileId?, fulfillment, branchId?, deliveryAddress? }
POST   /api/pharmacy-orders/:id/confirm { items?, pharmacistNote? }   POST …/status { status, driverName?, driverPhone? }   POST …/cancel
GET    /api/pharmacy-orders/prescription-offers/:prescriptionId
GET    /api/verify/:code         (public — authenticity only: lab & radiology reports, prescriptions)
```

## 13. Roles & permissions
Roles: `SUPER_ADMIN, ADMIN, DOCTOR, LAB_ADMIN, LAB_STAFF, RADIOLOGY_ADMIN, RADIOLOGY_STAFF, PHARMACY_ADMIN, PHARMACY_STAFF, PATIENT, SUPPORT, ACCOUNTANT`. Permissions are fine-grained codes (`appointments.read.provider`, `providers.approve`, `medical_record.read.patient`, …) defined in `backend/src/common/permissions.ts` and editable per role from **Admin → إعدادات النظام → الأدوار والصلاحيات** (super admin only).

Phase 8 permissions: `analytics.read` (admin, accountant), `security.read` + `security.manage` (admin, support), `system.health` (admin); providers see their own analytics with `dashboard.provider`.

**Global notification rules** (Admin → إعدادات النظام): turn email / SMS / WhatsApp / marketing off platform-wide (overrides user preferences) and set how many hours before an appointment the reminder is sent (`appointments.reminderHours`).

Every endpoint enforces, in order: **authentication → role/permission → ownership / provider relationship / resource access**. Examples:
- `GET /appointments/:id` for someone else's appointment returns **404** (existence is never confirmed).
- `GET /patients/:id/medical-record` requires the caller to be that patient, or a provider with a non-cancelled appointment or an active consent grant — otherwise **403**; every read writes `MEDICAL_RECORD_VIEWED` to the audit log.
- Doctors see only their own appointments/patients; `scope=all` without `appointments.read.any` is rejected, not silently widened.
- Prescriptions & pharmacy: a doctor writes only for patients they treat; the patient, the author and treating providers read it (audited); a pharmacy opens one only by QR code (or number + patient phone) or when the patient sends it with an order; only the author revokes; platform admins never see medicines or prescriptions; pharmacy staff can change stock but only managers change prices.
- Radiology: same model — center staff act only on their own bookings (others **404**); `radiology.reports.write` writes, `radiology.reports.approve` releases; drafts, images and DICOM identifiers stay hidden from the patient until approval; platform admins never see reports, images or clinical indications.
- Labs: staff act only on their own lab's orders (others get **404**); entering results needs `lab.results.enter`, approving needs `lab.results.approve` (managers), with an optional four-eyes rule; patients see results only after approval; platform admins see order metadata but **never** result values; the public verify page shows authenticity only.
- Payments: the amount is always taken from the booking/order on the server; patients see only their own payments (others **404**), providers only their own provider's (`payments.read.provider`, managers), finance (`finance.read`, `payments.refund`, `settlements.manage`, `subscriptions.manage`, `coupons.manage`, `commission.manage`) everything; gateway callbacks are signature-checked (HMAC) and idempotent.
- Subscriptions: a guard after the permission guard answers **402 SUBSCRIPTION_REQUIRED** for doctor / lab / radiology / pharmacy accounts whose subscription (+ grace) ended — only auth, profile, notifications, files and the renewal endpoints stay open. Platform staff and patients are never affected.
- Chat: every REST call and every socket event re-resolves the user from the database and re-checks room membership; a doctor can start a chat only with patients who booked with them; patients can contact only approved providers.

## 14. Security checklist
- [x] bcrypt (cost 12) password hashing; password policy; constant-time-ish login with generic error (no user enumeration)
- [x] Short-lived access JWT (15 min, HS256) kept in memory; refresh token opaque, hashed in DB, httpOnly + `SameSite=Strict` cookie scoped to `/api/auth` (CSRF-safe), rotation with family-wide revocation on reuse
- [x] `token_version` invalidation on password change/reset, logout-all, suspension; principal reloaded from DB per request
- [x] RBAC + permission guards (global), ownership/relationship checks in services, IDs from the client never trusted
- [x] DTO validation with whitelist + `forbidNonWhitelisted` (mass-assignment blocked), input sanitisation pipe (tags/inline handlers stripped, prototype-pollution keys dropped)
- [x] SQL injection: ORM/parameterised queries only; LIKE input escaped
- [x] Helmet security headers, CORS allow-list, `x-powered-by` off, nginx security headers, HSTS in host config
- [x] Rate limiting (global + strict limits on login/register/reset/verification)
- [x] File uploads: per-purpose allow-list, size limits, **magic-byte sniffing** (spoofed types rejected), random storage keys outside any web root, private files only via authorised streaming with `no-store` + `nosniff`, downloads of others' private files audited
- [x] Socket.IO: JWT verified **and** account re-checked on connect and on every chat event; per-user send rate limit; chat attachments use the same sniffed/private file pipeline and are readable only by room members
- [x] Append-only audit log (DB trigger blocks UPDATE) with secrets redacted; categories, CSV export (formula-injection safe), configurable retention
- [x] Account lockout after `security.maxFailedLogins` wrong passwords/codes (atomic counter, the correct password is refused while locked, owner notified, support can unlock)
- [x] Two-step verification (RFC 6238 TOTP + 10 hashed one-time backup codes), secrets AES-256-GCM encrypted, codes single-use, challenge token signed with a separate key so it can never act as an access token; optional enforcement for platform staff (`security.require2faForStaff`)
- [x] New-device sign-in alerts and a personal sign-in history; admin security centre with force sign-out and 2FA reset
- [x] Database statement timeout; slow requests and queries tracked without storing query parameters
- [x] Centralised error handling: Arabic user messages; stack traces/SQL only in server logs with request IDs
- [x] Secrets only in environment; app refuses weak/missing JWT secrets in production; `.env` git-ignored
- [x] Medical data: admins excluded from medical records by default; patient-controlled consent grants; private doctor notes hidden from patients
- [x] Public verification page (`/verify/:code` — lab reports, radiology reports and prescriptions) uses opaque random codes and reveals authenticity only (lab, document number, date, patient initials)
- [x] Lab/radiology/pharmacy prices, totals, delivery fees, flags, capacity and stock are always computed server-side (client prices are rejected); the PDF renderer runs with JavaScript disabled and every network request blocked

## 15. Design system
- **Palette:** Petrol `#0F4C5C` (primary), Ink `#13252B` (text), Mint `#E7F3EF` (surfaces/selected), Cool paper `#F6F8F8` (background), Saffron `#E9A23B` (ratings, open slots, focus ring), Signal `#C8432B` (destructive/emergency only).
- **Type:** IBM Plex Sans Arabic 400/500/600/700 with tabular figures.
- **Signature element:** the slot picker — day "tickets" with open counts and dashed time stubs; booked times stay visible but struck through. Labs reuse it with remaining places per window, and results get a small range gauge showing where each value sits against its normal band.
- Radii by hierarchy (12 cards / 8 controls / pill slots), borders over shadows, skeleton loaders, empty states that tell the user what to do next, confirmation dialogs for destructive actions, visible keyboard focus, reduced-motion respected, responsive from 360 px.

## 16. Laboratories (Phase 4)

**Patient:** المعامل / أسعار التحاليل → search a test and compare every lab's price → pick tests or a package on the lab page (packages show the saving) → choose a branch or home collection, then a day and a window (remaining places are shown; full windows are struck through) → confirm. "تحاليلي" tracks the order (booked → sample → analysis → ready), shows results with a range gauge per value, downloads the PDF, cancels before collection, or messages the lab. Approved results also appear in "سجلي الطبي" and — for doctors the patient booked with — in the patient file.

**Lab workspace (`/provider/lab`):**
| Page | What happens there |
|---|---|
| لوحة المعمل | Today's orders, pending samples, processing, awaiting approval, completed today, home requests; revenue, turnaround time (collection → approval), critical results; most requested tests, revenue by test and package; setup warnings |
| الطلبات | Board by stage (waiting / in lab / entry & review / ready / delivered / cancelled), search by code, patient name, phone **or tube barcode**, branch & home filters, critical-only filter; live updates |
| Order page | Record payment (cash/card/…), "sample collected" (creates one barcode per sample type), print 50×30 mm tube labels, receive, start analysis, reject a tube (replacement barcode + patient notified), worksheet with the patient-specific reference range and a live flag preview, submit for review, mark reviewed / return with a note, approve & release, draft PDF preview, cancel with reason, chat with the patient |
| التحاليل والباقات | Tests with parameters, units, NUMERIC/TEXT result types, any number of ranges per parameter by gender and/or age, critical limits; categories; packages |
| إعدادات الحجز | Window length, patients per window, booking horizon, four-eyes approval, home collection (fee, visits per hour, team hours), weekly hours per branch |
| فريق العمل | Create technician / manager accounts, assign a branch, promote, deactivate (takes effect immediately) |

**Rules worth knowing:** numeric flags are computed by the server (client flags are ignored); a critical value alerts lab managers the moment it is saved and is flagged urgently to the patient on approval (setting `lab.criticalAlertsEnabled`); results under review are locked; the final PDF is generated in the background after approval and cached as a private file; the patient's first view marks the order delivered; `lab.maxActiveOrdersPerPatient` (default 5) limits open orders.

## 17. Radiology (Phase 5)

**Patient:** مراكز الأشعة / "ابحث عن فحص أشعة" → compare prices across centers (cheapest first, filter by modality and area) → pick the exam → the branches that have that machine → a day and a start time (times that would overlap a booked exam on the only machine are struck through) → upload the referral if the exam needs one (contrast CT, …), add the reason and the referring doctor → confirm. "الأشعة" tracks it (booked → exam → report → ready), shows the structured report and key images once approved, downloads the PDF, cancels before check-in, or messages the center. Approved reports also appear in "سجلي الطبي" and for treating doctors.

**Center workspace (`/provider/radiology`):**
| Page | What happens there |
|---|---|
| لوحة المركز | Today's bookings, waiting exams, in exam, reporting queue, awaiting approval, approved today; revenue, bookings, no-shows, report turnaround (exam end → approval), urgent reports; by modality, most requested services, revenue by service, branch performance; setup warnings |
| الحجوزات | Waiting list / reports / ready / delivered / cancelled & no-show; search by code, accession number, patient, phone or service; modality & branch filters; live updates |
| Booking page | Record payment, check-in (issues Accession + Study UID), start/finish exam, no-show, report editor pre-filled from the service template (technique, comparison, findings, impression, recommendations, urgent flag), save draft → submit → return with a note / approve & release, attach key images or PDFs, draft PDF preview, PACS link, referral file, chat with the patient |
| الخدمات والأسعار | Services by modality with price, duration, preparation, referral requirement and report template |
| الفروع والأجهزة | Start-time grid, booking horizon, "approver ≠ author", weekly hours and number of machines per modality for each branch |
| فريق العمل | Radiologists / technologists (staff) and managers |

**DICOM / PACS readiness (no PACS built, as the brief asks):** each booking gets a DICOM-safe Accession Number and a globally unique `2.25.` Study Instance UID at check-in; `GET /radiology-center/me/worklist` publishes a Modality Worklist feed (PatientName in DICOM `FAMILY^GIVEN` form, PatientID, birth date, sex, DICOM modality codes MR/CT/DX/US/MG…, scheduled step date/time, station, procedure) for an Orthanc/RIS bridge to poll; `pacs_url` stores the viewer link once images live in a PACS, and it is shown to the patient after approval.

## 18. Prescriptions & pharmacies (Phase 6)

**Doctor:** المرضى → patient file → **كتابة روشتة** (or **الروشتات → روشتة جديدة**): diagnosis, link to the visit, any number of medicines from the catalog (search EN/AR/generic) or typed freely, dose / frequency / duration with quick suggestions, packs, instructions, notes, validity (default `prescriptions.defaultValidityDays` = 30). The patient is notified instantly. The doctor sees who dispensed it and can revoke it before dispensing (patient and any pharmacy holding an order for it are notified).

**Patient:** "روشتاتي" → open, download or print the A5 PDF (QR + verification code), **اطلب من صيدلية** compares every pharmacy for the whole prescription (how many items available, price for the prescribed quantities, delivery fee) → checkout. Or search **الأدوية**: compare prices, see "open now", delivery terms and same-ingredient alternatives, add to the cart, or browse a pharmacy's store by category. Checkout: pickup branch or delivery address, contact phone, notes, attach an e-prescription or upload a photo (needed for prescription-only items), or send only a prescription for a **quote**. "طلبات الصيدلية" tracks the order live (with the driver's name and phone when out for delivery), cancels before preparation, reorders, or chats with the pharmacy. Prescriptions also appear in "سجلي الطبي" and for treating doctors.

**Pharmacy workspace (`/provider/pharmacy`):**
| Page | What happens there |
|---|---|
| لوحة الصيدلية | New / confirmed / preparing / ready / out for delivery / delivered today / cancelled; sales, average order, customers & repeat customers, delivery vs pickup, average delivery time, prescriptions dispensed; daily sales & orders, top items, low stock; setup warnings |
| الطلبات | Board by stage, search by code / patient / phone, pickup–delivery filter, live updates |
| Order page | Review & confirm (edit quantities, add substitutes from your stock, price a prescription quote — prescribed items you have are pre-filled), stock reserved on confirmation, note to the patient, prepare → ready → out for delivery (driver) → delivered (payment method), cancel with reason (stock restored), the e-prescription with your price/stock per item or the uploaded photo, chat, print |
| التحقق من روشتة | Scan the QR with the camera (BarcodeDetector) or type the code / RX number + patient phone → validity, doctor & licence, items with your stock → **تسجيل الصرف** (once, platform-wide) |
| الأدوية والمخزون | Your items with price and quantity (blank = not tracked), in-stock / low / out tabs, add from the catalog or add a missing item (deduplicated, reviewed by admins); staff update stock, managers change prices |
| التوصيل والمواعيد | Delivery on/off, fee, free-delivery threshold, minimum order, ETA, areas, 24 h, weekly hours per branch |
| فريق العمل | Pharmacist accounts |

**Rules worth knowing:** `pharmacy.maxOpenOrdersPerPatient` (default 5); one prescription can be attached to one open order at a time; delivering an order dispenses its e-prescription (blocked with a clear message if the doctor revoked it or it was dispensed elsewhere); expiry follows the clinic calendar day (Africa/Cairo); once the pharmacy confirms the final price the patient can pay online from the order page; cash on delivery is recorded in the ledger when the order is delivered.

## 19. Payments, coupons & subscriptions (Phase 7)

**Patients (always free):** sign up with **phone + password** only (a skippable dialog asks for the name afterwards). At booking — doctor, lab tests, radiology, pharmacy checkout — enter a **coupon** and see the discount before confirming. Every booking/order page has a **الدفع** box: pay online (when `PAYMENT_GATEWAY` ≠ `none`) or at the provider, see attempts and download **PDF receipts**. **مدفوعاتي** lists every payment and refund. Cancelling an online-paid booking refunds it automatically (coupon use is given back).

**Providers (doctors, labs, radiology centers, pharmacies):**
| Page | What happens there |
|---|---|
| الاشتراك | Status (trial / active / grace / expired), period end, plans with features, periods (1–12), coupon, pay online or by **InstaPay / Vodafone Cash / bank transfer** (instructions from *إعدادات النظام*, upload the receipt + reference → finance reviews), invoice history with receipts. Staff see the status but only the owner pays. |
| الإيرادات | Gross, platform commission, net, online vs desk, the running **balance** with the platform, daily net, settlements, every payment with its commission split. |

Lifecycle: new providers get a **free trial** (`subscriptions.trialDays`, 14) → reminders `subscriptions.reminderDays` (5) before the end (in-app + banner) → after the end a **grace period** (`subscriptions.graceDays`, 3) with a red banner → then the account is **locked** (every page redirects to *الاشتراك*; the API answers 402) and **hidden** from search, booking and new chats. Paying online re-opens it instantly; a manual transfer re-opens it when finance approves. Existing bookings and data are untouched. Turn the whole feature off with `subscriptions.enabled = false`. A job (`SubscriptionsService.sync`, every 10 minutes; also *تحديث الحالات الآن*) updates statuses, visibility and reminders.

**Finance (`/admin`, group المالية):**
| Page | What happens there |
|---|---|
| نظرة مالية | Platform revenue (commission + subscriptions), online vs desk, refunds, failed attempts, owed to / by providers, MRR and subscription states, daily chart, by provider type, top providers |
| المدفوعات | Every payment with filters; drawer with the commission split, refunds and **full / partial refund** (online → through the gateway; commission reversed proportionally) |
| الاشتراكات | Subscribers (status, end date, paid total) → record a cash/transfer payment or extend for free; **مراجعة التحويلات** with the receipt image → approve / reject (reason sent to the provider); all invoices; plans (price, duration, features, default, active) |
| العمولات والمستحقات | Commission rules (global / provider type / one provider; % or fixed — applied to new payments only), provider balances, record settlements, settlement history |
| أكواد الخصم | Coupons: % (with cap) or fixed, minimum order, total and per-user limits, service type, one provider, validity window, usage & total discount |

**Money flow:** online payments are collected by the platform (`collectedBy = PLATFORM`); desk payments are recorded when the provider marks the booking/order paid or completed/delivered (`collectedBy = PROVIDER`). Commission is computed once per payment and stored. **Balance** = online net − commission on desk payments − paid to provider + paid by provider.

**Gateways:** `PaymentGateway` interface (`backend/src/modules/payments/gateways`). `sandbox` is a signed test page inside the app; `paymob` implements Paymob Accept (auth → order → payment key → hosted iframe, HMAC-SHA512 callback, refunds). It is written against Paymob's public API but could not be exercised here without merchant credentials — run a test transaction in Paymob's test mode before going live. Adding Fawry / Stripe means one more class implementing the same 3 methods.

## 20. Analytics, security, audit & performance (Phase 8)

**التحليلات (`/admin/analytics`, `analytics.read` — admins and accountants):** 12 KPIs (platform revenue, payments, bookings, completion, active/new patients, return rate, cancellation, average order value, online share, active providers, rating) each compared with the previous period or the same period last year (▲▼ coloured by whether the change is good). Tabs: trend (bookings / payments / revenue against the comparison period, bookings by service, service mix, channels, payment methods, specialties), patients (appointment and order funnels, monthly retention cohorts, gender and age), busiest hours (weekday × hour heatmap) and governorates, and the **provider leaderboard** (sortable by bookings, completion, cancellation, patients, payments, commission, rating). **Excel** (sheets: KPIs, time series, by service, by governorate, by specialty, providers) and a one-page **PDF report**.

**Provider analytics (`/doctor/analytics`, `/provider/analytics`):** the same view restricted to the provider — net revenue instead of platform revenue, top tests / exams / medicines, own heatmap, funnels, cohorts and exports. Data comes from the `analytics_bookings` view (appointments + lab + radiology + pharmacy orders in one shape) and the payments ledger; results are cached for 60 s.

**Security:**
| Where | What |
|---|---|
| Login | 5 wrong passwords (or 2FA codes) lock the account for 15 min (`security.maxFailedLogins`, `security.lockMinutes`); the page explains the lock and links to password reset, which also unlocks. With 2FA on, the second screen asks for the authenticator code or a backup code. |
| الإعدادات والأمان (every user) | Turn on **التحقق بخطوتين**: scan the QR with Google/Microsoft Authenticator or Authy, confirm a code, save the 10 backup codes; regenerate codes or turn it off (password + code). Connected devices with readable names, and **سجل الدخول والأمان** (sign-ins, failed attempts, new devices, 2FA changes). |
| Notifications | Account locked, sign-in from a new device (browser + OS not used in 180 days), 2FA turned on/off/reset, backup code used, forced sign-out. |
| مركز الأمان (`security.read` / `security.manage` — admins, support) | Sign-ins vs failures per day, lockouts, new devices, stolen-session detections, 2FA adoption, IPs with most failures, accounts locked now (unlock), platform staff with their 2FA status (force sign-out, reset 2FA after verifying identity), filterable security event feed. |
| Policy | `security.require2faForStaff = true` forces admins, support and accountants to enrol before they can use anything except their settings (API answers 403 `TWO_FACTOR_SETUP_REQUIRED`). Turn it on after the team has enrolled. |

**سجل المراجعة (`/admin/audit-logs`):** filter by category (sign-in & security, access to medical data, finance, bookings, administration, catalog), action, person, IP and dates; click a row for the before/after differences and the full history of that record; export to CSV (UTF-8 with BOM for Excel). Rows older than `audit.retentionDays` (730) are purged nightly at 03:30; the table stays append-only.

**صحة النظام (`/admin/system-health`, `system.health`):** uptime, memory, event-loop delay, database latency/size/connections/pool, cache-hit and index-usage ratios, largest tables, slowest API routes (p50/p95/max), recent slow requests and slow SQL, response-cache hit rate, scheduled jobs with next run, PDF engine status; clear cache / reset counters.

**Performance work:** public reference data (specialties, locations, public settings, payment config, subscription plans) is served from an in-process cache with tag invalidation on every write and `Cache-Control` + ETag headers (repeat visits get 304); gzip for responses over 1 KB; indexes on `created_at`/`paid_at` for every reporting table, `(action, created_at)` for the audit log, `(user_id, created_at)` for sessions, `provider_id` for commissions; a 30-second statement timeout; analytics share one view instead of four ad-hoc queries. The cache is per process — for several API instances swap `CacheService` for a Redis-backed class with the same API (the job queue has the same seam for BullMQ).

## 21. Before going live & next steps
- Run a test transaction in Paymob's test mode with your merchant credentials, then set `PAYMENT_GATEWAY=paymob`.
- Set `ENCRYPTION_KEY`, strong JWT secrets, real SMTP/SMS credentials, `FRONTEND_URL`/`BACKEND_URL`, and Chromium on the server.
- Enrol the platform team in two-step verification, then turn on `security.require2faForStaff`.
- Review subscription plan prices, commission rules and transfer instructions; load your real specialties, locations and providers (the seed loads reference data only — no demo accounts).
- Possible additions: home-care and hospital modules (tables and plans already exist), a map view for nearby providers, Redis/BullMQ for multi-instance deployments, scheduled automatic payouts.
