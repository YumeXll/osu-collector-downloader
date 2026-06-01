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
      return res.status(400).json({
        error: "Missing jobId parameter"
      });
    }

    const progress = jobStateManager.getJobState(jobId);

    if (!progress) {
      return res.status(404).json({
        error: `Job ${jobId} not found`
      });
    }

    res.status(200).json({
      jobId,
      status: progress.status,
      total: progress.total,
      downloaded: progress.downloaded,
      errors: progress.errors || []
    });
  } catch (err) {
    console.error("Progress handler error:", err);
    res.status(500).json({
      error: err.message || "Internal server error"
    });
  }
}

module.exports = handler;
