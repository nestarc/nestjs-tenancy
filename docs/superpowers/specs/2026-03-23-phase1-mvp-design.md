# @nestarc/tenancy Phase 1 MVP Design Spec

## Overview

NestJS multi-tenancy module using PostgreSQL Row Level Security (RLS) + Prisma Client Extensions. A single `TenancyModule.forRoot()` call enables automatic tenant isolation.

**Scope**: Phase 1 MVP (v0.1.0) — header-based tenant extraction only.

## Architecture

```
HTTP Request
  → TenantMiddleware (extract tenant ID from header)
    → TenancyContext (store in AsyncLocalStorage)
      → TenancyGuard (reject if missing, unless @BypassTenancy; HTTP-only)
        → Controller / Service
          → PrismaTenancyExtension (interactive $transaction + SET LOCAL)
            → PostgreSQL RLS filters rows automatically
```

Non-HTTP contexts (WebSocket, gRPC, microservices) are skipped by the guard.

## Interfaces

### TenancyModuleOptions

```typescript
interface TenancyModuleOptions {
  // String = header name (shorthand for HeaderTenantExtractor)
  // TenantExtractor = custom extraction strategy
  tenantExtractor: string | TenantExtractor;

  // PostgreSQL setting key (default: 'app.current_tenant')
  dbSettingKey?: string;

  // Tenant ID validator (default: UUID format check)
  // IMPORTANT: This is the primary SQL injection defense for SET LOCAL.
  // PostgreSQL SET commands do not support bind parameters,
  // so validation MUST reject any non-safe input.
  validateTenantId?: (tenantId: string) => boolean | Promise<boolean>;
}

interface TenancyModuleAsyncOptions {
  imports?: any[];
  inject?: any[];
  useFactory?: (...args: any[]) => TenancyModuleOptions | Promise<TenancyModuleOptions>;
  useClass?: Type<TenancyModuleOptionsFactory>;
  useExisting?: Type<TenancyModuleOptionsFactory>;
}

interface TenancyModuleOptionsFactory {
  createTenancyOptions(): TenancyModuleOptions | Promise<TenancyModuleOptions>;
}
```

### TenantExtractor

```typescript
interface TenantExtractor {
  extract(request: Request): string | null | Promise<string | null>;
}
```

Phase 1 ships `HeaderTenantExtractor` only. The interface is designed for Phase 2 expansion (subdomain, JWT).

## Components

### TenancyModule (DynamicModule)

- `forRoot(options)` — synchronous config
- `forRootAsync(options)` — factory-based async config (useFactory, useClass, useExisting)
- Registers: middleware (global), guard (global), TenancyContext, TenancyService
- Follows `@nestjs/jwt`, `@nestjs/throttler` patterns

### TenancyContext (internal)

- Wraps `AsyncLocalStorage<{ tenantId: string }>`
- Singleton — NOT request-scoped (performance reason)
- `run(tenantId, callback)` — sets context for callback scope
- `getTenantId()` — reads current tenant from store
- Not exported publicly — consumers use TenancyService

### TenancyService (public)

- Injectable service for consumers
- `getCurrentTenant(): string | null` — returns current tenant ID
- `getCurrentTenantOrThrow(): string` — throws if no tenant

### TenantMiddleware

- Implements `NestMiddleware`
- Extracts tenant ID via configured `TenantExtractor`
- Validates tenant ID (UUID by default, or custom validator — awaited if async)
- Runs remaining request inside `TenancyContext.run(tenantId, next)`
- If async validator rejects/throws → 500 propagated to NestJS exception filter

### TenancyGuard

- Global guard applied via module
- **HTTP-only**: checks `context.getType() === 'http'`, skips non-HTTP contexts (WebSocket, gRPC, microservices)
- Rejects HTTP requests without tenant ID (403 Forbidden)
- Skips routes marked with `@BypassTenancy()` metadata

### @BypassTenancy() Decorator

- Method decorator that sets Reflector metadata (`BYPASS_TENANCY_KEY`)
- Used on controller methods that should skip tenant enforcement (e.g., health checks, admin routes)
- Read by TenancyGuard via NestJS Reflector

### @CurrentTenant() Decorator

- Parameter decorator for controllers (`createParamDecorator`)
- Reads tenant ID directly from `TenancyContext` (AsyncLocalStorage) — does NOT use ExecutionContext
- AsyncLocalStorage is process-global, so the decorator accesses it directly
- Returns `string | null`

### PrismaTenancyExtension (factory)

```typescript
function createPrismaTenancyExtension(
  tenancyService: TenancyService,
  options?: { dbSettingKey?: string }
): PrismaClientExtension;
```

- User applies to their own PrismaClient: `prisma.$extends(createPrismaTenancyExtension(...))`
- On every query: wraps in an **interactive** `$transaction(async (tx) => { ... })`
  - `tx.$executeRawUnsafe(\`SET LOCAL "${dbSettingKey}" = '${validatedTenantId}'\`)`
  - Then executes the original query within the same `tx` context
