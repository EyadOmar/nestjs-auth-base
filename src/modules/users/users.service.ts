import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditService, RequestContext } from '../auth/services/audit.service';
import { SessionService } from '../auth/services/session.service';
import { User, UserStatus } from './entities/user.entity';
import { UserPhone } from './entities/user-phone.entity';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { AddPhoneDto } from './dto/add-phone.dto';

export interface ListUsersOptions {
  search?: string;
  status?: UserStatus;
  page?: number;
  pageSize?: number;
  includeDeleted?: boolean;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(UserPhone) private readonly phones: Repository<UserPhone>,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(forwardRef(() => SessionService))
    private readonly sessions: SessionService,
    @Inject(forwardRef(() => AuditService))
    private readonly audit: AuditService,
  ) {}

  findById(id: string, opts?: { withPhones?: boolean }): Promise<User | null> {
    return this.users.findOne({
      where: { id },
      relations: opts?.withPhones ? { phones: true } : undefined,
    });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.users.findOne({ where: { email } });
  }

  async getByIdOrThrow(
    id: string,
    opts?: { withPhones?: boolean },
  ): Promise<User> {
    const user = await this.findById(id, opts);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateProfile(id: string, dto: UpdateProfileDto): Promise<User> {
    const user = await this.getByIdOrThrow(id);
    if (dto.firstName !== undefined) user.firstName = dto.firstName;
    if (dto.lastName !== undefined) user.lastName = dto.lastName;
    if (dto.avatarUrl !== undefined) user.avatarUrl = dto.avatarUrl;
    if (dto.locale !== undefined) user.locale = dto.locale;
    return this.users.save(user);
  }

  // ============ Phones ============

  async listPhones(userId: string): Promise<UserPhone[]> {
    return this.phones.find({
      where: { userId },
      order: { isPrimary: 'DESC', createdAt: 'ASC' },
    });
  }

  async addPhone(
    userId: string,
    dto: AddPhoneDto,
    ctx: RequestContext = {},
  ): Promise<UserPhone> {
    const phone = await this.dataSource.transaction(async (tx) => {
      const existing = await tx
        .getRepository(UserPhone)
        .findOne({ where: { phoneE164: dto.phoneE164 } });
      if (existing) {
        throw new ConflictException('phone_already_registered');
      }
      const userPhones = await tx
        .getRepository(UserPhone)
        .find({ where: { userId } });
      const isPrimary = userPhones.length === 0;
      const row = tx.getRepository(UserPhone).create({
        userId,
        phoneE164: dto.phoneE164,
        label: dto.label ?? null,
        isPrimary,
        verifiedAt: null,
      });
      return tx.getRepository(UserPhone).save(row);
    });
    await this.audit.recordEvent({
      userId,
      eventType: 'phone_added',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { phoneId: phone.id, e164: phone.phoneE164 },
    });
    return phone;
  }

  async removePhone(
    userId: string,
    phoneId: string,
    ctx: RequestContext = {},
  ): Promise<void> {
    await this.dataSource.transaction(async (tx) => {
      const phone = await tx
        .getRepository(UserPhone)
        .findOne({ where: { id: phoneId, userId } });
      if (!phone) throw new NotFoundException('Phone not found');
      await tx.getRepository(UserPhone).delete({ id: phoneId, userId });
      if (phone.isPrimary) {
        const next = await tx
          .getRepository(UserPhone)
          .findOne({ where: { userId }, order: { createdAt: 'ASC' } });
        if (next) {
          next.isPrimary = true;
          await tx.getRepository(UserPhone).save(next);
        }
      }
    });
    await this.audit.recordEvent({
      userId,
      eventType: 'phone_removed',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { phoneId },
    });
  }

  async setPrimaryPhone(userId: string, phoneId: string): Promise<UserPhone> {
    return this.dataSource.transaction(async (tx) => {
      const phone = await tx
        .getRepository(UserPhone)
        .findOne({ where: { id: phoneId, userId } });
      if (!phone) throw new NotFoundException('Phone not found');
      if (phone.isPrimary) return phone;
      // Demote any existing primary first (partial unique index requires this)
      await tx
        .getRepository(UserPhone)
        .update({ userId, isPrimary: true }, { isPrimary: false });
      phone.isPrimary = true;
      return tx.getRepository(UserPhone).save(phone);
    });
  }

  // ============ Soft-delete ============

  async softDeleteSelf(
    userId: string,
    ctx: RequestContext = {},
  ): Promise<void> {
    const user = await this.getByIdOrThrow(userId);
    await this.dataSource.transaction(async (tx) => {
      await tx
        .getRepository(User)
        .update({ id: user.id }, { status: 'deleted' });
      await tx.getRepository(User).softDelete({ id: user.id });
    });
    await this.sessions.revokeAllForUser(userId, 'account_deleted');
    await this.audit.recordEvent({
      userId,
      eventType: 'account_deleted',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  async softDeleteByAdmin(
    targetUserId: string,
    actorUserId: string,
    ctx: RequestContext = {},
  ): Promise<void> {
    const user = await this.getByIdOrThrow(targetUserId);
    await this.dataSource.transaction(async (tx) => {
      await tx
        .getRepository(User)
        .update({ id: user.id }, { status: 'deleted' });
      await tx.getRepository(User).softDelete({ id: user.id });
    });
    await this.sessions.revokeAllForUser(targetUserId, 'account_deleted');
    await this.audit.recordEvent({
      userId: targetUserId,
      eventType: 'account_deleted',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { actor: actorUserId, via: 'admin' },
    });
  }

  // ============ Admin ============

  async list(
    opts: ListUsersOptions,
  ): Promise<{ data: User[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
    const qb = this.users.createQueryBuilder('u');
    if (opts.includeDeleted) qb.withDeleted();
    if (opts.search) {
      qb.andWhere(
        '(u.email ILIKE :q OR u.first_name ILIKE :q OR u.last_name ILIKE :q)',
        {
          q: `%${opts.search}%`,
        },
      );
    }
    if (opts.status) {
      qb.andWhere('u.status = :status', { status: opts.status });
    }
    qb.orderBy('u.created_at', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);
    const [data, total] = await qb.getManyAndCount();
    return { data, total, page, pageSize };
  }

  async getAdminUser(id: string): Promise<User> {
    const user = await this.users.findOne({
      where: { id },
      withDeleted: true,
      relations: { phones: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async setStatus(id: string, status: UserStatus): Promise<User> {
    if (status === 'deleted') {
      throw new BadRequestException(
        'Use DELETE /admin/users/:id to soft-delete a user',
      );
    }
    const user = await this.getByIdOrThrow(id);
    user.status = status;
    return this.users.save(user);
  }
}
