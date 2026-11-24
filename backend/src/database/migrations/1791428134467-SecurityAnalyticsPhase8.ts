import { MigrationInterface, QueryRunner } from "typeorm";

export class SecurityAnalyticsPhase81791428134467 implements MigrationInterface {
    name = 'SecurityAnalyticsPhase81791428134467'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_085d540d9f418cfbdc7bd55bb1"`);
        await queryRunner.query(`ALTER TABLE "users" ADD "failed_login_count" integer NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "users" ADD "locked_until" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "users" ADD "two_factor_enabled" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "users" ADD "two_factor_secret" character varying(200)`);
        await queryRunner.query(`ALTER TABLE "users" ADD "two_factor_backup_codes" jsonb`);
        await queryRunner.query(`ALTER TABLE "users" ADD "two_factor_last_step" bigint`);
        await queryRunner.query(`ALTER TABLE "users" ADD "two_factor_enabled_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`CREATE INDEX "IDX_01fa943b893e3449f55443dde9" ON "sessions" ("user_id", "created_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_387464fb81909344c275230cc0" ON "appointments" ("created_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_65e1bc9e244c65bd5aacd19b13" ON "lab_orders" ("created_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_c076201f2237f667eb29b1cae5" ON "radiology_orders" ("created_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_a80e77146038d3f5f60e80d3f1" ON "pharmacy_orders" ("created_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_7848ab97e1ac9dddf781103de5" ON "payments" ("paid_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_b02a4e1ef1138c416297ba5843" ON "commissions" ("provider_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_d3b0d4755fa5510f2a4041ffc8" ON "reviews" ("created_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_99fca4a3a4a93c26a756c5aca5" ON "audit_logs" ("action", "created_at") `);
        // One row per booking/order of any kind — the base of every analytics report.
        await queryRunner.query(`
          CREATE VIEW analytics_bookings AS
          SELECT 'APPOINTMENT'::text AS kind, a.id, a.provider_id, a.patient_id, a.created_at, a.start_at AS service_at,
                 CASE a.status WHEN 'COMPLETED' THEN 'COMPLETED' WHEN 'CANCELLED' THEN 'CANCELLED' WHEN 'NO_SHOW' THEN 'NO_SHOW'
                               WHEN 'RESCHEDULED' THEN 'RESCHEDULED' ELSE 'OPEN' END AS outcome,
                 a.final_price AS amount, a.discount, a.payment_status::text AS payment_status, a.branch_id, a.specialty_id, a.type::text AS channel
            FROM appointments a
          UNION ALL
          SELECT 'LAB_ORDER', o.id, l.provider_id, o.patient_id, o.created_at, coalesce(o.scheduled_at, o.created_at),
                 CASE WHEN o.status IN ('APPROVED', 'DELIVERED') THEN 'COMPLETED' WHEN o.status = 'CANCELLED' THEN 'CANCELLED' ELSE 'OPEN' END,
                 o.total, o.discount, o.payment_status::text, o.branch_id, NULL::uuid, CASE WHEN o.home_collection THEN 'HOME' ELSE 'BRANCH' END
            FROM lab_orders o JOIN laboratories l ON l.id = o.laboratory_id
          UNION ALL
          SELECT 'RADIOLOGY_ORDER', o.id, c.provider_id, o.patient_id, o.created_at, o.scheduled_at,
                 CASE WHEN o.status IN ('APPROVED', 'DELIVERED') THEN 'COMPLETED' WHEN o.status = 'CANCELLED' THEN 'CANCELLED'
                      WHEN o.status = 'NO_SHOW' THEN 'NO_SHOW' ELSE 'OPEN' END,
                 o.price - o.discount, o.discount, o.payment_status::text, o.branch_id, NULL::uuid, 'BRANCH'
            FROM radiology_orders o JOIN radiology_centers c ON c.id = o.center_id
          UNION ALL
          SELECT 'PHARMACY_ORDER', o.id, ph.provider_id, o.patient_id, o.created_at, o.created_at,
                 CASE WHEN o.status = 'DELIVERED' THEN 'COMPLETED' WHEN o.status = 'CANCELLED' THEN 'CANCELLED' ELSE 'OPEN' END,
                 o.total, o.discount, o.payment_status::text, o.branch_id, NULL::uuid, o.fulfillment::text
            FROM pharmacy_orders o JOIN pharmacies ph ON ph.id = o.pharmacy_id`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP VIEW IF EXISTS analytics_bookings`);
        await queryRunner.query(`DROP INDEX "public"."IDX_99fca4a3a4a93c26a756c5aca5"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d3b0d4755fa5510f2a4041ffc8"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b02a4e1ef1138c416297ba5843"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7848ab97e1ac9dddf781103de5"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a80e77146038d3f5f60e80d3f1"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c076201f2237f667eb29b1cae5"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_65e1bc9e244c65bd5aacd19b13"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_387464fb81909344c275230cc0"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_01fa943b893e3449f55443dde9"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "two_factor_enabled_at"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "two_factor_last_step"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "two_factor_backup_codes"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "two_factor_secret"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "two_factor_enabled"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "locked_until"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "failed_login_count"`);
        await queryRunner.query(`CREATE INDEX "IDX_085d540d9f418cfbdc7bd55bb1" ON "sessions" ("user_id") `);
    }

}
