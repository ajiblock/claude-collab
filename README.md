# claude-collab

```
     _____ _                 _            _____       _ _       _
    / ____| |               | |          / ____|     | | |     | |
   | |    | | __ _ _   _  __| | ___     | |     ___ | | | __ _| |__
   | |    | |/ _` | | | |/ _` |/ _ \    | |    / _ \| | |/ _` | '_ \
   | |____| | (_| | |_| | (_| |  __/    | |___| (_) | | | (_| | |_) |
    \_____|_|\__,_|\__,_|\__,_|\___|     \_____\___/|_|_|\__,_|_.__/
```

**Share Claude Code terminal sessions with anyone. Collaborative AI pair programming in the browser.**

One command to start. One link to share. No install needed for your friend.

---

## How It Works

```
    YOU                              YOUR FRIEND
  +------------+                   +------------+
  |  Browser   |                   |  Browser   |
  |            |                   |            |
  |  Terminal  | <---- ws ------>  |  Terminal  |
  |  Chat      |                   |  Chat      |
  +-----+------+                   +-----+------+
        |                                |
        +---------------+----------------+
                        |
               +--------+--------+
               |  claude-collab  |
               |     server      |
               |                 |
               |  +-----------+  |
               |  |Claude Code|  |
               |  |   (pty)   |  |
               |  +-----------+  |
               +-----------------+
```

1. **Start** — Run `claude-collab`. It launches a local server and opens a public tunnel.
2. **Create** — Paste a GitHub repo URL in the dashboard, hit "Start Session".
3. **Share** — Copy the session link. Send it to your friend.
4. **Collaborate** — Both of you see the same Claude Code terminal in real-time. Chat in the sidebar. Either person can type into the terminal.

Your friend doesn't install anything — they just open the link.

---

## Quick Start

```bash
npx claude-collab
```

That's it. A browser tab opens with your dashboard and a shareable public URL.

### Other install methods

```bash
# Install globally
npm install -g claude-collab
claude-collab

# Or use the one-liner (macOS — installs Node.js + Claude Code if needed)
curl -fsSL https://raw.githubusercontent.com/ajiblock/claude-collab/main/install.sh | bash
```

---

## CLI Flags

```
Usage: claude-collab [options]

  --port <number>     Port to listen on (default: 4321)
  --no-tunnel         Skip public tunnel, local network only
  --no-chat           Disable the chat sidebar
  --debug             Verbose request + WebSocket logging
  --help, -h          Show help
```

### `--port <number>`

Run on a specific port. Useful if 4321 is taken.

```bash
claude-collab --port 8080
```

### `--no-tunnel`

Skip the automatic public tunnel. The server will only be accessible on your local network. Good for when you're sitting next to someone or don't want external access.

```bash
claude-collab --no-tunnel
```

### `--no-chat`

Disable the chat sidebar. The session will be terminal-only — no chat panel on desktop, no Chat tab on mobile.

```bash
claude-collab --no-chat
```

### `--debug`

Log every HTTP request and WebSocket connection with timing info. Helpful for diagnosing connection issues.

```bash
claude-collab --debug
```

---

## Features

- **Multi-session** — Run multiple Claude Code sessions at once against different repos
- **Auto-tunnel** — Creates a public HTTPS URL automatically (Cloudflare > localtunnel > LAN fallback)
- **Real-time terminal** — Shared PTY via WebSocket. Everyone sees the same output instantly.
- **Live preview** — See what Claude is building in a browser tab right next to the terminal. Auto-detects dev server ports, or enter a port manually. All connected users see the same preview.
- **Built-in chat** — Sidebar chat so you can discuss without interrupting Claude. On mobile, chat moves to its own tab for a better experience. Disable with `--no-chat`.
- **Link-only access** — No accounts, no login. Just share the URL.
- **Terminal submissions feed** — See who typed what into the terminal
- **Auto-reconnect** — Handles dropped connections gracefully
- **Smart resize** — Terminal adapts to the smallest connected browser window
- **Rate limiting** — Built-in protection against spam (5 sessions/min, 30 chat messages/min)

---

## Live Preview

Every session has a **Preview** tab next to the Terminal tab. It lets all connected users see what Claude is building — HTML pages, React apps, API responses — without leaving the session.

**How it works:**
- When Claude starts a dev server (e.g. `npx serve`, `npm run dev`, `python3 -m http.server`), the server auto-detects the port from terminal output and loads the preview automatically
- You can also enter a port manually in the preview toolbar
- The preview is proxied through the claude-collab server, so it works over tunnels — everyone sees it, not just the host
- Claude is instructed to use HTTP servers instead of `file://` URLs. If a `file://` URL is detected, a hint appears suggesting you enter the port manually

