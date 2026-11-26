import { TenancyService } from '../services/tenancy.service';

/**
 * Minimal transaction client shape for the tenancy transaction helpers.
 */
export interface PrismaTransactionContext {
  $executeRaw(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown>;
}

/**
 * Structural type representing a Prisma-like client that supports
 * interactive transactions. `PrismaClient` satisfies this automatically.
 */
export interface PrismaTransactionClient<TTx extends PrismaTransactionContext = any> {
  $transaction<T>(
    fn: (tx: TTx) => Promise<T>,
    options?: Record<string, unknown>,
  ): Promise<T>;
}

export interface TenancyTransactionOptions {
  /**
   * Maximum time in milliseconds to wait for Prisma to start the transaction.
   * Forwarded to Prisma; enforcement depends on the selected Prisma runtime.
   */
  maxWait?: number;
  /** Maximum time in milliseconds the interactive transaction may run. */
  timeout?: number;
  /** PostgreSQL transaction isolation level. */
  isolationLevel?: 'ReadUncommitted' | 'ReadCommitted' | 'RepeatableRead' | 'Serializable';
  /**
   * Optional compatibility assertion for the canonical setting configured on
   * `TenancyService`. Omit it when using `TenancyModule`.
   */
  dbSettingKey?: string;
}

/**
 * Wrap the callback of an existing interactive transaction (for example,
 * audit-log's withAuditTransaction). Pass it directly to the transaction owner.
 * Each invocation binds the current tenant before running work on that same tx.
 * A different tenant already bound to the configured setting is rejected.
 * If the owner wraps the transaction client, forward the row count returned by
 * Prisma's `$executeRaw`. The binding must report exactly one row before the
 * callback can run.
 *
 * Use a client without the per-query tenancy extension for this transaction.
 * Its owner controls commit, rollback, timeout and isolation. Keep the same
 * authorized tenant for its lifetime and write tenant fields explicitly.
 */
export function tenancyTransactionCallback<TTx extends PrismaTransactionContext, TResult>(
  tenancyService: TenancyService,
  callback: (tx: TTx) => Promise<TResult>,
  options?: Pick<TenancyTransactionOptions, 'dbSettingKey'>,
): (tx: TTx) => Promise<TResult> {
  return async (tx) => {
    const settingKey = tenancyService.resolveDbSettingKey(options?.dbSettingKey);
    const tenantId = tenancyService.getCurrentTenantOrThrow();
    // Prisma 7 can expose nested $transaction on an interactive client.
    // $connect belongs to the root client in both Prisma 6 and 7.
    if ('$connect' in tx && typeof tx.$connect === 'function') {
      throw new TypeError('Expected the interactive transaction client passed by the transaction owner.');
    }

    // A pooled connection can carry an empty custom setting after a prior
    // transaction. Check and set it in one statement on the owner's connection.
    const count = await tx.$executeRaw`
      SELECT set_config(${settingKey}, ${tenantId}, TRUE)
      WHERE NULLIF(current_setting(${settingKey}, TRUE), '') IS NULL
         OR current_setting(${settingKey}, TRUE) = ${tenantId}
    `;
    if (count !== 1) {
      throw new Error('The transaction is already bound to another tenant.');
    }
    return callback(tx);
  };
}

/**
 * Opens a Prisma interactive transaction on the raw root client and binds the
 * current tenant. When another component opens the transaction, pass
 * `tenancyTransactionCallback()` to that owner.
 *
 * Runs `set_config()` as the first statement inside the interactive
 * transaction, ensuring the PostgreSQL session variable is set on the
 * same connection that executes the callback queries.
 *
 * @param prisma - Raw root Prisma client
 * @param tenancyService - TenancyService to read current tenant
 * @param callback - Function receiving the transaction client
 * @param options - Transaction wait/timeout, isolation level, and DB setting key
 */
export async function tenancyTransaction<
  T,
  TTx extends PrismaTransactionContext = any,
>(
  prisma: PrismaTransactionClient<TTx>,
  tenancyService: TenancyService,
  callback: (tx: TTx) => Promise<T>,
  options?: TenancyTransactionOptions,
): Promise<T> {
  const settingKey = tenancyService.resolveDbSettingKey(
    options?.dbSettingKey,
  );
  const tenantId = tenancyService.getCurrentTenantOrThrow();

  return prisma.$transaction(
    async (tx: TTx) => {
      await tx.$executeRaw`SELECT set_config(${settingKey}, ${tenantId}, TRUE)`;
      return callback(tx);
    },
    {
      ...(options?.maxWait !== undefined && { maxWait: options.maxWait }),
      ...(options?.timeout !== undefined && { timeout: options.timeout }),
      ...(options?.isolationLevel !== undefined && {
        isolationLevel: options.isolationLevel,
      }),
    },
  );
}
