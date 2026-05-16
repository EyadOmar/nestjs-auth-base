import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { HashService } from '../../../common/crypto/hash.service';
import {
  VerificationToken,
  VerificationTokenType,
} from '../entities/verification-token.entity';

const TTL_MS: Record<VerificationTokenType, number> = {
  email_verify: 24 * 60 * 60 * 1000,
  password_reset: 60 * 60 * 1000,
  magic_link: 15 * 60 * 1000,
  email_change: 60 * 60 * 1000,
};

export interface IssuedVerificationToken {
  raw: string;
  record: VerificationToken;
}

@Injectable()
export class VerificationService {
  constructor(
    @InjectRepository(VerificationToken)
    private readonly tokens: Repository<VerificationToken>,
    private readonly hash: HashService,
  ) {}

  async issue(
    userId: string,
    type: VerificationTokenType,
    metadata?: Record<string, unknown>,
  ): Promise<IssuedVerificationToken> {
    const raw = this.hash.randomTokenHex(32);
    const tokenHash = this.hash.sha256(raw);
    const expiresAt = new Date(Date.now() + TTL_MS[type]);
    const record = await this.tokens.save(
      this.tokens.create({
        userId,
        tokenHash,
        type,
        metadata: metadata ?? null,
        expiresAt,
        usedAt: null,
      }),
    );
    return { raw, record };
  }

  async consume(
    rawToken: string,
    type: VerificationTokenType,
  ): Promise<VerificationToken | null> {
    const tokenHash = this.hash.sha256(rawToken);
    const record = await this.tokens.findOne({
      where: {
        tokenHash,
        type,
        usedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
    });
    if (!record) return null;
    const now = new Date();
    record.usedAt = now;
    await this.tokens.save(record);
    // Invalidate all other unused tokens of the same type for this user.
    await this.tokens
      .createQueryBuilder()
      .update(VerificationToken)
      .set({ usedAt: now })
      .where('user_id = :userId', { userId: record.userId })
      .andWhere('type = :type', { type })
      .andWhere('id != :id', { id: record.id })
      .andWhere('used_at IS NULL')
      .execute();
    return record;
  }

  /** Used by the magic-link request flow to silently no-op when there are too many unused tokens already. */
  async countUnused(
    userId: string,
    type: VerificationTokenType,
  ): Promise<number> {
    return this.tokens.count({
      where: {
        userId,
        type,
        usedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
    });
  }
}
