import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CacheInterceptor } from '@nestjs/cache-manager';
import { createHash } from 'crypto';
import { SHARED_TENANT_CACHE_KEY } from '../tenancy.constants';
import { TenancyContext } from '../services/tenancy-context';
import { TenantCacheInterceptorOptions } from './tenant-cache-options.interface';

type BaseCacheKey = Promise<string | undefined | null> | string | undefined | null;

@Injectable()
export class TenantCacheInterceptor extends CacheInterceptor {
  private readonly tenantPrefix: string;
  private readonly sharedPrefix: string;
  private readonly separator: string;
  private readonly hashTenantId: boolean;

  constructor(
    cacheManager: ConstructorParameters<typeof CacheInterceptor>[0],
    reflector: Reflector,
    options?: TenantCacheInterceptorOptions,
  ) {
    super(cacheManager, reflector);
    this.tenantPrefix = options?.tenantPrefix ?? 'tenant';
    this.sharedPrefix = options?.sharedPrefix ?? 'shared';
    this.separator = options?.separator ?? ':';
    this.hashTenantId = options?.hashTenantId ?? false;
  }

  protected getBaseCacheKey(context: ExecutionContext): BaseCacheKey {
    return super.trackBy(context);
  }

  protected async trackBy(context: ExecutionContext): Promise<string | undefined> {
    const baseKey = await this.getBaseCacheKey(context);
    if (!baseKey) {
      return undefined;
    }

    if (this.isSharedCache(context)) {
      return this.joinKeyParts(this.sharedPrefix, baseKey);
    }

    const tenantId = TenancyContext.getCurrentTenantId();
    if (!tenantId) {
      return undefined;
    }

    return this.joinKeyParts(
      this.tenantPrefix,
      this.formatTenantId(tenantId),
      baseKey,
    );
  }

  private isSharedCache(context: ExecutionContext): boolean {
    return this.reflector.getAllAndOverride<boolean>(
      SHARED_TENANT_CACHE_KEY,
      [context.getHandler(), context.getClass()],
    ) === true;
  }

  private formatTenantId(tenantId: string): string {
    if (this.hashTenantId) {
      return createHash('sha256').update(tenantId).digest('hex');
    }

    return encodeURIComponent(tenantId);
  }

  private joinKeyParts(...parts: string[]): string {
    return parts.join(this.separator);
  }
}
