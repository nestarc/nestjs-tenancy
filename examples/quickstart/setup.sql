-- Run with the demo administrator after Prisma creates the projects table.
-- The application connects as this separate role, never as the table owner.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'quickstart_app') THEN
    CREATE ROLE quickstart_app LOGIN PASSWORD 'quickstart_app'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE tenancy_quickstart TO quickstart_app;
GRANT USAGE ON SCHEMA public TO quickstart_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO quickstart_app;

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_projects ON public.projects;
CREATE POLICY tenant_isolation_projects ON public.projects
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

DROP POLICY IF EXISTS tenant_insert_projects ON public.projects;
CREATE POLICY tenant_insert_projects ON public.projects
  FOR INSERT
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

-- The canonical guard requires context even when permissive policies are added.
-- Any additional permissive policies still need their own authorization review.
DROP POLICY IF EXISTS tenant_context_guard_projects ON public.projects;
CREATE POLICY tenant_context_guard_projects ON public.projects AS RESTRICTIVE
  FOR ALL
  USING (NULLIF(current_setting('app.current_tenant', true), '') IS NOT NULL)
  WITH CHECK (NULLIF(current_setting('app.current_tenant', true), '') IS NOT NULL);

COMMIT;
