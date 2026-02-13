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
  YOU                          YOUR FRIEND
  ┌──────────┐                 ┌──────────┐
  │  Browser  │                │  Browser  │
  │          │                │          │
  │ Terminal  │◄──── ws ─────►│ Terminal  │
  │   Chat    │                │   Chat    │
  └─────┬────┘                └─────┬────┘
        │                           │
        └───────────┬───────────────┘
                    │
            ┌───────┴────────┐
            │  claude-collab  │
            │    server       │
            │                 │
            │  ┌───────────┐  │
            │  │ Claude Code│  │
            │  │   (pty)    │  │
            │  └───────────┘  │
            └────────────────┘
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

  --port <number>     Port to listen on (default: 3000)
  --no-tunnel         Skip public tunnel, local network only
  --debug             Verbose request + WebSocket logging
  --help, -h          Show help
```

### `--port <number>`

Run on a specific port. Useful if 3000 is taken.

```bash
claude-collab --port 8080
```

### `--no-tunnel`

Skip the automatic public tunnel. The server will only be accessible on your local network. Good for when you're sitting next to someone or don't want external access.

```bash
claude-collab --no-tunnel
```

### `--debug`

Log every HTTP request and WebSocket connection with timing info. Helpful for diagnosing connection issues.

```bash
claude-collab --debug
```

---

## Features

```
  ┌─────────────────────────────────────────────┐
  │            DASHBOARD (index.html)            │
  │                                              │
  │  [Repo URL: _______________] [Start Session] │
  │                                              │
  │  Active Sessions:                            │
  │  ┌─────────────────────────┐                 │
  │  │ my-app  (2 users)  [End]│                 │
  │  └─────────────────────────┘                 │
  │  ┌─────────────────────────┐                 │
  │  │ api-server (1 user) [End]│                │
  │  └─────────────────────────┘                 │
  └─────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────┐
  │           SESSION (session.html)             │
  │                                              │
  │  ┌───────────────────────┐ ┌──────────────┐ │
  │  │                       │ │  Chat         │ │
  │  │   Claude Code         │ │              │ │
  │  │   Terminal             │ │  Alice: hi!  │ │
  │  │                       │ │  Bob: hey    │ │
  │  │   > fixing the bug... │ │              │ │
  │  │                       │ │  [message]   │ │
  │  └───────────────────────┘ └──────────────┘ │
  └─────────────────────────────────────────────┘
```

- **Multi-session** — Run multiple Claude Code sessions at once against different repos
- **Auto-tunnel** — Creates a public HTTPS URL automatically (Cloudflare > localtunnel > LAN fallback)
- **Real-time terminal** — Shared PTY via WebSocket. Everyone sees the same output instantly.
- **Built-in chat** — Sidebar chat so you can discuss without interrupting Claude
- **Link-only access** — No accounts, no login. Just share the URL.
- **Terminal submissions feed** — See who typed what into the terminal
- **Auto-reconnect** — Handles dropped connections gracefully
- **Smart resize** — Terminal adapts to the smallest connected browser window
- **Rate limiting** — Built-in protection against spam (5 sessions/min, 30 chat messages/min)

---

## Tunnel Priority

claude-collab tries to give you a public URL automatically:

```
  1. cloudflared    ──►  https://random-words.trycloudflare.com
     (best, auto-installs via brew if available)
              │
              ▼ fallback
  2. localtunnel    ──►  https://xyz.loca.lt
     (bundled, no install needed)
              │
              ▼ fallback
  3. LAN IP         ──►  http://192.168.1.x:3000
     (same network only)
```

Use `--no-tunnel` to skip tunneling entirely.

---

## Environment Variables

All optional. Set in `.env.local` or export before running.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |
| `HOST` | `0.0.0.0` | Bind address |
| `DATA_DIR` | `./data` | Session data directory |
| `CLAUDE_PATH` | `claude` | Path to Claude Code binary |
| `MAX_SESSIONS` | `10` | Max concurrent sessions |
| `SESSION_IDLE_TIMEOUT` | `0` | Auto-end idle sessions (minutes, 0 = off) |

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
