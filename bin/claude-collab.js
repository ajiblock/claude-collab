#!/usr/bin/env node

const { spawnSync } = require("child_process");

// Parse CLI args
const args = process.argv.slice(2);
let port = null;
let noTunnel = false;
let debug = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port" && args[i + 1]) {
    port = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === "--no-tunnel") {
    noTunnel = true;
  } else if (args[i] === "--debug") {
    debug = true;
  } else if (args[i] === "--help" || args[i] === "-h") {
    console.log("Usage: claude-collab [options]");
    console.log("");
    console.log("Options:");
    console.log("  --port <number>  Port to listen on (default: 4321)");
    console.log("  --no-tunnel      Skip tunnel creation, use local network only");
    console.log("  --debug          Enable verbose request and connection logging");
    console.log("  --help, -h       Show this help message");
    process.exit(0);
  }
}

// Set env vars before requiring server
if (port) process.env.PORT = String(port);
if (debug) process.env.CLAUDE_COLLAB_DEBUG = "1";

// Check claude is available (use shell to handle functions/aliases)
const claudeCheck = spawnSync("bash", ["-c", "command -v claude"], { encoding: "utf-8" });
if (claudeCheck.status !== 0 || !claudeCheck.stdout?.trim()) {
  console.error("Error: Claude Code CLI not found in PATH.");
  console.error("");
  console.error("Install it with:");
  console.error("  npm install -g @anthropic-ai/claude-code");
  console.error("");
  console.error("Then run claude-collab again.");
  process.exit(1);
}

// Start server
const { startServer } = require("../server");

startServer().then(async (server) => {
  const actualPort = server.address().port;
  let shareUrl = `http://localhost:${actualPort}`;
  let tunnelCleanup = () => {};

  if (!noTunnel) {
    try {
      const { createTunnel } = require("../lib/tunnel");
      const tunnel = await createTunnel(actualPort);
      shareUrl = tunnel.url;
      tunnelCleanup = tunnel.cleanup;
      console.log(`Tunnel: ${tunnel.type}`);
    } catch (e) {
      console.warn("Tunnel setup failed:", e.message);
      console.warn("Using local URL only.");
    }
  }

  const browserUrl = shareUrl || `http://localhost:${actualPort}`;
  const isTunnel = browserUrl !== `http://localhost:${actualPort}`;

  console.log("");
  console.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
  console.log("");
  console.log("  claude-collab is running!");
  console.log("");
  if (isTunnel) {
    console.log(`  Share URL: ${shareUrl}`);
    console.log(`  Local:     http://localhost:${actualPort}`);
    console.log("");
    console.log("  Send the Share URL to your friend to start collaborating.");
  } else {
    console.log(`  URL: http://localhost:${actualPort}`);
  }
  console.log("");
  console.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
  console.log("");

  // Auto-open browser (use tunnel URL when available)
  // Delay when using a tunnel — DNS for the subdomain needs time to propagate
  function openBrowser(url) {
    if (process.platform === "darwin") {
      spawnSync("open", [url]);
    } else if (process.platform === "linux") {
      spawnSync("xdg-open", [url]);
    }
  }

  if (isTunnel) {
    setTimeout(() => openBrowser(browserUrl), 5000);
  } else {
    openBrowser(browserUrl);
  }

  // Graceful shutdown
  function shutdown() {
    console.log("\nShutting down tunnel...");
    tunnelCleanup();
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}).catch((e) => {
  console.error("Failed to start server:", e.message);
  process.exit(1);
});
