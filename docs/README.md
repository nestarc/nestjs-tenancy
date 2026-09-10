# Documentation

Start with the [package README](../README.md) and the [runnable quickstart](../examples/quickstart/README.md). Current reference pages are:

- [Compatibility and deprecation policy](./compatibility.md)
- [Prisma configuration, transactions, and intentional unscoped access](./prisma.md)
- [HTTP authentication, extractors, and lifecycle hooks](./http.md)
- [Events, RPC, caching, and testing integrations](./integrations.md)
- [RLS operations, PgBouncer, and CLI diagnostics](./operations.md)
- [Module, service, decorators, and error API](./api.md)
- [Application integration guide for coding assistants](./usage-for-agents.md)

The [official site](https://nestarc.dev/packages/tenancy/) provides web navigation and API reference. The package version installed in your application determines the applicable API; current-branch examples may include unreleased changes.

## Maintaining documentation

Run `npm run test:docs` for local documentation/example checks and `npm run test:docs:e2e` against the isolated quickstart database for actual tenant isolation. The [maintainer instructions](https://github.com/nestarc/nestjs-tenancy/blob/main/AGENTS.md) identify the commands and source boundaries.

When changing a public contract, update the implementation JSDoc, these reference pages, and the corresponding `packages/tenancy` pages in the `nestarc.dev` repository. Generated site API pages keep immutable released-source provenance. Editorial corrections to an already released API are identified separately; do not relabel unpublished source as a published release. Regenerate API documentation from the next actual release when it becomes available.

Use one executable example as the basis for its documentation. Validate snippets and local links in CI, and exercise authentication ordering plus A/B/no-context behavior before describing a flow as working. Keep interface defaults and support ranges consistent with `package.json`, source, and the committed verification runners. A configured CI job alone is not evidence of a successful run.

## Historical records

Dated audits, roadmaps, handovers, and `superpowers` plans are historical maintenance records, not application setup guides. Start with the current reference pages above. The [2026-09-10 audit](https://github.com/nestarc/nestjs-tenancy/blob/main/docs/2026-09-10-documentation-audit.md) records the original observations; its [fixed remediation checklist](https://github.com/nestarc/nestjs-tenancy/blob/main/docs/2026-09-10-documentation-remediation.md) records subsequent fixes and validation. Preserve this distinction when summarizing older files.
