import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import {
  Profile,
  Strategy,
  StrategyOptions,
  VerifyCallback,
} from 'passport-google-oauth20';
import { EnvConfig } from '../../../config/env.validation';
import { NormalizedOAuthProfile } from '../services/social-auth.service';

const PLACEHOLDER = 'NOT_CONFIGURED';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  public readonly isConfigured: boolean;

  constructor(config: ConfigService<EnvConfig, true>) {
    const clientID = config.get('GOOGLE_CLIENT_ID', { infer: true });
    const clientSecret = config.get('GOOGLE_CLIENT_SECRET', { infer: true });
    const callbackURL = config.get('GOOGLE_CALLBACK_URL', { infer: true });
    const appUrl = config.get('APP_URL', { infer: true });

    const options: StrategyOptions = {
      clientID: clientID || PLACEHOLDER,
      clientSecret: clientSecret || PLACEHOLDER,
      callbackURL: callbackURL || `${appUrl}/auth/google/callback`,
      scope: ['email', 'profile'],
    };

    super(options);

    this.isConfigured = Boolean(clientID && clientSecret && callbackURL);
  }

  validate(
    accessToken: string,
    refreshToken: string | undefined,
    profile: Profile,
    done: VerifyCallback,
  ): void {
    if (!this.isConfigured) {
      done(
        new UnauthorizedException({ code: 'oauth_provider_not_configured' }),
        false,
      );
      return;
    }

    const primaryEmail = profile.emails?.[0];
    const primaryPhoto = profile.photos?.[0];

    const normalized: NormalizedOAuthProfile = {
      provider: 'google',
      providerUserId: profile.id,
      email: primaryEmail?.value ?? null,
      emailVerified: Boolean(primaryEmail?.verified),
      firstName: profile.name?.givenName ?? null,
      lastName: profile.name?.familyName ?? null,
      avatarUrl: primaryPhoto?.value ?? null,
      accessToken,
      refreshToken: refreshToken ?? null,
      rawProfile: profile._json,
    };

    done(null, normalized);
  }
}
