const jobStateManager = require("./jobStateManager");

/**
 * Progress endpoint
 * Query params:
 *   - jobId: Job ID to get progress for
 */
async function handler(req, res) {
  try {
    const { jobId } = req.query;

    if (!jobId) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({
        error: "Missing jobId parameter"
      }));
    }

    const progress = jobStateManager.getJobState(jobId);

    if (!progress) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({
        error: `Job ${jobId} not found`
      }));
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      jobId,
      status: progress.status,
      total: progress.total,
      downloaded: progress.downloaded,
      errors: progress.errors || []
    }));
  } catch (err) {
    console.error("Progress handler error:", err);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      error: err.message || "Internal server error"
    }));
  }
}

module.exports = handler;
