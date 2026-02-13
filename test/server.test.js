const { describe, it, before, after, mock } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

describe("server.js - HTTP API", () => {
  let originalEnv;
  let tempDir;
  let server;
  let baseUrl;

  before(async () => {
    originalEnv = { ...process.env };
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "server-test-"));

    process.env.DATA_DIR = tempDir;
    process.env.PORT = "0"; // random available port
    process.env.MAX_SESSIONS = "5";
    process.env.SESSION_IDLE_TIMEOUT = "0";

    // Clear ALL require caches first
    for (const key of Object.keys(require.cache)) {
      if (key.includes("claude-collab") && !key.includes("node_modules")) {
        delete require.cache[key];
      }
    }

    // Now require and mock the modules (fresh copies)
    const ptyModule = require("../lib/pty-manager.js");
    const gitModule = require("../lib/git.js");

    // Mock PtyManager constructor
    mock.method(ptyModule, "PtyManager", function MockPty(cwd, callbacks) {
      this.cwd = cwd;
      this.onDataCb = callbacks?.onData || (() => {});
      this.onExitCb = callbacks?.onExit || (() => {});
      this.scrollback = "Mock terminal output\r\n";
      this.process = { write: () => {}, resize: () => {}, kill: () => {} };
      this.write = () => {};
      this.resize = () => {};
      this.getScrollback = () => this.scrollback;
      this.restart = () => {};
      this.destroy = () => { this.process = null; };
    });

    // Mock git.ensureRepo to avoid real git operations
    mock.method(gitModule, "ensureRepo", (repoUrl, sessionDir) => {
      const { owner, name } = gitModule.parseRepoUrl(repoUrl);
      const repoDir = path.join(sessionDir, "repo");
      fs.mkdirSync(repoDir, { recursive: true });
      return { owner, name, repoDir };
    });

    // Now require server (it will pick up mocked modules from cache)
    const { startServer } = require("../server.js");
    server = await startServer();
    const addr = server.address();
    baseUrl = `http://localhost:${addr.port}`;
  });

  after(() => {
    if (server) {
      server.close();
      if (server.closeAllConnections) server.closeAllConnections();
    }
    process.env = originalEnv;
    try {
      if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
    mock.restoreAll();
  });

  it("GET /api/sessions returns empty array initially", async () => {
    const res = await fetch(`${baseUrl}/api/sessions`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data));
    assert.strictEqual(data.length, 0);
  });

  it("POST /api/sessions with invalid body returns 400", async () => {
    const res = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /repo URL is required/);
  });

  it("POST /api/sessions with non-string repo returns 400", async () => {
    const res = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: 123 }),
    });
    assert.strictEqual(res.status, 400);
    assert.ok((await res.json()).error);
  });

  it("POST /api/sessions with valid repo creates session", async () => {
    const res = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: "https://github.com/test/repo" }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.id);
    assert.strictEqual(data.repo, "test/repo");
    assert.strictEqual(data.status, "active");
  });

  it("POST /api/sessions with invalid repo URL returns 400", async () => {
    const res = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: "https://gitlab.com/test/repo" }),
    });
    assert.strictEqual(res.status, 400);
    assert.match((await res.json()).error, /Failed to create session/);
  });

  it("GET /api/sessions/:id returns 404 for unknown ID", async () => {
    const res = await fetch(`${baseUrl}/api/sessions/nonexistent`);
    assert.strictEqual(res.status, 404);
    assert.match((await res.json()).error, /Session not found/);
  });

  it("GET /api/sessions/:id returns session info", async () => {
    const createRes = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: "https://github.com/test/gettest" }),
    });
    const session = await createRes.json();

    const res = await fetch(`${baseUrl}/api/sessions/${session.id}`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.id, session.id);
    assert.strictEqual(data.repo, "test/gettest");
  });

  it("DELETE /api/sessions/:id returns 404 for unknown ID", async () => {
    const res = await fetch(`${baseUrl}/api/sessions/nonexistent`, { method: "DELETE" });
    assert.strictEqual(res.status, 404);
    assert.match((await res.json()).error, /Session not found/);
  });

  it("DELETE /api/sessions/:id ends session", async () => {
    // Use GET to find an active session (created by earlier tests)
    const listRes = await fetch(`${baseUrl}/api/sessions`);
    const sessions = await listRes.json();
    const active = sessions.find(s => s.status === "active");
    assert.ok(active, "Need an active session to test DELETE");

    const res = await fetch(`${baseUrl}/api/sessions/${active.id}`, { method: "DELETE" });
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).ok, true);

    const getRes = await fetch(`${baseUrl}/api/sessions/${active.id}`);
    assert.strictEqual((await getRes.json()).status, "ended");
  });

  it("Rate limiting: 6th POST in quick succession returns 429", async () => {
    // Create sessions until rate limited (some may hit max sessions instead)
    let got429 = false;
    for (let i = 0; i < 10; i++) {
      const res = await fetch(`${baseUrl}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: `https://github.com/test/rate${i}` }),
      });
      if (res.status === 429) {
        got429 = true;
        assert.match((await res.json()).error, /Rate limited/);
        break;
      }
    }
    assert.ok(got429, "Should have been rate limited after multiple rapid requests");
  });

  it("GET /s/:sessionId serves session.html", async () => {
    const res = await fetch(`${baseUrl}/s/abc123`);
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes("<!DOCTYPE html>"));
  });

  it("GET / serves dashboard", async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes("<!DOCTYPE html>"));
  });
});
