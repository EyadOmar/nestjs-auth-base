import { DataSource } from 'typeorm';
import { Permission } from '../../modules/rbac/entities/permission.entity';
import { Role } from '../../modules/rbac/entities/role.entity';
import { RolePermission } from '../../modules/rbac/entities/role-permission.entity';

interface PermSeed {
  resource: string;
  action: string;
  description: string;
}

const PERMISSIONS: PermSeed[] = [
  { resource: 'users', action: 'read', description: 'Read user records.' },
  { resource: 'users', action: 'write', description: 'Update user records.' },
  {
    resource: 'users',
    action: 'delete',
    description: 'Soft-delete a user account.',
  },
  {
    resource: 'users',
    action: 'manage',
    description: 'Full user administration (list + status changes).',
  },
  {
    resource: 'roles',
    action: 'read',
    description: 'List roles and permissions.',
  },
  {
    resource: 'roles',
    action: 'manage',
    description: 'Create, edit, and assign roles.',
  },
  {
    resource: 'sessions',
    action: 'read',
    description: 'View active sessions for any user.',
  },
  {
    resource: 'sessions',
    action: 'revoke',
    description: 'Force-revoke another user’s sessions.',
  },
  { resource: 'audit', action: 'read', description: 'Read the audit log.' },
];

const WIRING: Record<string, 'all' | 'all_except_roles_manage' | string[]> = {
  super_admin: 'all',
  admin: 'all_except_roles_manage',
  editor: ['users.read', 'users.write'],
  user: [],
};

export async function seedPermissions(dataSource: DataSource): Promise<void> {
  const permRepo = dataSource.getRepository(Permission);
  const roleRepo = dataSource.getRepository(Role);
  const linkRepo = dataSource.getRepository(RolePermission);

  // Upsert each permission row.
  for (const p of PERMISSIONS) {
    const name = `${p.resource}.${p.action}`;
    const existing = await permRepo.findOne({
      where: { resource: p.resource, action: p.action },
    });
    if (existing) {
      existing.name = name;
      existing.description = p.description;
      await permRepo.save(existing);
    } else {
      await permRepo.save(
        permRepo.create({
          name,
          resource: p.resource,
          action: p.action,
          description: p.description,
        }),
      );
    }
  }

  const allPerms = await permRepo.find();
  const permByName = new Map(allPerms.map((p) => [p.name, p]));

  for (const [roleName, spec] of Object.entries(WIRING)) {
    const role = await roleRepo.findOne({ where: { name: roleName } });
    if (!role) continue;
    let permIds: string[];
    if (spec === 'all') {
      permIds = allPerms.map((p) => p.id);
    } else if (spec === 'all_except_roles_manage') {
      permIds = allPerms
        .filter((p) => p.name !== 'roles.manage')
        .map((p) => p.id);
    } else {
      permIds = spec
        .map((name) => permByName.get(name)?.id)
        .filter((id): id is string => !!id);
    }
    await linkRepo.delete({ roleId: role.id });
    if (permIds.length > 0) {
      await linkRepo.insert(
        permIds.map((permissionId) => ({ roleId: role.id, permissionId })),
      );
    }
  }
}
