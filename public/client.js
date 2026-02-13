/* claude-collab client */

(function () {
  "use strict";

  // ── Session ID from URL ──
  const pathMatch = location.pathname.match(/^\/s\/([a-f0-9]+)$/);
  const sessionId = pathMatch ? pathMatch[1] : null;

  if (!sessionId) {
    location.href = "/";
    return;
  }

  const STORAGE_KEY = "claude-collab-name";
  const RECONNECT_BASE = 1000;
  const RECONNECT_MAX = 30000;

  // Name colors assigned per user for chat messages
  const NAME_COLORS = [
    "#89b4fa", "#a6e3a1", "#fab387", "#cba6f7",
    "#94e2d5", "#f9e2af", "#f38ba8", "#89dceb",
    "#b4befe", "#f5c2e7",
  ];

  // ── DOM refs ──
  const nameOverlay = document.getElementById("name-overlay");
  const nameInput = document.getElementById("name-input");
  const nameJoinBtn = document.getElementById("name-join-btn");
  const repoNameEl = document.getElementById("repo-name");
  const statusDot = document.getElementById("status-dot");
  const statusText = document.getElementById("status-text");
  const userCountEl = document.getElementById("user-count");
  const chatMessagesEl = document.getElementById("chat-messages");
  const chatInput = document.getElementById("chat-input");
  const chatSendBtn = document.getElementById("chat-send-btn");
  const chatBadge = document.getElementById("chat-badge");
  const terminalEl = document.getElementById("terminal");
  const reconnectBanner = document.getElementById("reconnect-banner");
  const reconnectText = document.getElementById("reconnect-text");

  // Tab elements
  const tabTerminal = document.getElementById("tab-terminal");
  const tabPreview = document.getElementById("tab-preview");
  const panelTerminal = document.getElementById("panel-terminal");
  const panelPreview = document.getElementById("panel-preview");

  // Preview elements
  const previewSetup = document.getElementById("preview-setup");
  const previewViewer = document.getElementById("preview-viewer");
  const previewPortInput = document.getElementById("preview-port-input");
  const previewConnectBtn = document.getElementById("preview-connect-btn");
  const previewError = document.getElementById("preview-error");
  const previewUrl = document.getElementById("preview-url");
  const previewRefreshBtn = document.getElementById("preview-refresh-btn");
  const previewDisconnectBtn = document.getElementById("preview-disconnect-btn");
  const previewIframe = document.getElementById("preview-iframe");

  // ── State ──
  let userName = localStorage.getItem(STORAGE_KEY) || "";
  let ws = null;
  let term = null;
  let fitAddon = null;
  let reconnectDelay = RECONNECT_BASE;
  let reconnectTimer = null;
  let colorMap = {};
  let colorIndex = 0;
  let sessionEnded = false;
  let scrollbackReplayed = false;
  let currentPreviewPort = null;

  // ── Helpers ──

  function getNameColor(name) {
    if (!colorMap[name]) {
      colorMap[name] = NAME_COLORS[colorIndex % NAME_COLORS.length];
      colorIndex++;
    }
    return colorMap[name];
  }

  function formatTime(ts) {
    const d = ts ? new Date(ts) : new Date();
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Name Prompt ──

  function initNamePrompt() {
    if (userName) {
      console.log("[collab] Found stored name:", userName);
      nameOverlay.classList.add("name-overlay--hidden");
      boot();
      return;
    }

    nameInput.addEventListener("input", function () {
      nameJoinBtn.disabled = nameInput.value.trim().length === 0;
    });

    function submitName() {
      const val = nameInput.value.trim();
      if (!val) return;
      userName = val;
      localStorage.setItem(STORAGE_KEY, userName);
      console.log("[collab] Name set:", userName);
      nameOverlay.classList.add("name-overlay--hidden");
      boot();
    }

    nameJoinBtn.addEventListener("click", submitName);
    nameInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") submitName();
    });

    nameInput.focus();
  }

  // ── Terminal Setup ──

  function createTerminal() {
    term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      lineHeight: 1.3,
      theme: {
        background: "#1e1e2e",
        foreground: "#cdd6f4",
        cursor: "#f5e0dc",
        cursorAccent: "#1e1e2e",
        selectionBackground: "rgba(137, 180, 250, 0.25)",
        selectionForeground: "#cdd6f4",
        black: "#45475a",
        red: "#f38ba8",
        green: "#a6e3a1",
        yellow: "#f9e2af",
        blue: "#89b4fa",
        magenta: "#cba6f7",
        cyan: "#94e2d5",
        white: "#bac2de",
        brightBlack: "#585b70",
        brightRed: "#f38ba8",
        brightGreen: "#a6e3a1",
        brightYellow: "#f9e2af",
        brightBlue: "#89b4fa",
        brightMagenta: "#cba6f7",
        brightCyan: "#94e2d5",
        brightWhite: "#a6adc8",
      },
    });

    fitAddon = new FitAddon.FitAddon();
    const webLinksAddon = new WebLinksAddon.WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(terminalEl);

    // Small delay to let the DOM settle before fitting
    requestAnimationFrame(function () {
      fitAddon.fit();
    });

    term.onData(function (data) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "terminal-input", data: data }));
      }
    });

    term.onResize(function (size) {
      console.log("[collab] Terminal resized:", size.cols, "x", size.rows);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: size.cols, rows: size.rows }));
      }
    });

    window.addEventListener("resize", function () {
      if (fitAddon) fitAddon.fit();
    });

    console.log("[collab] Terminal created");
  }

  // ── Chat ──

  function appendChatMessage(name, text, timestamp) {
    const msgEl = document.createElement("div");
    msgEl.className = "chat-message";

    const headerEl = document.createElement("div");
    headerEl.className = "chat-message__header";

    const nameEl = document.createElement("span");
    nameEl.className = "chat-message__name";
    nameEl.style.color = getNameColor(name);
    nameEl.textContent = name;

    const timeEl = document.createElement("span");
    timeEl.className = "chat-message__time";
    timeEl.textContent = formatTime(timestamp);

    headerEl.appendChild(nameEl);
    headerEl.appendChild(timeEl);

    const textEl = document.createElement("div");
    textEl.className = "chat-message__text";
    textEl.textContent = text;

    msgEl.appendChild(headerEl);
    msgEl.appendChild(textEl);

    chatMessagesEl.appendChild(msgEl);

    // Auto-scroll to bottom
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }

  function appendTerminalSubmission(name, text, timestamp) {
    const msgEl = document.createElement("div");
    msgEl.className = "chat-message chat-message--terminal";

    const headerEl = document.createElement("div");
    headerEl.className = "chat-message__header";

    const labelEl = document.createElement("span");
    labelEl.className = "chat-message__terminal-label";
    labelEl.textContent = name + " submitted to Claude:";

    const timeEl = document.createElement("span");
    timeEl.className = "chat-message__time";
    timeEl.textContent = formatTime(timestamp);

    headerEl.appendChild(labelEl);
    headerEl.appendChild(timeEl);

    const textEl = document.createElement("div");
    textEl.className = "chat-message__terminal-text";
    textEl.textContent = text;

    msgEl.appendChild(headerEl);
    msgEl.appendChild(textEl);

    chatMessagesEl.appendChild(msgEl);
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }

  function sendChat() {
    const text = chatInput.value.trim();
    if (!text) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    console.log("[collab] Sending chat:", text);
    ws.send(JSON.stringify({ type: "chat-message", text: text }));
    chatInput.value = "";
  }

  chatSendBtn.addEventListener("click", sendChat);
  chatInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  });

  // ── Connection Status ──

  function setConnected(connected) {
    if (connected) {
      statusDot.className = "status-dot";
      statusText.textContent = "Connected";
      reconnectBanner.classList.remove("reconnect-banner--visible");
    } else {
      statusDot.className = "status-dot status-dot--disconnected";
      statusText.textContent = "Disconnected";
    }
  }

  // ── WebSocket ──

  function connect() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const url = protocol + "//" + location.host + "/ws/" + sessionId;
    console.log("[collab] Connecting to", url);

    ws = new WebSocket(url);

    ws.onopen = function () {
      console.log("[collab] Connected");
      setConnected(true);
      reconnectDelay = RECONNECT_BASE;
      scrollbackReplayed = false;

      ws.send(JSON.stringify({ type: "set-name", name: userName }));
    };

    ws.onmessage = function (event) {
      var msg;
      try {
        msg = JSON.parse(event.data);
      } catch (err) {
        console.error("[collab] Bad message:", event.data);
        return;
      }

      switch (msg.type) {
        case "terminal-output":
          if (term) {
            term.write(msg.data);
            // After scrollback replay, force a resize to redraw full-screen TUI apps
            if (!scrollbackReplayed) {
              scrollbackReplayed = true;
              setTimeout(function () {
                if (fitAddon) fitAddon.fit();
              }, 100);
            }
          }
          break;

        case "session-info":
          console.log("[collab] Session info:", msg);
          if (msg.repo) {
            repoNameEl.textContent = msg.repo;
          }
          // Clear terminal on new session (removes stale scrollback from previous session)
          if (term) term.clear();
          break;

        case "chat-history":
          console.log("[collab] Chat history:", (msg.messages || []).length, "messages");
          chatMessagesEl.innerHTML = "";
          (msg.messages || []).forEach(function (m) {
            appendChatMessage(m.name, m.text, m.ts);
          });
          break;

        case "chat-message":
          appendChatMessage(msg.name, msg.text, msg.ts);
          break;

        case "users-update":
          console.log("[collab] Users update:", msg.count, msg.users);
          userCountEl.textContent = msg.count || 0;
          if (msg.users && msg.users.length) {
            chatBadge.textContent = msg.users.join(", ");
          } else {
            chatBadge.textContent = "";
          }
          break;

        case "terminal-submission":
          appendTerminalSubmission(msg.name, msg.text, msg.ts);
          break;

        case "preview-port-update":
          if (msg.port) {
            showPreviewViewer(msg.port);
            tabPreview.classList.add("tab-btn--has-preview");
          } else {
            showPreviewSetup();
            tabPreview.classList.remove("tab-btn--has-preview");
          }
          break;

        case "preview-hint":
          previewError.textContent = msg.message || "";
          tabPreview.classList.add("tab-btn--has-preview");
          break;

        case "session-ended":
          sessionEnded = true;
          if (term) term.write("\r\n\r\n[Session ended]\r\n");
          document.getElementById("session-ended-overlay").classList.remove("session-ended-overlay--hidden");
          if (ws) ws.close();
          break;

        default:
          console.log("[collab] Unknown message type:", msg.type, msg);
      }
    };

    ws.onclose = function (event) {
      console.log("[collab] Connection closed, code:", event.code);
      setConnected(false);
      if (sessionEnded) return;
      scheduleReconnect();
    };

    ws.onerror = function (err) {
      console.error("[collab] WebSocket error:", err);
      ws.close();
    };
  }

  function scheduleReconnect() {
    if (sessionEnded) return;
    if (reconnectTimer) return;

    reconnectBanner.classList.add("reconnect-banner--visible");
    reconnectText.textContent =
      "Disconnected. Reconnecting in " + Math.round(reconnectDelay / 1000) + "s...";

    console.log("[collab] Reconnecting in", reconnectDelay, "ms");

    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      reconnectText.textContent = "Reconnecting...";
      connect();
      // Exponential backoff: 1s -> 2s -> 4s -> 8s -> ... -> 30s max
      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX);
    }, reconnectDelay);
  }

  // ── Tab Switching ──

  function switchTab(tab) {
    if (tab === "terminal") {
      tabTerminal.classList.add("tab-btn--active");
      tabPreview.classList.remove("tab-btn--active");
      panelTerminal.classList.add("tab-panel--active");
      panelPreview.classList.remove("tab-panel--active");
      // Refit terminal when switching back
      requestAnimationFrame(function () {
        if (fitAddon) fitAddon.fit();
        if (term) term.focus();
      });
    } else {
      tabPreview.classList.add("tab-btn--active");
      tabTerminal.classList.remove("tab-btn--active");
      panelPreview.classList.add("tab-panel--active");
      panelTerminal.classList.remove("tab-panel--active");
    }
  }

  tabTerminal.addEventListener("click", function () { switchTab("terminal"); });
  tabPreview.addEventListener("click", function () {
    switchTab("preview");
    tabPreview.classList.remove("tab-btn--has-preview");
  });

  // ── Preview Logic ──

  function showPreviewViewer(port) {
    currentPreviewPort = port;
    previewSetup.style.display = "none";
    previewViewer.style.display = "flex";
    previewUrl.textContent = "localhost:" + port;
    previewIframe.src = "/preview/" + sessionId + "/";
  }

  function showPreviewSetup() {
    currentPreviewPort = null;
    previewViewer.style.display = "none";
    previewSetup.style.display = "flex";
    previewIframe.src = "";
    previewPortInput.value = "";
    previewError.textContent = "";
  }

  previewConnectBtn.addEventListener("click", function () {
    var port = parseInt(previewPortInput.value, 10);
    if (!port || port < 1024 || port > 65535) {
      previewError.textContent = "Enter a valid port (1024-65535)";
      return;
    }
    previewError.textContent = "";
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "set-preview-port", port: port }));
    }
  });

  previewPortInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") previewConnectBtn.click();
  });

  previewRefreshBtn.addEventListener("click", function () {
    if (previewIframe.src) {
      previewIframe.src = previewIframe.src;
    }
  });

  previewDisconnectBtn.addEventListener("click", function () {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "set-preview-port", port: null }));
    }
  });

  // ── Boot ──

  function boot() {
    console.log("[collab] Booting as", userName);
    createTerminal();
    connect();
    // Focus terminal on click
    terminalEl.addEventListener("click", function () {
      if (term) term.focus();
    });
  }

  // ── Invite Button ──
  var inviteBtn = document.getElementById("invite-btn");
  var inviteText = document.getElementById("invite-text");
  if (inviteBtn) {
    inviteBtn.addEventListener("click", function () {
      var url = location.href;
      navigator.clipboard.writeText(url).then(function () {
        inviteText.textContent = "Copied!";
        setTimeout(function () { inviteText.textContent = "Invite"; }, 1500);
      }).catch(function () {
        inviteText.textContent = "Failed";
        setTimeout(function () { inviteText.textContent = "Invite"; }, 1500);
      });
    });
  }

  // ── Init ──
  initNamePrompt();
})();
