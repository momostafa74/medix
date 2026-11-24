# Database schema

PostgreSQL 14+ (tested on 16). 83 tables + `migrations`. All primary keys are UUIDs, all timestamps are `timestamptz`, money is `numeric(12,2)`, table/column names are `snake_case`. Entities live in `backend/src/database/entities/`, migrations in `backend/src/database/migrations/`.

The **whole** schema (Phases 1–8) is created now so later modules plug into existing tables instead of reshaping the core.

## Identity & access
| Table | Purpose |
|---|---|
| `users` | Every account. `phone` unique (E.164), `email` unique, bcrypt `password_hash`, `status`, `token_version` (bumped to invalidate all access tokens), `profile_completed` (false for patients who signed up with phone + password only, until they add their name), `failed_login_count` + `locked_until` (lockout), `two_factor_enabled`, `two_factor_secret` (AES-256-GCM, never selected by default), `two_factor_backup_codes` (SHA-256 hashes), `two_factor_last_step` (TOTP replay guard), `two_factor_enabled_at`. |
| `roles`, `permissions`, `user_roles`, `role_permissions` | RBAC. 12 roles × 64 permission codes. Specialties are **not** roles. |
| `sessions` | One row per refresh token (SHA-256 hash only). `family_id` enables rotation + reuse detection. |
| `verification_tokens` | Email / phone verification and password reset (hashed, single use, expiring). |

## Location
`countries → governorates → cities → areas`. Branches store optional `latitude/longitude` for future map integration; nothing depends on a maps vendor.

## Providers (generic) & doctors
| Table | Purpose |
|---|---|
| `providers` | Any public healthcare entity: `type` = DOCTOR / LABORATORY / RADIOLOGY / PHARMACY / HOSPITAL / HOME_CARE. Holds `verification_status`, denormalised `rating_avg/rating_count`, WhatsApp number. |
| `provider_branches` | Multi-branch / multi-clinic. |
| `provider_staff` | Links staff users to a provider (+ optional branch). |
| `provider_services`, `service_packages` | Priced services and packages. |
| `provider_documents` | Verification documents (license, ID…) → `files`. |
| `specialties` | Self-referencing (`parent_id`) for sub-specialties. |
| `doctors` | 1:1 with `users` and `providers`. Prices per visit type, booking policy (`auto_confirm`, `cancellation_window_hours`, `booking_horizon_days`). |
| `doctor_specialties` | Many-to-many; partial unique index guarantees one primary specialty. |
| `doctor_schedules` (+ `doctor_schedule_breaks`) | Weekly blocks in minutes-from-midnight (clinic timezone), slot length, branch, visit type. |
| `doctor_schedule_exceptions` | HOLIDAY / VACATION (day off) or CUSTOM_HOURS (replaces weekly hours). |
| `doctor_slots` | Individually closed slots. |

## Appointments
| Table | Purpose |
|---|---|
| `appointments` | Patient, provider, doctor, specialty, branch, `start_at/end_at`, type, status, price/discount/final price, payment status/method, notes, private `doctor_notes`, cancellation and reschedule links (`rescheduled_from_id`). |
| `appointment_status_history` | Every status transition with actor and note. |

**Double-booking guard (database level):**
```sql
ALTER TABLE appointments ADD CONSTRAINT appointment_no_overlap
EXCLUDE USING gist (doctor_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&)
WHERE (doctor_id IS NOT NULL AND status IN ('PENDING','CONFIRMED','CHECKED_IN','IN_PROGRESS','COMPLETED'));
```
The booking service also serialises bookings per doctor with `pg_advisory_xact_lock` inside a transaction and validates the slot against the schedule. Cancelled / rescheduled / no-show rows release the time range automatically.

## Medical records
`patients` (1:1 users), `medical_records` (1:1 patients) with `allergies`, `medical_conditions`, `medications`, `surgeries`; `medical_documents` → `files`; `patient_access_grants` (explicit consent for a provider).

