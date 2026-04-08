import { SetMetadata } from '@nestjs/common';
import { BYPASS_TENANCY_KEY } from '../tenancy.constants';

/**
 * Marks a route or controller to skip `TenancyGuard`'s tenant-required check.
 *
 * **Important:** This only bypasses the guard — it does NOT clear the tenant context.
 * If the request contains a tenant header, `TenantMiddleware` still sets the context,
 * so `getCurrentTenant()` may return a value and Prisma queries will still be RLS-filtered.
 *
 * Use this for endpoints that should work with or without a tenant (e.g., health checks,
 * public APIs). If you need to explicitly run without tenant context, use `withoutTenant()`.
 */
export const BypassTenancy = () => SetMetadata(BYPASS_TENANCY_KEY, true);
