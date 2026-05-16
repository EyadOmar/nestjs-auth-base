import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Not, Repository } from 'typeorm';
import { EnvConfig } from '../../../config/env.validation';
import { HashService } from '../../../common/crypto/hash.service';
import { RevokeReason, Session } from '../entities/session.entity';

export interface NewSessionInput {
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  deviceId?: string | null;
  deviceName?: string | null;
}

export interface IssuedSession {
  session: Session;
  refreshToken: string;
}

const REFRESH_BYTES = 64;

@Injectable()
export class SessionService {
  private readonly refreshTtlDays: number;

  constructor(
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly hash: HashService,
    config: ConfigService<EnvConfig, true>,
  ) {
    this.refreshTtlDays = config.get('JWT_REFRESH_TTL_DAYS', { infer: true });
  }

  async create(input: NewSessionInput): Promise<IssuedSession> {
    const raw = this.hash.randomTokenBase64Url(REFRESH_BYTES);
    const tokenHash = this.hash.sha256(raw);
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.refreshTtlDays * 24 * 60 * 60 * 1000,
    );
    const session = await this.sessions.save(
      this.sessions.create({
        userId: input.userId,
        refreshTokenHash: tokenHash,
        deviceId: input.deviceId ?? null,
        deviceName: input.deviceName ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        lastUsedAt: now,
        expiresAt,
        revokedAt: null,
        revokedReason: null,
      }),
    );
    return { session, refreshToken: raw };
  }

  findById(id: string): Promise<Session | null> {
    return this.sessions.findOne({ where: { id } });
  }

  findByRawRefreshToken(raw: string): Promise<Session | null> {
    return this.sessions.findOne({
      where: { refreshTokenHash: this.hash.sha256(raw) },
    });
  }

  listActiveForUser(userId: string): Promise<Session[]> {
    return this.sessions.find({
      where: { userId, revokedAt: IsNull() },
      order: { lastUsedAt: 'DESC' },
    });
  }

  async revoke(sessionId: string, reason: RevokeReason): Promise<void> {
    await this.sessions.update(
      { id: sessionId, revokedAt: IsNull() },
      { revokedAt: new Date(), revokedReason: reason },
    );
  }

  async revokeOwnedById(
    userId: string,
    sessionId: string,
    reason: RevokeReason,
  ): Promise<void> {
    const session = await this.sessions.findOne({
      where: { id: sessionId, userId },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (session.revokedAt) return;
    await this.sessions.update(
      { id: sessionId },
      { revokedAt: new Date(), revokedReason: reason },
    );
  }

  async revokeAllForUser(userId: string, reason: RevokeReason): Promise<void> {
    await this.sessions.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date(), revokedReason: reason },
    );
  }

  async revokeAllForUserExcept(
    userId: string,
    keepSessionId: string,
    reason: RevokeReason,
  ): Promise<void> {
    await this.sessions.update(
      { userId, id: Not(keepSessionId), revokedAt: IsNull() },
      { revokedAt: new Date(), revokedReason: reason },
    );
  }

  /**
   * Refresh-token rotation. Returns the new session + raw token if rotation succeeded.
   * Caller is responsible for detecting "replay" — i.e. when this returns `{ replay: true }`,
   * blow away every active session for the user.
   */
  async rotate(
    rawRefreshToken: string,
    ctx: { ipAddress?: string | null; userAgent?: string | null },
  ): Promise<
    | { kind: 'ok'; oldSession: Session; issued: IssuedSession }
    | { kind: 'invalid' }
    | { kind: 'replay'; userId: string }
  > {
    return this.dataSource.transaction(async (tx) => {
      const sessions = tx.getRepository(Session);
      const old = await sessions.findOne({
        where: { refreshTokenHash: this.hash.sha256(rawRefreshToken) },
      });
      if (!old) return { kind: 'invalid' } as const;
      if (old.revokedAt) {
        if (old.revokedReason === 'rotated') {
          return { kind: 'replay', userId: old.userId } as const;
        }
        return { kind: 'invalid' } as const;
      }
      if (old.expiresAt <= new Date()) {
        await sessions.update(
          { id: old.id },
          { revokedAt: new Date(), revokedReason: 'expired' },
        );
        return { kind: 'invalid' } as const;
      }
      const raw = this.hash.randomTokenBase64Url(REFRESH_BYTES);
      const tokenHash = this.hash.sha256(raw);
      const now = new Date();
      const expiresAt = new Date(
        now.getTime() + this.refreshTtlDays * 24 * 60 * 60 * 1000,
      );
      const newSession = await sessions.save(
        sessions.create({
          userId: old.userId,
          refreshTokenHash: tokenHash,
          deviceId: old.deviceId,
          deviceName: old.deviceName,
          ipAddress: ctx.ipAddress ?? old.ipAddress,
          userAgent: ctx.userAgent ?? old.userAgent,
          lastUsedAt: now,
          expiresAt,
          revokedAt: null,
          revokedReason: null,
        }),
      );
      await sessions.update(
        { id: old.id },
        { revokedAt: new Date(), revokedReason: 'rotated' },
      );
      return {
        kind: 'ok',
        oldSession: old,
        issued: { session: newSession, refreshToken: raw },
      } as const;
    });
  }

  async touch(sessionId: string): Promise<void> {
    await this.sessions.update({ id: sessionId }, { lastUsedAt: new Date() });
  }

  async findActive(userId: string, sessionIds: string[]): Promise<Session[]> {
    if (sessionIds.length === 0) return [];
    return this.sessions.find({
      where: { userId, id: In(sessionIds), revokedAt: IsNull() },
    });
  }
}
