import 'reflect-metadata';
import AppDataSource from '../data-source';
import { seedRoles } from './001-roles.seed';
import { seedPermissions } from './002-permissions.seed';

async function main(): Promise<void> {
  await AppDataSource.initialize();
  try {
    console.log('seeding roles...');
    await seedRoles(AppDataSource);
    console.log('seeding permissions...');
    await seedPermissions(AppDataSource);
    console.log('done.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err: unknown) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
