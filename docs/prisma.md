# Prisma configuration and transactions

[Package overview](../README.md) · [Documentation index](./README.md) · [Runnable example](../examples/quickstart/README.md)

Use these snippets when integrating with an existing application. For the schema, provider/controller registration, authentication, seed, and start commands together, run the complete example linked above.

## Extend your Prisma client

Configure Prisma 7 to generate the client into your source tree and keep the connection URL in Prisma Config:

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}
```

```typescript
// prisma.config.ts
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
});
```

Run `npx prisma generate`, then extend the generated client:

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from './generated/prisma/client';
import {
  TenancyService,
  createPrismaTenancyExtension,
  tenancyTransaction,
  type TenancyTransactionOptions,
} from '@nestarc/tenancy';

@Injectable()
export class PrismaService implements OnModuleInit {
  private readonly baseClient;
  public readonly client;

  constructor(private readonly tenancyService: TenancyService) {
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL!,
    });
    this.baseClient = new PrismaClient({ adapter });
    this.client = this.baseClient.$extends(
      createPrismaTenancyExtension(tenancyService),
    );
  }

  withTenantTransaction<T>(
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: TenancyTransactionOptions,
  ): Promise<T> {
    return tenancyTransaction(
      this.baseClient,
      this.tenancyService,
      callback,
      options,
    );
  }

  async onModuleInit() {
    await this.client.$connect();
  }
}
```

The example uses the Prisma 7 `prisma-client` generator and its required PostgreSQL driver adapter. Prisma 6 consumers can keep their existing client construction and apply the same extension to their base client.

## Extension Options

```typescript
createPrismaTenancyExtension(tenancyService, {
  autoInjectTenantId: true,            // Auto-inject tenant_id on create/upsert
  tenantIdField: 'tenant_id',          // Logical Prisma field name (default)
  sharedModels: ['Country', 'Currency'], // Models that skip this extension’s hooks
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `dbSettingKey` | `string` | Inherited from `TenancyService` | Optional compatibility assertion; normally omit it in module-based applications. A mismatch fails before extension creation. |
| `autoInjectTenantId` | `boolean` | `false` | Auto-inject tenant ID into `create`, `createMany`, `createManyAndReturn`, `upsert` |
| `tenantIdField` | `string` | `'tenant_id'` | Logical Prisma field name to inject tenant ID into |
| `sharedModels` | `string[]` | `[]` | Models that skip extension context setup, injection, and fail-closed checks; database RLS still applies |
| `failClosed` | `boolean` | `true` | Block queries when no tenant context is set (prevents accidental data exposure if RLS is misconfigured) |
| `interactiveTransactionSupport` | `boolean` | `false` | **Deprecated.** Compatibility-only transparent mode based on Prisma internals. Use `tenancyTransaction()`; see the [removal schedule](./compatibility.md#deprecation-policy) |

### Automatic tenant ID injection

With `autoInjectTenantId: true`, the extension changes top-level write arguments:

| Operation | Behavior |
| --- | --- |
| `create` | Adds or overwrites `data[tenantIdField]` with the active tenant ID |
| `createMany`, `createManyAndReturn` | Adds or overwrites the field in each top-level record, including a single-record input |
| `upsert` | Adds or overwrites `create[tenantIdField]` and removes the tenant field from `update` |
| `update`, `updateMany` | Does not inject or remove fields; database `WITH CHECK` policies must reject unauthorized tenant changes |
| Nested writes | Does not recursively inject into nested `create`, `connectOrCreate`, or related records |

Use the logical Prisma field name (`tenantId` when mapped with `@map("tenant_id")`). This is a runtime query transformation: it does not make required tenant fields optional in generated Prisma input types, and it does not supply required relation objects. Keep type-valid inputs; for nested writes and transaction-helper callbacks, provide the authorized tenant field explicitly or use a reviewed database default. Do not silence compiler errors with `any` to omit a required field.

> **Important:** Configure a custom `dbSettingKey` once in `TenancyModule.forRoot()` or `forRootAsync()`. `createPrismaTenancyExtension()` and `tenancyTransaction()` inherit the canonical value from `TenancyService`. An explicitly repeated identical value remains accepted for compatibility, while a different value fails before extension creation or transaction start. PostgreSQL RLS `current_setting()` calls must still use the same key.

> **Migration note:** Existing repeated identical values can be removed gradually. If a custom key currently exists only on the extension or helper, add it to `TenancyModule` before removing those options. Standalone consumers that construct `TenancyService` directly may continue to pass an explicit custom key. Changing the key itself also requires updating the RLS policies and passing the same `--db-setting-key` to `check` and `doctor`.

> **Note:** By default, the Prisma extension uses batch transactions internally, which do not propagate `set_config` into interactive transactions (`$transaction(async (tx) => ...)`). Use the `tenancyTransaction()` helper. See [Interactive Transactions](#interactive-transactions) and the [compatibility schedule](./compatibility.md#deprecation-policy).

> **Migration note:** If you intentionally rely on model queries without tenant context falling through to PostgreSQL RLS, set `failClosed: false` explicitly. Use `sharedModels` only for models intended to skip client enforcement, and review [context clearing and administration](#programmatic-context-clearing-and-administration) before disabling the check. These options do not disable database RLS.

## Interactive Transactions

The default Prisma extension wraps queries in batch transactions, which breaks inside `$transaction(async (tx) => ...)`. Two approaches are available:

**Option 1: `tenancyTransaction()` helper (recommended)**

Uses only public Prisma APIs. The supported Prisma 6 and 7 majors are covered by the real-database PgBouncer matrix.

```typescript
const tenantId = tenancyService.getCurrentTenantOrThrow();

