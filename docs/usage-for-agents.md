# Using @nestarc/tenancy in an application

This guide is for coding assistants integrating the package into a consumer application. It describes the 0.16.x API. Check the application's installed versions before choosing examples:

```sh
npm ls @nestarc/tenancy @nestjs/core @prisma/client
```

The package supports Node `^22.13.0 || ^24.0.0`, NestJS 10/11, and Prisma 6/7. Use the [compatibility contract](./compatibility.md) for exact tested combinations. Source examples on the repository's current branch may include unreleased changes; verify the installed package rather than assuming branch contents are published.

## Start with a working example

Read the [package README](../README.md), then the [runnable quickstart](../examples/quickstart/README.md). The example contains the schema, setup SQL, seed, authentication boundary, Nest module, Prisma service, controller, and verification commands. Its demonstration credentials are for the local example only. Integrate the application's existing identity provider and principal-to-tenant authorization for production use.

## Choose the correct imports

| Purpose | Import path | Notes |
| --- | --- | --- |
| Module, context, Prisma extension, transactions, extractors, transport propagation | `@nestarc/tenancy` | Core package |
| Tenant response caching | `@nestarc/tenancy/cache` | Requires compatible optional Nest cache packages |
| Test module and isolation helpers | `@nestarc/tenancy/testing` | Test application code |

Do not import private `dist` or `src` paths. The package exports define its supported public entry points. For Prisma 7, use the application's generated Prisma client and PostgreSQL driver adapter, as shown in the example.

## Establish the request and database boundaries

1. Authenticate the caller before tenant extraction and authorize the selected tenant against that principal. In the Express example, application middleware is registered with `app.use()` before `app.init()` or `app.listen()`. Importing an auth module before the global tenancy module does not establish this ordering.
2. Configure one `TenancyModule` tenant extractor. HTTP defaults to a UUID-like identifier format; slug identifiers need a custom `validateTenantId`. Format validation is not authorization.
3. Give every tenant table a required tenant column, index, RLS isolation policy, and restrictive non-empty context guard. Apply policies using the schema administrator; run application queries with a non-owner, non-superuser role without `BYPASSRLS`.
4. Configure `dbSettingKey` once on `TenancyModule`. The extension and `tenancyTransaction()` inherit it. SQL policies and CLI checks must use that same key.
5. Apply `createPrismaTenancyExtension()` to the base client and expose the extended client for ordinary model operations. Register the Prisma service and controllers/providers in the Nest module.

See [HTTP authentication and extractors](./http.md), [Prisma configuration](./prisma.md), and [RLS operations](./operations.md). HTTP interface compatibility does not make platform-specific request fields or response methods available on every adapter. Normalize required request fields and use the response API of the actual adapter.

## Use the appropriate data path

| Operation | Correct approach |
| --- | --- |
| Normal model reads/writes | Extended Prisma client with an authorized tenant context |
| Several atomic operations | `tenancyTransaction(baseClient, tenancyService, callback, options)` and only the callback's `tx` client |
| Raw SQL | The transaction helper's `tx` client, or an explicit transaction that sets the tenant and executes SQL on the same connection |
| Shared model | `sharedModels` omits extension processing; configure actual shared access separately in the database |
| Explicit no-context work | `withoutTenant()` clears application context and skips the extension's missing-context error; database RLS still applies |
| Cross-tenant administration | Separately authorized admin connection and application audit policy |

`failClosed` defaults to true for model operations. Keep it enabled unless an intentional, reviewed data path requires otherwise. `@BypassTenancy()` only skips the HTTP guard's tenant-required check; it does not authenticate an administrator, clear context, or bypass PostgreSQL RLS.

The transaction helper uses the raw base client. Its callback does not run extension hooks: provide the tenant field for writes explicitly. `autoInjectTenantId` changes top-level runtime write arguments, overwrites the create tenant from context, and removes the tenant field from `upsert.update`. It does not recursively inject nested writes or make a required generated Prisma input field optional. The logical Prisma field name can differ from the mapped SQL column name.

The deprecated `interactiveTransactionSupport` option is supported through 0.16.x and targets removal in 0.17.0. Use the public transaction helper for new integrations. See the single [deprecation schedule](./compatibility.md#deprecation-policy).

## Include caches and messages

Database RLS does not isolate a response cache, job payload, or search index. Use the tenant cache/resource helpers and explicit transport propagation where needed. Cache TTL values are milliseconds. RPC format validation is opt-in during 0.x: pass `validateTenantId` explicitly and separately authenticate/authorize the producer. Configure missing-context diagnostics for non-HTTP boundaries. [Integrations](./integrations.md)

## Verify the integration

- Compile the application's real code using its own strict TypeScript settings.
- Exercise authenticated tenant A and tenant B with distinct rows. Check that selecting another principal's tenant is rejected and rows do not cross tenants.
- Check missing context and raw/interactive transaction paths; include commit and rollback when changing transaction behavior.
- Use `tenancy check` for generated SQL and `tenancy doctor --json` through the application DB role for the applied configuration. Pass a custom `--db-setting-key` when configured. Active probes require existing A/B fixture rows and explicit `--active`; see [CLI operations](./operations.md).
- Distinguish a local build/test from a published package, successful remote CI run, or deployed documentation page. Report what actually ran.

This guide is ordinary package documentation. A client is not guaranteed to discover or read it automatically, and publishing an AI index does not guarantee search ranking or citations.
