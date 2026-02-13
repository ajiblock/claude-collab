const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { parseRepoUrl, toSshUrl, ensureRepo } = require("../lib/git.js");

describe("lib/git.js", () => {
  describe("parseRepoUrl", () => {
    it("parses HTTPS URLs correctly", () => {
      const result = parseRepoUrl("https://github.com/owner/repo");
      assert.deepStrictEqual(result, { owner: "owner", name: "repo" });
    });

    it("parses HTTPS URLs with .git suffix", () => {
      const result = parseRepoUrl("https://github.com/owner/repo.git");
      assert.deepStrictEqual(result, { owner: "owner", name: "repo" });
    });

    it("parses HTTP URLs correctly", () => {
      const result = parseRepoUrl("http://github.com/owner/repo");
      assert.deepStrictEqual(result, { owner: "owner", name: "repo" });
    });

    it("parses SSH URLs correctly", () => {
      const result = parseRepoUrl("git@github.com:owner/repo");
      assert.deepStrictEqual(result, { owner: "owner", name: "repo" });
    });

    it("parses SSH URLs with .git suffix", () => {
      const result = parseRepoUrl("git@github.com:owner/repo.git");
      assert.deepStrictEqual(result, { owner: "owner", name: "repo" });
    });

    it("rejects non-github URLs", () => {
      assert.throws(
        () => parseRepoUrl("https://gitlab.com/owner/repo"),
        /Invalid repo URL.*only github\.com URLs are supported/
      );
    });

    it("rejects URLs with path traversal in owner", () => {
      // URLs with .. won't match the regex pattern, so parseRepoUrl throws "Invalid repo URL"
      assert.throws(
        () => parseRepoUrl("https://github.com/../evil/repo"),
        /Invalid repo URL.*only github\.com URLs are supported/
      );
    });

    it("rejects URLs with path traversal in repo name", () => {
      // URLs with .. won't match the regex pattern, so parseRepoUrl throws "Invalid repo URL"
      assert.throws(
        () => parseRepoUrl("https://github.com/owner/../evil"),
        /Invalid repo URL.*only github\.com URLs are supported/
      );
    });

    it("rejects URLs with slashes in owner", () => {
      // Extra slashes don't match the regex pattern
      assert.throws(
        () => parseRepoUrl("https://github.com/owner/extra/repo"),
        /Invalid repo URL.*only github\.com URLs are supported/
      );
    });

    it("rejects completely malformed URLs", () => {
      assert.throws(
        () => parseRepoUrl("not-a-url"),
        /Invalid repo URL.*only github\.com URLs are supported/
      );
    });

    it("rejects URLs without owner/repo", () => {
      assert.throws(
        () => parseRepoUrl("https://github.com"),
        /Invalid repo URL.*only github\.com URLs are supported/
      );
    });

    it("accepts URLs with dots and dashes in owner/repo", () => {
      const result = parseRepoUrl("https://github.com/my-org.name/my-repo.name");
      assert.deepStrictEqual(result, {
        owner: "my-org.name",
        name: "my-repo.name",
      });
    });
  });

  describe("toSshUrl", () => {
    it("converts HTTPS URL to SSH format", () => {
      const result = toSshUrl("https://github.com/owner/repo");
      assert.strictEqual(result, "git@github.com:owner/repo.git");
    });

    it("converts HTTPS URL with .git to SSH format", () => {
      const result = toSshUrl("https://github.com/owner/repo.git");
      assert.strictEqual(result, "git@github.com:owner/repo.git");
    });

    it("converts HTTP URL to SSH format", () => {
      const result = toSshUrl("http://github.com/owner/repo");
      assert.strictEqual(result, "git@github.com:owner/repo.git");
    });

    it("passes SSH URL through unchanged", () => {
      const sshUrl = "git@github.com:owner/repo.git";
      const result = toSshUrl(sshUrl);
      assert.strictEqual(result, sshUrl);
    });

    it("passes SSH URL without .git through unchanged", () => {
      const sshUrl = "git@github.com:owner/repo";
      const result = toSshUrl(sshUrl);
      assert.strictEqual(result, sshUrl);
    });
  });

  describe("ensureRepo", () => {
    it("validates URL before attempting clone", () => {
      assert.throws(
        () => ensureRepo("https://gitlab.com/owner/repo", "/tmp/test"),
        /Invalid repo URL.*only github\.com URLs are supported/
      );
    });

    it("rejects path traversal via validateParsed", () => {
      assert.throws(
        () => ensureRepo("https://github.com/../evil/repo", "/tmp/test"),
        /Invalid repo URL.*only github\.com URLs are supported/
      );
    });

    it("returns repoDir as reposDir/owner/name", () => {
      // Simulate an existing repo by creating the .git directory
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-test-"));
      const repoDir = path.join(tmpDir, "myowner", "myrepo");
      fs.mkdirSync(path.join(repoDir, ".git"), { recursive: true });

      const result = ensureRepo("https://github.com/myowner/myrepo", tmpDir);
      assert.strictEqual(result.owner, "myowner");
      assert.strictEqual(result.name, "myrepo");
      assert.strictEqual(result.repoDir, repoDir);

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("reuses existing repo without cloning when .git exists", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-test-"));
      const repoDir = path.join(tmpDir, "owner", "repo");
      fs.mkdirSync(path.join(repoDir, ".git"), { recursive: true });
      // Create a local change file to verify it's preserved
      fs.writeFileSync(path.join(repoDir, "local-change.txt"), "unsaved work");

      const result = ensureRepo("https://github.com/owner/repo", tmpDir);
      assert.strictEqual(result.repoDir, repoDir);
      // Local changes should still be there (no clone or pull happened)
      assert.strictEqual(
        fs.readFileSync(path.join(repoDir, "local-change.txt"), "utf8"),
        "unsaved work"
      );

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });
});
