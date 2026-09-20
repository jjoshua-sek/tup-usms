-- ============================================================
-- 00017 — STORAGE FOR CASE DOCUMENTS
-- ============================================================
-- The MINOR-offense path in the OSA flowchart ends with a written apology
-- letter. Students may type it in the portal, but a signed hard copy is still
-- the norm — so they need somewhere to put a photo or scan of it.
--
-- Private bucket, same shape as `academic-documents` (00016): the first path
-- segment is the uploader's auth user id, which is what the policies check.
--
--   case-documents/<auth.uid()>/<case_id>-<timestamp>.<ext>
--
-- Staff can read everything here because they have to review what was
-- submitted; only the uploader can write to their own folder.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'case-documents',
  'case-documents',
  FALSE,
  10485760, -- 10 MB, matching case_documents.file_size CHECK
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
  SET public = FALSE,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "own folder uploads case docs" ON storage.objects;
CREATE POLICY "own folder uploads case docs" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'case-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "own or staff reads case docs" ON storage.objects;
CREATE POLICY "own or staff reads case docs" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'case-documents'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_staff()
    )
  );

DROP POLICY IF EXISTS "own folder replaces case docs" ON storage.objects;
CREATE POLICY "own folder replaces case docs" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'case-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Deliberately no DELETE policy: an apology letter or a piece of evidence is
-- part of a disciplinary record. Removing it is an OSA decision made through
-- the service role, not something either party can do unilaterally.

COMMENT ON TABLE public.apology_letters IS
  'Written apologies closing the MINOR path. Text lives here; any signed scan lives in the private case-documents bucket (00017).';
