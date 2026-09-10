# Repository guide

This repository implements `@nestarc/tenancy`. For integration into another application, start with `docs/usage-for-agents.md`; this file is for maintaining the package.

## Entry points

- `README.md`: first use and navigation.
- `docs/README.md`: current reference pages and historical-record boundaries.
- `src/index.ts`, `src/cache/index.ts`, `src/testing/index.ts`: public exports.
- `examples/quickstart`: executable Nest/Prisma integration used by documentation checks.
- `package.json`, `.github/workflows/ci.yml`: supported runtimes and validation commands.

## Validation

Use `npm run typecheck`, `npm run lint`, `npm run lint:typed`, and relevant Jest tests for source changes. Run `npm run test:cov` when verifying the required coverage floors. `npm run build` checks emitted declarations and CLI output.

For documentation and quickstart changes, run `npm run test:docs`; run `npm run test:docs:e2e` for database behavior using the example's isolated database. Use the documented Docker/setup commands, not an existing application database. Benchmark fixtures can reset tables: follow `benchmarks/README.md` and record provenance for any published measurements.

## Public contracts and documentation

Keep source JSDoc, README/reference pages, examples, and tests consistent. Site content lives in the separate `nestarc.dev` repository; record site updates when changing a documented public contract. Generated API documentation must retain the source release's provenance, with editorial corrections distinguished from runtime/API changes.

Tenant identity validation is separate from principal authorization. `sharedModels`, `withoutTenant`, and the HTTP bypass decorator do not disable PostgreSQL RLS. Raw SQL and interactive transactions require the documented transaction path. Preserve these boundaries in examples and descriptions.

Check installed versions and actual test outcomes before making compatibility claims. Dated audit/roadmap/hand-off files are historical evidence. Preserve user work and avoid unrelated refactoring when correcting documentation.
