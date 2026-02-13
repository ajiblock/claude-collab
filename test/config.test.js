const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const path = require("path");

describe("lib/config.js", () => {
  let originalEnv;

  beforeEach(() => {
    // Save original env vars
    originalEnv = { ...process.env };
    // Clear all config-related env vars for clean test state
    delete process.env.PORT;
    delete process.env.HOST;
    delete process.env.BASE_URL;
    delete process.env.DATA_DIR;
    delete process.env.CLAUDE_PATH;
    delete process.env.MAX_SESSIONS;
    delete process.env.SESSION_IDLE_TIMEOUT;
    // Clear require cache to reload config with new env
    delete require.cache[require.resolve("../lib/config.js")];
  });

  afterEach(() => {
    // Restore original env vars
    process.env = originalEnv;
    delete require.cache[require.resolve("../lib/config.js")];
  });

  it("returns default values when no env vars set", () => {
    const config = require("../lib/config.js");
    assert.strictEqual(config.port, 4321);
    assert.strictEqual(config.host, "0.0.0.0");
    assert.strictEqual(config.baseUrl, null);
    assert.strictEqual(config.claudePath, "claude");
    assert.strictEqual(config.maxSessions, 10);
    assert.strictEqual(config.sessionIdleTimeout, 0);
    // DATA_DIR should be resolved to absolute path
    assert.strictEqual(config.dataDir, path.resolve("./data"));
  });

  it("allows PORT override via env var", () => {
    process.env.PORT = "8080";
    const config = require("../lib/config.js");
    assert.strictEqual(config.port, 8080);
  });

  it("uses default PORT when non-numeric value provided", () => {
    process.env.PORT = "not-a-number";
    const config = require("../lib/config.js");
    // parseInt returns NaN, so || 4321 kicks in
    assert.strictEqual(config.port, 4321);
  });

  it("uses default PORT when 0 is provided (falsy value)", () => {
    process.env.PORT = "0";
    const config = require("../lib/config.js");
    // parseInt("0", 10) returns 0, which is falsy, so || 4321 kicks in
    assert.strictEqual(config.port, 4321);
  });

  it("throws on invalid PORT - above 65535", () => {
    process.env.PORT = "70000";
    let error;
    try {
      require("../lib/config.js");
    } catch (e) {
      error = e;
    }
    assert.ok(error, "Expected an error to be thrown");
    assert.match(error.message, /Invalid PORT: 70000/);
  });

  it("uses default MAX_SESSIONS when non-numeric value provided", () => {
    process.env.MAX_SESSIONS = "invalid";
    const config = require("../lib/config.js");
    // parseInt returns NaN, so || 10 kicks in
    assert.strictEqual(config.maxSessions, 10);
  });

  it("uses default MAX_SESSIONS when 0 is provided (falsy value)", () => {
    process.env.MAX_SESSIONS = "0";
    const config = require("../lib/config.js");
    // parseInt("0", 10) returns 0, which is falsy, so || 10 kicks in
    assert.strictEqual(config.maxSessions, 10);
  });

  it("uses default SESSION_IDLE_TIMEOUT when non-numeric value provided", () => {
    process.env.SESSION_IDLE_TIMEOUT = "bad";
    const config = require("../lib/config.js");
    // parseInt returns NaN, so || 0 kicks in
    assert.strictEqual(config.sessionIdleTimeout, 0);
  });

  it("throws on invalid SESSION_IDLE_TIMEOUT - negative", () => {
    process.env.SESSION_IDLE_TIMEOUT = "-5";
    let error;
    try {
      require("../lib/config.js");
    } catch (e) {
      error = e;
    }
    assert.ok(error, "Expected an error to be thrown");
    assert.match(error.message, /Invalid SESSION_IDLE_TIMEOUT: -5/);
  });

  it("resolves DATA_DIR to absolute path", () => {
    process.env.DATA_DIR = "custom/data";
    const config = require("../lib/config.js");
    assert.strictEqual(config.dataDir, path.resolve("custom/data"));
  });

  it("returns a frozen config object", () => {
    const config = require("../lib/config.js");
    assert.strictEqual(Object.isFrozen(config), true);
    // Attempting to modify should fail silently or throw in strict mode
    assert.throws(
      () => {
        "use strict";
        config.port = 9999;
      },
      /Cannot assign to read only property 'port'/
    );
  });

  it("allows all valid env var overrides", () => {
    process.env.PORT = "4000";
    process.env.HOST = "127.0.0.1";
    process.env.BASE_URL = "https://example.com";
    process.env.DATA_DIR = "/tmp/test-data";
    process.env.CLAUDE_PATH = "/usr/local/bin/claude";
    process.env.MAX_SESSIONS = "20";
    process.env.SESSION_IDLE_TIMEOUT = "30";

    const config = require("../lib/config.js");
    assert.strictEqual(config.port, 4000);
    assert.strictEqual(config.host, "127.0.0.1");
    assert.strictEqual(config.baseUrl, "https://example.com");
    assert.strictEqual(config.dataDir, "/tmp/test-data");
    assert.strictEqual(config.claudePath, "/usr/local/bin/claude");
    assert.strictEqual(config.maxSessions, 20);
    assert.strictEqual(config.sessionIdleTimeout, 30);
  });
});
