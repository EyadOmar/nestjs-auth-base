# Auth + Users + RBAC module

NestJS 11 module providing JWT auth, opaque rotated refresh tokens, social
login (Google / Facebook / Apple), email verification, password reset, magic
links, session management, and role/permission administration. PostgreSQL +
TypeORM under the hood, Resend for transactional mail, Argon2id for password
hashing.

## Layout

```
src/
├── common/
│   ├── crypto/         CryptoService (AES-256-GCM), HashService (argon2id + sha256)
│   ├── decorators/     @Public, @CurrentUser, @Roles, @Permissions
│   ├── guards/         JwtAuthGuard, RolesGuard, PermissionsGuard
│   └── http/           getRequestContext helper
├── config/             EnvConfig + validateEnv
├── database/
│   ├── data-source.ts  TypeORM CLI DataSource
│   ├── migrations/     1747000000000-InitAuthSchema.ts
│   └── seeds/          001-roles.seed.ts, 002-permissions.seed.ts, index.ts
└── modules/
    ├── users/          User + UserPhone entities, /users/me, /admin/users
    ├── auth/           token / session / verification / audit / social-auth
    ├── rbac/           Role + Permission entities, /admin/rbac
    └── mail/           MailService (Resend), four locale-aware templates
```

## Env vars

Validated via class-validator at boot — the app refuses to start with bad
config. Copy `.env.example` to `.env` and fill in:

| Var | Required | Notes |
|---|---|---|
| `NODE_ENV` | yes | `development` / `production` / `test` |
| `PORT` | yes | default `3001` |
| `DATABASE_URL` | yes | Postgres 15+ with `citext` and `pgcrypto` extensions |
| `DATABASE_SSL` | no | `true` to enable (with `rejectUnauthorized: false`) |
| `JWT_ACCESS_SECRET` | yes | min 32 chars |
| `JWT_ACCESS_TTL` | no | default `15m` |
| `JWT_REFRESH_TTL_DAYS` | no | default `30` |
| `APP_ENCRYPTION_KEY` | yes | base64-encoded 32 bytes — encrypts stored OAuth tokens |
| `APP_URL` | yes | back-end URL |
| `WEB_APP_URL` | yes | front-end URL (used in email links) |
| `GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL` | for Google | strategy disables itself if any are missing |
| `FACEBOOK_APP_ID/SECRET/CALLBACK_URL` | for Facebook | same |
| `APPLE_CLIENT_ID/TEAM_ID/KEY_ID/PRIVATE_KEY_PATH/CALLBACK_URL` | for Apple | private key must exist on disk |
| `RESEND_API_KEY` | for mail | without it, `MailService.send` throws |
| `MAIL_FROM` / `MAIL_REPLY_TO` | for mail | `MAIL_FROM` is required when mail is used |
| `REDIS_URL` | future | not consumed yet |

Generate `APP_ENCRYPTION_KEY` with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Migrations + seeds

```bash
pnpm --filter api migration:run     # apply all pending migrations
pnpm --filter api migration:revert  # roll back the last
pnpm --filter api migration:show    # status
pnpm --filter api seed              # idempotent — roles + permissions + wiring
```

`migration:run` produces the entire schema (11 tables, `citext` + `pgcrypto`
extensions, partial unique indexes). `seed` creates the four system roles
(`super_admin`, `admin`, `editor`, `user`) and the nine bootstrap permissions
listed in `database/seeds/002-permissions.seed.ts`.

After bootstrapping, your first user starts with `status='pending'` and no
roles. Promote it to admin manually (one-time) by either:

1. Running the seed, then issuing the role via the API as a separately-seeded
   super_admin — or
2. Hand-rolling the `INSERT INTO user_roles ...` row in psql.

## Adding a new OAuth provider

1. Add the env vars to `config/env.validation.ts` (as `@IsOptional()` so the
   app boots without them).
2. Install the passport strategy: `pnpm --filter api add passport-<name>`.
3. Create `modules/auth/strategies/<name>.strategy.ts` mirroring
   `google.strategy.ts`. The `validate()` callback must produce a
   `NormalizedOAuthProfile` (`provider`, `providerUserId`, `email`,
   `emailVerified`, `firstName`, `lastName`, `avatarUrl`, `accessToken`,
   `refreshToken`, `rawProfile`).
