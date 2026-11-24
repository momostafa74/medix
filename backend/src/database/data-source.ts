import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource, DataSourceOptions } from 'typeorm';
import { ALL_ENTITIES } from './entities';
import { SnakeNamingStrategy } from './snake-naming.strategy';

loadEnv({ quiet: true } as any);

/**
 * Shared by the Nest app AND the TypeORM CLI (migrations). `synchronize` is
 * always false: schema changes only ever go through migrations.
 */
export const dataSourceOptions = (url = process.env.DATABASE_URL): DataSourceOptions => ({
  type: 'postgres',
  url,
  entities: ALL_ENTITIES,
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  namingStrategy: new SnakeNamingStrategy(),
  synchronize: false,
  migrationsRun: false,
  logging: process.env.DB_LOGGING === 'true' ? ['query', 'error'] : ['error'],
  extra: { max: parseInt(process.env.DB_POOL_MAX || '20', 10) },
});

export default new DataSource(dataSourceOptions());
