import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { AccessLevel } from "@/lib/spaces";

export interface KnowledgeSpace {
  id: string;
  name: string;
  domain: string;
  description: string | null;
  is_private: boolean;
  owner_id: string;
  created_at: string;
}

export interface SpaceMember {
  id: string;
  space_id: string;
  user_id: string;
  access_level: string;
}

const activeKey = (userId: string | null) => (userId ? `rag_active_space_${userId}` : "rag_active_space");

export function useSpaces(userId: string | null) {
  const [spaces, setSpaces] = useState<KnowledgeSpace[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSpaceId, setActiveSpaceIdState] = useState<string | null>(() =>
    typeof window === "undefined" ? null : localStorage.getItem(activeKey(userId)),
  );

  const refresh = useCallback(async () => {
    if (!userId) {
      setSpaces([]);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("knowledge_spaces")
      .select("id,name,domain,description,is_private,owner_id,created_at")
      .order("created_at", { ascending: true });
    if (error) console.error("load spaces failed", error);
    setSpaces((data || []) as KnowledgeSpace[]);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    setActiveSpaceIdState(localStorage.getItem(activeKey(userId)));
    refresh();
  }, [userId, refresh]);

  // Drop a stale selection if the space was deleted or access was revoked.
  useEffect(() => {
    if (!loading && activeSpaceId && spaces.length >= 0 && !spaces.some((s) => s.id === activeSpaceId)) {
      localStorage.removeItem(activeKey(userId));
      setActiveSpaceIdState(null);
    }
  }, [loading, spaces, activeSpaceId, userId]);

  const setActiveSpaceId = useCallback(
    (id: string | null) => {
      if (id) localStorage.setItem(activeKey(userId), id);
      else localStorage.removeItem(activeKey(userId));
      setActiveSpaceIdState(id);
    },
    [userId],
  );

  const createSpace = useCallback(
    async (input: { name: string; domain: string; description?: string; isPrivate: boolean }) => {
      if (!userId) throw new Error("Not signed in");
      const { data, error } = await supabase
        .from("knowledge_spaces")
        .insert({
          owner_id: userId,
          name: input.name,
          domain: input.domain,
          description: input.description || null,
          is_private: input.isPrivate,
        })
        .select("id,name,domain,description,is_private,owner_id,created_at")
        .single();
      if (error) throw new Error(error.message);
      setSpaces((prev) => [...prev, data as KnowledgeSpace]);
      return data as KnowledgeSpace;
    },
    [userId],
  );

  const updateSpace = useCallback(async (id: string, patch: Partial<Pick<KnowledgeSpace, "name" | "domain" | "description" | "is_private">>) => {
    const { error } = await supabase.from("knowledge_spaces").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    setSpaces((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } as KnowledgeSpace : s)));
  }, []);

  const deleteSpace = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("knowledge_spaces").delete().eq("id", id);
      if (error) throw new Error(error.message);
      setSpaces((prev) => prev.filter((s) => s.id !== id));
      if (activeSpaceId === id) setActiveSpaceId(null);
    },
    [activeSpaceId, setActiveSpaceId],
  );

  return { spaces, loading, activeSpaceId, setActiveSpaceId, createSpace, updateSpace, deleteSpace, refresh };
}

export async function listMembers(spaceId: string): Promise<SpaceMember[]> {
  const { data, error } = await supabase
    .from("space_members")
    .select("id,space_id,user_id,access_level")
    .eq("space_id", spaceId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []) as SpaceMember[];
}

export async function addMember(spaceId: string, memberUserId: string, level: AccessLevel) {
  const { error } = await supabase
    .from("space_members")
    .upsert({ space_id: spaceId, user_id: memberUserId, access_level: level }, { onConflict: "space_id,user_id" });
  if (error) throw new Error(error.message);
}

export async function removeMember(memberRowId: string) {
  const { error } = await supabase.from("space_members").delete().eq("id", memberRowId);
  if (error) throw new Error(error.message);
}

/** App-wide role-based access control: reads the caller's roles (admin / moderator / user). */
export async function myRoles(userId: string): Promise<string[]> {
  const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if (error) return [];
  return (data || []).map((r: any) => r.role as string);
}
