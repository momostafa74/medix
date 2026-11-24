import { MigrationInterface, QueryRunner } from "typeorm";

export class CommercePhase71791403755382 implements MigrationInterface {
    name = 'CommercePhase71791403755382'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "subscription_plans" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "code" character varying NOT NULL, "provider_type" "public"."provider_type" NOT NULL, "name_ar" character varying NOT NULL, "description" text, "price" numeric(12,2) NOT NULL, "duration_days" integer NOT NULL DEFAULT '30', "features" jsonb NOT NULL DEFAULT '[]', "is_default" boolean NOT NULL DEFAULT false, "is_active" boolean NOT NULL DEFAULT true, "sort_order" integer NOT NULL DEFAULT '0', CONSTRAINT "UQ_2d2df70a81d37c893ef216caf8a" UNIQUE ("code"), CONSTRAINT "subscription_plan_ck" CHECK ("price" >= 0 AND "duration_days" BETWEEN 1 AND 366), CONSTRAINT "PK_9ab8fe6918451ab3d0a4fb6bb0c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "provider_subscriptions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "provider_id" uuid NOT NULL, "plan_id" uuid, "status" character varying(10) NOT NULL DEFAULT 'TRIAL', "trial_ends_at" TIMESTAMP WITH TIME ZONE, "current_period_end" TIMESTAMP WITH TIME ZONE NOT NULL, "last_paid_at" TIMESTAMP WITH TIME ZONE, "reminder_sent_at" TIMESTAMP WITH TIME ZONE, "expired_notified_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_19c6042eea9d99796be34c25df4" UNIQUE ("provider_id"), CONSTRAINT "REL_19c6042eea9d99796be34c25df" UNIQUE ("provider_id"), CONSTRAINT "PK_b428463f4faba7b0f1c86399475" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "subscription_invoices" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "code" character varying NOT NULL, "provider_id" uuid NOT NULL, "plan_id" uuid, "periods" integer NOT NULL DEFAULT '1', "amount" numeric(12,2) NOT NULL, "discount" numeric(12,2) NOT NULL DEFAULT '0', "total" numeric(12,2) NOT NULL, "coupon_id" uuid, "status" character varying(16) NOT NULL DEFAULT 'PENDING', "method" character varying(16) NOT NULL, "payment_id" uuid, "proof_file_id" uuid, "transfer_reference" character varying, "period_start" TIMESTAMP WITH TIME ZONE, "period_end" TIMESTAMP WITH TIME ZONE, "reviewed_by_id" uuid, "review_note" text, "paid_at" TIMESTAMP WITH TIME ZONE, "created_by_id" uuid, CONSTRAINT "UQ_ad6b15d8feff4c58579355245a4" UNIQUE ("code"), CONSTRAINT "subscription_invoice_ck" CHECK ("amount" >= 0 AND "discount" >= 0 AND "total" >= 0 AND "periods" BETWEEN 1 AND 12), CONSTRAINT "PK_7050ae7d81f0f0207b8f1cd2efc" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_a1157200973b566a6bf4204f16" ON "subscription_invoices" ("status") `);
        await queryRunner.query(`CREATE INDEX "IDX_87ac1dc3e020631a295c0e0448" ON "subscription_invoices" ("provider_id", "created_at") `);
        await queryRunner.query(`CREATE TABLE "provider_settlements" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "provider_id" uuid NOT NULL, "direction" character varying(12) NOT NULL, "amount" numeric(12,2) NOT NULL, "method" character varying, "reference" character varying, "note" text, "created_by_id" uuid, CONSTRAINT "provider_settlement_ck" CHECK ("amount" > 0), CONSTRAINT "PK_f3fc5c525a99fad937b63791da6" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_82ca77b67fbd63afa29b40a1c2" ON "provider_settlements" ("provider_id", "created_at") `);
        await queryRunner.query(`ALTER TABLE "users" ADD "profile_completed" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "providers" ADD "subscription_active" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "providers" ADD "subscription_ends_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "lab_orders" ADD "coupon_id" uuid`);
        await queryRunner.query(`ALTER TABLE "radiology_orders" ADD "discount" numeric(12,2) NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "radiology_orders" ADD "coupon_id" uuid`);
        await queryRunner.query(`ALTER TABLE "pharmacy_orders" ADD "discount" numeric(12,2) NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "pharmacy_orders" ADD "coupon_id" uuid`);
        await queryRunner.query(`ALTER TABLE "payments" ADD "payer_user_id" uuid`);
        await queryRunner.query(`ALTER TABLE "payments" ADD "description" character varying`);
        await queryRunner.query(`ALTER TABLE "payments" ADD "refunded_amount" numeric(12,2) NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "payments" ADD "failure_reason" text`);
        await queryRunner.query(`ALTER TABLE "payments" ADD "collected_by" character varying(10) NOT NULL DEFAULT 'PROVIDER'`);
        await queryRunner.query(`ALTER TABLE "payments" ADD "recorded_by_id" uuid`);
        await queryRunner.query(`ALTER TABLE "refunds" ADD "status" character varying(12) NOT NULL DEFAULT 'COMPLETED'`);
        await queryRunner.query(`ALTER TABLE "refunds" ADD "gateway_reference" character varying`);
        await queryRunner.query(`ALTER TABLE "commissions" ADD "provider_id" uuid`);
        await queryRunner.query(`ALTER TABLE "commissions" ADD "entity_type" character varying`);
        await queryRunner.query(`ALTER TABLE "commissions" ADD "reversed_commission" numeric(12,2) NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "commissions" ADD "reversed_provider_amount" numeric(12,2) NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "coupons" ADD "description" character varying`);
        await queryRunner.query(`ALTER TABLE "coupon_redemptions" ADD "provider_id" uuid`);
        await queryRunner.query(`ALTER TABLE "payments" DROP CONSTRAINT "FK_4d2ce22525e1801b449f24a9898"`);
        await queryRunner.query(`ALTER TABLE "payments" ALTER COLUMN "patient_id" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "coupon_redemptions" DROP CONSTRAINT "FK_a51c729aca0c14a93b761d5a00d"`);
        await queryRunner.query(`ALTER TABLE "coupon_redemptions" ALTER COLUMN "patient_id" DROP NOT NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_4d2ce22525e1801b449f24a989" ON "payments" ("patient_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_58620d2791557a4d0f44e87744" ON "payments" ("status", "created_at") `);
        await queryRunner.query(`ALTER TABLE "payments" ADD CONSTRAINT "payment_amounts_ck" CHECK ("amount" >= 0 AND "refunded_amount" >= 0 AND "refunded_amount" <= "amount")`);
        await queryRunner.query(`ALTER TABLE "payments" ADD CONSTRAINT "FK_4d2ce22525e1801b449f24a9898" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "FK_a51c729aca0c14a93b761d5a00d" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "provider_subscriptions" ADD CONSTRAINT "FK_19c6042eea9d99796be34c25df4" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "provider_subscriptions" ADD CONSTRAINT "FK_44d40957289737af79bf6611d4f" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "subscription_invoices" ADD CONSTRAINT "FK_85f3318c0536a238ed2199d37b5" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "subscription_invoices" ADD CONSTRAINT "FK_287b9b748c0928e5652926df23b" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "provider_settlements" ADD CONSTRAINT "FK_acb411f3221f8076c8c9718a88f" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "pharmacy_orders" DROP CONSTRAINT IF EXISTS "pharmacy_order_amounts_ck"`);
        await queryRunner.query(`ALTER TABLE "pharmacy_orders" ADD CONSTRAINT "pharmacy_order_amounts_ck" CHECK ("subtotal" >= 0 AND "delivery_fee" >= 0 AND "discount" >= 0 AND "total" >= 0)`);
        // Existing providers keep working: everyone starts with a 30-day period to choose a plan and pay.
        await queryRunner.query(`INSERT INTO provider_subscriptions (provider_id, status, trial_ends_at, current_period_end)
                                 SELECT id, 'TRIAL', now() + interval '30 days', now() + interval '30 days' FROM providers
                                 ON CONFLICT (provider_id) DO NOTHING`);
        await queryRunner.query(`UPDATE providers p SET subscription_ends_at = s.current_period_end, subscription_active = true FROM provider_subscriptions s WHERE s.provider_id = p.id`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "providers_subscription_ends_idx" ON "providers" ("subscription_ends_at")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "providers_subscription_ends_idx"`);
        await queryRunner.query(`ALTER TABLE "pharmacy_orders" DROP CONSTRAINT IF EXISTS "pharmacy_order_amounts_ck"`);
        await queryRunner.query(`ALTER TABLE "pharmacy_orders" ADD CONSTRAINT "pharmacy_order_amounts_ck" CHECK ("subtotal" >= 0 AND "delivery_fee" >= 0 AND "total" >= 0)`);
        await queryRunner.query(`ALTER TABLE "provider_settlements" DROP CONSTRAINT "FK_acb411f3221f8076c8c9718a88f"`);
        await queryRunner.query(`ALTER TABLE "subscription_invoices" DROP CONSTRAINT "FK_287b9b748c0928e5652926df23b"`);
        await queryRunner.query(`ALTER TABLE "subscription_invoices" DROP CONSTRAINT "FK_85f3318c0536a238ed2199d37b5"`);
        await queryRunner.query(`ALTER TABLE "provider_subscriptions" DROP CONSTRAINT "FK_44d40957289737af79bf6611d4f"`);
        await queryRunner.query(`ALTER TABLE "provider_subscriptions" DROP CONSTRAINT "FK_19c6042eea9d99796be34c25df4"`);
        await queryRunner.query(`ALTER TABLE "coupon_redemptions" DROP CONSTRAINT "FK_a51c729aca0c14a93b761d5a00d"`);
        await queryRunner.query(`ALTER TABLE "payments" DROP CONSTRAINT "FK_4d2ce22525e1801b449f24a9898"`);
        await queryRunner.query(`ALTER TABLE "payments" DROP CONSTRAINT "payment_amounts_ck"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_58620d2791557a4d0f44e87744"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4d2ce22525e1801b449f24a989"`);
        await queryRunner.query(`ALTER TABLE "coupon_redemptions" ALTER COLUMN "patient_id" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "FK_a51c729aca0c14a93b761d5a00d" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "payments" ALTER COLUMN "patient_id" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "payments" ADD CONSTRAINT "FK_4d2ce22525e1801b449f24a9898" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "coupon_redemptions" DROP COLUMN "provider_id"`);
        await queryRunner.query(`ALTER TABLE "coupons" DROP COLUMN "description"`);
        await queryRunner.query(`ALTER TABLE "commissions" DROP COLUMN "reversed_provider_amount"`);
        await queryRunner.query(`ALTER TABLE "commissions" DROP COLUMN "reversed_commission"`);
        await queryRunner.query(`ALTER TABLE "commissions" DROP COLUMN "entity_type"`);
        await queryRunner.query(`ALTER TABLE "commissions" DROP COLUMN "provider_id"`);
        await queryRunner.query(`ALTER TABLE "refunds" DROP COLUMN "gateway_reference"`);
        await queryRunner.query(`ALTER TABLE "refunds" DROP COLUMN "status"`);
        await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "recorded_by_id"`);
        await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "collected_by"`);
        await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "failure_reason"`);
        await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "refunded_amount"`);
        await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "description"`);
        await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "payer_user_id"`);
        await queryRunner.query(`ALTER TABLE "pharmacy_orders" DROP COLUMN "coupon_id"`);
        await queryRunner.query(`ALTER TABLE "pharmacy_orders" DROP COLUMN "discount"`);
        await queryRunner.query(`ALTER TABLE "radiology_orders" DROP COLUMN "coupon_id"`);
        await queryRunner.query(`ALTER TABLE "radiology_orders" DROP COLUMN "discount"`);
        await queryRunner.query(`ALTER TABLE "lab_orders" DROP COLUMN "coupon_id"`);
        await queryRunner.query(`ALTER TABLE "providers" DROP COLUMN "subscription_ends_at"`);
        await queryRunner.query(`ALTER TABLE "providers" DROP COLUMN "subscription_active"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "profile_completed"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_82ca77b67fbd63afa29b40a1c2"`);
        await queryRunner.query(`DROP TABLE "provider_settlements"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_87ac1dc3e020631a295c0e0448"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a1157200973b566a6bf4204f16"`);
        await queryRunner.query(`DROP TABLE "subscription_invoices"`);
        await queryRunner.query(`DROP TABLE "provider_subscriptions"`);
        await queryRunner.query(`DROP TABLE "subscription_plans"`);
    }

}
