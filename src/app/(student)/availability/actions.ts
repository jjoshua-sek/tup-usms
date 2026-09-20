"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCurrentTerm } from "@/lib/access/term";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";

interface Result {
  ok?: boolean;
  error?: string;
}

const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

const blockSchema = z
  .object({
    day_of_week: z.enum(DAYS),
    start_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, {
      message: "Start time must look like 09:00.",
    }),
    end_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, {
      message: "End time must look like 10:30.",
    }),
    label: z.string().trim().max(80).optional().or(z.literal("")),
  })
  .refine((value) => value.end_time > value.start_time, {
    message: "The end time has to be after the start time.",
    path: ["end_time"],
  });

/**
 * Students record when they are in class so the OSA scheduler can find a
 * hearing slot that doesn't collide with a lecture (requirement #1).
 *
 * Blocks are stored as *busy* windows rather than free ones: a student can
 * only reliably say when they are unavailable, and treating unknown time as
 * free is what makes the intersection search in `find-slots.ts` tractable.
 */
export async function addAvailabilityBlock(formData: FormData): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You are signed out." };

  const parsed = blockSchema.safeParse({
    day_of_week: formData.get("day_of_week"),
    start_time: formData.get("start_time"),
    end_time: formData.get("end_time"),
    label: formData.get("label") ?? "",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the times you entered." };
  }

  const term = getCurrentTerm();

  const { error } = await loose(supabase)
    .from("availability_blocks")
    .insert({
      user_id: user.id,
      day_of_week: parsed.data.day_of_week,
      start_time: `${parsed.data.start_time}:00`,
      end_time: `${parsed.data.end_time}:00`,
      block_type: "busy",
      source: "manual",
      label: parsed.data.label || null,
      school_year: term.schoolYear,
      semester: term.semester,
    });

  if (error) return { error: "Could not save that block. Please try again." };

  revalidatePath("/availability");
  return { ok: true };
}

export async function deleteAvailabilityBlock(blockId: string): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You are signed out." };

  // Only manual entries are the student's to remove. Blocks imported from a
  // verified Certificate of Registration are institutional records — removing
  // one would let a student hide a class to dodge a hearing slot.
  const { error } = await loose(supabase)
    .from("availability_blocks")
    .delete()
    .eq("id", blockId)
    .eq("user_id", user.id)
    .eq("source", "manual");

  if (error) return { error: "Could not remove that block." };

  revalidatePath("/availability");
  return { ok: true };
}
