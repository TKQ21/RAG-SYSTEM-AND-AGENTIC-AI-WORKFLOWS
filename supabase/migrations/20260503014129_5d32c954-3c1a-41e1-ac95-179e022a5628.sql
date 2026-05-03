-- Switch embedding to 768-dim (Gemini text-embedding-004) and reset chunks
TRUNCATE TABLE public.document_chunks;
DELETE FROM public.documents;

ALTER TABLE public.document_chunks DROP COLUMN IF EXISTS embedding;
ALTER TABLE public.document_chunks ADD COLUMN embedding extensions.vector(768);

DROP FUNCTION IF EXISTS public.match_document_chunks(extensions.vector, double precision, integer);

CREATE OR REPLACE FUNCTION public.match_document_chunks(
  query_embedding extensions.vector(768),
  match_threshold double precision DEFAULT 0.3,
  match_count integer DEFAULT 15
)
RETURNS TABLE(id uuid, document_id uuid, document_name text, content text, chunk_index integer, similarity double precision)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT
    dc.id,
    dc.document_id,
    dc.document_name,
    dc.content,
    dc.chunk_index,
    1 - (dc.embedding <=> query_embedding) AS similarity
  FROM public.document_chunks dc
  WHERE dc.embedding IS NOT NULL
    AND 1 - (dc.embedding <=> query_embedding) > match_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
$function$;

CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx
  ON public.document_chunks USING ivfflat (embedding extensions.vector_cosine_ops)
  WITH (lists = 100);