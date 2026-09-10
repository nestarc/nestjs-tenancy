# Module, service, decorators, and errors

[Package overview](../README.md) · [Documentation index](./README.md) · [Runnable example](../examples/quickstart/README.md)

These reference snippets assume your application already registers its own providers and imports. Start with the runnable example for a complete application.

## TenancyModule

These registration forms are alternatives. Keep the authentication and tenant membership checks from the [HTTP guide](./http.md#authentication-before-tenant-resolution) in your application whichever form you choose.

Synchronous registration:

```typescript
import { TenancyModule } from '@nestarc/tenancy';

TenancyModule.forRoot({
  tenantExtractor: 'X-Tenant-Id',
  dbSettingKey: 'app.current_tenant',
  // Omit this override to use the built-in UUID-like validator.
  validateTenantId: (id) => /^org_[a-z0-9-]+$/.test(id),
});
```

Asynchronous factory registration (use `imports`/`inject` if your factory needs providers from another module):

```typescript
import { TenancyModule } from '@nestarc/tenancy';

TenancyModule.forRootAsync({
  useFactory: async () => ({
    tenantExtractor: process.env.TENANT_HEADER ?? 'X-Tenant-Id',
  }),
});
```

Class-based registration:

```typescript
import { Injectable } from '@nestjs/common';
import { TenancyModule, type TenancyModuleOptionsFactory } from '@nestarc/tenancy';

@Injectable()
class TenancyConfigService implements TenancyModuleOptionsFactory {
  createTenancyOptions() {
    return { tenantExtractor: 'X-Tenant-Id' };
  }
}

TenancyModule.forRootAsync({ useClass: TenancyConfigService });
```

To reuse an existing provider, export it from a module and import that module in the async registration:

```typescript
import { Injectable, Module } from '@nestjs/common';
import { TenancyModule, type TenancyModuleOptionsFactory } from '@nestarc/tenancy';

@Injectable()
class TenancyConfigService implements TenancyModuleOptionsFactory {
  createTenancyOptions() {
    return { tenantExtractor: 'X-Tenant-Id' };
  }
}

@Module({ providers: [TenancyConfigService], exports: [TenancyConfigService] })
class TenancyConfigModule {}

TenancyModule.forRootAsync({
  imports: [TenancyConfigModule],
  useExisting: TenancyConfigService,
});
```

## TenancyService

```typescript
import { Injectable } from '@nestjs/common';
import { TenancyService } from '@nestarc/tenancy';

@Injectable()
export class SomeService {
  constructor(private readonly tenancy: TenancyService) {}

  doSomething() {
    const tenantOrNull = this.tenancy.getCurrentTenant();    // string | null
    const tenantId = this.tenancy.getCurrentTenantOrThrow(); // string (throws if missing)
    const settingKey = this.tenancy.getDbSettingKey();       // canonical PostgreSQL setting
    return { tenantOrNull, tenantId, settingKey };
  }
}
```

## @CurrentTenant() Decorator

```typescript
import { Controller, Get } from '@nestjs/common';
import { CurrentTenant } from '@nestarc/tenancy';

@Controller('users')
export class UsersController {
  @Get('me')
  whoAmI(@CurrentTenant() tenantId: string) {
    return { tenantId };
  }
}
```

## @BypassTenancy() Decorator

Skip the `TenancyGuard` tenant-required check on specific routes (e.g., health checks, public endpoints).

> **Important:** `@BypassTenancy()` only bypasses the guard's tenant-required check. It does **not** clear tenant context. If a request includes a valid tenant header, downstream services and Prisma queries can still run inside that tenant context. Use `tenancyService.withoutTenant()` to explicitly run with no tenant context.

```typescript
import { Controller, Get } from '@nestjs/common';
import { BypassTenancy } from '@nestarc/tenancy';

@Controller('health')
export class HealthController {
  @BypassTenancy()
  @Get()
  check() {
    return { status: 'ok' }; // No tenant header required
  }
}
```

## Error Responses

| Scenario | Status | Message |
|----------|--------|---------|
| Missing tenant header (no `@BypassTenancy`) | 403 | `Tenant ID is required` |
| Invalid tenant ID format | 400 | `Invalid tenant ID format` |
| Extractor throws or rejects | Propagates | Original error; emits `tenant.extraction_failed` first |
| Cross-check mismatch | 403 | `Tenant ID mismatch` |
| `crossCheck.required: true` and no secondary tenant source | 403 | `Cross-check source is required but returned null` |
| Prisma query without tenant context (`failClosed`, default) | Throws | `TenancyContextRequiredError` |
| WebSocket context | — | `TenancyGuard` skips it; no built-in restoration or enforcement |
| Kafka, Bull, or gRPC context | Policy-dependent | Configure `TenantContextInterceptor`; the HTTP guard does not handle RPC |
| Explicit Kafka, Bull, or gRPC validator returns/resolves `false` | Throws | `BadRequestException: Invalid tenant ID format`; handler is not invoked |
| Explicit Kafka, Bull, or gRPC validator throws/rejects | Propagates | Original validator error; handler is not invoked |

## Error Hierarchy

All tenancy context errors follow a class hierarchy for flexible catch handling:

```
Error
  └── TenantContextMissingError          ← getCurrentTenantOrThrow()
        └── TenancyContextRequiredError   ← Prisma fail-closed (has model, operation)
```

```typescript
import { TenantContextMissingError, TenancyContextRequiredError } from '@nestarc/tenancy';

try {
  // any operation that requires tenant context
} catch (e) {
  if (e instanceof TenantContextMissingError) {
    // Catches both service-level and Prisma-level errors
  }
  if (e instanceof TenancyContextRequiredError) {
    // Catches only Prisma fail-closed errors (e.model, e.operation available)
  }
}
```
