const { QWidget, FlexLayout, QPushButton } = require("@nodegui/nodegui");
const DirectorySelector = require("./DirectorySelector");
const CollectionIdInput = require("./CollectionIdInput");
const DownloadButton = require("./DownloadButton");
const SettingsView = require("./SettingsView");
const osuDownloader = require("../util/osuDownloader");
const OsuOfficialDownloader = require("../util/osuOfficialDownloader");
const configManager = require("../util/configManager");
const OAuth2Handler = require("../util/oauth2Handler");
const SessionAuthHandler = require("../util/sessionAuthHandler");

class RootView {
  constructor() {
    this.widget = new QWidget();
    this.layout = new FlexLayout();
    this.widget.setLayout(this.layout);

    this.osuDownloader = null;
    this.officialDownloader = null;
    this.currentTab = "download"; // Track current tab

    this.setupUI();
    
    // Defer authentication initialization to after UI is set up
    // Use setImmediate to avoid blocking the main thread
    setImmediate(() => {
      this._initializeAuthentication().catch(err => {
        console.error("Failed to initialize authentication:", err);
      });
    });
  }

  /**
   * Initialize authentication if credentials exist
   */
  async _initializeAuthentication() {
    try {
      if (!configManager.hasCredentials()) {
        console.log("No credentials configured, using mirrors only");
        this._setupDownloader(null);
        return;
      }

      const authMethod = configManager.getAuthMethod();
      const credentials = configManager.getCredentials();

      // Add timeout to prevent hanging
      const validationTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Auth validation timeout")), 5000)
      );

      if (authMethod === "oauth2") {
        try {
          const oauth2 = new OAuth2Handler(credentials.clientId, credentials.clientSecret);
          oauth2.setAccessToken(credentials.accessToken);

          // Validate token with timeout
          const isValid = await Promise.race([
            oauth2.validateToken(),
            validationTimeout
          ]);
          
          if (isValid) {
            this.officialDownloader = new OsuOfficialDownloader(oauth2);
            this._setupDownloader(this.officialDownloader);
            console.log("OAuth2 authentication successful");
          } else {
            console.log("OAuth2 token invalid, using mirrors only");
            this._setupDownloader(null);
          }
        } catch (err) {
          console.error("OAuth2 validation error:", err.message);
          this._setupDownloader(null);
        }
      } else if (authMethod === "session") {
        try {
          const sessionAuth = new SessionAuthHandler();
          sessionAuth.setSession(credentials.username, credentials.sessionCookie);

          // Validate session with timeout
          const isValid = await Promise.race([
            sessionAuth.validateSession(),
            validationTimeout
          ]);
          
          if (isValid) {
            this.officialDownloader = new OsuOfficialDownloader(sessionAuth);
            this._setupDownloader(this.officialDownloader);
            console.log("Session authentication successful");
          } else {
            console.log("Session invalid, using mirrors only");
            this._setupDownloader(null);
          }
        } catch (err) {
          console.error("Session validation error:", err.message);
          this._setupDownloader(null);
        }
      }
    } catch (err) {
      console.error("Error initializing authentication:", err.message);
      console.error(err.stack);
      this._setupDownloader(null);
    }
  }

  /**
   * Setup downloader with optional official downloader
   */
  _setupDownloader(officialDownloader) {
    this.osuDownloader = new osuDownloader(officialDownloader);
    
    // Update status label
    if (officialDownloader) {
      const authMethod = configManager.getAuthMethod();
      this.authStatusLabel.setText(`Status: Using official osu! (${authMethod === "oauth2" ? "OAuth2" : "Session"})`);
    } else {
      this.authStatusLabel.setText("Status: Using mirrors (no authentication)");
    }
  }

  setupUI() {
    // Initialize components
    this.directorySelector = new DirectorySelector();
    this.collectionIdInput = new CollectionIdInput();
    this.downloadButton = new DownloadButton();
    this.settingsView = new SettingsView();

    // Listen for credentials update from settings
    this.settingsView.on("credentialsUpdated", async () => {
      console.log("Credentials updated, reinitializing downloader...");
      await this._initializeAuthentication();
    });

    // Add Settings button at the top
    const settingsButton = new QPushButton();
    settingsButton.setText("Settings & Authentication");
    settingsButton.addEventListener("clicked", () => this._showSettingsDialog());
    this.layout.addWidget(settingsButton);

    // Add auth status label
    const { QLabel } = require("@nodegui/nodegui");
    this.authStatusLabel = new QLabel();
    this.authStatusLabel.setText("Status: Using mirrors (no authentication)");
    this.layout.addWidget(this.authStatusLabel);

    // Add components to root layout
    this.layout.addWidget(this.directorySelector.getWidget());
    this.layout.addWidget(this.collectionIdInput.getWidget());
    this.layout.addWidget(this.downloadButton.getWidget());

    // Listen for the download click event
    this.downloadButton.on("downloadClicked", () => {
      const directory = this.directorySelector.getDirectory();
      const collectionId = this.collectionIdInput.getCollectionId();

      if (!this.osuDownloader) {
        this.downloadButton.setDownloadStatus("Initializing downloader...");
        return;
      }

      if (!directory) {
        this.downloadButton.setDownloadStatus("Please select a directory.");
      } else if (!collectionId) {
        this.downloadButton.setDownloadStatus("Please enter a Collection ID.");
      } else {
        this.downloadButton.setDownloadStatus("Download started...");

        this.osuDownloader.downloadCollection(directory, collectionId);

        this.osuDownloader.on("directoryCreated", (directory) => {
          this.downloadButton.setDownloadStatus(`Directory created: ${directory}`);
        });

        this.osuDownloader.on("collectionRetrieved", (beatmapsets) => {
          this.downloadButton.setDownloadStatus(`Collection retrieved with ${beatmapsets.length} beatmapsets.`);
        });

        this.osuDownloader.on("beatmapAlreadyDownloaded", (beatmapId) => {
          this.downloadButton.setDownloadStatus(`[${beatmapId}] Beatmap already downloaded.`);
        });

        this.osuDownloader.on("beatmapDownloading", (fileName, mirrorName) => {
          this.downloadButton.setDownloadStatus(`[${fileName}] Beatmap downloading from ${mirrorName}`);
        });

        this.osuDownloader.on("beatmapDownloadSuccess", (fileName, mirrorName) => {
          this.downloadButton.setDownloadStatus(`[${fileName}] Beatmap download completed successfully from ${mirrorName}`);
        });

        this.osuDownloader.on("beatmapDownloadRetrying", (beatmapId, errorType, mirrorName, retryAttempt) => {
          this.downloadButton.setDownloadStatus(`[${beatmapId}] Download failed (${errorType}) from ${mirrorName}. Retrying... (attempt ${retryAttempt}/3)`);
        });

        this.osuDownloader.on("beatmapDownloadFailed", (fileName, errorType, mirrorName) => {
          const errorMsg = errorType ? ` (${errorType})` : "";
          this.downloadButton.setDownloadStatus(`[${fileName}] Beatmap download failed${errorMsg} on ${mirrorName}`);
        });

        this.osuDownloader.on("beatmapDownloadReattempt", (beatmapId, oldMirror, newMirror) => {
          this.downloadButton.setDownloadStatus(`[${beatmapId}] Trying alternate mirror: ${oldMirror} → ${newMirror}`);
        });

        this.osuDownloader.on("downloadCompleted", () => {
          this.downloadButton.setDownloadStatus("All downloads completed.");
        });
      }
    });
  }

  /**
   * Show settings dialog window
   */
  _showSettingsDialog() {
    const { QMainWindow } = require("@nodegui/nodegui");
    
    const settingsWindow = new QMainWindow();
    settingsWindow.setWindowTitle("Authentication Settings");
    settingsWindow.setFixedSize(500, 600);
    
    settingsWindow.setCentralWidget(this.settingsView.getWidget());
    settingsWindow.show();
  }

  getWidget() {
    return this.widget;
  }
}

module.exports = RootView;
