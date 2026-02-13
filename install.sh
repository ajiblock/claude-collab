#!/usr/bin/env bash
set -euo pipefail

echo ""
echo "  claude-collab installer"
echo "  ─────────────────────────"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}!${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; exit 1; }

# Step 1: Check Node.js >= 18
if command -v node &>/dev/null; then
  NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_VERSION" -ge 18 ]; then
    ok "Node.js $(node -v) found"
  else
    warn "Node.js $(node -v) is too old (need >= 18)"
    if command -v brew &>/dev/null; then
      echo "  Installing Node.js via Homebrew..."
      brew install node
      ok "Node.js installed"
    else
      fail "Please install Node.js >= 18: https://nodejs.org"
    fi
  fi
else
  warn "Node.js not found"
  if command -v brew &>/dev/null; then
    echo "  Installing Node.js via Homebrew..."
    brew install node
    ok "Node.js installed"
  else
    # Direct download for macOS
    ARCH=$(uname -m)
    if [ "$ARCH" = "arm64" ]; then
      NODE_ARCH="arm64"
    else
      NODE_ARCH="x64"
    fi
    NODE_VER="v20.11.0"
    NODE_URL="https://nodejs.org/dist/${NODE_VER}/node-${NODE_VER}-darwin-${NODE_ARCH}.tar.gz"
    INSTALL_DIR="$HOME/.claude-collab/node"

    echo "  Downloading Node.js ${NODE_VER}..."
    mkdir -p "$INSTALL_DIR"
    curl -fsSL "$NODE_URL" | tar xz -C "$INSTALL_DIR" --strip-components=1

    export PATH="$INSTALL_DIR/bin:$PATH"

    # Add to shell profile
    SHELL_RC="$HOME/.zshrc"
    if [ -f "$HOME/.bashrc" ] && [ ! -f "$HOME/.zshrc" ]; then
      SHELL_RC="$HOME/.bashrc"
    fi
    echo 'export PATH="$HOME/.claude-collab/node/bin:$PATH"' >> "$SHELL_RC"
    ok "Node.js installed to ~/.claude-collab/node"
  fi
fi

# Step 2: Check Claude Code CLI
if command -v claude &>/dev/null; then
  ok "Claude Code CLI found"
else
  warn "Claude Code CLI not found"
  echo "  Installing @anthropic-ai/claude-code..."
  npm install -g @anthropic-ai/claude-code
  ok "Claude Code CLI installed"
fi

# Step 3: Install claude-collab
echo "  Installing claude-collab..."
npm install -g claude-collab
ok "claude-collab installed"

echo ""
echo "  ─────────────────────────"
echo -e "  ${GREEN}All set!${NC} Run this to start:"
echo ""
echo "    claude-collab"
echo ""
