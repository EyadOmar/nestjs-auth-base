import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  AppleCallbackGuard,
  AppleOAuthGuard,
  FacebookCallbackGuard,
  FacebookOAuthGuard,
  GoogleCallbackGuard,
  GoogleOAuthGuard,
} from './guards/oauth-guards';
import { AuthProvider } from './entities/auth-identity.entity';
import {
  NormalizedOAuthProfile,
  SocialAuthService,
} from './services/social-auth.service';
import { StateService } from './services/state.service';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { getRequestContext } from '../../common/http/request-context';
import type { AuthenticatedUser } from '../../shared/types/auth.types';
import { UserResponseDto } from '../users/dto/user-response.dto';
import {
  AuthTokensResponseDto,
  GenericOkResponseDto,
  LoginResponseDto,
  SessionResponseDto,
} from './dto/auth-response.dto';
import { ConfirmEmailChangeDto } from './dto/confirm-email-change.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { MagicLinkRequestDto } from './dto/magic-link-request.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import {
  MagicLinkVerifyDto,
  ResendVerificationDto,
  VerifyEmailDto,
} from './dto/verify-email.dto';
import { AuthService, AuthTokens } from './services/auth.service';
import { SessionService } from './services/session.service';
import { AuditService } from './services/audit.service';

function parseProvider(raw: string): AuthProvider {
  if (raw === 'google' || raw === 'facebook' || raw === 'apple') return raw;
  throw new BadRequestException({ code: 'unknown_provider' });
}

