# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Fastify 4 → 5.** Version 4.25.1 carried nine high severity advisories,
  several of which bypassed request validation or reached not-found handlers
  via malformed URLs. Since every request body here is validated by a JSON
  schema, that was a live risk. Verified by booting the built server and
  checking `/api/health`, structured logging, and graceful degradation when
  Neo4j is absent. `npm audit --omit=dev` now reports zero vulnerabilities.
- **Tests are now runnable and run in CI.** The Vitest suite already existed
  but no `test` script did, so nothing could execute it. `npm test`,
  `npm run typecheck` and `npm run lint` now cover the whole monorepo and are
  enforced on every push and pull request.
- **Deployment waits for CI.** The Pages deploy triggers on a successful `CI`
  run rather than on every push to `main`.
- **Frontend environment files are no longer tracked.** They are build
  inputs, not local secrets; `frontend/.env.example` documents them and the
  Pages build receives `VITE_API_BASE_URL` from a CI variable.
- **Dead code removed.** `analyzeQuality` accumulated a `totalComplexity` it
  never read; the tree-sitter import walkers tracked two flags that were
  written but never read; an unused `RawCall` import and an unused `maybe`
  test helper were deleted.

### Added

- Docker Compose stack for Neo4j, so local development and the integration
  tests do not need Neo4j Desktop or a hosted Aura instance.
- `npm run test:ci`, which starts that database, waits for it, runs the
  integration suite, and tears it down again. CI runs the same script.
- ESLint configuration for both workspaces and a Prettier configuration.
  The frontend previously shipped a `lint` script that exited 2 because no
  config file existed.
- Dependabot, watching the root, backend and frontend manifests plus the
  GitHub Actions pins.
- `CONTRIBUTING.md` describing the test-and-commit conventions.

### Fixed

- **The integration suite reported a false pass.** Each integration test
  began with `if (!liveAvailable) return`, so running with `TEST_NEO4J=true`
  and no database reachable reported ten passing tests having run none of
  them. Requesting the suite without a database is now a failure.
- **Error handling typed `any`.** Three catch blocks read `err.message`
  through optional chaining. They are now typed `unknown` and tested with
  `instanceof`, so a thrown non-Error value yields a fallback message
  instead of `undefined`.
- **Lazy `require` calls** in `resolveWithinRoot` and `sha256` are ordinary
  imports now; the module compiles to CommonJS, so there was no reason.
- **A `const` in an unbraced `case` block** in `App.tsx` leaked into the
  enclosing switch.
- **`GraphCanvas` discriminated on `node.type`**, which does not narrow a
  union, and now narrows on the field itself.
- **Environment files stopped being tracked**, and the generated
  `graph-export.json` is no longer committed.