## Laboratories (Phase 4 — live)
| Table | Purpose |
|---|---|
| `laboratories` | 1:1 with a LABORATORY provider. Booking rules: `slot_minutes`, `slot_capacity` (patients per branch window), `home_slot_capacity` (home visits per hour), `booking_horizon_days`, `home_collection` + fee + `home_collection_hours`, `require_separate_approver` (four-eyes). CHECK `lab_booking_ck`. |
| `provider_branches.opening_hours` | Structured weekly hours `[{day 0–6, open, close}]` in minutes — bookable lab windows are generated from these. |
| `lab_test_categories`, `lab_tests` (unique `laboratory_id+code`), `lab_test_parameters` (`result_type` NUMERIC/TEXT), `lab_test_ranges` | Each lab owns its catalog. Ranges can be gender- and/or age-specific with critical limits; the most specific matching range is chosen per patient. |
| `lab_packages`, `lab_package_items` | Packages of tests; `is_visible` is the platform moderation switch. |
| `lab_orders` | Patient, lab, branch **or** home address, `scheduled_at` window, status, `subtotal/home_fee/discount/total` (CHECK ≥ 0, always computed server-side), payment status/method/time, cancellation fields. |
| `lab_order_items` | Price snapshot per test or package at booking time. |
| `lab_order_status_history` | Every transition with actor and note. |
| `lab_samples` | One tube per sample type, unique barcode, collected/received/rejected (with reason). A rejected tube gets a replacement row. |
| `lab_results` (unique per order) | Entered/reviewed/approved by + timestamps, return note, `critical_count`, `verification_code` (QR), cached `pdf_file_id`. |
| `lab_result_items` (unique `result_id+parameter_id`) | Value, parsed numeric value, unit, reference range text, server-computed flag NORMAL/HIGH/LOW/CRITICAL, notes. |

**Capacity guard:** bookings for one lab are serialised with `pg_advisory_xact_lock('lab:<id>')`; the window's remaining capacity is re-counted inside the same transaction, so concurrent patients can never overfill a window.

## Radiology (Phase 5 — live)
| Table | Purpose |
|---|---|
| `radiology_centers` | 1:1 with a RADIOLOGY provider. `modalities`, `slot_step_minutes` (start-time grid), `booking_horizon_days`, `require_separate_approver`, `accreditation`. |
| `radiology_branch_modalities` (unique `branch_id+modality`, CHECK units 0–50) | How many machines of each modality a branch runs — the booking capacity. |
| `radiology_services` | Per-center catalog: modality, price, `duration_minutes` (how long the exam holds a machine), preparation, `requires_referral`, `report_template`, turnaround. |
| `radiology_orders` | Patient, center, service, branch, `scheduled_at`/`end_at` (CHECK end > start), `modality` snapshot, status (`BOOKED … DELIVERED`, `CANCELLED`, `NO_SHOW`), price & payment, referral file, clinical indication, referring doctor, check-in/exam timestamps, technician, cancellation, **DICOM/PACS**: `accession_number` (unique), `study_instance_uid`, `pacs_url`. |
| `radiology_order_status_history` | Every transition (and reviewer notes) with actor. |
| `radiology_order_files` | Key images / scanned films / PDFs attached to an exam (files purpose `RADIOLOGY_IMAGE`, private). |
| `radiology_reports` (unique per order) | Technique, comparison, findings, impression, recommendations, `critical`, `submitted_at`, `return_note`, reported/approved by + time, `verification_code` (QR), cached `pdf_file_id`. |

**Capacity guard:** bookings for one center are serialised with `pg_advisory_xact_lock('rad:<center>')`; inside the transaction the number of active exams overlapping the requested interval on the same branch + modality is re-counted against the machines, and the patient's own overlapping exams are rejected.

