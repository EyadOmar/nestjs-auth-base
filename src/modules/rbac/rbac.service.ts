import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, MoreThan, Repository } from 'typeorm';
import { Permission } from './entities/permission.entity';
import { Role } from './entities/role.entity';
import { RolePermission } from './entities/role-permission.entity';
import { UserRole } from './entities/user-role.entity';

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CachedEntry {
  permissions: Set<string>;
  roles: Set<string>;
  expiresAt: number;
}

export interface UserAccess {
  permissions: Set<string>;
  roles: Set<string>;
}

export interface AssignRoleInput {
  userId: string;
  roleId: string;
  assignedBy?: string | null;
  expiresAt?: Date | null;
}

@Injectable()
export class RbacService {
  private readonly cache = new Map<string, CachedEntry>();

  constructor(
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(Permission)
    private readonly permissions: Repository<Permission>,
    @InjectRepository(RolePermission)
    private readonly rolePermissions: Repository<RolePermission>,
    @InjectRepository(UserRole)
    private readonly userRoles: Repository<UserRole>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  // ============ Resolution / cache ============

  async resolveUserAccess(userId: string): Promise<UserAccess> {
    const cached = this.cache.get(userId);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return { permissions: cached.permissions, roles: cached.roles };
    }
    const rows = await this.userRoles
      .createQueryBuilder('ur')
      .innerJoin(Role, 'r', 'r.id = ur.role_id')
      .leftJoin(RolePermission, 'rp', 'rp.role_id = ur.role_id')
      .leftJoin(Permission, 'p', 'p.id = rp.permission_id')
      .where('ur.user_id = :userId', { userId })
      .andWhere('(ur.expires_at IS NULL OR ur.expires_at > NOW())')
      .select(['r.name AS role_name', 'p.name AS perm_name'])
      .getRawMany<{ role_name: string; perm_name: string | null }>();
    const permissions = new Set<string>();
    const roles = new Set<string>();
    for (const row of rows) {
      roles.add(row.role_name);
      if (row.perm_name) permissions.add(row.perm_name);
    }
    this.cache.set(userId, {
      permissions,
      roles,
      expiresAt: now + CACHE_TTL_MS,
    });
    return { permissions, roles };
  }

  invalidateUser(userId: string): void {
    this.cache.delete(userId);
  }

  invalidateAll(): void {
    this.cache.clear();
  }

  // ============ Role CRUD ============

  async listRoles(): Promise<Role[]> {
    return this.roles.find({ order: { priority: 'DESC', name: 'ASC' } });
  }

  async getRoleById(
    id: string,
    opts?: { withPermissions?: boolean },
  ): Promise<Role> {
    const role = await this.roles.findOne({ where: { id } });
    if (!role) throw new NotFoundException({ code: 'role_not_found' });
    if (opts?.withPermissions) {
      const links = await this.rolePermissions.find({ where: { roleId: id } });
      if (links.length > 0) {
        const perms = await this.permissions.find({
          where: { id: In(links.map((l) => l.permissionId)) },
        });
        role.permissions = perms;
      } else {
        role.permissions = [];
      }
    }
    return role;
  }

  async createRole(input: {
    name: string;
    displayName: string;
    description?: string;
    permissionIds?: string[];
    priority?: number;
  }): Promise<Role> {
    if (!/^[a-z][a-z0-9_]*$/.test(input.name)) {
      throw new BadRequestException({ code: 'invalid_role_name' });
    }
    const existing = await this.roles.findOne({ where: { name: input.name } });
    if (existing) throw new ConflictException({ code: 'role_name_taken' });
    const role = await this.roles.save(
      this.roles.create({
        name: input.name,
        displayName: input.displayName,
        description: input.description ?? null,
        isSystem: false,
        priority: input.priority ?? 0,
      }),
    );
    if (input.permissionIds && input.permissionIds.length > 0) {
      await this.setRolePermissions(role.id, input.permissionIds);
    }
    return role;
  }

  async updateRole(
    id: string,
    input: {
      displayName?: string;
      description?: string | null;
      priority?: number;
    },
  ): Promise<Role> {
    const role = await this.getRoleById(id);
    if (input.displayName !== undefined) role.displayName = input.displayName;
    if (input.description !== undefined) role.description = input.description;
    if (input.priority !== undefined) role.priority = input.priority;
    return this.roles.save(role);
  }

  async deleteRole(id: string): Promise<void> {
    const role = await this.getRoleById(id);
    if (role.isSystem) {
      throw new BadRequestException({ code: 'cannot_delete_system_role' });
    }
    // Find users that had this role so we can invalidate their cache.
    const assignments = await this.userRoles.find({ where: { roleId: id } });
    await this.roles.delete({ id });
    for (const a of assignments) this.invalidateUser(a.userId);
  }

  // ============ Role permissions ============

  async setRolePermissions(
    roleId: string,
    permissionIds: string[],
  ): Promise<void> {
    const role = await this.getRoleById(roleId);
    const uniqueIds = Array.from(new Set(permissionIds));
    if (uniqueIds.length > 0) {
      const found = await this.permissions.count({
        where: { id: In(uniqueIds) },
      });
      if (found !== uniqueIds.length) {
        throw new BadRequestException({ code: 'unknown_permission_id' });
      }
    }
    await this.dataSource.transaction(async (tx) => {
      await tx.getRepository(RolePermission).delete({ roleId });
      if (uniqueIds.length > 0) {
        await tx
          .getRepository(RolePermission)
          .insert(uniqueIds.map((permissionId) => ({ roleId, permissionId })));
      }
    });
    // Fan-out invalidation: every user holding this role needs a fresh cache.
    const holders = await this.userRoles.find({ where: { roleId } });
    for (const h of holders) this.invalidateUser(h.userId);
    void role; // suppress unused warning while keeping the validation above
  }

  // ============ Permission listing ============

  async listPermissions(): Promise<Permission[]> {
    return this.permissions.find({ order: { resource: 'ASC', action: 'ASC' } });
  }

  // ============ User <-> role assignments ============

  async assignRole(input: AssignRoleInput): Promise<UserRole> {
    await this.getRoleById(input.roleId);
    const existing = await this.userRoles.findOne({
      where: { userId: input.userId, roleId: input.roleId },
    });
    let saved: UserRole;
    if (existing) {
      existing.assignedBy = input.assignedBy ?? null;
      existing.expiresAt = input.expiresAt ?? null;
      saved = await this.userRoles.save(existing);
    } else {
      saved = await this.userRoles.save(
        this.userRoles.create({
          userId: input.userId,
          roleId: input.roleId,
          assignedBy: input.assignedBy ?? null,
          expiresAt: input.expiresAt ?? null,
        }),
      );
    }
    this.invalidateUser(input.userId);
    return saved;
  }

  async revokeRole(userId: string, roleId: string): Promise<void> {
    await this.userRoles.delete({ userId, roleId });
    this.invalidateUser(userId);
  }

  async listUserRoles(userId: string): Promise<UserRole[]> {
    return this.userRoles.find({
      where: [
        { userId, expiresAt: IsNull() },
        { userId, expiresAt: MoreThan(new Date()) },
      ],
      relations: { role: true },
    });
  }
}
