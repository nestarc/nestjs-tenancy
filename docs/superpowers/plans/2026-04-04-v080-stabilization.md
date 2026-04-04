# v0.8.0 Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all v0.7.0 validation report issues — build breakage, missing regression tests, E2E coverage gap, and version bump — to produce a clean, fully-tested 0.8.0 release.

**Architecture:** No architectural changes. This is a stabilization release. All code fixes (span lifecycle, CLI check) were already applied in v0.7.0 review commits. The remaining work is: (1) fix the broken dependency install, (2) add regression tests for the already-applied fixes, (3) add ITX E2E coverage, (4) version bump.

**Tech Stack:** TypeScript, Jest, NestJS, Prisma, PostgreSQL (E2E only), `@opentelemetry/api` (optional peer dep)

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| No change | `src/telemetry/tenancy-telemetry.service.ts` | OTel integration (code already correct) |
| No change | `src/middleware/tenant.middleware.ts` | Span try/finally already applied |
| No change | `src/cli/check.ts` | matchAll + dbSettingKey already applied |
| No change | `src/cli/index.ts` | --db-setting-key flag parsing already applied |
| No change | `README.md` | Cross-check + telemetry + 5 events already documented |
| Modify | `test/tenant.middleware.spec.ts` | Add span lifecycle regression test |
| Modify | `test/cli/check.spec.ts` | Add mixed-key + custom dbSettingKey tests |
| Modify | `test/e2e/prisma-extension.e2e-spec.ts` | Add ITX E2E test |
| Modify | `package.json` | Version bump 0.7.0 → 0.8.0 |
| Modify | `CHANGELOG.md` | Add 0.8.0 entry |

---

### Task 1: Fix OTel dependency — restore build and tests

The `@opentelemetry/api` package is declared in `devDependencies` but not installed in `node_modules`. This blocks the TypeScript compiler from resolving the dynamic import in `tenancy-telemetry.service.ts`.

**Files:**
- No file changes needed — `package.json` already lists the dependency

- [ ] **Step 1: Install dependencies**

Run:
```bash
npm install
```

- [ ] **Step 2: Verify build passes**

Run:
```bash
npm run build
```

Expected: Exit 0, no `TS2307` errors.

- [ ] **Step 3: Verify all tests pass**

Run:
```bash
npm test
```

Expected: 32 suites, 0 failures (previously 3 suites failed with `TS2307`).

- [ ] **Step 4: Verify lint passes**

Run:
```bash
npm run lint
```

Expected: Exit 0.

- [ ] **Step 5: Commit if package-lock.json changed**

```bash
# Only if npm install modified package-lock.json:
git add package-lock.json
git commit -m "fix: install @opentelemetry/api devDependency to restore build"
```

---

### Task 2: Add span lifecycle regression test

The middleware already wraps `endSpan()` in a `finally` block (`tenant.middleware.ts:85-91`), but no test verifies this behavior when `onTenantResolved` throws.

**Files:**
- Modify: `test/tenant.middleware.spec.ts` (add test inside the "Lifecycle Hooks" describe block, after the "should propagate error from hook" test at line 165)

- [ ] **Step 1: Write the failing test**

Add this test after line 165 in `test/tenant.middleware.spec.ts`, inside the `Lifecycle Hooks` describe block:

```typescript
    it('should end telemetry span even when onTenantResolved throws', async () => {
      const mockSpan = { end: jest.fn() };
      const mockTelemetry = {
        setTenantAttribute: jest.fn(),
        startSpan: jest.fn().mockReturnValue(mockSpan),
        endSpan: jest.fn(),
      };
      const options: TenancyModuleOptions = {
        tenantExtractor: 'x-tenant-id',
        onTenantResolved: async () => { throw new Error('hook failed'); },
      };
      const mw = new TenantMiddleware(
        options,
        new TenancyContext(),
        createMockEventService(),
        mockTelemetry as any,
      );

      await expect(
        new Promise((resolve, reject) => {
          mw.use(
            mockReq({ 'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000' }),
            mockRes(),
            resolve,
          ).catch(reject);
        }),
      ).rejects.toThrow('hook failed');

      expect(mockTelemetry.startSpan).toHaveBeenCalledWith('tenant.resolved');
      expect(mockTelemetry.endSpan).toHaveBeenCalledWith(mockSpan);
    });
```

- [ ] **Step 2: Run test to verify it passes**

Run:
```bash
npx jest test/tenant.middleware.spec.ts --verbose
```

