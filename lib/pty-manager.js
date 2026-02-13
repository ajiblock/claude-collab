const pty = require("node-pty");
const { spawnSync } = require("child_process");
const config = require("./config");

// Resolve claude binary path (handles shell functions/aliases that node-pty can't spawn)
function resolveClaudePath() {
  const configured = config.claudePath;
  // If it's an absolute path, use it directly
  if (configured.startsWith("/")) return configured;
  // Otherwise, find the real binary via `command -v` in a shell
  const result = spawnSync("bash", ["-c", `command -v ${configured}`], { encoding: "utf-8" });
  const resolved = result.stdout?.trim();
  if (resolved && resolved.startsWith("/")) return resolved;
  return configured; // fallback
}

const CLAUDE_BIN = resolveClaudePath();

const COLLAB_SYSTEM_PROMPT = [
  "This is a collaborative terminal session shared with other users via claude-collab.",
  "When serving web content (HTML, static sites, frontend apps), ALWAYS use an HTTP server",
  "(e.g. npx serve, python3 -m http.server, npx http-server) instead of opening files with",
  "file:// URLs. The session has a live preview feature that proxies localhost ports to all",
  "connected users — file:// URLs only work on the local machine and cannot be previewed.",
].join(" ");

const MAX_SCROLLBACK = 50 * 1024; // 50KB

// Only pass safe env vars to the Claude subprocess
const ENV_WHITELIST = [
  "PATH", "HOME", "USER", "SHELL", "TERM", "LANG", "LC_ALL", "LC_CTYPE",
  "TMPDIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME",
  "ANTHROPIC_API_KEY",
];

function safeEnv() {
  const env = {};
  for (const key of ENV_WHITELIST) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

class PtyManager {
  constructor(cwd, { onData, onExit } = {}) {
    this.cwd = cwd;
    this.onDataCb = onData || (() => {});
    this.onExitCb = onExit || (() => {});
    this.scrollback = "";
    this.process = null;
    this._spawn();
  }

  _spawn() {
    this.process = pty.spawn(CLAUDE_BIN, ["--append-system-prompt", COLLAB_SYSTEM_PROMPT], {
      cwd: this.cwd,
      env: safeEnv(),
      cols: 120,
      rows: 40,
    });

    this.process.onData((data) => {
      this._appendScrollback(data);
      this.onDataCb(data);
    });

    this.process.onExit(({ exitCode, signal }) => {
      this.onExitCb({ exitCode, signal });
    });
  }

  _appendScrollback(data) {
    this.scrollback += data;
    if (this.scrollback.length > MAX_SCROLLBACK) {
      this.scrollback = this.scrollback.slice(-MAX_SCROLLBACK);
    }
  }

  write(data) {
    if (this.process) {
      this.process.write(data);
    }
  }

  resize(cols, rows) {
    if (this.process) {
      try {
        this.process.resize(cols, rows);
      } catch (e) {
        // PTY may have already exited
      }
    }
  }

  getScrollback() {
    return this.scrollback;
  }

  restart() {
    this.destroy();
    this.scrollback = "";
    this._spawn();
  }

  destroy() {
    if (this.process) {
      try {
        this.process.kill();
      } catch (e) {
        // Already dead
      }
      this.process = null;
    }
  }
}

module.exports = { PtyManager };