await prismaService.withTenantTransaction(async (tx) => {
  const user = await tx.user.findFirstOrThrow();
  await tx.order.create({ data: { userId: user.id, tenant_id: tenantId } });
}, {
  maxWait: 2_000,                 // Wait to start the transaction (ms)
  timeout: 5_000,                 // Maximum transaction duration (ms)
  isolationLevel: 'Serializable', // Optional PostgreSQL isolation level
});
```

`withTenantTransaction()` above is a narrow application wrapper around the
exported `tenancyTransaction()` helper. It keeps the raw client private so
ordinary application code cannot accidentally bypass the extension.

The helper forwards Prisma's public interactive transaction options (`maxWait`, `timeout`, and `isolationLevel`). It resolves the canonical database setting key and tenant before starting the transaction, applies transaction-local `set_config()` before invoking your callback, and propagates transaction-start, context-setup, callback, timeout, and database errors unchanged. A mismatched explicit key fails before `$transaction()` is called.

`maxWait` enforcement belongs to the Prisma runtime. The verified Prisma 7.10.0 `PrismaPg` adapter and Prisma 6.19.3 native engine reject when their client connection pool cannot start in time. Prisma 6.19.3 `PrismaPg` accepts the option but does not enforce it under adapter-pool contention; the matrix keeps this as a negative contract. If bounded transaction admission is required on Prisma 6, use the native engine or enforce admission before calling the helper.

The wrapper passes its raw, unextended Prisma client to the helper; direct helper
users must do the same. Use only the callback's `tx` client inside the
transaction. Because that transaction client does not run the extension's model
hooks, `autoInjectTenantId`, `sharedModels`, and `failClosed` do not apply there.
Writes must provide the configured logical tenant field explicitly (as above) or
use a reviewed database default; RLS still uses the transaction-local tenant
setting. The helper itself remains fail-closed: it calls
`getCurrentTenantOrThrow()` and rejects before opening `$transaction()` when
tenant context is missing.

> **Compatibility note:** The transparent mode relies on Prisma internal APIs. Existing users should keep an exact-version E2E lane while migrating; the [compatibility reference](./compatibility.md#deprecation-policy) owns the removal schedule and links to the before/after migration.

**Option 2: Deprecated transparent compatibility mode**

This mode remains available for existing consumers, but is not recommended for new code. Startup checks the required `_createItxClient` hook, but cannot guarantee the full internal transaction metadata shape and can silently miss an interactive transaction after a Prisma internal change.

```typescript
const prisma = basePrisma.$extends(
  createPrismaTenancyExtension(tenancyService, {
    interactiveTransactionSupport: true,
  })
);
```

## Programmatic context clearing and administration

`withoutTenant()` temporarily clears the AsyncLocalStorage tenant and marks an explicit client bypass. The extension then skips its tenant setting, injection, and fail-closed check. It does **not** change the database role, disable RLS, or clear a setting already established on a database transaction.

```typescript
const countries = await tenancyService.withoutTenant(() =>
  prisma.country.findMany(),
);
```

This is appropriate only if the database intentionally grants access to that shared table. A model listed in `sharedModels` already skips the same extension hooks and does not need `withoutTenant()`. Neither option makes a protected table public.

Under the documented equality policy plus restrictive non-empty guard, a SELECT against a tenant table with no database tenant setting returns no rows; writes can be rejected by RLS. Other policies or an existing transaction setting may produce different results.

For a background job belonging to a tenant, inject `TenancyContext` and call `tenancyContext.run(authorizedTenantId, callback)` after authorizing the job's tenant claim instead of clearing context. `TenancyService` exposes context lookup and clearing; `run()` belongs to `TenancyContext`.

Cross-tenant administration requires a separately authorized application path and a deliberately provisioned database role/connection. Keep that client private to an admin service, authenticate the administrator, and verify the administrative permission before calling it. If policy requires bypassing all RLS, provision a narrowly granted `BYPASSRLS` role through database administration; do not use a superuser as the routine application connection. `withoutTenant()` is not needed by a separate unextended admin client.

`@BypassTenancy()` only skips the HTTP guard's tenant-required check. It grants no administrative permission and does not remove an incoming tenant context. A permissive bypass-flag policy alone cannot satisfy the documented restrictive context guard, so it is not an administration recipe.

## Fail-Closed Mode

By default, model queries without a tenant context throw `TenancyContextRequiredError`. This avoids silent unscoped query paths when RLS is misconfigured or accidentally bypassed.

```typescript
const prisma = basePrisma.$extends(
  createPrismaTenancyExtension(tenancyService, {
    failClosed: true, // default
  })
);
```

The extension permits the query to reach the database when:

- The model is listed in `sharedModels`.
- `withoutTenant()` explicitly skips the client check.

Database RLS and grants continue to determine whether that query may read or write rows.

To restore the previous pass-through behavior, opt out explicitly:

```typescript
const prisma = basePrisma.$extends(
  createPrismaTenancyExtension(tenancyService, {
    failClosed: false,
  })
);
```

> **Scope**: `failClosed` applies to Prisma **model operations** (`findMany`, `create`, `update`, etc.). Raw queries (`$queryRaw`, `$executeRaw`) bypass the extension and are **not** covered. Use `tenancyTransaction()` and execute the raw operation through its transaction client, or use an equivalent explicit transaction that performs parameterized `set_config()` and the raw operation on the same transaction connection.
