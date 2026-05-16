import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { join } from 'node:path';

loadEnv();
const isCompiled = __filename.endsWith('.js');
const ext = isCompiled ? 'js' : 'ts';
const rootDir = isCompiled ? join(__dirname, '..') : join(__dirname, '..');

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  entities: [join(rootDir, 'modules', '**', 'entities', `*.entity.${ext}`)],
  migrations: [join(__dirname, 'migrations', `*.${ext}`)],
  migrationsTableName: 'typeorm_migrations',
  synchronize: false,
  logging:
    process.env.NODE_ENV === 'development'
      ? ['error', 'warn', 'schema']
      : ['error'],
});

export default AppDataSource;
