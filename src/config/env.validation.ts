import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBase64,
  IsBooleanString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MinLength,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

const URL_OPTS = { require_tld: false, require_protocol: true } as const;

export class EnvConfig {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  PORT: number = 3001;

  @IsString()
  @Matches(/^postgres(ql)?:\/\//, {
    message: 'DATABASE_URL must be a postgres connection string',
  })
  DATABASE_URL!: string;

  @IsOptional()
  @IsBooleanString()
  DATABASE_SSL?: string;

  @IsString()
  @MinLength(32, {
    message: 'JWT_ACCESS_SECRET must be at least 32 characters',
  })
  JWT_ACCESS_SECRET!: string;

  @IsString()
  JWT_ACCESS_TTL: string = '15m';

  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  JWT_REFRESH_TTL_DAYS: number = 30;

  @IsBase64()
  APP_ENCRYPTION_KEY!: string;

  @IsUrl(URL_OPTS)
  APP_URL: string = 'http://localhost:3001';

  @IsUrl(URL_OPTS)
  WEB_APP_URL: string = 'http://localhost:5173';

  @IsOptional() @IsString() GOOGLE_CLIENT_ID?: string;
  @IsOptional() @IsString() GOOGLE_CLIENT_SECRET?: string;
  @IsOptional() @IsUrl(URL_OPTS) GOOGLE_CALLBACK_URL?: string;

  @IsOptional() @IsString() FACEBOOK_APP_ID?: string;
  @IsOptional() @IsString() FACEBOOK_APP_SECRET?: string;
  @IsOptional() @IsUrl(URL_OPTS) FACEBOOK_CALLBACK_URL?: string;

  @IsOptional() @IsString() APPLE_CLIENT_ID?: string;
  @IsOptional() @IsString() APPLE_TEAM_ID?: string;
  @IsOptional() @IsString() APPLE_KEY_ID?: string;
  @IsOptional() @IsString() APPLE_PRIVATE_KEY_PATH?: string;
  @IsOptional() @IsUrl(URL_OPTS) APPLE_CALLBACK_URL?: string;

  @IsOptional() @IsString() RESEND_API_KEY?: string;
  @IsOptional() @IsString() MAIL_FROM?: string;
  @IsOptional() @IsString() MAIL_REPLY_TO?: string;

  @IsOptional() @IsString() REDIS_URL?: string;
}

export function validateEnv(raw: Record<string, unknown>): EnvConfig {
  const config = plainToInstance(EnvConfig, raw, {
    enableImplicitConversion: false,
  });
  const errors = validateSync(config, {
    skipMissingProperties: false,
    whitelist: false,
  });
  if (errors.length > 0) {
    const messages = errors
      .map(
        (e) =>
          `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
      )
      .join('\n  ');
    throw new Error(`Invalid environment configuration:\n  ${messages}`);
  }
  return config;
}
