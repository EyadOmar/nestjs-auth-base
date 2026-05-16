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
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import {
  CreateRoleDto,
  PermissionResponseDto,
  RoleResponseDto,
  SetRolePermissionsDto,
  UpdateRoleDto,
} from './dto/role.dto';
import { RbacService } from './rbac.service';

@ApiTags('admin/rbac')
@ApiBearerAuth('access-token')
@ApiForbiddenResponse({ description: 'Missing roles.manage permission' })
@Permissions('roles.manage')
@Controller('admin/rbac')
export class RbacController {
  constructor(private readonly rbac: RbacService) {}

  // ============ Roles ============

  @Get('roles')
  @ApiOperation({ summary: 'List all roles' })
  @ApiOkResponse({ type: [RoleResponseDto] })
  async listRoles(): Promise<RoleResponseDto[]> {
    const roles = await this.rbac.listRoles();
    return roles.map((r) => RoleResponseDto.fromEntity(r));
  }

  @Post('roles')
  @ApiOperation({
    summary: 'Create a role and (optionally) attach permissions',
  })
  @ApiCreatedResponse({ type: RoleResponseDto })
  @ApiConflictResponse({ description: 'role_name_taken' })
  @ApiBadRequestResponse({
    description: 'invalid_role_name or unknown_permission_id',
  })
  async createRole(@Body() dto: CreateRoleDto): Promise<RoleResponseDto> {
    const role = await this.rbac.createRole(dto);
    const withPerms = await this.rbac.getRoleById(role.id, {
      withPermissions: true,
    });
    return RoleResponseDto.fromEntity(withPerms);
  }

  @Get('roles/:id')
  @ApiOperation({ summary: 'Get a role with its permissions' })
  @ApiOkResponse({ type: RoleResponseDto })
  @ApiNotFoundResponse({ description: 'role_not_found' })
  async getRole(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<RoleResponseDto> {
    const role = await this.rbac.getRoleById(id, { withPermissions: true });
    return RoleResponseDto.fromEntity(role);
  }

  @Patch('roles/:id')
  @ApiOperation({ summary: 'Partially update a role' })
  @ApiOkResponse({ type: RoleResponseDto })
  @ApiNotFoundResponse({ description: 'role_not_found' })
  async updateRole(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateRoleDto,
  ): Promise<RoleResponseDto> {
    const role = await this.rbac.updateRole(id, dto);
    const withPerms = await this.rbac.getRoleById(role.id, {
      withPermissions: true,
    });
    return RoleResponseDto.fromEntity(withPerms);
  }

  @Delete('roles/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a role',
    description: 'Rejected if the role is a system role (is_system=true).',
  })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ description: 'cannot_delete_system_role' })
  async deleteRole(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.rbac.deleteRole(id);
  }

  @Post('roles/:id/permissions')
  @ApiOperation({
    summary: 'Replace the permissions attached to a role',
    description:
      'Invalidates the cache for every user that currently holds this role.',
  })
  @ApiOkResponse({ type: RoleResponseDto })
  @ApiBadRequestResponse({ description: 'unknown_permission_id' })
  async setRolePermissions(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SetRolePermissionsDto,
  ): Promise<RoleResponseDto> {
    await this.rbac.setRolePermissions(id, dto.permissionIds);
    const role = await this.rbac.getRoleById(id, { withPermissions: true });
    return RoleResponseDto.fromEntity(role);
  }

  // ============ Permissions ============

  @Get('permissions')
  @ApiOperation({ summary: 'List all permissions' })
  @ApiOkResponse({ type: [PermissionResponseDto] })
  async listPermissions(): Promise<PermissionResponseDto[]> {
    const perms = await this.rbac.listPermissions();
    return perms.map((p) => PermissionResponseDto.fromEntity(p));
  }
}
