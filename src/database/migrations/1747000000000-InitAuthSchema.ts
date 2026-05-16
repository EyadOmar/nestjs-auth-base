import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitAuthSchema1747000000000 implements MigrationInterface {
  name = 'InitAuthSchema1747000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS citext;`);

    // ============ CORE USER ============
    await queryRunner.query(`
      CREATE TABLE users (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email             CITEXT NOT NULL,
        email_verified_at TIMESTAMPTZ,
        password_hash     TEXT,
        avatar_url        TEXT,
        first_name        VARCHAR(100),
        last_name         VARCHAR(100),
        locale            VARCHAR(10) DEFAULT 'en',
        status            VARCHAR(20) NOT NULL DEFAULT 'pending',
        last_login_at     TIMESTAMPTZ,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at        TIMESTAMPTZ,
        CHECK (status IN ('pending','active','suspended','deleted'))
      );
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uk_users_email_active ON users(email) WHERE deleted_at IS NULL;`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_users_status ON users(status) WHERE deleted_at IS NULL;`,
    );

    // ============ PHONES ============
    await queryRunner.query(`
      CREATE TABLE user_phones (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        phone_e164   VARCHAR(20) NOT NULL UNIQUE,
        label        VARCHAR(20),
        is_primary   BOOLEAN NOT NULL DEFAULT FALSE,
        verified_at  TIMESTAMPTZ,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_user_phones_user ON user_phones(user_id);`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX idx_one_primary_phone ON user_phones(user_id) WHERE is_primary = TRUE;`,
    );

    // ============ OAUTH / SOCIAL ============
    await queryRunner.query(`
      CREATE TABLE auth_identities (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider         VARCHAR(30) NOT NULL,
        provider_user_id VARCHAR(255) NOT NULL,
        provider_email   CITEXT,
        access_token     TEXT,
        refresh_token    TEXT,
        token_expires_at TIMESTAMPTZ,
        scope            TEXT,
        raw_profile      JSONB,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (provider, provider_user_id),
        UNIQUE (user_id, provider)
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_auth_identities_user ON auth_identities(user_id);`,
    );

    // ============ VERIFICATION TOKENS ============
    await queryRunner.query(`
      CREATE TABLE verification_tokens (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash VARCHAR(255) NOT NULL UNIQUE,
        type       VARCHAR(30)  NOT NULL,
        metadata   JSONB,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at    TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (type IN ('email_verify','password_reset','magic_link','email_change'))
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_vt_user_type ON verification_tokens(user_id, type) WHERE used_at IS NULL;`,
    );

    // ============ SESSIONS ============
    await queryRunner.query(`
      CREATE TABLE sessions (
        id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        refresh_token_hash VARCHAR(255) NOT NULL UNIQUE,
        device_id          VARCHAR(255),
        device_name        VARCHAR(255),
        user_agent         TEXT,
        ip_address         INET,
        last_used_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at         TIMESTAMPTZ NOT NULL,
        revoked_at         TIMESTAMPTZ,
        revoked_reason     VARCHAR(50),
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_sessions_active ON sessions(user_id) WHERE revoked_at IS NULL;`,
    );

    // ============ AUDIT ============
    await queryRunner.query(`
      CREATE TABLE login_attempts (
        id             BIGSERIAL PRIMARY KEY,
        identifier     VARCHAR(255) NOT NULL,
        user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
        ip_address     INET,
        user_agent     TEXT,
        success        BOOLEAN NOT NULL,
        failure_reason VARCHAR(50),
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_attempts_identifier ON login_attempts(identifier, created_at DESC);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_attempts_ip ON login_attempts(ip_address, created_at DESC);`,
    );

    await queryRunner.query(`
      CREATE TABLE auth_events (
        id         BIGSERIAL PRIMARY KEY,
        user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
        event_type VARCHAR(50) NOT NULL,
        ip_address INET,
        user_agent TEXT,
        metadata   JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_auth_events_user ON auth_events(user_id, created_at DESC);`,
    );

    // ============ RBAC ============
    await queryRunner.query(`
      CREATE TABLE roles (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name         VARCHAR(50)  UNIQUE NOT NULL,
        display_name VARCHAR(100) NOT NULL,
        description  TEXT,
        is_system    BOOLEAN NOT NULL DEFAULT FALSE,
        priority     SMALLINT NOT NULL DEFAULT 0,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE permissions (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name        VARCHAR(100) NOT NULL,
        resource    VARCHAR(50)  NOT NULL,
        action      VARCHAR(50)  NOT NULL,
        description TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (resource, action)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE role_permissions (
        role_id       UUID NOT NULL REFERENCES roles(id)       ON DELETE CASCADE,
        permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
        granted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (role_id, permission_id)
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_role_permissions_perm ON role_permissions(permission_id);`,
    );

    await queryRunner.query(`
      CREATE TABLE user_roles (
        user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role_id     UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
        assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at  TIMESTAMPTZ,
        PRIMARY KEY (user_id, role_id)
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_user_roles_role ON user_roles(role_id);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS user_roles;`);
    await queryRunner.query(`DROP TABLE IF EXISTS role_permissions;`);
    await queryRunner.query(`DROP TABLE IF EXISTS permissions;`);
    await queryRunner.query(`DROP TABLE IF EXISTS roles;`);
    await queryRunner.query(`DROP TABLE IF EXISTS auth_events;`);
    await queryRunner.query(`DROP TABLE IF EXISTS login_attempts;`);
    await queryRunner.query(`DROP TABLE IF EXISTS sessions;`);
    await queryRunner.query(`DROP TABLE IF EXISTS verification_tokens;`);
    await queryRunner.query(`DROP TABLE IF EXISTS auth_identities;`);
    await queryRunner.query(`DROP TABLE IF EXISTS user_phones;`);
    await queryRunner.query(`DROP TABLE IF EXISTS users;`);
  }
}
