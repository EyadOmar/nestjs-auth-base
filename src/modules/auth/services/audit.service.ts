import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthEvent, AuthEventType } from '../entities/auth-event.entity';
import {
  LoginAttempt,
  LoginFailureReason,
} from '../entities/login-attempt.entity';

export interface RequestContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface LoginAttemptRecord extends RequestContext {
  identifier: string;
  userId?: string | null;
  success: boolean;
  failureReason?: LoginFailureReason | null;
}

export interface AuthEventRecord extends RequestContext {
  userId?: string | null;
  eventType: AuthEventType;
  metadata?: Record<string, unknown> | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(LoginAttempt)
    private readonly attempts: Repository<LoginAttempt>,
    @InjectRepository(AuthEvent)
    private readonly events: Repository<AuthEvent>,
  ) {}

  async recordLoginAttempt(input: LoginAttemptRecord): Promise<void> {
    try {
      await this.attempts.insert({
        identifier: input.identifier,
        userId: input.userId ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        success: input.success,
        failureReason: input.failureReason ?? null,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to record login attempt: ${(err as Error).message}`,
      );
    }
  }

  async recordEvent(input: AuthEventRecord): Promise<void> {
    try {
      await this.events.save(
        this.events.create({
          userId: input.userId ?? null,
          eventType: input.eventType,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
          metadata: input.metadata ?? null,
        }),
      );
    } catch (err) {
      this.logger.warn(
        `Failed to record auth event: ${(err as Error).message}`,
      );
    }
  }

  async countRecentFailures(
    identifier: string,
    sinceMs: number,
  ): Promise<number> {
    const since = new Date(Date.now() - sinceMs);
    return this.attempts
      .createQueryBuilder('a')
      .where('a.identifier = :identifier', { identifier })
      .andWhere('a.success = false')
      .andWhere('a.created_at >= :since', { since })
      .getCount();
  }
}
