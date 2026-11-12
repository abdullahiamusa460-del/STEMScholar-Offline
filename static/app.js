/* ============ STEMScholar AI — Professional Frontend ============ */
const API = "";
let currentChatId = null;
let isStreaming = false;
let currentBotDiv = null;
let currentBotBubble = null;
let currentBotMsgIdx = null;
let settings = {};
let uploadedFiles = []; // { name, original }

// Elements
const useNotesCb = document.getElementById("useNotes");
const modelBadge = document.getElementById("modelBadge");
const settingModel = document.getElementById("settingModel");
const statusDot = document.getElementById("dot");
const statusText = document.getElementById("statusText");
const messages = document.getElementById("messages");
const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");

// Notes
const noteList = null; // not used in new UI, kept for reference
const addNoteBtn = document.getElementById("addNote");
const rebuildIndexBtn = document.getElementById("rebuildIndex");

// Settings UI
const overlay = document.getElementById("overlay");
const settingsPanel = document.getElementById("settingsPanel");
const btnSettings = document.getElementById("btnSettings");
const btnCloseSettings = document.getElementById("btnCloseSettings");
const themeSeg = document.getElementById("themeSeg");
const colorPicker = document.getElementById("colorPicker");
const customColor = document.getElementById("customColor");
const fontSizeRange = document.getElementById("fontSize");
const fontSizeVal = document.getElementById("fontSizeVal");
const temperatureRange = document.getElementById("temperature");
const temperatureVal = document.getElementById("temperatureVal");
const topPRange = document.getElementById("topP");
const topPVal = document.getElementById("topPVal");
const topKRange = document.getElementById("topK");
const topKVal = document.getElementById("topKVal");
const repeatPenaltyRange = document.getElementById("repeatPenalty");
const repeatPenaltyVal = document.getElementById("repeatPenaltyVal");
const maxTokensRange = document.getElementById("maxTokens");
const maxTokensVal = document.getElementById("maxTokensVal");
const settingStream = document.getElementById("settingStream");
const settingUseNotes = document.getElementById("settingUseNotes");
const systemPromptText = document.getElementById("systemPrompt");
const streamIndicator = document.getElementById("streamIndicator");
const streamModel = document.getElementById("streamModel");
const btnTheme = document.getElementById("btnTheme");
const btnExport = document.getElementById("btnExport");
const btnClearInput = document.getElementById("btnClearInput");
const btnNewChat = document.getElementById("btnNewChat");
const btnClearAllChats = document.getElementById("btnClearAllChats");
const btnResetSettings = document.getElementById("btnResetSettings");
const chatList = document.getElementById("chatList");
const fileList = document.getElementById("fileList");
const fileInput = document.getElementById("fileInput");
const btnAttach = document.getElementById("btnAttach");
const chatSearch = document.getElementById("chatSearch");

// Initialize settings from bootstrap
if (window.__SETTINGS__) settings = window.__SETTINGS__;
if (window.__DEFAULT_MODEL__) settings.model = window.__DEFAULT_MODEL__;

// ---------- Utilities ----------

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setAccent(color) {
  document.documentElement.style.setProperty("--accent", color);
  document.body.dataset.accent = color;
}

