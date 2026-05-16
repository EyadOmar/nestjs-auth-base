import {
  ApiHideProperty,
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import { Exclude, Expose, Type } from 'class-transformer';
import { User, UserStatus } from '../entities/user.entity';
import { UserPhone } from '../entities/user-phone.entity';

export class UserPhoneResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '+14155551234' })
  phoneE164!: string;

  @ApiPropertyOptional({ example: 'mobile' })
  label!: string | null;

  @ApiProperty()
  isPrimary!: boolean;

  @ApiProperty()
  verified!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  static fromEntity(p: UserPhone): UserPhoneResponseDto {
    return Object.assign(new UserPhoneResponseDto(), {
      id: p.id,
      phoneE164: p.phoneE164,
      label: p.label,
      isPrimary: p.isPrimary,
      verified: p.verifiedAt !== null,
      createdAt: p.createdAt,
    });
  }
}

export class UserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'user@example.com', format: 'email' })
  email!: string;

  @ApiProperty()
  emailVerified!: boolean;

  @ApiPropertyOptional()
  firstName!: string | null;

  @ApiPropertyOptional()
  lastName!: string | null;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/u/ada.jpg' })
  avatarUrl!: string | null;

  @ApiProperty({ enum: ['en', 'ar'], example: 'en' })
  locale!: string;

  @ApiProperty({ enum: ['pending', 'active', 'suspended', 'deleted'] })
  status!: UserStatus;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  lastLoginAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiPropertyOptional({ type: () => [UserPhoneResponseDto] })
  @Type(() => UserPhoneResponseDto)
  phones?: UserPhoneResponseDto[];

  @ApiHideProperty()
  @Exclude()
  passwordHash?: never;

  @Expose()
  static fromEntity(u: User): UserResponseDto {
    const dto = Object.assign(new UserResponseDto(), {
      id: u.id,
      email: u.email,
      emailVerified: u.emailVerifiedAt !== null,
      firstName: u.firstName,
      lastName: u.lastName,
      avatarUrl: u.avatarUrl,
      locale: u.locale,
      status: u.status,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
    });
    if (u.phones) {
      dto.phones = u.phones.map((p) => UserPhoneResponseDto.fromEntity(p));
    }
    return dto;
  }
}
