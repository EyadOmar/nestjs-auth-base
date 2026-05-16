import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { EnvConfig } from '../../../config/env.validation';
import { JwtPayload } from '../../../shared/types/auth.types';

export interface IssuedAccessToken {
  accessToken: string;
  expiresInSeconds: number;
}

function parseTtlSeconds(ttl: string, fallback = 15 * 60): number {
  if (/^\d+$/.test(ttl)) return parseInt(ttl, 10);
  const match = /^(\d+)\s*(s|m|h|d)$/i.exec(ttl);
  if (!match) return fallback;
  const n = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const multiplier =
    unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400;
  return n * multiplier;
}

@Injectable()
export class TokenService {
  private readonly secret: string;
  private readonly accessTtl: string;
  private readonly accessTtlSeconds: number;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService<EnvConfig, true>,
  ) {
    this.secret = config.get('JWT_ACCESS_SECRET', { infer: true });
    this.accessTtl = config.get('JWT_ACCESS_TTL', { infer: true });
    this.accessTtlSeconds = parseTtlSeconds(this.accessTtl);
  }

  async signAccessToken(payload: {
    userId: string;
    email: string;
    sessionId: string;
  }): Promise<IssuedAccessToken> {
    const accessToken = await this.jwt.signAsync(
      {
        sub: payload.userId,
        email: payload.email,
        sessionId: payload.sessionId,
      },
      // expiresIn accepts the ms-style string at runtime but the upstream
      // type narrows to a template literal — cast to keep configurability.
      {
        secret: this.secret,
        expiresIn: this.accessTtl as unknown as number,
        algorithm: 'HS256',
      },
    );
    return { accessToken, expiresInSeconds: this.accessTtlSeconds };
  }

  async verifyAccessToken(token: string): Promise<JwtPayload> {
    return this.jwt.verifyAsync<JwtPayload>(token, {
      secret: this.secret,
      algorithms: ['HS256'],
    });
  }
}
