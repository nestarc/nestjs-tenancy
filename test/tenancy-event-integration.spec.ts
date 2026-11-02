import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { TenancyEventService } from '../src/events/tenancy-event.service';
import { TenancyEvents } from '../src/events/tenancy-events';

describe('TenancyEventService integration with @nestjs/event-emitter', () => {
  it('should resolve EventEmitter2 from real EventEmitterModule', async () => {
    const module = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [TenancyEventService],
    }).compile();

    await module.init();

    const service = module.get(TenancyEventService);
    const emitter = module.get(EventEmitter2);

    const received: any[] = [];
    emitter.on(TenancyEvents.RESOLVED, (payload: any) => received.push(payload));

    service.emit(TenancyEvents.RESOLVED, {
      tenantId: 'test-tenant',
      requestSummary: { method: 'GET', path: '/users' },
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      tenantId: 'test-tenant',
      requestSummary: { method: 'GET', path: '/users' },
    });

    await module.close();
  });

  it('should emit multiple event types correctly', async () => {
    const module = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [TenancyEventService],
    }).compile();

    await module.init();

    const service = module.get(TenancyEventService);
    const emitter = module.get(EventEmitter2);

    const resolved: any[] = [];
    const notFound: any[] = [];
    emitter.on(TenancyEvents.RESOLVED, (p: any) => resolved.push(p));
    emitter.on(TenancyEvents.NOT_FOUND, (p: any) => notFound.push(p));

    service.emit(TenancyEvents.RESOLVED, { tenantId: 'a' });
    service.emit(TenancyEvents.NOT_FOUND, {});
    service.emit(TenancyEvents.RESOLVED, { tenantId: 'b' });

    expect(resolved).toHaveLength(2);
    expect(notFound).toHaveLength(1);

    await module.close();
  });

  it('should work without EventEmitterModule (graceful degradation)', async () => {
    const module = await Test.createTestingModule({
      providers: [TenancyEventService],
    }).compile();

    await module.init();

    const service = module.get(TenancyEventService);

    // Should not throw
    expect(() => service.emit(TenancyEvents.RESOLVED, { tenantId: 'test' })).not.toThrow();

    await module.close();
  });

  describe('listener failure isolation and dispatch compatibility', () => {
    let module: TestingModule;
    let service: TenancyEventService;
    let emitter: EventEmitter2;

    beforeEach(async () => {
      module = await Test.createTestingModule({
        imports: [EventEmitterModule.forRoot({ wildcard: true })],
        providers: [TenancyEventService],
      }).compile();
      await module.init();
      service = module.get(TenancyEventService);
      emitter = module.get(EventEmitter2);
    });

    afterEach(async () => {
      await module.close();
      jest.restoreAllMocks();
    });

    it('observes an async rejection even when a later listener throws synchronously', async () => {
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
      const asynchronousError = new Error('async listener failed');
      const synchronousError = new Error('sync listener failed');
      const laterListener = jest.fn();
      const asynchronousListener: () => unknown = async () => { throw asynchronousError; };
      emitter.on(TenancyEvents.RESOLVED, asynchronousListener);
      emitter.on(TenancyEvents.RESOLVED, () => { throw synchronousError; });
      emitter.on(TenancyEvents.RESOLVED, laterListener);

      expect(service.emit(TenancyEvents.RESOLVED, { tenantId: 'test' })).toBeUndefined();
      expect(laterListener).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(
        `Tenancy event listener failed for "${TenancyEvents.RESOLVED}"`,
        synchronousError.stack,
      );
      // Crossing the next turn also lets Jest detect an unhandled rejection.
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(error).toHaveBeenCalledTimes(2);
      expect(error).toHaveBeenCalledWith(
        `Tenancy event listener failed for "${TenancyEvents.RESOLVED}"`,
        asynchronousError.stack,
      );
    });

    it('observes rejecting onAny and wildcard once listeners without changing registrations', async () => {
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
      const anyError = new Error('onAny failed');
      const onceError = new Error('wildcard once failed');
      const anyListener: () => unknown = async () => { throw anyError; };
      const onceListener: () => unknown = async () => { throw onceError; };
      emitter.onAny(anyListener);
      emitter.once('tenant.*', onceListener);
      const emitMethod = emitter.emit;

      service.emit(TenancyEvents.RESOLVED, { tenantId: 'first' });
      service.emit(TenancyEvents.RESOLVED, { tenantId: 'second' });
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(error).toHaveBeenCalledTimes(3);
      expect(error.mock.calls.filter(([, stack]) => stack === onceError.stack)).toHaveLength(1);
      expect(error.mock.calls.filter(([, stack]) => stack === anyError.stack)).toHaveLength(2);
      expect(emitter.listenersAny()).toEqual([anyListener]);
      expect(emitter.listeners('tenant.*')).toEqual([]);
      expect(emitter.emit).toBe(emitMethod);
    });

    it('preserves synchronous delivery, listener context, wildcard and once behavior', async () => {
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
      const received: Array<{ kind: string; context: unknown; event: string; values: unknown[] }> = [];
      function anyListener(this: EventEmitter2 & { event: string }, ...values: unknown[]): void {
        received.push({ kind: 'any', context: this, event: this.event, values });
      }
      function wildcardListener(this: EventEmitter2 & { event: string }, ...values: unknown[]): void {
        received.push({ kind: 'wildcard', context: this, event: this.event, values });
      }
      function onceListener(this: EventEmitter2 & { event: string }, ...values: unknown[]): void {
        received.push({ kind: 'once', context: this, event: this.event, values });
      }
      emitter.onAny(anyListener);
      emitter.on('tenant.*', wildcardListener);
      emitter.once(TenancyEvents.RESOLVED, onceListener);
      const payload = { tenantId: 'test' };
      const before = emitter.listeners(TenancyEvents.RESOLVED).slice();

      expect(service.emit(TenancyEvents.RESOLVED, payload)).toBeUndefined();
      expect(received.map(({ kind }) => kind)).toEqual([
        'any', ...before.map((listener) => listener === wildcardListener ? 'wildcard' : 'once'),
      ]);
      expect(received.every(({ context, event }) => context === emitter && event === TenancyEvents.RESOLVED)).toBe(true);
      expect(received[0].values).toEqual([TenancyEvents.RESOLVED, payload]);
      expect(received.slice(1).every(({ values }) => values.length === 1 && values[0] === payload)).toBe(true);

      service.emit(TenancyEvents.RESOLVED, payload);
      expect(received.filter(({ kind }) => kind === 'once')).toHaveLength(1);
      expect(received.filter(({ kind }) => kind === 'wildcard')).toHaveLength(2);
      expect(emitter.listeners(TenancyEvents.RESOLVED)).toEqual([wildcardListener]);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(error).not.toHaveBeenCalled();
    });

    it('does not wait for an async listener before dispatching the next listener or returning', async () => {
      let finish: (() => void) | undefined;
      const pending = new Promise<void>((resolve) => { finish = resolve; });
      const order: string[] = [];
      const asynchronousListener: () => unknown = async () => {
        order.push('async started');
        await pending;
        order.push('async finished');
      };
      emitter.on(TenancyEvents.RESOLVED, asynchronousListener);
      emitter.on(TenancyEvents.RESOLVED, () => { order.push('next listener'); });

      expect(service.emit(TenancyEvents.RESOLVED, { tenantId: 'test' })).toBeUndefined();
      expect(order).toEqual(['async started', 'next listener']);
      finish?.();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(order).toEqual(['async started', 'next listener', 'async finished']);
    });

    it('snapshots listeners while retaining registrations added by onAny for the current emission', () => {
      const order: string[] = [];
      const removedDuringEmission = () => { order.push('removed'); };
      const addedDuringEmission = () => { order.push('added'); };
      emitter.onAny(() => {
        emitter.on(TenancyEvents.RESOLVED, addedDuringEmission);
      });
      emitter.on(TenancyEvents.RESOLVED, () => {
        order.push('first');
        emitter.off(TenancyEvents.RESOLVED, removedDuringEmission);
      });
      emitter.on(TenancyEvents.RESOLVED, removedDuringEmission);

      service.emit(TenancyEvents.RESOLVED, { tenantId: 'test' });

      expect(order).toEqual(['first', 'removed', 'added']);
      expect(emitter.listeners(TenancyEvents.RESOLVED)).not.toContain(removedDuringEmission);
      expect(emitter.listeners(TenancyEvents.RESOLVED)).toContain(addedDuringEmission);
    });
  });
});
