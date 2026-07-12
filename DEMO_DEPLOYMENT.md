# CodeAtlas AI - Demo Deployment Guide

Deploy a static demo version of CodeAtlas with pre-loaded Food Delivery application graph data.

## What's Included

The demo version includes:
- ✅ **Pre-loaded graph data** from your Food Delivery application
- ✅ **23 files**, **51 functions**, **54 imports**, **416 function calls**
- ✅ **Fully interactive** - zoom, pan, click nodes, see relationships
- ✅ **Static build** - No backend or database required
- ✅ **Fast** - Loads instantly from JSON

## Build Demo Version

```bash
cd frontend
npm run build:demo
```

This creates a `dist/` folder with static files ready for deployment.

## Deploy to GitHub Pages

### Option 1: Using GitHub Actions (Recommended)

1. Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Install dependencies
        working-directory: ./frontend
        run: npm ci
      
      - name: Build demo
        working-directory: ./frontend
        run: npm run build:demo
      
      - name: Upload artifact
        uses: actions/upload-pages-artifact@v2
        with:
          path: './frontend/dist'
  
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v2
```

2. Enable GitHub Pages:
   - Go to repository Settings → Pages
   - Source: GitHub Actions
   - Save

3. Push to main branch:
```bash
git add .
git commit -m "Add demo deployment"
git push origin main
```

4. Your demo will be live at: `https://<username>.github.io/<repository>/`

### Option 2: Manual Deployment

```bash
# Build demo
cd frontend
npm run build:demo

# Deploy dist/ folder to gh-pages branch
npx gh-pages -d dist
```

## Deploy to Netlify

1. Build locally or connect GitHub repo

2. **Build settings**:
   - Base directory: `frontend`
   - Build command: `npm run build:demo`
   - Publish directory: `frontend/dist`

3. **Deploy**:
   ```bash
   # Install Netlify CLI
   npm install -g netlify-cli
   
   # Build
   cd frontend
   npm run build:demo
   
   # Deploy
   netlify deploy --prod --dir=dist
   ```

Your demo will be live at: `https://<site-name>.netlify.app`

## Deploy to Vercel

1. Install Vercel CLI:
```bash
npm install -g vercel
```

2. Deploy:
```bash
cd frontend
npm run build:demo
vercel --prod
```

Or connect your GitHub repo on Vercel dashboard with:
- **Build Command**: `cd frontend && npm run build:demo`
- **Output Directory**: `frontend/dist`

Your demo will be live at: `https://<project>.vercel.app`

## Deploy to Other Services

The `frontend/dist` folder can be deployed to any static hosting:
- **AWS S3 + CloudFront**
- **Azure Static Web Apps**
- **Cloudflare Pages**
- **Firebase Hosting**
- **Surge.sh**

Just upload the contents of `dist/` to your hosting service.

## Testing Demo Locally

Before deploying, test the demo build:

```bash
cd frontend
npm run build:demo
npm run preview:demo
```

Open http://localhost:4173 to test the demo.

## Updating Demo Data

When you want to update the demo with a different codebase:

1. **Scan new repository**:
   ```bash
   cd backend
   npm run scan -- /path/to/new/repo
   ```

2. **Export new graph data**:
   ```powershell
   $data = (Invoke-WebRequest -Uri "http://localhost:3001/api/graph" -UseBasicParsing).Content | ConvertFrom-Json
   $data.data | ConvertTo-Json -Depth 10 -Compress | Set-Content "frontend/src/demo-data.json"
   ```

3. **Rebuild and redeploy**:
   ```bash
   cd frontend
   npm run build:demo
   # Deploy using your chosen method
   ```

## Demo Features

✅ **Works**: All graph visualization features
✅ **Works**: Node selection and details panel
✅ **Works**: Relationship highlighting
✅ **Works**: Zoom and pan
✅ **Works**: Legend and statistics

❌ **Doesn't Work**: Refresh button (data is static)
❌ **Doesn't Work**: Scanning new repositories (no backend)

## Customization

### Change Demo Title

Edit `frontend/src/components/Header.tsx`:
```tsx
<h1 className="text-2xl font-bold text-gray-800">
  My Project Name
  <span className="ml-2 text-sm bg-yellow-100 text-yellow-800 px-2 py-1 rounded">
    DEMO
  </span>
</h1>
```

### Add Custom Description

Edit `frontend/src/App.tsx` to add a banner:
```tsx
<div className="bg-blue-50 border-b border-blue-200 px-6 py-3 text-center text-sm text-blue-800">
  This is a demo showcasing the Food Delivery Application architecture
</div>
```

## File Size

The demo build is approximately:
- **Frontend code**: ~500 KB (gzipped)
- **Demo graph data**: ~50-200 KB depending on project size
- **Total**: < 1 MB

Perfect for free hosting!

## Troubleshooting

### Build fails with "Cannot find module demo-data.json"

Make sure you've exported the graph data:
```powershell
cd frontend/src
# Export should create demo-data.json here
```

### Demo shows empty graph

Check `frontend/src/demo-data.json` exists and has data:
```bash
cat frontend/src/demo-data.json
```

### 404 on GitHub Pages

Set the correct base path in `vite.config.demo.ts`:
```ts
base: '/your-repo-name/',
```

## Example Live Demos

Once deployed, you can share links like:
- `https://yourusername.github.io/codeatlas-ai/`
- `https://codeatlas-demo.netlify.app/`
- `https://codeatlas.vercel.app/`

Perfect for:
- 📊 Portfolio projects
- 🎓 Course demonstrations
- 👥 Team presentations
- 📱 Client showcases

---

**Your Food Delivery application graph is now ready to deploy as a static demo! 🚀**
