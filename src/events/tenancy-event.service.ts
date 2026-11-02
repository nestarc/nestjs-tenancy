import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { TenancyEventMap } from './tenancy-events';

/**
 * Optional event emission service that integrates with @nestjs/event-emitter.
 *
 * If `@nestjs/event-emitter` is installed and `EventEmitterModule.forRoot()`
 * is imported, events are emitted via EventEmitter2.
 * If not installed, all emit() calls are silently ignored.
 * Emission remains synchronous; returned Promises are observed without delaying
 * the caller. Synchronous throws and Promise rejections are logged.
 */
@Injectable()
export class TenancyEventService implements OnModuleInit {
  private readonly logger = new Logger(TenancyEventService.name);
  private emitter: (Pick<EventEmitter2, 'listeners' | 'listenersAny'> & {
    /** EventEmitter2 exposes the current event to listeners as `this.event`. */
    event?: string;
  }) | null = null;

  constructor(private readonly moduleRef: ModuleRef) {}

  async onModuleInit() {
    try {
      // EventEmitter2 is registered as a class token, not a string token.
      // Dynamic import avoids making @nestjs/event-emitter a hard dependency.
      const { EventEmitter2 } = await import('@nestjs/event-emitter');
      this.emitter = this.moduleRef.get(EventEmitter2, { strict: false });
    } catch {
      // @nestjs/event-emitter not installed or not imported — events silently skip
    }
  }

  emit<K extends keyof TenancyEventMap>(event: K, payload: TenancyEventMap[K]): void {
    const emitter = this.emitter;
    if (!emitter) return;

    const reportError = (error: unknown): void => {
      this.logger.error(
        `Tenancy event listener failed for "${String(event)}"`,
        error instanceof Error ? error.stack : undefined,
      );
    };

    try {
      const invoke = (listener: (...values: unknown[]) => unknown, values: unknown[]): void => {
        emitter.event = event;
        // Observe each result before calling the next listener. emitAsync()
        // cannot do this if a later listener throws before its Promise.all().
        void Promise.resolve(listener.apply(emitter, values)).catch(reportError);
      };

      // Match EventEmitter2's emit order and snapshots without changing its
      // registrations. The returned listeners retain once/many wrappers.
      for (const listener of emitter.listenersAny().slice()) {
        invoke(listener, [event, payload]);
      }
      for (const listener of emitter.listeners(event).slice()) {
        invoke(listener, [payload]);
      }
    } catch (error) {
      // Preserve emit's stop-on-synchronous-throw behavior for this emission.
      reportError(error);
    }
  }
}
