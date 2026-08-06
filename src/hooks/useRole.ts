import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * RBAC helper. On sign-in the caller's admin role is synced from the
 * admin-email allowlist (server side, verified email only), then read back.
 */
export function useRole(userId: string | null) {
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setRoles([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      await (supabase as any).rpc("sync_my_admin_role");
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
      if (cancelled) return;
      setRoles((data || []).map((r: any) => r.role as string));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  return {
    roles,
    loading,
    isAdmin: roles.includes("admin"),
    isViewer: roles.includes("viewer"),
  };
}
