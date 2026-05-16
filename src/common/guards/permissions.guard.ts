import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { RbacService } from '../../modules/rbac/rbac.service';
import type { AuthenticatedUser } from '../../shared/types/auth.types';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rbac: RbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const user = req.user;
    if (!user) throw new ForbiddenException({ code: 'unauthenticated' });
    const access = await this.rbac.resolveUserAccess(user.id);
    for (const perm of required) {
      if (!access.permissions.has(perm)) {
        throw new ForbiddenException({ code: 'forbidden', missing: perm });
      }
    }
    return true;
  }
}
