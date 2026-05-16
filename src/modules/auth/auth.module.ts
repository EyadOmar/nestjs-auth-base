import { forwardRef, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { AuthIdentity } from './entities/auth-identity.entity';
import { AuthEvent } from './entities/auth-event.entity';
import { LoginAttempt } from './entities/login-attempt.entity';
import { Session } from './entities/session.entity';
import { VerificationToken } from './entities/verification-token.entity';
import { AuthService } from './services/auth.service';
import { AuditService } from './services/audit.service';
import { SessionService } from './services/session.service';
import { TokenService } from './services/token.service';
import { VerificationService } from './services/verification.service';
import { SocialAuthService } from './services/social-auth.service';
import { StateService } from './services/state.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { FacebookStrategy } from './strategies/facebook.strategy';
import { AppleStrategyImpl } from './strategies/apple.strategy';
import {
  AppleCallbackGuard,
  AppleOAuthGuard,
  FacebookCallbackGuard,
  FacebookOAuthGuard,
  GoogleCallbackGuard,
  GoogleOAuthGuard,
} from './guards/oauth-guards';
import { AuthController } from './auth.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AuthIdentity,
      AuthEvent,
      LoginAttempt,
      Session,
      VerificationToken,
    ]),
    PassportModule,
    JwtModule.register({}),
    forwardRef(() => UsersModule),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuditService,
    SessionService,
    TokenService,
    VerificationService,
    SocialAuthService,
    StateService,
    JwtStrategy,
    GoogleStrategy,
    FacebookStrategy,
    AppleStrategyImpl,
    GoogleOAuthGuard,
    GoogleCallbackGuard,
    FacebookOAuthGuard,
    FacebookCallbackGuard,
    AppleOAuthGuard,
    AppleCallbackGuard,
  ],
  exports: [
    AuthService,
    AuditService,
    SessionService,
    TokenService,
    VerificationService,
    SocialAuthService,
    StateService,
  ],
})
export class AuthModule {}
