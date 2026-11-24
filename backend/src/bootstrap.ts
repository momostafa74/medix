import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

/** Shared HTTP setup for main.ts and integration tests (so tests exercise the real pipeline). */
export function configureApp(app: INestApplication, { swagger = true } = {}) {
  const config = app.get(ConfigService);
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set('trust proxy', 1);
  expressApp.disable('x-powered-by');

  app.setGlobalPrefix('api', { exclude: [] });
  app.use(
    helmet({
      contentSecurityPolicy: config.get('isProd') ? undefined : false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  // gzip JSON/CSV responses above 1 KB (PDF/XLSX are already compressed, images skipped by type).
  app.use(compression({ threshold: 1024 }));
  app.use(cookieParser());
  app.enableCors({
    origin: (config.get<string>('frontendUrl') || '').split(',').map((s) => s.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    exposedHeaders: ['X-Request-Id', 'Content-Disposition'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      stopAtFirstError: false,
    }),
  );
  app.enableShutdownHooks();

  if (swagger && (!config.get('isProd') || process.env.SWAGGER_ENABLED === 'true')) {
    const doc = new DocumentBuilder()
      .setTitle('Medix — Medical Marketplace API')
      .setDescription('REST API for patients, doctors, providers and admins. Auth: Bearer access token; refresh via httpOnly cookie.')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc), {
      swaggerOptions: { persistAuthorization: true },
    });
  }
}
