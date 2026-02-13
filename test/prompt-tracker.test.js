const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { PromptTracker, stripAnsi } = require("../lib/prompt-tracker");

describe("stripAnsi", () => {
  it("removes ANSI color codes", () => {
    assert.equal(stripAnsi("\x1b[32mhello\x1b[0m"), "hello");
  });

  it("removes cursor movement sequences", () => {
    assert.equal(stripAnsi("\x1b[2Jfoo\x1b[1;1H"), "foo");
  });

  it("passes through plain text unchanged", () => {
    assert.equal(stripAnsi("plain text"), "plain text");
  });
});

describe("PromptTracker", () => {
  describe("y/n detection", () => {
    it("detects Y/n prompt", () => {
      const pt = new PromptTracker();
      pt.feed("? Allow access to file? (Y/n)");
      const p = pt.getActivePrompt();
      assert.ok(p);
      assert.equal(p.type, "yn");
      assert.equal(p.question, "Allow access to file?");
    });

    it("detects y/N prompt", () => {
      const pt = new PromptTracker();
      pt.feed("? Do you want to continue? (y/N)");
      const p = pt.getActivePrompt();
      assert.ok(p);
      assert.equal(p.type, "yn");
      assert.equal(p.question, "Do you want to continue?");
    });

    it("detects prompt with > prefix", () => {
      const pt = new PromptTracker();
      pt.feed("> Save changes? (Y/n)");
      const p = pt.getActivePrompt();
      assert.ok(p);
      assert.equal(p.type, "yn");
    });

    it("detects prompt wrapped in ANSI codes", () => {
      const pt = new PromptTracker();
      pt.feed("\x1b[1m? \x1b[0m\x1b[36mAllow file access?\x1b[0m (Y/n)");
      const p = pt.getActivePrompt();
      assert.ok(p);
      assert.equal(p.type, "yn");
      assert.ok(p.question.includes("Allow file access?"));
    });
  });

  describe("numbered detection", () => {
    it("detects numbered options", () => {
      const pt = new PromptTracker();
      pt.feed("? How would you like to proceed?\n  1. Run the command\n  2. Skip it\n  3. Edit first\n");
      const p = pt.getActivePrompt();
      assert.ok(p);
      assert.equal(p.type, "numbered");
      assert.equal(p.question, "How would you like to proceed?");
      assert.equal(p.options.length, 3);
      assert.equal(p.options[0].number, "1");
      assert.equal(p.options[0].text, "Run the command");
      assert.equal(p.options[2].number, "3");
      assert.equal(p.options[2].text, "Edit first");
    });

    it("detects options with ) delimiter", () => {
      const pt = new PromptTracker();
      pt.feed("? Select:\n  1) Option A\n  2) Option B\n");
      const p = pt.getActivePrompt();
      assert.ok(p);
      assert.equal(p.type, "numbered");
      assert.equal(p.options.length, 2);
    });
  });

  describe("multi-chunk delivery", () => {
    it("detects prompt split across two feeds", () => {
      const pt = new PromptTracker();
      pt.feed("? Choose an option:\n");
      assert.equal(pt.getActivePrompt(), null); // not enough yet
      pt.feed("  1. First choice\n  2. Second choice\n");
      const p = pt.getActivePrompt();
      assert.ok(p);
      assert.equal(p.type, "numbered");
      assert.equal(p.options.length, 2);
    });

    it("detects y/n prompt after other output", () => {
      const pt = new PromptTracker();
      pt.feed("Some log output\nMore output\n");
      assert.equal(pt.getActivePrompt(), null);
      pt.feed("? Proceed? (Y/n)");
      const p = pt.getActivePrompt();
      assert.ok(p);
      assert.equal(p.type, "yn");
    });
  });

  describe("stale auto-clear", () => {
    it("clears prompt after 500+ chars of new output", () => {
      const pt = new PromptTracker();
      pt.feed("? Continue? (Y/n)");
      assert.ok(pt.getActivePrompt());

      // Feed 600 chars of new output (Claude moved on)
      pt.feed("x".repeat(600));
      assert.equal(pt.getActivePrompt(), null);
    });

    it("keeps prompt with small amounts of new output", () => {
      const pt = new PromptTracker();
      pt.feed("? Continue? (Y/n)");
      assert.ok(pt.getActivePrompt());

      pt.feed("small");
      assert.ok(pt.getActivePrompt()); // still active
    });
  });

  describe("clearPrompt", () => {
    it("clears the active prompt", () => {
      const pt = new PromptTracker();
      pt.feed("? Continue? (Y/n)");
      assert.ok(pt.getActivePrompt());
      pt.clearPrompt();
      assert.equal(pt.getActivePrompt(), null);
    });
  });

  describe("no false positives", () => {
    it("does not detect regular output as prompt", () => {
      const pt = new PromptTracker();
      pt.feed("Building project...\nCompiling 42 files\nDone in 3.2s\n");
      assert.equal(pt.getActivePrompt(), null);
    });

    it("does not detect partial y/n pattern", () => {
      const pt = new PromptTracker();
      pt.feed("The answer is (Y/n) but this is not a prompt\nmore text");
      assert.equal(pt.getActivePrompt(), null);
    });

    it("does not detect single numbered line as options", () => {
      const pt = new PromptTracker();
      pt.feed("? Question\n  1. Only one option\n");
      assert.equal(pt.getActivePrompt(), null); // need at least 2 options
    });
  });

  describe("buffer overflow", () => {
    it("handles input exceeding 4KB buffer", () => {
      const pt = new PromptTracker();
      // Feed 5KB of data
      pt.feed("a".repeat(5000));
      // Should not crash, and no false prompt
      assert.equal(pt.getActivePrompt(), null);

      // Can still detect prompt after overflow
      pt.feed("\n? Ready? (Y/n)");
      assert.ok(pt.getActivePrompt());
    });
  });
});
