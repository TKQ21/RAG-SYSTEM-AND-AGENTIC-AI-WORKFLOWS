CREATE TABLE public.search_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  space_id uuid REFERENCES public.knowledge_spaces(id) ON DELETE SET NULL,
  session_id text,
  mode text NOT NULL DEFAULT 'documents',
  query text NOT NULL,
  results_count integer NOT NULL DEFAULT 0,
  latency_ms integer NOT NULL DEFAULT 0,
  success boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, DELETE ON public.search_logs TO authenticated;
GRANT ALL ON public.search_logs TO service_role;

ALTER TABLE public.search_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users insert own search logs" ON public.search_logs
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users read own search logs" ON public.search_logs
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users delete own search logs" ON public.search_logs
  FOR DELETE TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE INDEX search_logs_user_created_idx ON public.search_logs (user_id, created_at DESC);