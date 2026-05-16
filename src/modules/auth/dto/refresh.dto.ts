import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class RefreshDto {
  @ApiProperty({
    description:
      'The raw refresh token returned by login or a previous refresh.',
  })
  @IsString()
  @MinLength(16)
  @MaxLength(512)
  refreshToken!: string;
}
