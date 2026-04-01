import { TenancyContext } from '../services/tenancy-context';
import { TenantPropagator } from '../interfaces/tenant-propagator.interface';
import { DEFAULT_PROPAGATION_HEADER } from '../tenancy.constants';

export interface HttpPropagationOptions {
  /** Header name for tenant ID propagation. Defaults to 'X-Tenant-Id'. */
  headerName?: string;
}

/**
 * HTTP-specific tenant propagator.
 *
 * Reads the current tenant from `TenancyContext` and returns it as an HTTP header.
 * Returns an empty object when no tenant context is available.
 *
 * @example
 * ```typescript
 * const propagator = new HttpTenantPropagator(tenancyContext);
 * const headers = propagator.getHeaders();
 * // { 'X-Tenant-Id': 'tenant-abc' }
 * ```
 */
export class HttpTenantPropagator implements TenantPropagator {
  private readonly headerName: string;

  constructor(
    private readonly context: TenancyContext,
    options?: HttpPropagationOptions,
  ) {
    this.headerName = options?.headerName ?? DEFAULT_PROPAGATION_HEADER;
  }

  getHeaders(): Record<string, string> {
    const tenantId = this.context.getTenantId();
    if (!tenantId) return {};
    return { [this.headerName]: tenantId };
  }
}
