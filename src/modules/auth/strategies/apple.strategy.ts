import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { EnvConfig } from '../../../config/env.validation';
import { NormalizedOAuthProfile } from '../services/social-auth.service';

// `passport-apple` ships without types; declare what we use.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const AppleStrategy = require('passport-apple') as new (
  options: Record<string, unknown>,
  verify: (
    req: Request,
    accessToken: string,
    refreshToken: string,
    idToken: AppleIdToken,
    profile: Record<string, unknown>,
    done: (err: unknown, user?: unknown) => void,
  ) => void,
) => unknown;

interface AppleIdToken {
  sub: string;
  email?: string;
  email_verified?: boolean | string;
  is_private_email?: boolean | string;
}

interface AppleQueryUser {
  name?: { firstName?: string; lastName?: string };
  email?: string;
}

const PLACEHOLDER = 'NOT_CONFIGURED';

@Injectable()
export class AppleStrategyImpl extends PassportStrategy(
  AppleStrategy,
  'apple',
) {
  public readonly isConfigured: boolean;
  private readonly logger = new Logger(AppleStrategyImpl.name);

  constructor(config: ConfigService<EnvConfig, true>) {
    const clientID = config.get('APPLE_CLIENT_ID', { infer: true });
    const teamID = config.get('APPLE_TEAM_ID', { infer: true });
    const keyID = config.get('APPLE_KEY_ID', { infer: true });
    const privateKeyPath = config.get('APPLE_PRIVATE_KEY_PATH', {
      infer: true,
    });
    const callbackURL = config.get('APPLE_CALLBACK_URL', { infer: true });
    const configured =
      !!clientID &&
      !!teamID &&
      !!keyID &&
      !!privateKeyPath &&
      !!callbackURL &&
      existsSync(privateKeyPath);
    const privateKeyString = configured
      ? readFileSync(privateKeyPath, 'utf8')
      : 'NOT_CONFIGURED_KEY';
    super({
      clientID: clientID || PLACEHOLDER,
      teamID: teamID || PLACEHOLDER,
      keyID: keyID || PLACEHOLDER,
      privateKeyString,
      callbackURL:
        callbackURL ||
        `${config.get('APP_URL', { infer: true })}/auth/apple/callback`,
      scope: ['name', 'email'],
      passReqToCallback: true,
    });
    this.isConfigured = configured;
    if (!configured) {
      this.logger.warn(
        'Apple Sign-in not fully configured — strategy registered but will reject callbacks.',
      );
    }
  }

  validate(
    req: Request,
    accessToken: string,
    refreshToken: string,
    idToken: AppleIdToken,
    profile: Record<string, unknown>,
    done: (err: unknown, user?: unknown) => void,
  ): void {
    if (!this.isConfigured) {
      return done(
        new UnauthorizedException({ code: 'oauth_provider_not_configured' }),
        false,
      );
    }
    // Apple only sends the user's name on the first callback, as a JSON-encoded
    // form field. Extract it if present.
    let firstName: string | null = null;
    let lastName: string | null = null;
    const userField = (req.body as { user?: string } | undefined)?.user;
    if (typeof userField === 'string') {
      try {
        const parsed = JSON.parse(userField) as AppleQueryUser;
        firstName = parsed.name?.firstName ?? null;
        lastName = parsed.name?.lastName ?? null;
      } catch {
        // ignore — the field is malformed but the rest of the flow is fine.
      }
    }
    const emailVerified =
      idToken.email_verified === true || idToken.email_verified === 'true';
    const normalized: NormalizedOAuthProfile = {
      provider: 'apple',
      providerUserId: idToken.sub,
      email: idToken.email ?? null,
      emailVerified,
      firstName,
      lastName,
      avatarUrl: null,
      accessToken,
      refreshToken,
      rawProfile: {
        idToken,
        profile,
        isPrivateEmail:
          idToken.is_private_email === true ||
          idToken.is_private_email === 'true',
      },
    };
    done(null, normalized);
  }
}
