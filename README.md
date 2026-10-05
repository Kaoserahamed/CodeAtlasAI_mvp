# CodeAtlas AI

Ever tried jumping into a completely unfamiliar codebase and wished you had a literal map? That's why I built CodeAtlas AI. It parses source repositories, extracts the relationships between files and functions, and throws them onto an interactive graph.

Instead of reading raw code to figure out imports or tracking down where a function is called, you can visualize it.

## 🚀 [Live Demo](https://kaoserahamed.github.io/CodeAtlasAI_mvp/)

Try the deployed application - analyze any public GitHub repository and visualize its code structure!

**🔗 Application URL:** https://kaoserahamed.github.io/CodeAtlasAI_mvp/  
**⚙️ Backend API:** https://profound-unity-production-c405.up.railway.app

## Features

- 🌐 **GitHub Integration** - Analyze any public GitHub repository directly from the web interface
- 🔍 **Multi-language Parsing** - Babel for JavaScript and TypeScript, tree-sitter WASM grammars for Python, Go, Java, Ruby, Rust and C#
- 📊 **Graph Database** - Stores relationships in Neo4j
- 🎨 **Interactive Visualization** - React Flow-based graph canvas with zoom/pan
- 🔗 **Relationship Tracking** - Visualizes imports and function calls
- 🔍 **Code Search & Quality Analysis** - Indexed retrieval, complexity hotspots, duplication and dead code
- 🧭 **Change Impact Analysis** - Blast radius of an edit, plus circular dependency detection
- 🔐 **Secret Detection** - Credential patterns reported as a location and a non-reversible fingerprint
- ⚡ **Background Jobs** - Analysis runs on a bounded queue; the API returns a job id immediately

## Quick Start

### 0. Open in a devcontainer (no setup steps)

In VS Code, choose **Reopen in Container**. That gives you Node 20,
dependencies installed from the committed lockfile, and the Neo4j database
already running, with the four ports forwarded. The only command left is
`npm run dev`.

The configuration lives in `.devcontainer/devcontainer.json`.

### 1. Or set it up by hand

You need:

- **Node.js 20+**
- **Docker** — only for the local database. Not required if you already have
  a Neo4j instance; the backend starts without one and reports the degraded
  state through `/api/health` rather than crash-looping.
- **Git** — for cloning repositories.

### 2. Start a database

```bash
docker compose up -d
```

That gives you Neo4j 5 on `bolt://127.0.0.1:7687`, with credentials
`neo4j` / `codeatlas-local`. The browser is at http://localhost:7474. Stop it
with `docker compose down -v`.

Already have Neo4j? Skip this and put its URI in `backend/.env`.

### 3. Configure the backend

```bash
cp backend/.env.example backend/.env
```

With the Compose defaults:

```env
NEO4J_URI=bolt://127.0.0.1:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=codeatlas-local
PORT=3001
```

### 4. Install & Run

```bash
npm install   # installs both workspaces
npm run dev
```

Servers will start:
- Frontend: http://localhost:5173
- Backend: http://localhost:3001

### 5. Analyze a repository

Open http://localhost:5173, enter a GitHub repository URL, and click
**Analyze Repository**. Analysis runs in the background, so you can watch the
job progress while it clones, parses, and writes the graph.

Supported languages: JavaScript, TypeScript, Python, Go, Java, Ruby, Rust and
C#. Public repositories need no configuration; private ones need a
`GITHUB_TOKEN`.

### 6. Verify the install

```bash
npm test          # 196 tests across both workspaces
npm run typecheck
npm run lint
```

To include the two database integration tests:

```bash
npm run test:ci
```

## Understanding the Graph

- 🔵 **Blue nodes** = Files
- 🟣 **Purple nodes** = Functions
- 🟢 **Green arrows** = Import relationships
- 🔵 **Blue arrows** = Function calls

**Interactions:**
- Click any node to see details
- Scroll to zoom in/out
- Drag to pan around
- Click "New Analysis" to analyze another repository
- Click "Refresh" to reload data

## How to Use

### Option 1: Analyze GitHub Repository (Web Interface)

1. **Start the application** (see Quick Start above)
2. **Open http://localhost:5173**
3. **Enter a GitHub repository URL** (e.g., `https://github.com/lodash/lodash`)
4. **Click "Analyze Repository"**
5. **Watch the processing** - cloning, analyzing, building graph
6. **Explore the visualization** - interactive graph with your codebase

**Supported:**
- ✅ Public GitHub repositories
- ✅ JavaScript, TypeScript, Python, Go, Java, Ruby, Rust and C#
- ✅ Repositories of any size (larger repos take longer)

**Example repositories to try:**
```
https://github.com/lodash/lodash
https://github.com/expressjs/express
https://github.com/axios/axios
https://github.com/chalk/chalk
```

### Option 2: Analyze Local Code (Command Line)

```bash
cd backend
npm run scan -- "C:\path\to\your\project"
```

Then refresh the web interface to see the graph.

## Project Structure

```
codeatlas-ai/
├── backend/            # Node.js + TypeScript + Fastify
│   ├── src/
│   │   ├── api/        # REST endpoints, JSON-schema validated
│   │   ├── config/     # Environment configuration
│   │   ├── database/   # Neo4j client
│   │   ├── parser/     # Parser registry, Babel and tree-sitter backends
│   │   ├── resolver/   # Module and symbol resolution
│   │   ├── services/   # Analysis, indexing, quality, jobs
│   │   └── server.ts
│   ├── tests/          # Vitest suite
│   └── .env.example
├── frontend/           # React + TypeScript + Tailwind
│   └── src/
│       ├── components/ # Graph visualization
│       └── services/   # API client
├── sample-repo/        # Test data
├── docker-compose.yml  # Local Neo4j
└── package.json        # Workspaces
```



