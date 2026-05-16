import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import { EnvConfig } from '../../../config/env.validation';

export type OAuthIntent = 'login' | 'link';

export interface OAuthState {
  nonce: string;
  intent: OAuthIntent;
  linkUserId?: string;
  iat?: number;
  exp?: number;
}

@Injectable()
export class StateService {
  private readonly secret: string;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService<EnvConfig, true>,
  ) {
    this.secret = config.get('JWT_ACCESS_SECRET', { infer: true });
  }

  signState(input: { intent: OAuthIntent; linkUserId?: string }): string {
    return this.jwt.sign(
      {
        nonce: randomBytes(16).toString('hex'),
        intent: input.intent,
        linkUserId: input.linkUserId,
      },
      { secret: this.secret, expiresIn: '10m', algorithm: 'HS256' },
    );
  }

  verifyState(raw: string, expectedIntent?: OAuthIntent): OAuthState {
    let payload: OAuthState;
    try {
      payload = this.jwt.verify<OAuthState>(raw, {
        secret: this.secret,
        algorithms: ['HS256'],
      });
    } catch {
      throw new BadRequestException({ code: 'invalid_oauth_state' });
    }
    if (
      !payload.nonce ||
      (payload.intent !== 'login' && payload.intent !== 'link')
    ) {
      throw new BadRequestException({ code: 'invalid_oauth_state' });
    }
    if (expectedIntent && payload.intent !== expectedIntent) {
      throw new BadRequestException({ code: 'invalid_oauth_state' });
    }
    if (payload.intent === 'link' && !payload.linkUserId) {
      throw new BadRequestException({ code: 'invalid_oauth_state' });
    }
    return payload;
  }
}