- **SQL injection defense**: tenantId is already validated by middleware (UUID by default). The `$executeRawUnsafe` call only receives pre-validated values. PostgreSQL `SET` commands cannot use bind parameters (`$1`), so parameterized queries are not possible here — validation is the sole defense.
- `SET LOCAL` is scoped to the transaction — no cross-request leakage via connection pool
- No-op when tenant context is absent (for non-tenant queries)

**Implementation note on $extends + interactive transactions**: Prisma's `$allOperations` hook receives `query` and `args`. To run the query inside an interactive transaction, we must use `Prisma.getExtensionContext(this)` to access the transaction client. The extension intercepts the operation, opens an interactive transaction on the *base client*, sets the tenant via `SET LOCAL`, then re-executes the original operation within `tx`. This requires careful handling to avoid infinite recursion (the re-executed query inside `tx` must not trigger the extension again).

## SQL Injection Defense

1. **Primary defense**: UUID format validation by default (`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`)
2. Custom `validateTenantId` function override for non-UUID tenant IDs (user's responsibility to ensure safety)
3. **`$executeRawUnsafe` with pre-validated input** — PostgreSQL `SET` commands do NOT support bind parameters, so `$executeRaw` tagged templates cannot be used here. Safety relies entirely on points 1 and 2.
4. `SET LOCAL` scoped to interactive transaction (no cross-request leakage)

## Error Handling

| Scenario | Response |
|----------|----------|
| Missing tenant header | 403 `{ message: 'Tenant ID is required' }` |
| Invalid tenant ID format | 400 `{ message: 'Invalid tenant ID format' }` |
| Validator throws / rejects | 500 (propagated to NestJS exception filter) |
| Non-HTTP context | Guard skips (no enforcement) |
| Prisma extension without context | No-op (query proceeds without RLS set) |

## Dependencies

### package.json

```json
{
  "name": "@nestarc/tenancy",
  "version": "0.1.0",
  "description": "Multi-tenancy module for NestJS with PostgreSQL Row Level Security (RLS) and Prisma support",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "license": "MIT",
  "peerDependencies": {
    "@nestjs/common": "^10.0.0 || ^11.0.0",
    "@nestjs/core": "^10.0.0 || ^11.0.0",
    "@prisma/client": "^5.0.0 || ^6.0.0",
    "reflect-metadata": "^0.1.13 || ^0.2.0",
    "rxjs": "^7.0.0"
  },
  "devDependencies": {
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "@nestjs/testing": "^11.0.0",
    "@prisma/client": "^6.0.0",
    "typescript": "^5.0.0",
    "jest": "^29.0.0",
    "ts-jest": "^29.0.0",
    "@types/jest": "^29.0.0",
    "@types/node": "^20.0.0",
    "reflect-metadata": "^0.2.0",
    "rxjs": "^7.0.0"
  }
}
```

## File Structure

```
src/
├── index.ts                          # barrel exports
├── tenancy.module.ts                 # DynamicModule
├── tenancy.constants.ts              # injection tokens
├── interfaces/
│   ├── tenancy-module-options.interface.ts
│   └── tenant-extractor.interface.ts
├── services/
│   ├── tenancy-context.ts            # AsyncLocalStorage wrapper
│   └── tenancy.service.ts            # public service
├── middleware/
│   └── tenant.middleware.ts          # extract tenant from request
├── guards/
│   └── tenancy.guard.ts             # enforce tenant presence (HTTP-only)
├── decorators/
│   ├── current-tenant.decorator.ts  # @CurrentTenant()
│   └── bypass-tenancy.decorator.ts  # @BypassTenancy()
├── extractors/
│   └── header.extractor.ts          # HeaderTenantExtractor
└── prisma/
    └── prisma-tenancy.extension.ts  # Prisma $extends factory
```

## Test Plan

Unit tests with Jest for:
- TenancyContext: AsyncLocalStorage run/get/nested contexts
- TenancyService: getCurrentTenant / getCurrentTenantOrThrow
- TenantMiddleware: header extraction, validation, missing header, async validator rejection
- TenancyGuard: allow/deny based on tenant presence, @BypassTenancy skip, non-HTTP skip
- @CurrentTenant: decorator reads from AsyncLocalStorage directly
- @BypassTenancy: sets correct metadata key
- HeaderTenantExtractor: header name resolution
- PrismaTenancyExtension: SET LOCAL in interactive transaction, no-op without context
- TenancyModule: forRoot / forRootAsync (useFactory, useClass, useExisting) registration

## API Surface (public exports)

```typescript
// Module
export { TenancyModule } from './tenancy.module';

// Service
export { TenancyService } from './services/tenancy.service';

// Interfaces
export { TenancyModuleOptions, TenancyModuleAsyncOptions, TenancyModuleOptionsFactory } from './interfaces/tenancy-module-options.interface';
export { TenantExtractor } from './interfaces/tenant-extractor.interface';

// Decorators
export { CurrentTenant } from './decorators/current-tenant.decorator';
export { BypassTenancy } from './decorators/bypass-tenancy.decorator';

// Extractors
export { HeaderTenantExtractor } from './extractors/header.extractor';

// Prisma
export { createPrismaTenancyExtension } from './prisma/prisma-tenancy.extension';

// Constants (for advanced users)
export { TENANCY_MODULE_OPTIONS } from './tenancy.constants';
```
