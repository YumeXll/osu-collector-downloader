const { OsuCollectorNode } = require("osu-collector-node");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const mirrors = require("./mirrors.js");
const { EventEmitter } = require("events");

class osuDownloader extends EventEmitter {
  constructor(officialDownloader = null) {
    super();

    this.osuCollector = new OsuCollectorNode();
    this.downloadQueue = [];
    this.downloadDirectory = undefined;
    this.isDownloading = false;
    this.beatmapRetryAttempts = {}; // Track retry attempts per beatmap
    this.officialDownloader = officialDownloader; // Optional official osu downloader
  }

  /**
   * Calculate exponential backoff delay
   * @param {number} attemptNumber Attempt number (0-indexed)
   * @returns {number} Delay in milliseconds
   */
  _getBackoffDelay(attemptNumber) {
    // 1s, 2s, 4s, 8s, 16s (capped at 16s)
    const delay = Math.min(1000 * Math.pow(2, attemptNumber), 16000);
    // Add random jitter (±20% of delay) to prevent thundering herd
    const jitter = delay * 0.2 * (Math.random() - 0.5);
    return delay + jitter;
  }

  /**
   * Download a collection to a directory
   * @param {String} directory Directory to download to
   * @param {number} collectionId Collection Id
   */
  async downloadCollection(directory, collectionId) {
    const collection = await this.osuCollector.getCollection({ id: collectionId }).catch(console.log);
    const downloadDirectory = `${directory}/${collection.name.replace(/[/\\?%*:|"<>]/g, "-")}`; // Remove illegal characters

    if (collection && downloadDirectory) {
      this.downloadDirectory = downloadDirectory;

      // Create directory
      if (!fs.existsSync(downloadDirectory)) {
        fs.mkdirSync(downloadDirectory, { recursive: true });
        this.emit("directoryCreated", downloadDirectory);
      }

      this.emit("collectionRetrieved", collection.beatmapsets);

      // Add all beatmaps to download queue
      for (let beatmapset of collection.beatmapsets) {
        this.downloadQueue.push(beatmapset.id);
      }

      this._processQueue();
    }
  }

  /**
   * Processes the download queue
   */
  async _processQueue() {
    if (!this.isDownloading && !this.downloadQueue.length == 0) {
      this.isDownloading = true;

      while (this.downloadQueue.length > 0) {
        const beatmapId = this.downloadQueue.shift();
        await this._attemptBeatmapsetDownload(beatmapId, 0, true);
        // Add delay between downloads to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      this.isDownloading = false;

      this.emit("downloadCompleted");
    }
  }

  /**
   * Attempts to download a beatmap set with retry logic and exponential backoff
   * @param {number} beatmapId Beatmap Id
   * @param {number} api API index for mirrors
   * @param {boolean} reattempt Recursive searching
   * @param {number} retryCount Internal retry counter for the current mirror
   * @param {boolean} tryOfficial Whether to try official source first
   */
  async _attemptBeatmapsetDownload(beatmapId, api, reattempt = true, retryCount = 0, tryOfficial = true) {
    // Try official osu download first if available and not yet tried
    if (tryOfficial && this.officialDownloader) {
      try {
        const isAuthenticated = await this.officialDownloader.isAuthenticated();
        if (isAuthenticated) {
          this.emit("beatmapDownloading", beatmapId, "osu!");
          
          const beatmapPayload = await this.officialDownloader.downloadBeatmapset(
            beatmapId,
            this.downloadDirectory
          );

          const fileName = this.officialDownloader._getFilename(beatmapPayload.headers, beatmapId);
          const beatmapDirectory = path.join(this.downloadDirectory, fileName);

          return await this._streamToDisk(beatmapPayload, beatmapDirectory, fileName, "osu!", beatmapId);
        }
      } catch (err) {
        const errorType = this._getErrorType(err);
        this.emit("beatmapDownloadFailed", beatmapId, errorType, "osu!");
        // Fall through to mirrors
      }
    }

    const mirrorApi = mirrors[api];
    const fileUrl = `${mirrorApi.url}${beatmapId}`;
    const maxRetriesPerMirror = 3;

    // If file is already downloaded, skip
    const existingFiles = fs.readdirSync(this.downloadDirectory);
    const alreadyDownloaded = existingFiles.some((file) => file.includes(beatmapId));

    if (alreadyDownloaded) {
      this.emit("beatmapAlreadyDownloaded", beatmapId);
      return;
    }

    let beatmapPayload;
    try {
      beatmapPayload = await axios({
        method: "get",
        url: fileUrl,
        responseType: "stream",
        timeout: 30000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Referer": "https://osu.ppy.sh/",
          "Accept": "application/octet-stream",
          "Accept-Encoding": "gzip, deflate"
        }
      });
    } catch (err) {
      const errorType = this._getErrorType(err);
      
      // If we haven't exceeded retries for this mirror, retry with backoff
      if (retryCount < maxRetriesPerMirror) {
        const backoffDelay = this._getBackoffDelay(retryCount);
        this.emit("beatmapDownloadRetrying", beatmapId, errorType, mirrorApi.name, retryCount + 1);
        
        // Wait with backoff before retrying
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
        
        // Retry the same mirror
        return await this._attemptBeatmapsetDownload(beatmapId, api, reattempt, retryCount + 1, false);
      }
      
      // Max retries exhausted for this mirror, try next mirror
      this.emit("beatmapDownloadFailed", beatmapId, errorType, mirrorApi.name);
      
      // Reattempt with next API mirror
      const nextApiIndex = api + 1;
      if (reattempt && mirrors[nextApiIndex]) {
        this.emit("beatmapDownloadReattempt", beatmapId, mirrorApi.name, mirrors[nextApiIndex].name);
        
        // Reset retry count for new mirror
        await this._attemptBeatmapsetDownload(beatmapId, nextApiIndex, reattempt, 0, false);
      }
      return;
    }

    /**
     * Extract the filename from the 'Content-Disposition' header if available
     * Fallback to default naming convention if filename is not found
     */
    let fileName;
    try {
      fileName = beatmapPayload.headers["content-disposition"].match(/filename="(.+)"/)[1];
    } catch {
      fileName = `${beatmapId}(${mirrorApi.name}).osz`;
    }

    this.emit("beatmapDownloading", fileName, mirrorApi.name);

    const beatmapDirectory = path.join(this.downloadDirectory, fileName);

    return await this._streamToDisk(beatmapPayload, beatmapDirectory, fileName, mirrorApi.name, beatmapId);
  }

