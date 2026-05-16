import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, MaxLength } from 'class-validator';

export class ChangeEmailDto {
  @ApiProperty({ example: 'new@example.com', format: 'email', maxLength: 254 })
  @IsEmail()
  @MaxLength(254)
  newEmail!: string;
}
