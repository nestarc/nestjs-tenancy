import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import generated from './generated/index.js';
import { createAuditExtension, getAuditTableStatements } from '@nestarc/audit-log';
import { createPrismaSoftDeleteExtension, SoftDeleteService } from '@nestarc/soft-delete';
import { TenancyContext, TenancyService, tenancyTransactionCallback } from '@nestarc/tenancy';

const { Prisma, PrismaClient } = generated;

async function verify() {
  const admin = new Client({ connectionString: process.env.DATABASE_URL });
  const base = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.APP_DATABASE_URL, max: 2 }),
  });
  const context = new TenancyContext();
  const tenancy = new TenancyService(context);
  const lifecycle = { softDeleteModels: ['Document'], auditLifecycle: 'atomic-required' };
  const client = base.$extends(createAuditExtension({
    consistency: 'atomic-required',
    trackedModels: ['Document'],
    databaseMapping: { Document: { tableName: 'documents' } },
    tenantRequired: true,
    tenantResolver: () => tenancy.getCurrentTenantOrThrow(),
    prismaModule: { Prisma },
  })).$extends(createPrismaSoftDeleteExtension(lifecycle));
  const softDelete = new SoftDeleteService(lifecycle, client, null, null);
  const transact = (tenant, work) => context.run(tenant, () =>
    client.withAuditTransaction(tenancyTransactionCallback(tenancy, work)),
  );
  const audits = async () => (await admin.query(
    'SELECT tenant_id, target_id, action FROM audit_logs ORDER BY tenant_id, action',
  )).rows;
  const deletedAt = async (id) => (await admin.query(
    'SELECT deleted_at FROM documents WHERE id = $1', [id],
  )).rows[0].deleted_at;

  await admin.connect();
  try {
    for (const statement of getAuditTableStatements()) await admin.query(statement);
    await admin.query(fs.readFileSync(path.join(import.meta.dirname, 'setup.sql'), 'utf8'));

    let calls = 0;
    const work = async () => { calls += 1; };
    for (const root of [base, client]) {
      await context.run('A', () => assert.rejects(tenancyTransactionCallback(tenancy, work)(root), /transaction client/i));
    }
    await transact('A', async (tx) => {
      await context.run('B', () => assert.rejects(tenancyTransactionCallback(tenancy, work)(tx), /another tenant/i));
      const [setting] = await tx.$queryRaw`SELECT current_setting('app.current_tenant') AS tenant`;
      assert.equal(setting.tenant, 'A');
    });
    assert.equal(calls, 0);

    // Both transactions must have checked out connections before either issues a model query.
    const ready = Promise.withResolvers();
    let entered = 0;
    await Promise.all([['A', 'a'], ['B', 'b']].map(([tenant, id]) =>
      transact(tenant, async (tx) => {
        entered += 1;
        if (entered === 2) ready.resolve();
        await ready.promise;
        const visible = await tx.document.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
        assert.deepEqual(visible.map(row => row.id), tenant === 'A' ? ['a', 'a-fail'] : ['b']);
        await tx.document.delete({ where: { id } });
      }),
    ));
    assert.ok(await deletedAt('a') instanceof Date);
    assert.ok(await deletedAt('b') instanceof Date);
    assert.deepEqual(await audits(), [
      { tenant_id: 'A', target_id: 'a', action: 'Document.softDeleted' },
      { tenant_id: 'B', target_id: 'b', action: 'Document.softDeleted' },
    ]);

    await assert.rejects(transact('A', () => softDelete.restore('Document', { id: 'b' })), /not found/i);
    assert.ok(await deletedAt('b') instanceof Date);
    await transact('B', () => softDelete.restore('Document', { id: 'b' }));
    assert.equal(await deletedAt('b'), null);
    const committed = await audits();
    assert.deepEqual(committed, [
      { tenant_id: 'A', target_id: 'a', action: 'Document.softDeleted' },
      { tenant_id: 'B', target_id: 'b', action: 'Document.restored' },
      { tenant_id: 'B', target_id: 'b', action: 'Document.softDeleted' },
    ]);

    await assert.rejects(transact('A', async (tx) => {
      await softDelete.restore('Document', { id: 'a' });
      await tx.document.delete({ where: { id: 'a-fail' } });
    }), /reject_fixture_audit/);
    assert.ok(await deletedAt('a') instanceof Date);
    assert.equal(await deletedAt('a-fail'), null);
    assert.deepEqual(await audits(), committed);
    assert.deepEqual(await base.document.findMany(), []); // pooled connections have no tenant
  } finally {
    await Promise.all([base.$disconnect(), admin.end()]);
  }
}

verify().then(() => console.log('Verified PostgreSQL tenant isolation and atomic audit lifecycle.'))
  .catch(error => { console.error(error); process.exitCode = 1; });
