import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class AddPhoneDto {
  @ApiProperty({
    description: 'Phone number in E.164 format',
    example: '+14155551234',
    pattern: '^\\+[1-9]\\d{1,14}$',
    maxLength: 20,
  })
  @IsString()
  @MaxLength(20)
  @Matches(/^\+[1-9]\d{1,14}$/, {
    message: 'phoneE164 must be E.164 (e.g. +14155551234)',
  })
  phoneE164!: string;

  @ApiPropertyOptional({ example: 'mobile', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  label?: string;
}
