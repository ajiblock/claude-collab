const path = require("path");

function loadConfig() {
  const config = {
    port: parseInt(process.env.PORT, 10) || 4321,
    host: process.env.HOST || "0.0.0.0",
    baseUrl: process.env.BASE_URL || null, // computed after tunnel
    dataDir: path.resolve(process.env.DATA_DIR || "./data"),
    claudePath: process.env.CLAUDE_PATH || "claude",
    maxSessions: parseInt(process.env.MAX_SESSIONS, 10) || 10,
    sessionIdleTimeout: parseInt(process.env.SESSION_IDLE_TIMEOUT, 10) || 0, // 0 = disabled, minutes
    chatEnabled: process.env.CLAUDE_COLLAB_NO_CHAT !== "1",
  };

  if (isNaN(config.port) || config.port < 0 || config.port > 65535) {
    throw new Error(`Invalid PORT: ${process.env.PORT}`);
  }
  if (isNaN(config.maxSessions) || config.maxSessions < 1) {
    throw new Error(`Invalid MAX_SESSIONS: ${process.env.MAX_SESSIONS}`);
  }
  if (isNaN(config.sessionIdleTimeout) || config.sessionIdleTimeout < 0) {
    throw new Error(`Invalid SESSION_IDLE_TIMEOUT: ${process.env.SESSION_IDLE_TIMEOUT}`);
  }

  return Object.freeze(config);
}

const config = loadConfig();

module.exports = config;
