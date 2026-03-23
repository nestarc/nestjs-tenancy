# @nestarc/tenancy

[![npm version](https://img.shields.io/npm/v/@nestarc/tenancy.svg)](https://www.npmjs.com/package/@nestarc/tenancy)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Multi-tenancy module for NestJS with **PostgreSQL Row Level Security (RLS)** and **Prisma** support.

One line of code. Automatic tenant isolation.

## Features

- **RLS-based isolation** — PostgreSQL enforces tenant boundaries at the database level
- **AsyncLocalStorage** — Zero-overhead request-scoped tenant context (no `REQUEST` scope)
- **Prisma Client Extensions** — Automatic `SET LOCAL` before every query
- **Flexible extraction** — Header-based (built-in), custom strategies via `TenantExtractor` interface
- **SQL injection safe** — UUID validation by default, customizable validator
- **NestJS 10 & 11** compatible, **Prisma 5 & 6** compatible

## Installation

```bash
npm install @nestarc/tenancy
```

**Peer dependencies:** `@nestjs/common`, `@nestjs/core`, `@prisma/client`, `reflect-metadata`, `rxjs`

## Quick Start

### 1. Enable RLS on your PostgreSQL tables

```sql
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON users
  USING (tenant_id = current_setting('app.current_tenant')::text);
```

### 2. Register the module

```typescript
import { TenancyModule } from '@nestarc/tenancy';

@Module({
  imports: [
    TenancyModule.forRoot({
      tenantExtractor: 'X-Tenant-Id', // header name
    }),
  ],
})
export class AppModule {}
```

### 3. Extend your Prisma client

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TenancyService, createPrismaTenancyExtension } from '@nestarc/tenancy';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor(private readonly tenancyService: TenancyService) {
    super();
    // Apply the tenancy extension
    return this.$extends(
      createPrismaTenancyExtension(tenancyService),
    ) as this;
  }

  async onModuleInit() {
    await this.$connect();
  }
}
```

### 4. Use it

```typescript
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
  ) {}

  findAll() {
    // Automatically filtered by RLS — only current tenant's data returned
    return this.prisma.user.findMany();
  }
}
```

Every request with `X-Tenant-Id: <uuid>` header will automatically scope all Prisma queries to that tenant.

## API

### TenancyModule

```typescript
// Synchronous
TenancyModule.forRoot({
  tenantExtractor: 'X-Tenant-Id',           // header name (string)
  dbSettingKey: 'app.current_tenant',        // PostgreSQL setting (default)
  validateTenantId: (id) => UUID_REGEX.test(id), // custom validator (default: UUID)
})

// Async with factory
TenancyModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    tenantExtractor: config.get('TENANT_HEADER'),
  }),
})

// Async with class
TenancyModule.forRootAsync({
  useClass: TenancyConfigService,
})
```

### TenancyService

```typescript
@Injectable()
export class SomeService {
  constructor(private readonly tenancy: TenancyService) {}

  doSomething() {
    const tenantId = this.tenancy.getCurrentTenant();       // string | null
    const tenantId = this.tenancy.getCurrentTenantOrThrow(); // string (throws if missing)
  }
}
```

### @CurrentTenant() Decorator

```typescript
@Controller('users')
export class UsersController {
  @Get()
  findAll(@CurrentTenant() tenantId: string) {
    return this.usersService.findAll(tenantId);
  }
}
```

### @BypassTenancy() Decorator

```typescript
@Controller('health')
export class HealthController {
  @BypassTenancy()
  @Get()
  check() {
    return { status: 'ok' }; // No tenant required
  }
}
```

### Custom Tenant Extractor

```typescript
import { TenantExtractor } from '@nestarc/tenancy';
import { Request } from 'express';

export class SubdomainExtractor implements TenantExtractor {
  extract(request: Request): string | null {
    const host = request.hostname;
    const subdomain = host.split('.')[0];
    return subdomain === 'www' ? null : subdomain;
  }
}

// Usage
TenancyModule.forRoot({
  tenantExtractor: new SubdomainExtractor(),
  validateTenantId: (id) => /^[a-z0-9-]+$/.test(id),
})
```

## Security

- **SQL Injection**: Tenant IDs are validated before use. Default: UUID format. PostgreSQL `SET` commands cannot use bind parameters, so validation is the primary defense.
- **`SET LOCAL`**: Scoped to the interactive transaction — no cross-request leakage via connection pool.
- **Custom validators**: If your tenant IDs are not UUIDs, provide a `validateTenantId` function that rejects any unsafe input.

## How It Works

```
HTTP Request (X-Tenant-Id: abc-123)
  → TenantMiddleware (extracts & validates tenant ID)
    → AsyncLocalStorage (stores tenant context)
      → TenancyGuard (rejects requests without tenant, unless @BypassTenancy)
        → Your Controller / Service
          → Prisma Extension ($transaction → SET LOCAL → query)
            → PostgreSQL RLS (automatic row filtering)
```

## License

MIT
