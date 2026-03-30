import { Inject, Injectable, Optional } from '@nestjs/common';
import { TenancyContext } from './tenancy-context';
import { TenancyEventService } from '../events/tenancy-event.service';
import { TenancyEvents } from '../events/tenancy-events';

@Injectable()
export class TenancyService {
  constructor(
    private readonly context: TenancyContext,
    @Optional() @Inject(TenancyEventService) private readonly eventService?: TenancyEventService,
  ) {}

  getCurrentTenant(): string | null {
    return this.context.getTenantId();
  }

  getCurrentTenantOrThrow(): string {
    const tenantId = this.context.getTenantId();
    if (!tenantId) {
      throw new Error('No tenant context available');
    }
    return tenantId;
  }

  isTenantBypassed(): boolean {
    return this.context.isBypassed();
  }

  async withoutTenant<T>(callback: () => T | Promise<T>): Promise<T> {
    this.eventService?.emit(TenancyEvents.CONTEXT_BYPASSED, { reason: 'withoutTenant' });
    return this.context.runWithoutTenant(callback);
  }
}