Expected: All tests pass, including the new one. (The fix is already in place — the test just confirms it.)

- [ ] **Step 3: Commit**

```bash
git add test/tenant.middleware.spec.ts
git commit -m "test: add regression test for span cleanup on hook failure"
```

---

### Task 3: Add CLI check regression tests

Two test gaps exist: (a) custom `dbSettingKey` via `runCheck()`, and (b) mixed `current_setting()` keys in the same SQL file. Both code paths already work (matchAll + dbSettingKey parameter), but lack test coverage.

**Files:**
- Modify: `test/cli/check.spec.ts` (add tests inside the "deep checks" describe block, after the existing "should warn when setting key does not match" test at line 264)

- [ ] **Step 1: Write the mixed-key test**

Add this test after line 264 in `test/cli/check.spec.ts`, inside the `deep checks` describe block:

```typescript
    it('should detect mixed setting keys (first correct, second wrong)', () => {
      writeSchema(`
model User {
  id String @id
  tenant_id String
}
model Post {
  id String @id
  tenant_id String
}
      `);

      // Manually craft SQL: User has correct key, Post has wrong key
      const sql = [
        'ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;',
        'ALTER TABLE "User" FORCE ROW LEVEL SECURITY;',
        "CREATE POLICY tenant_isolation_User ON \"User\"",
        "  USING (tenant_id = current_setting('app.current_tenant', true)::text);",
        "CREATE POLICY tenant_insert_User ON \"User\"",
        "  FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::text);",
        'ALTER TABLE "Post" ENABLE ROW LEVEL SECURITY;',
        'ALTER TABLE "Post" FORCE ROW LEVEL SECURITY;',
        "CREATE POLICY tenant_isolation_Post ON \"Post\"",
        "  USING (tenant_id = current_setting('app.wrong_key', true)::text);",
        "CREATE POLICY tenant_insert_Post ON \"Post\"",
        "  FOR INSERT WITH CHECK (tenant_id = current_setting('app.wrong_key', true)::text);",
      ].join('\n');
      writeSql(sql);

      const result = runCheck({ cwd: tmpDir });
      expect(result.inSync).toBe(false);
      expect(result.warnings).toContainEqual(
        expect.stringContaining('Setting key mismatch'),
      );
      // Should find at least 2 mismatches (isolation + insert policy for Post)
      const keyWarnings = result.warnings.filter(w => w.includes('Setting key mismatch'));
      expect(keyWarnings.length).toBeGreaterThanOrEqual(2);
    });
```

- [ ] **Step 2: Write the custom dbSettingKey test**

Add this test right after the previous one:

```typescript
    it('should accept custom dbSettingKey and validate against it', () => {
      writeSchema(`
model User {
  id String @id
  tenant_id String
}
      `);

      const sql = generateSetupSql({
        models: [{ modelName: 'User', tableName: 'User' }],
        dbSettingKey: 'custom.tenant_key',
        sharedModels: [],
        tenantIdField: 'tenant_id',
      });
      writeSql(sql);

      // With matching custom key — should be in sync
      const result = runCheck({ cwd: tmpDir, dbSettingKey: 'custom.tenant_key' });
      expect(result.inSync).toBe(true);
      expect(result.warnings).toHaveLength(0);

      // With default key — should report mismatch
      const resultDefault = runCheck({ cwd: tmpDir });
      expect(resultDefault.inSync).toBe(false);
      expect(resultDefault.warnings).toContainEqual(
        expect.stringContaining('Setting key mismatch'),
      );
    });
```

- [ ] **Step 3: Run tests to verify they pass**

Run:
```bash
npx jest test/cli/check.spec.ts --verbose
```

Expected: All tests pass (code already handles these cases correctly).

- [ ] **Step 4: Commit**

```bash
git add test/cli/check.spec.ts
git commit -m "test: add CLI check regression tests for mixed keys and custom dbSettingKey"
```

---

### Task 4: Add interactiveTransactionSupport E2E test

The ITX feature relies on Prisma internal APIs (`_createItxClient`, `__internalParams`) but only has unit tests with mocks. Add a real-database E2E test.

**Files:**
- Modify: `test/e2e/prisma-extension.e2e-spec.ts` (add a new describe block after the existing `tenancyTransaction() E2E` block at line 275)

- [ ] **Step 1: Write the E2E test**

Add this describe block at the end of `test/e2e/prisma-extension.e2e-spec.ts` (after line 275):

