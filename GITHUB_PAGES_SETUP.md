# Enable GitHub Pages for CodeAtlas AI Demo

Your code is now on GitHub! Follow these steps to enable GitHub Pages:

## Steps to Enable GitHub Pages

1. **Go to your repository**:
   https://github.com/Kaoserahamed/CodeAtlasAI_mvp

2. **Click on "Settings"** (top right, gear icon)

3. **Scroll down to "Pages"** (in left sidebar under "Code and automation")

4. **Configure Pages**:
   - **Source**: Select "GitHub Actions"
   - (Don't select "Deploy from a branch")

5. **Save**

That's it! The GitHub Actions workflow will automatically:
- Install dependencies
- Build the demo version
- Deploy to GitHub Pages

## Check Deployment Status

1. Go to **Actions** tab in your repository
2. You should see a workflow running: "Deploy to GitHub Pages"
3. Wait for it to complete (takes ~2-3 minutes)
4. Green checkmark = Success!

## Access Your Demo

Once deployed, your demo will be live at:

**🔗 https://kaoserahamed.github.io/CodeAtlasAI_mvp/**

## What Your Demo Shows

✅ **23 Files** from Food Delivery application
✅ **51 Functions** with parameters
✅ **54 Import relationships** 
✅ **416 Function calls**
✅ **Fully interactive** graph visualization
✅ **Click nodes** to see relationships
✅ **Zoom & pan** to explore
✅ **Details panel** showing connections

## Troubleshooting

### Workflow fails

Check the Actions tab for error messages. Common issues:
- Missing demo-data.json → Already included ✓
- Wrong base path → Already configured ✓
- Node version → Using Node 20 ✓

### 404 Error when accessing page

- Make sure you selected "GitHub Actions" as source
- Wait a few minutes after first deployment
- Check if workflow completed successfully

### Want to update the demo?

1. Scan a new repository locally
2. Export new graph data:
   ```powershell
   $data = (Invoke-WebRequest -Uri "http://localhost:3001/api/graph" -UseBasicParsing).Content | ConvertFrom-Json
   $data.data | ConvertTo-Json -Depth 10 -Compress | Set-Content "frontend/src/demo-data.json"
   ```
3. Commit and push:
   ```bash
   git add frontend/src/demo-data.json
   git commit -m "Update demo data"
   git push
   ```
4. GitHub Actions will automatically redeploy!

## Share Your Demo

Once live, share your link:
- 📱 Portfolio
- 💼 LinkedIn
- 📧 Email to recruiters
- 👥 Team presentations

---

**Your CodeAtlas AI demo is ready to go live! 🚀**
