import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HashService } from '../../../common/crypto/hash.service';
import { MailService } from '../../mail/mail.service';
import { User } from '../../users/entities/user.entity';
import { UsersService } from '../../users/users.service';
import { isCommonPassword } from '../common-passwords';
import { AuditService, RequestContext } from './audit.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';
import { VerificationService } from './verification.service';

export interface RegisterInput extends RequestContext {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
}

export interface LoginInput extends RequestContext {
  email: string;
  password: string;
  deviceId?: string | null;
  deviceName?: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  tokenType: 'Bearer';
}

export interface LoginResult extends AuthTokens {
  user: User;
  sessionId: string;
}

const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const FAILURE_THRESHOLD = 10;

function obfuscateEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  if (local.length <= 2) return `${local[0] ?? '*'}***@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly usersService: UsersService,
    private readonly hash: HashService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly verifications: VerificationService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  // ============ Register ============

  async register(input: RegisterInput): Promise<User> {
    if (isCommonPassword(input.password)) {
      throw new BadRequestException('password_too_common');
    }
    const existing = await this.usersService.findByEmail(input.email);
    if (existing) throw new ConflictException('email_already_registered');

    const passwordHash = await this.hash.hashPassword(input.password);
    const user = await this.users.save(
      this.users.create({
        email: input.email,
        passwordHash,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
        status: 'pending',
        emailVerifiedAt: null,
      }),
    );

    const { raw } = await this.verifications.issue(user.id, 'email_verify');
    await this.mail.sendVerifyEmail(
      { email: user.email, locale: user.locale, firstName: user.firstName },
      { token: raw },
    );
    await this.audit.recordEvent({
      userId: user.id,
      eventType: 'register',
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
    return user;
  }

  async resendVerification(email: string, ctx: RequestContext): Promise<void> {
    const user = await this.usersService.findByEmail(email);
    if (!user || user.emailVerifiedAt) return; // generic-success behaviour
    const { raw } = await this.verifications.issue(user.id, 'email_verify');
    await this.mail.sendVerifyEmail(
      { email: user.email, locale: user.locale, firstName: user.firstName },
      { token: raw },
    );
    await this.audit.recordEvent({
      userId: user.id,
      eventType: 'email_change_requested',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { kind: 'resend_verification' },
    });
  }

  async verifyEmail(rawToken: string, ctx: RequestContext): Promise<void> {
    const record = await this.verifications.consume(rawToken, 'email_verify');
    if (!record) throw new BadRequestException('invalid_or_expired_token');
    await this.users.update(
      { id: record.userId },
      { emailVerifiedAt: new Date(), status: 'active' },
    );
    await this.audit.recordEvent({
      userId: record.userId,
      eventType: 'email_verified',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  // ============ Login ============

  async login(input: LoginInput): Promise<LoginResult> {
    const failureCount = await this.audit.countRecentFailures(
      input.email,
      FAILURE_WINDOW_MS,
    );
    if (failureCount >= FAILURE_THRESHOLD) {
      await this.audit.recordLoginAttempt({
        identifier: input.email,
        success: false,
        failureReason: 'locked',
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      });
      throw new ForbiddenException({ code: 'account_locked' });
    }

    const user = await this.usersService.findByEmail(input.email);

    // Rule 1: no user (or deleted) → no_user / 401 invalid_credentials
    if (!user) {
      await this.audit.recordLoginAttempt({
        identifier: input.email,
        success: false,
        failureReason: 'no_user',
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      });
      throw new UnauthorizedException({ code: 'invalid_credentials' });
    }

    // Rule 2: email not verified → 403 email_not_verified with obfuscated email
    if (user.emailVerifiedAt === null) {
      await this.audit.recordLoginAttempt({
        identifier: input.email,
        userId: user.id,
        success: false,
        failureReason: 'not_verified',
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      });
      throw new ForbiddenException({
        code: 'email_not_verified',
        email: obfuscateEmail(user.email),
      });
    }

    // Rule 3: status suspended or deleted → 403 account_locked
    if (user.status === 'suspended' || user.status === 'deleted') {
      await this.audit.recordLoginAttempt({
        identifier: input.email,
        userId: user.id,
        success: false,
        failureReason: 'locked',
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      });
      throw new ForbiddenException({ code: 'account_locked' });
    }

    // Rule 4: password mismatch → 401 invalid_credentials (same as rule 1)
    const ok =
      user.passwordHash !== null &&
      (await this.hash.verifyPassword(user.passwordHash, input.password));
    if (!ok) {
      await this.audit.recordLoginAttempt({
        identifier: input.email,
        userId: user.id,
        success: false,
        failureReason: 'wrong_password',
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      });
      throw new UnauthorizedException({ code: 'invalid_credentials' });
    }

    // Rule 5: success
    const issued = await this.sessions.create({
      userId: user.id,
      deviceId: input.deviceId ?? null,
      deviceName: input.deviceName ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    });
    const access = await this.tokens.signAccessToken({
      userId: user.id,
      email: user.email,
      sessionId: issued.session.id,
    });
    await this.users.update({ id: user.id }, { lastLoginAt: new Date() });
    await this.audit.recordLoginAttempt({
      identifier: input.email,
      userId: user.id,
      success: true,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
    await this.audit.recordEvent({
      userId: user.id,
      eventType: 'login',
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      metadata: { sessionId: issued.session.id },
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

  // ============ Refresh ============

  async refresh(rawRefresh: string, ctx: RequestContext): Promise<AuthTokens> {
    const result = await this.sessions.rotate(rawRefresh, ctx);
    if (result.kind === 'invalid') {
      throw new UnauthorizedException({ code: 'invalid_refresh_token' });
    }
    if (result.kind === 'replay') {
      await this.sessions.revokeAllForUser(result.userId, 'refresh_replay');
      await this.audit.recordEvent({
        userId: result.userId,
        eventType: 'refresh_replay_detected',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      throw new UnauthorizedException({ code: 'refresh_replay_detected' });
    }
    const user = await this.usersService.findById(result.issued.session.userId);
    if (!user || user.deletedAt) {
      throw new UnauthorizedException({ code: 'invalid_refresh_token' });
    }
    const access = await this.tokens.signAccessToken({
      userId: user.id,
      email: user.email,
      sessionId: result.issued.session.id,
    });
    return {
      accessToken: access.accessToken,
      refreshToken: result.issued.refreshToken,
      expiresInSeconds: access.expiresInSeconds,
      tokenType: 'Bearer',
    };
  }

  // ============ Logout ============

  async logout(
    userId: string,
    sessionId: string,
    ctx: RequestContext,
  ): Promise<void> {
    await this.sessions.revoke(sessionId, 'logout');
    await this.audit.recordEvent({
      userId,
      eventType: 'logout',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { sessionId },
    });
  }

  async logoutAll(userId: string, ctx: RequestContext): Promise<void> {
    await this.sessions.revokeAllForUser(userId, 'logout_all');
    await this.audit.recordEvent({
      userId,
      eventType: 'logout_all',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  // ============ Forgot / reset password ============

  async forgotPassword(email: string, ctx: RequestContext): Promise<void> {
    const user = await this.usersService.findByEmail(email);
    if (!user || user.status === 'deleted') return;
    const { raw } = await this.verifications.issue(user.id, 'password_reset');
    await this.mail.sendPasswordReset(
      { email: user.email, locale: user.locale, firstName: user.firstName },
      { token: raw },
    );
    await this.audit.recordEvent({
      userId: user.id,
      eventType: 'password_reset',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { kind: 'request' },
    });
  }

  async resetPassword(
    rawToken: string,
    newPassword: string,
    ctx: RequestContext,
  ): Promise<AuthTokens> {
    if (isCommonPassword(newPassword)) {
      throw new BadRequestException('password_too_common');
    }
    const record = await this.verifications.consume(rawToken, 'password_reset');
    if (!record) throw new BadRequestException('invalid_or_expired_token');
    const user = await this.usersService.getByIdOrThrow(record.userId);
    const newHash = await this.hash.hashPassword(newPassword);
    await this.users.update({ id: user.id }, { passwordHash: newHash });
    await this.sessions.revokeAllForUser(user.id, 'password_change');

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
    await this.audit.recordEvent({
      userId: user.id,
      eventType: 'password_change',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { via: 'reset_password' },
    });
    return {
      accessToken: access.accessToken,
      refreshToken: issued.refreshToken,
      expiresInSeconds: access.expiresInSeconds,
      tokenType: 'Bearer',
    };
  }

  // ============ Change password (authenticated) ============

  async changePassword(input: {
    userId: string;
    currentPassword: string;
    newPassword: string;
    context: RequestContext;
  }): Promise<AuthTokens> {
    if (isCommonPassword(input.newPassword)) {
      throw new BadRequestException('password_too_common');
    }
    const user = await this.usersService.getByIdOrThrow(input.userId);
    if (!user.passwordHash) {
      throw new BadRequestException({ code: 'no_password_set' });
    }
    const ok = await this.hash.verifyPassword(
      user.passwordHash,
      input.currentPassword,
    );
    if (!ok) {
      throw new UnauthorizedException({ code: 'invalid_credentials' });
    }
    const newHash = await this.hash.hashPassword(input.newPassword);
    await this.users.update({ id: user.id }, { passwordHash: newHash });
    await this.sessions.revokeAllForUser(user.id, 'password_change');
    const issued = await this.sessions.create({
      userId: user.id,
      ipAddress: input.context.ipAddress ?? null,
      userAgent: input.context.userAgent ?? null,
    });
    const access = await this.tokens.signAccessToken({
      userId: user.id,
      email: user.email,
      sessionId: issued.session.id,
    });
    await this.audit.recordEvent({
      userId: user.id,
      eventType: 'password_change',
      ipAddress: input.context.ipAddress,
      userAgent: input.context.userAgent,
      metadata: { via: 'change_password' },
    });
    return {
      accessToken: access.accessToken,
      refreshToken: issued.refreshToken,
      expiresInSeconds: access.expiresInSeconds,
      tokenType: 'Bearer',
    };
  }

  // ============ Change email (authenticated init + public confirm) ============

  async requestEmailChange(input: {
    userId: string;
    newEmail: string;
    context: RequestContext;
  }): Promise<void> {
    const user = await this.usersService.getByIdOrThrow(input.userId);
    if (user.email.toLowerCase() === input.newEmail.toLowerCase()) {
      throw new BadRequestException({ code: 'email_unchanged' });
    }
    const existing = await this.usersService.findByEmail(input.newEmail);
    if (existing)
      throw new ConflictException({ code: 'email_already_registered' });
    const { raw } = await this.verifications.issue(user.id, 'email_change', {
      newEmail: input.newEmail,
    });
    await this.mail.sendEmailChangeConfirmation(
      { email: user.email, locale: user.locale, firstName: user.firstName },
      { token: raw, newEmail: input.newEmail },
    );
    await this.audit.recordEvent({
      userId: user.id,
      eventType: 'email_change_requested',
      ipAddress: input.context.ipAddress,
      userAgent: input.context.userAgent,
      metadata: { newEmail: input.newEmail },
    });
  }

  async confirmEmailChange(input: {
    rawToken: string;
    keepSessionId?: string;
    context: RequestContext;
  }): Promise<void> {
    const record = await this.verifications.consume(
      input.rawToken,
      'email_change',
    );
    if (!record) throw new BadRequestException('invalid_or_expired_token');
    const newEmail =
      typeof record.metadata?.newEmail === 'string'
        ? record.metadata.newEmail
        : null;
    if (!newEmail) throw new BadRequestException('invalid_or_expired_token');
    const conflict = await this.usersService.findByEmail(newEmail);
    if (conflict && conflict.id !== record.userId) {
      throw new ConflictException({ code: 'email_already_registered' });
    }
    await this.users.update({ id: record.userId }, { email: newEmail });
    if (input.keepSessionId) {
      await this.sessions.revokeAllForUserExcept(
        record.userId,
        input.keepSessionId,
        'email_change',
      );
    } else {
      await this.sessions.revokeAllForUser(record.userId, 'email_change');
    }
    await this.audit.recordEvent({
      userId: record.userId,
      eventType: 'email_change',
      ipAddress: input.context.ipAddress,
      userAgent: input.context.userAgent,
      metadata: { newEmail },
    });
  }

  // ============ Magic link ============

  async magicLinkRequest(email: string, ctx: RequestContext): Promise<void> {
    const user = await this.usersService.findByEmail(email);
    if (!user || user.status === 'deleted') return;
    const { raw } = await this.verifications.issue(user.id, 'magic_link');
    await this.mail.sendMagicLink(
      { email: user.email, locale: user.locale, firstName: user.firstName },
      { token: raw },
    );
    await this.audit.recordEvent({
      userId: user.id,
      eventType: 'magic_link_request',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  async magicLinkVerify(
    rawToken: string,
    ctx: RequestContext,
  ): Promise<LoginResult> {
    const record = await this.verifications.consume(rawToken, 'magic_link');
    if (!record) throw new BadRequestException('invalid_or_expired_token');
    const user = await this.usersService.getByIdOrThrow(record.userId);
    if (user.status === 'suspended' || user.status === 'deleted') {
      throw new ForbiddenException({ code: 'account_locked' });
    }
    if (user.emailVerifiedAt === null) {
      // Magic-link login implicitly verifies the email — the user proved control of the inbox.
      await this.users.update(
        { id: user.id },
        { emailVerifiedAt: new Date(), status: 'active' },
      );
      user.emailVerifiedAt = new Date();
      user.status = 'active';
    }
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
      eventType: 'magic_link_login',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { sessionId: issued.session.id },
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
