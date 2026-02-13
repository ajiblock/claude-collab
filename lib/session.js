const fs = require("fs");
const path = require("path");

const MAX_CHAT_HISTORY = 1000;

class Session {
  constructor(chatFilePath) {
    this.chatFilePath = chatFilePath;
    this.users = new Map(); // ws id -> { name, connectedAt }
    this.chatHistory = []; // { name, text, ts }
    this._loadChatHistory();
  }

  _loadChatHistory() {
    try {
      const data = fs.readFileSync(this.chatFilePath, "utf-8");
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        this.chatHistory = parsed.slice(-MAX_CHAT_HISTORY);
      }
    } catch {
      // File doesn't exist or is invalid, start fresh
    }
  }

  addUser(id) {
    this.users.set(id, { name: `User ${this.users.size + 1}`, connectedAt: Date.now() });
  }

  removeUser(id) {
    this.users.delete(id);
  }

  setName(id, name) {
    const user = this.users.get(id);
    if (user) {
      user.name = name;
    }
  }

  getUsers() {
    const list = [];
    for (const [id, user] of this.users) {
      list.push({ id, name: user.name, connectedAt: user.connectedAt });
    }
    return list;
  }

  addMessage(name, text) {
    const msg = { name, text, ts: Date.now() };
    this.chatHistory.push(msg);
    if (this.chatHistory.length > MAX_CHAT_HISTORY) {
      this.chatHistory = this.chatHistory.slice(-MAX_CHAT_HISTORY);
    }
    this.saveChatHistory();
    return msg;
  }

  getChatHistory() {
    return this.chatHistory;
  }

  saveChatHistory() {
    try {
      const dir = path.dirname(this.chatFilePath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.chatFilePath, JSON.stringify(this.chatHistory, null, 2));
    } catch (e) {
      console.error("Failed to save chat history:", e.message);
    }
  }
}

module.exports = { Session };
