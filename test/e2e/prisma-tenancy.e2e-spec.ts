import { Client } from 'pg';
import { TenancyContext } from '../../src/services/tenancy-context';
import { TenancyService } from '../../src/services/tenancy.service';

const TENANT_1 = '11111111-1111-1111-1111-111111111111';
const TENANT_2 = '22222222-2222-2222-2222-222222222222';
const TENANT_3 = '33333333-3333-3333-3333-333333333333';

// Non-superuser connection — RLS applies to this role
const APP_URL =
  process.env.APP_DATABASE_URL ?? 'postgresql://app_user:app_user@localhost:5433/tenancy_test';

/**
 * E2E tests verifying PostgreSQL RLS with real database.
 *
 * Setup/teardown handled by global-setup.ts / global-teardown.ts.
 * Key: RLS only applies to non-superuser roles. We use:
 * - `tenancy` (superuser) for setup/teardown (global)
 * - `app_user` (non-superuser) for all RLS queries
 */
describe('PostgreSQL RLS Integration', () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: APP_URL });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  it('should return only tenant 1 rows with SET LOCAL', async () => {
    await client.query('BEGIN');
    await client.query(`SET LOCAL "app.current_tenant" = '${TENANT_1}'`);
    const result = await client.query('SELECT * FROM users');
    await client.query('COMMIT');

    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((r: any) => r.tenant_id === TENANT_1)).toBe(true);
    expect(result.rows.map((r: any) => r.name).sort()).toEqual(['Alice', 'Bob']);
  });

  it('should return only tenant 2 rows with SET LOCAL', async () => {
    await client.query('BEGIN');
    await client.query(`SET LOCAL "app.current_tenant" = '${TENANT_2}'`);
    const result = await client.query('SELECT * FROM users');
    await client.query('COMMIT');

    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((r: any) => r.tenant_id === TENANT_2)).toBe(true);
  });

  it('should return only tenant 3 rows (single row)', async () => {
    await client.query('BEGIN');
    await client.query(`SET LOCAL "app.current_tenant" = '${TENANT_3}'`);
    const result = await client.query('SELECT * FROM users');
    await client.query('COMMIT');

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].name).toBe('Eve');
  });

  it('should return no rows without SET LOCAL (RLS enforced)', async () => {
    const result = await client.query('SELECT * FROM users');
    expect(result.rows).toHaveLength(0);
  });

  it('should not leak tenant context after COMMIT', async () => {
    await client.query('BEGIN');
    await client.query(`SET LOCAL "app.current_tenant" = '${TENANT_1}'`);
    const during = await client.query('SELECT count(*) as cnt FROM users');
    await client.query('COMMIT');

    expect(parseInt(during.rows[0].cnt)).toBe(2);

    // After commit, SET LOCAL is gone — no rows visible
    const after = await client.query('SELECT count(*) as cnt FROM users');
    expect(parseInt(after.rows[0].cnt)).toBe(0);
  });

  it('should isolate concurrent transactions', async () => {
    const client2 = new Client({ connectionString: APP_URL });
    await client2.connect();

    await client.query('BEGIN');
    await client.query(`SET LOCAL "app.current_tenant" = '${TENANT_1}'`);

    await client2.query('BEGIN');
    await client2.query(`SET LOCAL "app.current_tenant" = '${TENANT_2}'`);

    const result1 = await client.query('SELECT * FROM users');
    const result2 = await client2.query('SELECT * FROM users');

    await client.query('COMMIT');
    await client2.query('COMMIT');
    await client2.end();

    expect(result1.rows.every((r: any) => r.tenant_id === TENANT_1)).toBe(true);
    expect(result2.rows.every((r: any) => r.tenant_id === TENANT_2)).toBe(true);
    expect(result1.rows).toHaveLength(2);
    expect(result2.rows).toHaveLength(2);
  });
});

describe('TenancyContext + RLS Integration', () => {
  let client: Client;
  let context: TenancyContext;
  let service: TenancyService;

  beforeAll(async () => {
    client = new Client({ connectionString: APP_URL });
    await client.connect();
    context = new TenancyContext();
    service = new TenancyService(context);
  });

  afterAll(async () => {
    await client.end();
  });

  it('should use TenancyService tenant in SET LOCAL', async () => {
    await new Promise<void>((resolve, reject) => {
      context.run(TENANT_1, async () => {
        try {
          const tenantId = service.getCurrentTenantOrThrow();

          await client.query('BEGIN');
          await client.query(
            `SET LOCAL "app.current_tenant" = '${tenantId}'`,
          );
          const result = await client.query('SELECT * FROM users');
          await client.query('COMMIT');

          expect(result.rows).toHaveLength(2);
          expect(
            result.rows.every((r: any) => r.tenant_id === TENANT_1),
          ).toBe(true);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });

  it('should return null tenant outside context', () => {
    expect(service.getCurrentTenant()).toBeNull();
  });
});