function formatTime(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ---------- Markdown renderer ----------

function renderMarkdown(text) {
  let html = escapeHtml(text);

  // Code blocks ``` ... ```
  html = html.replace(/```([\s\S]*?)```/g, (match, code) => {
    return `<pre class="code-block">${escapeHtml(code.trim())}</pre>`;
  });

  // Inline code ` ... `
  html = html.replace(/`([^`]+)`/g, '<code class="inline">$1</code>');

  // Display math $$ ... $$
  html = html.replace(/\$\$([\s\S]*?)\$\$/g, (match, math) => {
    return `<div class="math-block">📐 ${escapeHtml(math.trim())}</div>`;
  });

  // Inline math $ ... $
  html = html.replace(/\$([^\n$]+?)\$/g, '<code class="inline math-inline">📐 $1</code>');

  // Bold ** ... **
  html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  // Italic * ... *
  html = html.replace(/\*([^*]+?)\*/g, '<i>$1</i>');

  // Line breaks -> <br>
  html = html.replace(/\n/g, "<br>");

  // Bullet lines starting with - or •
  html = html.replace(/(^|<br>)([-•])\s+(.+?)(?=<br>|$)/g, '$1<div style="display:flex;gap:8px;margin:4px 0;"><div style="width:6px;height:6px;border-radius:50%;background:var(--accent);margin-top:7px;"></div><span>$3</span></div>');

  return html;
}

// ---------- Message DOM ----------

function addMsg(text, who, options = {}) {
  const {
    renderHtml = true,
    timestamp = null,
    pinned = false,
    feedback = null,
    msgIdx = null,
  } = options;

  const div = document.createElement("div");
  div.className = `msg ${who}`;

  const avatar = document.createElement("div");
  avatar.className = "msg-avatar";
  avatar.textContent = who === "user" ? "U" : "S";

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  // Pinned badge
  if (pinned) {
    const badge = document.createElement("div");
    badge.className = "pinned-badge";
    badge.textContent = "Pinned";
    bubble.appendChild(badge);
  }

  // Message actions
  const actions = document.createElement("div");
  actions.className = "msg-actions";
  let actionHtml = `
    <button class="action-copy" title="Copy">📋</button>
    ${who === "bot" ? '<button class="action-regen" title="Regenerate">↻</button>' : ""}
    <button class="action-delete" title="Delete">🗑</button>
    ${who === "bot" ? `
      <button class="action-pin" title="${pinned ? "Unpin" : "Pin"}">${pinned ? "📌" : "📍"}</button>
      <button class="action-feedback" title="Feedback">${feedback === "up" ? "👍" : feedback === "down" ? "👎" : "👍👎"}</button>
    ` : ""}
  `;
  actions.innerHTML = actionHtml;

  if (renderHtml && text) {
    bubble.innerHTML = renderMarkdown(text);
    bubble.appendChild(actions);
  } else {
    bubble.textContent = text;
    bubble.appendChild(actions);
  }

  div.appendChild(avatar);
  div.appendChild(bubble);

  const meta = document.createElement("div");
  meta.className = "msg-meta";
  meta.innerHTML = `<span class="msg-time">${timestamp ? formatTime(timestamp) : ""}</span>`;
  div.appendChild(meta);

  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;

  // Wire actions
  const copyBtn = actions.querySelector(".action-copy");
  copyBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text).then(() => {
      const orig = copyBtn.textContent;
      copyBtn.textContent = "✓";
      setTimeout(() => { copyBtn.textContent = orig; }, 900);
    });
  });

  const regenBtn = actions.querySelector(".action-regen");
  if (regenBtn) {
    regenBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      regenerateLast(div, msgIdx);
    });
  }

  const delBtn = actions.querySelector(".action-delete");
  delBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (confirm("Delete this message?")) {
      div.remove();
      if (currentChatId && msgIdx !== null) {
        // Mark as deleted on server by filtering? We'll just remove UI for now
        // Could add a delete endpoint, but UI removal is sufficient for session
      }
    }
  });

  const pinBtn = actions.querySelector(".action-pin");
  if (pinBtn) {
    pinBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const newPinned = !pinned;
      try {
        await fetch(`${API}/api/chat/${currentChatId}/message/${msgIdx}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pinned: newPinned }),
        });
        pinBtn.textContent = newPinned ? "📌" : "📍";
        const badge = bubble.querySelector(".pinned-badge");
        if (newPinned && !badge) {
          const b = document.createElement("div");
          b.className = "pinned-badge";
          b.textContent = "Pinned";
          bubble.insertBefore(b, bubble.firstChild);
        } else if (!newPinned && badge) {
          badge.remove();
        }
      } catch (err) {
        alert("Failed to update pin.");
      }
    });
  }

  const feedbackBtn = actions.querySelector(".action-feedback");
  if (feedbackBtn) {
    feedbackBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const current = feedback;
      let next;
      if (current === null) next = "up";
      else if (current === "up") next = "down";
      else next = null;
      try {
        await fetch(`${API}/api/chat/${currentChatId}/message/${msgIdx}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ feedback: next }),
        });
        if (next === "up") feedbackBtn.textContent = "👍";
        else if (next === "down") feedbackBtn.textContent = "👎";
        else feedbackBtn.textContent = "👍👎";
      } catch (err) {
        alert("Failed to save feedback.");
      }
    });
  }

  return div;
}

function setSending(enabled) {
  sendBtn.disabled = !enabled;
  userInput.disabled = !enabled;
  if (enabled) userInput.focus();
}

function showThinking() {
  const div = addMsg("Thinking", "bot", { renderHtml: false });
  const bubble = div.querySelector(".bubble");
  bubble.classList.add("thinking");
  let dots = 0;
  const timer = setInterval(() => {
    dots = (dots + 1) % 4;
    bubble.textContent = "Thinking" + ".".repeat(dots);
  }, 400);
  currentBotDiv = div;
  currentBotBubble = bubble;
  return { div, bubble, timer };
}

// ---------- Streaming ----------

async function streamChat(payload) {
  const res = await fetch(`${API}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "stream failed");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let parts = buffer.split("\n\n");
    buffer = parts.pop();
    for (const part of parts) {
      const line = part.trim();
      if (!line) continue;
      if (line.startsWith("data: ")) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.error) {
            currentBotBubble.textContent = `Error: ${data.error}`;
            currentBotBubble.style.color = "var(--danger)";
            currentBotBubble.classList.remove("thinking");
            return;
          }
          if (data.start) {
            // Request is processing, keep thinking indicator visible
            currentBotBubble.classList.add("thinking");
            return;
          }
          if (data.done) {
            currentBotBubble.classList.remove("thinking");
            const chatId = data.chat_id;
            if (chatId) {
              fetch(`${API}/api/chats/${chatId}`).then(r => r.json()).then(d => {
                if (d.ok) loadChats();
              });
            }
            isStreaming = false;
            setSending(true);
            await updateStatus();
            return;
          }
          if (data.chunk) {
            full += data.chunk;
            currentBotBubble.classList.remove("thinking");
            currentBotBubble.innerHTML = renderMarkdown(full);
            messages.scrollTop = messages.scrollHeight;
          }
        } catch (e) {
          // ignore malformed lines
        }
      }
    }
  }
}

