/**
 * Frontend app for osu!Collector Downloader
 */

const downloadBtn = document.getElementById("downloadBtn");
const clearBtn = document.getElementById("clearBtn");
const collectionIdInput = document.getElementById("collectionId");
const progressSection = document.getElementById("progressSection");
const progressFill = document.getElementById("progressFill");
const progressText = document.getElementById("progressText");
const statusContainer = document.getElementById("statusContainer");
const errorList = document.getElementById("errorList");
const errorItems = document.getElementById("errorItems");
const downloadLink = document.getElementById("downloadLink");

let currentJobId = null;
let pollInterval = null;

/**
 * Start download
 */
downloadBtn.addEventListener("click", async () => {
  const collectionId = collectionIdInput.value.trim();

  if (!collectionId) {
    showStatus("Please enter a collection ID", "error");
    return;
  }

  // Reset state
  currentJobId = null;
  clearStatus();
  progressSection.classList.add("active");
  downloadBtn.disabled = true;
  downloadLink.style.display = "none";
  errorList.style.display = "none";

  try {
    // Start download on backend
    const response = await fetch(
      `/api/download?collectionId=${encodeURIComponent(collectionId)}`
    );

    if (!response.ok) {
      const error = await response.json();
      showStatus(error.error || "Failed to start download", "error");
      downloadBtn.disabled = false;
      progressSection.classList.remove("active");
      return;
    }

    const data = await response.json();
    currentJobId = data.jobId;

    showStatus("Download started...", "info");

    // Poll for progress
    pollProgress();
    pollInterval = setInterval(pollProgress, 500);
  } catch (err) {
    console.error("Download error:", err);
    showStatus(`Error: ${err.message}`, "error");
    downloadBtn.disabled = false;
    progressSection.classList.remove("active");
  }
});

/**
 * Poll for progress
 */
async function pollProgress() {
  if (!currentJobId) return;

  try {
    const response = await fetch(`/api/progress?jobId=${currentJobId}`);

    if (!response.ok) {
      showStatus("Failed to get progress", "error");
      stopPolling();
      downloadBtn.disabled = false;
      return;
    }

    const data = await response.json();

    // Update progress bar
    const percentage =
      data.total > 0 ? Math.round((data.downloaded / data.total) * 100) : 0;
    progressFill.style.width = percentage + "%";
    progressText.textContent = `${data.downloaded} / ${data.total} beatmaps`;

    // Show errors if any
    if (data.errors && data.errors.length > 0) {
      displayErrors(data.errors);
    }

    // Check if completed
    if (data.status === "completed") {
      stopPolling();
      showStatus(
        `✓ Download completed! ${data.downloaded} beatmaps downloaded.`,
        "success"
      );
      progressFill.style.width = "100%";

      // Show download link
      showDownloadLink(currentJobId);
      downloadBtn.disabled = false;
    }
  } catch (err) {
    console.error("Poll error:", err);
    showStatus(`Error: ${err.message}`, "error");
    stopPolling();
    downloadBtn.disabled = false;
  }
}

/**
 * Display errors in error list
 */
function displayErrors(errors) {
  if (errors.length === 0) {
    errorList.style.display = "none";
    return;
  }

  errorList.style.display = "block";
  errorItems.innerHTML = errors
    .map((err) => `<div class="error-item">Beatmap ${err.beatmapId}: ${err.error}</div>`)
    .join("");
}

/**
 * Show status message
 */
function showStatus(message, type) {
  const div = document.createElement("div");
  div.className = `status-message ${type}`;
  div.textContent = message;
  statusContainer.innerHTML = "";
  statusContainer.appendChild(div);
}

/**
 * Clear all status messages
 */
function clearStatus() {
  statusContainer.innerHTML = "";
  errorItems.innerHTML = "";
  errorList.style.display = "none";
}

/**
 * Show download link
 */
function showDownloadLink(jobId) {
  downloadLink.innerHTML = `
    <a href="/api/download?jobId=${jobId}&getZip=true" download="osu-beatmaps.zip">
      📥 Download ZIP
    </a>
  `;
  downloadLink.style.display = "block";
}

/**
 * Stop polling
 */
function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

/**
 * Clear button
 */
clearBtn.addEventListener("click", () => {
  collectionIdInput.value = "";
  currentJobId = null;
  stopPolling();
  clearStatus();
  progressSection.classList.remove("active");
  downloadBtn.disabled = false;
  progressFill.style.width = "0%";
  progressText.textContent = "0 / 0 beatmaps";
});

/**
 * Allow Enter key to start download
 */
collectionIdInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    downloadBtn.click();
  }
});
