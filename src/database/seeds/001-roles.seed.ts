import { DataSource } from 'typeorm';
import { Role } from '../../modules/rbac/entities/role.entity';

interface RoleSeed {
  name: string;
  displayName: string;
  description: string;
  priority: number;
}

const ROLES: RoleSeed[] = [
  {
    name: 'super_admin',
    displayName: 'Super Administrator',
    description: 'Unrestricted access. Reserved for platform owners.',
    priority: 100,
  },
  {
    name: 'admin',
    displayName: 'Administrator',
    description:
      'Manages users, sessions, and the audit log. Cannot manage roles.',
    priority: 80,
  },
  {
    name: 'editor',
    displayName: 'Editor',
    description: 'Reads users and updates limited user fields.',
    priority: 50,
  },
  {
    name: 'user',
    displayName: 'User',
    description: 'Default authenticated user.',
    priority: 10,
  },
];

export async function seedRoles(dataSource: DataSource): Promise<void> {
  const repo = dataSource.getRepository(Role);
  for (const r of ROLES) {
    const existing = await repo.findOne({ where: { name: r.name } });
    if (existing) {
      existing.displayName = r.displayName;
      existing.description = r.description;
      existing.priority = r.priority;
      existing.isSystem = true;
      await repo.save(existing);
    } else {
      await repo.save(
        repo.create({
          name: r.name,
          displayName: r.displayName,
          description: r.description,
          priority: r.priority,
          isSystem: true,
        }),
      );
    }
  }
}
