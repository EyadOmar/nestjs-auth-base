import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Raw token from the password-reset email.' })
  @IsString()
  @MinLength(16)
  @MaxLength(512)
  token!: string;

  @ApiProperty({
    description: 'Min 12 chars, at least one letter and one digit.',
    minLength: 12,
    maxLength: 128,
  })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  @Matches(/[A-Za-z]/, {
    message: 'newPassword must contain at least one letter',
  })
  @Matches(/\d/, { message: 'newPassword must contain at least one digit' })
  newPassword!: string;
}
