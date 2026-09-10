-- Demo administrator only. Re-running setup restores these two known rows.
INSERT INTO public.projects (id, tenant_id, name) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'Alice project'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'Bob project')
ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, name = EXCLUDED.name;
