import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { getRequestContext } from '../../common/http/request-context';
import { AuditService } from '../auth/services/audit.service';
import { AssignRoleDto } from '../rbac/dto/assign-role.dto';
import { RoleResponseDto } from '../rbac/dto/role.dto';
import { RbacService } from '../rbac/rbac.service';
import type { AuthenticatedUser } from '../../shared/types/auth.types';
import {
  AdminUserListQueryDto,
  AdminUserListResponseDto,
  UpdateUserStatusDto,
} from './dto/admin-user-list.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UsersService } from './users.service';

@ApiTags('admin/users')
@ApiBearerAuth('access-token')
@ApiForbiddenResponse({ description: 'Missing users.manage permission' })
@Permissions('users.manage')
@Controller('admin/users')
export class AdminUsersController {
  constructor(
    private readonly users: UsersService,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List users (paginated)' })
  @ApiOkResponse({ type: AdminUserListResponseDto })
  async list(
    @Query() q: AdminUserListQueryDto,
  ): Promise<AdminUserListResponseDto> {
    const result = await this.users.list({
      search: q.search,
      status: q.status,
      page: q.page,
      pageSize: q.pageSize,
      includeDeleted: q.includeDeleted === 'true',
    });
    return {
      data: result.data.map((u) => UserResponseDto.fromEntity(u)),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a user by id (includes deleted)' })
  @ApiOkResponse({ type: UserResponseDto })
  async get(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<UserResponseDto> {
    const user = await this.users.getAdminUser(id);
    return UserResponseDto.fromEntity(user);
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: "Change a user's status",
    description:
      'Allowed values: pending, active, suspended. Use DELETE /admin/users/:id to soft-delete (added in a later phase).',
  })
  @ApiOkResponse({ type: UserResponseDto })
  async setStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateUserStatusDto,
  ): Promise<UserResponseDto> {
    const user = await this.users.setStatus(id, dto.status);
    return UserResponseDto.fromEntity(user);
  }

  @Post(':id/roles')
  @ApiOperation({
    summary: 'Assign a role to a user',
    description: 'If the user already has this role, the expiry is updated.',
  })
  @ApiCreatedResponse({ type: RoleResponseDto })
  @ApiBadRequestResponse({ description: 'role_not_found' })
  async assignRole(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) userId: string,
    @Body() dto: AssignRoleDto,
    @Req() req: Request,
  ): Promise<RoleResponseDto> {
    await this.users.getByIdOrThrow(userId);
    await this.rbac.assignRole({
      userId,
      roleId: dto.roleId,
      assignedBy: me.id,
      expiresAt: dto.expiresAt ?? null,
    });
    const role = await this.rbac.getRoleById(dto.roleId, {
      withPermissions: true,
    });
    const ctx = getRequestContext(req);
    await this.audit.recordEvent({
      userId,
      eventType: 'role_assigned',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: {
        roleId: dto.roleId,
        roleName: role.name,
        assignedBy: me.id,
        expiresAt: dto.expiresAt?.toISOString() ?? null,
      },
    });
    return RoleResponseDto.fromEntity(role);
  }

  @Delete(':id/roles/:roleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a role from a user' })
  @ApiNoContentResponse()
  async revokeRole(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) userId: string,
    @Param('roleId', new ParseUUIDPipe()) roleId: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.rbac.revokeRole(userId, roleId);
    const ctx = getRequestContext(req);
    await this.audit.recordEvent({
      userId,
      eventType: 'role_revoked',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { roleId, revokedBy: me.id },
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Soft-delete a user account (admin)',
    description:
      'Sets status=deleted, deleted_at=NOW(), revokes every active session, and writes an audit event tagged with the actor.',
  })
  @ApiNoContentResponse()
  async softDelete(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) targetId: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.users.softDeleteByAdmin(targetId, me.id, getRequestContext(req));
  }
}
