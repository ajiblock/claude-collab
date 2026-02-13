const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Strict repo URL validation — only allow github.com with safe characters
const HTTPS_RE = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?$/;
const SSH_RE = /^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/;

function parseRepoUrl(url) {
  const sshMatch = url.match(SSH_RE);
  if (sshMatch) return { owner: sshMatch[1], name: sshMatch[2] };

  const httpsMatch = url.match(HTTPS_RE);
  if (httpsMatch) return { owner: httpsMatch[1], name: httpsMatch[2] };

  throw new Error(`Invalid repo URL: ${url} — only github.com URLs are supported`);
}

function validateParsed(owner, name) {
  if (owner.includes("..") || name.includes("..")) {
    throw new Error("Path traversal detected in repo URL");
  }
  if (owner.includes("/") || name.includes("/")) {
    throw new Error("Invalid characters in repo owner/name");
  }
}

function toSshUrl(url) {
  const httpsMatch = url.match(HTTPS_RE);
  if (httpsMatch) return `git@github.com:${httpsMatch[1]}/${httpsMatch[2]}.git`;
  return url;
}

function ensureRepo(repoUrl, reposDir) {
  const { owner, name } = parseRepoUrl(repoUrl);
  validateParsed(owner, name);

  const sshUrl = toSshUrl(repoUrl);
  const repoDir = path.join(reposDir, owner, name);

  const gitDir = path.join(repoDir, ".git");
  if (fs.existsSync(gitDir) && fs.statSync(gitDir).isDirectory()) {
    console.log(`Reusing existing repo at ${repoDir}`);
  } else {
    fs.mkdirSync(path.join(reposDir, owner), { recursive: true });
    console.log(`Cloning ${sshUrl} into ${repoDir}...`);
    const result = spawnSync("git", ["clone", sshUrl, repoDir], { stdio: "inherit" });
    if (result.status !== 0) {
      throw new Error(`git clone failed with exit code ${result.status}`);
    }
  }

  return { owner, name, repoDir };
}

// Keep old name as alias for backwards compatibility
const cloneOrPull = ensureRepo;

module.exports = { parseRepoUrl, ensureRepo, cloneOrPull, toSshUrl };
