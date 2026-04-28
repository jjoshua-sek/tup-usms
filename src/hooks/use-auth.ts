"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

/**
 * Client-side hook for accessing the current authenticated user.
 * Subscribes to auth state changes for real-time updates
 * (e.g., when the session refreshes or user signs out).
 */
export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    // Get initial user
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      setLoading(false);
    });

    // Subscribe to auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Role is stored in app_metadata (server-controlled, can't be self-modified by users).
  // user_metadata is INSECURE for roles because users can update it via supabase.auth.updateUser().
  const role = user?.app_metadata?.role || "student";
  const isStaff = role === "staff" || role === "admin";
  const isAdmin = role === "admin";

  return { user, loading, role, isStaff, isAdmin };
}
