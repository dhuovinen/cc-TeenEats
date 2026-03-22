-- Migration 002: MVP Auth & User Management
-- Additive: alpha tables remain unchanged. New tables prefixed with their
-- module where ambiguous.

-- ─── Core identity ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email               TEXT NOT NULL,
  email_lower         TEXT NOT NULL GENERATED ALWAYS AS (lower(email)) STORED,
  password_hash       TEXT NOT NULL,
  role                TEXT NOT NULL CHECK (role IN ('driver','customer','parent','admin')),
  full_name           TEXT NOT NULL,
  email_verified      BOOLEAN NOT NULL DEFAULT FALSE,
  email_verify_token  TEXT,
  email_verify_exp    TIMESTAMPTZ,
  active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (email_lower);
CREATE INDEX IF NOT EXISTS users_role_idx ON users (role);
CREATE INDEX IF NOT EXISTS users_email_verify_token_idx ON users (email_verify_token) WHERE email_verify_token IS NOT NULL;

-- ─── Driver profiles ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS driver_profiles (
  user_id             UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  date_of_birth       DATE NOT NULL,
  state               TEXT NOT NULL,                   -- 2-letter US state
  city                TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'offline'
                        CHECK (status IN ('offline','online','busy')),
  consent_approved    BOOLEAN NOT NULL DEFAULT FALSE,
  consent_approved_at TIMESTAMPTZ,
  safety_score        NUMERIC(5,2),
  stripe_account_id   TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS driver_profiles_status_idx ON driver_profiles (status);
CREATE INDEX IF NOT EXISTS driver_profiles_state_idx ON driver_profiles (state);

-- ─── Customer profiles ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS customer_profiles (
  user_id             UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Parent profiles ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS parent_profiles (
  user_id             UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Driver ↔ Parent links (consent management) ───────────────────────────────

CREATE TABLE IF NOT EXISTS driver_parent_links (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  -- parent may not have an account yet when driver registers
  parent_email        TEXT NOT NULL,
  consent_status      TEXT NOT NULL DEFAULT 'pending'
                        CHECK (consent_status IN ('pending','approved','revoked')),
  consented_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS driver_parent_links_driver_idx ON driver_parent_links (driver_user_id);
CREATE INDEX IF NOT EXISTS driver_parent_links_parent_email_idx ON driver_parent_links (parent_email);

-- ─── Consent tokens (emailed to parent) ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS consent_tokens (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token               TEXT NOT NULL UNIQUE,
  driver_user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_email        TEXT NOT NULL,
  expires_at          TIMESTAMPTZ NOT NULL,
  used_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS consent_tokens_token_idx ON consent_tokens (token);
CREATE INDEX IF NOT EXISTS consent_tokens_driver_idx ON consent_tokens (driver_user_id);

-- ─── Admin profiles ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS admin_profiles (
  user_id             UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  permission_level    TEXT NOT NULL DEFAULT 'standard'
                        CHECK (permission_level IN ('standard','super')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Refresh tokens ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash          TEXT NOT NULL UNIQUE,   -- SHA-256 of the actual token
  expires_at          TIMESTAMPTZ NOT NULL,
  revoked_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS refresh_tokens_hash_idx ON refresh_tokens (token_hash);
