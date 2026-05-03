DROP POLICY IF EXISTS "Anyone can insert documents" ON public.documents;
DROP POLICY IF EXISTS "Anyone can update documents" ON public.documents;
DROP POLICY IF EXISTS "Anyone can delete documents" ON public.documents;
DROP POLICY IF EXISTS "Anyone can insert chunks" ON public.document_chunks;
DROP POLICY IF EXISTS "Anyone can delete chunks" ON public.document_chunks;
DROP POLICY IF EXISTS "Anyone can insert chat messages" ON public.chat_history;
DROP POLICY IF EXISTS "Anyone can delete chat messages" ON public.chat_history;