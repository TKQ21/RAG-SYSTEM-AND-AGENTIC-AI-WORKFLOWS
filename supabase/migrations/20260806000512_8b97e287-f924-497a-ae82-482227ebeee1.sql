CREATE TABLE IF NOT EXISTS public.admin_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

GRANT SELECT ON public.admin_emails TO authenticated;
GRANT ALL ON public.admin_emails TO service_role;

ALTER TABLE public.admin_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read admin emails" ON public.admin_emails
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Bootstrap: seed the current oldest account / existing admins into the list
INSERT INTO public.admin_emails (email)
SELECT DISTINCT lower(u.email)
FROM auth.users u
JOIN public.user_roles r ON r.user_id = u.id AND r.role = 'admin'::app_role
WHERE u.email IS NOT NULL
ON CONFLICT (email) DO NOTHING;

-- Syncs the caller's admin role from the admin_emails allowlist (verified email only)
CREATE OR REPLACE FUNCTION public.sync_my_admin_role()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _email text;
  _confirmed timestamptz;
  _allowed boolean;
BEGIN
  SELECT lower(u.email), u.email_confirmed_at INTO _email, _confirmed
  FROM auth.users u WHERE u.id = auth.uid();
  IF _email IS NULL THEN RETURN false; END IF;

  SELECT EXISTS (SELECT 1 FROM public.admin_emails a WHERE a.email = _email) INTO _allowed;

  IF _allowed AND _confirmed IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (auth.uid(), 'admin'::app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
    RETURN true;
  END IF;

  IF NOT _allowed THEN
    DELETE FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'::app_role;
  END IF;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_admin_emails()
RETURNS TABLE(email text, has_account boolean, created_at timestamptz)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  RETURN QUERY
  SELECT a.email, EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = a.email), a.created_at
  FROM public.admin_emails a
  ORDER BY a.created_at ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_add_admin_email(_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _norm text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  _norm := lower(trim(_email));
  IF _norm = '' OR _norm NOT LIKE '%@%.%' THEN
    RAISE EXCEPTION 'invalid email';
  END IF;
  INSERT INTO public.admin_emails (email, created_by) VALUES (_norm, auth.uid())
  ON CONFLICT (email) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  SELECT u.id, 'admin'::app_role FROM auth.users u
  WHERE lower(u.email) = _norm AND u.email_confirmed_at IS NOT NULL
  ON CONFLICT (user_id, role) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_remove_admin_email(_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _norm text; _remaining int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  _norm := lower(trim(_email));
  SELECT count(*) INTO _remaining FROM public.admin_emails WHERE email <> _norm;
  IF _remaining = 0 THEN
    RAISE EXCEPTION 'at least one admin email is required';
  END IF;
  DELETE FROM public.admin_emails WHERE email = _norm;
  DELETE FROM public.user_roles r
  USING auth.users u
  WHERE r.user_id = u.id AND r.role = 'admin'::app_role AND lower(u.email) = _norm;
END;
$$;

-- Admin view of every space (regardless of membership) for the dashboard
CREATE OR REPLACE FUNCTION public.admin_all_spaces()
RETURNS TABLE(id uuid, name text, domain text, description text, is_private boolean, owner_id uuid, created_at timestamptz, doc_count bigint, chunk_count bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  RETURN QUERY
  SELECT s.id, s.name, s.domain, s.description, s.is_private, s.owner_id, s.created_at,
         COALESCE(d.cnt, 0), COALESCE(d.chunks, 0)
  FROM public.knowledge_spaces s
  LEFT JOIN (
    SELECT documents.space_id AS sid, count(*) AS cnt, COALESCE(sum(documents.chunk_count),0)::bigint AS chunks
    FROM public.documents GROUP BY documents.space_id
  ) d ON d.sid = s.id
  ORDER BY s.created_at ASC;
END;
$$;