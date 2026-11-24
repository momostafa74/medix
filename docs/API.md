# API reference

Base URL: `/api`. Interactive docs (Swagger UI): `/api/docs` (enabled outside production or with `SWAGGER_ENABLED=true`). Machine-readable spec: [`openapi.json`](openapi.json).

Auth: `Authorization: Bearer <accessToken>`. The refresh token is an httpOnly cookie (`medix_rt`, path `/api/auth`). Non-browser clients may send `{ "refreshToken": "…" }` to `/api/auth/refresh` instead.

Errors always have the shape `{ statusCode, error, message, details?, requestId }` with an Arabic `message`. Notable codes: `SLOT_UNAVAILABLE` (409, slot taken), `PATIENT_CONFLICT` (409), `INVALID_SLOT` (400), `SLOT_FULL` (409, lab window at capacity), `DUPLICATE_ORDER` (409), `VALIDATION_ERROR` (400).

Lists are paginated: `?page=1&pageSize=20` → `{ items, total, page, pageSize, totalPages }`.

### Real-time (Socket.IO)
Namespace `/realtime`, handshake `auth: { token: <accessToken> }` (verified + account re-checked; invalid tokens are disconnected).

| Direction | Event | Payload |
|---|---|---|
| server → client | `notification` | in-app notification row |
| client → server | `chat:send` (ack) | `{ roomId, body?, fileId?, clientId? }` → `{ ok, message }` / `{ ok:false, error }` |
| client → server | `chat:typing` | `{ roomId }` |
| client → server | `chat:read` | `{ roomId }` |
| server → client | `chat:message` | message (with echoed `clientId`) |
| server → client | `chat:typing` / `chat:read` | `{ roomId, userId, side, at? }` |
| server → client | `chat:presence` | `{ userId, online }` |
| server → client | `chat:room` | `{ roomId, isBlocked }` |
| server → client | `lab:order` | `{ id, status }` — sent to the patient and the lab team on every lab order change |
| server → client | `radiology:order` | `{ id, status }` — sent to the patient and the radiology center team on every booking change |
| server → client | `pharmacy:order` | `{ id, status }` — sent to the patient and the pharmacy team on every order change |
| server → client | `payment:update` | `{ entityType, entityId }` — the patient and the provider team when a booking/order payment settles or is refunded (plus the record's own event: `lab:order`, `radiology:order`, `pharmacy:order`, `appointment:update`) |
| server → client | `subscription:update` | `{ id, status }` — the provider's owner when a subscription invoice is paid online |

### Laboratory order lifecycle
`NEW_ORDER → PAID → SAMPLE_COLLECTED → SAMPLE_RECEIVED → PROCESSING → RESULT_ENTERED → UNDER_REVIEW → APPROVED → DELIVERED` (+ `CANCELLED`).
Manual steps: `POST /lab-orders/{id}/status`. Results: `PUT /results` (saves; complete set ⇒ `RESULT_ENTERED`), `POST /results/submit` ⇒ `UNDER_REVIEW`, `/results/return` ⇒ back to `RESULT_ENTERED`, `/results/approve` ⇒ `APPROVED` (needs `lab.results.approve`; optional four-eyes rule). A patient's first view/download ⇒ `DELIVERED`. Rejecting a sample creates a new barcode and returns the order to `PAID`/`NEW_ORDER`.
Patients see results only once approved; platform staff (`lab.orders.read.any`) see order metadata but never results. `GET /verify/{code}` (public) confirms a report's authenticity without any medical data (lab and radiology reports share it).



### Radiology booking lifecycle
`BOOKED → CHECKED_IN → EXAMINATION → REPORTING → APPROVED → DELIVERED` (+ `CANCELLED`, `NO_SHOW`).
Front desk / technologist: `POST /radiology-orders/{id}/status`. Check-in issues the DICOM **Accession Number** and **Study Instance UID** (`2.25.<uuid>`). Report: `PUT /report` (draft) → `/report/submit` → `/report/return` or `/report/approve` (needs `radiology.reports.approve`; optional "approver ≠ author" rule). Slots: `GET /radiology/{key}/slots?date&serviceId&branchId` — every exam occupies a machine of its modality for the service's duration; capacity = machines per branch.
`GET /radiology-center/me/worklist?date&modality` returns a DICOM Modality Worklist feed (PS3.4 attribute names) for a future PACS/RIS bridge.

### Prescriptions
A doctor (`prescriptions.write`) issues an e-prescription for a patient with a care relationship (appointment, lab/radiology order or consent grant): `POST /prescriptions { patientId, appointmentId?, diagnosis?, notes?, validDays?, items:[{ medicineId | medicineName, dose, frequency, duration, quantity?, instructions? }] }`. State is derived: `ACTIVE → DISPENSED` or `REVOKED` (author only, before dispensing) or `EXPIRED` (after `validUntil`, clinic calendar day). `GET /prescriptions/{id}/pdf` — A5 PDF with QR; a void watermark once it is no longer active.
Pharmacists (`prescriptions.verify`): `POST /pharmacy-prescriptions/lookup { code, phone? }` — the QR verification code opens it; the printed number `RX-…` also needs the patient's phone. `POST /pharmacy-prescriptions/dispense` records dispensing with a conditional UPDATE, so a prescription is dispensed **once** even under concurrent requests (others get 409 `RX_DISPENSED`). Every lookup is audited. `GET /verify/{code}` (public) shows doctor, date, validity, state and patient initials — never medicines or diagnosis.

### Pharmacy order lifecycle
`PENDING → CONFIRMED → PREPARING → READY → OUT_FOR_DELIVERY → DELIVERED` (pickup: `READY → DELIVERED`) + `CANCELLED`.
`POST /pharmacy-orders { pharmacy, items:[{ medicineId, quantity }], prescriptionId?, prescriptionFileId?, fulfillment, branchId?, deliveryAddress?, contactPhone?, notes? }` — lines are priced from the pharmacy's inventory (client prices are rejected), prescription-only items need an e-prescription that lists them or an uploaded prescription (`RX_REQUIRED`), delivery rules apply (`NO_DELIVERY`, `BELOW_MINIMUM`, free above a threshold), `items: []` with a prescription is a **quote** the pharmacy prices. `POST /{id}/confirm { items?, pharmacistNote? }` re-prices and **reserves stock** row by row with `UPDATE … WHERE quantity >= q` (shortage ⇒ 409 `OUT_OF_STOCK`, whole confirmation rolled back); cancelling restores it. `POST /{id}/status` follows the state machine; `DELIVERED` marks the order paid and dispenses the linked e-prescription. Patients cancel while `PENDING`/`CONFIRMED`; the pharmacy until `READY` (with a reason). Platform staff (`pharmacy.orders.read.any`) see metadata only.
`GET /pharmacy-orders/prescription-offers/{prescriptionId}` compares every pharmacy for a whole prescription (availability + price of the prescribed quantities).

### Payments, coupons & subscriptions
- **Online payment** (patient): `GET /payments/record/{entityType}/{entityId}` → `{ amount, paymentStatus, canPayOnline, payments[] }`; `POST /payments/checkout { entityType, entityId }` → `{ paymentId, redirectUrl }` (the amount always comes from the record). The gateway result arrives at `POST /payments/paymob/callback` (HMAC-SHA512 verified) or the sandbox page (`GET /payments/sandbox/{id}?sig=…`, `POST /payments/sandbox/{id}/complete { sig, card }` — card `4000 0000 0000 0002` is declined). Completion is idempotent; if the booking was cancelled meanwhile the money is refunded automatically. The browser lands on `/payment/result?payment={id}`.
- **Coupons:** `POST /payments/coupons/preview { code, serviceType, providerId, amount }` (nothing reserved). Send `couponCode` when booking (`POST /appointments`, `/lab-orders`, `/radiology-orders`, `/pharmacy-orders`) — redeemed atomically, released on cancellation. Errors (`code`): `COUPON_NOT_FOUND`, `COUPON_INACTIVE`, `COUPON_NOT_STARTED`, `COUPON_EXPIRED`, `COUPON_USED_UP`, `COUPON_USER_LIMIT`, `COUPON_MIN_ORDER`, `COUPON_NOT_APPLICABLE`.
- **Desk payments** recorded by providers (cash/card) enter the same ledger with `collectedBy = PROVIDER`; commission is snapshotted per payment. `GET /finance/statement` (provider) / `GET /finance/dashboard`, `/finance/balances`, `POST /finance/settlements` (finance). Refunds: `POST /payments/{id}/refund { amount?, reason }` (`payments.refund`). Receipts: `GET /payments/{id}/receipt.pdf`.
- **Provider subscriptions:** doctors, labs, radiology centers and pharmacies need an active subscription. When the period (+ `subscriptions.graceDays`) is over, every endpoint except auth, profile, notifications, files and `/subscriptions/me*` answers **402** `{ error: 'SUBSCRIPTION_REQUIRED' }` and the provider disappears from search/booking. `GET /auth/me` returns `subscription: { blocked, endsAt, providerId, canPay }`. Renew with `POST /subscriptions/me/subscribe { planId, periods?, method: ONLINE|INSTAPAY|VODAFONE_CASH|BANK_TRANSFER, couponCode?, proofFileId?, transferReference? }` → `REDIRECT` (gateway), `AWAITING_REVIEW` (manual transfer; finance approves at `POST /admin/subscriptions/invoices/{id}/approve`) or `ACTIVATED` (100 % coupon). Patients never pay a subscription.
- **Patient sign-up:** `POST /auth/register { phone, password (≥ 6), fullName?, email? }`; login with the phone.

### Security, analytics & operations (Phase 8)
- **Login with lockout & 2FA:** `POST /auth/login` → tokens, or `{ twoFactorRequired: true, challengeToken }` when two-step verification is on → `POST /auth/2fa/verify { challengeToken, code }` (6-digit code or a backup code). Too many wrong passwords/codes → **423** `ACCOUNT_LOCKED`. Enrol: `POST /auth/2fa/setup` → `{ secret, otpauthUrl, qrDataUrl }`, `POST /auth/2fa/enable { code }` → `{ backupCodes }`; `GET /auth/2fa`, `POST /auth/2fa/backup-codes { code }`, `POST /auth/2fa/disable { password, code }`, `GET /auth/login-history`. With `security.require2faForStaff` on, staff without 2FA get **403** `TWO_FACTOR_SETUP_REQUIRED` outside account routes.
- **Security centre:** `GET /security/overview?days=`, `GET /security/events`, `POST /security/users/{id}/unlock | reset-2fa { reason } | logout-all`.
- **Analytics:** `/analytics/{overview,timeseries,breakdowns,funnel,cohorts,providers}` (platform, `analytics.read`) and `/analytics/provider/{overview,timeseries,breakdowns,funnel,cohorts}` (own provider). Common query: `from`, `to` (YYYY-MM-DD, clinic time zone), `compare=previous|year|none`, `granularity=day|week|month`. Overview returns `{ current, previous, change }` (% change per metric). Exports: `export.xlsx`, `report.pdf` under both prefixes.
- **Audit:** `GET /audit-logs?category&action&user&ip&from&to&entity&entityId`, `GET /audit-logs/categories`, `GET /audit-logs/{id}`, `GET /audit-logs/entity/{entity}/{entityId}`, `GET /audit-logs/export.csv`.
- **System:** `GET /system/health`, `POST /system/cache/clear`, `POST /system/metrics/reset` (`system.health`).
- **Caching:** public reference endpoints answer with `Cache-Control: public, max-age=…`, an ETag and `X-Cache: HIT|MISS`.


## Admin — providers

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/admin/providers` | Bearer |  |
| GET | `/api/admin/providers/{id}` | Bearer |  |
| PATCH | `/api/admin/providers/{id}/documents/{documentId}/verify` | Bearer |  |
| PATCH | `/api/admin/providers/{id}/status` | Bearer |  |

## Analytics

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/analytics/breakdowns` | Bearer | By service, channel, specialty, governorate, payment method; busiest hours; patient mix |
| GET | `/api/analytics/cohorts` | Bearer | Monthly patient retention cohorts |
| GET | `/api/analytics/export.xlsx` | Bearer |  |
| GET | `/api/analytics/funnel` | Bearer |  |
| GET | `/api/analytics/overview` | Bearer | KPIs for the period with the previous period (or same period last year) and % change |
| GET | `/api/analytics/provider/breakdowns` | Bearer |  |
| GET | `/api/analytics/provider/cohorts` | Bearer |  |
| GET | `/api/analytics/provider/export.xlsx` | Bearer |  |
| GET | `/api/analytics/provider/funnel` | Bearer |  |
| GET | `/api/analytics/provider/overview` | Bearer |  |
| GET | `/api/analytics/provider/report.pdf` | Bearer |  |
| GET | `/api/analytics/provider/timeseries` | Bearer |  |
| GET | `/api/analytics/providers` | Bearer | Provider leaderboard: bookings, completion, cancellations, patients, payments, commission, rating |
| GET | `/api/analytics/report.pdf` | Bearer |  |
| GET | `/api/analytics/timeseries` | Bearer |  |

## Appointments

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/appointments` | Bearer |  |
| POST | `/api/appointments` | Bearer | Book a slot. Double booking is rejected with 409 SLOT_UNAVAILABLE. |
| GET | `/api/appointments/{id}` | Bearer |  |
| PATCH | `/api/appointments/{id}/cancel` | Bearer |  |
| PATCH | `/api/appointments/{id}/doctor-notes` | Bearer |  |
| PATCH | `/api/appointments/{id}/reschedule` | Bearer |  |
| PATCH | `/api/appointments/{id}/status` | Bearer |  |

## Audit logs

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/audit-logs` | Bearer |  |
| GET | `/api/audit-logs/actions` | Bearer |  |
| GET | `/api/audit-logs/categories` | Bearer |  |
| GET | `/api/audit-logs/entity/{entity}/{entityId}` | Bearer | Full history of one record |
| GET | `/api/audit-logs/export.csv` | Bearer | Same filters as the list, up to 50000 rows, UTF-8 with BOM (opens in Excel) |
| GET | `/api/audit-logs/{id}` | Bearer |  |

## Auth

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/auth/2fa` | Bearer | My two-step verification status |
| POST | `/api/auth/2fa/backup-codes` | Bearer |  |
| POST | `/api/auth/2fa/disable` | Bearer |  |
| POST | `/api/auth/2fa/enable` | Bearer | Confirm with the first code → returns 10 one-time backup codes (shown once) |
| POST | `/api/auth/2fa/setup` | Bearer | Start enrolment: secret + otpauth URL + QR (not active until confirmed) |
| POST | `/api/auth/2fa/verify` | Public | Second login step: authenticator code or backup code |
| POST | `/api/auth/change-password` | Bearer |  |
| POST | `/api/auth/forgot-password` | Public |  |
| POST | `/api/auth/login` | Public | Sign in. With two-step verification on, answers { twoFactorRequired, challengeToken } instead of tokens → POST /auth/2fa/verify |
| GET | `/api/auth/login-history` | Bearer | My recent sign-ins and security events |
| POST | `/api/auth/logout` | Public |  |
| POST | `/api/auth/logout-all` | Bearer |  |
| GET | `/api/auth/me` | Bearer |  |
| POST | `/api/auth/refresh` | Public |  |
| POST | `/api/auth/register` | Public | Register a patient account |
| POST | `/api/auth/register/doctor` | Public | Register a doctor (profile stays hidden until admin approval) |
| POST | `/api/auth/register/provider` | Public | Register a laboratory / radiology center / pharmacy (hidden until admin approval) |
| POST | `/api/auth/reset-password` | Public |  |
| GET | `/api/auth/sessions` | Bearer |  |
| DELETE | `/api/auth/sessions/{id}` | Bearer |  |
| POST | `/api/auth/verification/confirm` | Bearer |  |
| POST | `/api/auth/verification/request` | Bearer |  |

## Chat

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/chat/rooms` | Bearer |  |
| POST | `/api/chat/rooms` | Bearer |  |
| GET | `/api/chat/rooms/{id}` | Bearer |  |
| POST | `/api/chat/rooms/{id}/block` | Bearer |  |
| POST | `/api/chat/rooms/{id}/dismiss-report` | Bearer |  |
| GET | `/api/chat/rooms/{id}/messages` | Bearer |  |
| POST | `/api/chat/rooms/{id}/messages` | Bearer |  |
| POST | `/api/chat/rooms/{id}/read` | Bearer |  |
| POST | `/api/chat/rooms/{id}/report` | Bearer |  |
| POST | `/api/chat/rooms/{id}/unblock` | Bearer |  |
| GET | `/api/chat/unread-count` | Bearer |  |

## Dashboards & reports

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/dashboards/admin` | Bearer |  |
| GET | `/api/dashboards/doctor` | Bearer |  |
| GET | `/api/dashboards/patient` | Bearer |  |
| GET | `/api/reports/appointments.csv` | Bearer |  |

## Doctor schedule

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/doctors/me/exceptions` | Bearer |  |
| DELETE | `/api/doctors/me/exceptions/{id}` | Bearer |  |
| GET | `/api/doctors/me/schedule` | Bearer |  |
| PUT | `/api/doctors/me/schedule` | Bearer |  |
| POST | `/api/doctors/me/slot-blocks` | Bearer |  |
| DELETE | `/api/doctors/me/slot-blocks/{id}` | Bearer |  |

## Doctors

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/doctors` | Public |  |
| GET | `/api/doctors/me/profile` | Bearer |  |
| PATCH | `/api/doctors/me/profile` | Bearer |  |
| GET | `/api/doctors/{idOrSlug}` | Public |  |
| GET | `/api/doctors/{id}/availability` | Public |  |

## Favorites

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/favorites` | Bearer |  |
| GET | `/api/favorites/ids` | Bearer |  |
| PUT | `/api/favorites/{providerId}` | Bearer |  |
| DELETE | `/api/favorites/{providerId}` | Bearer |  |

## Files

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/files` | Bearer |  |
| GET | `/api/files/{id}` | Public |  |

## Finance

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/finance/balances` | Bearer |  |
| GET | `/api/finance/commission-rules` | Bearer |  |
| POST | `/api/finance/commission-rules` | Bearer |  |
| PATCH | `/api/finance/commission-rules/{id}` | Bearer |  |
| GET | `/api/finance/coupons` | Bearer |  |
| POST | `/api/finance/coupons` | Bearer |  |
| PATCH | `/api/finance/coupons/{id}` | Bearer |  |
| GET | `/api/finance/dashboard` | Bearer |  |
| GET | `/api/finance/settlements` | Bearer |  |
| POST | `/api/finance/settlements` | Bearer |  |
| GET | `/api/finance/statement` | Bearer | Provider earnings: gross, commission, net, balance with the platform |

## Health

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/health` | Public |  |

## Laboratories — lab workspace

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/labs/me` | Bearer |  |
| PATCH | `/api/labs/me` | Bearer |  |
| PUT | `/api/labs/me/branches/{branchId}/hours` | Bearer |  |
| GET | `/api/labs/me/categories` | Bearer |  |
| POST | `/api/labs/me/categories` | Bearer |  |
| PATCH | `/api/labs/me/categories/{id}` | Bearer |  |
| DELETE | `/api/labs/me/categories/{id}` | Bearer |  |
| GET | `/api/labs/me/dashboard` | Bearer |  |
| GET | `/api/labs/me/orders` | Bearer |  |
| GET | `/api/labs/me/packages` | Bearer |  |
| POST | `/api/labs/me/packages` | Bearer |  |
| PUT | `/api/labs/me/packages/{id}` | Bearer |  |
| DELETE | `/api/labs/me/packages/{id}` | Bearer |  |
| GET | `/api/labs/me/tests` | Bearer |  |
| POST | `/api/labs/me/tests` | Bearer |  |
| GET | `/api/labs/me/tests/{id}` | Bearer |  |
| PUT | `/api/labs/me/tests/{id}` | Bearer |  |
| DELETE | `/api/labs/me/tests/{id}` | Bearer |  |

## Laboratories — orders

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/lab-orders` | Bearer | Book lab tests/packages (branch visit or home collection). Prices are taken from the database. |
| GET | `/api/lab-orders/admin` | Bearer | Platform view — order metadata only, never result values |
| GET | `/api/lab-orders/mine` | Bearer |  |
| GET | `/api/lab-orders/{id}` | Bearer |  |
| POST | `/api/lab-orders/{id}/cancel` | Bearer |  |
| POST | `/api/lab-orders/{id}/deliver` | Bearer |  |
| POST | `/api/lab-orders/{id}/payment` | Bearer |  |
| GET | `/api/lab-orders/{id}/report.pdf` | Bearer | Professional Arabic PDF report (final once approved; watermarked draft for lab staff before) |
| GET | `/api/lab-orders/{id}/results` | Bearer |  |
| PUT | `/api/lab-orders/{id}/results` | Bearer |  |
| POST | `/api/lab-orders/{id}/results/approve` | Bearer |  |
| POST | `/api/lab-orders/{id}/results/return` | Bearer |  |
| POST | `/api/lab-orders/{id}/results/review` | Bearer |  |
| POST | `/api/lab-orders/{id}/results/submit` | Bearer |  |
| POST | `/api/lab-orders/{id}/samples/{sampleId}/reject` | Bearer |  |
| POST | `/api/lab-orders/{id}/status` | Bearer |  |
| GET | `/api/lab-orders/{id}/worksheet` | Bearer |  |

## Laboratories — public

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/lab-tests/search` | Public | Search tests across labs and compare prices (grouped by test code) |
| GET | `/api/labs/{key}/catalog` | Public | Public catalog of an approved lab (tests, packages, branches) |
| GET | `/api/labs/{key}/slots` | Public | Bookable windows for a day (branch visit or home collection), with remaining capacity |

## Laboratories — records & admin

| Method | Path | Auth | Notes |
|---|---|---|---|
| PATCH | `/api/admin/lab-packages/{id}/visibility` | Bearer |  |
| GET | `/api/admin/labs/{providerId}/catalog` | Bearer |  |
| GET | `/api/patients/{patientId}/lab-results` | Bearer | Approved lab results of a patient (patient themself or a provider with a care relationship) |

## Locations

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/locations/areas` | Public |  |
| POST | `/api/locations/areas` | Bearer |  |
| PATCH | `/api/locations/areas/{id}` | Bearer |  |
| GET | `/api/locations/cities` | Public |  |
| POST | `/api/locations/cities` | Bearer |  |
| GET | `/api/locations/countries` | Public |  |
| GET | `/api/locations/governorates` | Public |  |
| POST | `/api/locations/governorates` | Bearer |  |
| GET | `/api/locations/tree` | Public |  |

## Notifications

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/notifications` | Bearer |  |
| GET | `/api/notifications/preferences` | Bearer |  |
| PUT | `/api/notifications/preferences` | Bearer |  |
| PATCH | `/api/notifications/read-all` | Bearer |  |
| GET | `/api/notifications/unread-count` | Bearer |  |
| PATCH | `/api/notifications/{id}/read` | Bearer |  |

## Patients — providers & admin

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/patients` | Bearer |  |
| GET | `/api/patients/{id}` | Bearer |  |
| GET | `/api/patients/{id}/medical-record` | Bearer |  |

## Patients — self

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/patients/me` | Bearer |  |
| PATCH | `/api/patients/me` | Bearer |  |
| GET | `/api/patients/me/access-grants` | Bearer |  |
| POST | `/api/patients/me/access-grants` | Bearer |  |
| DELETE | `/api/patients/me/access-grants/{id}` | Bearer |  |
| POST | `/api/patients/me/documents` | Bearer |  |
| DELETE | `/api/patients/me/documents/{id}` | Bearer |  |
| GET | `/api/patients/me/medical-record` | Bearer |  |
| PUT | `/api/patients/me/medical-record/notes` | Bearer |  |
| POST | `/api/patients/me/medical-record/{section}` | Bearer |  |
| PATCH | `/api/patients/me/medical-record/{section}/{id}` | Bearer |  |
| DELETE | `/api/patients/me/medical-record/{section}/{id}` | Bearer |  |

## Payments

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/payments/admin` | Bearer |  |
| POST | `/api/payments/checkout` | Bearer | Start an online payment for your booking / order (amount is taken from the record) |
| GET | `/api/payments/config` | Bearer | Is online payment available + manual transfer instructions |
| POST | `/api/payments/coupons/preview` | Bearer | Check a coupon code before booking / paying (nothing is reserved) |
| GET | `/api/payments/mine` | Bearer | My payments (patient) |
| POST | `/api/payments/paymob/callback` | Bearer | Paymob "transaction processed" webhook (HMAC verified) |
| GET | `/api/payments/paymob/return` | Bearer |  |
| GET | `/api/payments/provider` | Bearer | Payments received by my provider (with commission split) |
| GET | `/api/payments/record/{entityType}/{entityId}` | Bearer | Payment state of a booking / order (drives the "pay online" button) |
| GET | `/api/payments/sandbox/{id}` | Bearer |  |
| POST | `/api/payments/sandbox/{id}/complete` | Bearer |  |
| GET | `/api/payments/{id}` | Bearer |  |
| GET | `/api/payments/{id}/receipt.pdf` | Bearer |  |
| POST | `/api/payments/{id}/refund` | Bearer | Full or partial refund (online → through the gateway; commission reversed proportionally) |

## Pharmacy — admin

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/admin/medicines` | Bearer |  |
| POST | `/api/admin/medicines` | Bearer |  |
| PATCH | `/api/admin/medicines/{id}` | Bearer |  |

## Pharmacy — orders

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/pharmacy-orders` | Bearer | Place an order. Prices come from the pharmacy inventory; prescription-only items need an e-prescription or an uploaded one. |
| GET | `/api/pharmacy-orders/admin` | Bearer | Platform oversight — metadata only, never the medicines |
| GET | `/api/pharmacy-orders/mine` | Bearer |  |
| GET | `/api/pharmacy-orders/prescription-offers/{prescriptionId}` | Bearer | Compare pharmacies for a whole e-prescription: availability and price of the prescribed quantities |
| GET | `/api/pharmacy-orders/{id}` | Bearer |  |
| POST | `/api/pharmacy-orders/{id}/cancel` | Bearer |  |
| POST | `/api/pharmacy-orders/{id}/confirm` | Bearer | Confirm / price the order and reserve stock atomically |
| POST | `/api/pharmacy-orders/{id}/status` | Bearer |  |

## Pharmacy — public

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/medicines/categories` | Public |  |
| GET | `/api/medicines/search` | Public | Search medicines & products, with number of pharmacies offering each and the price range |
| GET | `/api/medicines/{id}` | Public | A medicine with every pharmacy offering it (compare prices) and same-ingredient alternatives |
| GET | `/api/pharmacies/{key}/items` | Public |  |
| GET | `/api/pharmacies/{key}/profile` | Public |  |

## Pharmacy — workspace

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/pharmacy/me` | Bearer |  |
| PATCH | `/api/pharmacy/me` | Bearer |  |
| PUT | `/api/pharmacy/me/branches/{branchId}/hours` | Bearer |  |
| GET | `/api/pharmacy/me/dashboard` | Bearer |  |
| GET | `/api/pharmacy/me/inventory` | Bearer |  |
| POST | `/api/pharmacy/me/inventory` | Bearer | List a catalog medicine/product with your price and stock |
| POST | `/api/pharmacy/me/inventory/new-medicine` | Bearer | Add a medicine missing from the shared catalog (deduplicated) and list it |
| PATCH | `/api/pharmacy/me/inventory/{id}` | Bearer | Update price (managers) or stock (staff) |
| DELETE | `/api/pharmacy/me/inventory/{id}` | Bearer |  |
| GET | `/api/pharmacy/me/orders` | Bearer |  |

## Prescriptions

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/patients/{patientId}/prescriptions` | Bearer | Prescriptions in a patient's medical record |
| POST | `/api/pharmacy-prescriptions/dispense` | Bearer | Record dispensing — atomic, a prescription can be dispensed only once |
| POST | `/api/pharmacy-prescriptions/lookup` | Bearer | Pharmacist opens a prescription by QR code (or number + patient phone). Audited. |
| POST | `/api/prescriptions` | Bearer | Doctor issues an e-prescription (needs a care relationship with the patient) |
| GET | `/api/prescriptions/mine` | Bearer | Patient's own prescriptions |
| GET | `/api/prescriptions/written` | Bearer | Prescriptions written by the current doctor |
| GET | `/api/prescriptions/{id}` | Bearer |  |
| GET | `/api/prescriptions/{id}/pdf` | Bearer | Printable A5 prescription with QR (void watermark once dispensed / revoked / expired) |
| POST | `/api/prescriptions/{id}/revoke` | Bearer |  |

## Providers

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/providers` | Public |  |
| GET | `/api/providers/mine` | Bearer |  |
| GET | `/api/providers/{idOrSlug}` | Public |  |
| PATCH | `/api/providers/{id}` | Bearer |  |
| GET | `/api/providers/{id}/branches` | Bearer |  |
| POST | `/api/providers/{id}/branches` | Bearer |  |
| PATCH | `/api/providers/{id}/branches/{branchId}` | Bearer |  |
| DELETE | `/api/providers/{id}/branches/{branchId}` | Bearer |  |
| GET | `/api/providers/{id}/documents` | Bearer |  |
| POST | `/api/providers/{id}/documents` | Bearer |  |
| DELETE | `/api/providers/{id}/documents/{documentId}` | Bearer |  |
| GET | `/api/providers/{id}/services` | Bearer |  |
| POST | `/api/providers/{id}/services` | Bearer |  |
| PATCH | `/api/providers/{id}/services/{serviceId}` | Bearer |  |
| DELETE | `/api/providers/{id}/services/{serviceId}` | Bearer |  |
| GET | `/api/providers/{id}/staff` | Bearer |  |
| POST | `/api/providers/{id}/staff` | Bearer |  |
| PATCH | `/api/providers/{id}/staff/{staffId}` | Bearer |  |

## Radiology — bookings

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/radiology-orders` | Bearer | Book a radiology exam. Price and end time come from the service; capacity per branch machine. |
| GET | `/api/radiology-orders/admin` | Bearer |  |
| GET | `/api/radiology-orders/mine` | Bearer |  |
| GET | `/api/radiology-orders/{id}` | Bearer |  |
| POST | `/api/radiology-orders/{id}/cancel` | Bearer |  |
| POST | `/api/radiology-orders/{id}/files` | Bearer |  |
| DELETE | `/api/radiology-orders/{id}/files/{attachmentId}` | Bearer |  |
| PATCH | `/api/radiology-orders/{id}/pacs` | Bearer |  |
| POST | `/api/radiology-orders/{id}/payment` | Bearer |  |
| PUT | `/api/radiology-orders/{id}/report` | Bearer |  |
| GET | `/api/radiology-orders/{id}/report.pdf` | Bearer |  |
| POST | `/api/radiology-orders/{id}/report/approve` | Bearer |  |
| POST | `/api/radiology-orders/{id}/report/return` | Bearer |  |
| POST | `/api/radiology-orders/{id}/report/submit` | Bearer |  |
| POST | `/api/radiology-orders/{id}/report/viewed` | Bearer | Patient opened the approved report (marks the booking delivered) |
| POST | `/api/radiology-orders/{id}/status` | Bearer |  |

## Radiology — center workspace

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/radiology-center/me` | Bearer |  |
| PATCH | `/api/radiology-center/me` | Bearer |  |
| PUT | `/api/radiology-center/me/branches/{branchId}/hours` | Bearer |  |
| PUT | `/api/radiology-center/me/branches/{branchId}/modalities` | Bearer | Machines per modality in a branch (booking capacity) |
| GET | `/api/radiology-center/me/dashboard` | Bearer |  |
| GET | `/api/radiology-center/me/orders` | Bearer |  |
| GET | `/api/radiology-center/me/services` | Bearer |  |
| POST | `/api/radiology-center/me/services` | Bearer |  |
| PUT | `/api/radiology-center/me/services/{id}` | Bearer |  |
| DELETE | `/api/radiology-center/me/services/{id}` | Bearer |  |
| GET | `/api/radiology-center/me/worklist` | Bearer | DICOM Modality Worklist feed (JSON, PS3.4 attribute names) for a future PACS/RIS bridge |

## Radiology — public

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/radiology-services/search` | Public | Search radiology services across approved centers (cheapest first) |
| GET | `/api/radiology/{key}/catalog` | Public |  |
| GET | `/api/radiology/{key}/slots` | Public | Exam start times for a service at a branch, with remaining machine capacity |

## Radiology — records & admin

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/admin/radiology/{providerId}/catalog` | Bearer |  |
| GET | `/api/patients/{patientId}/radiology-reports` | Bearer |  |

## Reviews

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/admin/reviews` | Bearer |  |
| PATCH | `/api/admin/reviews/{id}` | Bearer |  |
| GET | `/api/providers/{id}/reviews` | Public |  |
| POST | `/api/reviews` | Bearer |  |
| GET | `/api/reviews/received` | Bearer |  |

## Roles & permissions

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/permissions` | Bearer |  |
| GET | `/api/roles` | Bearer |  |
| PUT | `/api/roles/{code}/permissions` | Bearer |  |

## Security

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/security/events` | Bearer |  |
| GET | `/api/security/overview` | Bearer | Sign-ins vs failures, lockouts, suspicious IPs, locked accounts, staff 2FA adoption, policy |
| POST | `/api/security/users/{id}/logout-all` | Bearer |  |
| POST | `/api/security/users/{id}/reset-2fa` | Bearer | Turn off two-step verification for a user who lost their device (also signs them out everywhere) |
| POST | `/api/security/users/{id}/unlock` | Bearer |  |

## Settings

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/settings` | Bearer |  |
| GET | `/api/settings/public` | Public |  |
| PUT | `/api/settings/{key}` | Bearer |  |

## Specialties

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/specialties` | Public |  |
| POST | `/api/specialties` | Bearer |  |
| GET | `/api/specialties/{idOrSlug}` | Public |  |
| PATCH | `/api/specialties/{id}` | Bearer |  |

## Subscriptions

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/subscriptions/me` | Bearer | My provider's subscription, plans, invoices and payment options |
| POST | `/api/subscriptions/me/subscribe` | Bearer | Buy / renew: ONLINE → redirect to the gateway; INSTAPAY / VODAFONE_CASH / BANK_TRANSFER → receipt reviewed by finance |
| GET | `/api/subscriptions/plans` | Bearer | Active plans (optionally for one provider type) |

## Subscriptions — admin

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/admin/subscriptions` | Bearer |  |
| GET | `/api/admin/subscriptions/invoices` | Bearer |  |
| POST | `/api/admin/subscriptions/invoices/{id}/approve` | Bearer |  |
| POST | `/api/admin/subscriptions/invoices/{id}/reject` | Bearer |  |
| GET | `/api/admin/subscriptions/plans` | Bearer |  |
| POST | `/api/admin/subscriptions/plans` | Bearer |  |
| PATCH | `/api/admin/subscriptions/plans/{id}` | Bearer |  |
| POST | `/api/admin/subscriptions/providers/{providerId}/extend` | Bearer |  |
| POST | `/api/admin/subscriptions/providers/{providerId}/payments` | Bearer | Record a subscription paid in cash / verified transfer |
| POST | `/api/admin/subscriptions/sync` | Bearer | Run the status / visibility / reminder job now |

## System

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/system/cache/clear` | Bearer |  |
| GET | `/api/system/health` | Bearer | Process, database, slow endpoints & queries, cache, background jobs |
| POST | `/api/system/metrics/reset` | Bearer |  |

## Users

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/users` | Bearer |  |
| PATCH | `/api/users/me` | Bearer |  |
| POST | `/api/users/staff` | Bearer |  |
| GET | `/api/users/{id}` | Bearer |  |
| PUT | `/api/users/{id}/roles` | Bearer |  |
| PATCH | `/api/users/{id}/status` | Bearer |  |

## Verification

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/verify/{code}` | Public | Public document verification (lab & radiology reports, prescriptions) — authenticity only |
