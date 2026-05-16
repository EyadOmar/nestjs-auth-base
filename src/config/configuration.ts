import { ConfigService } from '@nestjs/config';
import { EnvConfig } from './env.validation';

export type TypedConfigService = ConfigService<EnvConfig, true>;
