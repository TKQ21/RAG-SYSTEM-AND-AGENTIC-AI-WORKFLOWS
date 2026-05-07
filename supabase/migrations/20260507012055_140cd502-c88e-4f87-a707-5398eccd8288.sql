
CREATE POLICY "Anyone can insert chat messages" ON public.chat_history FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can delete chat messages" ON public.chat_history FOR DELETE USING (true);
CREATE POLICY "Anyone can delete documents" ON public.documents FOR DELETE USING (true);
CREATE POLICY "Anyone can delete chunks" ON public.document_chunks FOR DELETE USING (true);
