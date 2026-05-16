import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserResponseDto } from '../../users/dto/user-response.dto';
import { Session } from '../entities/session.entity';

export class AuthTokensResponseDto {
  @ApiProperty({
    description: 'JWT access token. Send as Authorization: Bearer <token>.',
  })
  accessToken!: string;

  @ApiProperty({
    description: 'Opaque refresh token; rotated on every /auth/refresh.',
  })
  refreshToken!: string;

  @ApiProperty({
    description: 'Access-token lifetime in seconds.',
    example: 900,
  })
  expiresInSeconds!: number;

  @ApiProperty({ enum: ['Bearer'] })
  tokenType!: 'Bearer';
}

export class LoginResponseDto extends AuthTokensResponseDto {
  @ApiProperty({ type: UserResponseDto })
  user!: UserResponseDto;

  @ApiProperty({ format: 'uuid' })
  sessionId!: string;
}

export class GenericOkResponseDto {
  @ApiProperty({ example: true })
  ok!: true;
}

export class SessionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiPropertyOptional()
  deviceId!: string | null;

  @ApiPropertyOptional()
  deviceName!: string | null;

  @ApiPropertyOptional()
  ipAddress!: string | null;

  @ApiPropertyOptional()
  userAgent!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  lastUsedAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({
    description: 'True if this is the session used by the current request.',
  })
  isCurrent!: boolean;

  static fromEntity(s: Session, currentSessionId: string): SessionResponseDto {
    return Object.assign(new SessionResponseDto(), {
      id: s.id,
      deviceId: s.deviceId,
      deviceName: s.deviceName,
      ipAddress: s.ipAddress,
      userAgent: s.userAgent,
      lastUsedAt: s.lastUsedAt,
      expiresAt: s.expiresAt,
      createdAt: s.createdAt,
      isCurrent: s.id === currentSessionId,
    });
  }
}
