import { TenancyEventService } from '../src/events/tenancy-event.service';

describe('TenancyEventService', () => {
  describe('when EventEmitter2 is not available', () => {
    it('should not throw on emit()', () => {
      const moduleRef = {
        get: jest.fn().mockImplementation(() => {
          throw new Error('EventEmitter2 not found');
        }),
      };

      const service = new TenancyEventService(moduleRef as any);
      service.onModuleInit();

      // Should silently skip
      expect(() => service.emit('tenant.resolved', { tenantId: 'test' })).not.toThrow();
    });
  });

  describe('when EventEmitter2 is available', () => {
    it('should delegate emit() to EventEmitter2', () => {
      const mockEmitter = { emit: jest.fn().mockReturnValue(true) };
      const moduleRef = {
        get: jest.fn().mockReturnValue(mockEmitter),
      };

      const service = new TenancyEventService(moduleRef as any);
      service.onModuleInit();

      const payload = { tenantId: 'test-tenant', request: {} };
      service.emit('tenant.resolved', payload);

      expect(mockEmitter.emit).toHaveBeenCalledWith('tenant.resolved', payload);
    });

    it('should call moduleRef.get with correct arguments', () => {
      const moduleRef = {
        get: jest.fn().mockImplementation(() => { throw new Error('not found'); }),
      };

      const service = new TenancyEventService(moduleRef as any);
      service.onModuleInit();

      expect(moduleRef.get).toHaveBeenCalledWith('EventEmitter2', { strict: false });
    });
  });
});
