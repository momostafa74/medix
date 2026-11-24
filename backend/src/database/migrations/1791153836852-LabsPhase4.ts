import { MigrationInterface, QueryRunner } from "typeorm";

export class LabsPhase41791153836852 implements MigrationInterface {
    name = 'LabsPhase41791153836852'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "lab_order_status_history" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "order_id" uuid NOT NULL, "from_status" "public"."lab_order_status", "to_status" "public"."lab_order_status" NOT NULL, "changed_by_id" uuid, "note" text, CONSTRAINT "PK_0bf6ba89b573d03cb4454556b3b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_efbafbf52177c3d08ee4447eff" ON "lab_order_status_history" ("order_id", "created_at") `);
        await queryRunner.query(`ALTER TABLE "provider_branches" ADD "opening_hours" jsonb`);
        await queryRunner.query(`ALTER TABLE "laboratories" ADD "slot_minutes" integer NOT NULL DEFAULT '30'`);
        await queryRunner.query(`ALTER TABLE "laboratories" ADD "slot_capacity" integer NOT NULL DEFAULT '4'`);
        await queryRunner.query(`ALTER TABLE "laboratories" ADD "home_slot_capacity" integer NOT NULL DEFAULT '2'`);
        await queryRunner.query(`ALTER TABLE "laboratories" ADD "booking_horizon_days" integer NOT NULL DEFAULT '14'`);
        await queryRunner.query(`ALTER TABLE "laboratories" ADD "home_collection_hours" jsonb`);
        await queryRunner.query(`ALTER TABLE "laboratories" ADD "require_separate_approver" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "lab_test_parameters" ADD "result_type" character varying(10) NOT NULL DEFAULT 'NUMERIC'`);
        await queryRunner.query(`ALTER TABLE "lab_orders" ADD "contact_phone" character varying`);
        await queryRunner.query(`ALTER TABLE "lab_orders" ADD "subtotal" numeric(12,2) NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "lab_orders" ADD "home_fee" numeric(12,2) NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "lab_orders" ADD "discount" numeric(12,2) NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "lab_orders" ADD "payment_method" "public"."payment_method"`);
        await queryRunner.query(`ALTER TABLE "lab_orders" ADD "paid_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "lab_orders" ADD "cancelled_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "lab_orders" ADD "cancelled_by_id" uuid`);
        await queryRunner.query(`ALTER TABLE "lab_orders" ADD "cancel_reason" text`);
        await queryRunner.query(`ALTER TABLE "lab_orders" ADD "delivered_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "lab_orders" ADD "created_by_id" uuid`);
        await queryRunner.query(`ALTER TABLE "lab_samples" ADD "tests_label" text`);
        await queryRunner.query(`ALTER TABLE "lab_samples" ADD "rejected_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "lab_samples" ADD "rejected_by_id" uuid`);
        await queryRunner.query(`ALTER TABLE "lab_samples" ADD "reject_reason" text`);
        await queryRunner.query(`ALTER TABLE "lab_results" ADD "return_note" text`);
        await queryRunner.query(`ALTER TABLE "lab_results" ADD "critical_count" integer NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "lab_result_items" ADD "test_id" uuid`);
        await queryRunner.query(`ALTER TABLE "lab_result_items" ADD "numeric_value" numeric(14,4)`);
        await queryRunner.query(`ALTER TABLE "lab_results" DROP CONSTRAINT "FK_500778438e2e6d443a2064c8e84"`);
        await queryRunner.query(`ALTER TABLE "lab_results" ADD CONSTRAINT "UQ_500778438e2e6d443a2064c8e84" UNIQUE ("order_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_67fa85523e032e57d66e1ae139" ON "lab_orders" ("laboratory_id", "scheduled_at") `);
        await queryRunner.query(`ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_order_amounts_ck" CHECK ("subtotal" >= 0 AND "home_fee" >= 0 AND "discount" >= 0 AND "total" >= 0)`);
        await queryRunner.query(`ALTER TABLE "laboratories" ADD CONSTRAINT "lab_booking_ck" CHECK ("slot_minutes" BETWEEN 5 AND 240 AND "slot_capacity" >= 1 AND "home_slot_capacity" >= 0 AND "booking_horizon_days" BETWEEN 1 AND 90)`);
        await queryRunner.query(`ALTER TABLE "lab_result_items" ADD CONSTRAINT "UQ_6016bd2b6bb1cbe75173b3dd4d6" UNIQUE ("result_id", "parameter_id")`);
        await queryRunner.query(`ALTER TABLE "lab_order_status_history" ADD CONSTRAINT "FK_4c03d6e05c2d6a60209d85831bd" FOREIGN KEY ("order_id") REFERENCES "lab_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "lab_results" ADD CONSTRAINT "FK_500778438e2e6d443a2064c8e84" FOREIGN KEY ("order_id") REFERENCES "lab_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "lab_results" DROP CONSTRAINT "FK_500778438e2e6d443a2064c8e84"`);
        await queryRunner.query(`ALTER TABLE "lab_order_status_history" DROP CONSTRAINT "FK_4c03d6e05c2d6a60209d85831bd"`);
        await queryRunner.query(`ALTER TABLE "lab_result_items" DROP CONSTRAINT "UQ_6016bd2b6bb1cbe75173b3dd4d6"`);
        await queryRunner.query(`ALTER TABLE "lab_orders" DROP CONSTRAINT "lab_order_amounts_ck"`);
        await queryRunner.query(`ALTER TABLE "laboratories" DROP CONSTRAINT "lab_booking_ck"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_67fa85523e032e57d66e1ae139"`);
        await queryRunner.query(`ALTER TABLE "lab_results" DROP CONSTRAINT "UQ_500778438e2e6d443a2064c8e84"`);
        await queryRunner.query(`ALTER TABLE "lab_results" ADD CONSTRAINT "FK_500778438e2e6d443a2064c8e84" FOREIGN KEY ("order_id") REFERENCES "lab_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "lab_result_items" DROP COLUMN "numeric_value"`);
        await queryRunner.query(`ALTER TABLE "lab_result_items" DROP COLUMN "test_id"`);
        await queryRunner.query(`ALTER TABLE "lab_results" DROP COLUMN "critical_count"`);
        await queryRunner.query(`ALTER TABLE "lab_results" DROP COLUMN "return_note"`);
        await queryRunner.query(`ALTER TABLE "lab_samples" DROP COLUMN "reject_reason"`);
        await queryRunner.query(`ALTER TABLE "lab_samples" DROP COLUMN "rejected_by_id"`);
        await queryRunner.query(`ALTER TABLE "lab_samples" DROP COLUMN "rejected_at"`);
        await queryRunner.query(`ALTER TABLE "lab_samples" DROP COLUMN "tests_label"`);
        await queryRunner.query(`ALTER TABLE "lab_orders" DROP COLUMN "created_by_id"`);
        await queryRunner.query(`ALTER TABLE "lab_orders" DROP COLUMN "delivered_at"`);
        await queryRunner.query(`ALTER TABLE "lab_orders" DROP COLUMN "cancel_reason"`);
        await queryRunner.query(`ALTER TABLE "lab_orders" DROP COLUMN "cancelled_by_id"`);
        await queryRunner.query(`ALTER TABLE "lab_orders" DROP COLUMN "cancelled_at"`);
        await queryRunner.query(`ALTER TABLE "lab_orders" DROP COLUMN "paid_at"`);
        await queryRunner.query(`ALTER TABLE "lab_orders" DROP COLUMN "payment_method"`);
        await queryRunner.query(`ALTER TABLE "lab_orders" DROP COLUMN "discount"`);
        await queryRunner.query(`ALTER TABLE "lab_orders" DROP COLUMN "home_fee"`);
        await queryRunner.query(`ALTER TABLE "lab_orders" DROP COLUMN "subtotal"`);
        await queryRunner.query(`ALTER TABLE "lab_orders" DROP COLUMN "contact_phone"`);
        await queryRunner.query(`ALTER TABLE "lab_test_parameters" DROP COLUMN "result_type"`);
        await queryRunner.query(`ALTER TABLE "laboratories" DROP COLUMN "require_separate_approver"`);
        await queryRunner.query(`ALTER TABLE "laboratories" DROP COLUMN "home_collection_hours"`);
        await queryRunner.query(`ALTER TABLE "laboratories" DROP COLUMN "booking_horizon_days"`);
        await queryRunner.query(`ALTER TABLE "laboratories" DROP COLUMN "home_slot_capacity"`);
        await queryRunner.query(`ALTER TABLE "laboratories" DROP COLUMN "slot_capacity"`);
        await queryRunner.query(`ALTER TABLE "laboratories" DROP COLUMN "slot_minutes"`);
        await queryRunner.query(`ALTER TABLE "provider_branches" DROP COLUMN "opening_hours"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_efbafbf52177c3d08ee4447eff"`);
        await queryRunner.query(`DROP TABLE "lab_order_status_history"`);
    }

}
