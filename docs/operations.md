# PostgreSQL RLS operations and CLI

[Package overview](../README.md) · [Documentation index](./README.md) · [Runnable example](../examples/quickstart/README.md)

Apply database changes through your normal reviewed migration process. The complete local example includes a database role, schema, policies, and seed; the SQL below illustrates how those pieces work.

## Enable RLS on your PostgreSQL tables

Every tenant-scoped table needs a tenant column and matching RLS policies. This SQL assumes an existing empty `users` table; adding a required column to populated data needs a separate backfill migration. The [CLI](#cli) generates schema-aware policies for your models:

```sql
-- Ensure your table has a tenant_id column
ALTER TABLE users ADD COLUMN tenant_id TEXT NOT NULL;

-- Enable RLS (FORCE ensures table owners also obey policies)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

-- Add an index for the policy column to avoid full table scans
CREATE INDEX IF NOT EXISTS tenancy_users_tenant_id_idx ON users (tenant_id);

-- Create isolation policy
CREATE POLICY tenant_isolation ON users
  USING (tenant_id = current_setting('app.current_tenant', true)::text);

-- Keep a reset transaction-local setting from matching an empty TEXT tenant.
-- AS RESTRICTIVE combines this guard with every permissive tenant policy.
CREATE POLICY tenant_context_guard_users ON users
  AS RESTRICTIVE
  USING (NULLIF(current_setting('app.current_tenant', true), '') IS NOT NULL)
  WITH CHECK (NULLIF(current_setting('app.current_tenant', true), '') IS NOT NULL);

-- The `true` parameter means missing_ok: returns NULL instead of error when unset.
-- The restrictive guard also treats PostgreSQL's reset empty string as no context.
-- At the database layer, SELECT without tenant context returns 0 rows.
-- Writes without valid context can fail an RLS WITH CHECK policy.
-- Repeat for each tenant-scoped table
```

This example uses a PostgreSQL `TEXT` tenant column. For a native `UUID`
column, keep the column side uncast so PostgreSQL can use the tenant index and
use the generated UUID predicate:

```sql
USING (
  tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
);
```

`NULLIF(..., '')` preserves fail-closed behavior after a transaction-local
custom setting is cleaned up and PostgreSQL exposes its reset value as an empty
string. For UUID it prevents an invalid reset-value cast; for TEXT the generated
restrictive policy prevents that reset value from matching or inserting an
empty tenant ID. A missing or reset setting therefore matches no row.

> **Critical:** RLS is bypassed by superusers and (without `FORCE ROW LEVEL SECURITY`) by table owners. Create a dedicated application role that does **not** own the tables:
> ```sql
> CREATE ROLE app_user LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'your_password';
> GRANT USAGE ON SCHEMA public TO app_user;
> GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO app_user;
> ```
> Use this role's connection string in your application. If you connect as a superuser, RLS policies are silently bypassed.

## Security

- **SQL Injection**: The Prisma extension uses `set_config()` with bind parameters via `$executeRaw` tagged template. This binds the setting key and tenant value used by this package. It does not make application raw SQL or dynamically constructed queries injection-safe. HTTP tenant IDs are validated by the middleware (UUID-like format by default); RPC validation is explicit during 0.x.
- **Transaction-scoped**: `set_config(key, value, TRUE)` is equivalent to `SET LOCAL` and is scoped to the database transaction. The supported PgBouncer transaction-mode matrix verifies A → B → no-context isolation on reused physical backends.
- **Custom validators**: Reuse a `TenantIdValidator` in HTTP module options and RPC interceptor options when tenant IDs are not UUIDs or require an allow-list. Format validation does not authenticate or authorize the caller or producer.

### RLS Operational Notes

- **Patch PostgreSQL**: Use a currently supported PostgreSQL minor release. CVE-2024-10976 affects row-security policies in older 17.x, 16.x, 15.x, 14.x, 13.x, and 12.x patch releases.
- **Index the tenant column**: RLS policies behave like implicit filters. Add an index on `tenant_id` (or your configured tenant column) for every tenant-scoped table. The CLI generates this index and `tenancy check` warns when it is missing.
- **Keep policies simple**: The generated policy is a direct equality check. If you replace it with subqueries or non-leakproof functions, validate query plans under realistic data volume.
- **RLS is not resource isolation**: It does not prevent noisy-neighbor CPU/IO issues, cache key leaks, or cross-tenant data in Redis/search queues. Include tenant IDs in non-database cache keys and job payloads.
- **PgBouncer/Prisma**: Use the [verified transaction-mode contract](#pgbouncer-support-contract) below and re-run it for any production-specific pooler configuration.

### PgBouncer Support Contract

The verified pooler contract covers the repository's pinned, self-hosted **PgBouncer transaction mode** configuration for pooled application queries. The matrix currently verifies PostgreSQL 16.14, PgBouncer 1.25.2, Prisma 6.19.3, and Prisma 7.10.0.

- Configure `pool_mode = transaction` and `max_prepared_statements = 200`. With the tested PgBouncer 1.25.2 configuration, do not add the legacy `pgbouncer=true` URL parameter.
- Use a direct PostgreSQL URL for Prisma CLI, migration, and test setup operations. Route application queries through the PgBouncer URL.
- Session mode is not a supported application contract. The matrix keeps a pool-size-one negative test that demonstrates backend pinning and a second client remaining queued until the first disconnects.
- Pool-size-one tests force the same physical backend through tenant A, tenant B, no-context, commit, callback rollback, database-error rollback, and high logical concurrency scenarios. The timeout lane separately verifies rollback and clean state while allowing PgBouncer or the client pool to replace the backend.
- A pool-size-two lane verifies real overlap on two backends, clean state on both, and clean replacement sessions after PgBouncer `RECONNECT`.
- `tenancyTransaction()` is the canonical path. Its timeout, isolation, custom-key, context-setup failure, and rollback contracts are exercised against both supported Prisma majors. `maxWait` is positive-tested on Prisma 7 `PrismaPg` and Prisma 6 native, with the Prisma 6 `PrismaPg` limitation fixed as a negative contract. The batch extension and deprecated transparent compatibility mode are tested separately.
- The runner fails fast unless the Prisma CLI, client, and PostgreSQL adapter all use the same exact supported version in major 6 or 7.
- Prisma Data Proxy, managed PgBouncer services, and other custom pooler settings remain outside the repository support guarantee. Deployment owners must validate the exact production mode and prepared-statement settings with equivalent isolation, rollback, reuse, and concurrency scenarios.

Reproduce the pinned local matrix with Docker:

```bash
npm run test:e2e:pgbouncer
```

CI and release workflows run this command against the pinned Prisma 6.19.3 and 7.10.0 lanes. See [`docker-compose.yml`](https://github.com/nestarc/nestjs-tenancy/blob/main/docker-compose.yml), [`scripts/test-pgbouncer-e2e.js`](https://github.com/nestarc/nestjs-tenancy/blob/main/scripts/test-pgbouncer-e2e.js), and the [PgBouncer E2E specification](https://github.com/nestarc/nestjs-tenancy/blob/main/test/e2e/pgbouncer/pgbouncer.e2e-spec.ts).

### Security Considerations

**Tenant ID is caller-supplied by default.** HTTP extractors read request data, and RPC restoration reads Kafka headers, Bull job data, or gRPC metadata. Neither source proves that the caller or producer may access the claimed tenant.

For production use, you **must** add a trust boundary — verify that the authenticated caller or producer belongs to the claimed tenant. HTTP options include:

1. Register authentication before Nest tenant middleware, using the [tested ordering](./http.md#authentication-before-tenant-resolution).
2. In `onTenantResolved`, authorize the resolved tenant against the verified principal. Header format validation and an unverified decoded JWT cannot establish membership.
3. If using `JwtClaimTenantExtractor`, verify the JWT signature, issuer, and audience before it reads the claim.

For RPC, authenticate the broker/channel or message producer and perform principal-to-tenant authorization before tenant-scoped work. Tenant ID format validation, successful context restoration, broker delivery, and PostgreSQL RLS do not perform that authorization. Without this boundary, a caller or producer that can choose the carrier value can cause work to run under another tenant.

## CLI

Scaffold RLS policies and module configuration from your Prisma schema:

Before running `init`, declare a required scalar field mapped to the physical
`tenant_id` column on every tenant-scoped model. The CLI derives the policy cast
from the Prisma field metadata, not from the interactive `tenantFormat` choice:

| Prisma tenant field | Generated policy type |
| --- | --- |
| `String`, `String @db.Text` | `TEXT` |
| `String @db.VarChar(n)`, `String @db.Char(n)` | `TEXT` |
| `String @db.Uuid` | `UUID` |

Field-level mapping is supported, for example
`tenantId String @map("tenant_id") @db.Uuid`. When auto-injection is enabled,
all non-shared models must use the same logical Prisma field name; the generated
extension setup emits that name as `tenantIdField`. Shared models are excluded
from tenant-field validation.

The CLI does not guess from value shape: `String @db.VarChar(36)` remains a
text policy. Missing, duplicate, nullable, list, ignored (`@ignore`), non-`String`, `Unsupported`,
or unsupported native tenant fields such as `Citext`, `Xml`, `Inet`, `Bit`, and
`VarBit` stop scaffolding before either output file is written. `tenantFormat`
controls inbound ID validation only; it does not select the database storage
type or policy cast.

```bash
npx @nestarc/tenancy init
```

This generates:
- `tenancy-setup.sql` — PostgreSQL RLS policies, tenant indexes, roles, and grants
- `tenancy.module-setup.ts` — NestJS module registration code

Run `tenancy-setup.sql` as a standalone migration with a client that stops on the
first SQL error. For `psql`, use:

```bash
psql -X -v ON_ERROR_STOP=1 -f tenancy-setup.sql "$DATABASE_URL"
```

`-X` ignores settings in `.psqlrc`. Do not run this script with
`ON_ERROR_ROLLBACK=on`: its per-statement savepoints can let execution continue
to the final `COMMIT` after an error. Other clients must also stop on the first
error and then issue `ROLLBACK` or close the connection. Under that execution
contract, the generated `BEGIN` / `COMMIT` makes its roles, grants, indexes, RLS
flags, and policies all-or-nothing. Do not nest the script inside a caller-owned
transaction. Its `ALTER TABLE` statements hold table locks until commit, so
schedule large production schemas in an appropriate maintenance window.

Models without `@@schema` are emitted as explicitly qualified
`"public"."Table"` targets, so `search_path` cannot redirect the generated DDL
to a shadow table. Inside a generated section, `tenancy check` requires the
intact boundary markers, transaction envelope, guarded policies, and model-bound
table/schema targets. It also flags unqualified targets; declare `@@schema` for
every non-public model. Markerless legacy SQL remains structurally accepted,
but it must still satisfy the current tenant-policy semantics, including the
restrictive non-empty context guard described below.

The same generated script is safe to reapply sequentially; concurrent applies
are not part of this guarantee. Existing policies with the generated table/name
pair are preserved instead of being dropped or rewritten, including policies
that have drifted from the generated expression. Use `tenancy doctor` against
the application role to detect applied policy drift. When replacement is
intentional, review the live policy and place an explicit `DROP POLICY` directly
after `BEGIN` in a temporary reviewed execution copy of the generated
transaction. Do not keep that state-reversing statement in the canonical
`tenancy-setup.sql`; `tenancy check` intentionally rejects it. Running the
temporary copy with the fail-fast contract makes the drop and recreation atomic;
a separate autocommitted drop can leave a policy gap if the later setup fails.

Existing `TEXT` schemas keep the same canonical
`current_setting(..., true)::text` isolation and insert predicates. Generated
SQL now adds a separate `AS RESTRICTIVE` context-guard policy so PostgreSQL's
reset empty string cannot match or insert a `tenant_id=''` row. The guard has a
new deterministic name and is added automatically on a sequential reapply;
`tenancy check` reports a missing or invalid guard in both canonical generated
and markerless legacy SQL, and `tenancy doctor` reports a missing or drifted live
guard. A markerless file may keep its legacy policy names, but its guard must be
`AS RESTRICTIVE` and use
`NULLIF(current_setting(..., true), '') IS NOT NULL` in both `USING` and
`WITH CHECK`. If a generated policy name already exists, the drift-preservation
rule still applies, so review and replace it through the transaction procedure
above. For an existing deployment, preview or regenerate with `init --dry-run`,
run `tenancy check`, apply the reviewed SQL, and finish with live `tenancy doctor`
verification.

To adopt a native UUID column, add `@db.Uuid`, preview the regenerated SQL with
`init --dry-run`, and perform any TEXT-to-UUID column/data conversion as a
separate reviewed Prisma/PostgreSQL migration; `init` never changes column types
or data. Isolation/insert policy names do not include the column type, and
sequential reapply preserves an existing same-name policy. Replace an old
text/manual policy only through the reviewed transaction procedure above, then
run `tenancy check` on the canonical file and `tenancy doctor --active` as the
application role for tenant A/B, no-context, COMMIT-cleanup, and
ROLLBACK-cleanup verification.

A non-empty invalid UUID setting intentionally fails at PostgreSQL's cast rather
than broadening visibility. Applications using UUID storage should validate
inbound IDs as UUIDs on every transport; in particular, the 0.x RPC interceptor
keeps its compatibility behavior unless an explicit validator is supplied.

Generated index and policy names retain the legacy readable form only when the
resolved schema, table, and (for indexes) tenant-column components are lowercase
ASCII letters, digits, or underscores and the complete name fits PostgreSQL's
63-byte limit. Inputs that would lose information through punctuation, Unicode,
case folding, or truncation receive a deterministic 12-hex SHA-256 suffix; the
readable prefix is shortened so the complete identifier remains at most 63
bytes. Explicit and implicit `public` schemas use the same identity.

When upgrading a setup generated for a non-canonical or overlong name, or one
that explicitly declared `@@schema("public")` and therefore used the old
`public_` name prefix, compare the live legacy objects with the newly generated
names before applying.
Do not blindly keep both policy sets: a drifted legacy permissive policy can
broaden access even when the new policy is correct. Use a reviewed transaction
to rename or explicitly replace the legacy policies and indexes, then run
`tenancy check` on the canonical file and `tenancy doctor` on every affected
table. Existing lowercase ASCII short names remain unchanged except that the
old explicit-`public_` form now shares the implicit-public identity.

Preview without writing files:

```bash
npx @nestarc/tenancy init --dry-run
```

Check if your SQL is in sync with the Prisma schema:

```bash
npx @nestarc/tenancy check
# With custom setting key:
npx @nestarc/tenancy check --db-setting-key=custom.tenant_key
```

Validates table coverage, tenant indexes, FORCE ROW LEVEL SECURITY,
isolation/insert policies, the restrictive context guard, and setting key
consistency across all policies. Exits with code 0 (in sync) or 1 (drift
detected). Markerless legacy SQL without the semantic guard returns code 1 with
a `missing or invalid context guard policy` warning.

`check` and `doctor` do not load Nest module configuration. When the canonical module key is custom, pass the same `--db-setting-key` to both commands. `init` writes that selected key to the generated SQL and the module configuration once; the generated Prisma extension inherits it from `TenancyService`.

Audit an applied RLS configuration through the same non-superuser database role used by the application:

```bash
DATABASE_URL='postgresql://app_user:...@localhost/app' \
  npx @nestarc/tenancy doctor \
  --table=public.users \
  --role=app_user
```

The catalog audit checks the current and login roles, `SUPERUSER` / `BYPASSRLS` and reachable role risks, table ownership, `ENABLE` / `FORCE` / active RLS state, tenant column and index, grants (including forbidden `TRUNCATE`), and the exact generated `USING` / `WITH CHECK` policy contract.

To audit multiple tenant tables in one bounded run, create a versioned JSON manifest. The database URL is deliberately not a manifest field:

```json
{
  "schemaVersion": 1,
  "defaults": {
    "role": "app_user",
    "dbSettingKey": "app.current_tenant",
    "tenantColumn": "tenant_id",
    "tenantA": "11111111-1111-1111-1111-111111111111",
    "tenantB": "22222222-2222-2222-2222-222222222222"
  },
  "tables": [
    { "table": "public.users" },
    { "table": "billing.invoices", "tenantColumn": "account_id" }
  ]
}
```

```bash
DATABASE_URL='postgresql://app_user:...@localhost/app' \
  npx @nestarc/tenancy doctor \
  --manifest=tenancy-doctor.json \
  --concurrency=4 \
  --timeout-ms=60000 \
  --json
```

Manifest defaults can be overridden per table. Results always follow manifest order even when tables finish out of order. A table-level connection or query error does not discard peer results; any operational error makes the aggregate exit code 2. Concurrency is limited to 1–16, and the batch timeout stops new work while allowing in-flight database cleanup to finish.

Add an opt-in, read-only behavior probe with two tenant IDs that already have rows:

```bash
DATABASE_URL='postgresql://app_user:...@localhost/app' \
  npx @nestarc/tenancy doctor \
  --table=public.users \
  --role=app_user \
  --active \
  --tenant-a=11111111-1111-1111-1111-111111111111 \
  --tenant-b=22222222-2222-2222-2222-222222222222
```

The active probe verifies no-context fail-closed behavior, tenant A/B isolation, and setting cleanup after both COMMIT and ROLLBACK. It does not write data. If either tenant has no visible fixture row, the result is inconclusive rather than a false pass. Add `--json` for machine-readable output. Exit codes are 0 (healthy), 1 (finding or inconclusive probe), and 2 (usage, connection, or query error). Prefer `DATABASE_URL` over `--url` so credentials do not enter shell history or the process list.

For a manifest, `--active` is still required explicitly on every invocation. Tenant A/B values come from manifest defaults or table overrides; the manifest alone can never enable live probes. Batch catalog and probe SQL use a per-session statement timeout, and aborts are honored between catalog queries and read-only probe transactions so an opened probe transaction is rolled back before its table result returns.
