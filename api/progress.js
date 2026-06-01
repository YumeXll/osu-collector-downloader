const jobStateManager = require("./jobStateManager");

module.exports = async (req, res) => {
  try {
    const { jobId } = req.query;

    if (!jobId) {
      res.setHeader("Content-Type", "application/json");
      res.statusCode = 400;
      return res.end(JSON.stringify({
        error: "Missing jobId parameter"
      }));
    }

    const progress = jobStateManager.getJobState(jobId);

    if (!progress) {
      res.setHeader("Content-Type", "application/json");
      res.statusCode = 404;
      return res.end(JSON.stringify({
        error: `Job ${jobId} not found`
      }));
    }

    res.setHeader("Content-Type", "application/json");
    res.statusCode = 200;
    res.end(JSON.stringify({
      jobId,
      status: progress.status,
      total: progress.total,
      downloaded: progress.downloaded,
      errors: progress.errors || []
    }));
  } catch (err) {
    console.error("Progress handler error:", err);
    res.setHeader("Content-Type", "application/json");
    res.statusCode = 500;
    res.end(JSON.stringify({
      error: err.message || "Internal server error"
    }));
  }
};
