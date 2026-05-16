import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ConfirmEmailChangeDto {
  @ApiProperty({
    description: 'Raw token from the email-change confirmation email.',
  })
  @IsString()
  @MinLength(16)
  @MaxLength(512)
  token!: string;
}
