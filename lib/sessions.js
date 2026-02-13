const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const config = require("./config");
const { cloneOrPull, parseRepoUrl } = require("./git");
const { PtyManager } = require("./pty-manager");
const { Session } = require("./session");

class SessionManager {
  constructor({ onData, onExit, onEnd }) {
    this.sessions = new Map();
    this.onData = onData;
    this.onExit = onExit;
    this.onEnd = onEnd || (() => {});
  }

  create(repoUrl) {
    const { owner, name } = parseRepoUrl(repoUrl);

    const activeCount = [...this.sessions.values()].filter(
      (s) => s.status !== "ended"
    ).length;
    if (activeCount >= config.maxSessions) {
      throw new Error(
        `Maximum sessions (${config.maxSessions}) reached. End an existing session first.`
      );
    }

    const id = crypto.randomBytes(16).toString("hex");
    const sessionDir = path.join(config.dataDir, "sessions", id);
    fs.mkdirSync(sessionDir, { recursive: true });

    const reposDir = path.join(config.dataDir, "repos");
    const { repoDir } = cloneOrPull(repoUrl, reposDir);

    const chatFilePath = path.join(sessionDir, "chat.json");
    const session = new Session(chatFilePath);

    const ptyManager = new PtyManager(repoDir, {
      onData: (data) => this.onData(id, data),
      onExit: ({ exitCode, signal }) => this.onExit(id, exitCode, signal),
    });

    const entry = {
      id,
      repo: `${owner}/${name}`,
      repoOwner: owner,
      repoName: name,
      repoDir,
      status: "active",
      createdAt: Date.now(),
      endedAt: null,
      ptyManager,
      session,
      clients: new Set(),
      clientSizes: new Map(),
      idleTimer: null,
      previewPort: null,
    };

    this.sessions.set(id, entry);
    return this._publicInfo(entry);
  }

  get(id) {
    const entry = this.sessions.get(id);
    if (!entry) return null;
    return this._publicInfo(entry);
  }

  list() {
    return [...this.sessions.values()].map((e) => this._publicInfo(e));
  }

  getInternal(id) {
    return this.sessions.get(id) || null;
  }

  end(id) {
    const entry = this.sessions.get(id);
    if (!entry || entry.status === "ended") return;

    entry.status = "ended";
    entry.endedAt = Date.now();

    // Notify clients before closing connections
    this.onEnd(id);

    entry.ptyManager.destroy();
    entry.session.saveChatHistory();

    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }

    for (const client of entry.clients) {
      try {
        client.close(1000, "Session ended");
      } catch {}
    }
    entry.clients.clear();
    entry.clientSizes.clear();
  }

  addClient(id, ws) {
    const entry = this.sessions.get(id);
    if (!entry) return;
    entry.clients.add(ws);
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
  }

  removeClient(id, ws) {
    const entry = this.sessions.get(id);
    if (!entry) return;
    entry.clients.delete(ws);
    entry.clientSizes.delete(ws);

    if (
      entry.clients.size === 0 &&
      config.sessionIdleTimeout > 0 &&
      entry.status === "active"
    ) {
      entry.idleTimer = setTimeout(() => {
        console.log(
          `[${id.slice(0, 8)}] Session idle for ${config.sessionIdleTimeout}min, ending.`
        );
        this.end(id);
      }, config.sessionIdleTimeout * 60 * 1000);
    }
  }

  setPreviewPort(id, port) {
    const entry = this.sessions.get(id);
    if (!entry || entry.status === "ended") return false;
    if (port === null) {
      entry.previewPort = null;
      return true;
    }
    if (typeof port !== "number" || !Number.isFinite(port)) return false;
    if (Math.floor(port) !== port) return false;
    if (port < 1024 || port > 65535) return false;
    entry.previewPort = port;
    return true;
  }

  shutdownAll() {
    for (const [id, entry] of this.sessions) {
      if (entry.status !== "ended") {
        this.end(id);
      }
    }
  }

  _publicInfo(entry) {
    return {
      id: entry.id,
      repo: entry.repo,
      status: entry.status,
      clientCount: entry.clients.size,
      createdAt: entry.createdAt,
      endedAt: entry.endedAt,
      url: `/s/${entry.id}`,
    };
  }
}

module.exports = { SessionManager };
