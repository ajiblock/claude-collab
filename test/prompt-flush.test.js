const { describe, it, before, after, mock } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const WebSocket = require("ws");

describe("prompt-aware auto-flush (integration)", () => {
  let originalEnv;
  let tempDir;
  let server;
  let baseUrl;
  let mockPtyInstances;

  before(async () => {
    originalEnv = { ...process.env };
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-flush-test-"));
    mockPtyInstances = [];

    process.env.DATA_DIR = tempDir;
    process.env.PORT = "0";
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
      this.onDataCb = callbacks?.onData || (() => {});
      this.onExitCb = callbacks?.onExit || (() => {});
      this.scrollback = "";
      this.write = () => {};
      this.resize = () => {};
      this.getScrollback = () => this.scrollback;
      this.restart = () => {};
      this.destroy = () => { this.process = null; };
      // Expose so tests can simulate terminal output
      mockPtyInstances.push(this);
    });

    mock.method(gitModule, "cloneOrPull", (repoUrl, sessionDir) => {
      const { owner, name } = gitModule.parseRepoUrl(repoUrl);
      const repoDir = path.join(sessionDir, "repo");
      fs.mkdirSync(repoDir, { recursive: true });
      return { owner, name, repoDir };
    });

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

  async function createSession() {
    const res = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: "https://github.com/test/prompt-test" }),
    });
    return res.json();
  }

  function connectWs(sessionId) {
    return new Promise((resolve, reject) => {
      const addr = server.address();
      const ws = new WebSocket(`ws://localhost:${addr.port}/ws/${sessionId}`);
      ws.on("open", () => resolve(ws));
      ws.on("error", reject);
    });
  }

  function waitForMessage(ws, type, timeoutMs = 2000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeoutMs);
      function handler(raw) {
        const msg = JSON.parse(raw);
        if (msg.type === type) {
          clearTimeout(timer);
          ws.removeListener("message", handler);
          resolve(msg);
        }
      }
      ws.on("message", handler);
    });
  }

  // Drain initial messages (session-info, terminal-output, chat-history, users-update)
  function drainInitial(ws) {
    return new Promise((resolve) => {
      const msgs = [];
      function handler(raw) {
        msgs.push(JSON.parse(raw));
        // Wait a bit for all initial messages to arrive
      }
      ws.on("message", handler);
      setTimeout(() => {
        ws.removeListener("message", handler);
        resolve(msgs);
      }, 200);
    });
  }

  it("auto-flushes y/n single keypress with prompt context", async () => {
    const session = await createSession();
    const ws = await connectWs(session.id);
    ws.send(JSON.stringify({ type: "set-name", name: "tester" }));
    await drainInitial(ws);

    // Simulate Claude outputting a y/n prompt
    const pty = mockPtyInstances[mockPtyInstances.length - 1];
    pty.onDataCb("? Allow access to this file? (Y/n)");

    // Small delay for feed to process
    await new Promise((r) => setTimeout(r, 50));

    // Listen for terminal-submission before sending input
    const submissionPromise = waitForMessage(ws, "terminal-submission");

    // Send single 'y' keypress
    ws.send(JSON.stringify({ type: "terminal-input", data: "y" }));

    const msg = await submissionPromise;
    assert.equal(msg.name, "tester");
    assert.equal(msg.text, "y");
    assert.equal(msg.promptQuestion, "Allow access to this file?");
    assert.equal(msg.selectedOption, "Yes");
    assert.ok(msg.ts);

    ws.close();
  });

  it("auto-flushes numbered single keypress with prompt context", async () => {
    const session = await createSession();
    const ws = await connectWs(session.id);
    ws.send(JSON.stringify({ type: "set-name", name: "tester2" }));
    await drainInitial(ws);

    const pty = mockPtyInstances[mockPtyInstances.length - 1];
    pty.onDataCb("? How would you like to proceed?\n  1. Run the command\n  2. Skip it\n  3. Edit first\n");

    await new Promise((r) => setTimeout(r, 50));

    const submissionPromise = waitForMessage(ws, "terminal-submission");
    ws.send(JSON.stringify({ type: "terminal-input", data: "2" }));

    const msg = await submissionPromise;
    assert.equal(msg.name, "tester2");
    assert.equal(msg.text, "2");
    assert.equal(msg.promptQuestion, "How would you like to proceed?");
    assert.equal(msg.selectedOption, "Skip it");

    ws.close();
  });

  it("Enter-based flush picks up active prompt context for non-matching input", async () => {
    const session = await createSession();
    const ws = await connectWs(session.id);
    ws.send(JSON.stringify({ type: "set-name", name: "tester3" }));
    await drainInitial(ws);

    const pty = mockPtyInstances[mockPtyInstances.length - 1];
    // Numbered prompt — typing "hello" then Enter won't auto-flush (no digit match)
    pty.onDataCb("? Pick one:\n  1. Alpha\n  2. Beta\n");

    await new Promise((r) => setTimeout(r, 50));

    const submissionPromise = waitForMessage(ws, "terminal-submission");
    // Non-matching text + Enter: falls through to Enter-based flush with prompt context
    ws.send(JSON.stringify({ type: "terminal-input", data: "hello\r" }));

    const msg = await submissionPromise;
    assert.equal(msg.text, "hello");
    assert.equal(msg.promptQuestion, "Pick one:");
    // No selectedOption since "hello" doesn't match any numbered option
    assert.equal(msg.selectedOption, undefined);

    ws.close();
  });

  it("multi-char y/n input auto-flushes on first char", async () => {
    // When "yes\r" arrives, the 'y' auto-flushes immediately (buffer=1, matches y/n)
    const session = await createSession();
    const ws = await connectWs(session.id);
    ws.send(JSON.stringify({ type: "set-name", name: "tester3b" }));
    await drainInitial(ws);

    const pty = mockPtyInstances[mockPtyInstances.length - 1];
    pty.onDataCb("? Continue with defaults? (Y/n)");

    await new Promise((r) => setTimeout(r, 50));

    const submissionPromise = waitForMessage(ws, "terminal-submission");
    ws.send(JSON.stringify({ type: "terminal-input", data: "yes\r" }));

    const msg = await submissionPromise;
    // First char 'y' auto-flushed before 'es' was added
    assert.equal(msg.text, "y");
    assert.equal(msg.promptQuestion, "Continue with defaults?");
    assert.equal(msg.selectedOption, "Yes");

    ws.close();
  });

  it("no prompt context when no active prompt detected", async () => {
    const session = await createSession();
    const ws = await connectWs(session.id);
    ws.send(JSON.stringify({ type: "set-name", name: "tester4" }));
    await drainInitial(ws);

    const pty = mockPtyInstances[mockPtyInstances.length - 1];
    // Regular output, not a prompt
    pty.onDataCb("Building project...\nDone.\n$ ");

    await new Promise((r) => setTimeout(r, 50));

    const submissionPromise = waitForMessage(ws, "terminal-submission");
    ws.send(JSON.stringify({ type: "terminal-input", data: "ls\r" }));

    const msg = await submissionPromise;
    assert.equal(msg.text, "ls");
    assert.equal(msg.promptQuestion, undefined);
    assert.equal(msg.selectedOption, undefined);

    ws.close();
  });

  it("stale prompt is not used after significant new output", async () => {
    const session = await createSession();
    const ws = await connectWs(session.id);
    ws.send(JSON.stringify({ type: "set-name", name: "tester5" }));
    await drainInitial(ws);

    const pty = mockPtyInstances[mockPtyInstances.length - 1];
    // Prompt appears
    pty.onDataCb("? Do something? (Y/n)");

    await new Promise((r) => setTimeout(r, 50));

    // Then lots of output (Claude moved on)
    pty.onDataCb("x".repeat(600));

    await new Promise((r) => setTimeout(r, 50));

    const submissionPromise = waitForMessage(ws, "terminal-submission");
    ws.send(JSON.stringify({ type: "terminal-input", data: "hello\r" }));

    const msg = await submissionPromise;
    assert.equal(msg.text, "hello");
    assert.equal(msg.promptQuestion, undefined);
    assert.equal(msg.selectedOption, undefined);

    ws.close();
  });
});
