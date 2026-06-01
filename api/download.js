const { OsuCollectorNode } = require("osu-collector-node");
const archiver = require("archiver");
const fs = require("fs");
const path = require("path");
const DownloadOrchestrator = require("./downloadOrchestrator");
const jobStateManager = require("./jobStateManager");

// Global orchestrator instance
const orchestrator = new DownloadOrchestrator();

// Temporary storage directories
const tmpDir = "/tmp/osu-downloads";
const stateDir = "/tmp/osu-job-states";
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
}

/**
 * Main download endpoint handler
 */
async function handler(req, res) {
  console.log("Download endpoint called:", { method: req.method, query: req.query });
  
  try {
    const { collectionId, jobId, getZip } = req.query;

    // Mode 1: Start new download
    if (collectionId && !getZip) {
      console.log("Starting download for collection:", collectionId);
      return await startDownload(collectionId, res);
    }

    // Mode 2: Get ZIP file
    if (jobId && getZip === "true") {
      console.log("Retrieving ZIP for job:", jobId);
      return await getZipFile(jobId, res);
    }

    // Invalid request
    console.log("Invalid request - missing parameters");
    res.setHeader("Content-Type", "application/json");
    res.statusCode = 400;
    return res.end(JSON.stringify({
      error: "Invalid request. Provide either collectionId or (jobId + getZip=true)"
    }));
  } catch (err) {
    console.error("Download handler error:", err);
    res.setHeader("Content-Type", "application/json");
    res.statusCode = 500;
    res.end(JSON.stringify({
      error: err.message || "Internal server error"
    }));
  }
}

module.exports = handler;

/**
 * Start a new download job
 */
async function startDownload(collectionId, res) {
  try {
    console.log("startDownload called for collection:", collectionId);
    
    // Fetch collection from osu!Collector
    const osuCollector = new OsuCollectorNode();
    console.log("OsuCollectorNode created");
    
    const collection = await osuCollector.getCollection({ id: collectionId });
    console.log("Collection fetched:", collection?.name, "beatmaps:", collection?.beatmapsets?.length);

    if (!collection || !collection.beatmapsets) {
      console.log("Collection not found or invalid");
      res.setHeader("Content-Type", "application/json");
      res.statusCode = 404;
      return res.end(JSON.stringify({
        error: `Collection ${collectionId} not found`
      }));
    }

    // Create unique job ID
    const jobId = `job_${collectionId}_${Date.now()}`;

    // Extract beatmap IDs
    const beatmapIds = collection.beatmapsets.map((bs) => bs.id);
    console.log("Job ID created:", jobId, "with", beatmapIds.length, "beatmaps");

    // Initialize job state
    jobStateManager.initializeJobState(jobId, beatmapIds.length);
    console.log("Job state initialized");

    // Create job in orchestrator
    orchestrator.createJob(jobId, beatmapIds);
    console.log("Job created in orchestrator");

    // Start async download (don't await, let it run in background)
    downloadAllBeatmaps(jobId).catch((err) => {
      console.error(`Download failed for job ${jobId}:`, err);
      jobStateManager.failJob(jobId, err.message);
    });

    console.log("Sending response with jobId:", jobId);
    res.setHeader("Content-Type", "application/json");
    res.statusCode = 200;
    const responseData = {
      jobId,
      collectionName: collection.name,
      totalBeatmaps: beatmapIds.length
    };
    console.log("Response data:", responseData);
    res.end(JSON.stringify(responseData));
    console.log("Response sent successfully");
  } catch (err) {
    console.error("Start download error:", err);
    res.setHeader("Content-Type", "application/json");
    res.statusCode = 500;
    res.end(JSON.stringify({
      error: err.message || "Failed to fetch collection"
    }));
  }
}

/**
 * Download all beatmaps for a job and create ZIP
 */
async function downloadAllBeatmaps(jobId) {
  const job = orchestrator.jobs.get(jobId);
  if (!job) {
    throw new Error(`Job ${jobId} not found`);
  }

  try {
    // Download all beatmaps
    await orchestrator.downloadAllBeatmaps(jobId);

    // Update state with progress
    const errors = job.errors.map((e) => ({
      beatmapId: e.beatmapId,
      error: e.error
    }));
    jobStateManager.updateJobProgress(jobId, job.downloaded, errors);

    // Create ZIP file
    const zipPath = path.join(tmpDir, `${jobId}.zip`);
    await createZipFile(jobId, zipPath);

    // Mark job as completed
    jobStateManager.completeJob(jobId, zipPath);
  } catch (err) {
    jobStateManager.failJob(jobId, err.message);
    throw err;
  }
}

/**
 * Create ZIP file from beatmaps
 */
async function createZipFile(jobId, zipPath) {
  return new Promise((resolve, reject) => {
    const job = orchestrator.jobs.get(jobId);
    if (!job) {
      return reject(new Error(`Job ${jobId} not found`));
    }

    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", {
      zlib: { level: 6 } // Compression level
    });

    output.on("close", () => {
      console.log(`ZIP created: ${zipPath} (${archive.pointer()} bytes)`);
      resolve();
    });

    archive.on("error", (err) => {
      console.error("ZIP creation error:", err);
      reject(err);
    });

    archive.pipe(output);

    // Add each beatmap to ZIP
    let fileIndex = 0;
    for (const [beatmapId, beatmapData] of job.beatmaps) {
      const fileName = `${fileIndex}_${beatmapId}_${beatmapData.mirror}.osz`;
      archive.append(beatmapData.data, { name: fileName });
      fileIndex++;
    }

    archive.finalize();
  });
}

/**
 * Retrieve ZIP file for download
 */
async function getZipFile(jobId, res) {
  try {
    const jobState = jobStateManager.getJobState(jobId);

    if (!jobState) {
      res.setHeader("Content-Type", "application/json");
      res.statusCode = 404;
      return res.end(JSON.stringify({
        error: `Job ${jobId} not found`
      }));
    }

    if (jobState.status !== "completed") {
      res.setHeader("Content-Type", "application/json");
      res.statusCode = 400;
      return res.end(JSON.stringify({
        error: `Job ${jobId} is not ready. Status: ${jobState.status}`
      }));
    }

    if (!jobState.zipPath || !fs.existsSync(jobState.zipPath)) {
      res.setHeader("Content-Type", "application/json");
      res.statusCode = 500;
      return res.end(JSON.stringify({
        error: "ZIP file not found"
      }));
    }

    // Send ZIP file
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", "attachment; filename=osu-beatmaps.zip");

    const fileStream = fs.createReadStream(jobState.zipPath);
    fileStream.pipe(res);

    // Clean up after download
    fileStream.on("end", () => {
      setTimeout(() => {
        try {
          if (fs.existsSync(jobState.zipPath)) {
            fs.unlinkSync(jobState.zipPath);
          }
          jobStateManager.deleteJobState(jobId);
          orchestrator.clearJob(jobId);
        } catch (err) {
          console.error("Cleanup error:", err);
        }
      }, 1000);
    });

    fileStream.on("error", (err) => {
      console.error("File stream error:", err);
      res.setHeader("Content-Type", "application/json");
      res.statusCode = 500;
      res.end(JSON.stringify({
        error: "Failed to download file"
      }));
    });
  } catch (err) {
    console.error("Get ZIP error:", err);
    res.setHeader("Content-Type", "application/json");
    res.statusCode = 500;
    res.end(JSON.stringify({
      error: err.message || "Failed to retrieve ZIP"
    }));
  }
}

module.exports = handler;
