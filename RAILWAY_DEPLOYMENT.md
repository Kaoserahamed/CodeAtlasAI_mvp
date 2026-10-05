# Railway Deployment Guide

Complete guide to deploy CodeAtlas AI backend to Railway.app with Neo4j integration.

## Prerequisites

- Railway account (sign up at [railway.app](https://railway.app))
- Railway CLI installed (`npm install -g @railway/cli`)
- Git repository with your code
- Neo4j AuraDB account (or use Railway's Neo4j)

## Quick Deploy (5 minutes)

```bash
# 1. Login to Railway
railway login

# 2. Navigate to backend
cd backend

# 3. Initialize Railway project
railway init

# 4. Link to Railway project
railway link

# 5. Deploy
railway up
```

## Detailed Deployment Steps

### Step 1: Install Railway CLI

```bash
npm install -g @railway/cli
```

Verify installation:
```bash
railway --version
```

### Step 2: Login to Railway

```bash
railway login
```

This will open your browser for authentication.

### Step 3: Create Railway Project

**Option A: Via CLI**
```bash
cd backend
railway init
```

Follow the prompts:
- Create new project? **Yes**
- Project name: **codeatlas-backend**
- Environment: **production**

**Option B: Via Dashboard**
1. Go to [railway.app](https://railway.app)
2. Click "New Project"
3. Select "Empty Project"
4. Name it "codeatlas-backend"

### Step 4: Add Neo4j Database

**Option A: Railway Neo4j Plugin (Recommended)**

```bash
# Add Neo4j from Railway's templates
railway add
```

Select "Neo4j" from the list. Railway will:
- Deploy Neo4j instance
- Auto-configure connection variables
- Provide Neo4j browser access

**Option B: Neo4j AuraDB (Cloud)**

1. Go to [neo4j.com/cloud/aura](https://neo4j.com/cloud/aura)
2. Create free account
3. Click "New Instance"
4. Select "Free" tier
5. Download connection credentials
6. Save credentials for next step

### Step 5: Configure Environment Variables

**If using Railway Neo4j:**
```bash
railway variables set NODE_ENV=production
```

Railway automatically sets:
- `NEO4J_URI`
- `NEO4J_USER`
- `NEO4J_PASSWORD`

**If using Neo4j AuraDB:**
```bash
railway variables set NEO4J_URI=neo4j+s://xxxxx.databases.neo4j.io
railway variables set NEO4J_USER=neo4j
railway variables set NEO4J_PASSWORD=your_password_here
railway variables set NODE_ENV=production
```

**Verify variables:**
```bash
railway variables
```

Should show:
```
NEO4J_URI=bolt://...
NEO4J_USER=neo4j
NEO4J_PASSWORD=...
NODE_ENV=production
PORT=(automatically set by Railway)
```

### Step 6: Deploy Backend

```bash
# Make sure you're in the backend directory
cd backend

# Deploy to Railway
railway up
```

You'll see:
```
Building...
Deploying...
✓ Deployment successful
```

### Step 7: Generate Domain

Railway will auto-generate a domain, or create a custom one:

**Auto-generated domain:**
```bash
railway domain
```

Output: `codeatlas-backend-production.up.railway.app`

**Custom domain (optional):**
```bash
railway domain add yourdomain.com
```

### Step 8: Check Deployment Status

**View logs:**
```bash
railway logs
```

**Check health endpoint:**
```bash
curl https://your-app.up.railway.app/api/health
```

Expected response:
```json
{
  "status": "ok",
  "database": "connected",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Step 9: Test Backend

Test all endpoints:

```bash
# Health check
curl https://your-app.up.railway.app/api/health

# Graph data
curl https://your-app.up.railway.app/api/graph

# Analyze GitHub repo
curl -X POST https://your-app.up.railway.app/api/analyze-github \
  -H "Content-Type: application/json" \
  -d '{"repoUrl":"https://github.com/lodash/lodash"}'
```

### Step 10: Deploy Frontend to Vercel

Now that backend is deployed, update frontend:

```bash
cd ../frontend

# Set backend URL
vercel env add VITE_API_BASE_URL production
# Enter: https://your-app.up.railway.app

# Deploy frontend
vercel --prod
```

## Configuration Files Explained

### railway.toml

```toml
[build]
builder = "NIXPACKS"
buildCommand = "npm install && npm run build"

[deploy]
startCommand = "node dist/server.js"
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 10
healthcheckPath = "/api/health"
healthcheckTimeout = 100
```

**What it does:**
- Uses Nixpacks builder (automatic Node.js detection)
- Runs build command to compile TypeScript
- Starts server with compiled code
- Auto-restarts on failure (up to 10 times)
- Health check on `/api/health` endpoint

### nixpacks.toml

```toml
[phases.setup]
nixPkgs = ["nodejs-18_x", "git"]

[phases.install]
cmds = ["npm install"]

[phases.build]
cmds = ["npm run build"]

[start]
cmd = "node dist/server.js"
```

**What it does:**
- Installs Node.js 18 and Git
- Runs npm install
- Builds TypeScript
- Starts the server

### Procfile

```
web: node dist/server.js
```

**What it does:**
- Backup configuration for process management
- Railway will use this if other configs aren't found

## Railway Dashboard Configuration

### Via Web Dashboard:

1. Go to [railway.app](https://railway.app/dashboard)
2. Select your project
3. Click "Variables" tab
4. Add environment variables:
   - `NEO4J_URI`
   - `NEO4J_USER`
   - `NEO4J_PASSWORD`
   - `NODE_ENV=production`

5. Click "Settings" tab:
   - **Root Directory**: Leave empty (or set to `backend`)
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `node dist/server.js`
   - **Watch Paths**: Leave default

6. Click "Deploy" → "Redeploy"

## Neo4j Configuration

### Using Railway Neo4j

1. Add Neo4j plugin from Railway dashboard
2. Connection variables are auto-configured
3. Access Neo4j browser from Railway dashboard
4. Default credentials: neo4j / (generated password)

### Using Neo4j AuraDB

1. Create free instance at [neo4j.com/cloud/aura](https://neo4j.com/cloud/aura)
2. Download credentials
3. Connection URI format: `neo4j+s://xxxxx.databases.neo4j.io`
4. Set variables in Railway
5. Whitelist Railway IPs (if needed):
   - Usually not needed (AuraDB allows all by default)
   - Check AuraDB security settings if connection fails

## Monitoring and Maintenance

### View Logs

```bash
# Real-time logs
railway logs

# Follow logs
railway logs --follow

# Filter by service
railway logs --service backend
```

### View Metrics

Railway dashboard shows:
- CPU usage
- Memory usage
- Request count
- Response times

### Restart Service

```bash
railway restart
```

### Scale Resources

Railway automatically scales, but you can adjust:
1. Go to Railway dashboard
2. Select service
3. Settings → Resources
4. Adjust memory/CPU limits

## Troubleshooting

### "Build Failed"

**Check Node.js version:**
- Railway uses Node 18 by default
- Verify your app works with Node 18
- Update `nixpacks.toml` if needed

**Fix:**
```bash
# Check package.json engines
"engines": {
  "node": ">=18.0.0"
}
```

### "Cannot connect to Neo4j"

**For Railway Neo4j:**
1. Check Neo4j service is running
2. Verify environment variables
3. Restart both services

**For Neo4j AuraDB:**
1. Verify URI format: `neo4j+s://` not `bolt://`
2. Check credentials are correct
3. Verify AuraDB instance is running
4. Check firewall/IP whitelist

**Fix:**
```bash
# Check variables
railway variables

# Update if needed
railway variables set NEO4J_URI=correct_uri
```

### "Port Already in Use"

Railway handles PORT automatically. Don't hardcode it.

**Fix in code:**
```typescript
const port = process.env.PORT || 3001;
```

### "Deployment Timeout"

If deployment takes too long:
1. Check build logs for errors
2. Reduce dependency installation time
3. Use npm ci instead of npm install

**Fix in railway.toml:**
```toml
buildCommand = "npm ci && npm run build"
```

### "Health Check Failed"

**Check health endpoint:**
```bash
curl https://your-app.up.railway.app/api/health
```

**Common causes:**
- Database not connected
- Server not started properly
- Wrong health check path

**Fix:**
1. Review server logs: `railway logs`
2. Test locally first
3. Verify Neo4j connection

### "Git Clone Fails" (In Production)

Ensure git is installed:

**Fix in nixpacks.toml:**
```toml
[phases.setup]
nixPkgs = ["nodejs-18_x", "git"]  # git is required!
```

## Environment Variables Reference

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `NEO4J_URI` | Neo4j connection URI | `bolt://localhost:7687` | Yes |
| `NEO4J_USER` | Neo4j username | `neo4j` | Yes |
| `NEO4J_PASSWORD` | Neo4j password | `your_password` | Yes |
| `NODE_ENV` | Environment | `production` | Yes |
| `PORT` | Server port | Auto-set by Railway | No |

## Cost and Scaling

### Railway Pricing

**Hobby Plan** (Recommended for testing):
- $5/month
- Included resources
- Auto-scaling

**Pro Plan**:
- Pay as you go
- Better performance
- More resources

### Neo4j Pricing

**Railway Neo4j**:
- Included in Railway bill
- ~$5-10/month

**Neo4j AuraDB Free**:
- 200k nodes, 400k relationships
- 50MB storage
- Perfect for testing

**Neo4j AuraDB Paid**:
- Starts at $0.10/hour (~$70/month)
- More storage and performance

### Total Monthly Cost

**Development/Testing:**
- Railway: $5
- Neo4j AuraDB Free: $0
- **Total: $5/month**

**Production:**
- Railway: $5-20
- Neo4j AuraDB: $70+
- **Total: $75-90/month**

## Deployment Commands Cheatsheet

```bash
# Login
railway login

# Initialize project
railway init

# Link to existing project
railway link

# Deploy
railway up

# View logs
railway logs

# View variables
railway variables

# Set variable
railway variables set KEY=value

# Get domain
railway domain

# Open in browser
railway open

# Check status
railway status

# Restart
railway restart

# Delete environment
railway down
```

## CI/CD Integration

### GitHub Actions

Create `.github/workflows/deploy-railway.yml`:

```yaml
name: Deploy to Railway

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Install Railway CLI
        run: npm i -g @railway/cli

      - name: Deploy to Railway
        run: railway up --service backend
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
```

Get Railway token:
```bash
railway tokens create
```

Add token to GitHub:
1. GitHub repo → Settings → Secrets
2. New secret: `RAILWAY_TOKEN`
3. Paste token value

## Best Practices

1. **Use Environment Variables**: Never hardcode credentials
2. **Enable Health Checks**: Ensure `/api/health` works
3. **Monitor Logs**: Check logs regularly
4. **Set Restart Policy**: Auto-recover from failures
5. **Use Neo4j AuraDB**: For production reliability
6. **Version Control**: Commit railway.toml to git
7. **Test Locally**: Always test before deploying
8. **Backup Data**: Export Neo4j data regularly

## Production Checklist

- [ ] Environment variables configured
- [ ] Neo4j connection tested
- [ ] Health endpoint returns 200
- [ ] Custom domain added (optional)
- [ ] SSL certificate active (automatic)
- [ ] Logs show no errors
- [ ] Test GitHub analysis endpoint
- [ ] Frontend connected to backend
- [ ] CORS configured correctly
- [ ] Monitoring enabled
- [ ] Backup strategy defined

## Support and Resources

- **Railway Docs**: [docs.railway.app](https://docs.railway.app)
- **Railway Discord**: [discord.gg/railway](https://discord.gg/railway)
- **Neo4j Docs**: [neo4j.com/docs](https://neo4j.com/docs)
- **GitHub Issues**: Report bugs in your repo

## Next Steps

After successful deployment:

1. **Update Frontend**: Set `VITE_API_BASE_URL` in Vercel
2. **Test Integration**: Try analyzing a repository
3. **Monitor Performance**: Check Railway dashboard
4. **Setup Alerts**: Configure Railway notifications
5. **Document URL**: Share backend URL with team

---

**Ready to deploy?** Run `railway login` to get started! 🚂