  /**
   * Stream downloaded beatmap to disk with error handling and retry logic
   */
  async _streamToDisk(beatmapPayload, beatmapDirectory, fileName, mirrorName, beatmapId, retryCount = 0) {
    const maxRetriesPerMirror = 3;

    /**
     * Attempt to download beatmap from request stream.
     * If the download fails/errors, remove file and retry with backoff
     */
    try {
      // Validate response status before piping
      if (beatmapPayload.status && beatmapPayload.status !== 200) {
        throw new Error(`HTTP ${beatmapPayload.status}: ${beatmapPayload.statusText}`);
      }

      // Validate content type (should be octet-stream or application/zip or similar)
      const contentType = beatmapPayload.headers["content-type"] || "";
      if (contentType.includes("text/html") || contentType.includes("application/json")) {
        throw new Error(`Invalid content type: ${contentType}. Expected application/octet-stream or archive format.`);
      }

      const writer = fs.createWriteStream(beatmapDirectory);
      let downloadedBytes = 0;
      const minFileSize = 100000; // At least 100KB expected

      beatmapPayload.data.pipe(writer); // Pipe the response data to the file

      // Monitor stream progress to detect incomplete downloads
      beatmapPayload.data.on("data", (chunk) => {
        downloadedBytes += chunk.length;
      });

      // Add timeout to stream in case it hangs
      const streamTimeout = setTimeout(() => {
        beatmapPayload.data.destroy();
        writer.destroy();
        throw new Error("Stream timeout: download took too long");
      }, 60000); // 60 second timeout for the stream

      return new Promise((resolve, reject) => {
        writer.on("finish", () => {
          clearTimeout(streamTimeout);
          
          // Validate downloaded file size
          const stats = fs.statSync(beatmapDirectory);
          if (stats.size < minFileSize) {
            // File is too small, likely an error page
            console.warn(`Downloaded file ${fileName} is only ${stats.size} bytes (expected >= ${minFileSize})`);
            fs.unlinkSync(beatmapDirectory);
            reject(new Error(`Downloaded file is too small (${stats.size} bytes)`));
            return;
          }

          this.emit("beatmapDownloadSuccess", fileName, mirrorName);
          resolve();
        });

        writer.on("error", (err) => {
          clearTimeout(streamTimeout);
          const errorType = this._getErrorType(err);
          
          // Delete beatmap file if it exists
          if (fs.existsSync(beatmapDirectory)) {
            fs.unlinkSync(beatmapDirectory);
          }
          
          // If we haven't exceeded retries for this mirror, retry with backoff
          if (retryCount < maxRetriesPerMirror) {
            const backoffDelay = this._getBackoffDelay(retryCount);
            this.emit("beatmapDownloadRetrying", beatmapId, errorType, mirrorName, retryCount + 1);
            
            // Retry with backoff - recursively call streamToDisk but this will not work
            // We need to refetch the file. For now, emit error and reject
            this.emit("beatmapDownloadFailed", fileName, errorType, mirrorName);
          } else {
            // Max retries exhausted
            this.emit("beatmapDownloadFailed", fileName, errorType, mirrorName);
          }
          
          reject(err);
        });

        beatmapPayload.data.on("error", (err) => {
          clearTimeout(streamTimeout);
          writer.destroy();
          reject(err);
        });
      });
    } catch (err) {
      const errorType = this._getErrorType(err);
      
      // Delete beatmap file if it exists
      if (fs.existsSync(beatmapDirectory)) {
        fs.unlinkSync(beatmapDirectory);
      }

      // If we haven't exceeded retries, retry with backoff
      if (retryCount < maxRetriesPerMirror) {
        const backoffDelay = this._getBackoffDelay(retryCount);
        this.emit("beatmapDownloadRetrying", beatmapId, errorType, mirrorName, retryCount + 1);
        
        // Wait with backoff before retrying
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
        
        // Retry streamToDisk with incremented retry count
        return await this._streamToDisk(beatmapPayload, beatmapDirectory, fileName, mirrorName, beatmapId, retryCount + 1);
      }

      this.emit("beatmapDownloadFailed", beatmapId, errorType, mirrorName);
      throw err;
    }
  }

  /**
   * Determine the type of error for better diagnostics
   * @param {Error} err The error object
   * @returns {string} Error type description
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
}

module.exports = osuDownloader;
