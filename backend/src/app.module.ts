import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import configuration from './config/configuration';
import { dataSourceOptions } from './database/data-source';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { SanitizePipe } from './common/pipes/sanitize.pipe';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { AuditModule } from './modules/audit/audit.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SettingsModule } from './modules/settings/settings.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { LocationsModule } from './modules/locations/locations.module';
import { HealthController } from './modules/health/health.controller';
import { AccessModule } from './common/access/access-policy.service';
import { FilesModule } from './modules/files/files.module';
import { SpecialtiesModule } from './modules/specialties/specialties.module';
import { ProvidersModule } from './modules/providers/providers.module';
import { DoctorsModule } from './modules/doctors/doctors.module';
import { SchedulesModule } from './modules/schedules/schedules.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { PatientsModule } from './modules/patients/patients.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { DashboardsModule } from './modules/dashboards/dashboards.module';
import { ChatModule } from './modules/chat/chat.module';
import { PdfModule } from './modules/pdf/pdf.service';
import { LabsModule } from './modules/labs/labs.module';
import { RadiologyModule } from './modules/radiology/radiology.module';
import { PrescriptionsModule } from './modules/prescriptions/prescriptions.module';
import { PharmacyModule } from './modules/pharmacy/pharmacy.module';
import { VerifyModule } from './modules/verify/verify.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { SubscriptionGuard } from './modules/subscriptions/subscription.guard';
import { SecurityModule } from './modules/security/security.module';
import { TwoFactorPolicyGuard } from './modules/security/two-factor-policy.guard';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { SystemModule } from './modules/system/system.module';
import { CacheModule } from './common/cache/cache.service';
import { HttpCacheInterceptor } from './common/cache/http-cache.interceptor';
import { MetricsInterceptor } from './modules/system/metrics.interceptor';
import { DbMetricsLogger } from './modules/system/db-logger';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], cache: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => {
        const base = dataSourceOptions(c.get('databaseUrl'));
        return {
          ...base,
          autoLoadEntities: false,
          // Slow statements are logged and listed on the System health page.
          logger: new DbMetricsLogger(),
          maxQueryExecutionTime: c.get<number>('security.slowQueryMs'),
          // A runaway query can never hold a connection for more than 30 s.
          extra: { ...(base.extra as object), statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '30000', 10) },
        };
      },
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({
        throttlers: [{ ttl: c.get('throttle.ttlSeconds')! * 1000, limit: c.get('throttle.limit')! }],
        // Integration tests fire many requests per second from one IP.
        skipIf: () => c.get('nodeEnv') === 'test',
      }),
    }),
    ScheduleModule.forRoot(),
    AccessModule,
    AuditModule,
    NotificationsModule,
    SettingsModule,
    AuthModule,
    UsersModule,
    LocationsModule,
    FilesModule,
    SpecialtiesModule,
    ProvidersModule,
    DoctorsModule,
    SchedulesModule,
    AppointmentsModule,
    PatientsModule,
    ReviewsModule,
    DashboardsModule,
    ChatModule,
    PdfModule,
    LabsModule,
    RadiologyModule,
    PrescriptionsModule,
    PharmacyModule,
    VerifyModule,
    PaymentsModule,
    SubscriptionsModule,
    SecurityModule,
    CacheModule,
    AnalyticsModule,
    SystemModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: SubscriptionGuard },
    { provide: APP_GUARD, useClass: TwoFactorPolicyGuard },
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
    { provide: APP_INTERCEPTOR, useClass: HttpCacheInterceptor },
    { provide: APP_PIPE, useClass: SanitizePipe },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
