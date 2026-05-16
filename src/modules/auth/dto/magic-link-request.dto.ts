import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, MaxLength } from 'class-validator';

export class MagicLinkRequestDto {
  @ApiProperty({ format: 'email', example: 'ada@example.com', maxLength: 254 })
  @IsEmail()
  @MaxLength(254)
  email!: string;
}
