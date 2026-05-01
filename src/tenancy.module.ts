import {
  DynamicModule,
  MiddlewareConsumer,
  Module,
  NestModule,
  Provider,
  RequestMethod,
  Type,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import {
  TenancyModuleAsyncOptions,
  TenancyModuleOptions,
  TenancyModuleOptionsFactory,
} from './interfaces/tenancy-module-options.interface';
import { TenancyContext } from './services/tenancy-context';
import { TenancyService } from './services/tenancy.service';
import { TenantMiddleware } from './middleware/tenant.middleware';
import { TenancyGuard } from './guards/tenancy.guard';
import { TenancyEventService } from './events/tenancy-event.service';
import { TenancyTelemetryService } from './telemetry/tenancy-telemetry.service';
import { TENANCY_MODULE_OPTIONS } from './tenancy.constants';

@Module({})
export class TenancyModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(TenantMiddleware)
      .forRoutes({ path: '{*splat}', method: RequestMethod.ALL });
  }

  static forRoot(options: TenancyModuleOptions): DynamicModule {
    return this.buildModule([
      { provide: TENANCY_MODULE_OPTIONS, useValue: options },
    ]);
  }

  static forRootAsync(options: TenancyModuleAsyncOptions): DynamicModule {
    return this.buildModule(
      this.createAsyncProviders(options),
      options.imports || [],
    );
  }

  private static buildModule(
    optionsProviders: Provider[],
    imports: TenancyModuleAsyncOptions['imports'] = [],
  ): DynamicModule {
    return {
      module: TenancyModule,
      global: true,
      imports,
      providers: [
        ...optionsProviders,
        TenancyContext,
        TenancyService,
        TenancyEventService,
        TenancyTelemetryService,
        { provide: APP_GUARD, useClass: TenancyGuard },
      ],
      exports: [TenancyService, TenancyEventService, TenancyTelemetryService, TENANCY_MODULE_OPTIONS],
    };
  }

  private static createAsyncProviders(
    options: TenancyModuleAsyncOptions,
  ): Provider[] {
    if (options.useFactory) {
      return [
        {
          provide: TENANCY_MODULE_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject || [],
        },
      ];
    }

    const useClass = options.useClass as Type<TenancyModuleOptionsFactory>;
    if (useClass) {
      return [
        {
          provide: TENANCY_MODULE_OPTIONS,
          useFactory: (factory: TenancyModuleOptionsFactory) =>
            factory.createTenancyOptions(),
          inject: [useClass],
        },
        { provide: useClass, useClass },
      ];
    }

    if (options.useExisting) {
      return [
        {
          provide: TENANCY_MODULE_OPTIONS,
          useFactory: (factory: TenancyModuleOptionsFactory) =>
            factory.createTenancyOptions(),
          inject: [options.useExisting],
        },
      ];
    }

    throw new Error(
      '[TenancyModule] forRootAsync requires one of: useFactory, useClass, or useExisting',
    );
  }
}
