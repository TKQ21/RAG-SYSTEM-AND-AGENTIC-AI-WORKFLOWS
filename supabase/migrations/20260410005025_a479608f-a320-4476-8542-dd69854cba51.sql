
-- Update embedding column to 768 dimensions for Gemini text-embedding-004
ALTER TABLE public.document_chunks DROP COLUMN IF EXISTS embedding;
ALTER TABLE public.document_chunks ADD COLUMN embedding vector(768);

-- Recreate match function for 768-dim vectors
CREATE OR REPLACE FUNCTION public.match_document_chunks(
  query_embedding vector(768),
  match_threshold double precision DEFAULT 0.3,
  match_count integer DEFAULT 15
)
RETURNS TABLE(
  id uuid,
  document_name text,
  content text,
  chunk_index integer,
  similarity double precision
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $$
  SELECT
    dc.id,
    dc.document_name,
    dc.content,
    dc.chunk_index,
    1 - (dc.embedding <=> query_embedding) AS similarity
  FROM public.document_chunks dc
  WHERE 1 - (dc.embedding <=> query_embedding) > match_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Allow deleting chunks for re-indexing
CREATE POLICY "Anyone can delete chunks"
ON public.document_chunks
FOR DELETE
USING (true);

-- Allow deleting documents
CREATE POLICY "Anyone can delete documents"
ON public.documents
FOR DELETE
USING (true);

-- Clear all data for re-indexing with new embeddings
TRUNCATE public.chat_history;
TRUNCATE public.document_chunks;
TRUNCATE public.documents CASCADE;
