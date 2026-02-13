(function() {
  "use strict";

  const createForm = document.getElementById("create-form");
  const repoInput = document.getElementById("repo-input");
  const createBtn = document.getElementById("create-btn");
  const createBtnText = document.getElementById("create-btn-text");
  const createBtnSpinner = document.getElementById("create-btn-spinner");
  const createError = document.getElementById("create-error");
  const activeSessions = document.getElementById("active-sessions");
  const endedSessions = document.getElementById("ended-sessions");
  const emptyState = document.getElementById("empty-state");
  const endedSection = document.getElementById("ended-section");
  const toast = document.getElementById("toast");

  let pollInterval = null;

  function timeAgo(ts) {
    const seconds = Math.floor((Date.now() - ts) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes === 1 ? "1 min ago" : `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours === 1 ? "1 hr ago" : `${hours} hrs ago`;
    const days = Math.floor(hours / 24);
    return days === 1 ? "1 day ago" : `${days} days ago`;
  }

  function showToast(text) {
    toast.textContent = text;
    toast.classList.remove("toast--hidden");
    toast.classList.add("toast--visible");
    setTimeout(() => {
      toast.classList.remove("toast--visible");
      toast.classList.add("toast--hidden");
    }, 2000);
  }

  function renderSessionCard(s) {
    const card = document.createElement("div");
    card.className = "session-card" + (s.status === "ended" ? " session-card--ended" : "");
    card.dataset.id = s.id;

    const repoName = s.repo || "unknown";
    const statusBadge = s.status === "active"
      ? `<span class="badge badge--active">active</span>`
      : `<span class="badge badge--ended">ended</span>`;

    const clientDots = s.status === "active" && s.clientCount > 0
      ? Array(Math.min(s.clientCount, 5)).fill('<span class="client-dot"></span>').join("")
      : "";

    card.innerHTML = `
      <div class="session-card__header">
        <span class="session-card__repo">${escapeHtml(repoName)}</span>
        ${statusBadge}
      </div>
      <div class="session-card__meta">
        <span class="session-card__time">${timeAgo(s.createdAt)}</span>
        ${clientDots ? `<span class="session-card__clients">${clientDots} <span class="session-card__client-count">${s.clientCount}</span></span>` : ""}
      </div>
      ${s.status === "active" ? `
      <div class="session-card__actions">
        <a href="/s/${s.id}" class="btn btn--primary btn--sm">Join</a>
        <button class="btn btn--ghost btn--sm copy-btn" data-url="${escapeHtml(location.origin + "/s/" + s.id)}">Copy Link</button>
        <button class="btn btn--danger btn--sm end-btn" data-id="${s.id}">End</button>
      </div>` : ""}
    `;

    return card;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  async function loadSessions() {
    try {
      const res = await fetch("/api/sessions");
      if (!res.ok) throw new Error("Failed to load sessions");
      const sessions = await res.json();

      const active = sessions.filter(s => s.status === "active");
      const ended = sessions.filter(s => s.status === "ended");

      // Active
      activeSessions.innerHTML = "";
      active.forEach(s => activeSessions.appendChild(renderSessionCard(s)));

      if (active.length === 0) {
        emptyState.classList.remove("empty-state--hidden");
      } else {
        emptyState.classList.add("empty-state--hidden");
      }

      // Ended
      endedSessions.innerHTML = "";
      ended.forEach(s => endedSessions.appendChild(renderSessionCard(s)));

      if (ended.length > 0) {
        endedSection.classList.remove("ended-section--hidden");
      } else {
        endedSection.classList.add("ended-section--hidden");
      }
    } catch (e) {
      console.error("Failed to load sessions:", e);
    }
  }

  createForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const repo = repoInput.value.trim();
    if (!repo) return;

    createBtnText.textContent = "Creating...";
    createBtnSpinner.classList.remove("spinner--hidden");
    createBtn.disabled = true;
    createError.textContent = "";

    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create session");
      location.href = "/s/" + data.id;
    } catch (e) {
      createError.textContent = e.message;
      createBtnText.textContent = "Start Session";
      createBtnSpinner.classList.add("spinner--hidden");
      createBtn.disabled = false;
    }
  });

  // Event delegation for card buttons
  document.addEventListener("click", async (e) => {
    const copyBtn = e.target.closest(".copy-btn");
    if (copyBtn) {
      const url = copyBtn.dataset.url;
      try {
        await navigator.clipboard.writeText(url);
        showToast("Link copied!");
      } catch {
        showToast("Failed to copy");
      }
      return;
    }

    const endBtn = e.target.closest(".end-btn");
    if (endBtn) {
      const id = endBtn.dataset.id;
      if (!confirm("End this session? All connected clients will be disconnected.")) return;
      try {
        await fetch(`/api/sessions/${id}`, { method: "DELETE" });
        loadSessions();
      } catch (e) {
        showToast("Failed to end session");
      }
    }
  });

  // Initial load + polling
  loadSessions();
  pollInterval = setInterval(loadSessions, 5000);
  window.addEventListener("beforeunload", () => clearInterval(pollInterval));
})();