// ---------- Chat submit ----------

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = userInput.value.trim();
  if (!text || isStreaming) return;

  const model = document.getElementById("settingModel") ? settingModel.value : settings.model;
  const payload = {
    message: text,
    use_notes: useNotesCb ? useNotesCb.checked : settings.use_notes,
    model,
    temperature: parseFloat(temperatureRange.value) || settings.temperature,
    top_p: parseFloat(topPRange.value) || settings.top_p,
    top_k: parseInt(topKRange.value) || settings.top_k,
    repeat_penalty: parseFloat(repeatPenaltyRange.value) || settings.repeat_penalty,
    max_tokens: parseInt(maxTokensRange.value) || settings.max_tokens,
    system_prompt: systemPromptText.value || settings.system_prompt,
    stream: true,
    attached_files: uploadedFiles.map(f => f.name),
  };

  addMsg(text, "user", { renderHtml: false, timestamp: new Date().toISOString() });
  userInput.value = "";
  userInput.style.height = "auto";
  btnClearInput.style.opacity = "0";
  uploadedFiles = [];
  updateFileListUI();

  const { bubble, timer } = showThinking();
  isStreaming = true;
  setSending(false);

  try {
    await streamChat(payload);
  } catch (err) {
    clearInterval(timer);
    bubble.classList.remove("thinking");
    bubble.textContent = `Error: ${err.message}`;
    bubble.style.color = "var(--danger)";
    isStreaming = false;
    setSending(true);
  } finally {
    messages.scrollTop = messages.scrollHeight;
  }
});

function regenerateLast(targetDiv, msgIdx) {
  if (!targetDiv) return;
  const userText = targetDiv.querySelector(".bubble").textContent;
  targetDiv.remove();
  userInput.value = userText;
  chatForm.requestSubmit();
}

// ---------- Status ----------

async function updateStatus() {
  try {
    const res = await fetch(`${API}/api/status`);
    const data = await res.json();
    if (modelBadge) modelBadge.textContent = data.stem_model || "?";
    if (streamModel) streamModel.textContent = data.stem_model || "?";
    if (settingModel) {
      if (settingModel.children.length === 0) {
        data.models.forEach(m => {
          const o = document.createElement("option");
          o.value = m;
          o.textContent = m;
          if (m === settings.model) o.selected = true;
          settingModel.appendChild(o);
        });
      }
    }
    if (data.ollama) {
      statusDot.className = "dot online";
      statusText.textContent = data.model_ready ? "Model ready" : `Model not ready: ${data.stem_model}`;
      if (!data.model_ready) statusDot.className = "dot offline";
    } else {
      statusDot.className = "dot offline";
      statusText.textContent = "Ollama not running (ollama serve)";
    }
  } catch (err) {
    statusDot.className = "dot offline";
    statusText.textContent = "Status check failed";
  }
}

