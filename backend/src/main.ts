import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  configureApp(app);
  const port = app.get(ConfigService).get<number>('port')!;
  await app.listen(port);
  Logger.log(`API ready on http://localhost:${port}/api  (docs: /api/docs)`, 'Bootstrap');
}
bootstrap();
