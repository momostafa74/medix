import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Database-level business rules that an ORM cannot express:
 *
 * 1. appointment_no_overlap — EXCLUSION constraint. For the same doctor, no two
 *    appointments in an "active" status may have overlapping [start_at, end_at).
 *    This is the final guard against double booking: even if two requests race
 *    past every application check, PostgreSQL rejects the second INSERT/UPDATE.
 * 2. CHECK constraints for ranges, ratings, prices.
 * 3. Trigram indexes for fast Arabic/English fuzzy search.
 */
export class IntegrityConstraints1791143900000 implements MigrationInterface {
  name = 'IntegrityConstraints1791143900000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS btree_gist`);
    await q.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

    await q.query(`
      ALTER TABLE appointments
      ADD CONSTRAINT appointment_no_overlap
      EXCLUDE USING gist (
        doctor_id WITH =,
        tstzrange(start_at, end_at, '[)') WITH &&
      )
      WHERE (doctor_id IS NOT NULL AND status IN ('PENDING','CONFIRMED','CHECKED_IN','IN_PROGRESS','COMPLETED'))
    `);
    await q.query(`ALTER TABLE appointments ADD CONSTRAINT appointment_time_order CHECK (end_at > start_at)`);
    await q.query(
      `ALTER TABLE appointments ADD CONSTRAINT appointment_price_non_negative CHECK (price >= 0 AND final_price >= 0 AND discount >= 0)`,
    );

    await q.query(
      `ALTER TABLE doctor_schedules ADD CONSTRAINT doctor_schedule_valid CHECK (day_of_week BETWEEN 0 AND 6 AND start_minute >= 0 AND end_minute <= 1440 AND end_minute > start_minute AND slot_duration BETWEEN 5 AND 240)`,
    );
    await q.query(
      `ALTER TABLE doctor_schedule_breaks ADD CONSTRAINT doctor_break_valid CHECK (end_minute > start_minute)`,
    );
    await q.query(
      `ALTER TABLE doctor_schedule_exceptions ADD CONSTRAINT doctor_exception_valid CHECK (end_date >= start_date)`,
    );
    await q.query(`ALTER TABLE reviews ADD CONSTRAINT review_rating_range CHECK (rating BETWEEN 1 AND 5)`);
    await q.query(`ALTER TABLE doctors ADD CONSTRAINT doctor_price_non_negative CHECK (consultation_price >= 0)`);
    await q.query(
      `ALTER TABLE commission_rules ADD CONSTRAINT commission_value_valid CHECK (value >= 0 AND (type <> 'PERCENTAGE' OR value <= 100))`,
    );

    // Only one primary specialty per doctor
    await q.query(
      `CREATE UNIQUE INDEX doctor_one_primary_specialty ON doctor_specialties (doctor_id) WHERE is_primary`,
    );

    // Fuzzy search
    await q.query(`CREATE INDEX providers_name_ar_trgm ON providers USING gin (name_ar gin_trgm_ops)`);
    await q.query(`CREATE INDEX providers_name_en_trgm ON providers USING gin (name_en gin_trgm_ops)`);
    await q.query(`CREATE INDEX specialties_name_ar_trgm ON specialties USING gin (name_ar gin_trgm_ops)`);
    await q.query(`CREATE INDEX medicines_name_en_trgm ON medicines USING gin (name_en gin_trgm_ops)`);
    await q.query(`CREATE INDEX lab_tests_name_trgm ON lab_tests USING gin (name gin_trgm_ops)`);

    // Audit logs are append-only from the application's point of view
    await q.query(`
      CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'audit_logs is append-only'; END; $$ LANGUAGE plpgsql;
    `);
    await q.query(
      `CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable()`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TRIGGER IF EXISTS audit_logs_no_update ON audit_logs`);
    await q.query(`DROP FUNCTION IF EXISTS audit_logs_immutable`);
    for (const idx of [
      'lab_tests_name_trgm',
      'medicines_name_en_trgm',
      'specialties_name_ar_trgm',
      'providers_name_en_trgm',
      'providers_name_ar_trgm',
      'doctor_one_primary_specialty',
    ]) {
      await q.query(`DROP INDEX IF EXISTS ${idx}`);
    }
    await q.query(`ALTER TABLE commission_rules DROP CONSTRAINT IF EXISTS commission_value_valid`);
    await q.query(`ALTER TABLE doctors DROP CONSTRAINT IF EXISTS doctor_price_non_negative`);
    await q.query(`ALTER TABLE reviews DROP CONSTRAINT IF EXISTS review_rating_range`);
    await q.query(`ALTER TABLE doctor_schedule_exceptions DROP CONSTRAINT IF EXISTS doctor_exception_valid`);
    await q.query(`ALTER TABLE doctor_schedule_breaks DROP CONSTRAINT IF EXISTS doctor_break_valid`);
    await q.query(`ALTER TABLE doctor_schedules DROP CONSTRAINT IF EXISTS doctor_schedule_valid`);
    await q.query(`ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointment_price_non_negative`);
    await q.query(`ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointment_time_order`);
    await q.query(`ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointment_no_overlap`);
  }
}