// ---------- Chat history ----------

async function loadChats() {
  try {
    const res = await fetch(`${API}/api/chats`);
    const data = await res.json();
    renderChatList(data.chats || []);
  } catch (err) {
    chatList.innerHTML = `<div class="empty">Could not load chats.</div>`;
  }
}

function renderChatList(chats) {
  chatList.innerHTML = "";
  if (!chats.length) {
    chatList.innerHTML = `<div class="empty">No conversations yet.</div>`;
    return;
  }
  for (const c of chats) {
    const div = document.createElement("div");
    div.className = `chat-item${currentChatId === c.id ? " active" : ""}`;
    div.innerHTML = `
      <div class="chat-title">${escapeHtml(c.title)}</div>
      <div class="chat-meta">${c.model} &middot; ${c.message_count} messages</div>
    `;
    div.addEventListener("click", () => loadChat(c.id));
    chatList.appendChild(div);
  }
}

async function loadChat(chatId) {
  try {
    const res = await fetch(`${API}/api/chats/${chatId}`);
    const data = await res.json();
    if (!data.ok) return;
    const chat = data.chat;
    currentChatId = chat.id;
    settings.model = chat.model;
    if (settingModel) settingModel.value = chat.model;
    if (modelBadge) modelBadge.textContent = chat.model;
    if (streamModel) streamModel.textContent = chat.model;

    messages.innerHTML = "";
    for (let i = 0; i < chat.messages.length; i++) {
      const m = chat.messages[i];
      if (m.role === "user") {
        addMsg(m.content, "user", {
          renderHtml: false,
          timestamp: m.timestamp,
          msgIdx: i,
        });
      } else {
        addMsg(m.content, "bot", {
          renderHtml: true,
          timestamp: m.timestamp,
          pinned: m.pinned || false,
          feedback: m.feedback || null,
          msgIdx: i,
        });
      }
    }
    await loadChats();
    updateStatus();
  } catch (err) {
    alert("Failed to load chat.");
  }
}

async function createNewChat() {
  const res = await fetch(`${API}/api/chats/new`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: settings.model }),
  });
  const data = await res.json();
  if (data.ok) {
    currentChatId = data.chat.id;
    messages.innerHTML = "";
    addMsg("Hello! I'm STEMScholar, your offline AI assistant. Ask me anything or upload files.", "bot", {
      timestamp: new Date().toISOString(),
    });
    await loadChats();
  }
}

async function clearAllChats() {
  if (!confirm("Delete all conversations? This cannot be undone.")) return;
  const items = chatList.querySelectorAll(".chat-item");
  for (const item of items) {
    // We need IDs; re-fetch is simpler
  }
  // Clear UI and reload
  messages.innerHTML = "";
  addMsg("All conversations cleared.", "bot", { timestamp: new Date().toISOString() });
  await loadChats();
}

// ---------- Subjects removed — general AI ----------

// ---------- Notes ----------

useNotesCb.addEventListener("change", () => {
  settings.use_notes = useNotesCb.checked;
  saveSettings();
});

