const BUFFER_MAX = 4096;
const STALE_THRESHOLD = 500;

// Strip ANSI escape sequences
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
}

class PromptTracker {
  constructor() {
    this._buffer = "";
    this._prompt = null;
    this._promptEndOffset = 0; // buffer length when prompt was detected
  }

  feed(rawData) {
    const clean = stripAnsi(rawData);
    this._buffer += clean;

    // Trim buffer to max size
    if (this._buffer.length > BUFFER_MAX) {
      this._buffer = this._buffer.slice(-BUFFER_MAX);
    }

    // Auto-clear stale prompt: if significant new output arrived since detection
    if (this._prompt) {
      const newSince = this._buffer.length - this._promptEndOffset;
      if (newSince > STALE_THRESHOLD) {
        this._prompt = null;
      }
    }

    // Scan for new prompt (always re-scan tail)
    if (!this._prompt) {
      this._prompt = this._scanForPrompt();
      if (this._prompt) {
        this._promptEndOffset = this._buffer.length;
      }
    }
  }

  getActivePrompt() {
    return this._prompt;
  }

  clearPrompt() {
    this._prompt = null;
    this._promptEndOffset = 0;
  }

  _scanForPrompt() {
    // Look at the tail of the buffer for prompt patterns
    const tail = this._buffer.slice(-1500);

    // y/n prompt: "? Some question (Y/n)" or "(y/N)" at end of output
    const ynMatch = tail.match(
      /(?:^|\n)\s*[?>\u276f]\s+(.+?)\s*\(([yYnN])\/([yYnN])\)\s*$/
    );
    if (ynMatch) {
      return { question: ynMatch[1].trim(), type: "yn", options: null };
    }

    // Numbered options prompt:
    // Look for a question line followed by numbered options
    // Pattern: question on one line, then "  1. Option" / "  2. Option" etc.
    const numberedMatch = tail.match(
      /(?:^|\n)\s*[?>\u276f]\s+(.+?)[\s:]*\n((?:\s+\d+[.)]\s+.+\n?)+)\s*$/
    );
    if (numberedMatch) {
      const question = numberedMatch[1].trim();
      const optionLines = numberedMatch[2].match(/\s+(\d+)[.)]\s+(.+)/g);
      if (optionLines && optionLines.length >= 2) {
        const options = optionLines.map((line) => {
          const m = line.match(/\s+(\d+)[.)]\s+(.+)/);
          return { number: m[1], text: m[2].trim() };
        });
        return { question, type: "numbered", options };
      }
    }

    return null;
  }
}

module.exports = { PromptTracker, stripAnsi };