## Prescriptions & pharmacy (Phase 6 — live)
| Table | Purpose |
|---|---|
| `prescriptions` | Doctor, patient, optional appointment, diagnosis, notes, `issued_at`, `valid_until` (date), unique human `code` (RX-…) and opaque unique `verification_code` (QR). `revoked_at/revoke_reason`; **dispensing** `dispensed_at`, `dispensed_by_provider_id`, `dispensed_by_id`, `dispensed_order_id`; cached `pdf_file_id` (active state only). State (ACTIVE / DISPENSED / REVOKED / EXPIRED) is derived, never stored. |
| `prescription_items` | Ordered lines: catalog `medicine_id` **or** free-text name (name snapshot always stored), dose, frequency, duration, packs, instructions. |
| `medicines` | Shared catalog: EN/AR names, generic name, form, strength, manufacturer, `kind` MEDICINE / PRODUCT, `category`, `barcode`, `requires_prescription`, `is_active` (platform moderation), `created_by_provider_id` for items added by pharmacies. Trigram GIN indexes on `name_en` and `name_ar`. |
| `pharmacies` | 1:1 with a PHARMACY provider: `delivery_available`, `delivery_fee`, `free_delivery_over`, `min_order_for_delivery`, `estimated_delivery_minutes`, `delivery_areas_note`, `is24_hours`. Branch hours live in `provider_branches.opening_hours`. |
| `pharmacy_inventory` (unique `pharmacy_id+medicine_id`) | Price, `in_stock`, `quantity` (NULL = not tracked). CHECK price ≥ 0 and quantity ≥ 0. |
| `pharmacy_orders` | Patient, pharmacy, pickup branch **or** delivery address, optional e-prescription and/or uploaded prescription file (`PRESCRIPTION_UPLOAD`, private), status, `subtotal/delivery_fee/total` (CHECK ≥ 0, server-computed), payment status/method/time, contact phone, patient notes, pharmacist note, `stock_reserved`, timestamps per stage, driver name/phone, cancellation fields. |
| `pharmacy_order_items` | Price **and name** snapshot per line (CHECK quantity > 0, price ≥ 0). |
| `pharmacy_order_status_history` | Every transition with actor and note. |

**Stock guard:** confirming an order decrements each inventory row with `UPDATE … SET quantity = quantity - q WHERE … AND (quantity IS NULL OR quantity >= q)`; if any row is short the transaction rolls back (409 `OUT_OF_STOCK`), so concurrent confirmations can never oversell. Cancelling a confirmed order adds the quantities back.
**Single dispensing:** `UPDATE prescriptions SET dispensed_at = now() … WHERE dispensed_at IS NULL AND revoked_at IS NULL AND valid_until >= today` — only one pharmacy/counter can win. A patient's open orders are serialised with `pg_advisory_xact_lock('pho:<patient>')` for the open-orders limit, and one prescription can be attached to only one open order.

## Home services (tables ready)
`home_service_requests`.

## Payments, commission, coupons & subscriptions (Phase 7 — live)
| Table | Purpose |
|---|---|
| `payments` | One row per money movement attempt, gateway-agnostic: `entity_type` (APPOINTMENT / LAB_ORDER / RADIOLOGY_ORDER / PHARMACY_ORDER / SUBSCRIPTION) + `entity_id`, `method`, `status` (PENDING → PAID / FAILED → PARTIALLY_REFUNDED / REFUNDED), `amount`, `refunded_amount`, `collected_by` (**PLATFORM** = online through the gateway, **PROVIDER** = cash/card at the desk), `gateway`, `gateway_reference`, `payer_user_id`, `failure_reason`. CHECK `0 ≤ refunded_amount ≤ amount`. Only one PENDING attempt per record (older ones are marked FAILED). |
| `refunds` | Full or partial refunds (`amount`, `reason`, `status`, `gateway_reference`), created by finance or automatically when an online-paid booking/order is cancelled or a late gateway confirmation arrives for a record that can no longer take money. |
| `commission_rules` | GLOBAL / PROVIDER_TYPE / PROVIDER, percentage (≤ 100) or fixed; the most specific active rule wins. Seed: 10 % global, 8 % labs, 5 % pharmacies. |
| `commissions` | Snapshot per paid service payment (`gross`, `commission`, `provider_amount`, `rule_id`, `provider_id`, `entity_type`) so later rule changes never rewrite history; refunds fill `reversed_commission` / `reversed_provider_amount` proportionally. |
| `coupons` | Code, PERCENTAGE / FIXED, `max_discount`, `min_order`, `usage_limit`, `per_user_limit`, `used_count`, optional `provider_id` and `service_type` (APPOINTMENT / LAB / RADIOLOGY / PHARMACY / SUBSCRIPTION), validity window, description. |
| `coupon_redemptions` | One per use (`patient_id` or `provider_id` for subscriptions, `entity_type/entity_id`, `discount`). Redeemed under a row lock on the coupon (`SELECT … FOR UPDATE`) so a limited coupon is never over-used; released on cancellation, moved on reschedule. |
| `subscription_plans` | Per provider type (doctor / lab / radiology / pharmacy / hospital / home care): price, `duration_days`, features, default flag, active flag, order. |
| `provider_subscriptions` | One per provider: `status`, `plan_id`, `trial_ends_at`, `current_period_end`, `last_paid_at`, reminder bookkeeping. |
| `subscription_invoices` | Each purchase / renewal: plan, periods, amount, discount, total, coupon, method (ONLINE / INSTAPAY / VODAFONE_CASH / BANK_TRANSFER / CASH), `status` (PENDING → AWAITING_REVIEW → PAID / REJECTED / FAILED / CANCELLED), transfer receipt file + reference, reviewer & note, period covered, payment link. |
| `provider_settlements` | Money actually moved between the platform and a provider (`TO_PROVIDER` / `TO_PLATFORM`, amount, method, reference, note, by). |

