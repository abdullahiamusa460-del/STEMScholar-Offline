const API = "";
let currentSubject = "physics";
let useNotes = false;

const subjectSeg = document.getElementById("subjectSeg");
const subjectBadge = document.getElementById("subjectBadge");
const useNotesCb = document.getElementById("useNotes");
const modelDisplay = document.getElementById("modelDisplay");
const statusDot = document.getElementById("dot");
const statusText = document.getElementById("statusText");
const messages = document.getElementById("messages");
const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");

// Subject selection
subjectSeg.addEventListener("click", (e) => {
  const btn = e.target.closest(".seg-btn");
  if (!btn) return;
  document.querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  currentSubject = btn.dataset.subject;
  subjectBadge.textContent = btn.textContent.trim();
});

useNotesCb.addEventListener("change", () => {
  useNotes = useNotesCb.checked;
});

// Notes UI
const noteList = document.getElementById("noteList");
const noteForm = document.getElementById("noteForm");
const noteName = document.getElementById("noteName");
const noteText = document.getElementById("noteText");
const addNoteBtn = document.getElementById("addNote");
const cancelNoteBtn = document.getElementById("cancelNote");
const saveNoteBtn = document.getElementById("saveNote");
const rebuildIndexBtn = document.getElementById("rebuildIndex");

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

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Strip markdown artifacts (**, $$, $, *) from model replies
function cleanMarkdown(text) {
  return String(text)
    .replace(/\$\$/g, "")
    .replace(/\$/g, "")
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .trim();
}

// Chat
function addMsg(text, who) {
  const div = document.createElement("div");
  div.className = `msg ${who}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  div.appendChild(bubble);
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return div;
}

function setSending(enabled) {
  sendBtn.disabled = !enabled;
  userInput.disabled = !enabled;
  if (enabled) userInput.focus();
}

async function updateStatus() {
  try {
    const res = await fetch(`${API}/api/status`);
    const data = await res.json();
    modelDisplay.textContent = data.stem_model || "?";
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

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = userInput.value.trim();
  if (!text) return;
  addMsg(text, "user");
  userInput.value = "";
  userInput.style.height = "auto";
  setSending(false);

  const botDiv = addMsg("Thinking", "bot");
  const bubble = botDiv.querySelector(".bubble");
  bubble.classList.add("thinking");

  // Animated thinking dots
  let dots = 0;
  const thinkingTimer = setInterval(() => {
    dots = (dots + 1) % 4;
    bubble.textContent = "Thinking" + ".".repeat(dots);
  }, 400);

  try {
    const res = await fetch(`${API}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, subject: currentSubject, use_notes: useNotes }),
    });
    const data = await res.json();
    clearInterval(thinkingTimer);
    bubble.classList.remove("thinking");
    if (!res.ok) throw new Error(data.error || "chat failed");
    bubble.textContent = cleanMarkdown(data.reply || "(no reply)");
    bubble.style.color = "";
  } catch (err) {
    clearInterval(thinkingTimer);
    bubble.classList.remove("thinking");
    bubble.textContent = `Error: ${err.message}`;
    bubble.style.color = "#ef4444";
  } finally {
    messages.scrollTop = messages.scrollHeight;
    setSending(true);
    await updateStatus();
  }
});

// Auto-resize textarea
userInput.addEventListener("input", () => {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 140) + "px";
});

// Ctrl+Enter to send
userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.ctrlKey && !e.shiftKey) {
    e.preventDefault();
    chatForm.requestSubmit();
  }
});

// Boot
updateStatus();
loadNotes();
setInterval(updateStatus, 15000);
