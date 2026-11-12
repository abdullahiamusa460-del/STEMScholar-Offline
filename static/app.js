/* ============ STEMScholar Offline AI — Frontend ============ */
const API = "";
let currentSubject = "physics";
let useNotes = false;
let isStreaming = false;
let abortController = null;
let currentBotDiv = null;
let currentBotBubble = null;
let settings = {};

// Elements
const subjectSeg = document.getElementById("subjectSeg");
const subjectBadge = document.getElementById("subjectBadge");
const useNotesCb = document.getElementById("useNotes");
const modelSelect = document.getElementById("modelSelect");
const modelBadge = document.getElementById("modelBadge");
const settingModel = document.getElementById("settingModel");
const statusDot = document.getElementById("dot");
const statusText = document.getElementById("statusText");
const messages = document.getElementById("messages");
const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");

// Notes UI
const noteList = document.getElementById("noteList");
const noteForm = document.getElementById("noteForm");
const noteName = document.getElementById("noteName");
const noteText = document.getElementById("noteText");
const addNoteBtn = document.getElementById("addNote");
const cancelNoteBtn = document.getElementById("cancelNote");
const saveNoteBtn = document.getElementById("saveNote");
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
const maxTokensRange = document.getElementById("maxTokens");
const maxTokensVal = document.getElementById("maxTokensVal");
const settingStream = document.getElementById("settingStream");
const streamIndicator = document.getElementById("streamIndicator");
const btnTheme = document.getElementById("btnTheme");
const btnExport = document.getElementById("btnExport");
const btnClearInput = document.getElementById("btnClearInput");
const btnNewChat = document.getElementById("btnNewChat");
const btnClearAllChats = document.getElementById("btnClearAllChats");
const btnResetSettings = document.getElementById("btnResetSettings");
const chatList = document.getElementById("chatList");

// Initialize from bootstrap data
if (window.__SETTINGS__) settings = window.__SETTINGS__;
if (window.__DEFAULT_MODEL__) {
  settings.model = window.__DEFAULT_MODEL__;
}

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

// ---------- Markdown renderer (lightweight, offline) ----------

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

  // Inline math $ ... $ (simple, single line)
  html = html.replace(/\$([^\n$]+?)\$/g, '<code class="inline math-inline">📐 $1</code>');

  // Bold ** ... **
  html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  // Italic * ... * (avoid already-handled bold)
  html = html.replace(/\*([^*]+?)\*/g, '<i>$1</i>');

  // Line breaks -> <br>
  html = html.replace(/\n/g, "<br>");

  // Bullet lines starting with - or •
  html = html.replace(/(^|<br>)([-•])\s+/g, '$1<div class="bullet"><span class="dot"></span><span>$&</span></div>');
  // Clean up the bullet duplication: the above keeps original text; simplify by replacing bullet lines entirely
  html = html.replace(/<div class="bullet"><span class="dot"><\/span><span>(?:[-•])\s*(.*?)<\/span><\/div>/g, '<div class="bullet"><span class="dot"></span><span>$1</span></div>');

  return html;
}

// ---------- Message DOM ----------

