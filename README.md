# osu!Collector Downloader (Web Version)

A simple, web-based beatmap collection downloader for osu!. Download collections from osu!Collector and get a ZIP file with all beatmaps.

## Features

- ✨ **Simple UI** - Just paste a collection ID and download
- 🔄 **Smart Retry Logic** - Automatically retries with 4 fallback mirrors
- ⚡ **Fast Downloads** - Parallel processing with smart delays
- 📊 **Live Progress** - Real-time download progress tracking
- 🎁 **ZIP Format** - All beatmaps bundled in a single ZIP file
- 🚀 **No Authentication** - No login or account needed

## How to Use

1. Visit the web app (deployed on Vercel)
2. Enter a collection ID (from osu!Collector)
3. Click "Start Download"
4. Watch the progress bar
5. Download the ZIP file when complete

### Finding Collection IDs

1. Go to [osu!Collector](https://osu-collector.com)
2. Find a collection you want
3. Copy the ID from the URL (e.g., `https://osu-collector.com/beatmaps/12345` → ID is `12345`)

## Technical Details

### Architecture

- **Frontend**: Vanilla HTML/CSS/JavaScript
- **Backend**: Vercel Serverless Functions (Node.js)
- **Download**: 4 fallback mirror endpoints with retry logic
- **Storage**: In-memory beatmap buffering + `/tmp` for ZIP generation

### Deployment on Vercel

1. **Prerequisites**:
   - Vercel account (free tier supported)
   - GitHub repository

2. **Deploy**:
   ```bash
   # Option 1: Via CLI
   npm install -g vercel
   vercel login
   vercel deploy --prod

   # Option 2: Via GitHub integration
   # - Push to GitHub
   # - Connect repo to Vercel
   # - Deploy automatically
   ```

3. **Environment**:
   - No environment variables required
   - Works out-of-the-box

### Local Development

```bash
# Install dependencies
npm install

# Start local dev server
npm run dev

# Open in browser
# http://localhost:3000
```

### API Endpoints

#### POST `/api/download`
Start a new download job.

Query parameters:
- `collectionId` (required): osu!Collector collection ID

Response:
```json
{
  "jobId": "job_12345_1234567890",
  "collectionName": "My Collection",
  "totalBeatmaps": 50
}
```

#### GET `/api/progress`
Get progress for a download job.

Query parameters:
- `jobId` (required): Job ID from `/api/download` response

Response:
```json
{
  "jobId": "job_12345_1234567890",
  "status": "downloading",
  "total": 50,
  "downloaded": 23,
  "errors": [
    { "beatmapId": 123, "error": "not_found" }
  ]
}
```

#### GET `/api/download?jobId=XXX&getZip=true`
Download the ZIP file for a completed job.

## Mirrors Used

The app tries to download from these mirrors in order (with fallback):

1. **BeatConnect** - `https://beatconnect.io/b/`
2. **VMirror** - `https://txy1.sayobot.cn/beatmaps/download/full/`
3. **Nerinyan** - `https://api.nerinyan.moe/d/`
4. **Sayobot** - `https://osu.sayobot.cn/d/`

Each mirror supports up to 3 retry attempts with exponential backoff.

## Limitations

- **Timeout**: Vercel free tier functions timeout after 60 seconds. Large collections (100+ beatmaps) may not complete.
- **Memory**: Vercel free tier has ~512MB memory limit. Very large collections may hit memory limits.
- **Rate Limiting**: Some mirrors may rate-limit requests. The app handles this with delays and retries.

### Future Improvements

To handle larger collections:
- Implement batch processing
- Use streaming ZIP instead of in-memory buffering
- Add database for job persistence (Redis, MongoDB)
- Upgrade to Vercel paid tier for longer timeouts

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Collection not found" | Verify the collection ID from osu-collector.com |
| Download hangs | Check browser console for errors. Large collections may timeout. |
| Some beatmaps missing | Mirror failover is working. Check the errors panel. |
| "ZIP file not found" | Download job expired. Try again. |

## Dependencies

- `axios` - HTTP requests
- `osu-collector-node` - osu!Collector API client
- `archiver` - ZIP file creation

## License

ISC

## Credits

- Built for osu! community
- Mirrors from BeatConnect, Sayobot, Nerinyan
- osu!Collector for collection data

---

**Questions?** Check the source code or open an issue on GitHub.
