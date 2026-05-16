import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ description: 'Current password', example: 'CurrentPassw0rd' })
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @ApiProperty({
    description:
      'New password — min 12 chars, must contain at least one letter and one digit',
    example: 'NewSecret123!',
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
