const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { Session } = require("../lib/session.js");

describe("lib/session.js", () => {
  let tempDir;
  let chatFilePath;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-test-"));
    chatFilePath = path.join(tempDir, "chat.json");
  });

  afterEach(() => {
    // Clean up temp directory
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  it("creates session with empty chat history when file does not exist", () => {
    const session = new Session(chatFilePath);
    assert.strictEqual(session.chatHistory.length, 0);
    assert.strictEqual(session.users.size, 0);
  });

  it("loads existing chat history from file", () => {
    const existingHistory = [
      { name: "User1", text: "Hello", ts: 1000 },
      { name: "User2", text: "Hi", ts: 2000 },
    ];
    fs.writeFileSync(chatFilePath, JSON.stringify(existingHistory));

    const session = new Session(chatFilePath);
    assert.strictEqual(session.chatHistory.length, 2);
    assert.deepStrictEqual(session.chatHistory, existingHistory);
  });

  it("handles corrupted chat history file gracefully", () => {
    fs.writeFileSync(chatFilePath, "invalid json{{{");
    const session = new Session(chatFilePath);
    assert.strictEqual(session.chatHistory.length, 0);
  });

  it("limits loaded chat history to MAX_CHAT_HISTORY (1000) items", () => {
    const largeHistory = [];
    for (let i = 0; i < 1500; i++) {
      largeHistory.push({ name: `User${i}`, text: `Message ${i}`, ts: i });
    }
    fs.writeFileSync(chatFilePath, JSON.stringify(largeHistory));

    const session = new Session(chatFilePath);
    assert.strictEqual(session.chatHistory.length, 1000);
    // Should keep the last 1000 messages
    assert.strictEqual(session.chatHistory[0].text, "Message 500");
    assert.strictEqual(session.chatHistory[999].text, "Message 1499");
  });

  describe("addUser / removeUser / getUsers", () => {
    it("addUser adds a user with default name", () => {
      const session = new Session(chatFilePath);
      session.addUser("user1");
      assert.strictEqual(session.users.size, 1);
      const user = session.users.get("user1");
      assert.strictEqual(user.name, "User 1");
      assert.ok(user.connectedAt);
    });

    it("addUser assigns sequential default names", () => {
      const session = new Session(chatFilePath);
      session.addUser("user1");
      session.addUser("user2");
      session.addUser("user3");
      assert.strictEqual(session.users.get("user1").name, "User 1");
      assert.strictEqual(session.users.get("user2").name, "User 2");
      assert.strictEqual(session.users.get("user3").name, "User 3");
    });

    it("removeUser deletes a user", () => {
      const session = new Session(chatFilePath);
      session.addUser("user1");
      session.addUser("user2");
      assert.strictEqual(session.users.size, 2);
      session.removeUser("user1");
      assert.strictEqual(session.users.size, 1);
      assert.strictEqual(session.users.has("user1"), false);
      assert.strictEqual(session.users.has("user2"), true);
    });

    it("getUsers returns array with correct structure", () => {
      const session = new Session(chatFilePath);
      session.addUser("user1");
      session.addUser("user2");
      const users = session.getUsers();
      assert.strictEqual(Array.isArray(users), true);
      assert.strictEqual(users.length, 2);
      assert.ok(users[0].id);
      assert.ok(users[0].name);
      assert.ok(users[0].connectedAt);
      assert.strictEqual(typeof users[0].connectedAt, "number");
    });
  });

  describe("setName", () => {
    it("updates user name", () => {
      const session = new Session(chatFilePath);
      session.addUser("user1");
      assert.strictEqual(session.users.get("user1").name, "User 1");
      session.setName("user1", "Alice");
      assert.strictEqual(session.users.get("user1").name, "Alice");
    });

    it("does nothing if user does not exist", () => {
      const session = new Session(chatFilePath);
      session.setName("nonexistent", "Bob");
      assert.strictEqual(session.users.has("nonexistent"), false);
    });
  });

  describe("addMessage", () => {
    it("adds message to history and returns message object", () => {
      const session = new Session(chatFilePath);
      const msg = session.addMessage("Alice", "Hello world");
      assert.strictEqual(msg.name, "Alice");
      assert.strictEqual(msg.text, "Hello world");
      assert.ok(msg.ts);
      assert.strictEqual(typeof msg.ts, "number");
      assert.strictEqual(session.chatHistory.length, 1);
      assert.deepStrictEqual(session.chatHistory[0], msg);
    });

    it("enforces max chat history limit", () => {
      const session = new Session(chatFilePath);
      // Add 1005 messages
      for (let i = 0; i < 1005; i++) {
        session.addMessage("User", `Message ${i}`);
      }
      assert.strictEqual(session.chatHistory.length, 1000);
      // Should keep the last 1000 messages
      assert.strictEqual(session.chatHistory[0].text, "Message 5");
      assert.strictEqual(session.chatHistory[999].text, "Message 1004");
    });

    it("saves chat history to file after adding message", () => {
      const session = new Session(chatFilePath);
      session.addMessage("Alice", "Test message");
      assert.ok(fs.existsSync(chatFilePath));
      const saved = JSON.parse(fs.readFileSync(chatFilePath, "utf-8"));
      assert.strictEqual(saved.length, 1);
      assert.strictEqual(saved[0].name, "Alice");
      assert.strictEqual(saved[0].text, "Test message");
    });
  });

  describe("saveChatHistory / load round-trip", () => {
    it("persists and loads chat history correctly", () => {
      const session1 = new Session(chatFilePath);
      session1.addMessage("Alice", "First message");
      session1.addMessage("Bob", "Second message");
      session1.addMessage("Charlie", "Third message");

      // Create new session instance, should load saved history
      const session2 = new Session(chatFilePath);
      assert.strictEqual(session2.chatHistory.length, 3);
      assert.strictEqual(session2.chatHistory[0].name, "Alice");
      assert.strictEqual(session2.chatHistory[0].text, "First message");
      assert.strictEqual(session2.chatHistory[1].name, "Bob");
      assert.strictEqual(session2.chatHistory[1].text, "Second message");
      assert.strictEqual(session2.chatHistory[2].name, "Charlie");
      assert.strictEqual(session2.chatHistory[2].text, "Third message");
    });

    it("creates directory if it does not exist", () => {
      const nestedPath = path.join(tempDir, "nested", "dir", "chat.json");
      const session = new Session(nestedPath);
      session.addMessage("Test", "Message");
      assert.ok(fs.existsSync(nestedPath));
    });
  });
});
