import { MigrationInterface, QueryRunner } from "typeorm";

export class PharmacyPhase61791396477304 implements MigrationInterface {
    name = 'PharmacyPhase61791396477304'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "pharmacy_order_status_history" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "order_id" uuid NOT NULL, "from_status" "public"."pharmacy_order_status", "to_status" "public"."pharmacy_order_status" NOT NULL, "changed_by_id" uuid, "note" text, CONSTRAINT "PK_58adb93d8c1a02e78da99519a5f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_a0121ed0eac5fc38b9dfcdff88" ON "pharmacy_order_status_history" ("order_id", "created_at") `);
        await queryRunner.query(`ALTER TABLE "prescriptions" ADD "valid_until" date`);
        await queryRunner.query(`ALTER TABLE "prescriptions" ADD "revoke_reason" text`);
        await queryRunner.query(`ALTER TABLE "prescriptions" ADD "dispensed_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "prescriptions" ADD "dispensed_by_provider_id" uuid`);
        await queryRunner.query(`ALTER TABLE "prescriptions" ADD "dispensed_by_id" uuid`);
        await queryRunner.query(`ALTER TABLE "prescriptions" ADD "dispensed_order_id" uuid`);
        await queryRunner.query(`ALTER TABLE "prescriptions" ADD "pdf_file_id" uuid`);
        await queryRunner.query(`ALTER TABLE "prescription_items" ADD "quantity" integer`);
        await queryRunner.query(`ALTER TABLE "prescription_items" ADD "sort_order" integer NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "pharmacies" ADD "free_delivery_over" numeric(12,2)`);
        await queryRunner.query(`ALTER TABLE "pharmacies" ADD "min_order_for_delivery" numeric(12,2) NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "pharmacies" ADD "estimated_delivery_minutes" integer NOT NULL DEFAULT '60'`);
        await queryRunner.query(`ALTER TABLE "pharmacies" ADD "delivery_areas_note" character varying`);
        await queryRunner.query(`ALTER TABLE "medicines" ADD "kind" character varying(12) NOT NULL DEFAULT 'MEDICINE'`);
        await queryRunner.query(`ALTER TABLE "medicines" ADD "category" character varying`);
        await queryRunner.query(`ALTER TABLE "medicines" ADD "barcode" character varying`);
        await queryRunner.query(`ALTER TABLE "medicines" ADD "created_by_provider_id" uuid`);
        await queryRunner.query(`ALTER TABLE "pharmacy_orders" ADD "payment_method" "public"."payment_method"`);
        await queryRunner.query(`ALTER TABLE "pharmacy_orders" ADD "paid_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "pharmacy_orders" ADD "contact_phone" character varying`);
        await queryRunner.query(`ALTER TABLE "pharmacy_orders" ADD "pharmacist_note" text`);
        await queryRunner.query(`ALTER TABLE "pharmacy_orders" ADD "stock_reserved" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "pharmacy_orders" ADD "confirmed_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "pharmacy_orders" ADD "ready_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "pharmacy_orders" ADD "out_for_delivery_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "pharmacy_orders" ADD "delivered_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "pharmacy_orders" ADD "driver_name" character varying`);
        await queryRunner.query(`ALTER TABLE "pharmacy_orders" ADD "driver_phone" character varying`);
        await queryRunner.query(`ALTER TABLE "pharmacy_orders" ADD "cancelled_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "pharmacy_orders" ADD "cancelled_by_id" uuid`);
        await queryRunner.query(`ALTER TABLE "pharmacy_orders" ADD "cancel_reason" text`);
        await queryRunner.query(`ALTER TABLE "pharmacy_orders" ADD "created_by_id" uuid`);
        await queryRunner.query(`ALTER TABLE "pharmacy_order_items" ADD "medicine_name" character varying`);
        await queryRunner.query(`CREATE INDEX "IDX_a281f8074e9f29ce6ee077e146" ON "pharmacy_orders" ("pharmacy_id", "created_at") `);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS medicines_name_ar_trgm ON medicines USING gin (name_ar gin_trgm_ops)`);
        await queryRunner.query(`UPDATE pharmacy_order_items i SET medicine_name = m.name_en FROM medicines m WHERE m.id = i.medicine_id AND i.medicine_name IS NULL`);
        await queryRunner.query(`ALTER TABLE "pharmacy_inventory" ADD CONSTRAINT "pharmacy_inventory_ck" CHECK ("price" >= 0 AND ("quantity" IS NULL OR "quantity" >= 0))`);
        await queryRunner.query(`ALTER TABLE "pharmacy_orders" ADD CONSTRAINT "pharmacy_order_amounts_ck" CHECK ("subtotal" >= 0 AND "delivery_fee" >= 0 AND "total" >= 0)`);
        await queryRunner.query(`ALTER TABLE "pharmacy_order_items" ADD CONSTRAINT "pharmacy_item_qty_ck" CHECK ("quantity" > 0 AND "unit_price" >= 0)`);
        await queryRunner.query(`ALTER TABLE "pharmacy_order_status_history" ADD CONSTRAINT "FK_d5e4d85b19f461fefd542b00a70" FOREIGN KEY ("order_id") REFERENCES "pharmacy_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS medicines_name_ar_trgm`);
        await queryRunner.query(`ALTER TABLE "pharmacy_order_status_history" DROP CONSTRAINT "FK_d5e4d85b19f461fefd542b00a70"`);
        await queryRunner.query(`ALTER TABLE "pharmacy_order_items" DROP CONSTRAINT "pharmacy_item_qty_ck"`);
        await queryRunner.query(`ALTER TABLE "pharmacy_orders" DROP CONSTRAINT "pharmacy_order_amounts_ck"`);
        await queryRunner.query(`ALTER TABLE "pharmacy_inventory" DROP CONSTRAINT "pharmacy_inventory_ck"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a281f8074e9f29ce6ee077e146"`);
        await queryRunner.query(`ALTER TABLE "pharmacy_order_items" DROP COLUMN "medicine_name"`);
        await queryRunner.query(`ALTER TABLE "pharmacy_orders" DROP COLUMN "created_by_id"`);
        await queryRunner.query(`ALTER TABLE "pharmacy_orders" DROP COLUMN "cancel_reason"`);
        await queryRunner.query(`ALTER TABLE "pharmacy_orders" DROP COLUMN "cancelled_by_id"`);
        await queryRunner.query(`ALTER TABLE "pharmacy_orders" DROP COLUMN "cancelled_at"`);
        await queryRunner.query(`ALTER TABLE "pharmacy_orders" DROP COLUMN "driver_phone"`);
        await queryRunner.query(`ALTER TABLE "pharmacy_orders" DROP COLUMN "driver_name"`);
        await queryRunner.query(`ALTER TABLE "pharmacy_orders" DROP COLUMN "delivered_at"`);
        await queryRunner.query(`ALTER TABLE "pharmacy_orders" DROP COLUMN "out_for_delivery_at"`);
        await queryRunner.query(`ALTER TABLE "pharmacy_orders" DROP COLUMN "ready_at"`);
        await queryRunner.query(`ALTER TABLE "pharmacy_orders" DROP COLUMN "confirmed_at"`);
        await queryRunner.query(`ALTER TABLE "pharmacy_orders" DROP COLUMN "stock_reserved"`);
        await queryRunner.query(`ALTER TABLE "pharmacy_orders" DROP COLUMN "pharmacist_note"`);
        await queryRunner.query(`ALTER TABLE "pharmacy_orders" DROP COLUMN "contact_phone"`);
        await queryRunner.query(`ALTER TABLE "pharmacy_orders" DROP COLUMN "paid_at"`);
        await queryRunner.query(`ALTER TABLE "pharmacy_orders" DROP COLUMN "payment_method"`);
        await queryRunner.query(`ALTER TABLE "medicines" DROP COLUMN "created_by_provider_id"`);
        await queryRunner.query(`ALTER TABLE "medicines" DROP COLUMN "barcode"`);
        await queryRunner.query(`ALTER TABLE "medicines" DROP COLUMN "category"`);
        await queryRunner.query(`ALTER TABLE "medicines" DROP COLUMN "kind"`);
        await queryRunner.query(`ALTER TABLE "pharmacies" DROP COLUMN "delivery_areas_note"`);
        await queryRunner.query(`ALTER TABLE "pharmacies" DROP COLUMN "estimated_delivery_minutes"`);
        await queryRunner.query(`ALTER TABLE "pharmacies" DROP COLUMN "min_order_for_delivery"`);
        await queryRunner.query(`ALTER TABLE "pharmacies" DROP COLUMN "free_delivery_over"`);
        await queryRunner.query(`ALTER TABLE "prescription_items" DROP COLUMN "sort_order"`);
        await queryRunner.query(`ALTER TABLE "prescription_items" DROP COLUMN "quantity"`);
        await queryRunner.query(`ALTER TABLE "prescriptions" DROP COLUMN "pdf_file_id"`);
        await queryRunner.query(`ALTER TABLE "prescriptions" DROP COLUMN "dispensed_order_id"`);
        await queryRunner.query(`ALTER TABLE "prescriptions" DROP COLUMN "dispensed_by_id"`);
        await queryRunner.query(`ALTER TABLE "prescriptions" DROP COLUMN "dispensed_by_provider_id"`);
        await queryRunner.query(`ALTER TABLE "prescriptions" DROP COLUMN "dispensed_at"`);
        await queryRunner.query(`ALTER TABLE "prescriptions" DROP COLUMN "revoke_reason"`);
        await queryRunner.query(`ALTER TABLE "prescriptions" DROP COLUMN "valid_until"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a0121ed0eac5fc38b9dfcdff88"`);
        await queryRunner.query(`DROP TABLE "pharmacy_order_status_history"`);
    }

}
