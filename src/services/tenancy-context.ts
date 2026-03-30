import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

interface TenantStore {
  tenantId: string | null;
  bypassed?: boolean;
}

@Injectable()
export class TenancyContext {
  private static readonly storage = new AsyncLocalStorage<TenantStore>();

  run<T>(tenantId: string, callback: () => T): T {
    return TenancyContext.storage.run({ tenantId, bypassed: false }, callback);
  }

  getTenantId(): string | null {
    return TenancyContext.storage.getStore()?.tenantId ?? null;
  }

  isBypassed(): boolean {
    return TenancyContext.storage.getStore()?.bypassed ?? false;
  }

  runWithoutTenant<T>(callback: () => T | Promise<T>): Promise<T> {
    return Promise.resolve(
      TenancyContext.storage.run({ tenantId: null, bypassed: true }, () => callback()),
    );
  }
}
