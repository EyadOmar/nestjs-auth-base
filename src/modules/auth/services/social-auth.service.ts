import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { EnvConfig } from '../../../config/env.validation';
import { User } from '../../users/entities/user.entity';
import { UsersService } from '../../users/users.service';
import { AuthIdentity, AuthProvider } from '../entities/auth-identity.entity';
import { AuditService, RequestContext } from './audit.service';
import { SessionService } from './session.service';
import { StateService } from './state.service';
import { TokenService } from './token.service';

export interface NormalizedOAuthProfile {
  provider: AuthProvider;
  providerUserId: string;
  email: string | null;
  emailVerified: boolean;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  expiresIn?: number | null;
  scope?: string | null;
  rawProfile: Record<string, unknown> | null;
}

export interface SocialLoginResult {
  user: User;
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  tokenType: 'Bearer';
}

@Injectable()
export class SocialAuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(AuthIdentity)
    private readonly identities: Repository<AuthIdentity>,
    private readonly usersService: UsersService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    private readonly stateService: StateService,
    private readonly config: ConfigService<EnvConfig, true>,
  ) {}

  buildLinkAuthorizeUrl(provider: AuthProvider, linkUserId: string): string {
    const state = this.stateService.signState({ intent: 'link', linkUserId });
    const appUrl = this.config.get('APP_URL', { infer: true });
    const cb = (
      key:
        | 'GOOGLE_CALLBACK_URL'
        | 'FACEBOOK_CALLBACK_URL'
        | 'APPLE_CALLBACK_URL',
    ) =>
      this.config.get(key, { infer: true }) ??
      `${appUrl}/auth/${provider}/callback`;
    if (provider === 'google') {
      const clientId = this.config.get('GOOGLE_CLIENT_ID', { infer: true });
      if (!clientId)
        throw new BadRequestException({
          code: 'oauth_provider_not_configured',
        });
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: cb('GOOGLE_CALLBACK_URL'),
        scope: 'email profile',
        access_type: 'offline',
        prompt: 'consent',
        state,
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    }
    if (provider === 'facebook') {
      const clientId = this.config.get('FACEBOOK_APP_ID', { infer: true });
      if (!clientId)
        throw new BadRequestException({
          code: 'oauth_provider_not_configured',
        });
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: cb('FACEBOOK_CALLBACK_URL'),
        scope: 'email,public_profile',
        state,
      });
      return `https://www.facebook.com/v18.0/dialog/oauth?${params.toString()}`;
    }
    if (provider === 'apple') {
      const clientId = this.config.get('APPLE_CLIENT_ID', { infer: true });
      if (!clientId)
        throw new BadRequestException({
          code: 'oauth_provider_not_configured',
        });
      const params = new URLSearchParams({
        response_type: 'code id_token',
        response_mode: 'form_post',
        client_id: clientId,
        redirect_uri: cb('APPLE_CALLBACK_URL'),
        scope: 'name email',
        state,
      });
      return `https://appleid.apple.com/auth/authorize?${params.toString()}`;
    }
    throw new BadRequestException({ code: 'unknown_provider' });
  }

  async findOrCreateUser(
    profile: NormalizedOAuthProfile,
    ctx: RequestContext,
  ): Promise<SocialLoginResult> {
    // 1) Existing identity → return its user.
    const existing = await this.identities.findOne({
      where: {
        provider: profile.provider,
        providerUserId: profile.providerUserId,
      },
    });
    if (existing) {
      await this.refreshIdentityTokens(existing, profile);
      const user = await this.usersService.findById(existing.userId);
      if (!user || user.status === 'deleted') {
        throw new UnauthorizedException({ code: 'account_locked' });
      }
      return this.issueLogin(user, ctx, 'existing');
    }

    // 2) Verified email matches an existing user → link to that user.
    if (profile.emailVerified && profile.email) {
      const byEmail = await this.usersService.findByEmail(profile.email);
      if (byEmail && byEmail.status !== 'deleted') {
        await this.createIdentity(byEmail.id, profile);
        await this.audit.recordEvent({
          userId: byEmail.id,
          eventType: 'social_link',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          metadata: { provider: profile.provider, via: 'login_match' },
        });
        return this.issueLogin(byEmail, ctx, 'linked');
      }
    }

    // 3) Else create a new user. Provider already verified the email.
    if (!profile.email) {
      throw new BadRequestException({ code: 'oauth_email_missing' });
    }
    const created = await this.users.save(
      this.users.create({
        email: profile.email,
        emailVerifiedAt: profile.emailVerified ? new Date() : null,
        passwordHash: null,
        firstName: profile.firstName ?? null,
        lastName: profile.lastName ?? null,
        avatarUrl: profile.avatarUrl ?? null,
        status: profile.emailVerified ? 'active' : 'pending',
      }),
    );
    await this.createIdentity(created.id, profile);
    await this.audit.recordEvent({
      userId: created.id,
      eventType: 'register',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { provider: profile.provider, via: 'oauth' },
    });
    await this.audit.recordEvent({
      userId: created.id,
      eventType: 'social_link',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { provider: profile.provider, via: 'new_user' },
    });
    return this.issueLogin(created, ctx, 'created');
  }

  async linkIdentity(
    userId: string,
    profile: NormalizedOAuthProfile,
    ctx: RequestContext,
  ): Promise<void> {
    const existing = await this.identities.findOne({
      where: {
        provider: profile.provider,
        providerUserId: profile.providerUserId,
      },
    });
    if (existing && existing.userId !== userId) {
      throw new ConflictException({ code: 'identity_belongs_to_other_user' });
    }
    if (existing) {
      await this.refreshIdentityTokens(existing, profile);
    } else {
      await this.createIdentity(userId, profile);
    }
    await this.audit.recordEvent({
      userId,
      eventType: 'social_link',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { provider: profile.provider, via: 'explicit_link' },
    });
  }

  async unlinkIdentity(
    userId: string,
    provider: AuthProvider,
    ctx: RequestContext,
  ): Promise<void> {
    const user = await this.usersService.getByIdOrThrow(userId);
    const identities = await this.identities.find({ where: { userId } });
    const target = identities.find((i) => i.provider === provider);
    if (!target) throw new NotFoundException({ code: 'identity_not_found' });
    const remainingIdentities = identities.length - 1;
    const hasPassword = !!user.passwordHash;
    if (!hasPassword && remainingIdentities === 0) {
      throw new BadRequestException({ code: 'cannot_remove_last_auth_method' });
    }
    await this.identities.delete({ id: target.id });
    await this.audit.recordEvent({
      userId,
      eventType: 'social_unlink',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { provider },
    });
  }

  async listLinkedProviders(userId: string): Promise<AuthProvider[]> {
    const rows = await this.identities.find({ where: { userId } });
    return rows.map((r) => r.provider);
  }

  // ============ internals ============

  private async createIdentity(
    userId: string,
    profile: NormalizedOAuthProfile,
  ): Promise<AuthIdentity> {
    return this.identities.save(
      this.identities.create({
        userId,
        provider: profile.provider,
        providerUserId: profile.providerUserId,
        providerEmail: profile.email,
        accessToken: this.crypto.encryptNullable(profile.accessToken),
        refreshToken: this.crypto.encryptNullable(profile.refreshToken),
        tokenExpiresAt:
          profile.expiresIn && profile.expiresIn > 0
            ? new Date(Date.now() + profile.expiresIn * 1000)
            : null,
        scope: profile.scope ?? null,
        rawProfile: profile.rawProfile,
      }),
    );
  }

  private async refreshIdentityTokens(
    identity: AuthIdentity,
    profile: NormalizedOAuthProfile,
  ): Promise<void> {
    identity.accessToken = this.crypto.encryptNullable(profile.accessToken);
    if (profile.refreshToken) {
      identity.refreshToken = this.crypto.encryptNullable(profile.refreshToken);
    }
    identity.tokenExpiresAt =
      profile.expiresIn && profile.expiresIn > 0
        ? new Date(Date.now() + profile.expiresIn * 1000)
        : null;
    identity.scope = profile.scope ?? identity.scope;
    identity.providerEmail = profile.email ?? identity.providerEmail;
    identity.rawProfile = profile.rawProfile ?? identity.rawProfile;
    await this.identities.save(identity);
  }

  private async issueLogin(
    user: User,
    ctx: RequestContext,
    via: 'existing' | 'linked' | 'created',
  ): Promise<SocialLoginResult> {
    const issued = await this.sessions.create({
      userId: user.id,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    });
    const access = await this.tokens.signAccessToken({
      userId: user.id,
      email: user.email,
      sessionId: issued.session.id,
    });
    await this.users.update({ id: user.id }, { lastLoginAt: new Date() });
    await this.audit.recordEvent({
      userId: user.id,
      eventType: 'login',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { sessionId: issued.session.id, via: `oauth_${via}` },
    });
    return {
      user,
      sessionId: issued.session.id,
      accessToken: access.accessToken,
      refreshToken: issued.refreshToken,
      expiresInSeconds: access.expiresInSeconds,
      tokenType: 'Bearer',
    };
  }
}
