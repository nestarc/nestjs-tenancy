import { DynamicModule, Module } from '@nestjs/common';
import { TenancyContext } from '../services/tenancy-context';
import { TenancyService } from '../services/tenancy.service';

/**
 * A lightweight test module that provides TenancyContext and TenancyService
 * without the middleware, guard, or module options required by the production
 * TenancyModule.
 *
 * Usage in tests:
 * ```typescript
 * const module = await Test.createTestingModule({
 *   imports: [TestTenancyModule.register()],
 *   providers: [MyService],
 * }).compile();
 *
 * const service = module.get(MyService);
 * const result = await withTenant('tenant-1', () => service.findAll());
 * ```
 */
@Module({})
export class TestTenancyModule {
  static register(): DynamicModule {
    return {
      module: TestTenancyModule,
      global: true,
      providers: [TenancyContext, TenancyService],
      exports: [TenancyContext, TenancyService],
    };
  }
}