**Denormalised for fast filtering:** `providers.subscription_ends_at` + `providers.subscription_active` (partial index `providers_subscription_ends_idx`). Every public listing, search, slot lookup, booking and new chat checks `subscription_active`, so an expired provider disappears from patients without touching their data.

**Provider balance** = online net − commission on desk payments − paid to provider + paid by provider (positive → the platform owes the provider).

Orders/appointments carry their coupon: `appointments.coupon_id/discount/final_price`, `lab_orders.coupon_id/discount`, `radiology_orders.coupon_id/discount`, `pharmacy_orders.coupon_id/discount` (amount CHECKs include the discount).

## Analytics & performance (Phase 8)
- **View `analytics_bookings`** — one row per appointment / lab order / radiology order / pharmacy order: `kind`, `id`, `provider_id`, `patient_id`, `created_at`, `service_at`, `outcome` (COMPLETED / CANCELLED / NO_SHOW / RESCHEDULED / OPEN), `amount`, `discount`, `payment_status`, `branch_id`, `specialty_id`, `channel`. Every report (platform and provider) reads from it plus the `payments` / `commissions` ledger.
- **Indexes** for reporting: `created_at` on appointments, lab/radiology/pharmacy orders and reviews; `payments(paid_at)`; `commissions(provider_id)`; `audit_logs(action, created_at)`; `sessions(user_id, created_at)` (new-device check).
- **Audit retention:** nightly batched delete of rows older than `audit.retentionDays` (the UPDATE-blocking trigger stays).

## Engagement & system
`reviews` (one per completed appointment, moderation status, rating 1–5 CHECK), `favorites`,
**chat** — `chat_rooms` (type PATIENT_PROVIDER / ADMIN_PROVIDER / SUPPORT, `subject_user_id`, block & report fields; partial unique indexes make one room per patient↔provider, one admin room per provider, one support room per user), `chat_participants` (per-user `last_read_at` → unread counts and read receipts), `chat_messages` (text and/or private attachment), `notifications`, `notification_preferences`, `files` (metadata only; bytes in storage driver), `audit_logs` (**append-only**: an UPDATE trigger raises), `system_settings`.

## Other constraints & indexes
- CHECKs: schedule ranges & slot length, break ranges, exception dates, non-negative prices, rating 1–5, percentage commission ≤ 100.
- Trigram (`pg_trgm`) GIN indexes on provider names, specialty names, medicine names, lab test names for fuzzy search.
- Composite indexes for every hot query path (doctor+start, patient+start, provider+start, status, provider type+status, audit entity/user/time…).

## Migrations
```bash
npm run migration:run                                     # apply
npm run migration:revert                                  # roll back last
npm run migration:generate -- src/database/migrations/Name # after changing entities
```
`synchronize` is permanently `false`. Extensions (`uuid-ossp`, `btree_gist`, `pg_trgm`) are created by the migrations; on PostgreSQL 13+ they are "trusted", so the database owner can create them without superuser.
