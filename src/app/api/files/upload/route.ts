import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { logAuditEvent } from "@/lib/utils/audit";
import { isAllowedMimeType, MAX_FILE_SIZE } from "@/lib/utils/sanitize";

/**
 * File upload endpoint.
 * Validates MIME type server-side, enforces size limits,
 * and rate-limits uploads to 20/day per student.
 *
 * POST /api/files/upload
 * Body: FormData with file + file_category
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Rate limit: 20 uploads per day
    const limit = checkRateLimit({
      identifier: `upload:${user.id}`,
      maxRequests: 20,
      windowSeconds: 86400, // 24 hours
    });

    if (!limit.success) {
      return NextResponse.json(
        { error: "Upload limit reached. Max 20 files per day." },
        { status: 429 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const fileCategory = formData.get("file_category") as string;

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 10MB." },
        { status: 400 }
      );
    }

    // Validate MIME type server-side
    if (!isAllowedMimeType(file.type)) {
      return NextResponse.json(
        {
          error:
            "Invalid file type. Allowed: PDF, JPEG, PNG, DOCX.",
        },
        { status: 400 }
      );
    }

    // Get student record
    const { data: studentData } = await supabase
      .from("students")
      .select("id")
      .eq("user_id", user.id)
      .single();

    const student = studentData as { id: string } | null;

    if (!student) {
      return NextResponse.json(
        { error: "Student record not found" },
        { status: 404 }
      );
    }

    // Upload to Supabase Storage
    const fileExt = file.name.split(".").pop();
    const fileName = `${student.id}/${Date.now()}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from("student-documents")
      .upload(fileName, file, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
      return NextResponse.json(
        { error: "Failed to upload file" },
        { status: 500 }
      );
    }

    // Save file record to database
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Types will be auto-generated from Supabase
    const { data: fileRecord, error: dbError } = await (supabase as any)
      .from("student_files")
      .insert({
        student_id: student.id,
        uploaded_by: user.id,
        file_name: file.name,
        file_path: fileName,
        file_category: fileCategory || "other",
        file_size: file.size,
        mime_type: file.type,
      })
      .select()
      .single();

    if (dbError) {
      console.error("Database insert error:", dbError);
      return NextResponse.json(
        { error: "Failed to save file record" },
        { status: 500 }
      );
    }

    // Audit log
    await logAuditEvent(user.id, "file_upload", `student_files/${fileRecord.id}`, {
      file_name: file.name,
      file_size: file.size,
      category: fileCategory,
    });

    return NextResponse.json({
      success: true,
      file: fileRecord,
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
