import { TenancyEventService } from '../src/events/tenancy-event.service';
import { TenancyEvents } from '../src/events/tenancy-events';

describe('TenancyEventService', () => {
  afterEach(() => jest.restoreAllMocks());

  describe('when EventEmitter2 is not available', () => {
    it('should not throw on emit()', async () => {
      const moduleRef = {
        get: jest.fn().mockImplementation(() => {
          throw new Error('not found');
        }),
      };

      const service = new TenancyEventService(moduleRef as any);
      await service.onModuleInit();

      // Should silently skip
      expect(() => service.emit(TenancyEvents.RESOLVED, { tenantId: 'test' })).not.toThrow();
    });
  });

  describe('when EventEmitter2 is available', () => {
    it('should synchronously dispatch listeners from the resolved emitter', async () => {
      const listener = jest.fn();
      const mockEmitter = {
        listenersAny: jest.fn().mockReturnValue([]),
        listeners: jest.fn().mockReturnValue([listener]),
      };
      const moduleRef = {
        get: jest.fn().mockReturnValue(mockEmitter),
      };

      const service = new TenancyEventService(moduleRef as any);
      await service.onModuleInit();

      const payload = { tenantId: 'test-tenant' };
      expect(service.emit(TenancyEvents.RESOLVED, payload)).toBeUndefined();

      expect(mockEmitter.listeners).toHaveBeenCalledWith(TenancyEvents.RESOLVED);
      expect(listener).toHaveBeenCalledWith(payload);
      expect(listener.mock.contexts[0]).toBe(mockEmitter);
    });

    it('should isolate listener errors from callers', async () => {
      const mockEmitter = {
        listenersAny: jest.fn().mockReturnValue([]),
        listeners: jest.fn().mockReturnValue([
          () => { throw new Error('listener failed'); },
        ]),
      };

      const moduleRef = {
        get: jest.fn().mockReturnValue(mockEmitter),
      };

      const service = new TenancyEventService(moduleRef as any);
      const loggerSpy = jest
        .spyOn((service as any).logger, 'error')
        .mockImplementation(() => undefined);
      await service.onModuleInit();

      expect(() => service.emit(TenancyEvents.RESOLVED, { tenantId: 'test' })).not.toThrow();
      expect(loggerSpy).toHaveBeenCalled();
      expect(loggerSpy.mock.calls[0][0]).toContain(TenancyEvents.RESOLVED);
    });

    it('logs non-Error Promise rejections without rejecting the caller', async () => {
      const mockEmitter = {
        listenersAny: () => [],
        listeners: () => [() => Promise.reject('listener failed')],
      };
      const service = new TenancyEventService({ get: () => mockEmitter } as any);
      const loggerSpy = jest
        .spyOn((service as any).logger, 'error')
        .mockImplementation(() => undefined);
      await service.onModuleInit();

      expect(service.emit(TenancyEvents.RESOLVED, { tenantId: 'test' })).toBeUndefined();
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(loggerSpy).toHaveBeenCalledWith(
        `Tenancy event listener failed for "${TenancyEvents.RESOLVED}"`,
        undefined,
      );
    });
  });
});