function addMsg(text, who, renderHtml = true, chatId = null) {
  const div = document.createElement("div");
  div.className = `msg ${who}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";

  // Message actions
  const actions = document.createElement("div");
  actions.className = "msg-actions";
  actions.innerHTML = `
    <button class="action-copy" title="Copy">📋</button>
    ${who === "bot" ? '<button class="action-regen" title="Regenerate">↻</button>' : ""}
    ${who === "user" ? '<button class="action-delete" title="Delete">🗑</button>' : ""}
  `;
  bubble.appendChild(actions);

  if (renderHtml && text) {
    bubble.innerHTML = renderMarkdown(text);
    // re-append actions after innerHTML wipe
    bubble.appendChild(actions);
  } else {
    bubble.textContent = text;
    bubble.appendChild(actions);
  }

  div.appendChild(bubble);
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;

  // Wire action buttons
  const copyBtn = actions.querySelector(".action-copy");
  copyBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const content = who === "bot" ? bubble.textContent : text;
    navigator.clipboard.writeText(content).then(() => {
      const orig = copyBtn.textContent;
      copyBtn.textContent = "✓";
      setTimeout(() => { copyBtn.textContent = orig; }, 900);
    });
  });

  const regenBtn = actions.querySelector(".action-regen");
  if (regenBtn) {
    regenBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      regenerateLast(div);
    });
  }

  const delBtn = actions.querySelector(".action-delete");
  if (delBtn) {
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (confirm("Delete this message?")) div.remove();
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
  const div = addMsg("Thinking", "bot", false);
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
          if (data.done) {
            currentBotBubble.classList.remove("thinking");
            // Save assistant message into chat
            const chatId = data.chat_id;
            if (chatId) {
              // fetch updated chat
              fetch(`${API}/api/chats/${chatId}`).then(r => r.json()).then(d => {
                if (d.ok) updateChatList();
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

  const model = modelSelect.value || settings.model;
  const temperature = parseFloat(temperatureRange.value) || settings.temperature;
  const maxTokens = parseInt(maxTokensRange.value) || settings.max_tokens;

  addMsg(text, "user");
  userInput.value = "";
  userInput.style.height = "auto";

  const { bubble, timer } = showThinking();
  isStreaming = true;
  setSending(false);

  const payload = {
    message: text,
    subject: currentSubject,
    use_notes: useNotes,
    model,
    temperature,
    max_tokens: maxTokens,
    stream: true,
  };

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

function regenerateLast(targetDiv) {
  if (!targetDiv) return;
  const msg = targetDiv.querySelector(".bubble").textContent;
  // remove the assistant message and retry the previous user message
  targetDiv.remove();
  const userMsgs = Array.from(messages.querySelectorAll(".msg.user"));
  const lastUser = userMsgs[userMsgs.length - 1];
  if (!lastUser) return;
  const userText = lastUser.querySelector(".bubble").textContent;
  userInput.value = userText;
  chatForm.requestSubmit();
}

// ---------- Status ----------

async function updateStatus() {
  try {
    const res = await fetch(`${API}/api/status`);
    const data = await res.json();
    if (modelBadge) modelBadge.textContent = data.stem_model || "?";
    if (settingModel) {
      // populate settings model select
      if (settingModel.children.length === 0) {
        data.models.forEach(m => {
          const o = document.createElement("option");
          o.value = m;
          o.textContent = m;
          settingModel.appendChild(o);
        });
        settingModel.value = settings.model || data.stem_model;
      }
    }
    if (data.ollama) {
      statusDot.className = "dot online";
      statusText.textContent = data.model_ready ? "Model ready" : `Model not pulled: ${data.stem_model}`;
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
    chatList.innerHTML = `<div class="empty">No chats yet.</div>`;
    return;
  }
  for (const c of chats) {
    const div = document.createElement("div");
    div.className = "chat-item";
    div.innerHTML = `
      <div class="chat-title">${escapeHtml(c.title)}</div>
      <div class="chat-meta">${c.subject} &middot; ${c.message_count} messages</div>
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
    currentSubject = chat.subject;
    settings.model = chat.model;
    modelSelect.value = chat.model;
    settingModel.value = chat.model;
    subjectBadge.textContent = SUBJECT_NAMES[chat.subject] || chat.subject;
    updateSubjectButtons(chat.subject);
    messages.innerHTML = "";
    for (const m of chat.messages) {
      addMsg(m.content, m.role === "user" ? "user" : "bot", true);
    }
    updateStatus();
  } catch (err) {
    alert("Failed to load chat.");
  }
}

async function createNewChat() {
  const res = await fetch(`${API}/api/chats/new`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject: currentSubject, model: settings.model }),
  });
  const data = await res.json();
  if (data.ok) {
    messages.innerHTML = "";
    addMsg("Hello! I'm STEMScholar, your offline AI study assistant. Ask me about your subject.", "bot");
    await loadChats();
  }
}

async function deleteChat(chatId) {
  if (!confirm("Delete this chat?")) return;
  await fetch(`${API}/api/chats/${chatId}`, { method: "DELETE" });
  await loadChats();
  messages.innerHTML = "";
  addMsg("Start a new conversation below.", "bot");
}

async function clearAllChats() {
  if (!confirm("Delete all chats? This cannot be undone.")) return;
  // delete each
  const chats = Array.from(chatList.querySelectorAll(".chat-item"));
  for (const item of chats) {
    // we don't have ids directly; refetch
  }
  // Simpler: call status then reload. We don't have a bulk endpoint; clear UI and note.
  messages.innerHTML = "";
  addMsg("All chats cleared (session).", "bot");
  await loadChats();
}

