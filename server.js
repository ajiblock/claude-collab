const http = require("http");
const path = require("path");
const express = require("express");
const { WebSocketServer } = require("ws");
const config = require("./lib/config");
const { SessionManager } = require("./lib/sessions");

const DEBUG = process.env.CLAUDE_COLLAB_DEBUG === "1";
function dbg(...args) { if (DEBUG) console.log("[debug]", ...args); }

// Rate limiting: session creation
const createTimestamps = [];
function checkCreateRateLimit() {
  const now = Date.now();
  const oneMinAgo = now - 60000;
  while (createTimestamps.length && createTimestamps[0] < oneMinAgo)
    createTimestamps.shift();
  if (createTimestamps.length >= 5) return false;
  createTimestamps.push(now);
  return true;
}

// Rate limiting: chat messages per client
const chatRateLimits = new Map();
function checkChatRateLimit(ws) {
  const now = Date.now();
  const oneMinAgo = now - 60000;
  let timestamps = chatRateLimits.get(ws);
  if (!timestamps) {
    timestamps = [];
    chatRateLimits.set(ws, timestamps);
  }
  while (timestamps.length && timestamps[0] < oneMinAgo) timestamps.shift();
  if (timestamps.length >= 30) return false;
  timestamps.push(now);
  return true;
}

function detectPort(data, serverPort) {
  const clean = data.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
  const match = clean.match(/https?:\/\/(?:localhost|127\.0\.0\.1):(\d{4,5})/);
  if (!match) return null;
  const port = parseInt(match[1], 10);
  if (port < 1024 || port > 65535) return null;
  if (port === serverPort) return null;
  return port;
}

function detectFileUrl(data) {
  const clean = data.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
  return /file:\/\/\//.test(clean);
}

function broadcastToSession(session, msg) {
  const payload = JSON.stringify(msg);
  for (const client of session.clients) {
    if (client.readyState === 1) client.send(payload);
  }
}

function broadcastUsersUpdate(session) {
  const users = session.session.getUsers();
  const uniqueNames = [...new Set(users.map((u) => u.name))];
  broadcastToSession(session, {
    type: "users-update",
    users: uniqueNames,
    count: uniqueNames.length,
  });
}

function computeMinSize(session) {
  let minCols = 120,
    minRows = 40;
  for (const size of session.clientSizes.values()) {
    if (size.cols < minCols) minCols = size.cols;
    if (size.rows < minRows) minRows = size.rows;
  }
  return { cols: Math.max(minCols, 20), rows: Math.max(minRows, 5) };
}

const sessionManager = new SessionManager({
  onData(sessionId, data) {
    const s = sessionManager.getInternal(sessionId);
    if (s) {
      if (!s.previewPort) {
        const port = detectPort(data, config.port);
        if (port && sessionManager.setPreviewPort(sessionId, port)) {
          broadcastToSession(s, { type: "preview-port-update", port });
        } else if (!s._fileUrlWarned && detectFileUrl(data)) {
          s._fileUrlWarned = true;
          broadcastToSession(s, {
            type: "preview-hint",
            message: "file:// URLs can't be previewed — ask Claude to use an HTTP server (e.g. npx serve) instead.",
          });
        }
      }
      s.promptTracker.feed(data);
      broadcastToSession(s, { type: "terminal-output", data });
    }
  },
  onEnd(sessionId) {
    const s = sessionManager.getInternal(sessionId);
    if (s) broadcastToSession(s, { type: "session-ended" });
  },
  onExit(sessionId, exitCode, signal) {
    const s = sessionManager.getInternal(sessionId);
    if (!s) return;
    const reason = signal ? `signal ${signal}` : `exit code ${exitCode}`;
    console.log(`[${sessionId.slice(0, 8)}] Claude process exited (${reason})`);
    broadcastToSession(s, {
      type: "terminal-output",
      data: `\r\n\r\n[Claude process exited (${reason}). End this session and start a new one.]\r\n`,
    });
  },
});

function flushInputBuffer(ws, session, prompt) {
  const raw = (ws._inputBuffer || "");
  ws._inputBuffer = "";
  // Strip ANSI escape sequences, control chars, and DEL
  // eslint-disable-next-line no-control-regex
  const input = raw.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/[\x00-\x1f\x7f]/g, "").trim();
  if (input.length > 0) {
    const user = session.session.users.get(ws._clientId);
    const senderName = user ? user.name : "Unknown";

    // Resolve prompt context (from auto-flush or Enter-based flush)
    const activePrompt = prompt || session.promptTracker.getActivePrompt();
    const msg = {
      type: "terminal-submission",
      name: senderName,
      text: input,
      ts: Date.now(),
    };

    if (activePrompt) {
      msg.promptQuestion = activePrompt.question;
      if (activePrompt.type === "yn") {
        msg.selectedOption = /[yY]/.test(input) ? "Yes" : "No";
      } else if (activePrompt.type === "numbered" && activePrompt.options) {
        const match = activePrompt.options.find((o) => o.number === input);
        if (match) msg.selectedOption = match.text;
      }
      session.promptTracker.clearPrompt();
    }

    broadcastToSession(session, msg);
  }
}

