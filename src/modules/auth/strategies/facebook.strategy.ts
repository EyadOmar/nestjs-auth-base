import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy, StrategyOptions } from 'passport-facebook';
import { EnvConfig } from '../../../config/env.validation';
import { NormalizedOAuthProfile } from '../services/social-auth.service';

const PLACEHOLDER = 'NOT_CONFIGURED';

@Injectable()
export class FacebookStrategy extends PassportStrategy(Strategy, 'facebook') {
  public readonly isConfigured: boolean;

  constructor(config: ConfigService<EnvConfig, true>) {
    const clientID = config.get('FACEBOOK_APP_ID', { infer: true });
    const clientSecret = config.get('FACEBOOK_APP_SECRET', { infer: true });
    const callbackURL = config.get('FACEBOOK_CALLBACK_URL', { infer: true });
    const options: StrategyOptions = {
      clientID: clientID || PLACEHOLDER,
      clientSecret: clientSecret || PLACEHOLDER,
      callbackURL:
        callbackURL ||
        `${config.get('APP_URL', { infer: true })}/auth/facebook/callback`,
      profileFields: ['id', 'emails', 'name', 'picture.type(large)'],
    };
    super(options);
    this.isConfigured = !!(clientID && clientSecret && callbackURL);
  }

  validate(
    accessToken: string,
    refreshToken: string | undefined,
    profile: Profile,
    done: (err: unknown, value?: unknown) => void,
  ): void {
    if (!this.isConfigured) {
      return done(
        new UnauthorizedException({ code: 'oauth_provider_not_configured' }),
        false,
      );
    }
    const email = profile.emails?.[0]?.value ?? null;
    const photo = profile.photos?.[0]?.value ?? null;
    const normalized: NormalizedOAuthProfile = {
      provider: 'facebook',
      providerUserId: profile.id,
      email,
      emailVerified: !!email,
      firstName: profile.name?.givenName ?? null,
      lastName: profile.name?.familyName ?? null,
      avatarUrl: photo,
      accessToken,
      refreshToken: refreshToken ?? null,
      rawProfile: profile._json as Record<string, unknown>,
    };
    done(null, normalized);
  }
}
