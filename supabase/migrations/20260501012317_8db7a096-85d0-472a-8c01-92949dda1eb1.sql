
-- Drop the old function (it depends on the column type)
DROP FUNCTION IF EXISTS public.match_document_chunks(extensions.vector, double precision, integer);

-- Clear old chunks
DELETE FROM public.document_chunks;
UPDATE public.documents SET chunk_count = 0, status = 'processing';

-- Resize embedding column to 384 dims
ALTER TABLE public.document_chunks
  ALTER COLUMN embedding TYPE extensions.vector(384);

-- Recreate matching function with 384-dim
CREATE OR REPLACE FUNCTION public.match_document_chunks(
  query_embedding extensions.vector(384),
  match_threshold double precision DEFAULT 0.3,
  match_count integer DEFAULT 15
)
RETURNS TABLE(id uuid, document_name text, content text, chunk_index integer, similarity double precision)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
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
$function$;