---

## Tunnel Priority

claude-collab tries to give you a public URL automatically:

```
  1. cloudflared   -->  https://random-words.trycloudflare.com
     (best, auto-installs via brew if available)
              |
              v  fallback
  2. localtunnel   -->  https://xyz.loca.lt
     (bundled, no install needed)
              |
              v  fallback
  3. LAN IP        -->  http://192.168.1.x:4321
     (same network only)
```

Use `--no-tunnel` to skip tunneling entirely.

---

## Environment Variables

All optional. Set in `.env.local` or export before running.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4321` | Server port |
| `HOST` | `0.0.0.0` | Bind address |
| `DATA_DIR` | `./data` | Session data directory |
| `CLAUDE_PATH` | `claude` | Path to Claude Code binary |
| `MAX_SESSIONS` | `10` | Max concurrent sessions |
| `SESSION_IDLE_TIMEOUT` | `0` | Auto-end idle sessions (minutes, 0 = off) |
| `CLAUDE_COLLAB_NO_CHAT` | _(unset)_ | Set to `1` to disable chat |

---

## Prerequisites

- **macOS** (primary platform — Linux is untested, Windows is not supported)
- **Node.js** >= 18
- **Claude Code** — `npm install -g @anthropic-ai/claude-code`
- The server operator needs to be logged into Claude Code (`claude` must work in your terminal)

---

## Project Structure

```
claude-collab/
├── bin/
│   └── claude-collab.js    # CLI entry point
├── lib/
│   ├── config.js           # Environment config loader
│   ├── git.js              # Repo cloning
│   ├── pty-manager.js      # PTY process management
│   ├── prompt-tracker.js    # Detects Claude's y/n and numbered prompts
│   ├── session.js          # Single session state (users, chat)
│   ├── sessions.js         # Session lifecycle manager
│   └── tunnel.js           # Cloudflare / localtunnel / LAN
├── public/
│   ├── index.html          # Dashboard page
│   ├── session.html        # Session page
│   ├── dashboard.js        # Dashboard client JS
│   ├── client.js           # Session client JS (terminal + chat)
│   └── style.css           # Styles
├── test/                   # Tests (node --test)
├── server.js               # Express + WebSocket server
├── package.json
└── install.sh              # One-liner installer for macOS
```

---

## Security Model & Known Limitations

claude-collab is designed for **trusted collaborators sharing links** — not for public/anonymous access. Here's what that means:

- **No authentication** — Anyone with the session URL can join. Session IDs are 128-bit random, so they can't be guessed, but treat session links like passwords. Don't post them publicly.
- **No CORS/origin restrictions on WebSockets** — Tunnels generate random subdomains, so origin validation isn't practical. The 128-bit session ID is the access control.
- **Chat is stored in plaintext** — Chat history is saved to `data/sessions/<id>/chat.json`. The server operator can read it. Don't share secrets in chat.
- **Session data persists after sessions end** — Cloned repos and chat logs stay in `data/` until you delete them manually.
- **`npm audit` reports 2 high-severity CVEs in axios** — These are in `localtunnel` (a transitive dependency). The CVEs (CSRF/SSRF) require attacker control over request URLs, which doesn't apply here — axios is only used internally by localtunnel to connect to its own servers.
- **No HTTPS without a tunnel** — The server itself is HTTP. Tunnel providers (Cloudflare, localtunnel) add HTTPS automatically. For local-only use, traffic is unencrypted.
- **macOS only** — Built and tested on macOS. Linux may work but is untested. Windows is not supported (node-pty + PTY behavior differs).

---

## License

MIT
