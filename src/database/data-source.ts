import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource, DataSourceOptions } from 'typeorm';
import { join } from 'node:path';

loadEnv();
const isCompiled = __filename.endsWith('.js');
const ext = isCompiled ? 'js' : 'ts';
const rootDir = isCompiled ? join(__dirname, '..') : join(__dirname, '..');

export const datasourceOptions: DataSourceOptions = {
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
};

const AppDataSource = new DataSource(datasourceOptions);

export default AppDataSource;
