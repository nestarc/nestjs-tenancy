import { SetMetadata } from '@nestjs/common';
import { SHARED_TENANT_CACHE_KEY } from '../tenancy.constants';

/**
 * Marks a route or controller as safe to cache without tenant namespacing.
 *
 * Use only for data that is intentionally identical for every tenant.
 * This affects cache key generation only; it does not bypass tenancy guards
 * or clear tenant context.
 */
export const SharedTenantCache = () => SetMetadata(SHARED_TENANT_CACHE_KEY, true);
