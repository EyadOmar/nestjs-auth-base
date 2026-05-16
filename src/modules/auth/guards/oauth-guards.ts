import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard, IAuthModuleOptions } from '@nestjs/passport';
import type { Request } from 'express';
import { StateService } from '../services/state.service';

function buildOptions(state: StateService, req: Request): IAuthModuleOptions {
  const intent =
    typeof req.query?.intent === 'string' && req.query.intent === 'link'
      ? 'link'
      : 'login';
  const linkUserId =
    intent === 'link' && typeof req.query?.linkUserId === 'string'
      ? req.query.linkUserId
      : undefined;
  return {
    state: state.signState({ intent, linkUserId }),
  };
}

@Injectable()
export class GoogleOAuthGuard extends AuthGuard('google') {
  constructor(private readonly state: StateService) {
    super();
  }
  getAuthenticateOptions(context: ExecutionContext): IAuthModuleOptions {
    return {
      ...buildOptions(this.state, context.switchToHttp().getRequest<Request>()),
      scope: ['email', 'profile'],
      prompt: 'select_account',
    };
  }
}

@Injectable()
export class GoogleCallbackGuard extends AuthGuard('google') {
  getAuthenticateOptions(): IAuthModuleOptions {
    return { session: false };
  }
}

@Injectable()
export class FacebookOAuthGuard extends AuthGuard('facebook') {
  constructor(private readonly state: StateService) {
    super();
  }
  getAuthenticateOptions(context: ExecutionContext): IAuthModuleOptions {
    return {
      ...buildOptions(this.state, context.switchToHttp().getRequest<Request>()),
      scope: ['email', 'public_profile'],
    };
  }
}

@Injectable()
export class FacebookCallbackGuard extends AuthGuard('facebook') {
  getAuthenticateOptions(): IAuthModuleOptions {
    return { session: false };
  }
}

@Injectable()
export class AppleOAuthGuard extends AuthGuard('apple') {
  constructor(private readonly state: StateService) {
    super();
  }
  getAuthenticateOptions(context: ExecutionContext): IAuthModuleOptions {
    return {
      ...buildOptions(this.state, context.switchToHttp().getRequest<Request>()),
      scope: ['name', 'email'],
    };
  }
}

@Injectable()
export class AppleCallbackGuard extends AuthGuard('apple') {
  getAuthenticateOptions(): IAuthModuleOptions {
    return { session: false };
  }
}
