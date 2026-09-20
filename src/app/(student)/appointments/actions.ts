"use server";

import { revalidatePath } from "next/cache";

import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";

interface Result {
  ok?: boolean;
  error?: string;
}

/**
 * Student acknowledges a summons.
 *
 * This is the receipt half of requirement #1: the professor approves the date,
 * the OSA notifies the student, and the student confirms they have seen it.
 * Acknowledgement is not consent to the outcome — only proof of notice, which
 * is what due process in the student handbook turns on.
 *
 * The RLS policy from 00013 allows a student to update only their own hearing
 * rows, and the extra `status` filter keeps this from re-opening a hearing
 * that has already moved on.
 */
export async function acknowledgeHearing(hearingId: string): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You are signed out." };

  const { error } = await loose(supabase)
    .from("case_hearings")
    .update({
      status: "student_acknowledged",
      student_acknowledged_at: new Date().toISOString(),
    })
    .eq("id", hearingId)
    .eq("status", "student_notified");

  if (error) return { error: "Could not record your acknowledgement." };

  revalidatePath("/appointments");
  return { ok: true };
}
