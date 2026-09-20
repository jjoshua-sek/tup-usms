-- ============================================================
-- 00016 — STORAGE FOR ACADEMIC DOCUMENTS
-- ============================================================
-- The ML early warning system is fed by two documents the student already
-- receives from the official TUP ERS: the Certificate of Registration and the
-- per-term rating slip (migration 00011). They need somewhere to live.
--
-- Unlike `student-photos`, this bucket is PRIVATE. A rating slip carries
-- grades — among the most sensitive records a university holds — so files are
-- reachable only through short-lived signed URLs issued to the student who
-- owns them or to OSA staff verifying them.
--
-- Path convention (enforced by the policies below):
--   academic-documents/<auth.uid()>/<school_year>-<semester>-<type>-<ts>.<ext>
-- The first folder segment is the owner's auth user id, which is what
-- `storage.foldername(name)[1]` reads.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'academic-documents',
  'academic-documents',
  FALSE,
  10485760, -- 10 MB: a phone photo of a COR, comfortably
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
  SET public = FALSE,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ---- Student: full control over their own folder ----
DROP POLICY IF EXISTS "student uploads own academic docs" ON storage.objects;
CREATE POLICY "student uploads own academic docs" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'academic-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "student reads own academic docs" ON storage.objects;
CREATE POLICY "student reads own academic docs" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'academic-documents'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      -- Staff verify what students upload; without this the verification
      -- queue would show file names it cannot open.
      OR public.is_staff()
    )
  );

DROP POLICY IF EXISTS "student replaces own academic docs" ON storage.objects;
CREATE POLICY "student replaces own academic docs" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'academic-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "student deletes own academic docs" ON storage.objects;
CREATE POLICY "student deletes own academic docs" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'academic-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

COMMENT ON TABLE public.academic_documents IS
  'Student-uploaded COR / rating slips. Files live in the private academic-documents bucket; rows here hold extraction + verification state.';
