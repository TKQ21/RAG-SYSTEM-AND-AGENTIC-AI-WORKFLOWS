-- Switch embedding dimension from 384 to 768 (Gemini text-embedding-004)
DELETE FROM public.document_chunks;
DELETE FROM public.documents;

ALTER TABLE public.document_chunks DROP COLUMN embedding;
ALTER TABLE public.document_chunks ADD COLUMN embedding extensions.vector(768);

DROP FUNCTION IF EXISTS public.match_document_chunks(extensions.vector, double precision, integer);

CREATE OR REPLACE FUNCTION public.match_document_chunks(
  query_embedding extensions.vector,
  match_threshold double precision DEFAULT 0.0,
  match_count integer DEFAULT 30
)
RETURNS TABLE(
  id uuid, document_id uuid, document_name text, content text,
  chunk_index integer, page_num integer, start_char integer, end_char integer,
  similarity double precision
)
LANGUAGE sql STABLE
SET search_path TO 'public', 'extensions'
AS $$
  SELECT
    dc.id, dc.document_id, dc.document_name, dc.content,
    dc.chunk_index, dc.page_num, dc.start_char, dc.end_char,
    1 - (dc.embedding <=> query_embedding) AS similarity
  FROM public.document_chunks dc
  WHERE dc.embedding IS NOT NULL
    AND 1 - (dc.embedding <=> query_embedding) > match_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
$$;