CREATE INDEX IF NOT EXISTS document_chunks_embedding_hnsw_idx
ON public.document_chunks
USING hnsw (embedding extensions.vector_cosine_ops);