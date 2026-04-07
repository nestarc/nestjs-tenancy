import { TenancyService } from '../services/tenancy.service';
import { DEFAULT_DB_SETTING_KEY } from '../tenancy.constants';

export interface TenancyTransactionOptions {
  timeout?: number;
  /** PostgreSQL transaction isolation level. */
  isolationLevel?: 'ReadUncommitted' | 'ReadCommitted' | 'RepeatableRead' | 'Serializable';
  dbSettingKey?: string;
}

/**
 * Executes a Prisma interactive transaction with RLS tenant context.
 *
 * Runs `set_config()` as the first statement inside the interactive
 * transaction, ensuring the PostgreSQL session variable is set on the
 * same connection that executes the callback queries.
 *
 * @param prisma - PrismaClient instance (not extended — raw client)
 * @param tenancyService - TenancyService to read current tenant
 * @param callback - Function receiving the transaction client
 * @param options - Transaction timeout, isolation level, and DB setting key
 */
export async function tenancyTransaction<T>(
  prisma: any,
  tenancyService: TenancyService,
  callback: (tx: any) => Promise<T>,
  options?: TenancyTransactionOptions,
): Promise<T> {
  const tenantId = tenancyService.getCurrentTenantOrThrow();
  const settingKey = options?.dbSettingKey ?? DEFAULT_DB_SETTING_KEY;

  return prisma.$transaction(
    async (tx: any) => {
      await tx.$executeRaw`SELECT set_config(${settingKey}, ${tenantId}, TRUE)`;
      return callback(tx);
    },
    {
      ...(options?.timeout !== undefined && { timeout: options.timeout }),
      ...(options?.isolationLevel !== undefined && {
        isolationLevel: options.isolationLevel,
      }),
    },
  );
}
