const fs = require("fs");
const path = require("path");

const stateDir = "/tmp/osu-job-states";

/**
 * Initialize state directory
 */
function initStateDir() {
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }
}

/**
 * Get job state file path
 */
function getJobStatePath(jobId) {
  return path.join(stateDir, `${jobId}.json`);
}

/**
 * Initialize job state
 */
function initializeJobState(jobId, totalBeatmaps) {
  initStateDir();
  const state = {
    jobId,
    status: "downloading", // downloading, completed, failed
    total: totalBeatmaps,
    downloaded: 0,
    errors: [],
    startTime: Date.now(),
    zipPath: null
  };
  saveJobState(jobId, state);
  return state;
}

/**
 * Get job state
 */
function getJobState(jobId) {
  initStateDir();
  const filePath = getJobStatePath(jobId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const data = fs.readFileSync(filePath, "utf8");
    return JSON.parse(data);
  } catch (err) {
    console.error(`Failed to read job state for ${jobId}:`, err);
    return null;
  }
}

/**
 * Save job state
 */
function saveJobState(jobId, state) {
  initStateDir();
  const filePath = getJobStatePath(jobId);
  try {
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf8");
  } catch (err) {
    console.error(`Failed to save job state for ${jobId}:`, err);
  }
}

/**
 * Update job progress
 */
function updateJobProgress(jobId, downloaded, errors = []) {
  const state = getJobState(jobId);
  if (state) {
    state.downloaded = downloaded;
    state.errors = errors;
    saveJobState(jobId, state);
  }
}

/**
 * Mark job as completed
 */
function completeJob(jobId, zipPath) {
  const state = getJobState(jobId);
  if (state) {
    state.status = "completed";
    state.zipPath = zipPath;
    saveJobState(jobId, state);
  }
}

/**
 * Mark job as failed
 */
function failJob(jobId, error) {
  const state = getJobState(jobId);
  if (state) {
    state.status = "failed";
    state.errors.push({
      beatmapId: null,
      error
    });
    saveJobState(jobId, state);
  }
}

/**
 * Get ZIP path for job
 */
function getJobZipPath(jobId) {
  const state = getJobState(jobId);
  return state ? state.zipPath : null;
}

/**
 * Delete job state
 */
function deleteJobState(jobId) {
  initStateDir();
  const filePath = getJobStatePath(jobId);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (err) {
      console.error(`Failed to delete job state for ${jobId}:`, err);
    }
  }
}

module.exports = {
  initializeJobState,
  getJobState,
  saveJobState,
  updateJobProgress,
  completeJob,
  failJob,
  getJobZipPath,
  deleteJobState
};