let nextClientId = 1;

function startServer() {
  return new Promise((resolve) => {
    const app = express();

    // Preview proxy route — must come BEFORE express.json() to preserve raw request body for piping
    function proxyHandler(req, res) {
      const sessionId = req.params.sessionId;
      const session = sessionManager.getInternal(sessionId);
      if (!session || session.status !== "active") {
        return res.status(404).json({ error: "Session not found or ended" });
      }
      if (!session.previewPort) {
        return res.status(400).json({ error: "No preview port set" });
      }

      // Build the path to forward — strip the /preview/:sessionId prefix
      const prefix = `/preview/${sessionId}`;
      let forwardPath = req.originalUrl.slice(prefix.length) || "/";

      const options = {
        hostname: "localhost",
        port: session.previewPort,
        path: forwardPath,
        method: req.method,
        headers: { ...req.headers, host: `localhost:${session.previewPort}` },
      };

      const proxyReq = http.request(options, (proxyRes) => {
        // Strip headers that prevent iframe embedding or cause cookie confusion
        const headers = { ...proxyRes.headers };
        delete headers["x-frame-options"];
        delete headers["content-security-policy"];
        delete headers["set-cookie"];

        res.writeHead(proxyRes.statusCode, headers);
        proxyRes.pipe(res, { end: true });
      });

      proxyReq.on("error", () => {
        if (!res.headersSent) {
          res.status(502).json({ error: "Dev server not responding. Is it running?" });
        }
      });

      req.pipe(proxyReq, { end: true });
    }

    app.all("/preview/:sessionId", proxyHandler);
    app.all("/preview/:sessionId/*", proxyHandler);

    app.use(express.json());

    // Debug request logging
    if (DEBUG) {
      app.use((req, res, next) => {
        const start = Date.now();
        res.on("finish", () => {
          dbg(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - start}ms`);
        });
        next();
      });
    }

    app.use(express.static(path.join(__dirname, "public")));

    // Session page route
    app.get("/s/:sessionId", (req, res) => {
      res.sendFile(path.join(__dirname, "public", "session.html"));
    });

    // API: create session
    app.post("/api/sessions", (req, res) => {
      if (!checkCreateRateLimit()) {
        return res
          .status(429)
          .json({ error: "Rate limited. Max 5 sessions per minute." });
      }
      const { repo } = req.body;
      if (!repo || typeof repo !== "string") {
        return res.status(400).json({ error: "repo URL is required" });
      }
      try {
        const session = sessionManager.create(repo);
        res.json(session);
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    });

    // API: list sessions
    app.get("/api/sessions", (req, res) => {
      res.json(sessionManager.list());
    });

    // API: get session
    app.get("/api/sessions/:id", (req, res) => {
      const session = sessionManager.get(req.params.id);
      if (!session) return res.status(404).json({ error: "Session not found" });
      res.json(session);
    });

    // API: end session
    app.delete("/api/sessions/:id", (req, res) => {
      const session = sessionManager.get(req.params.id);
      if (!session) return res.status(404).json({ error: "Session not found" });
      sessionManager.end(req.params.id);
      res.json({ ok: true });
    });

    const server = http.createServer(app);
    const wss = new WebSocketServer({ noServer: true });

    server.on("upgrade", (req, socket, head) => {
      dbg(`WS upgrade: ${req.url} from ${req.headers.host}`);
      const match = req.url.match(/^\/ws\/([a-f0-9]{32})$/);
      if (!match) {
        dbg("WS upgrade rejected: bad URL pattern");
        socket.destroy();
        return;
      }

      const sessionId = match[1];
      const session = sessionManager.getInternal(sessionId);
      if (!session || session.status !== "active") {
        dbg(`WS upgrade rejected: session ${sessionId.slice(0, 8)} not found or not active`);
        socket.destroy();
        return;
      }

      dbg(`WS upgrade accepted: session ${sessionId.slice(0, 8)}`);
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req, sessionId);
      });
    });

    wss.on("connection", (ws, req, sessionId) => {
      dbg(`WS connected: client #${nextClientId} to session ${sessionId.slice(0, 8)}`);
      const session = sessionManager.getInternal(sessionId);
      const clientId = String(nextClientId++);
      ws._clientId = clientId;
      ws._sessionId = sessionId;

      session.session.addUser(clientId);
      sessionManager.addClient(sessionId, ws);

      // Send session info (no repoDir)
      ws.send(JSON.stringify({ type: "session-info", repo: session.repo, chatEnabled: config.chatEnabled }));

      // Send scrollback
      const scrollback = session.ptyManager.getScrollback();
      if (scrollback) {
        ws.send(JSON.stringify({ type: "terminal-output", data: scrollback }));
      }

      // Send chat history
      ws.send(
        JSON.stringify({
          type: "chat-history",
          messages: session.session.getChatHistory(),
        })
      );

      // Broadcast users update
      broadcastUsersUpdate(session);

      // Send current preview port if set
      if (session.previewPort) {
        ws.send(JSON.stringify({ type: "preview-port-update", port: session.previewPort }));
      }

      ws.on("message", (raw) => {
        let msg;
        try {
          msg = JSON.parse(raw);
        } catch {
          return;
        }

        switch (msg.type) {
          case "terminal-input":
            if (typeof msg.data !== "string" || msg.data.length > 1024) break;
            session.ptyManager.write(msg.data);
            // Build input buffer character by character, handling backspace
            if (!ws._inputBuffer) ws._inputBuffer = "";
            for (const ch of msg.data) {
              if (ch === "\r" || ch === "\n") {
                // Enter: flush the buffer as a terminal submission
                flushInputBuffer(ws, session);
              } else if (ch === "\x7f" || ch === "\b") {
                // Backspace: remove last character
                ws._inputBuffer = ws._inputBuffer.slice(0, -1);
              } else {
                ws._inputBuffer += ch;
                // Auto-flush single keypress answers to detected prompts
                if (ws._inputBuffer.length === 1) {
                  const activePrompt = session.promptTracker.getActivePrompt();
                  if (activePrompt) {
                    if (activePrompt.type === "yn" && /^[yYnN]$/.test(ch)) {
                      flushInputBuffer(ws, session, activePrompt);
                    } else if (activePrompt.type === "numbered" && /^\d$/.test(ch)) {
                      flushInputBuffer(ws, session, activePrompt);
                    }
                  }
                }
              }
            }
            break;

          case "chat-message": {
            if (
              typeof msg.text !== "string" ||
              msg.text.length > 2000 ||
              !msg.text.trim()
            )
              break;
            if (!checkChatRateLimit(ws)) break;
            const user = session.session.users.get(clientId);
            const senderName = user ? user.name : "Unknown";
            const chatMsg = session.session.addMessage(senderName, msg.text);
            broadcastToSession(session, { type: "chat-message", ...chatMsg });
            break;
          }

          case "set-name": {
            if (typeof msg.name !== "string") break;
            let name = msg.name
              .replace(/[\x00-\x1f]/g, "")
              .trim()
              .slice(0, 30);
            if (!name) break;
            session.session.setName(clientId, name);
            broadcastUsersUpdate(session);
            break;
          }

          case "set-preview-port": {
            const port = msg.port === null ? null : msg.port;
            if (sessionManager.setPreviewPort(sessionId, port)) {
              broadcastToSession(session, { type: "preview-port-update", port: session.previewPort });
            }
            break;
          }

          case "resize":
            if (msg.cols && msg.rows) {
              session.clientSizes.set(ws, {
                cols: msg.cols,
                rows: msg.rows,
              });
              const { cols, rows } = computeMinSize(session);
              session.ptyManager.resize(cols, rows);
              broadcastToSession(session, { type: "resize", cols, rows });
            }
            break;
        }
      });

      ws.on("close", () => {
        session.session.removeUser(clientId);
        sessionManager.removeClient(sessionId, ws);
        chatRateLimits.delete(ws);
        broadcastUsersUpdate(session);

        // Recompute terminal size after client leaves
        if (session.clientSizes.size > 0) {
          const { cols, rows } = computeMinSize(session);
          session.ptyManager.resize(cols, rows);
          broadcastToSession(session, { type: "resize", cols, rows });
        }
      });
    });

    // Graceful shutdown
    function shutdown() {
      console.log("\nShutting down...");
      sessionManager.shutdownAll();
      server.close();
      process.exit(0);
    }
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    server.listen(config.port, config.host, () => {
      console.log(`claude-collab listening on ${config.host}:${config.port}`);
      resolve(server);
    });
  });
}

module.exports = { startServer, detectPort };

// If run directly (not via CLI), start immediately
if (require.main === module) {
  startServer();
}
