-- ============================================================
-- 00032 — 5 MB upload limit on every bucket
-- ============================================================
-- Supabase's free plan holds 1 GB of files. Photos are now shrunk in the
-- browser before upload (src/lib/images/compress.ts): profile photos to
-- about 200 KB, document photos to about 1.5 MB. The app refuses anything
-- over 5 MB after that; this makes storage refuse it too, since documents
-- go straight from the browser to the bucket.
--
-- Was 10 MB on academic-documents (00016) and case-documents (00017).
-- student-photos had no limit of its own.
-- ============================================================

UPDATE storage.buckets
   SET file_size_limit = 5242880 -- 5 MB
 WHERE id IN ('academic-documents', 'case-documents', 'student-photos');
