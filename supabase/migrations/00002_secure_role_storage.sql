-- ============================================================
-- Migration 00002: Move role from user_metadata to app_metadata
-- ============================================================
-- BACKGROUND:
-- The original schema read role from raw_user_meta_data, which can
-- be self-modified by any authenticated user via the Supabase JS SDK
-- (`supabase.auth.updateUser({ data: { role: 'admin' } })`).
-- This is a serious privilege-escalation risk.
--
-- raw_app_meta_data is server-controlled — only the service_role key
-- can write to it. This is the correct place for roles.
--
-- THIS MIGRATION:
-- 1. Updates public.user_role() to read from app_metadata
-- 2. Copies any existing role from user_metadata → app_metadata for users
-- 3. Removes role from user_metadata (so it can't be a fallback path)
--
-- SAFE TO RE-RUN: idempotent.
-- ============================================================

-- 1. Update the user_role() function
CREATE OR REPLACE FUNCTION public.user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'role'),
    (auth.jwt() ->> 'role'),
    'student'
  );
$$;

GRANT EXECUTE ON FUNCTION public.user_role() TO authenticated, anon;

-- 2. Migrate existing users — copy any user_metadata.role into app_metadata.role
UPDATE auth.users
SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) ||
  jsonb_build_object('role', raw_user_meta_data->>'role')
WHERE raw_user_meta_data ? 'role'
  AND (raw_app_meta_data->>'role' IS NULL OR raw_app_meta_data->>'role' = '');

-- 3. Strip role from user_metadata so it's no longer present (defense in depth)
UPDATE auth.users
SET raw_user_meta_data = raw_user_meta_data - 'role'
WHERE raw_user_meta_data ? 'role';

-- 4. Verify: list all users and their app_metadata role for confirmation
-- (You can run this manually after migration to inspect:)
-- SELECT id, email, raw_user_meta_data, raw_app_meta_data FROM auth.users;