```typescript
describe('interactiveTransactionSupport E2E', () => {
  let context: TenancyContext;
  let service: TenancyService;
  let prisma: any;

  beforeAll(async () => {
    const PrismaClient = require(path.join(__dirname, 'generated')).PrismaClient;
    context = new TenancyContext();
    service = new TenancyService(context);

    const basePrisma = new PrismaClient({ datasourceUrl: APP_URL });
    prisma = basePrisma.$extends(
      createPrismaTenancyExtension(service, {
        interactiveTransactionSupport: true,
      }),
    );

    await prisma.$connect();
  }, 30000);

  afterAll(async () => {
    await sharedAdminClient.query(`DELETE FROM users WHERE name = 'ItxTest'`);
    if (prisma) await prisma.$disconnect();
  });

  it('should apply RLS inside interactive transaction with ITX support', async () => {
    const rows = await new Promise<any[]>((resolve, reject) => {
      context.run(TENANT_1, async () => {
        try {
          resolve(await prisma.$transaction(async (tx: any) => {
            return tx.user.findMany();
          }));
        } catch (e) { reject(e); }
      });
    });

    expect(rows).toHaveLength(2);
    expect(rows.every((r: any) => r.tenant_id === TENANT_1)).toBe(true);
  });

  it('should isolate tenants in interactive transaction with ITX support', async () => {
    const rows = await new Promise<any[]>((resolve, reject) => {
      context.run(TENANT_2, async () => {
        try {
          resolve(await prisma.$transaction(async (tx: any) => {
            return tx.user.findMany();
          }));
        } catch (e) { reject(e); }
      });
    });

    expect(rows).toHaveLength(2);
    expect(rows.every((r: any) => r.tenant_id === TENANT_2)).toBe(true);
  });

  it('should support writes in interactive transaction with ITX support', async () => {
    const user = await new Promise<any>((resolve, reject) => {
      context.run(TENANT_1, async () => {
        try {
          resolve(await prisma.$transaction(async (tx: any) => {
            return tx.user.create({
              data: { name: 'ItxTest', email: 'itx@test.com', tenant_id: TENANT_1 },
            });
          }));
        } catch (e) { reject(e); }
      });
    });

    expect(user.name).toBe('ItxTest');
    expect(user.tenant_id).toBe(TENANT_1);
  });
});
```

- [ ] **Step 2: Verify unit tests still pass**

Run:
```bash
npm test
```

Expected: All 32+ suites pass. (E2E tests are excluded from `npm test` by default.)

- [ ] **Step 3: Commit**

```bash
git add test/e2e/prisma-extension.e2e-spec.ts
git commit -m "test: add interactiveTransactionSupport E2E tests"
```

> **Note:** To run this test locally: `npm run test:e2e` (requires Docker with PostgreSQL). The test may fail if the Prisma version's internal APIs have changed — this is the intended safety net.

---

### Task 5: Version bump + CHANGELOG

**Files:**
- Modify: `package.json:3` (version field)
- Modify: `CHANGELOG.md` (add 0.8.0 block at the top)

- [ ] **Step 1: Bump version in package.json**

Change line 3 of `package.json`:

```diff
-  "version": "0.7.0",
+  "version": "0.8.0",
```

- [ ] **Step 2: Add CHANGELOG entry**

Insert the following block after line 6 of `CHANGELOG.md` (before the `## [0.7.0]` line):

```markdown
## [0.8.0] - 2026-04-04

### Fixed

- **Build regression** — `@opentelemetry/api` was declared as a devDependency but not installed, causing `TS2307` build failures on clean checkout. Now properly installed and verified.

### Added

- **Span lifecycle regression test** — verifies that the `tenant.resolved` telemetry span is closed (via `finally`) even when `onTenantResolved` hook throws.
- **CLI check regression tests** — verifies mixed `current_setting()` key detection across multiple policies, and validates that `--db-setting-key` custom flag works end-to-end.
- **interactiveTransactionSupport E2E test** — real-database test verifying RLS isolation inside interactive transactions using Prisma internal APIs (`_createItxClient`).

```

- [ ] **Step 3: Run final verification**

Run:
```bash
npm run lint && npm test && npm run build
```

Expected: All pass with 0 failures.

- [ ] **Step 4: Commit**

```bash
git add package.json CHANGELOG.md
git commit -m "chore: bump version to 0.8.0 with stabilization changelog"
```
