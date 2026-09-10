# Testing, events, telemetry, RPC, and caching

[Package overview](../README.md) · [Documentation index](./README.md) · [Runnable example](../examples/quickstart/README.md)

These integrations are optional. Match optional peer dependencies to your Nest major using the [compatibility reference](./compatibility.md).

## Testing Utilities

Import from `@nestarc/tenancy/testing`:

```typescript
import { TestTenancyModule, withTenant, expectTenantIsolation } from '@nestarc/tenancy/testing';

// 1. Use TestTenancyModule in unit/integration tests (no middleware or guard)
const module = await Test.createTestingModule({
  imports: [TestTenancyModule.register()],
  providers: [MyService],
}).compile();

// 2. Run code in a tenant context
const result = await withTenant('tenant-1', () => service.findAll());

// 3. Assert tenant isolation in E2E tests
await expectTenantIsolation(prisma.user, 'tenant-a-uuid', 'tenant-b-uuid');
```

## Event System

Optional integration with `@nestjs/event-emitter`. Install the package and import `EventEmitterModule`:

```typescript
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TenancyEvents } from '@nestarc/tenancy';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    TenancyModule.forRoot({ tenantExtractor: 'x-tenant-id' }),
  ],
})
export class AppModule {}

// Listen for events anywhere in your app
@Injectable()
class TenantLogger {
  @OnEvent(TenancyEvents.RESOLVED)
  handleResolved({ tenantId }: { tenantId: string }) {
    console.log(`Tenant resolved: ${tenantId}`);
  }
}
```

Events: `tenant.resolved`, `tenant.not_found`, `tenant.extraction_failed`, `tenant.validation_failed`, `tenant.context_bypassed`, `tenant.cross_check_failed`, `tenant.context_missing`, `tenant.context_invalid`.

If `@nestjs/event-emitter` is not installed, events are silently skipped — no errors.