> ⚠️ **Security Note**: Never commit your `.env` file with real credentials to version control!

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health and database status |
| GET | `/api/metrics` | Queue depth and job run timings |
| GET | `/api/capabilities` | Languages, extensions and which optional features are enabled |
| GET | `/api/repositories` | List analysed repositories |
| POST | `/api/repositories/validate` | Validate a repository URL without cloning |
| POST | `/api/repositories/analyze` | Queue an analysis; returns `202` with a job id |
| GET | `/api/jobs` | List analysis jobs |
| GET | `/api/jobs/:jobId` | Job status and progress |
| DELETE | `/api/jobs/:jobId` | Cancel a running job |
| GET | `/api/graph` | Fetch graph nodes and edges |
| GET | `/api/repositories/:repoId/stats` | File, function and relationship counts |
| GET | `/api/repositories/:repoId/nodes/:nodeId/neighbors` | Expand one node's neighborhood |
| GET | `/api/repositories/:repoId/search` | Search indexed symbols and content |
| DELETE | `/api/repositories/:repoId` | Delete a repository's subgraph |

Every request body is validated against a JSON schema before the handler
runs, and errors return a consistent `{ success: false, error }` envelope.

### Observability

Logs are structured JSON via pino, with a `service` field and a level driven
by `NODE_ENV` (`info` in development, `warn` otherwise). Every background job
emits a line carrying `jobId`, `repoId`, `status`, `stage` and `progress`,
and a failure is logged at error level with the reason.

`/api/metrics` reports queue depth and how long runs actually take, which is
the question the logs alone answer badly:

```bash
curl localhost:3001/api/metrics
```

```json
{
  "success": true,
  "data": {
    "uptimeSeconds": 3600,
    "jobs": {
      "running": 0,
      "queued": 2,
      "byStatus": { "queued": 2, "running": 0, "completed": 41, "failed": 1, "cancelled": 0 },
      "total": 44,
      "finished": 42,
      "lastDurationMs": 8421,
      "averageDurationMs": 6120,
      "maxDurationMs": 21033
    },
    "timestamp": "..."
  }
}
```

Counters are cumulative since process start and reset on restart.

The browser side is symmetric. `services/logger.ts` emits the same
timestamp/level/component shape as pino, and every API call goes through one
helper, so a failed request logs the route, the method and the reason. An
error boundary wraps the app so a render failure shows a readable fallback with
the error message and a retry rather than a blank page.

## Commands

```bash
# Development
npm run dev              # Start both servers
npm run dev:backend      # Backend only
npm run dev:frontend     # Frontend only

# Tests
npm test                 # Both workspaces (backend + frontend)
npm run test:backend     # Backend only
npm run test:frontend    # Frontend only
npm run test:watch       # Watch mode
npm run test:coverage    # Coverage report
npm run test:ci          # Includes the Neo4j integration tests

# Quality gates — the same three commands CI runs
npm run typecheck
npm run lint
npm run format           # Prettier, write
npm run format:check     # Prettier, check only

# Build
npm run build            # Build both workspaces

# Local database
docker compose up -d     # Start Neo4j
docker compose down -v   # Stop and discard data

# Scan a local directory (from backend/)
npm run scan -- <path>
```

The static demo deploys to GitHub Pages automatically after CI passes on
`main`. To build and preview it locally:

```bash
cd frontend
npm run build:demo
npm run preview:demo
```

## Troubleshooting

**Backend won't start:**
- Check the password in `backend/.env` matches your database
- Confirm the database is listening: `docker compose ps`

**Backend starts but every analysis fails:**
- `/api/health` reports `"database": "disconnected"`. The API stays up
  deliberately so the UI can explain the problem; start the database.

**No graph showing:**
- Analyse a repository from the web interface, then refresh
- Check `/api/jobs` for a failed job and its error message

**GitHub analysis fails:**
- Private repositories need a `GITHUB_TOKEN` in `backend/.env`
- Verify Git is installed on your system
- Check backend logs for detailed errors

**Port conflicts:**
- Change `PORT` in `backend/.env`
- Update proxy in `frontend/vite.config.ts`

## Deployment

### Deploy to Railway (Recommended)

Railway provides the best platform for this application with support for long-running processes, Neo4j, and Git operations.

**Quick Deploy:**
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Deploy backend
cd backend
railway init
railway up

# Get your backend URL
railway domain
```

**Detailed deployment guide:** See [RAILWAY_DEPLOYMENT.md](./RAILWAY_DEPLOYMENT.md)

**What you'll need:**
- Railway account (free tier available)
- Neo4j database (use Railway's Neo4j plugin or Neo4j AuraDB)
- Environment variables configured

**Deploy Frontend to Vercel:**
```bash
cd frontend
vercel --prod
# Set VITE_API_BASE_URL to your Railway backend URL
```

## Technology Stack

**Backend:** Node.js 20, TypeScript, Fastify 5, Babel Parser, tree-sitter (WASM), Neo4j driver
**Frontend:** React 18, TypeScript, Vite, React Flow, Tailwind CSS
**Database:** Neo4j 5.x
**Testing:** Vitest with a recording fake Neo4j driver
**Tooling:** ESLint, Prettier, Dependabot, Docker Compose

## Use Cases

- 📖 Understand unfamiliar codebases
- 🔍 Find refactoring opportunities
- 📚 Document architecture visually
- 👥 Onboard new developers
- 🔗 Trace dependency chains

## License

MIT

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the test and commit conventions.
Notable changes are recorded in [CHANGELOG.md](./CHANGELOG.md).

---

**Built with ❤️ using modern web technologies**
