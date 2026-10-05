# Contributing

## Getting set up

You need Node.js 20 or newer. Everything else is installed by the root
`npm install`, because this is an npm workspaces monorepo.

```bash
git clone https://github.com/Kaoserahamed/CodeAtlasAI_mvp.git
cd CodeAtlasAI_mvp
npm install          # installs both workspaces from the committed lockfile
docker compose up -d # local Neo4j; skip if you already have one
```

Copy the example environment files and fill in what you need:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

The backend starts without a database and reports the degraded state through
`/api/health` rather than crash-looping, so `docker compose` is optional for
most work.

```bash
npm run dev    # backend on :3001, frontend on :5173
```

## Before you push

Run all three. CI runs the same commands, so this is exactly what will
happen on the pull request.

```bash
npm test          # Vitest, from the repository root
npm run typecheck # tsc across both workspaces
npm run lint      # ESLint, --max-warnings 0
```

`npm test` skips the two database integration tests so the suite stays
runnable without Neo4j. To run those as well:

```bash
npm run test:ci --workspace=backend
```

That starts the Compose database, waits for it, runs the suite with
`TEST_NEO4J=true`, and tears the container down.

## Committing

**Ship a change together with the tests that prove it.** A commit that adds
behaviour without a test is hard to review and hard to trust later, because
nothing records what the behaviour was supposed to be.

Practical rules:

- One logical change per commit. If a change needs a paragraph to describe,
  it probably wants splitting.
- Do not mix a refactor with a feature. Separate commits mean a reviewer can
  skip the refactor and read only the behaviour change, and a revert stays
  surgical.
- Do not mix formatting with anything else. Formatting noise hides the real
  diff, which is exactly the point of reviewing.
- Write the message for someone reading `git log` in six months. The first
  line says what changed in the imperative mood; the body says why, and what
  you chose between.

Types used here: `feat`, `fix`, `test`, `refactor`, `docs`, `build`, `ci`,
`chore`.

## Pull requests

Keep them focused on one thing. CI must be green; the Pages deploy only runs
after it passes, so a red branch is a blocked deploy.

If a change touches parsing, symbol resolution or graph persistence, say so
in the description: those layers assume repository content is untrusted, and
a change that widens what is trusted deserves a closer look.

## Reporting bugs

Include the command you ran, what you expected, and what happened. If it
involves parsing a specific repository, the language and a minimal snippet
that reproduces it are worth far more than the URL of a large project.