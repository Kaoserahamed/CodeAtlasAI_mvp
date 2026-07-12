CodeAtlas AI (MVP)
Ever tried jumping into a completely unfamiliar codebase and wished you had a literal map? That's why I built CodeAtlas AI. It’s a tool that parses JavaScript and TypeScript projects, extracts relationships between files and functions, and throws them onto an interactive graph.

Instead of reading raw code to figure out imports or tracking down where a function is called, you can visualize it.

## 🚀 [Live Demo](https://kaoserahamed.github.io/CodeAtlasAI_mvp/)

Try the interactive demo with a pre-loaded Food Delivery application graph - no installation required!

## Features

- 🔍 **AST-based Parsing** - Analyzes JavaScript/TypeScript using Babel parser
- 📊 **Graph Database** - Stores relationships in Neo4j
- 🎨 **Interactive Visualization** - React Flow-based graph canvas with zoom/pan
- 🔗 **Relationship Tracking** - Visualizes imports and function calls
- 📱 **Details Panel** - Click nodes to see incoming/outgoing connections

## Quick Start

### Prerequisites

- **Node.js** 18+ 
- **Neo4j Desktop** - [Download here](https://neo4j.com/download/)

### 1. Setup Neo4j Desktop

1. Open Neo4j Desktop
2. Create a new database with any name (e.g., `codeatlas`)
3. Set a secure password (you'll use this in step 2)
4. Click "Start" and wait for "Active" status
5. Verify connection at http://localhost:7474

### 2. Configure Backend

1. Navigate to `backend/` folder
2. Copy `.env.example` to `.env`:
   ```bash
   cd backend
   cp .env.example .env
   ```
3. Edit `.env` with your Neo4j credentials:
   ```env
   NEO4J_URI=bolt://127.0.0.1:7687
   NEO4J_USER=neo4j
   NEO4J_PASSWORD=your_password_here
   PORT=3001
   ```

### 3. Install & Run

```bash
# Install dependencies
npm install
npm run install:all

# Start application
npm run dev
```

Servers will start:
- Frontend: http://localhost:5173
- Backend: http://localhost:3001

### 3. Scan Code

```bash
# In a new terminal
cd backend
npm run scan

# Or scan your own project
npm run scan -- "C:\path\to\your\project"
```

### 4. View Graph

Open http://localhost:5173 and explore your code graph!

## Understanding the Graph

- 🔵 **Blue nodes** = Files
- 🟣 **Purple nodes** = Functions
- 🟢 **Green arrows** = Import relationships
- 🔵 **Blue arrows** = Function calls

**Interactions:**
- Click any node to see details
- Scroll to zoom in/out
- Drag to pan around
- Click "Refresh" to reload data

## Project Structure

```
codeatlas-ai/
├── backend/          # Node.js + TypeScript + Fastify
│   ├── src/
│   │   ├── api/     # REST endpoints
│   │   ├── database/# Neo4j integration
│   │   ├── parser/  # Babel AST parser
│   │   └── server.ts
│   └── .env         # Configuration
├── frontend/        # React + TypeScript + Tailwind
│   └── src/
│       ├── components/  # Graph visualization
│       └── services/    # API client
└── sample-repo/    # Test data
```

## Configuration

Create `backend/.env` based on `backend/.env.example`:

```env
# Neo4j Configuration
NEO4J_URI=bolt://127.0.0.1:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=your_secure_password

# Server Configuration
PORT=3001
```

> ⚠️ **Security Note**: Never commit your `.env` file with real credentials to version control!

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/graph` | Fetch graph data |
| POST | `/api/scan` | Trigger scan |
| DELETE | `/api/graph` | Clear data |

## Commands

```bash
# Development
npm run dev              # Start both servers
npm run dev:backend      # Backend only
npm run dev:frontend     # Frontend only

# Scanning
cd backend
npm run scan             # Scan sample repo
npm run scan -- <path>   # Scan custom repo

# Build
npm run build            # Build both

# Demo Deployment (Static)
cd frontend
npm run build:demo       # Build demo with pre-loaded data
npm run preview:demo     # Preview demo locally
```

See [DEMO_DEPLOYMENT.md](./DEMO_DEPLOYMENT.md) for deploying to GitHub Pages, Netlify, or Vercel.

## Troubleshooting

**Backend won't start:**
- Open Neo4j Desktop and start your database
- Check password in `backend/.env` matches Neo4j

**No graph showing:**
- Run: `cd backend && npm run scan`
- Click "Refresh" button in browser

**Port conflicts:**
- Change `PORT` in `backend/.env`
- Update proxy in `frontend/vite.config.ts`

## Technology Stack

**Backend:** Node.js, TypeScript, Fastify, Babel Parser, Neo4j  
**Frontend:** React, TypeScript, Vite, React Flow, Tailwind CSS  
**Database:** Neo4j 5.x

## Use Cases

- 📖 Understand unfamiliar codebases
- 🔍 Find refactoring opportunities
- 📚 Document architecture visually
- 👥 Onboard new developers
- 🔗 Trace dependency chains

## License

MIT

---

**Built with ❤️ using modern web technologies**
