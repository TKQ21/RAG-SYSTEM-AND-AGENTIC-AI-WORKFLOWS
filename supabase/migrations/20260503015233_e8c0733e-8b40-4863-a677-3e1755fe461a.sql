TRUNCATE TABLE public.document_chunks, public.documents RESTART IDENTITY CASCADE;

DROP INDEX IF EXISTS public.document_chunks_embedding_idx;
DROP FUNCTION IF EXISTS public.match_document_chunks(extensions.vector, double precision, integer);
DROP FUNCTION IF EXISTS public.match_document_chunks(vector, double precision, integer);

ALTER TABLE public.document_chunks DROP COLUMN IF EXISTS embedding;
ALTER TABLE public.document_chunks ADD COLUMN embedding extensions.vector(384);

ALTER TABLE public.document_chunks ADD COLUMN IF NOT EXISTS page_num integer NOT NULL DEFAULT 1;
ALTER TABLE public.document_chunks ADD COLUMN IF NOT EXISTS start_char integer NOT NULL DEFAULT 0;
ALTER TABLE public.document_chunks ADD COLUMN IF NOT EXISTS end_char integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.match_document_chunks(
  query_embedding extensions.vector(384),
  match_threshold double precision DEFAULT 0.05,
  match_count integer DEFAULT 15
)
RETURNS TABLE(
  id uuid,
  document_id uuid,
  document_name text,
  content text,
  chunk_index integer,
  page_num integer,
  start_char integer,
  end_char integer,
  similarity double precision
)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT
    dc.id,
    dc.document_id,
    dc.document_name,
    dc.content,
    dc.chunk_index,
    dc.page_num,
    dc.start_char,
    dc.end_char,
    1 - (dc.embedding <=> query_embedding) AS similarity
  FROM public.document_chunks dc
  WHERE dc.embedding IS NOT NULL
    AND 1 - (dc.embedding <=> query_embedding) > match_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
$$;

CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx
ON public.document_chunks USING ivfflat (embedding extensions.vector_cosine_ops)
WITH (lists = 100);