Built-in request-bearing event producers emit only `requestSummary` (`method`,
`path`, `ip`, `userAgent`, and `host`) so listeners do not accidentally retain credentials,
cookies, bodies, or framework-specific request references. The removed raw `request` field and its migration are documented in the [compatibility reference](./compatibility.md#deprecation-policy). Use optional `event.requestSummary`; custom emitters must also stop attaching raw requests. Summary fields are observability metadata, not authorization inputs. Apply your own redaction and retention policy to path, host, IP address, and user agent.

## OpenTelemetry Integration

Optional integration with `@opentelemetry/api`. Install the package to enable automatic tenant context in traces:

```bash
npm install @opentelemetry/api
```

```typescript
TenancyModule.forRoot({
  tenantExtractor: 'X-Tenant-Id',
  telemetry: {
    spanAttributeKey: 'tenant.id', // default
    createSpans: true,              // create custom spans for tenant lifecycle
  },
})
```

When enabled, `tenant.id` is automatically added as a span attribute to the active span on every request. If `createSpans` is `true`, a `tenant.resolved` span is also created with the configured tenant attribute.

If `@opentelemetry/api` is not installed, telemetry is silently skipped — no errors.

## Microservice Propagation

Forward the current tenant context to downstream services using `propagateTenantHeaders()`. The helper returns a plain header object and adds no HTTP-client runtime dependency.

```typescript
import { propagateTenantHeaders } from '@nestarc/tenancy';

// With fetch
const res = await fetch('http://orders-service/api/orders', {
  headers: { 'Content-Type': 'application/json', ...propagateTenantHeaders() },
});

// With axios
const res = await axios.get('http://orders-service/api/orders', {
  headers: propagateTenantHeaders(),
});

// With @nestjs/axios HttpService
this.httpService.get('http://orders-service/api/orders', {
  headers: propagateTenantHeaders(),
});
```

By default, the function uses `X-Tenant-Id` as the header name. Pass a custom name if needed:

```typescript
propagateTenantHeaders('X-Custom-Tenant'); // { 'X-Custom-Tenant': 'tenant-abc' }
```

Returns an empty object `{}` when no tenant context is available (e.g., outside a request or inside `withoutTenant()`).

> **How it works:** `propagateTenantHeaders()` reads from the same static `AsyncLocalStorage` used by `TenancyContext`. No dependency injection required — it works anywhere in the call stack.

For more control, use `HttpTenantPropagator` directly:

```typescript
import { HttpTenantPropagator, TenancyContext } from '@nestarc/tenancy';

const propagator = new HttpTenantPropagator(new TenancyContext(), {
  headerName: 'X-Tenant-Id',
});
const headers = propagator.getHeaders(); // { 'X-Tenant-Id': 'tenant-abc' }
```

### Message Queue & RPC Propagation

Transport-specific propagators for Bull, Kafka, and gRPC. All use structural typing with zero runtime dependencies on transport packages.

#### Bull (BullMQ)

```typescript
import { BullTenantPropagator, TenancyContext } from '@nestarc/tenancy';

const propagator = new BullTenantPropagator(new TenancyContext());

// Producer: inject tenant into job data
await queue.add('process-order', propagator.inject({ orderId: '123' }));
// → { orderId: '123', __tenantId: 'tenant-abc' }

// Consumer: extract tenant from job data
const tenantId = propagator.extract(job.data); // 'tenant-abc'
```

#### Kafka

```typescript
import { KafkaTenantPropagator, TenancyContext } from '@nestarc/tenancy';

const propagator = new KafkaTenantPropagator(new TenancyContext());

// Producer: inject tenant into message headers
await producer.send({
  topic: 'orders',
  messages: [propagator.inject({ value: JSON.stringify(payload) })],
});

// Consumer: extract tenant from message
const tenantId = propagator.extract(message); // handles string & Buffer headers
```

#### gRPC

```typescript
import { GrpcTenantPropagator, TenancyContext } from '@nestarc/tenancy';

const propagator = new GrpcTenantPropagator(new TenancyContext());

// Client: inject tenant into metadata
const metadata = new Metadata();
propagator.inject(metadata); // sets 'x-tenant-id' key

// Server: extract tenant from metadata
const tenantId = propagator.extract(call.metadata);
```

### Inbound Context Restoration (Interceptor)

`TenantContextInterceptor` automatically restores tenant context from incoming microservice messages. It wraps handler execution in `TenancyContext.run()`.

```typescript
import {
  TenantContextDiagnostics,
  TenantContextInterceptor,
  TenancyContext,
  type TenantIdValidator,
} from '@nestarc/tenancy';

const validateTenantId: TenantIdValidator = (tenantId) =>
  /^org_[a-z0-9-]+$/.test(tenantId);
const diagnostics = app.get(TenantContextDiagnostics);

// Specify the transport explicitly to avoid duck-typing ambiguity.
app.useGlobalInterceptors(
  new TenantContextInterceptor(new TenancyContext(), {
    transport: 'kafka',
    validateTenantId,
    diagnostics,
    resource: 'orders',
  }),
);
```

Supported transports: `'kafka'` | `'bull'` | `'grpc'`.

> **HTTP is skipped** — `TenantMiddleware` + `TenancyGuard` already handle HTTP tenant extraction. The interceptor is designed for RPC transports only.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `transport` | `'kafka' \| 'bull' \| 'grpc'` | auto-detect | Explicit transport selection (recommended) |
| `kafkaHeaderName` | `string` | `'X-Tenant-Id'` | Kafka message header name |
| `bullDataKey` | `string` | `'__tenantId'` | Bull job data key |
| `grpcMetadataKey` | `string` | `'x-tenant-id'` | gRPC metadata key |
| `validateTenantId` | `TenantIdValidator` | unset during 0.x | Optional sync/async validator run before tenant context and handler execution |
| `diagnostics` | `TenantContextDiagnostics` | none | Module-backed missing/invalid-context event and telemetry reporting |
| `resource` | `string` | none | Stable, low-cardinality, non-sensitive topic, queue, service, or handler name |

> **0.x compatibility:** HTTP defaults to UUID-like validation; RPC accepts a non-empty string unless you pass `validateTenantId`. Supply a validator on each RPC interceptor. See the [compatibility reference](./compatibility.md#earlier-migration-notes) for the planned default change.

When an explicit RPC validator returns `false`, the handler is not invoked and the interceptor rejects with `BadRequestException('Invalid tenant ID format')`. A supplied module-resolved `TenantContextDiagnostics` reports the exported `InvalidTenantContextDiagnostic` payload (`transport`, `operation: 'consume'`, and optional stable `resource`) to the optional event and telemetry integrations. When configured, this emits `tenant.context_invalid`, adds an active-span event of the same name, and increments `nestarc.tenancy.invalid_context` with `tenant.transport`, `tenant.operation`, and optional `tenant.resource` attributes. The interceptor never copies the rejected ID or raw carrier contents into that payload. Keep the caller-supplied `resource` non-sensitive; do not place tenant/user IDs or secrets in it. Invalid input is independent of `missingContext.policy` and always rejects.

#### RPC Trust Boundary

RPC carrier values are tenant claims, not authenticated identities. `TenantContextInterceptor` does not authenticate producers, verify message signatures, configure broker/channel security, or authorize a producer for the claimed tenant. The HTTP `crossCheck` and `onTenantResolved` contracts are not automatically applied to RPC messages.

Authenticate the producer or channel and authorize that principal for the claimed tenant before tenant-scoped handler work. `validateTenantId` provides format or allow-list validation only; successful validation and context restoration are not authorization.

### Non-HTTP Missing-Context Diagnostics

The default policy is `ignore`, which preserves the existing pass-through behavior. Opt in at module level with `warn` for observation or `throw` to fail closed:

```typescript
TenancyModule.forRoot({
  tenantExtractor: 'X-Tenant-Id',
  missingContext: { policy: 'warn' }, // 'ignore' | 'warn' | 'throw'
});
```

Resolve the configured diagnostics object when constructing transport propagators manually. Use a stable, low-cardinality `resource` such as a queue, topic, service, cache, or index name:

```typescript
import {
  BullTenantPropagator,
  TenantContextDiagnostics,
  TenancyContext,
} from '@nestarc/tenancy';

const diagnostics = app.get(TenantContextDiagnostics);
const propagator = new BullTenantPropagator(new TenancyContext(), {
  diagnostics,
  resource: 'orders',
});
```

`warn` and `throw` both emit `tenant.context_missing`, add a `tenant.context_missing` event to the active OpenTelemetry span, and increment `nestarc.tenancy.missing_context`. Telemetry attributes are `tenant.transport`, `tenant.operation`, and optional `tenant.resource`. The `throw` policy raises `TenantContextMissingError` after reporting. HTTP extraction is intentionally outside this policy because middleware and `TenancyGuard` already define its fail-closed contract. An RPC value rejected by an explicit validator uses the separate, always-rejecting `tenant.context_invalid` path described above; it is not treated as missing.

The same diagnostics object can be supplied to `TenantContextInterceptor`, `TenantCacheInterceptor`, `TenantResourceKey`, and `TenantSearch`. `TenantResourceKey` creates collision-safe Redis/search keys, while `TenantSearch` is a vendor-neutral adapter boundary that never invokes the adapter without tenant scope:

```typescript
const keys = new TenantResourceKey(new TenancyContext(), {
  transport: 'redis',
  resource: 'response-cache',
  diagnostics,
});

const search = new TenantSearch(new TenancyContext(), searchAdapter, {
  index: 'products',
  diagnostics,
});
```

With `ignore` or `warn`, a missing resource key/search scope returns `null` and no Redis/search operation is performed. With `throw`, it fails before the adapter or resource is accessed.

## Tenant-Aware Caching

PostgreSQL RLS protects database rows, but it does not protect Redis, in-memory response caches, or other application cache stores. If two tenants hit the same route and the cache key is only the URL, an unscoped response cache can leak one tenant's data to another tenant.

Install Nest's optional cache runtime when you want response caching:

```bash
npm install @nestjs/cache-manager cache-manager
```

Register Nest caching alongside the tenancy module. Keep core tenancy imports from `@nestarc/tenancy`:

```typescript
import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { TenancyModule } from '@nestarc/tenancy';

@Module({
  imports: [
    CacheModule.register(),
    TenancyModule.forRoot({
      tenantExtractor: 'X-Tenant-Id',
    }),
  ],
})
export class AppModule {}
```

Use `TenantCacheInterceptor` from the cache subpath on routes that should cache per tenant:

```typescript
import { CacheTTL } from '@nestjs/cache-manager';
import { Controller, Get, UseInterceptors } from '@nestjs/common';
import { TenantCacheInterceptor } from '@nestarc/tenancy/cache';

@Controller('products')
export class ProductsController {
  @UseInterceptors(TenantCacheInterceptor)
  @CacheTTL(60_000) // milliseconds: 1 minute
  @Get()
  findAll() {
    return this.productsService.findAll();
  }
}
```

By default, the interceptor turns Nest's base cache key into `tenant:{tenantIdLength}:{tenantId}:{baseCacheKey}`. The length prefix keeps tenant IDs containing `:` or another configured separator from colliding with opaque Nest cache keys. The base cache key is the same key Nest's `CacheInterceptor` would have used, including any `@CacheKey()` override.

Nest cache TTL values use **milliseconds** with the supported cache-manager 5/6/7 integrations. The example above caches for one minute; the next caches for five minutes.

For routes where the response is intentionally public or shared across tenants, opt in with `@SharedTenantCache()` from `@nestarc/tenancy/cache`:

```typescript
import { CacheTTL } from '@nestjs/cache-manager';
import { Controller, Get, UseInterceptors } from '@nestjs/common';
import { BypassTenancy } from '@nestarc/tenancy';
import { SharedTenantCache, TenantCacheInterceptor } from '@nestarc/tenancy/cache';

@Controller('catalog')
export class CatalogController {
  @BypassTenancy()
  @SharedTenantCache()
  @UseInterceptors(TenantCacheInterceptor)
  @CacheTTL(300_000) // milliseconds: 5 minutes
  @Get()
  publicCatalog() {
    return this.catalogService.publicCatalog();
  }
}
```

`@SharedTenantCache()` affects cache keys only: shared routes use `shared:{baseCacheKey}` instead of a tenant-prefixed key. It does not bypass `TenancyGuard`, clear tenant context, or authorize access. If a public route should skip the tenant-required guard, it still needs `@BypassTenancy()`.

To apply tenant-aware caching globally, register the interceptor as an `APP_INTERCEPTOR`. Optional cache interceptor settings are provided through the cache subpath token:

```typescript
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { CacheModule } from '@nestjs/cache-manager';
import { TenancyModule } from '@nestarc/tenancy';
import {
  TENANT_CACHE_INTERCEPTOR_OPTIONS,
  TenantCacheInterceptor,
} from '@nestarc/tenancy/cache';

@Module({
  imports: [
    CacheModule.register(),
    TenancyModule.forRoot({
      tenantExtractor: 'X-Tenant-Id',
    }),
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: TenantCacheInterceptor },
    {
      provide: TENANT_CACHE_INTERCEPTOR_OPTIONS,
      useValue: { hashTenantId: true },
    },
  ],
})
export class AppModule {}
```

Cache invalidation remains application- and store-specific. Invalidate every tenant-scoped key shape your application writes, including any shared cache keys you opt into.