function toTokens(t: AuthTokens): AuthTokensResponseDto {
  return {
    accessToken: t.accessToken,
    refreshToken: t.refreshToken,
    expiresInSeconds: t.expiresInSeconds,
    tokenType: t.tokenType,
  };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly social: SocialAuthService,
    private readonly state: StateService,
  ) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } })
  @ApiOperation({
    summary: 'Register a new user',
    description:
      'Creates a pending user and sends a verification email. The user must verify before they can log in.',
  })
  @ApiCreatedResponse({ type: UserResponseDto })
  @ApiBadRequestResponse({
    description: 'Validation error, or password_too_common',
  })
  @ApiConflictResponse({ description: 'email_already_registered' })
  @ApiTooManyRequestsResponse({
    description: 'Too many registrations from this IP',
  })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
  ): Promise<UserResponseDto> {
    const user = await this.auth.register({
      ...dto,
      ...getRequestContext(req),
    });
    return UserResponseDto.fromEntity(user);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60 * 1000 } })
  @ApiOperation({
    summary: 'Log in with email and password',
    description:
      'Returns an access JWT and an opaque refresh token. Phone-based login is deferred to a future build.',
  })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiUnauthorizedResponse({ description: 'invalid_credentials' })
  @ApiForbiddenResponse({ description: 'email_not_verified or account_locked' })
  @ApiTooManyRequestsResponse({ description: 'Throttled or soft-lockout' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
  ): Promise<LoginResponseDto> {
    const result = await this.auth.login({ ...dto, ...getRequestContext(req) });
    return {
      ...toTokens(result),
      user: UserResponseDto.fromEntity(result.user),
      sessionId: result.sessionId,
    };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60 * 1000 } })
  @ApiOperation({
    summary: 'Rotate a refresh token',
    description:
      'Returns a new access + refresh pair and revokes the presented refresh token. Reusing a rotated token revokes every session for the user.',
  })
  @ApiOkResponse({ type: AuthTokensResponseDto })
  @ApiUnauthorizedResponse({
    description: 'invalid_refresh_token or refresh_replay_detected',
  })
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
  ): Promise<AuthTokensResponseDto> {
    return toTokens(
      await this.auth.refresh(dto.refreshToken, getRequestContext(req)),
    );
  }

  @Post('logout')
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke the current session' })
  async logout(
    @CurrentUser() me: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<void> {
    await this.auth.logout(me.id, me.sessionId, getRequestContext(req));
  }

  @Post('logout-all')
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke every active session for the current user' })
  async logoutAll(
    @CurrentUser() me: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<void> {
    await this.auth.logoutAll(me.id, getRequestContext(req));
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Activate an account using the token from the verify email',
  })
  @ApiOkResponse({ type: GenericOkResponseDto })
  @ApiBadRequestResponse({ description: 'invalid_or_expired_token' })
  async verifyEmail(
    @Body() dto: VerifyEmailDto,
    @Req() req: Request,
  ): Promise<GenericOkResponseDto> {
    await this.auth.verifyEmail(dto.token, getRequestContext(req));
    return { ok: true };
  }

  @Public()
  @Post('resend-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 3, ttl: 60 * 60 * 1000 } })
  @ApiOperation({
    summary: 'Resend the verification email',
    description:
      'Always returns 202 — does NOT reveal whether the email exists.',
  })
  @ApiOkResponse({ type: GenericOkResponseDto })
  async resendVerification(
    @Body() dto: ResendVerificationDto,
    @Req() req: Request,
  ): Promise<GenericOkResponseDto> {
    await this.auth.resendVerification(dto.email, getRequestContext(req));
    return { ok: true };
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 3, ttl: 60 * 60 * 1000 } })
  @ApiOperation({
    summary: 'Send a password-reset link',
    description:
      'Always returns 202 — does NOT reveal whether the email exists.',
  })
  @ApiOkResponse({ type: GenericOkResponseDto })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() req: Request,
  ): Promise<GenericOkResponseDto> {
    await this.auth.forgotPassword(dto.email, getRequestContext(req));
    return { ok: true };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reset password using the token from the reset email',
    description:
      'On success, all existing sessions are revoked and a fresh access + refresh pair is issued for the current device.',
  })
  @ApiOkResponse({ type: AuthTokensResponseDto })
  @ApiBadRequestResponse({
    description: 'invalid_or_expired_token or password_too_common',
  })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() req: Request,
  ): Promise<AuthTokensResponseDto> {
    return toTokens(
      await this.auth.resetPassword(
        dto.token,
        dto.newPassword,
        getRequestContext(req),
      ),
    );
  }

  @Public()
  @Post('magic-link/request')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 3, ttl: 60 * 60 * 1000 } })
  @ApiOperation({
    summary: 'Send a magic-link sign-in email',
    description:
      'Always returns 202 — does NOT reveal whether the email exists.',
  })
  @ApiOkResponse({ type: GenericOkResponseDto })
  async magicLinkRequest(
    @Body() dto: MagicLinkRequestDto,
    @Req() req: Request,
  ): Promise<GenericOkResponseDto> {
    await this.auth.magicLinkRequest(dto.email, getRequestContext(req));
    return { ok: true };
  }

  @Public()
  @Post('magic-link/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Exchange a magic-link token for a session',
    description: 'Verifies the email if it was not already verified.',
  })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiBadRequestResponse({ description: 'invalid_or_expired_token' })
  @ApiForbiddenResponse({ description: 'account_locked' })
  async magicLinkVerify(
    @Body() dto: MagicLinkVerifyDto,
    @Req() req: Request,
  ): Promise<LoginResponseDto> {
    const result = await this.auth.magicLinkVerify(
      dto.token,
      getRequestContext(req),
    );
    return {
      ...toTokens(result),
      user: UserResponseDto.fromEntity(result.user),
      sessionId: result.sessionId,
    };
  }

  // ============ Social login ============

  @Public()
  @Get('google')
  @UseGuards(GoogleOAuthGuard)
  @ApiOperation({ summary: 'Begin Google sign-in (redirects to Google)' })
  googleAuth(): void {
    /* handled by GoogleOAuthGuard's redirect */
  }

  @Public()
  @Get('google/callback')
  @UseGuards(GoogleCallbackGuard)
  @ApiOperation({ summary: 'Google OAuth callback' })
  async googleCallback(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query('state') stateParam: string,
  ): Promise<LoginResponseDto | { ok: true }> {
    return this.handleOAuthCallback(req, res, stateParam, 'google');
  }

  @Public()
  @Get('facebook')
  @UseGuards(FacebookOAuthGuard)
  @ApiOperation({ summary: 'Begin Facebook sign-in (redirects to Facebook)' })
  facebookAuth(): void {
    /* handled by FacebookOAuthGuard's redirect */
  }

  @Public()
  @Get('facebook/callback')
  @UseGuards(FacebookCallbackGuard)
  @ApiOperation({ summary: 'Facebook OAuth callback' })
  async facebookCallback(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query('state') stateParam: string,
  ): Promise<LoginResponseDto | { ok: true }> {
    return this.handleOAuthCallback(req, res, stateParam, 'facebook');
  }

  @Public()
  @Get('apple')
  @UseGuards(AppleOAuthGuard)
  @ApiOperation({ summary: 'Begin Apple sign-in (redirects to Apple)' })
  appleAuth(): void {
    /* handled by AppleOAuthGuard's redirect */
  }

  @Public()
  @Post('apple/callback')
  @UseGuards(AppleCallbackGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Apple OAuth callback (form_post)',
    description:
      'Apple POSTs the callback as application/x-www-form-urlencoded.',
  })
  async appleCallback(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body('state') stateBody: string,
  ): Promise<LoginResponseDto | { ok: true }> {
    return this.handleOAuthCallback(req, res, stateBody, 'apple');
  }

  @Post('link/:provider')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Begin linking a social provider to the current account',
    description:
      'Returns a redirect URL the frontend should navigate to. State is signed so the callback can identify the user that initiated the link.',
  })
  @ApiOkResponse({
    schema: { properties: { redirectUrl: { type: 'string' } } },
  })
  linkProvider(
    @CurrentUser() me: AuthenticatedUser,
    @Param('provider') providerRaw: string,
  ): { redirectUrl: string } {
    const provider = parseProvider(providerRaw);
    const url = this.social.buildLinkAuthorizeUrl(provider, me.id);
    return { redirectUrl: url };
  }

  @Delete('link/:provider')
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Unlink a social provider',
    description:
      'Only allowed if the user has another authentication method available.',
  })
  @ApiBadRequestResponse({ description: 'cannot_remove_last_auth_method' })
  async unlinkProvider(
    @CurrentUser() me: AuthenticatedUser,
    @Param('provider') providerRaw: string,
    @Req() req: Request,
  ): Promise<void> {
    const provider = parseProvider(providerRaw);
    await this.social.unlinkIdentity(me.id, provider, getRequestContext(req));
  }

  private async handleOAuthCallback(
    req: Request,
    res: Response,
    stateRaw: string | undefined,
    provider: AuthProvider,
  ): Promise<LoginResponseDto | { ok: true }> {
    if (!stateRaw)
      throw new BadRequestException({ code: 'missing_oauth_state' });
    const state = this.state.verifyState(stateRaw);
    const profile = req.user as NormalizedOAuthProfile | undefined;
    if (!profile || profile.provider !== provider) {
      throw new BadRequestException({ code: 'oauth_profile_missing' });
    }
    const ctx = getRequestContext(req);
    if (state.intent === 'link') {
      if (!state.linkUserId) {
        throw new BadRequestException({ code: 'invalid_oauth_state' });
      }
      await this.social.linkIdentity(state.linkUserId, profile, ctx);
      return { ok: true };
    }
    const result = await this.social.findOrCreateUser(profile, ctx);
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresInSeconds: result.expiresInSeconds,
      tokenType: result.tokenType,
      sessionId: result.sessionId,
      user: UserResponseDto.fromEntity(result.user),
    };
  }

  @Public()
  @Post('confirm-email-change')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm an email change',
    description:
      'Public endpoint — accepts the token from the email-change confirmation email. Swaps the user’s email and revokes every existing session (the user will need to log in again with the new email).',
  })
  @ApiOkResponse({ type: GenericOkResponseDto })
  @ApiBadRequestResponse({ description: 'invalid_or_expired_token' })
  async confirmEmailChange(
    @Body() dto: ConfirmEmailChangeDto,
    @Req() req: Request,
  ): Promise<GenericOkResponseDto> {
    await this.auth.confirmEmailChange({
      rawToken: dto.token,
      context: getRequestContext(req),
    });
    return { ok: true };
  }

  @Get('sessions')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'List active sessions for the current user' })
  @ApiOkResponse({ type: [SessionResponseDto] })
  async listSessions(
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<SessionResponseDto[]> {
    const sessions = await this.sessions.listActiveForUser(me.id);
    return sessions.map((s) => SessionResponseDto.fromEntity(s, me.sessionId));
  }

  @Delete('sessions/:id')
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a specific session by id' })
  async revokeSession(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.sessions.revokeOwnedById(me.id, id, 'admin');
    await this.audit.recordEvent({
      userId: me.id,
      eventType: 'session_revoke',
      ipAddress: getRequestContext(req).ipAddress,
      userAgent: getRequestContext(req).userAgent,
      metadata: { sessionId: id, byCurrentSessionId: me.sessionId },
    });
  }
}
