import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TenancyModule } from '../src/tenancy.module';
import { TenancyService } from '../src/services/tenancy.service';
import { TenancyEventService } from '../src/events/tenancy-event.service';
import { TenancyModuleOptionsFactory } from '../src/interfaces/tenancy-module-options.interface';
import { TENANCY_MODULE_OPTIONS } from '../src/tenancy.constants';

describe('TenancyModule', () => {
  describe('forRoot', () => {
    it('should provide TenancyService', async () => {
      const module = await Test.createTestingModule({
        imports: [TenancyModule.forRoot({ tenantExtractor: 'x-tenant-id' })],
      }).compile();

      const service = module.get(TenancyService);
      expect(service).toBeDefined();
      expect(service.getCurrentTenant()).toBeNull();
    });

    it('should provide module options', async () => {
      const module = await Test.createTestingModule({
        imports: [TenancyModule.forRoot({ tenantExtractor: 'x-tenant-id' })],
      }).compile();

      const options = module.get(TENANCY_MODULE_OPTIONS);
      expect(options.tenantExtractor).toBe('x-tenant-id');
    });

    it('should provide TenancyEventService', async () => {
      const module = await Test.createTestingModule({
        imports: [TenancyModule.forRoot({ tenantExtractor: 'x-tenant-id' })],
      }).compile();

      const eventService = module.get(TenancyEventService);
      expect(eventService).toBeDefined();
    });
  });

  describe('forRootAsync', () => {
    it('should provide TenancyService with useFactory', async () => {
      const module = await Test.createTestingModule({
        imports: [
          TenancyModule.forRootAsync({
            useFactory: () => ({ tenantExtractor: 'x-tenant-id' }),
          }),
        ],
      }).compile();

      expect(module.get(TenancyService)).toBeDefined();
    });

    it('should support useClass', async () => {
      class TestOptionsFactory {
        createTenancyOptions() {
          return { tenantExtractor: 'x-tenant-id' };
        }
      }

      const module = await Test.createTestingModule({
        imports: [
          TenancyModule.forRootAsync({ useClass: TestOptionsFactory }),
        ],
      }).compile();

      expect(module.get(TenancyService)).toBeDefined();
    });

    it('should support useExisting with pre-registered factory', async () => {
      class ExistingOptionsFactory implements TenancyModuleOptionsFactory {
        createTenancyOptions() {
          return { tenantExtractor: 'x-tenant-id' };
        }
      }

      // useExisting requires the factory to already be provided by another module.
      // Create a helper module that provides and exports it.
      @Module({
        providers: [ExistingOptionsFactory],
        exports: [ExistingOptionsFactory],
      })
      class OptionsModule {}

      const module = await Test.createTestingModule({
        imports: [
          OptionsModule,
          TenancyModule.forRootAsync({
            imports: [OptionsModule],
            useExisting: ExistingOptionsFactory,
          }),
        ],
      }).compile();

      expect(module.get(TenancyService)).toBeDefined();
      const options = module.get(TENANCY_MODULE_OPTIONS);
      expect(options.tenantExtractor).toBe('x-tenant-id');
    });

    it('should handle empty async options gracefully', async () => {
      const module = await Test.createTestingModule({
        imports: [
          TenancyModule.forRootAsync({
            useFactory: () => ({ tenantExtractor: 'x-tenant-id' }),
            inject: [],
          }),
        ],
      }).compile();

      expect(module.get(TenancyService)).toBeDefined();
    });
  });
});
