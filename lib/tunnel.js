const { spawn, spawnSync } = require("child_process");
const os = require("os");

const DEBUG = process.env.CLAUDE_COLLAB_DEBUG === "1";
function dbg(...args) { if (DEBUG) console.log("[debug:tunnel]", ...args); }

async function createTunnel(port) {
  // Try cloudflared first
  try {
    const result = await tryCloudflared(port);
    if (result) return result;
  } catch (e) {
    console.log("cloudflared not available:", e.message);
  }

  // Try localtunnel
  try {
    const result = await tryLocaltunnel(port);
    if (result) return result;
  } catch (e) {
    console.log("localtunnel not available:", e.message);
  }

  // Fall back to local IP
  return getLocalUrl(port);
}

function tryCloudflared(port) {
  return new Promise((resolve, reject) => {
    // Check if cloudflared exists
    const which = spawnSync("which", ["cloudflared"]);
    if (which.status !== 0) {
      // Try to install via brew
      const brewCheck = spawnSync("which", ["brew"]);
      if (brewCheck.status === 0) {
        console.log("Installing cloudflared via brew...");
        const install = spawnSync("brew", ["install", "cloudflared"], { stdio: "inherit" });
        if (install.status !== 0) {
          reject(new Error("Failed to install cloudflared"));
          return;
        }
      } else {
        reject(new Error("cloudflared not found and brew not available"));
        return;
      }
    }

    const proc = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${port}`], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error("cloudflared timed out waiting for URL"));
      }
    }, 30000);

    function parseUrl(data) {
      const text = data.toString();
      const match = text.match(/(https:\/\/[a-z0-9-]+\.trycloudflare\.com)/);
      if (match && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        dbg("cloudflared URL parsed:", match[1]);
        console.log(`Tunnel established: ${match[1]}`);
        resolve({
          url: match[1],
          type: "cloudflared",
          cleanup: () => { try { proc.kill(); } catch {} },
        });
      }
    }

    proc.stdout.on("data", parseUrl);
    proc.stderr.on("data", parseUrl);

    proc.on("error", (e) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(e);
      }
    });

    proc.on("exit", (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(new Error(`cloudflared exited with code ${code}`));
      }
    });
  });
}

async function tryLocaltunnel(port) {
  let localtunnel;
  try {
    localtunnel = require("localtunnel");
  } catch {
    throw new Error("localtunnel not installed");
  }

  const tunnel = await localtunnel({ port });
  console.log(`Tunnel established: ${tunnel.url}`);
  return {
    url: tunnel.url,
    type: "localtunnel",
    cleanup: () => { try { tunnel.close(); } catch {} },
  };
}

function getLocalUrl(port) {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        const url = `http://${iface.address}:${port}`;
        console.log(`No tunnel available. Using local network: ${url}`);
        return { url, type: "local", cleanup: () => {} };
      }
    }
  }
  return { url: `http://localhost:${port}`, type: "local", cleanup: () => {} };
}

module.exports = { createTunnel };
