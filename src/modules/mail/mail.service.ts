import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Resend } from 'resend';
import { EnvConfig } from '../../config/env.validation';
import { Locale, RenderedTemplate } from './templates/template-utils';
import { renderEmailChange } from './templates/email-change.template';
import { renderMagicLink } from './templates/magic-link.template';
import { renderResetPassword } from './templates/reset-password.template';
import { renderVerifyEmail } from './templates/verify-email.template';

export const RESEND_CLIENT = 'RESEND';

export interface MailRecipient {
  email: string;
  locale?: string | null;
  firstName?: string | null;
}

const resolveLocale = (raw: string | null | undefined): Locale =>
  raw === 'ar' ? 'ar' : 'en';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly from: string;
  private readonly replyTo?: string;
  private readonly webAppUrl: string;

  constructor(
    @Inject(RESEND_CLIENT) private readonly resend: Resend | null,
    config: ConfigService<EnvConfig, true>,
  ) {
    this.from =
      config.get('MAIL_FROM', { infer: true }) ?? 'no-reply@example.com';
    const reply = config.get('MAIL_REPLY_TO', { infer: true });
    this.replyTo = reply && reply.length > 0 ? reply : undefined;
    this.webAppUrl = config.get('WEB_APP_URL', { infer: true });
  }

  async sendVerifyEmail(
    user: MailRecipient,
    args: { token: string },
  ): Promise<void> {
    const url = `${this.webAppUrl}/auth/verify-email?token=${encodeURIComponent(args.token)}`;
    const rendered = renderVerifyEmail(
      { firstName: user.firstName ?? null, verifyUrl: url },
      resolveLocale(user.locale),
    );
    await this.send(user.email, rendered);
  }

  async sendPasswordReset(
    user: MailRecipient,
    args: { token: string },
  ): Promise<void> {
    const url = `${this.webAppUrl}/auth/reset-password?token=${encodeURIComponent(args.token)}`;
    const rendered = renderResetPassword(
      { firstName: user.firstName ?? null, resetUrl: url },
      resolveLocale(user.locale),
    );
    await this.send(user.email, rendered);
  }

  async sendMagicLink(
    user: MailRecipient,
    args: { token: string },
  ): Promise<void> {
    const url = `${this.webAppUrl}/auth/magic-link?token=${encodeURIComponent(args.token)}`;
    const rendered = renderMagicLink(
      { firstName: user.firstName ?? null, magicUrl: url },
      resolveLocale(user.locale),
    );
    await this.send(user.email, rendered);
  }

  async sendEmailChangeConfirmation(
    user: MailRecipient,
    args: { token: string; newEmail: string },
  ): Promise<void> {
    const url = `${this.webAppUrl}/auth/confirm-email-change?token=${encodeURIComponent(args.token)}`;
    const rendered = renderEmailChange(
      {
        firstName: user.firstName ?? null,
        newEmail: args.newEmail,
        confirmUrl: url,
      },
      resolveLocale(user.locale),
    );
    await this.send(args.newEmail, rendered);
  }

  private async send(to: string, rendered: RenderedTemplate): Promise<void> {
    if (!this.resend) {
      throw new Error(
        'Mail send attempted but RESEND_API_KEY is not configured.',
      );
    }
    const { error } = await this.resend.emails.send({
      from: this.from,
      to,
      replyTo: this.replyTo,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    if (error) {
      this.logger.error(`Resend send failed (${error.name}): ${error.message}`);
      throw new Error(`Mail send failed: ${error.message}`);
    }
  }
}
