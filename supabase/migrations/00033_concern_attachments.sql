-- ============================================================
-- 00033 — ATTACHMENTS ON CONCERNS
-- ============================================================
-- The concern form has always let a student pick files ("PDF, JPG, PNG"),
-- but nothing uploaded them: the picked files were dropped on submit and
-- the student was never told. This gives them somewhere to go.
--
-- Why not `student_files` (00001) and the `student-documents` bucket that
-- /api/files/upload writes to? student_files is a general document locker:
-- it has no link to a concern and its file_category CHECK has no place for
-- one, and no migration ever created the student-documents bucket. A
-- concern attachment can be evidence in a harassment or discrimination
-- complaint, so it gets its own private bucket and its own table, the same
-- shape as academic-documents (00016) and case-documents (00017).
--
--   concern-attachments/<auth.uid()>/<concern_id>/<n>-<timestamp>.<ext>
--
-- The first folder is the uploader's auth user id, which the storage
-- policies check; the second keeps one concern's files together.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'concern-attachments',
  'concern-attachments',
  FALSE,
  5242880, -- 5 MB, the limit on every bucket since 00032
  ARRAY['image/jpeg', 'image/png', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
  SET public = FALSE,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "own folder uploads concern files" ON storage.objects;
CREATE POLICY "own folder uploads concern files" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'concern-attachments'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "own or staff reads concern files" ON storage.objects;
CREATE POLICY "own or staff reads concern files" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'concern-attachments'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      -- Staff triage concerns; an attachment they cannot open is no help.
      OR public.is_staff()
    )
  );

-- Deliberately no UPDATE or DELETE policy, as with case-documents: once a
-- file is attached to a concern, staff may already have acted on it.

-- ============================================================
-- The row that ties a stored file to its concern
-- ============================================================
CREATE TABLE IF NOT EXISTS public.concern_attachments (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  concern_id  UUID NOT NULL REFERENCES public.concerns(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_path   TEXT NOT NULL UNIQUE,
  file_name   TEXT NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 200),
  mime_type   TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'application/pdf')),
  file_size   INT  NOT NULL CHECK (file_size > 0 AND file_size <= 5242880),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_concern_attachments_concern
  ON public.concern_attachments(concern_id);

ALTER TABLE public.concern_attachments ENABLE ROW LEVEL SECURITY;

-- Visible exactly when the concern is. RLS on concerns still applies inside
-- this subquery, so the student who filed it and staff see the files, and
-- nobody else does — without restating who may read a concern here.
DROP POLICY IF EXISTS "read attachments on visible concerns" ON public.concern_attachments;
CREATE POLICY "read attachments on visible concerns" ON public.concern_attachments
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.concerns c WHERE c.id = concern_id));

-- Only the student who filed the concern attaches to it, and only files in
-- their own storage folder: a row cannot be pointed at someone else's file.
DROP POLICY IF EXISTS "student attaches to own concern" ON public.concern_attachments;
CREATE POLICY "student attaches to own concern" ON public.concern_attachments
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND split_part(file_path, '/', 1) = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM public.concerns c
      WHERE c.id = concern_id
        AND c.student_id = public.current_student_id()
    )
  );

COMMENT ON TABLE public.concern_attachments IS
  'Files a student attached when filing a concern. Files live in the private concern-attachments bucket (00033); open them through /api/concerns/attachments/<id>.';

-- Verify after running:
--   SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'concern-attachments';
--   SELECT policyname FROM pg_policies WHERE tablename = 'concern_attachments';
