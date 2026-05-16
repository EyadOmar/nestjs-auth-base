import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class VerifyEmailDto {
  @ApiProperty({ description: 'Raw token from the verification email.' })
  @IsString()
  @MinLength(16)
  @MaxLength(512)
  token!: string;
}

export class MagicLinkVerifyDto {
  @ApiProperty({ description: 'Raw token from the magic-link email.' })
  @IsString()
  @MinLength(16)
  @MaxLength(512)
  token!: string;
}

export class ResendVerificationDto {
  @ApiProperty({ format: 'email', example: 'ada@example.com', maxLength: 254 })
  @IsString()
  @MaxLength(254)
  email!: string;
}
