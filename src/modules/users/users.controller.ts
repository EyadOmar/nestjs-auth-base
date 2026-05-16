import {
  Body,
  Controller,
  Delete,
  forwardRef,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { getRequestContext } from '../../common/http/request-context';
import {
  AuthTokensResponseDto,
  GenericOkResponseDto,
} from '../auth/dto/auth-response.dto';
import { AuthService } from '../auth/services/auth.service';
import { AddPhoneDto } from './dto/add-phone.dto';
import { ChangeEmailDto } from './dto/change-email.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserPhoneResponseDto, UserResponseDto } from './dto/user-response.dto';
import { UsersService } from './users.service';
import type { AuthenticatedUser } from '../../shared/types/auth.types';

@ApiTags('users')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@Controller('users/me')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    @Inject(forwardRef(() => AuthService)) private readonly auth: AuthService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Get the current user',
    description: 'Returns the authenticated user, including phones.',
  })
  @ApiOkResponse({ type: UserResponseDto })
  async me(@CurrentUser() me: AuthenticatedUser): Promise<UserResponseDto> {
    const user = await this.users.getByIdOrThrow(me.id, { withPhones: true });
    return UserResponseDto.fromEntity(user);
  }

  @Patch()
  @ApiOperation({
    summary: 'Update profile fields',
    description:
      'Updates first name, last name, avatar URL, and/or locale. Does NOT change email or password — use the dedicated endpoints for those.',
  })
  @ApiOkResponse({ type: UserResponseDto })
  async updateProfile(
    @CurrentUser() me: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserResponseDto> {
    const user = await this.users.updateProfile(me.id, dto);
    return UserResponseDto.fromEntity(user);
  }

  @Post('phones')
  @ApiOperation({
    summary: 'Add a phone number',
    description:
      'Stores a phone in E.164 format as profile data. The phone is NOT verified — SMS verification is a future feature.',
  })
  @ApiCreatedResponse({ type: UserPhoneResponseDto })
  async addPhone(
    @CurrentUser() me: AuthenticatedUser,
    @Body() dto: AddPhoneDto,
    @Req() req: Request,
  ): Promise<UserPhoneResponseDto> {
    const phone = await this.users.addPhone(me.id, dto, getRequestContext(req));
    return UserPhoneResponseDto.fromEntity(phone);
  }

  @Delete('phones/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a phone number' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'Phone not found' })
  async removePhone(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.users.removePhone(me.id, id, getRequestContext(req));
  }

  @Post('phones/:id/primary')
  @ApiOperation({
    summary: 'Set a phone as primary',
    description:
      'Demotes the previous primary phone (if any) within a transaction.',
  })
  @ApiOkResponse({ type: UserPhoneResponseDto })
  @ApiNotFoundResponse({ description: 'Phone not found' })
  async setPrimary(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<UserPhoneResponseDto> {
    const phone = await this.users.setPrimaryPhone(me.id, id);
    return UserPhoneResponseDto.fromEntity(phone);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Change password',
    description:
      'Verifies currentPassword, replaces the password, revokes every existing session, and issues a fresh access + refresh token for the current device.',
  })
  @ApiOkResponse({ type: AuthTokensResponseDto })
  @ApiBadRequestResponse({
    description: 'password_too_common or no_password_set',
  })
  @ApiUnauthorizedResponse({ description: 'invalid_credentials' })
  async changePassword(
    @CurrentUser() me: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
  ): Promise<AuthTokensResponseDto> {
    const tokens = await this.auth.changePassword({
      userId: me.id,
      currentPassword: dto.currentPassword,
      newPassword: dto.newPassword,
      context: getRequestContext(req),
    });
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresInSeconds: tokens.expiresInSeconds,
      tokenType: tokens.tokenType,
    };
  }

  @Post('change-email')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Request an email change',
    description:
      'Sends a confirmation link to the user’s CURRENT email. The change is applied only after they click the link (POST /auth/confirm-email-change).',
  })
  @ApiOkResponse({ type: GenericOkResponseDto })
  @ApiBadRequestResponse({ description: 'email_unchanged' })
  @ApiConflictResponse({ description: 'email_already_registered' })
  async changeEmail(
    @CurrentUser() me: AuthenticatedUser,
    @Body() dto: ChangeEmailDto,
    @Req() req: Request,
  ): Promise<GenericOkResponseDto> {
    await this.auth.requestEmailChange({
      userId: me.id,
      newEmail: dto.newEmail,
      context: getRequestContext(req),
    });
    return { ok: true };
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Soft-delete your account',
    description:
      'Sets status=deleted, deleted_at=NOW(), revokes every active session with reason=account_deleted, and writes an audit event. The partial unique index on email allows the same email to register again as a new user.',
  })
  @ApiNoContentResponse()
  async deleteSelf(
    @CurrentUser() me: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<void> {
    await this.users.softDeleteSelf(me.id, getRequestContext(req));
  }
}