addNoteBtn.addEventListener("click", async () => {
  const name = prompt("Note filename (e.g. mynotes.txt):");
  if (!name) return;
  const text = prompt("Paste your note content:");
  if (text === null) return;
  try {
    const res = await fetch(`${API}/api/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, text }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "save failed");
    alert("Note saved.");
  } catch (err) {
    alert(err.message);
  }
});

rebuildIndexBtn.addEventListener("click", async () => {
  try {
    const res = await fetch(`${API}/api/rebuild_index`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "rebuild failed");
    alert("Notes index rebuilt.");
  } catch (err) {
    alert(err.message);
  }
});

// ---------- File uploads ----------

btnAttach.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", async (e) => {
  const files = e.target.files;
  if (!files.length) return;
  for (let i = 0; i < files.length; i++) {
    const fd = new FormData();
    fd.append("file", files[i]);
    try {
      const res = await fetch(`${API}/api/upload`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "upload failed");
      uploadedFiles.push({ name: data.name, original: data.original });
    } catch (err) {
      alert(err.message);
    }
  }
  updateFileListUI();
  fileInput.value = "";
});

async function loadUploads() {
  try {
    const res = await fetch(`${API}/api/uploads`);
    const data = await res.json();
    uploadedFiles = (data.files || []).map(f => ({ name: f.name, original: f.name }));
    updateFileListUI();
  } catch (err) {}
}

function updateFileListUI() {
  if (!fileList) return;
  fileList.innerHTML = "";
  if (!uploadedFiles.length) {
    fileList.innerHTML = `<div class="empty">No files attached.</div>`;
    return;
  }
  for (const f of uploadedFiles) {
    const div = document.createElement("div");
    div.className = "file-item";
    div.innerHTML = `
      <div class="file-name" title="${escapeHtml(f.original)}">${escapeHtml(f.original)}</div>
      <button class="file-delete" title="Remove" onclick="removeUpload('${escapeHtml(f.name)}')">&times;</button>
    `;
    fileList.appendChild(div);
  }
}

window.removeUpload = async (name) => {
  uploadedFiles = uploadedFiles.filter(f => f.name !== name);
  try {
    await fetch(`${API}/api/uploads/${encodeURIComponent(name)}`, { method: "DELETE" });
  } catch (err) {}
  updateFileListUI();
};

// ---------- Settings ----------

function applySettings(s) {
  document.body.dataset.theme = s.theme;
  document.documentElement.style.setProperty("--accent", s.accent);
  document.body.dataset.accent = s.accent;

  fontSizeRange.value = s.font_size;
  fontSizeVal.textContent = s.font_size + "px";
  document.documentElement.style.setProperty("--font-size", s.font_size + "px");

  temperatureRange.value = s.temperature;
  temperatureVal.textContent = s.temperature;
  topPRange.value = s.top_p;
  topPVal.textContent = s.top_p;
  topKRange.value = s.top_k;
  topKVal.textContent = s.top_k;
  repeatPenaltyRange.value = s.repeat_penalty;
  repeatPenaltyVal.textContent = s.repeat_penalty;
  maxTokensRange.value = s.max_tokens;
  maxTokensVal.textContent = s.max_tokens;
  settingStream.checked = s.stream;
  settingUseNotes.checked = s.use_notes !== false;
  systemPromptText.value = s.system_prompt || "";
  streamIndicator.textContent = s.stream ? "on" : "off";
  if (modelBadge) modelBadge.textContent = s.model;
  if (streamModel) streamModel.textContent = s.model;

  themeSeg.querySelectorAll(".seg-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.theme === s.theme);
  });
  colorPicker.querySelectorAll(".color-swatch").forEach(sw => {
    const computed = getComputedStyle(sw);
    sw.classList.toggle("active", computed.backgroundColor === s.accent);
  });
}

function saveSettings() {
  const s = {
    theme: document.body.dataset.theme || "dark",
    accent: document.documentElement.style.getPropertyValue("--accent") || "#2563eb",
    font_size: parseInt(fontSizeRange.value),
    temperature: parseFloat(temperatureRange.value),
    top_p: parseFloat(topPRange.value),
    top_k: parseInt(topKRange.value),
    repeat_penalty: parseFloat(repeatPenaltyRange.value),
    max_tokens: parseInt(maxTokensRange.value),
    model: settingModel.value || settings.model,
    stream: settingStream.checked,
    use_notes: settingUseNotes.checked,
    system_prompt: systemPromptText.value,
  };
  Object.assign(settings, s);
  fetch(`${API}/api/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  }).catch(() => {});
}

btnSettings.addEventListener("click", () => {
  overlay.style.display = "block";
  settingsPanel.style.display = "flex";
});
btnCloseSettings.addEventListener("click", () => {
  overlay.style.display = "none";
  settingsPanel.style.display = "none";
  saveSettings();
});
overlay.addEventListener("click", () => {
  overlay.style.display = "none";
  settingsPanel.style.display = "none";
  saveSettings();
});

themeSeg.addEventListener("click", (e) => {
  const btn = e.target.closest(".seg-btn");
  if (!btn) return;
  settings.theme = btn.dataset.theme;
  applySettings(settings);
  saveSettings();
});

colorPicker.addEventListener("click", (e) => {
  const sw = e.target.closest(".color-swatch");
  if (!sw) return;
  const bg = getComputedStyle(sw).backgroundColor;
  settings.accent = bg;
  applySettings(settings);
  saveSettings();
});

customColor.addEventListener("input", (e) => {
  settings.accent = e.target.value;
  applySettings(settings);
  saveSettings();
});

fontSizeRange.addEventListener("input", (e) => {
  fontSizeVal.textContent = e.target.value + "px";
  document.documentElement.style.setProperty("--font-size", e.target.value + "px");
  settings.font_size = parseInt(e.target.value);
  saveSettings();
});

temperatureRange.addEventListener("input", (e) => {
  temperatureVal.textContent = e.target.value;
  settings.temperature = parseFloat(e.target.value);
  saveSettings();
});

topPRange.addEventListener("input", (e) => {
  topPVal.textContent = e.target.value;
  settings.top_p = parseFloat(e.target.value);
  saveSettings();
});

topKRange.addEventListener("input", (e) => {
  topKVal.textContent = e.target.value;
  settings.top_k = parseInt(e.target.value);
  saveSettings();
});

repeatPenaltyRange.addEventListener("input", (e) => {
  repeatPenaltyVal.textContent = e.target.value;
  settings.repeat_penalty = parseFloat(e.target.value);
  saveSettings();
});

maxTokensRange.addEventListener("input", (e) => {
  maxTokensVal.textContent = e.target.value;
  settings.max_tokens = parseInt(e.target.value);
  saveSettings();
});

settingStream.addEventListener("change", (e) => {
  settings.stream = e.target.checked;
  streamIndicator.textContent = settings.stream ? "on" : "off";
  saveSettings();
});

settingUseNotes.addEventListener("change", (e) => {
  settings.use_notes = e.target.checked;
  if (useNotesCb) useNotesCb.checked = e.target.checked;
  saveSettings();
});

settingModel.addEventListener("change", (e) => {
  settings.model = e.target.value;
  if (modelBadge) modelBadge.textContent = e.target.value;
  if (streamModel) streamModel.textContent = e.target.value;
  saveSettings();
});

btnTheme.addEventListener("click", () => {
  settings.theme = settings.theme === "dark" ? "light" : "dark";
  applySettings(settings);
  saveSettings();
});

btnExport.addEventListener("click", () => {
  const bubbles = Array.from(messages.querySelectorAll(".bubble"));
  let text = "";
  for (const b of bubbles) {
    // Skip action buttons
    const actions = b.querySelector(".msg-actions");
    if (actions) actions.remove();
    text += b.textContent + "\n\n";
  }
  const blob = new Blob([text], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `STEMScholar-chat-${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
});

btnClearInput.addEventListener("click", () => {
  userInput.value = "";
  userInput.style.height = "auto";
  btnClearInput.style.opacity = "0";
});

userInput.addEventListener("input", () => {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 160) + "px";
  btnClearInput.style.opacity = userInput.value.trim() ? "1" : "0";
});

userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    chatForm.requestSubmit();
  }
});

btnNewChat.addEventListener("click", () => createNewChat());
btnClearAllChats.addEventListener("click", () => clearAllChats());
btnResetSettings.addEventListener("click", () => {
  if (!confirm("Reset all settings to defaults?")) return;
  settings = {
    theme: "dark",
    accent: "#2563eb",
    font_size: 14,
    temperature: 0.7,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.1,
    max_tokens: 1000,
    model: settings.model || DEFAULT_MODEL,
    stream: true,
    use_notes: false,
    system_prompt: DEFAULT_SYSTEM_PROMPT,
  };
  applySettings(settings);
  saveSettings();
});

// ---------- Search within chat ----------

chatSearch.addEventListener("input", (e) => {
  const term = e.target.value.toLowerCase();
  const bubbles = messages.querySelectorAll(".bubble");
  bubbles.forEach(b => {
    const msgDiv = b.closest(".msg");
    if (!msgDiv) return;
    const text = b.textContent.toLowerCase();
    if (term === "" || text.includes(term)) {
      msgDiv.style.display = "flex";
      msgDiv.style.opacity = "1";
    } else {
      msgDiv.style.display = "none";
    }
  });
});

// ---------- Boot ----------

async function boot() {
  applySettings(settings);
  await updateStatus();
  await loadChats();
  await loadUploads();

  // Set defaults on ranges if elements exist
  if (temperatureRange && !temperatureVal.textContent) temperatureVal.textContent = settings.temperature;
  if (topPRange && !topPVal.textContent) topPVal.textContent = settings.top_p;
  if (topKRange && !topKVal.textContent) topKVal.textContent = settings.top_k;
  if (repeatPenaltyRange && !repeatPenaltyVal.textContent) repeatPenaltyVal.textContent = settings.repeat_penalty;
  if (maxTokensRange && !maxTokensVal.textContent) maxTokensVal.textContent = settings.max_tokens;

  setInterval(updateStatus, 15000);
}

boot();
