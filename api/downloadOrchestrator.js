const axios = require("axios");
const mirrors = require("./mirrors.js");
const jobStateManager = require("./jobStateManager");

/**
 * Orchestrates beatmap downloads with retry logic and mirror fallback
 * Stores beatmaps in memory and tracks progress
 */
class DownloadOrchestrator {
  constructor() {
    this.jobs = new Map(); // Job ID -> { status, progress, errors, beatmaps }
  }

  /**
   * Create a new download job
   */
  createJob(jobId, beatmapIds) {
    this.jobs.set(jobId, {
      status: "downloading", // downloading, completed, failed
      total: beatmapIds.length,
      downloaded: 0,
      errors: [],
      beatmaps: new Map(), // beatmapId -> buffer
      queue: [...beatmapIds]
    });
  }

  /**
   * Get job progress
   */
  getProgress(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return null;
    }
    return {
      status: job.status,
      total: job.total,
      downloaded: job.downloaded,
      errors: job.errors,
      beatmapCount: job.beatmaps.size
    };
  }

  /**
   * Get beatmaps for a job
   */
  getBeatmaps(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return null;
    }
    return job.beatmaps;
  }

  /**
   * Clear a completed job
   */
  clearJob(jobId) {
    this.jobs.delete(jobId);
  }

  /**
   * Calculate exponential backoff delay
   */
  _getBackoffDelay(attemptNumber) {
    const delay = Math.min(1000 * Math.pow(2, attemptNumber), 16000);
    const jitter = delay * 0.2 * (Math.random() - 0.5);
    return delay + jitter;
  }

  /**
   * Determine the type of error for better diagnostics
   */
  _getErrorType(err) {
    if (!err) return "unknown";

    if (err.code === "ECONNABORTED" || err.message.includes("timeout")) {
      return "timeout";
    } else if (err.code === "ECONNRESET" || err.code === "ECONNREFUSED") {
      return "connection_reset";
    } else if (err.code === "ENOTFOUND" || err.code === "ENETUNREACH") {
      return "network_error";
    } else if (err.response?.status === 429) {
      return "rate_limited";
    } else if (err.response?.status === 403 || err.response?.status === 401) {
      return "access_denied";
    } else if (err.response?.status === 404) {
      return "not_found";
    } else if (err.response?.status >= 500) {
      return "server_error";
    }

    return "unknown";
  }

  /**
   * Attempt to download a beatmap from all mirrors with retry logic
   */
  async _attemptBeatmapsetDownload(jobId, beatmapId, mirrorIndex = 0, retryCount = 0) {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    const maxRetriesPerMirror = 3;
    const mirrorApi = mirrors[mirrorIndex];

    if (!mirrorApi) {
      // All mirrors exhausted
      job.errors.push({
        beatmapId,
        error: "all_mirrors_exhausted"
      });
      // Persist error to state manager
      jobStateManager.updateJobProgress(jobId, job.downloaded, job.errors);
      return;
    }

    const fileUrl = `${mirrorApi.url}${beatmapId}`;

    try {
      const response = await axios({
        method: "get",
        url: fileUrl,
        responseType: "arraybuffer",
        timeout: 30000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Referer": "https://osu.ppy.sh/",
          "Accept": "application/octet-stream",
          "Accept-Encoding": "gzip, deflate"
        }
      });

      // Validate response
      if (response.status !== 200) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers["content-type"] || "";
      if (contentType.includes("text/html") || contentType.includes("application/json")) {
        throw new Error(`Invalid content type: ${contentType}`);
      }

      // Validate file size (at least 100KB)
      if (response.data.length < 100000) {
        throw new Error(`Downloaded file is too small (${response.data.length} bytes)`);
      }

      // Store beatmap
      job.beatmaps.set(beatmapId, {
        data: response.data,
        mirror: mirrorApi.name
      });
      job.downloaded++;
      
      // Persist progress to state manager
      jobStateManager.updateJobProgress(jobId, job.downloaded, job.errors);

      return;
    } catch (err) {
      const errorType = this._getErrorType(err);

      // Retry with backoff if we haven't exceeded retries
      if (retryCount < maxRetriesPerMirror) {
        const backoffDelay = this._getBackoffDelay(retryCount);
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
        return await this._attemptBeatmapsetDownload(jobId, beatmapId, mirrorIndex, retryCount + 1);
      }

      // Try next mirror
      return await this._attemptBeatmapsetDownload(jobId, beatmapId, mirrorIndex + 1, 0);
    }
  }

  /**
   * Download all beatmaps in a job
   */
  async downloadAllBeatmaps(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    while (job.queue.length > 0) {
      const beatmapId = job.queue.shift();
      await this._attemptBeatmapsetDownload(jobId, beatmapId);
      // Add delay between downloads to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    job.status = "completed";
  }
}

module.exports = DownloadOrchestrator;
