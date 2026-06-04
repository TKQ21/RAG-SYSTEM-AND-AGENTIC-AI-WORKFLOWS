
-- 1. Add user_id columns
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.document_chunks ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.chat_history ADD COLUMN IF NOT EXISTS user_id uuid;

CREATE INDEX IF NOT EXISTS documents_user_id_idx ON public.documents(user_id);
CREATE INDEX IF NOT EXISTS document_chunks_user_id_idx ON public.document_chunks(user_id);
CREATE INDEX IF NOT EXISTS chat_history_user_id_idx ON public.chat_history(user_id);

-- 2. Drop old permissive policies
DROP POLICY IF EXISTS "Anyone can delete documents" ON public.documents;
DROP POLICY IF EXISTS "Anyone can read documents" ON public.documents;
DROP POLICY IF EXISTS "Anyone can delete chunks" ON public.document_chunks;
DROP POLICY IF EXISTS "Anyone can read chunks" ON public.document_chunks;
DROP POLICY IF EXISTS "Anyone can delete chat messages" ON public.chat_history;
DROP POLICY IF EXISTS "Anyone can insert chat messages" ON public.chat_history;
DROP POLICY IF EXISTS "Anyone can read chat messages" ON public.chat_history;

-- 3. Grants for authenticated role
GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_chunks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_history TO authenticated;
GRANT ALL ON public.documents TO service_role;
GRANT ALL ON public.document_chunks TO service_role;
GRANT ALL ON public.chat_history TO service_role;
REVOKE ALL ON public.documents FROM anon;
REVOKE ALL ON public.document_chunks FROM anon;
REVOKE ALL ON public.chat_history FROM anon;

-- 4. New strict policies
CREATE POLICY "Users select own documents" ON public.documents
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users insert own documents" ON public.documents
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users update own documents" ON public.documents
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users delete own documents" ON public.documents
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Users select own chunks" ON public.document_chunks
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users insert own chunks" ON public.document_chunks
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users delete own chunks" ON public.document_chunks
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Users select own chat" ON public.chat_history
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users insert own chat" ON public.chat_history
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users delete own chat" ON public.chat_history
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- 5. Update RPC to filter by user
DROP FUNCTION IF EXISTS public.match_document_chunks(extensions.vector, double precision, integer);

CREATE OR REPLACE FUNCTION public.match_document_chunks(
  query_embedding extensions.vector,
  filter_user_id uuid,
  match_threshold double precision DEFAULT 0.0,
  match_count integer DEFAULT 30
)
RETURNS TABLE(
  id uuid, document_id uuid, document_name text, content text,
  chunk_index integer, page_num integer, start_char integer, end_char integer,
  similarity double precision
)
LANGUAGE sql STABLE SET search_path TO 'public','extensions' AS $$
  SELECT
    dc.id, dc.document_id, dc.document_name, dc.content,
    dc.chunk_index, dc.page_num, dc.start_char, dc.end_char,
    1 - (dc.embedding <=> query_embedding) AS similarity
  FROM public.document_chunks dc
  WHERE dc.embedding IS NOT NULL
    AND dc.user_id = filter_user_id
    AND 1 - (dc.embedding <=> query_embedding) > match_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
$$;
