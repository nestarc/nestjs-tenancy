# Documentation

Start with the [package README](../README.md) and the [runnable quickstart](../examples/quickstart/README.md). Current reference pages are:

- [Compatibility and deprecation policy](./compatibility.md)
- [Prisma configuration, transactions, and intentional unscoped access](./prisma.md)
- [HTTP authentication, extractors, and lifecycle hooks](./http.md)
- [Events, RPC, caching, and testing integrations](./integrations.md)
- [Runtime security, RLS operations, PgBouncer, and CLI diagnostics](./operations.md)
- [Module, service, decorators, and error API](./api.md)
- [Application integration guide for coding assistants](./usage-for-agents.md)

The [official site](https://nestarc.dev/packages/tenancy/) provides web navigation and API reference. The package version installed in your application determines the applicable API; current-branch examples may include unreleased changes.

## Maintaining documentation

Run `npm run test:docs` for local documentation/example checks and `npm run test:docs:e2e` against the isolated quickstart database for actual tenant isolation. The [maintainer instructions](https://github.com/nestarc/nestjs-tenancy/blob/main/AGENTS.md) identify the commands and source boundaries.

When changing a public contract, update the implementation JSDoc, these reference pages, and the corresponding `packages/tenancy` pages in the `nestarc.dev` repository. Generated site API pages keep immutable released-source provenance. Editorial corrections to an already released API are identified separately; do not relabel unpublished source as a published release. Regenerate API documentation from the next actual release when it becomes available.

Use one executable example as the basis for its documentation. Validate snippets and local links in CI, and exercise authentication ordering plus A/B/no-context behavior before describing a flow as working. Keep interface defaults and support ranges consistent with `package.json`, source, and the committed verification runners. A configured CI job alone is not evidence of a successful run.

## Preparing a package release

Use this checklist for each package release. Keep the manifest, changelog,
and current reference pages aligned with the selected version, and verify
registry publication before updating published-artifact baselines. Earlier
releases retain their original contents and metadata.
The consumer-facing [deployment sequence](./operations.md#deploying-the-security-update)
and [separator migration](./integrations.md#migrating-tenant-resource-key-separators)
belong in the release notes because they require application-owner action.

1. **Finalize the candidate version and notes.** Update `package.json` and the
   root package version entries in `package-lock.json` together. Move the
   applicable changelog entries into the selected version/date section and
   align current-reference wording with that release. Preserve historical
   entries and the published-only fixture baselines until the new registry
   artifact is available. Do not reuse a version already published to npm.
2. **Validate the exact candidate.** Select the patched runtime before
   `npm ci`. Run each source gate with `npm run`: `typecheck`, `lint`,
   `lint:typed`, `test:cov`, and `build`. Also run `npm run test:compat`,
   `npm run test:package`, and
   `npm run test:docs:e2e`. Use the documented isolated fixtures for database
   and infrastructure checks. The authoritative
   [CI workflow](https://github.com/nestarc/nestjs-tenancy/blob/main/.github/workflows/ci.yml)
   also requires PostgreSQL, Redis, both Prisma/PgBouncer lanes, and both
   published ecosystem lanes. Record actual results on the final commit;
   earlier local checks do not certify a subsequently edited candidate.
3. **Review the distributable and remaining security work.** Inspect
   `npm pack --dry-run --json` for the intended runtime/declarations, current
   reference pages, and quickstart sources, with generated example clients
   excluded. Review fresh production and full development audit results and
   record the disposition of unresolved advisories. Updating Node and the
   selected parser does not imply that every dependency advisory is resolved.
4. **Publish from one immutable commit.** The
   [release workflow](https://github.com/nestarc/nestjs-tenancy/blob/main/.github/workflows/release.yml)
   starts on a published GitHub Release and reuses the complete CI workflow
   before npm publication. Use tag `v<package.version>` and set the GitHub
   Release `target_commitish` to the full lowercase 40-character commit SHA.
   The tag's commit, checked-out HEAD, release event SHA, and target must all
   match; the release ref must be `refs/tags/<tag>`. The
   [provenance verifier](https://github.com/nestarc/nestjs-tenancy/blob/main/scripts/verify-release.js)
   enforces these conditions before installation/build/publication.
5. **Verify the published artifact and documentation.** Confirm the registry
   version and integrity, then refresh each published-only ecosystem baseline
   in a separate change and rerun its exact-artifact checks. Publish the site
   guidance below and regenerate API pages from the actual released source.

### Pending site updates for 0.16.2

Update the `packages/tenancy` pages in the separate `nestarc.dev` repository
for the Node.js `^22.23.4 || ^24.22.1` minimum, runtime/parser patch guidance,
and `TenantResourceKey`'s rejection of empty or ASCII-digit-only separators.
Verify the 0.16.2 registry artifact before updating the site's published-version
labels. Generated API pages for `0.16.1` retain that release's source
provenance; regenerate them from the verified 0.16.2 release source rather
than labeling these runtime/API changes as editorial corrections. The
separate site repository has not been changed here.

## Historical records

Dated audits, roadmaps, handovers, and `superpowers` plans are historical maintenance records, not application setup guides. Start with the current reference pages above. The [2026-09-10 audit](https://github.com/nestarc/nestjs-tenancy/blob/main/docs/2026-09-10-documentation-audit.md) records the original observations; its [fixed remediation checklist](https://github.com/nestarc/nestjs-tenancy/blob/main/docs/2026-09-10-documentation-remediation.md) records subsequent fixes and validation. Preserve this distinction when summarizing older files.
