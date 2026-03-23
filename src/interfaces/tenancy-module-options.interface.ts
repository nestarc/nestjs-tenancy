import { Type } from '@nestjs/common';
import { ModuleMetadata } from '@nestjs/common/interfaces';
import { TenantExtractor } from './tenant-extractor.interface';

export interface TenancyModuleOptions {
  tenantExtractor: string | TenantExtractor;
  dbSettingKey?: string;
  validateTenantId?: (tenantId: string) => boolean | Promise<boolean>;
}

export interface TenancyModuleOptionsFactory {
  createTenancyOptions():
    | TenancyModuleOptions
    | Promise<TenancyModuleOptions>;
}

export interface TenancyModuleAsyncOptions
  extends Pick<ModuleMetadata, 'imports'> {
  inject?: any[];
  useFactory?: (
    ...args: any[]
  ) => TenancyModuleOptions | Promise<TenancyModuleOptions>;
  useClass?: Type<TenancyModuleOptionsFactory>;
  useExisting?: Type<TenancyModuleOptionsFactory>;
}