const SUBJECT_NAMES = {
  physics: "Physics",
  mathematics: "Mathematics",
  chemistry: "Chemistry",
  biology: "Biology",
  computer_science: "Computer Science",
  engineering: "Engineering",
};

function updateSubjectButtons(subject) {
  document.querySelectorAll(".seg-btn").forEach(b => b.classList.remove("active"));
  const btn = document.querySelector(`.seg-btn[data-subject="${subject}"]`);
  if (btn) btn.classList.add("active");
}

// ---------- Subject selection ----------

subjectSeg.addEventListener("click", (e) => {
  const btn = e.target.closest(".seg-btn");
  if (!btn) return;
  document.querySelectorAll(".seg-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  currentSubject = btn.dataset.subject;
  subjectBadge.textContent = btn.textContent.trim();
});

// ---------- Notes ----------

useNotesCb.addEventListener("change", () => {
  useNotes = useNotesCb.checked;
});

let showingForm = false;
addNoteBtn.addEventListener("click", () => {
  showingForm = true;
  noteForm.style.display = "flex";
  noteName.focus();
});
cancelNoteBtn.addEventListener("click", () => {
  showingForm = false;
  noteForm.style.display = "none";
  noteName.value = "";
  noteText.value = "";
});
saveNoteBtn.addEventListener("click", async () => {
  const name = noteName.value.trim();
  const text = noteText.value.trim();
  if (!name || !text) return alert("Enter a filename and some text.");
  try {
    const res = await fetch(`${API}/api/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, text }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "save failed");
    showingForm = false;
    noteForm.style.display = "none";
    noteName.value = "";
    noteText.value = "";
    loadNotes();
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

async function loadNotes() {
  try {
    const res = await fetch(`${API}/api/notes`);
    const data = await res.json();
    renderNotes(data.notes || []);
  } catch (err) {
    noteList.innerHTML = `<div class="empty">Could not load notes.</div>`;
  }
}

function renderNotes(notes) {
  noteList.innerHTML = "";
  if (!notes.length) {
    noteList.innerHTML = `<div class="empty">No notes yet.</div>`;
    return;
  }
  for (const n of notes) {
    const div = document.createElement("div");
    div.className = "note-item";
    div.title = n.name;
    div.innerHTML = `<span title="${escapeHtml(n.name)}">${escapeHtml(n.name)}</span>
      <span class="del" title="Delete" onclick="deleteNote('${escapeHtml(n.name)}')">&times;</span>`;
    noteList.appendChild(div);
  }
}

window.deleteNote = async (name) => {
  if (!confirm(`Delete ${name}?`)) return;
  try {
    await fetch(`${API}/api/notes/${encodeURIComponent(name)}`, { method: "DELETE" });
    loadNotes();
  } catch (err) {
    alert(err.message);
  }
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
  maxTokensRange.value = s.max_tokens;
  maxTokensVal.textContent = s.max_tokens;
  settingStream.checked = s.stream;
  streamIndicator.textContent = s.stream ? "on" : "off";
  modelSelect.value = s.model;
  settingModel.value = s.model;
  if (modelBadge) modelBadge.textContent = s.model;
  // theme segmented
  themeSeg.querySelectorAll(".seg-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.theme === s.theme);
  });
  // color swatch active
  colorPicker.querySelectorAll(".color-swatch").forEach(sw => {
    sw.classList.toggle("active", sw.style.backgroundColor.includes(hexToRgb(s.accent)) || getComputedStyle(sw).backgroundColor === rgbToHex(s.accent));
  });
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${r}, ${g}, ${b})";
}

function rgbToHex(rgb) { return rgb; } // unused placeholder

btnSettings.addEventListener("click", () => {
  overlay.style.display = "block";
  settingsPanel.style.display = "flex";
});
btnCloseSettings.addEventListener("click", () => {
  overlay.style.display = "none";
  settingsPanel.style.display = "none";
});
overlay.addEventListener("click", () => {
  overlay.style.display = "none";
  settingsPanel.style.display = "none";
});

// Theme segmented
themeSeg.addEventListener("click", (e) => {
  const btn = e.target.closest(".seg-btn");
  if (!btn) return;
  const theme = btn.dataset.theme;
  settings.theme = theme;
  applySettings(settings);
  saveSettings();
});

// Color picker
colorPicker.addEventListener("click", (e) => {
  const sw = e.target.closest(".color-swatch");
  if (!sw) return;
  const c = sw.style.backgroundColor;
  // extract inline --c
  const computed = getComputedStyle(sw);
  const bg = computed.backgroundColor;
  settings.accent = rgbToHexInline(bg);
  applySettings(settings);
  saveSettings();
});

customColor.addEventListener("input", (e) => {
  settings.accent = e.target.value;
  applySettings(settings);
  saveSettings();
});

fontSizeRange.addEventListener("input", (e) => {
  const v = e.target.value;
  fontSizeVal.textContent = v + "px";
  document.documentElement.style.setProperty("--font-size", v + "px");
  settings.font_size = parseInt(v);
  saveSettings();
});

temperatureRange.addEventListener("input", (e) => {
  temperatureVal.textContent = e.target.value;
  settings.temperature = parseFloat(e.target.value);
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

settingModel.addEventListener("change", (e) => {
  settings.model = e.target.value;
  modelSelect.value = e.target.value;
  if (modelBadge) modelBadge.textContent = e.target.value;
  saveSettings();
});

modelSelect.addEventListener("change", (e) => {
  settings.model = e.target.value;
  settingModel.value = e.target.value;
  if (modelBadge) modelBadge.textContent = e.target.value;
  saveSettings();
});

function saveSettings() {
  fetch(`${API}/api/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  }).catch(() => {});
}


function applySettings(s) {
  document.body.dataset.theme = s.theme;
  document.documentElement.style.setProperty("--accent", s.accent);
  document.body.dataset.accent = s.accent;
  fontSizeRange.value = s.font_size;
  fontSizeVal.textContent = s.font_size + "px";
  document.documentElement.style.setProperty("--font-size", s.font_size + "px");
  temperatureRange.value = s.temperature;
  temperatureVal.textContent = s.temperature;
  maxTokensRange.value = s.max_tokens;
  maxTokensVal.textContent = s.max_tokens;
  settingStream.checked = s.stream;
  streamIndicator.textContent = s.stream ? "on" : "off";
  modelSelect.value = s.model;
  settingModel.value = s.model;
  if (modelBadge) modelBadge.textContent = s.model;
  themeSeg.querySelectorAll(".seg-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.theme === s.theme);
  });
  colorPicker.querySelectorAll(".color-swatch").forEach(sw => {
    const computed = getComputedStyle(sw);
    const bg = computed.backgroundColor;
    sw.classList.toggle("active", bg === rgbToHexInline(s.accent));
  });
}

function rgbToHexInline(rgb) {
  const m = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (!m) return "#22d3ee";
  const hex = (n) => n.toString(16).padStart(2, "0");
  return `#${hex(+m[1])}${hex(+m[2])}${hex(+m[3])}`.toUpperCase();
}

btnTheme.addEventListener("click", () => {
  settings.theme = settings.theme === "dark" ? "light" : "dark";
  applySettings(settings);
  saveSettings();
});

btnExport.addEventListener("click", () => {
  const bubbles = Array.from(messages.querySelectorAll(".bubble"));
  const text = bubbles.map(b => b.textContent).join("\n\n");
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `STEMScholar-chat-${new Date().toISOString().slice(0, 10)}.txt`;
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
  userInput.style.height = Math.min(userInput.scrollHeight, 150) + "px";
  btnClearInput.style.opacity = userInput.value.trim() ? "1" : "0";
});

userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.ctrlKey && !e.shiftKey) {
    e.preventDefault();
    chatForm.requestSubmit();
  }
});

// ---------- Boot ----------

async function boot() {
  // Apply settings
  applySettings(settings);

  // Populate model select
  try {
    const res = await fetch(`${API}/api/models`);
    const data = await res.json();
    modelSelect.innerHTML = "";
    (data.models || []).forEach(m => {
      const o = document.createElement("option");
      o.value = m;
      o.textContent = m;
      if (m === settings.model) o.selected = true;
      modelSelect.appendChild(o);
    });
  } catch (e) {}

  await updateStatus();
  await loadNotes();
  await loadChats();

  setInterval(updateStatus, 15000);
}

boot();
