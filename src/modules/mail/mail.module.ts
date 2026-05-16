import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { EnvConfig } from '../../config/env.validation';
import { MailService, RESEND_CLIENT } from './mail.service';

@Global()
@Module({
  providers: [
    {
      provide: RESEND_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvConfig, true>) => {
        const apiKey = config.get('RESEND_API_KEY', { infer: true });
        return apiKey ? new Resend(apiKey) : null;
      },
    },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}
