import {
  tenancyTransactionCallback,
  TenancyContext,
  TenancyService,
  TenantContextMissingError,
  type PrismaTransactionContext,
} from '../src';

describe('tenancyTransactionCallback', () => {
  const context = new TenancyContext();
  const service = new TenancyService(context, undefined, {
    dbSettingKey: 'custom.tenant',
  });

  it('applies the invoking tenant on each transaction before running user code', async () => {
    interface ModelTransaction extends PrismaTransactionContext {
      invoice: { findMany(): Promise<string[]> };
    }
    const rowsA = ['invoice-a'];
    const txA = {
      $executeRaw: jest.fn(),
      invoice: { findMany: jest.fn(async () => rowsA) },
    };
    const txB = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      invoice: { findMany: jest.fn(async () => ['invoice-b']) },
    };
    let releaseTenantA!: (rowCount: number) => void;
    const pendingSetting = new Promise<number>((resolve) => { releaseTenantA = resolve; });
    txA.$executeRaw.mockReturnValue(pendingSetting);

    // A reusable callback can be constructed outside either request.
    const run = tenancyTransactionCallback(service, async (tx: ModelTransaction) => tx.invoice.findMany());
    const resultA: Promise<string[]> = context.run('tenant-a', () => run(txA));
    const resultB = await context.run('tenant-b', () => run(txB));

    expect(resultB).toEqual(['invoice-b']);
    for (const [sqlCall, tenant] of [
      [txA.$executeRaw.mock.calls[0], 'tenant-a'],
      [txB.$executeRaw.mock.calls[0], 'tenant-b'],
    ] as const) {
      const [template, ...bindings] = sqlCall;
      expect(template.raw).toEqual(expect.any(Array));
      expect(bindings).toEqual(['custom.tenant', tenant, 'custom.tenant', 'custom.tenant', tenant]);
    }
    expect(txA.invoice.findMany).not.toHaveBeenCalled();
    releaseTenantA(1);
    expect(await resultA).toBe(rowsA);
    expect(txA.invoice.findMany).toHaveBeenCalledTimes(1);
    expect(txB.invoice.findMany).toHaveBeenCalledTimes(1);
  });

  it('requires a tenant and rejects mismatched settings before issuing SQL', async () => {
    const tx = { $executeRaw: jest.fn() };
    const work = jest.fn(async () => 'unexpected');
    const run = tenancyTransactionCallback(service, work);

    await expect(run(tx)).rejects.toBeInstanceOf(TenantContextMissingError);
    await expect(service.withoutTenant(() => run(tx))).rejects.toBeInstanceOf(TenantContextMissingError);
    await expect(context.run('tenant-a', async () => {
      const mismatched = tenancyTransactionCallback(service, work, { dbSettingKey: 'other.tenant' });
      return mismatched(tx);
    })).rejects.toThrow(/dbSettingKey mismatch/);

    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
  });

  it('propagates setup failure to the transaction owner before calling user code', async () => {
    const failure = new Error('unable to set tenant');
    const tx = { $executeRaw: jest.fn().mockRejectedValue(failure) };
    const work = jest.fn(async () => 'unexpected');
    const run = tenancyTransactionCallback(service, work);

    await expect(context.run('tenant-a', () => run(tx))).rejects.toBe(failure);
    expect(work).not.toHaveBeenCalled();
  });

  it('rejects a root client before issuing SQL or running user code', async () => {
    const root = { $connect: jest.fn(), $transaction: jest.fn(), $executeRaw: jest.fn() };
    const work = jest.fn(async () => 'unexpected');
    const run = tenancyTransactionCallback(service, work);

    await expect(context.run('tenant-a', () => run(root))).rejects.toThrow(/transaction client/i);
    expect(root.$transaction).not.toHaveBeenCalled();
    expect(root.$executeRaw).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
  });

  it('rejects a transaction already bound to a different tenant', async () => {
    const tx = { $executeRaw: jest.fn().mockResolvedValue(0) };
    const work = jest.fn(async () => 'unexpected');
    const run = tenancyTransactionCallback(service, work);

    await expect(context.run('tenant-a', () => run(tx))).rejects.toThrow(/already bound/i);
    expect(work).not.toHaveBeenCalled();
  });

  it('keeps user work from running when the owner discards the binding row count', async () => {
    const tx = { $executeRaw: jest.fn().mockResolvedValue(undefined) };
    const work = jest.fn(async () => 'unexpected');
    const run = tenancyTransactionCallback(service, work);

    await expect(context.run('tenant-a', () => run(tx))).rejects.toThrow();
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(work).not.toHaveBeenCalled();
  });

  it('forwards the exact transaction and propagates a business error to its owner', async () => {
    const failure = new Error('write failed');
    const tx = { $executeRaw: jest.fn().mockResolvedValue(1) };
    const work = jest.fn(async (_tx: PrismaTransactionContext) => { throw failure; });
    const run = tenancyTransactionCallback(service, work);

    await expect(context.run('tenant-a', () => run(tx))).rejects.toBe(failure);
    expect(work.mock.calls[0][0]).toBe(tx);
  });
});
