CREATE ROLE ecosystem_app LOGIN PASSWORD 'ecosystem_app' NOSUPERUSER NOBYPASSRLS;
CREATE TABLE documents (id text PRIMARY KEY, tenant_id text NOT NULL, deleted_at timestamptz);
INSERT INTO documents (id, tenant_id) VALUES ('a', 'A'), ('b', 'B'), ('a-fail', 'A');

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_documents ON documents TO ecosystem_app
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
GRANT SELECT, UPDATE ON documents TO ecosystem_app;

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_audit ON audit_logs FOR INSERT TO ecosystem_app
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
GRANT INSERT ON audit_logs TO ecosystem_app;

-- Deterministically fail the audit insert for one document after its mutation.
ALTER TABLE audit_logs ADD CONSTRAINT reject_fixture_audit CHECK (target_id <> 'a-fail');
