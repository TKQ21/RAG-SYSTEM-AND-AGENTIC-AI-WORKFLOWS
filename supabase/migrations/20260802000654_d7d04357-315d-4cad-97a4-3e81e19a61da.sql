-- ===== Roles (app-wide RBAC) =====
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin','moderator','user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE POLICY "Users read own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- ===== Knowledge spaces (multi-domain) =====
CREATE TABLE IF NOT EXISTS public.knowledge_spaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name text NOT NULL,
  domain text NOT NULL DEFAULT 'general',
  description text,
  is_private boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_spaces TO authenticated;
GRANT ALL ON public.knowledge_spaces TO service_role;
ALTER TABLE public.knowledge_spaces ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.space_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES public.knowledge_spaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  access_level text NOT NULL DEFAULT 'viewer',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (space_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.space_members TO authenticated;
GRANT ALL ON public.space_members TO service_role;
ALTER TABLE public.space_members ENABLE ROW LEVEL SECURITY;

-- Security-definer helpers avoid recursive RLS between spaces and members
CREATE OR REPLACE FUNCTION public.is_space_owner(_space_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.knowledge_spaces s WHERE s.id = _space_id AND s.owner_id = _user_id);
$$;

CREATE OR REPLACE FUNCTION public.space_access_level(_space_id uuid, _user_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.knowledge_spaces s WHERE s.id = _space_id AND s.owner_id = _user_id) THEN 'admin'
    ELSE (SELECT m.access_level FROM public.space_members m WHERE m.space_id = _space_id AND m.user_id = _user_id)
  END;
$$;

CREATE OR REPLACE FUNCTION public.can_read_space(_space_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _space_id IS NULL
    OR public.space_access_level(_space_id, _user_id) IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.knowledge_spaces s WHERE s.id = _space_id AND s.is_private = false)
    OR public.has_role(_user_id, 'admin');
$$;

CREATE OR REPLACE FUNCTION public.can_write_space(_space_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _space_id IS NULL
    OR public.space_access_level(_space_id, _user_id) IN ('editor','admin')
    OR public.has_role(_user_id, 'admin');
$$;

CREATE POLICY "Read accessible spaces" ON public.knowledge_spaces
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR is_private = false OR public.space_access_level(id, auth.uid()) IS NOT NULL OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Create own spaces" ON public.knowledge_spaces
  FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "Owner updates space" ON public.knowledge_spaces
  FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "Owner deletes space" ON public.knowledge_spaces
  FOR DELETE TO authenticated USING (owner_id = auth.uid());

CREATE POLICY "Read space members" ON public.space_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_space_owner(space_id, auth.uid()) OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Owner adds members" ON public.space_members
  FOR INSERT TO authenticated WITH CHECK (public.is_space_owner(space_id, auth.uid()));
CREATE POLICY "Owner updates members" ON public.space_members
  FOR UPDATE TO authenticated USING (public.is_space_owner(space_id, auth.uid())) WITH CHECK (public.is_space_owner(space_id, auth.uid()));
CREATE POLICY "Owner or self removes member" ON public.space_members
  FOR DELETE TO authenticated USING (public.is_space_owner(space_id, auth.uid()) OR user_id = auth.uid());

CREATE TRIGGER update_knowledge_spaces_updated_at
  BEFORE UPDATE ON public.knowledge_spaces
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ===== Attach spaces to existing data (nullable = existing rows keep working) =====
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS space_id uuid REFERENCES public.knowledge_spaces(id) ON DELETE SET NULL;
ALTER TABLE public.document_chunks ADD COLUMN IF NOT EXISTS space_id uuid REFERENCES public.knowledge_spaces(id) ON DELETE SET NULL;
ALTER TABLE public.chat_sessions ADD COLUMN IF NOT EXISTS space_id uuid REFERENCES public.knowledge_spaces(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS documents_space_idx ON public.documents(space_id);
CREATE INDEX IF NOT EXISTS document_chunks_space_idx ON public.document_chunks(space_id);

-- Extend visibility: own rows OR rows in a space the user may read
DROP POLICY IF EXISTS "Users select own documents" ON public.documents;
CREATE POLICY "Users select own or space documents" ON public.documents
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR (space_id IS NOT NULL AND public.can_read_space(space_id, auth.uid())));

DROP POLICY IF EXISTS "Users insert own documents" ON public.documents;
CREATE POLICY "Users insert own documents" ON public.documents
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.can_write_space(space_id, auth.uid()));

DROP POLICY IF EXISTS "Users select own chunks" ON public.document_chunks;
CREATE POLICY "Users select own or space chunks" ON public.document_chunks
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR (space_id IS NOT NULL AND public.can_read_space(space_id, auth.uid())));

DROP POLICY IF EXISTS "Users insert own chunks" ON public.document_chunks;
CREATE POLICY "Users insert own chunks" ON public.document_chunks
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.can_write_space(space_id, auth.uid()));

-- ===== Space-aware semantic search (backwards compatible) =====
CREATE OR REPLACE FUNCTION public.match_document_chunks(
  query_embedding extensions.vector,
  filter_user_id uuid,
  match_threshold double precision DEFAULT 0.0,
  match_count integer DEFAULT 30,
  filter_space_id uuid DEFAULT NULL
)
RETURNS TABLE(id uuid, document_id uuid, document_name text, content text, chunk_index integer, page_num integer, start_char integer, end_char integer, similarity double precision)
LANGUAGE sql STABLE SET search_path TO 'public','extensions' AS $$
  SELECT
    dc.id, dc.document_id, dc.document_name, dc.content,
    dc.chunk_index, dc.page_num, dc.start_char, dc.end_char,
    1 - (dc.embedding <=> query_embedding) AS similarity
  FROM public.document_chunks dc
  WHERE dc.embedding IS NOT NULL
    AND (
      dc.user_id = filter_user_id
      OR (dc.space_id IS NOT NULL AND public.can_read_space(dc.space_id, filter_user_id))
    )
    AND (filter_space_id IS NULL OR dc.space_id = filter_space_id)
    AND 1 - (dc.embedding <=> query_embedding) > match_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
$$;