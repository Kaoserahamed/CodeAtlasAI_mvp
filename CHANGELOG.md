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
  but no `test` script did, so nothing could execute it. `npm test` now covers
  both workspaces and is enforced on every push and pull request.
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

- A coverage gate. Each workspace records a floor in its vitest config —
  backend 80% statements / 65% branches, frontend 85% / 80% — measured against
  what the suite actually reaches today (86.4% and 91.6%) and sitting below it,
  so CI fails when coverage falls rather than rewarding a plateau. Raising a
  floor is a deliberate act.
- A frontend test setup: Vitest with jsdom, Testing Library, and 30 specs
  covering the API client's request shaping and error envelope, the processing
  screen, and the graph canvas's data transformation. The frontend previously
  had no test runner and no specs at all.
- **Structured logging and a metrics endpoint.** `pino` was relied on only
  transitively through Fastify and never declared. It is now a declared
  dependency with a `service` field and a level driven by `NODE_ENV`, and
  every background job emits a line with `jobId`, `repoId`, `status`, `stage`
  and `progress`.
- `GET /api/metrics` reports queue depth and job run timings: counts by state,
  the last duration, the average and the slowest observed. Counters are
  cumulative since process start.
- Docker Compose stack for Neo4j, so local development and the integration
  tests do not need Neo4j Desktop or a hosted Aura instance.
- `npm run test:ci`, which starts that database, waits for it, runs the
  integration suite, and tears it down again. CI runs the same script.
- ESLint configuration for both workspaces and a Prettier configuration.
  The frontend previously shipped a `lint` script that exited 2 because no
  config file existed.
- Dependabot, watching the root, backend and frontend manifests plus the
  GitHub Actions pins.
- `CHANGELOG.md` and `CONTRIBUTING.md`, the latter documenting the test and
  commit conventions this history had been weakest on.
- Test coverage for the background job queue (25 tests) and for the batched
  write helpers (17 tests). Neither had any coverage before, and the queue is
  where a leaked slot or a dropped cancellation stays invisible until
  production.
- A test that keeps `backend/.env.example` in step with the variables the
  backend actually reads, so an undocumented variable fails the build instead
  of being discovered by whoever needed it.

### Fixed

- **The service reported two different versions.** `/api/health` returned a
  hardcoded `2.0.0` while every package manifest said `1.0.0`, so a bug report
  quoting either one was ambiguous. The version now lives in the config module
  and a test asserts it matches all three manifests.
- **A supported variable was undocumented.** `GH_TOKEN` is read in
  `githubService` and `routes` as an alternative to `GITHUB_TOKEN`, but was
  absent from `backend/.env.example`, so anyone setting it from the example
  file had no way to know it worked.
- **`backend/.env.example` did not match the Compose database.** It shipped
  `NEO4J_PASSWORD=password` while `docker-compose.yml` uses
  `codeatlas-local`, so the documented quick start could not connect without
  a manual edit. The example now matches, so `docker compose up -d` followed
  by `cp .env.example .env` works with no changes.
- **Analyze Repository 404d against this backend.** The API client requested
  `/api/analyze-github` and `/api/job/:jobId`; the backend serves
  `/api/repositories/analyze` and `/api/jobs/:jobId`. The client had drifted
  from the routes and nothing caught it, because the frontend had no tests.
  Both paths are corrected, pinned by the new specs.
- `scanRepository` and `getStats` were removed from the client. They called
  `/api/scan` and `/api/stats`, neither of which exists, and neither was
  referenced anywhere. The stats route that does exist is scoped to a
  repository id the client has no way to supply.
- **A fresh clone could not run the test suite.** `tree-sitter-wasms`, which
  supplies the WASM grammars the multi-language parsers load at runtime, was in
  no package.json and had no entry in the lockfile. It existed only in a local
  `node_modules`, so `npm ci` never installed it, the grammar directory lookup
  threw, and the suite failed to collect for anyone not working on the original
  machine. It is now a declared backend dependency.
- **The multi-language tests passed while asserting nothing.** Each began with
  `if (!available) return`, so with the grammars missing four Python, Go and
  Java parsing tests reported success having executed no assertions. They now
  assert the runtime is available, so the absence fails loudly.
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
- `neo4jClient.ts` no longer mixes owning the connection with constructing
  Cypher. The batched write path moved to `neo4jWriter.ts`, bringing the file
  from 566 to 464 lines and leaving every source file under 500.
- `railway.nixpacks.toml`, a byte-identical copy of `nixpacks.toml`, was
  removed; only the file Nixpacks reads is kept.