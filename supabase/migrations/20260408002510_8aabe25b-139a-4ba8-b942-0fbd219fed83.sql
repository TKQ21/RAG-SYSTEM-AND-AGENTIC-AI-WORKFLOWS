CREATE TABLE IF NOT EXISTS public.chat_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  role text NOT NULL,
  message text NOT NULL,
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.chat_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert chat messages" ON public.chat_history FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Anyone can read chat messages" ON public.chat_history FOR SELECT TO public USING (true);