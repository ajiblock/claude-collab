const { describe, it, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

describe("lib/sessions.js - SessionManager", () => {
  let tempDir;
  let originalEnv;
  let SessionManager;

  beforeEach(() => {
    // Save original env
    originalEnv = { ...process.env };

    // Create temp directory for tests
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sessions-test-"));

    // Set up test environment
    process.env.DATA_DIR = tempDir;
    process.env.MAX_SESSIONS = "3";
    process.env.SESSION_IDLE_TIMEOUT = "0";

    // Clear require cache
    delete require.cache[require.resolve("../lib/config.js")];
    delete require.cache[require.resolve("../lib/sessions.js")];
    delete require.cache[require.resolve("../lib/git.js")];
    delete require.cache[require.resolve("../lib/pty-manager.js")];

    // Mock PtyManager before requiring SessionManager
    const PtyManagerModule = require("../lib/pty-manager.js");
    mock.method(PtyManagerModule, "PtyManager", function (cwd, callbacks) {
      // Mock PtyManager constructor
      this.cwd = cwd;
      this.onDataCb = callbacks?.onData || (() => {});
      this.onExitCb = callbacks?.onExit || (() => {});
      this.scrollback = "Mock terminal output\r\n";
      this.process = { write: () => {}, resize: () => {}, kill: () => {} };
      this.write = mock.fn(() => {});
      this.resize = mock.fn(() => {});
      this.getScrollback = mock.fn(() => this.scrollback);
      this.destroy = mock.fn(() => {
        this.process = null;
      });
    });

    // Mock git.cloneOrPull
    const gitModule = require("../lib/git.js");
    mock.method(gitModule, "cloneOrPull", (repoUrl, sessionDir) => {
      // Parse the URL to validate it (will throw if invalid)
      const { parseRepoUrl } = gitModule;
      const { owner, name } = parseRepoUrl(repoUrl);
      const repoDir = path.join(sessionDir, "repo");
      fs.mkdirSync(repoDir, { recursive: true });
      return { owner, name, repoDir };
    });

    // Now require SessionManager with mocks in place
    SessionManager = require("../lib/sessions.js").SessionManager;
  });

  afterEach(() => {
    // Restore env
    process.env = originalEnv;
    delete require.cache[require.resolve("../lib/config.js")];
    delete require.cache[require.resolve("../lib/sessions.js")];
    delete require.cache[require.resolve("../lib/git.js")];
    delete require.cache[require.resolve("../lib/pty-manager.js")];

    // Clean up temp directory
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (e) {
      // Ignore cleanup errors
    }

    mock.restoreAll();
  });

  it("constructor creates empty sessions map", () => {
    const manager = new SessionManager({
      onData: () => {},
      onExit: () => {},
    });
    assert.strictEqual(manager.sessions.size, 0);
  });

  it("get returns null for unknown session ID", () => {
    const manager = new SessionManager({
      onData: () => {},
      onExit: () => {},
    });
    const result = manager.get("nonexistent-id");
    assert.strictEqual(result, null);
  });

  it("list returns empty array initially", () => {
    const manager = new SessionManager({
      onData: () => {},
      onExit: () => {},
    });
    const list = manager.list();
    assert.ok(Array.isArray(list));
    assert.strictEqual(list.length, 0);
  });

  it("create returns session with correct public info shape", () => {
    const manager = new SessionManager({
      onData: () => {},
      onExit: () => {},
    });
    const session = manager.create("https://github.com/test/repo");
    assert.ok(session.id);
    assert.strictEqual(session.repo, "test/repo");
    assert.strictEqual(session.status, "active");
    assert.strictEqual(session.clientCount, 0);
    assert.ok(session.createdAt);
    assert.strictEqual(session.endedAt, null);
    assert.strictEqual(session.url, `/s/${session.id}`);
  });

  it("enforces maxSessions limit", () => {
    const manager = new SessionManager({
      onData: () => {},
      onExit: () => {},
    });
    // MAX_SESSIONS is set to 3 in beforeEach
    manager.create("https://github.com/test/repo1");
    manager.create("https://github.com/test/repo2");
    manager.create("https://github.com/test/repo3");

    assert.throws(
      () => manager.create("https://github.com/test/repo4"),
      /Maximum sessions \(3\) reached/
    );
  });

  it("maxSessions limit only counts active sessions", () => {
    const manager = new SessionManager({
      onData: () => {},
      onExit: () => {},
    });
    const session1 = manager.create("https://github.com/test/repo1");
    manager.create("https://github.com/test/repo2");
    manager.create("https://github.com/test/repo3");

    // End one session
    manager.end(session1.id);

    // Should be able to create a new one
    const session4 = manager.create("https://github.com/test/repo4");
    assert.ok(session4);
    assert.strictEqual(session4.status, "active");
  });

  it("end changes status and calls cleanup", () => {
    const onEndCalled = [];
    const manager = new SessionManager({
      onData: () => {},
      onExit: () => {},
      onEnd: (id) => onEndCalled.push(id),
    });
    const session = manager.create("https://github.com/test/repo");
    assert.strictEqual(session.status, "active");

    manager.end(session.id);
    const endedSession = manager.get(session.id);
    assert.strictEqual(endedSession.status, "ended");
    assert.ok(endedSession.endedAt);
    assert.strictEqual(onEndCalled.length, 1);
    assert.strictEqual(onEndCalled[0], session.id);
  });

  it("end is idempotent - calling twice does not error", () => {
    const manager = new SessionManager({
      onData: () => {},
      onExit: () => {},
    });
    const session = manager.create("https://github.com/test/repo");
    manager.end(session.id);
    manager.end(session.id); // Should not throw
  });

  it("addClient / removeClient manage the Set correctly", () => {
    const manager = new SessionManager({
      onData: () => {},
      onExit: () => {},
    });
    const session = manager.create("https://github.com/test/repo");
    assert.strictEqual(session.clientCount, 0);

    const mockWs1 = { id: "ws1" };
    const mockWs2 = { id: "ws2" };

    manager.addClient(session.id, mockWs1);
    let updated = manager.get(session.id);
    assert.strictEqual(updated.clientCount, 1);

    manager.addClient(session.id, mockWs2);
    updated = manager.get(session.id);
    assert.strictEqual(updated.clientCount, 2);

    manager.removeClient(session.id, mockWs1);
    updated = manager.get(session.id);
    assert.strictEqual(updated.clientCount, 1);

    manager.removeClient(session.id, mockWs2);
    updated = manager.get(session.id);
    assert.strictEqual(updated.clientCount, 0);
  });

  it("idle timeout starts when last client removed (if configured)", () => {
    // Need to set up a fresh environment with idle timeout enabled
    // Clean up all modules
    delete require.cache[require.resolve("../lib/config.js")];
    delete require.cache[require.resolve("../lib/sessions.js")];

    // Set idle timeout
    process.env.SESSION_IDLE_TIMEOUT = "1"; // 1 minute

    // Now require SessionManager with the new config
    const { SessionManager: SM } = require("../lib/sessions.js");
    const manager = new SM({
      onData: () => {},
      onExit: () => {},
    });
    const session = manager.create("https://github.com/test/repo");

    const mockWs = { id: "ws1" };
    manager.addClient(session.id, mockWs);

    const internal = manager.getInternal(session.id);
    assert.strictEqual(internal.idleTimer, null);

    // Remove client - should start idle timer
    manager.removeClient(session.id, mockWs);
    assert.notStrictEqual(internal.idleTimer, null);
  });

  it("idle timeout is cleared when client connects", () => {
    // Need to set up a fresh environment with idle timeout enabled
    delete require.cache[require.resolve("../lib/config.js")];
    delete require.cache[require.resolve("../lib/sessions.js")];

    process.env.SESSION_IDLE_TIMEOUT = "1";

    const { SessionManager: SM } = require("../lib/sessions.js");
    const manager = new SM({
      onData: () => {},
      onExit: () => {},
    });
    const session = manager.create("https://github.com/test/repo");

    const mockWs1 = { id: "ws1" };
    const mockWs2 = { id: "ws2" };

    manager.addClient(session.id, mockWs1);
    manager.removeClient(session.id, mockWs1);

    const internal = manager.getInternal(session.id);
    const timerId = internal.idleTimer;
    assert.ok(timerId);

    // Add another client - should clear timer
    manager.addClient(session.id, mockWs2);
    assert.strictEqual(internal.idleTimer, null);
  });

  it("shutdownAll ends all active sessions", () => {
    const manager = new SessionManager({
      onData: () => {},
      onExit: () => {},
    });
    const session1 = manager.create("https://github.com/test/repo1");
    const session2 = manager.create("https://github.com/test/repo2");
    const session3 = manager.create("https://github.com/test/repo3");

    // End one manually
    manager.end(session1.id);

    manager.shutdownAll();

    // All should be ended
    assert.strictEqual(manager.get(session1.id).status, "ended");
    assert.strictEqual(manager.get(session2.id).status, "ended");
    assert.strictEqual(manager.get(session3.id).status, "ended");
  });

  it("getInternal returns full internal entry", () => {
    const manager = new SessionManager({
      onData: () => {},
      onExit: () => {},
    });
    const session = manager.create("https://github.com/test/repo");
    const internal = manager.getInternal(session.id);
    assert.ok(internal);
    assert.strictEqual(internal.id, session.id);
    assert.ok(internal.ptyManager);
    assert.ok(internal.session);
    assert.ok(internal.clients);
    assert.ok(internal.clientSizes);
  });

  it("list returns all sessions", () => {
    const manager = new SessionManager({
      onData: () => {},
      onExit: () => {},
    });
    manager.create("https://github.com/test/repo1");
    manager.create("https://github.com/test/repo2");

    const list = manager.list();
    assert.strictEqual(list.length, 2);
    assert.strictEqual(list[0].repo, "test/repo1");
    assert.strictEqual(list[1].repo, "test/repo2");
  });
});
