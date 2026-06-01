# Deployment Guide for osu!Collector Downloader Web

## Quick Start

The web app is ready to deploy to Vercel. Follow these steps:

### Option 1: Deploy via GitHub (Recommended)

1. **Push to GitHub**:
   ```bash
   git add .
   git commit -m "Initial web version"
   git push origin main
   ```

2. **Connect to Vercel**:
   - Go to [vercel.com](https://vercel.com)
   - Click "New Project"
   - Import your GitHub repository
   - Vercel will auto-detect the configuration
   - Click "Deploy"

3. **Your app is live!** 🚀
   - Vercel will provide a URL like `https://your-project.vercel.app`

### Option 2: Deploy via Vercel CLI

1. **Install Vercel CLI** (requires Node 16+):
   ```bash
   npm install -g vercel
   ```

2. **Login to Vercel**:
   ```bash
   vercel login
   ```

3. **Deploy**:
   ```bash
   vercel --prod
   ```

4. **Your app is live!** 🚀

## Testing Before Deployment

### Local Testing (Requires Node 18+)

If you have Node 18+ installed:

```bash
npm install
npm run dev
```

Then open `http://localhost:3000` in your browser.

### Manual Testing

Without Vercel CLI, you can still test the backend:

```bash
node -e "
const orchestrator = require('./api/downloadOrchestrator.js');
const jobs = new orchestrator();
console.log('Orchestrator initialized successfully');
"
```

## Project Structure

```
.
├── public/
│   ├── index.html       # Frontend UI
│   └── app.js           # Frontend JavaScript
├── api/
│   ├── download.js      # Main download endpoint
│   ├── progress.js      # Progress polling endpoint
│   ├── mirrors.js       # Mirror endpoints config
│   ├── downloadOrchestrator.js  # Download logic
│   └── jobStateManager.js       # Job state persistence
├── vercel.json          # Vercel config
├── package.json         # Dependencies
└── README.md            # Documentation
```

## How It Works

1. **User visits web app** → Served by Vercel static hosting
2. **User enters collection ID** → Frontend sends request to `/api/download`
3. **Backend fetches collection** → Uses `osu-collector-node` package
4. **Backend downloads beatmaps** → Uses 4 mirrors with fallback
5. **Frontend polls progress** → `/api/progress` endpoint
6. **Job completes** → ZIP file created in `/tmp`
7. **User downloads ZIP** → Served via `/api/download?jobId=XXX&getZip=true`

## Performance & Limits

| Aspect | Limit | Solution |
|--------|-------|----------|
| Function Timeout | 60 seconds (free) | Large collections may timeout |
| Memory | ~512MB (free) | Use streaming for very large collections |
| Concurrent Requests | 100 (free) | Share job state across functions |
| Build Time | 45 seconds (free) | Keep dependencies minimal |

## Scaling for Production

When you need to handle more collections:

1. **Upgrade Vercel Plan**
   - Increase timeout to 300+ seconds
   - Increase memory limits

2. **Add Database**
   - Use MongoDB/Redis for persistent job storage
   - Replace file-based state storage

3. **Streaming Improvements**
   - Use streaming ZIP instead of in-memory buffering
   - Implement batch processing for very large collections

4. **Caching**
   - Cache already-downloaded beatmaps
   - Use CDN for faster mirror access

## Environment Variables

Currently, the app needs **no environment variables**. If you add features (like analytics, error logging), you can store secrets in Vercel:

```bash
vercel env add SECRET_NAME
```

Then access in your code:
```javascript
const secret = process.env.SECRET_NAME;
```

## Monitoring & Logging

Vercel provides logs in the dashboard. To view in terminal:

```bash
vercel logs
```

To stream logs:
```bash
vercel logs --follow
```

## Common Issues

### "Module not found" errors
- All dependencies are listed in `package.json`
- Run `npm install` locally to verify

### "Cannot find collection" 
- Verify collection ID from https://osu-collector.com
- Collection must be public

### ZIP download doesn't start
- Check browser console for JavaScript errors
- Verify network request in DevTools

### Timeout on large collections
- Increase Vercel plan or upgrade timeout
- Consider batch processing in future version

## Support & Contribution

- Check the main [README.md](./README.md)
- Report issues on GitHub
- Submit PRs for improvements

---

**Happy downloading!** 🎵
