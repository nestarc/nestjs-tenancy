# @nestarc/tenancy — NestJS multi-tenancy with PostgreSQL RLS and Prisma

[![npm version](https://img.shields.io/npm/v/@nestarc/tenancy.svg)](https://www.npmjs.com/package/@nestarc/tenancy)
[![npm downloads](https://img.shields.io/npm/dm/@nestarc/tenancy.svg)](https://www.npmjs.com/package/@nestarc/tenancy)
[![CI](https://github.com/nestarc/nestjs-tenancy/actions/workflows/ci.yml/badge.svg)](https://github.com/nestarc/nestjs-tenancy/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Docs](https://img.shields.io/badge/docs-nestarc.dev-blue.svg)](https://nestarc.dev/packages/tenancy/)

A NestJS module that carries an authorized tenant ID through AsyncLocalStorage and sets PostgreSQL transaction-local context for Prisma model queries. PostgreSQL Row Level Security (RLS) policies then enforce which tenant's rows the database role may read or write.

[Quick Start](#quick-start) · [Existing app setup](#add-to-an-existing-app) · [Usage reference](#usage-reference) · [Compatibility](https://nestarc.dev/packages/tenancy/migration) · [AI agent guide](https://nestarc.dev/packages/tenancy/agent-guide) · [Official docs](https://nestarc.dev/packages/tenancy/)

## Changes in 0.16.5

This patch updates the CLI setup example and integration guidance. The upgrade from 0.16.4 requires no configuration change, database migration, or cache-key rotation.

- **JWT authentication.** Register authentication middleware with `app.use()` before `app.init()` or `app.listen()`. It must verify the same token the tenant extractor reads. Check the authenticated user's membership in the selected tenant before granting access. [Authentication and cookie examples](https://nestarc.dev/packages/tenancy/extractors)
- **Prisma transaction wrappers.** When another component opens the transaction, pass it `tenancyTransactionCallback()`. Its transaction client must return the row count from `$executeRaw`. The tenant binding must report exactly one row before your callback runs. [Audit transaction example](#tenant-scoping-an-audit-transaction)
- **User-specific responses.** Members of the same tenant share the default cache entry for a route. Skip caching for personalized responses, or include the verified user and any permissions that affect the response in the route's cache key. [Cache guide](https://nestarc.dev/packages/tenancy/caching)

## Changes in 0.16.4

Use `tenancyTransactionCallback()` when another component opens the Prisma
transaction. It sets the authorized tenant on the owner's connection before
your callback runs. The [audit transaction example](#tenant-scoping-an-audit-transaction)
shows how to migrate soft-delete and restore operations from transparent
transaction detection while keeping the audit records atomic.

<a id="prerequisites"></a>
<a id="support-and-compatibility"></a>

## Requirements

| Dependency | 0.16.5 requirement |
| --- | --- |
| Node.js | `^22.23.4 \|\| ^24.22.1` |
| NestJS | 10 or 11 |
| Prisma | 6 or 7; the example uses Prisma 7 with `@prisma/adapter-pg` |
| Database | PostgreSQL with RLS enabled; use a supported, patched release |

[Supported releases and migration steps](https://nestarc.dev/packages/tenancy/migration) are documented separately; the [CI workflow](https://github.com/nestarc/nestjs-tenancy/blob/main/.github/workflows/ci.yml) defines the exact verification lanes. Security fixes cover the latest published minor line; see [SECURITY.md](./SECURITY.md).

The Node.js minimum is a **0.16.2 security change**.
Published `0.16.1` retains its original engine metadata, but applications using it should also
upgrade their Node runtime and HTTP parser dependencies. See the
[runtime and parser security guidance](https://nestarc.dev/packages/tenancy/migration#patch-the-runtime-and-http-parsers).

## Quick Start

Run the [complete NestJS + Prisma example](./examples/quickstart/README.md). It includes a Prisma schema, dedicated application database role, RLS SQL, two seeded tenants, authentication middleware, membership authorization, Prisma provider, and GET/POST controllers.

The commands below run the example from the repository's default branch and require Node.js and Docker.
To reproduce the example for an installed package, run `npm ls @nestarc/tenancy` in your app
and clone the matching Git tag (for example, add `--branch v0.16.5` to `git clone` for version 0.16.5).

If you use nvm, run `nvm install` and `nvm use` after entering the checkout and
before `npm ci`; `.nvmrc` selects Node.js 24.22.1. Check `node --version` in the
shell that starts the application. Repository installs enforce the supported
engine range through `.npmrc`.

```bash
git clone https://github.com/nestarc/nestjs-tenancy.git
cd nestjs-tenancy
npm ci
npm run example:quickstart:setup
npm run example:quickstart:start
```

In another terminal:

```bash
curl http://localhost:3000/projects \
  -H 'Authorization: Bearer demo-alice' \
  -H 'X-Tenant-Id: 11111111-1111-4111-8111-111111111111'
```

The response contains Alice's seeded project. Alice's token with Bob's tenant ID (`22222222-2222-4222-8222-222222222222`) returns **403**. A missing or invalid demo credential returns **401**. See the example for write requests, reset/cleanup commands, and expected responses.

**A tenant header is a claim, not proof of access.** The demo tokens are local fixtures. For production, replace them with your authentication provider and verify that the authenticated principal may access the resolved tenant. Register authentication with `app.use(...)` before Nest initialization so `onTenantResolved` receives the verified principal; importing an auth module first does not ensure that order. [Authentication and adapter guide](https://nestarc.dev/packages/tenancy/extractors#authentication-before-tenant-extraction)

Verify the example and documentation:

```bash
npm run test:docs
npm run test:docs:e2e
```

The first command checks documentation links, types, and HTTP contracts; the second verifies tenant isolation against the example's disposable PostgreSQL database. See the [example verification notes](./examples/quickstart/README.md#verification) for the exact checks and prerequisites.

<a id="installation"></a>

## Add to an existing app

If your NestJS app already uses a supported Prisma 6 or 7 client with PostgreSQL, add tenancy and check the versions resolved in your app:

```bash
npm install @nestarc/tenancy
npm ls @nestarc/tenancy @nestjs/core @prisma/client prisma
```

For a NestJS app adopting Prisma for the first time, install tenancy together with the Prisma 7.10.1 versions used by the runnable example:

```bash
npm install --save-exact @nestarc/tenancy @prisma/client@7.10.1 @prisma/adapter-pg@7.10.1
npm install --save-dev --save-exact prisma@7.10.1
npm install pg dotenv
```

1. Add a required tenant column to each tenant-scoped model. Generate and review database roles, grants, indexes, and RLS policies with [`npx @nestarc/tenancy init`](https://nestarc.dev/packages/tenancy/cli). Use a non-owner application role without `SUPERUSER` or `BYPASSRLS` privileges.
2. Register verified authentication before Nest initialization. Register `TenancyModule.forRoot({ tenantExtractor: 'X-Tenant-Id', onTenantResolved: ... })`, with a hook that checks the principal's tenant membership. HTTP identifiers use UUID-like validation by default; [slug identifiers require a validator](https://nestarc.dev/packages/tenancy/extractors#path-parameter).
3. Apply `createPrismaTenancyExtension(tenancyService)` to the Prisma client and expose that extended client through your application provider. Keep the raw client private. See [Prisma configuration](https://nestarc.dev/packages/tenancy/installation).
4. Query through the extended client. For multiple operations in one interactive transaction, use [`tenancyTransaction()`](https://nestarc.dev/packages/tenancy/installation#interactive-transactions) and only its callback client. Write required tenant fields explicitly there.
5. Run [`check` and `doctor`](https://nestarc.dev/packages/tenancy/cli) with the same setting key and runtime database role, then test tenant A/B and missing-context access.

### Tenant-scoping an audit transaction

Pass `tenancyTransactionCallback()` directly to
`withAuditTransaction()` when `@nestarc/audit-log` owns the transaction. Build
a dedicated client from the same base Prisma client with the audit extension
first and the soft-delete extension second. Keep the per-query tenancy extension
on the separate client used for ordinary queries.

```ts
import { tenancyTransactionCallback } from '@nestarc/tenancy';
import { createAuditExtension, type AuditTransactionMethods } from '@nestarc/audit-log';
import { createPrismaSoftDeleteExtension } from '@nestarc/soft-delete';
import { Prisma } from './generated/prisma/client';

const trackedModels = ['Invoice'];
const client = basePrisma
  .$extends(createAuditExtension({
    trackedModels, consistency: 'atomic-required', prismaModule: { Prisma },
    tenantRequired: true, tenantResolver: () => tenancy.getCurrentTenantOrThrow(),
  }))
  .$extends(createPrismaSoftDeleteExtension({
    softDeleteModels: trackedModels, auditLifecycle: 'atomic-required',
  }));

// The soft-delete extension preserves the audit method at runtime. Its
// published declarations do not carry that method through the second $extends.
const lifecycle = client as unknown as Pick<
  AuditTransactionMethods<Prisma.TransactionClient>, 'withAuditTransaction'
>;

// Inside the authenticated request's authorized tenant context.
await lifecycle.withAuditTransaction(tenancyTransactionCallback(
  tenancy,
  async (tx: Prisma.TransactionClient) => tx.invoice.delete({ where: { id: invoiceId } }),
));
```

Use the transaction owner's callback client for all database work. The wrapper sets
the transaction-local RLS key before invoking your callback and rejects a missing
tenant or a setting already bound to another tenant. Keep one authorized tenant
throughout the transaction. Supply tenant fields explicitly for inserts. The
transaction owner controls commit, rollback and transaction options.

If the owner wraps the Prisma transaction client, forward the numeric row count
from `$executeRaw`. The binding statement must report one row for
`tenancyTransactionCallback()` to run the business callback.

The example assumes an `Invoice` model with a soft-delete field, an installed
audit table, and RLS policies enforced for the application role. Configure
`databaseMapping` on the audit extension for mapped models or columns.
For tenancy-owned transactions continue to use `tenancyTransaction()`.

Run `npm run test:e2e:audit-lifecycle` with Docker to exercise the packaged
candidate with `audit-log@0.7.0` and `soft-delete@0.7.5` against PostgreSQL.

## How it works

```text
Authenticated HTTP request + tenant claim
  → TenantMiddleware extracts and validates the tenant ID
    → AsyncLocalStorage establishes the tenant context
      → onTenantResolved authorizes it against the verified principal
        → TenancyGuard requires context for protected HTTP routes
          → Extended Prisma model query
            → transaction-local set_config() + query on the same transaction
              → PostgreSQL RLS evaluates the configured policies
```

<a id="performance"></a>

AsyncLocalStorage avoids Nest's `REQUEST`-scoped providers. The extension adds transaction/context-setting work; see [benchmark methodology and reproducible evidence](./benchmarks/README.md) for measuring it in your environment.

<a id="features"></a>
<a id="api"></a>

## Usage reference

Guides live on the official site. Check each generated API reference's source release against the package version installed in your application.

| Task | Guide |
| --- | --- |
| <a id="tenant-extractors"></a><a id="lifecycle-hooks"></a><a id="tenant-id-forgery-prevention"></a>Header, subdomain, JWT, path, or fallback extraction; authentication; hooks | [HTTP configuration](https://nestarc.dev/packages/tenancy/extractors) |
| <a id="extension-options"></a><a id="interactive-transactions"></a><a id="programmatic-bypass"></a><a id="fail-closed-mode"></a>Model extension options, tenant injection, transactions, shared models, administration | [Prisma and transactions](https://nestarc.dev/packages/tenancy/installation) |
| <a id="tenancymodule"></a><a id="tenancyservice"></a><a id="currenttenant-decorator"></a><a id="bypasstenancy-decorator"></a><a id="error-responses"></a><a id="error-hierarchy"></a>`TenancyModule`, `TenancyService`, decorators, errors | [Core API reference](https://nestarc.dev/api/tenancy/) |
| <a id="testing-utilities"></a><a id="event-system"></a><a id="opentelemetry-integration"></a><a id="microservice-propagation"></a><a id="inbound-context-restoration-interceptor"></a><a id="non-http-missing-context-diagnostics"></a><a id="tenant-aware-caching"></a>Testing helpers, events, OpenTelemetry, HTTP/RPC propagation, caching | [Testing, events, and telemetry](https://nestarc.dev/packages/tenancy/testing); [RPC](https://nestarc.dev/packages/tenancy/microservice); [caching](https://nestarc.dev/packages/tenancy/caching) |
| <a id="cli"></a><a id="pgbouncer-support-contract"></a><a id="rls-operational-notes"></a>SQL policies, application role, schema migration, PgBouncer, CLI diagnostics | [Database operations](https://nestarc.dev/packages/tenancy/cli) |
| Deploying the security update: runtime, HTTP parser, and resource keys | [Upgrade and deployment sequence](https://nestarc.dev/packages/tenancy/migration#upgrade-to-0-16-2) |
| <a id="deprecation-policy"></a>Supported versions, deprecated APIs, and migrations | [Compatibility and migrations](https://nestarc.dev/packages/tenancy/migration) |
| Integrating the package with an AI coding agent | [Version-scoped agent usage guide](https://nestarc.dev/packages/tenancy/agent-guide) |
| Maintaining this repository and preparing a release | [Maintainer guide](https://github.com/nestarc/nestjs-tenancy/blob/main/AGENTS.md) |

<a id="security"></a>
<a id="security-considerations"></a>

## Important boundaries

- **Database configuration remains necessary.** Apply RLS to every tenant table and connect with the intended application role. RLS protects rows; it does not authorize caller-supplied tenant IDs or isolate CPU/IO, caches, search indexes, or jobs.
- **Fail-closed is enabled for model queries.** Missing context throws `TenancyContextRequiredError` unless explicitly bypassed at the client layer. `sharedModels` and `withoutTenant()` skip extension hooks; they do not disable database RLS or grant administrative access. [Details](https://nestarc.dev/packages/tenancy/installation#extension-options)
- **Raw SQL uses an explicit transaction.** `$queryRaw` and `$executeRaw` are outside the model extension. Open a transaction with `tenancyTransaction()`, or pass `tenancyTransactionCallback()` to the component that opens it. Run parameterized SQL on the callback client so it uses the same connection as the tenant setting.
- **Interactive transactions use the helper.** The default extension's batch transaction does not automatically work inside a Prisma interactive transaction. The helper's raw transaction client does not auto-inject tenant fields. [Transaction contract](https://nestarc.dev/packages/tenancy/installation#interactive-transactions)
- **Non-HTTP transports need their own trust boundary.** Kafka, Bull, and gRPC restoration need an explicit validator and producer-to-tenant authorization. WebSocket inbound enforcement is not provided. [RPC guide](https://nestarc.dev/packages/tenancy/microservice#inbound-context-restoration)
- **Diagnostics and events do not await asynchronous work.** Missing-context hooks and tenancy event listeners must return their asynchronous work's promise for rejection handling. Returned promise rejections and synchronous throws are logged; the missing-context policy still takes effect synchronously. Detached work remains the application's responsibility.
- **Adapter and pooler support has conditions.** Public structural request types do not prove every adapter hook works; review [HTTP prerequisites](https://nestarc.dev/packages/tenancy/installation#http-adapter-prerequisites). The pinned self-hosted PgBouncer transaction-mode matrix has a [specific contract](https://nestarc.dev/packages/tenancy/installation#pgbouncer-transaction-mode); managed poolers and Data Proxy require separate validation.

## License

MIT
