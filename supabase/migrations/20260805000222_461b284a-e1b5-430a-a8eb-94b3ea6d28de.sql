-- Grant admin role to the oldest account (workspace owner)
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::app_role FROM auth.users ORDER BY created_at ASC LIMIT 1
ON CONFLICT (user_id, role) DO NOTHING;

CREATE OR REPLACE FUNCTION public.admin_user_overview()
RETURNS TABLE (
  user_id uuid,
  email text,
  doc_count bigint,
  chunk_count bigint,
  query_count bigint,
  last_active timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  RETURN QUERY
  SELECT u.id,
         u.email::text,
         COALESCE(d.cnt, 0),
         COALESCE(d.chunks, 0),
         COALESCE(l.cnt, 0),
         GREATEST(COALESCE(l.last_at, u.created_at), COALESCE(d.last_at, u.created_at))
  FROM auth.users u
  LEFT JOIN (
    SELECT documents.user_id AS uid, count(*) AS cnt, COALESCE(sum(documents.chunk_count),0)::bigint AS chunks, max(documents.created_at) AS last_at
    FROM public.documents GROUP BY documents.user_id
  ) d ON d.uid = u.id
  LEFT JOIN (
    SELECT search_logs.user_id AS uid, count(*) AS cnt, max(search_logs.created_at) AS last_at
    FROM public.search_logs GROUP BY search_logs.user_id
  ) l ON l.uid = u.id
  ORDER BY 6 DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_recent_queries(_limit integer DEFAULT 100)
RETURNS TABLE (
  id uuid,
  email text,
  query text,
  mode text,
  results_count integer,
  latency_ms integer,
  success boolean,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  RETURN QUERY
  SELECT s.id, u.email::text, s.query, s.mode, s.results_count, s.latency_ms, s.success, s.created_at
  FROM public.search_logs s
  LEFT JOIN auth.users u ON u.id = s.user_id
  ORDER BY s.created_at DESC
  LIMIT COALESCE(_limit, 100);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_recent_documents(_limit integer DEFAULT 100)
RETURNS TABLE (
  id uuid,
  email text,
  name text,
  status text,
  chunk_count integer,
  size integer,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  RETURN QUERY
  SELECT d.id, u.email::text, d.name, d.status, d.chunk_count, d.size, d.created_at
  FROM public.documents d
  LEFT JOIN auth.users u ON u.id = d.user_id
  ORDER BY d.created_at DESC
  LIMIT COALESCE(_limit, 100);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_user_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_recent_queries(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_recent_documents(integer) TO authenticated;