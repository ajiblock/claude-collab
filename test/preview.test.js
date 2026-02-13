const { describe, it, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { detectPort } = require("../server.js");

// ── detectPort() unit tests ──

describe("detectPort()", () => {
  it("detects port from Vite-style output", () => {
    assert.strictEqual(detectPort("Local: http://localhost:5173/", 0), 5173);
  });

  it("detects port from 127.0.0.1 URL", () => {
    assert.strictEqual(detectPort("http://127.0.0.1:3000", 0), 3000);
  });

  it("detects port from ANSI-colored output", () => {
    assert.strictEqual(detectPort("  \x1b[32mhttp://localhost:8080/\x1b[0m", 0), 8080);
  });

  it("returns null for 0.0.0.0 (no localhost URL)", () => {
    assert.strictEqual(detectPort("Serving HTTP on 0.0.0.0 port 8080", 0), null);
  });

  it("returns null for port mention without URL prefix", () => {
    assert.strictEqual(detectPort("processing on port 9000", 0), null);
  });

  it("returns null for port below 1024", () => {
    assert.strictEqual(detectPort("http://localhost:80", 0), null);
  });

  it("returns null for no port", () => {
    assert.strictEqual(detectPort("no port here", 0), null);
  });

  it("detects https URL", () => {
    assert.strictEqual(detectPort("https://localhost:3000/", 0), 3000);
  });

  it("returns null for port above 65535", () => {
    assert.strictEqual(detectPort("http://localhost:99999", 0), null);
  });

  it("returns null when detected port matches serverPort", () => {
    assert.strictEqual(detectPort("http://localhost:4321/", 4321), null);
  });
});

// ── SessionManager.setPreviewPort() unit tests ──

describe("SessionManager.setPreviewPort()", () => {
  let tempDir;
  let originalEnv;
  let SessionManager;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "preview-test-"));

    process.env.DATA_DIR = tempDir;
    process.env.MAX_SESSIONS = "5";
    process.env.SESSION_IDLE_TIMEOUT = "0";

    for (const key of Object.keys(require.cache)) {
      if (key.includes("claude-collab") && !key.includes("node_modules")) {
        delete require.cache[key];
      }
    }

    const ptyModule = require("../lib/pty-manager.js");
    const gitModule = require("../lib/git.js");

    mock.method(ptyModule, "PtyManager", function MockPty(cwd, callbacks) {
      this.cwd = cwd;
      this.write = () => {};
      this.resize = () => {};
      this.getScrollback = () => "";
      this.destroy = () => {};
    });

    mock.method(gitModule, "cloneOrPull", (repoUrl, sessionDir) => {
      const { owner, name } = gitModule.parseRepoUrl(repoUrl);
      const repoDir = path.join(sessionDir, "repo");
      fs.mkdirSync(repoDir, { recursive: true });
      return { owner, name, repoDir };
    });

    SessionManager = require("../lib/sessions.js").SessionManager;
  });

  afterEach(() => {
    process.env = originalEnv;
    try {
      if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  });

  function createManager() {
    return new SessionManager({ onData: () => {}, onExit: () => {} });
  }

  it("sets valid port 3000 on active session", () => {
    const mgr = createManager();
    const s = mgr.create("https://github.com/test/repo");
    assert.strictEqual(mgr.setPreviewPort(s.id, 3000), true);
    assert.strictEqual(mgr.getInternal(s.id).previewPort, 3000);
  });

  it("sets port 1024 (lower boundary)", () => {
    const mgr = createManager();
    const s = mgr.create("https://github.com/test/repo");
    assert.strictEqual(mgr.setPreviewPort(s.id, 1024), true);
  });

  it("sets port 65535 (upper boundary)", () => {
    const mgr = createManager();
    const s = mgr.create("https://github.com/test/repo");
    assert.strictEqual(mgr.setPreviewPort(s.id, 65535), true);
  });

  it("rejects port 1023 (below range)", () => {
    const mgr = createManager();
    const s = mgr.create("https://github.com/test/repo");
    assert.strictEqual(mgr.setPreviewPort(s.id, 1023), false);
  });

  it("rejects port 65536 (above range)", () => {
    const mgr = createManager();
    const s = mgr.create("https://github.com/test/repo");
    assert.strictEqual(mgr.setPreviewPort(s.id, 65536), false);
  });

  it("rejects port 0", () => {
    const mgr = createManager();
    const s = mgr.create("https://github.com/test/repo");
    assert.strictEqual(mgr.setPreviewPort(s.id, 0), false);
  });

  it("rejects negative port", () => {
    const mgr = createManager();
    const s = mgr.create("https://github.com/test/repo");
    assert.strictEqual(mgr.setPreviewPort(s.id, -1), false);
  });

  it("rejects string port", () => {
    const mgr = createManager();
    const s = mgr.create("https://github.com/test/repo");
    assert.strictEqual(mgr.setPreviewPort(s.id, "3000"), false);
  });

  it("rejects NaN", () => {
    const mgr = createManager();
    const s = mgr.create("https://github.com/test/repo");
    assert.strictEqual(mgr.setPreviewPort(s.id, NaN), false);
  });

  it("rejects non-integer (3.5)", () => {
    const mgr = createManager();
    const s = mgr.create("https://github.com/test/repo");
    assert.strictEqual(mgr.setPreviewPort(s.id, 3.5), false);
  });

  it("rejects nonexistent session", () => {
    const mgr = createManager();
    assert.strictEqual(mgr.setPreviewPort("nonexistent", 3000), false);
  });

  it("rejects ended session", () => {
    const mgr = createManager();
    const s = mgr.create("https://github.com/test/repo");
    mgr.end(s.id);
    assert.strictEqual(mgr.setPreviewPort(s.id, 3000), false);
  });

  it("allows clearing port with null", () => {
    const mgr = createManager();
    const s = mgr.create("https://github.com/test/repo");
    mgr.setPreviewPort(s.id, 3000);
    assert.strictEqual(mgr.setPreviewPort(s.id, null), true);
    assert.strictEqual(mgr.getInternal(s.id).previewPort, null);
  });
});
