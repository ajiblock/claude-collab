const pty = require("node-pty");
const { spawnSync } = require("child_process");
const config = require("./config");

// Resolve claude binary path (handles shell functions/aliases that node-pty can't spawn)
function resolveClaudePath() {
  const configured = config.claudePath;
  // If it's an absolute path, use it directly
  if (configured.startsWith("/")) return configured;
  // Use which (array args, no shell interpolation) to find the real binary
  const result = spawnSync("which", [configured], { encoding: "utf-8" });
  const resolved = result.stdout?.trim();
  if (resolved && resolved.startsWith("/")) return resolved;
  return configured; // fallback
}

const CLAUDE_BIN = resolveClaudePath();

const MAX_SCROLLBACK = 50 * 1024; // 50KB

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
    // Whitelist env vars — don't leak secrets to the PTY (output is streamed to browsers)
    const safeEnv = {};
    const ALLOWED_ENV = [
      "PATH", "HOME", "USER", "SHELL", "TERM", "LANG", "LC_ALL",
      "EDITOR", "VISUAL", "TMPDIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME",
      "ANTHROPIC_API_KEY", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX",
      "AWS_PROFILE", "AWS_REGION",
    ];
    for (const key of ALLOWED_ENV) {
      if (process.env[key]) safeEnv[key] = process.env[key];
    }

    this.process = pty.spawn(CLAUDE_BIN, [], {
      cwd: this.cwd,
      env: safeEnv,
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
