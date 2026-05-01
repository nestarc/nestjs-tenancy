import { TenancyContext } from '../services/tenancy-context';
import { TenantContextCarrier } from '../interfaces/tenant-context-carrier.interface';
import { DEFAULT_BULL_DATA_KEY } from '../tenancy.constants';

export interface BullPropagationOptions {
  /** Key name used to store tenant ID in job data. Defaults to '__tenantId'. */
  dataKey?: string;
}

/**
 * Bull/BullMQ tenant propagator.
 *
 * Injects the current tenant ID into job data on the producer side,
 * and extracts it on the consumer side. Uses a configurable key
 * (default: `__tenantId`) to avoid collisions with application data.
 *
 * No runtime dependency on `bullmq` — uses plain object types.
 *
 * @example
 * ```typescript
 * const propagator = new BullTenantPropagator(new TenancyContext());
 *
 * // Producer: inject tenant into job data
 * await queue.add('process', propagator.inject({ orderId: '123' }));
 *
 * // Consumer: extract tenant from job data
 * const tenantId = propagator.extract(job.data);
 * ```
 */
export class BullTenantPropagator
  implements TenantContextCarrier<Record<string, unknown>>
{
  private readonly dataKey: string;

  constructor(
    private readonly context: TenancyContext,
    options?: BullPropagationOptions,
  ) {
    this.dataKey = options?.dataKey ?? DEFAULT_BULL_DATA_KEY;
  }

  inject(jobData: Record<string, unknown>): Record<string, unknown> {
    const tenantId = this.context.getTenantId();
    if (!tenantId) return jobData;
    if (this.dataKey in jobData && jobData[this.dataKey] !== tenantId) {
      throw new Error(
        `[BullTenantPropagator] Job data already contains "${this.dataKey}" with a different tenant ID`,
      );
    }
    return { ...jobData, [this.dataKey]: tenantId };
  }

  extract(jobData: Record<string, unknown>): string | null {
    const value = jobData[this.dataKey];
    if (typeof value === 'string' && value.length > 0) return value;
    return null;
  }
}
