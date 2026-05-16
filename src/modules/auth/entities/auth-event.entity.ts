import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export type AuthEventType =
  | 'login'
  | 'logout'
  | 'logout_all'
  | 'register'
  | 'email_verified'
  | 'password_change'
  | 'password_reset'
  | 'email_change_requested'
  | 'email_change'
  | 'magic_link_request'
  | 'magic_link_login'
  | 'account_deleted'
  | 'phone_added'
  | 'phone_removed'
  | 'social_link'
  | 'social_unlink'
  | 'session_revoke'
  | 'role_assigned'
  | 'role_revoked'
  | 'refresh_replay_detected';

@Entity({ name: 'auth_events' })
export class AuthEvent {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'user_id' })
  user?: User | null;

  @Column({ name: 'event_type', type: 'varchar', length: 50 })
  eventType!: AuthEventType;

  @Column({ name: 'ip_address', type: 'inet', nullable: true })
  ipAddress!: string | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
