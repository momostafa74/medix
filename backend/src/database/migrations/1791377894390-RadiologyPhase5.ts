import { MigrationInterface, QueryRunner } from "typeorm";

export class RadiologyPhase51791377894390 implements MigrationInterface {
    name = 'RadiologyPhase51791377894390'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "public"."radiology_order_status" ADD VALUE IF NOT EXISTS 'NO_SHOW'`);
        await queryRunner.query(`CREATE TABLE "radiology_branch_modalities" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "center_id" uuid NOT NULL, "branch_id" uuid NOT NULL, "modality" character varying NOT NULL, "units" integer NOT NULL DEFAULT '1', CONSTRAINT "UQ_a35a64b23c5c5a9516b507222ac" UNIQUE ("branch_id", "modality"), CONSTRAINT "radiology_units_ck" CHECK ("units" BETWEEN 0 AND 50), CONSTRAINT "PK_99731165e44631d74cabe52a6c5" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "radiology_order_status_history" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "order_id" uuid NOT NULL, "from_status" "public"."radiology_order_status", "to_status" "public"."radiology_order_status" NOT NULL, "changed_by_id" uuid, "note" text, CONSTRAINT "PK_dc167af565cded9574479dfd1b5" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_0e962807a1d82343c030ba1886" ON "radiology_order_status_history" ("order_id", "created_at") `);
        await queryRunner.query(`CREATE TABLE "radiology_order_files" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "order_id" uuid NOT NULL, "file_id" uuid NOT NULL, "caption" character varying, "uploaded_by_id" uuid, CONSTRAINT "PK_1d914e0d9306c150a1671bfe32f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_0742358d9955ac80e8ce64c0a7" ON "radiology_order_files" ("order_id") `);
        await queryRunner.query(`ALTER TABLE "radiology_centers" ADD "slot_step_minutes" integer NOT NULL DEFAULT '15'`);
        await queryRunner.query(`ALTER TABLE "radiology_centers" ADD "booking_horizon_days" integer NOT NULL DEFAULT '30'`);
        await queryRunner.query(`ALTER TABLE "radiology_centers" ADD "require_separate_approver" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "radiology_centers" ADD "accreditation" character varying`);
        await queryRunner.query(`ALTER TABLE "radiology_services" ADD "requires_referral" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "radiology_services" ADD "report_template" text`);
        await queryRunner.query(`ALTER TABLE "radiology_services" ADD "turnaround_hours" integer`);
        await queryRunner.query(`ALTER TABLE "radiology_orders" ADD "end_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "radiology_orders" ADD "modality" character varying`);
        // Backfill rows created before Phase 5, then enforce NOT NULL.
        await queryRunner.query(`UPDATE "radiology_orders" o SET "end_at" = o."scheduled_at" + make_interval(mins => s."duration_minutes"), "modality" = s."modality" FROM "radiology_services" s WHERE s."id" = o."service_id"`);
        await queryRunner.query(`ALTER TABLE "radiology_orders" ALTER COLUMN "end_at" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "radiology_orders" ALTER COLUMN "modality" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "radiology_orders" ADD "clinical_indication" text`);
        await queryRunner.query(`ALTER TABLE "radiology_orders" ADD "referring_doctor" character varying`);
        await queryRunner.query(`ALTER TABLE "radiology_orders" ADD "contact_phone" character varying`);
        await queryRunner.query(`ALTER TABLE "radiology_orders" ADD "payment_method" "public"."payment_method"`);
        await queryRunner.query(`ALTER TABLE "radiology_orders" ADD "paid_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "radiology_orders" ADD "checked_in_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "radiology_orders" ADD "exam_started_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "radiology_orders" ADD "exam_completed_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "radiology_orders" ADD "technician_id" uuid`);
        await queryRunner.query(`ALTER TABLE "radiology_orders" ADD "cancelled_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "radiology_orders" ADD "cancelled_by_id" uuid`);
        await queryRunner.query(`ALTER TABLE "radiology_orders" ADD "cancel_reason" text`);
        await queryRunner.query(`ALTER TABLE "radiology_orders" ADD "delivered_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "radiology_orders" ADD "created_by_id" uuid`);
        await queryRunner.query(`ALTER TABLE "radiology_reports" ADD "technique" text`);
        await queryRunner.query(`ALTER TABLE "radiology_reports" ADD "comparison" text`);
        await queryRunner.query(`ALTER TABLE "radiology_reports" ADD "recommendations" text`);
        await queryRunner.query(`ALTER TABLE "radiology_reports" ADD "critical" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "radiology_reports" ADD "submitted_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "radiology_reports" ADD "return_note" text`);
        await queryRunner.query(`CREATE INDEX "IDX_f67553c8626231a5af4303cf20" ON "radiology_orders" ("center_id", "scheduled_at") `);
        await queryRunner.query(`ALTER TABLE "radiology_orders" ADD CONSTRAINT "radiology_order_time_ck" CHECK ("end_at" > "scheduled_at")`);
        await queryRunner.query(`ALTER TABLE "radiology_branch_modalities" ADD CONSTRAINT "FK_c9334c225993cf96770acbab545" FOREIGN KEY ("center_id") REFERENCES "radiology_centers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "radiology_branch_modalities" ADD CONSTRAINT "FK_9b183bd3ab3b5060b169601f2e9" FOREIGN KEY ("branch_id") REFERENCES "provider_branches"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "radiology_order_status_history" ADD CONSTRAINT "FK_cf36c38c17b96e153e9eb111338" FOREIGN KEY ("order_id") REFERENCES "radiology_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "radiology_order_files" ADD CONSTRAINT "FK_0742358d9955ac80e8ce64c0a77" FOREIGN KEY ("order_id") REFERENCES "radiology_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "radiology_order_files" ADD CONSTRAINT "FK_661df1e0a1e4618e1f3bc464f4f" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "radiology_order_files" DROP CONSTRAINT "FK_661df1e0a1e4618e1f3bc464f4f"`);
        await queryRunner.query(`ALTER TABLE "radiology_order_files" DROP CONSTRAINT "FK_0742358d9955ac80e8ce64c0a77"`);
        await queryRunner.query(`ALTER TABLE "radiology_order_status_history" DROP CONSTRAINT "FK_cf36c38c17b96e153e9eb111338"`);
        await queryRunner.query(`ALTER TABLE "radiology_branch_modalities" DROP CONSTRAINT "FK_9b183bd3ab3b5060b169601f2e9"`);
        await queryRunner.query(`ALTER TABLE "radiology_branch_modalities" DROP CONSTRAINT "FK_c9334c225993cf96770acbab545"`);
        await queryRunner.query(`ALTER TABLE "radiology_orders" DROP CONSTRAINT "radiology_order_time_ck"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f67553c8626231a5af4303cf20"`);
        await queryRunner.query(`ALTER TABLE "radiology_reports" DROP COLUMN "return_note"`);
        await queryRunner.query(`ALTER TABLE "radiology_reports" DROP COLUMN "submitted_at"`);
        await queryRunner.query(`ALTER TABLE "radiology_reports" DROP COLUMN "critical"`);
        await queryRunner.query(`ALTER TABLE "radiology_reports" DROP COLUMN "recommendations"`);
        await queryRunner.query(`ALTER TABLE "radiology_reports" DROP COLUMN "comparison"`);
        await queryRunner.query(`ALTER TABLE "radiology_reports" DROP COLUMN "technique"`);
        await queryRunner.query(`ALTER TABLE "radiology_orders" DROP COLUMN "created_by_id"`);
        await queryRunner.query(`ALTER TABLE "radiology_orders" DROP COLUMN "delivered_at"`);
        await queryRunner.query(`ALTER TABLE "radiology_orders" DROP COLUMN "cancel_reason"`);
        await queryRunner.query(`ALTER TABLE "radiology_orders" DROP COLUMN "cancelled_by_id"`);
        await queryRunner.query(`ALTER TABLE "radiology_orders" DROP COLUMN "cancelled_at"`);
        await queryRunner.query(`ALTER TABLE "radiology_orders" DROP COLUMN "technician_id"`);
        await queryRunner.query(`ALTER TABLE "radiology_orders" DROP COLUMN "exam_completed_at"`);
        await queryRunner.query(`ALTER TABLE "radiology_orders" DROP COLUMN "exam_started_at"`);
        await queryRunner.query(`ALTER TABLE "radiology_orders" DROP COLUMN "checked_in_at"`);
        await queryRunner.query(`ALTER TABLE "radiology_orders" DROP COLUMN "paid_at"`);
        await queryRunner.query(`ALTER TABLE "radiology_orders" DROP COLUMN "payment_method"`);
        await queryRunner.query(`ALTER TABLE "radiology_orders" DROP COLUMN "contact_phone"`);
        await queryRunner.query(`ALTER TABLE "radiology_orders" DROP COLUMN "referring_doctor"`);
        await queryRunner.query(`ALTER TABLE "radiology_orders" DROP COLUMN "clinical_indication"`);
        await queryRunner.query(`ALTER TABLE "radiology_orders" DROP COLUMN "modality"`);
        await queryRunner.query(`ALTER TABLE "radiology_orders" DROP COLUMN "end_at"`);
        await queryRunner.query(`ALTER TABLE "radiology_services" DROP COLUMN "turnaround_hours"`);
        await queryRunner.query(`ALTER TABLE "radiology_services" DROP COLUMN "report_template"`);
        await queryRunner.query(`ALTER TABLE "radiology_services" DROP COLUMN "requires_referral"`);
        await queryRunner.query(`ALTER TABLE "radiology_centers" DROP COLUMN "accreditation"`);
        await queryRunner.query(`ALTER TABLE "radiology_centers" DROP COLUMN "require_separate_approver"`);
        await queryRunner.query(`ALTER TABLE "radiology_centers" DROP COLUMN "booking_horizon_days"`);
        await queryRunner.query(`ALTER TABLE "radiology_centers" DROP COLUMN "slot_step_minutes"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0742358d9955ac80e8ce64c0a7"`);
        await queryRunner.query(`DROP TABLE "radiology_order_files"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0e962807a1d82343c030ba1886"`);
        await queryRunner.query(`DROP TABLE "radiology_order_status_history"`);
        await queryRunner.query(`DROP TABLE "radiology_branch_modalities"`);
    }

}