4. Add the provider to the `AuthProvider` type
   (`modules/auth/entities/auth-identity.entity.ts`).
5. Add a pair of `AuthGuard` subclasses in `modules/auth/guards/oauth-guards.ts`
   following the Google pair. The initiation guard injects state via
   `getAuthenticateOptions({ state })`.
6. Extend `SocialAuthService.buildLinkAuthorizeUrl` with the new provider's
   authorize URL.
7. Add the routes to `auth.controller.ts` and register the strategy + guards
   in `auth.module.ts`.
8. Update `database/seeds/002-permissions.seed.ts` if the new provider
   introduces new permissions (it usually shouldn't).

## Adding a new permission

1. Add a row to the `PERMISSIONS` array in
   `database/seeds/002-permissions.seed.ts`.
2. If a system role should grant it, update `WIRING` in the same file.
3. Run `pnpm --filter api seed` — the seed is idempotent; existing rows are
   updated, the requested wiring is replaced for system roles.
4. Annotate controllers with `@Permissions('<resource>.<action>')` to enforce.

The permission cache (TTL 5 min) auto-invalidates when role membership or a
role's permission list changes via the API. Direct DB edits are not picked up
until the next TTL expiry — restart the process to be safe.

## Enumeration policy

Endpoints that take an email *always* return generic success regardless of
whether the email exists in our system:

- `POST /auth/forgot-password` → 202
- `POST /auth/magic-link/request` → 202
- `POST /auth/resend-verification` → 202

`POST /auth/register` *does* return `409 email_already_registered` — accepted
trade-off; login already leaks the same information via timing.

`POST /auth/login` never distinguishes "no such user" from "wrong password"
externally — both return `401 invalid_credentials`. The
`login_attempts.failure_reason` column captures the distinction internally.

## Known limitations

- **Permission cache is per-process.** Without Redis, multi-instance deploys
  can serve stale permissions for up to 5 minutes after a change. Replace the
  in-memory `Map` in `RbacService` with Redis to fix.
- **Apple PKCE not implemented.** State JWT provides CSRF protection for all
  three providers; Apple-specific PKCE was deferred because `passport-apple`'s
  built-in support requires session middleware, and putting the verifier on
  the state JWT defeats the point. Confidential-client behavior is preserved.
- **OAuth tokens are encrypted at rest but never decrypted** — no API surface
  currently reads them. Use `CryptoService.decryptNullable` when adding one.
- **Throttler is in-memory** (Nest default). Same multi-instance caveat as
  the permission cache.

## Future work — SMS / phone-based auth

Phone numbers are stored in `user_phones` as profile data only. To enable
SMS-based auth:

1. **Migration** — add a `phone_otps` table:
   ```sql
   CREATE TABLE phone_otps (
     id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     phone_id    UUID NOT NULL REFERENCES user_phones(id) ON DELETE CASCADE,
     code_hash   VARCHAR(255) NOT NULL,
     attempts    SMALLINT NOT NULL DEFAULT 0,
     expires_at  TIMESTAMPTZ NOT NULL,
     used_at     TIMESTAMPTZ,
     created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );
   CREATE INDEX idx_phone_otps_phone ON phone_otps(phone_id) WHERE used_at IS NULL;
   ```
2. **SMS sender** — add a `SmsService` analogous to `MailService`
   (Twilio / MessageBird / etc.), wrapped so callers see only typed methods.
3. **Endpoints**:
   - `POST /users/me/phones/:id/send-otp` — send code (per-phone throttle)
   - `POST /users/me/phones/:id/verify` — set `user_phones.verified_at = NOW()`
   - `POST /auth/login/phone` — request OTP for a phone identifier
   - `POST /auth/login/phone/verify` — exchange OTP for tokens (same
     session/audit flow as `/auth/login`)
4. The existing `VerificationService`/`SessionService`/`AuditService` need
   no changes — design has kept email-specific assumptions out of the shared
   types. Just feed `'phone_otp'` as a new verification token type once the
   migration adds it to the `verification_tokens` `type` CHECK list.
