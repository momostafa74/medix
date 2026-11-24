/* Writes docs/openapi.json from the live Nest app metadata (no DB queries are made). */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync, mkdirSync } from 'fs';
import { AppModule } from '../src/app.module';

async function run() {
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  app.setGlobalPrefix('api');
  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('Medix — Medical Marketplace API').setVersion('1.0').addBearerAuth().build(),
  );
  mkdirSync('../docs', { recursive: true });
  writeFileSync('../docs/openapi.json', JSON.stringify(doc, null, 2));
  console.log(`openapi.json: ${Object.keys(doc.paths).length} paths`);
  await app.close();
  process.exit(0);
}
run();
