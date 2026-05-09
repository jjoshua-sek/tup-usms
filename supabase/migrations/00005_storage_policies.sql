-- ============================================================
-- Migration 00005: Storage RLS Policies for student-photos bucket
-- ============================================================
-- The student-photos bucket holds profile pictures. Each student
-- uploads to their own folder named after their auth.uid().
--
-- Policies:
-- 1. Anyone authenticated can READ photos (so they appear in
--    sidebars, headers, staff student directory, etc.)
-- 2. A user can INSERT a photo only at path "{auth.uid()}/..."
-- 3. A user can UPDATE/UPSERT only their own folder
-- 4. A user can DELETE only their own folder
-- 5. Staff/admin can read/manage all photos
--
-- This pattern ensures students can't overwrite each other's photos
-- even if they bypass the frontend.
--
-- SAFE TO RE-RUN: drops existing policies first.
-- ============================================================

-- Drop existing policies (in case migration was run before)
DROP POLICY IF EXISTS "Anyone authenticated can view photos"
  ON storage.objects;
DROP POLICY IF EXISTS "Users can upload own photos"
  ON storage.objects;
DROP POLICY IF EXISTS "Users can update own photos"
  ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own photos"
  ON storage.objects;
DROP POLICY IF EXISTS "Staff can manage all photos"
  ON storage.objects;

-- READ: anyone authenticated can view photos in student-photos bucket
CREATE POLICY "Anyone authenticated can view photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'student-photos' AND auth.role() = 'authenticated');

-- INSERT: a user can upload to a path starting with their UUID
CREATE POLICY "Users can upload own photos"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'student-photos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- UPDATE: same path-restriction logic
CREATE POLICY "Users can update own photos"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'student-photos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- DELETE: same path-restriction
CREATE POLICY "Users can delete own photos"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'student-photos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Staff/admin can manage all photos (full access)
CREATE POLICY "Staff can manage all photos"
  ON storage.objects FOR ALL
  USING (
    bucket_id = 'student-photos'
    AND public.user_role() IN ('staff', 'admin')
  );
