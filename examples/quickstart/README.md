# Runnable NestJS, Prisma 7, and PostgreSQL RLS example

[Package overview](../../README.md) · [HTTP authentication guide](../../docs/http.md) · [Prisma guide](../../docs/prisma.md)

This repository example runs the locally built `@nestarc/tenancy` package through its public exports. It uses the root lockfile and development dependencies: Nest Express 11, Prisma 7 with the PostgreSQL adapter, and PostgreSQL 16. See [the supported version matrix](../../docs/compatibility.md) for other combinations.

## Run

Install a supported Node.js version (22.13+ in the 22 line, or 24.x), npm, and Docker with Compose. From the repository root:

```sh
npm ci
npm run example:quickstart:setup
npm run example:quickstart:start
```

Setup builds the package, generates this example's Prisma client, checks TypeScript, starts a disposable PostgreSQL container on `127.0.0.1:5434`, creates the schema, applies RLS, and seeds Alice and Bob's projects. Start serves HTTP on `127.0.0.1:3000`. These commands are repository scripts; they are not commands provided by an installed npm package.

Read Alice's project:

```sh
curl http://127.0.0.1:3000/projects \
  -H 'Authorization: Bearer demo-alice' \
  -H 'x-tenant-id: 11111111-1111-4111-8111-111111111111'
```

The response contains `Alice project`. Use `Bearer demo-bob` with tenant `22222222-2222-4222-8222-222222222222` to read `Bob project`. Sending Alice's credential with Bob's tenant returns 403; omitting credentials returns 401. An authenticated request without the tenant header returns 403.

Create a project for Alice:

```sh
curl http://127.0.0.1:3000/projects \
  -H 'Authorization: Bearer demo-alice' \
  -H 'x-tenant-id: 11111111-1111-4111-8111-111111111111' \
  -H 'Content-Type: application/json' \
  -d '{"name":"New project"}'
```

Stop the HTTP process with Ctrl+C. Remove the local demo database when finished:

```sh
docker compose -f examples/quickstart/compose.yaml -p tenancy-quickstart down --volumes
```

## Read the application

The source files below are the executable example; the walkthrough links to them so separate code copies cannot drift.

| File | Responsibility |
| --- | --- |
| [auth.ts](./auth.ts) | Maps public demo credentials to a trusted principal, then authorizes the requested tenant against that principal's memberships |
| [app.ts](./app.ts) | Registers authentication before Nest initialization, configures tenancy, creates the private Prisma client, and defines the provider and GET/POST controller |
| [main.ts](./main.ts) | Starts the HTTP server and closes the Prisma connection on shutdown |
| [schema.prisma](./schema.prisma) | Defines the projects table, required UUID tenant field, and tenant index |
| [prisma.config.ts](./prisma.config.ts) | Supplies the schema and administrator connection for setup |
| [setup.sql](./setup.sql) | Creates a separate application role with no superuser/RLS bypass privilege, grants table access, and installs both permissive and restrictive tenant policies |
| [seed.sql](./seed.sql) | Seeds one known project for each tenant using the local administrator |
| [database.ts](./database.ts), [compose.yaml](./compose.yaml) | Keep the local administrator and application database connections separate |
| [setup runner](https://github.com/nestarc/nestjs-tenancy/blob/main/scripts/quickstart.js) | Runs the setup and start commands above |

The demo credentials and database passwords are deliberately public and work only as a local teaching fixture. Replace `demoAuthentication` with your authentication provider's credential verification and trusted membership lookup. A caller-supplied tenant header only selects a tenant; authorization decides whether the authenticated user can access it. `app.use(demoAuthentication)` runs before `app.init()`, so the principal exists before tenant extraction. Reordering Nest module imports does not establish that order.

The Prisma service exposes only scoped project operations. Its base client remains private, uses `quickstart_app`, and is never injected into controllers. Reads intentionally have no tenant `WHERE` clause so PostgreSQL RLS performs the filtering. Creates provide Prisma's required `tenant_id` from `getCurrentTenantOrThrow()`; an extra `tenant_id` in the HTTP body is ignored. Missing context throws before a model query reaches PostgreSQL, while the database policies independently deny context-free reads and cross-tenant writes for the application role.

The administrator connection is used only for schema, policy, and seed setup. The local application role and policies in this example apply to this example's projects table; adapt grants and policies for every tenant-owned table in your application.

## Verification

```sh
npm run test:docs
npm run test:docs:e2e
```

`test:docs` checks current Markdown links and anchors, builds the package, generates the example client, compiles the actual example and HTTP/API configuration snippets in strict mode, then dispatches in-process requests through the real Nest Express application. The documented bootstrap's application-owned imports are bound to this example's real module/authentication files for compilation. It verifies authentication before tenant extraction, rejection of missing credentials or unauthorized tenants, request context cleanup, body validation, and fail-closed model access. HTTP injection opens no network listener. This mode does not claim database isolation verification.

`test:docs:e2e` additionally starts its own uniquely named PostgreSQL Compose project on an available loopback port, applies the same schema/SQL/seed files, runs the built `doctor --json --active` against the application role, and runs the real Prisma path for concurrent Alice/Bob reads and HTTP creation. Direct queries as the application role verify context-free reads and cross-tenant writes. The runner removes its test database after the check, without stopping the interactive example on port 5434.

The verification source is [verify.ts](./verify.ts); the runner is [test-docs.js](https://github.com/nestarc/nestjs-tenancy/blob/main/scripts/test-docs.js). CI runs these commands against the same files linked in this walkthrough. For full package compatibility and integration coverage, see [the compatibility guide](../../docs/compatibility.md).
