-- ==============================================================================
-- ElajX (علاجك) — Staging Prerequisites for Isolated PostgreSQL Validation
-- File: supabase/staging/00_setup_prerequisites.sql
-- Purpose: Minimal disposable mock environment for running Supabase migrations
--          against a standalone PostgreSQL 15+ container without cloud connectivity.
-- ==============================================================================

-- 1. Create client roles expected by Supabase / PostgREST
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END $$;

-- 2. Mock auth schema and auth.users
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aud VARCHAR(255) DEFAULT 'authenticated',
  role VARCHAR(255) DEFAULT 'authenticated',
  email VARCHAR(255) UNIQUE,
  raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);

-- Mock auth helper functions (auth.uid() and auth.role())
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claim.uid', true), ''),
    nullif(current_setting('app.current_user_id', true), '')
  )::uuid;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS TEXT AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('app.current_role', true), ''),
    'authenticated'
  );
$$ LANGUAGE sql STABLE;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT SELECT ON auth.users TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;
GRANT EXECUTE ON FUNCTION auth.role() TO PUBLIC;

-- 3. Grant schema public privileges for PostgreSQL 15+ compliance
GRANT USAGE, CREATE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated, service_role;

