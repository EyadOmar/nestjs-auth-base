import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Permission } from '../entities/permission.entity';
import { Role } from '../entities/role.entity';

export class CreateRoleDto {
  @ApiProperty({
    description: 'Machine name (lowercase, underscored)',
    example: 'support',
    pattern: '^[a-z][a-z0-9_]*$',
    maxLength: 50,
  })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  @Matches(/^[a-z][a-z0-9_]*$/)
  name!: string;

  @ApiProperty({ example: 'Customer Support', maxLength: 100 })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  displayName!: string;

  @ApiPropertyOptional({ maxLength: 1024 })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  description?: string;

  @ApiPropertyOptional({ default: 0, minimum: 0, maximum: 1000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  priority?: number;

  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  permissionIds?: string[];
}

export class UpdateRoleDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  displayName?: string;

  @ApiPropertyOptional({ maxLength: 1024, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  description?: string | null;

  @ApiPropertyOptional({ minimum: 0, maximum: 1000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  priority?: number;
}

export class SetRolePermissionsDto {
  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  permissionIds!: string[];
}

export class PermissionResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'users.read' }) name!: string;
  @ApiProperty({ example: 'users' }) resource!: string;
  @ApiProperty({ example: 'read' }) action!: string;
  @ApiPropertyOptional() description!: string | null;

  static fromEntity(p: Permission): PermissionResponseDto {
    return Object.assign(new PermissionResponseDto(), {
      id: p.id,
      name: p.name,
      resource: p.resource,
      action: p.action,
      description: p.description,
    });
  }
}

export class RoleResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() displayName!: string;
  @ApiPropertyOptional() description!: string | null;
  @ApiProperty() isSystem!: boolean;
  @ApiProperty() priority!: number;
  @ApiPropertyOptional({ type: () => [PermissionResponseDto] })
  permissions?: PermissionResponseDto[];

  static fromEntity(r: Role): RoleResponseDto {
    const dto = Object.assign(new RoleResponseDto(), {
      id: r.id,
      name: r.name,
      displayName: r.displayName,
      description: r.description,
      isSystem: r.isSystem,
      priority: r.priority,
    });
    if (r.permissions) {
      dto.permissions = r.permissions.map((p) =>
        PermissionResponseDto.fromEntity(p),
      );
    }
    return dto;
  }
}
