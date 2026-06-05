import 'reflect-metadata';
import { SHARED_TENANT_CACHE_KEY } from '../src/tenancy.constants';
import { SharedTenantCache } from '../src/decorators/shared-tenant-cache.decorator';

describe('SharedTenantCache', () => {
  it('should set SHARED_TENANT_CACHE_KEY metadata on a handler', () => {
    class TestController {
      @SharedTenantCache()
      handler() {}
    }

    const metadata = Reflect.getMetadata(
      SHARED_TENANT_CACHE_KEY,
      TestController.prototype.handler,
    );

    expect(metadata).toBe(true);
  });

  it('should set SHARED_TENANT_CACHE_KEY metadata on a controller class', () => {
    @SharedTenantCache()
    class TestController {}

    const metadata = Reflect.getMetadata(SHARED_TENANT_CACHE_KEY, TestController);

    expect(metadata).toBe(true);
  });
});
