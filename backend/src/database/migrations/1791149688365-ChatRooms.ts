import { MigrationInterface, QueryRunner } from "typeorm";

export class ChatRooms1791149688365 implements MigrationInterface {
    name = 'ChatRooms1791149688365'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "chat_rooms" ADD "subject_user_id" uuid NOT NULL`);
        await queryRunner.query(`ALTER TABLE "chat_rooms" ADD "created_by_id" uuid NOT NULL`);
        await queryRunner.query(`ALTER TABLE "chat_rooms" ADD "blocked_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "chat_rooms" ADD "reported_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "chat_rooms" ADD "reported_by_id" uuid`);
        await queryRunner.query(`ALTER TABLE "chat_rooms" ADD "report_reason" text`);
        await queryRunner.query(`CREATE INDEX "IDX_6d30014e0fa5e37702048bda2a" ON "chat_rooms" ("last_message_at") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "chat_room_unique_support" ON "chat_rooms" ("type", "subject_user_id") WHERE "provider_id" IS NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "chat_room_unique_provider" ON "chat_rooms" ("type", "provider_id", "subject_user_id") WHERE "provider_id" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "chat_rooms" ADD CONSTRAINT "FK_062a2ca4e1cb356bece8ebd3364" FOREIGN KEY ("subject_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "chat_rooms" DROP CONSTRAINT "FK_062a2ca4e1cb356bece8ebd3364"`);
        await queryRunner.query(`DROP INDEX "public"."chat_room_unique_provider"`);
        await queryRunner.query(`DROP INDEX "public"."chat_room_unique_support"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6d30014e0fa5e37702048bda2a"`);
        await queryRunner.query(`ALTER TABLE "chat_rooms" DROP COLUMN "report_reason"`);
        await queryRunner.query(`ALTER TABLE "chat_rooms" DROP COLUMN "reported_by_id"`);
        await queryRunner.query(`ALTER TABLE "chat_rooms" DROP COLUMN "reported_at"`);
        await queryRunner.query(`ALTER TABLE "chat_rooms" DROP COLUMN "blocked_at"`);
        await queryRunner.query(`ALTER TABLE "chat_rooms" DROP COLUMN "created_by_id"`);
        await queryRunner.query(`ALTER TABLE "chat_rooms" DROP COLUMN "subject_user_id"`);
    }

}
