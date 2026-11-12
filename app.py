import os
import json
import math
import uuid
import datetime
import time
from pathlib import Path
from flask import Flask, render_template, request, jsonify, send_from_directory
import requests

BASE_DIR = Path(__file__).resolve().parent
NOTES_DIR = BASE_DIR / "notes"
INDEX_FILE = BASE_DIR / "notes_index.json"
CHATS_DIR = BASE_DIR / "chats"
SETTINGS_FILE = BASE_DIR / "user_settings.json"
UPLOADS_DIR = BASE_DIR / "uploads"

# Load .env manually
def load_env(path):
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())

load_env(BASE_DIR / ".env")

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
DEFAULT_MODEL = os.environ.get("STEM_MODEL", "gemma4:e2b-it-qat")
EMBED_MODEL = os.environ.get("STEM_EMBED_MODEL", "snowflake-arctic-embed:33m")

# Default system prompt — general AI assistant (no subject restriction)
DEFAULT_SYSTEM_PROMPT = (
    "You are STEMScholar, a helpful, knowledgeable offline AI assistant. "
    "You can answer questions on any topic — science, mathematics, programming, "
    "writing, analysis, and general knowledge. Provide clear, accurate, and "
    "well-structured responses. Use step-by-step explanations when helpful. "
    "You run entirely offline on the user's computer. "
    "Answer directly and concisely. Do not show your internal reasoning or thinking process."
)

app = Flask(__name__)
NOTES_DIR.mkdir(exist_ok=True)
CHATS_DIR.mkdir(exist_ok=True)
UPLOADS_DIR.mkdir(exist_ok=True)


# ---------- Settings ----------

def default_settings():
    return {
        "theme": "dark",
        "accent": "#2563eb",
        "font_size": 14,
        "temperature": 0.7,
        "top_p": 0.9,
        "top_k": 40,
        "repeat_penalty": 1.1,
        "max_tokens": 1000,
        "model": DEFAULT_MODEL,
        "system_prompt": DEFAULT_SYSTEM_PROMPT,
        "stream": True,
    }


def load_settings():
    if SETTINGS_FILE.exists():
        try:
            s = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
            d = default_settings()
            for k, v in d.items():
                s.setdefault(k, v)
            return s
        except Exception:
            pass
    return default_settings()


def save_settings(settings):
    SETTINGS_FILE.write_text(json.dumps(settings, indent=2), encoding="utf-8")


# ---------- Ollama helpers ----------

def _extract_text(msg):
    """Extract only the answer content from an Ollama message.
    
    Reasoning models like gemma4 put their internal thinking process in a
    separate 'thinking' field. We hide that from the user and only show
    the final 'content' answer.
    """
    content = msg.get("content", "") or ""
    return content


def ollama_chat(model, messages, temperature=0.7, top_p=0.9, top_k=40,
                repeat_penalty=1.1, max_tokens=1000, stream=False):
    url = f"{OLLAMA_HOST}/api/chat"
    payload = {
        "model": model,
        "messages": messages,
        "stream": stream,
        "options": {
            "temperature": temperature,
            "top_p": top_p,
            "top_k": top_k,
            "repeat_penalty": repeat_penalty,
            "num_predict": max_tokens,
        },
    }
    r = requests.post(url, json=payload, stream=stream, timeout=600)
    r.raise_for_status()
    return r


def ollama_chat_stream(model, messages, temperature=0.7, top_p=0.9, top_k=40,
                       repeat_penalty=1.1, max_tokens=1000):
    url = f"{OLLAMA_HOST}/api/chat"
    payload = {
        "model": model,
        "messages": messages,
        "stream": True,
        "options": {
            "temperature": temperature,
            "top_p": top_p,
            "top_k": top_k,
            "repeat_penalty": repeat_penalty,
            "num_predict": max_tokens,
        },
    }
    r = requests.post(url, json=payload, stream=True, timeout=600)
    r.raise_for_status()
    for line in r.iter_lines(decode_unicode=True):
        if not line:
            continue
        try:
            data = json.loads(line)
        except json.JSONDecodeError:
            continue
        msg = data.get("message", {})
        text = _extract_text(msg)
        if text:
            yield text
        if data.get("done"):
            break


def ollama_embed(model, text):
    url = f"{OLLAMA_HOST}/api/embeddings"
    payload = {"model": model, "prompt": text}
    r = requests.post(url, json=payload, timeout=180)
    r.raise_for_status()
    return r.json()["embedding"]


def cosine_sim(a, b):
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a, b):
        dot += x * y
        na += x * x
        nb += y * y
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (math.sqrt(na) * math.sqrt(nb))


def chunk_text(text, size=500, overlap=80):
    text = text.strip()
    if not text:
        return []
    chunks = []
    start = 0
    n = len(text)
    while start < n:
        end = min(start + size, n)
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= n:
            break
        start = end - overlap
        if start < 0:
            start = 0
    return chunks


# ---------- Notes ----------

def load_notes():
    notes = {}
    if NOTES_DIR.exists():
        for f in sorted(NOTES_DIR.glob("*.txt")):
            notes[f.name] = f.read_text(encoding="utf-8")
    return notes


def notes_changed(index):
    notes = load_notes()
    if set(notes.keys()) != set(index.keys()):
        return True
    for name, text in notes.items():
        entry = index.get(name)
        if not entry or entry.get("text") != text:
            return True
    return False


def build_index():
    notes = load_notes()
    index = {}
    for name, text in notes.items():
        chunks = chunk_text(text)
        embeddings = []
        for ch in chunks:
            emb = ollama_embed(EMBED_MODEL, ch)
            embeddings.append(emb)
        index[name] = {"text": text, "chunks": chunks, "embeddings": embeddings}
    with open(INDEX_FILE, "w", encoding="utf-8") as f:
        json.dump(index, f)
    return index


def get_index():
    if INDEX_FILE.exists():
        try:
            with open(INDEX_FILE, "r", encoding="utf-8") as f:
                index = json.load(f)
            if not notes_changed(index):
                return index
        except Exception:
            pass
    return build_index()


def search_notes(query, top_k=4):
    if not load_notes():
        return []
    index = get_index()
    q_emb = ollama_embed(EMBED_MODEL, query)
    results = []
    for name, entry in index.items():
        for i, ch in enumerate(entry["chunks"]):
            sim = cosine_sim(q_emb, entry["embeddings"][i])
            results.append((sim, name, ch))
    results.sort(key=lambda x: x[0], reverse=True)
    return results[:top_k]


# ---------- Chat session helpers ----------

def chat_path(chat_id):
    return CHATS_DIR / f"{chat_id}.json"


def list_chats():
    chats = []
    if CHATS_DIR.exists():
        for f in sorted(CHATS_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                chats.append({
                    "id": data.get("id", f.stem),
                    "title": data.get("title", "New chat"),
                    "model": data.get("model", DEFAULT_MODEL),
                    "updated_at": data.get("updated_at", ""),
                    "message_count": len(data.get("messages", [])),
                })
            except Exception:
                continue
    return chats


def load_chat(chat_id):
    p = chat_path(chat_id)
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return None


def save_chat(chat):
    chat["updated_at"] = chat.get("updated_at") or datetime.datetime.utcnow().isoformat()
    if not chat.get("id"):
        chat["id"] = str(uuid.uuid4())
    if not chat.get("title"):
        chat["title"] = "New chat"
    chat_path(chat["id"]).write_text(json.dumps(chat, indent=2), encoding="utf-8")
    return chat


def new_chat(model=DEFAULT_MODEL, title=None):
    now = datetime.datetime.utcnow().isoformat()
    chat = {
        "id": str(uuid.uuid4()),
        "title": title or "New chat",
        "model": model,
        "created_at": now,
        "updated_at": now,
        "messages": [],
    }
    save_chat(chat)
    return chat


def auto_title_from_message(message):
    """Generate a short chat title from the first user message."""
    words = message.strip().split()
    if len(words) <= 6:
        return message.strip()
    return " ".join(words[:6]) + "…"


# ---------- Routes ----------

@app.route("/")
def home():
    settings = load_settings()
    return render_template(
        "index.html",
        model=settings.get("model", DEFAULT_MODEL),
        settings=settings,
    )


@app.route("/api/status")
def status():
    settings = load_settings()
    try:
        r = requests.get(f"{OLLAMA_HOST}/api/tags", timeout=10)
        models = [m.get("name", "") for m in r.json().get("models", [])]
        stem_model = settings.get("model", DEFAULT_MODEL)
        return jsonify({
            "ollama": True,
            "models": models,
            "stem_model": stem_model,
            "model_ready": stem_model in models,
        })
    except Exception:
        return jsonify({
            "ollama": False,
            "models": [],
            "stem_model": settings.get("model", DEFAULT_MODEL),
            "model_ready": False,
        })


@app.route("/api/models")
def api_models():
    try:
        r = requests.get(f"{OLLAMA_HOST}/api/tags", timeout=10)
        models = [m.get("name", "") for m in r.json().get("models", [])]
        return jsonify({"models": models})
    except Exception as e:
        return jsonify({"models": [], "error": str(e)}), 502


@app.route("/api/settings", methods=["GET", "POST"])
def api_settings():
    if request.method == "POST":
        data = request.get_json(force=True) or {}
        settings = load_settings()
        settings.update(data)
        save_settings(settings)
        return jsonify({"ok": True, "settings": settings})
    return jsonify(load_settings())


@app.route("/api/chats", methods=["GET"])
def api_chats():
    return jsonify({"chats": list_chats()})


@app.route("/api/chats/new", methods=["POST"])
def api_new_chat():
    data = request.get_json(force=True) or {}
    model = data.get("model", load_settings().get("model", DEFAULT_MODEL))
    title = data.get("title") or "New chat"
    chat = new_chat(model=model, title=title)
    return jsonify({"ok": True, "chat": chat})


@app.route("/api/chats/<chat_id>", methods=["GET", "DELETE", "PUT"])
def api_chat_detail(chat_id):
    if request.method == "DELETE":
        p = chat_path(chat_id)
        if p.exists():
            p.unlink()
        return jsonify({"ok": True})
    if request.method == "PUT":
        data = request.get_json(force=True) or {}
        chat = load_chat(chat_id)
        if not chat:
            return jsonify({"error": "not found"}), 404
        if "title" in data:
            chat["title"] = data["title"]
        if "model" in data:
            chat["model"] = data["model"]
        save_chat(chat)
        return jsonify({"ok": True, "chat": chat})
    chat = load_chat(chat_id)
    if not chat:
        return jsonify({"error": "not found"}), 404
    return jsonify({"ok": True, "chat": chat})


@app.route("/api/chat", methods=["POST"])
def api_chat():
    data = request.get_json(force=True) or {}
    message = (data.get("message") or "").strip()
    use_notes = bool(data.get("use_notes"))
    model = data.get("model") or load_settings().get("model", DEFAULT_MODEL)
    temperature = float(data.get("temperature", load_settings().get("temperature", 0.7)))
    top_p = float(data.get("top_p", load_settings().get("top_p", 0.9)))
    top_k = int(data.get("top_k", load_settings().get("top_k", 40)))
    repeat_penalty = float(data.get("repeat_penalty", load_settings().get("repeat_penalty", 1.1)))
    max_tokens = int(data.get("max_tokens", load_settings().get("max_tokens", 1000)))
    system_prompt = data.get("system_prompt") or load_settings().get("system_prompt", DEFAULT_SYSTEM_PROMPT)
    chat_id = data.get("chat_id")
    stream = bool(data.get("stream", load_settings().get("stream", True)))
    attached_files = data.get("attached_files", [])

    if not message:
        return jsonify({"error": "empty message"}), 400

    if chat_id:
        chat = load_chat(chat_id)
        if not chat:
            chat = new_chat(model=model)
    else:
        chat = new_chat(model=model)
        chat_id = chat["id"]

    # Auto-title from first user message
    if len(chat.get("messages", [])) == 0 and not chat.get("title_auto"):
        chat["title"] = auto_title_from_message(message)
        chat["title_auto"] = True

    user_msg = {"role": "user", "content": message, "timestamp": datetime.datetime.utcnow().isoformat()}
    chat["messages"].append(user_msg)

    # Build context from notes
    context = ""
    if use_notes:
        try:
            hits = search_notes(message)
            if hits:
                parts = [f"[from {name}] {ch}" for sim, name, ch in hits]
                context = "\n\n".join(parts)
        except Exception as e:
            context = f"(notes search unavailable: {e})"

    user_content = message
    if context:
        user_content = (
            "Relevant notes from your files:\n"
            f"{context}\n\n---\n\nQuestion: {message}"
        )

    # Append attached file contents
    for fpath in attached_files:
        try:
            p = UPLOADS_DIR / fpath
            if p.exists():
                file_text = p.read_text(encoding="utf-8")
                user_content += f"\n\n[Attached file: {fpath}]\n{file_text[:4000]}"
        except Exception:
            pass

    # Prepend system instructions to user message instead of using system role,
    # because gemma4 puts everything in 'thinking' when system role is used,
    # leaving 'content' empty. This ensures users see the answer, not the logic.
    if system_prompt:
        user_content = system_prompt + "\n\n---\n\n" + user_content

    messages = []
    recent = chat["messages"][-11:]
    for m in recent:
        if m.get("role") in ("user", "assistant"):
            messages.append({"role": m["role"], "content": m.get("content", "")})
    messages[-1] = {"role": "user", "content": user_content}

    try:
        if stream:
            def generate():
                full = ""
                last_yield = time.time()
                try:
                    for chunk in ollama_chat_stream(
                        model, messages, temperature, top_p, top_k,
                        repeat_penalty, max_tokens
                    ):
                        if chunk:
                            full += chunk
                            yield "data: " + json.dumps({"chunk": chunk}) + "\n\n"
                            last_yield = time.time()
                        # Keep-alive ping every 5 seconds during thinking phase
                        elif time.time() - last_yield > 5:
                            yield ": keep-alive\n\n"
                            last_yield = time.time()
                    assistant_msg = {
                        "role": "assistant",
                        "content": full,
                        "timestamp": datetime.datetime.utcnow().isoformat(),
                        "pinned": False,
                        "feedback": None,
                    }
                    chat["messages"].append(assistant_msg)
                    save_chat(chat)
                    yield "data: " + json.dumps({"done": True, "chat_id": chat_id}) + "\n\n"
                except requests.ConnectionError:
                    yield "data: " + json.dumps({"error": "Ollama is not running. Start it with: ollama serve"}) + "\n\n"
                except requests.HTTPError as e:
                    yield "data: " + json.dumps({"error": f"Ollama error: {e}"}) + "\n\n"
                except Exception as e:
                    yield "data: " + json.dumps({"error": str(e)}) + "\n\n"

            from flask import Response
            return Response(generate(), mimetype="text/event-stream")
        else:
            r = ollama_chat(model, messages, temperature, top_p, top_k,
                           repeat_penalty, max_tokens, stream=False)
            data = r.json()
            reply = _extract_text(data.get("message", {}))
            assistant_msg = {
                "role": "assistant",
                "content": reply,
                "timestamp": datetime.datetime.utcnow().isoformat(),
                "pinned": False,
                "feedback": None,
            }
            chat["messages"].append(assistant_msg)
            save_chat(chat)
            return jsonify({
                "reply": reply,
                "chat_id": chat_id,
                "chat": chat,
            })
    except requests.ConnectionError:
        return jsonify({"error": "Ollama is not running. Start it with: ollama serve"}), 502
    except requests.HTTPError as e:
        return jsonify({"error": f"Ollama error: {e}. Try: ollama pull {model}"}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 502


@app.route("/api/chat/<chat_id>/message/<int:msg_idx>", methods=["PUT"])
def api_update_message(chat_id, msg_idx):
    """Pin, unpin, or add feedback to a message."""
    data = request.get_json(force=True) or {}
    chat = load_chat(chat_id)
    if not chat:
        return jsonify({"error": "not found"}), 404
    messages = chat.get("messages", [])
    if msg_idx < 0 or msg_idx >= len(messages):
        return jsonify({"error": "message not found"}), 404
    msg = messages[msg_idx]
    if "pinned" in data:
        msg["pinned"] = bool(data["pinned"])
    if "feedback" in data:
        msg["feedback"] = data["feedback"]
    save_chat(chat)
    return jsonify({"ok": True, "message": msg})


@app.route("/api/notes", methods=["GET", "POST"])
def api_notes():
    if request.method == "POST":
        data = request.get_json(force=True) or {}
        name = (data.get("name") or "note.txt").strip()
        if not name.endswith(".txt"):
            name += ".txt"
        name = name.replace("/", "_").replace("\\", "_")
        text = data.get("text", "")
        (NOTES_DIR / name).write_text(text, encoding="utf-8")
        if INDEX_FILE.exists():
            INDEX_FILE.unlink()
        return jsonify({"ok": True, "name": name})
    notes = load_notes()
    return jsonify({"notes": [{"name": n, "text": t} for n, t in notes.items()]})


@app.route("/api/notes/<name>", methods=["DELETE"])
def api_delete_note(name):
    name = name.replace("/", "_").replace("\\", "_")
    p = NOTES_DIR / name
    if p.exists():
        p.unlink()
    if INDEX_FILE.exists():
        INDEX_FILE.unlink()
    return jsonify({"ok": True})


@app.route("/api/rebuild_index", methods=["POST"])
def api_rebuild_index():
    try:
        build_index()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 502


# ---------- File uploads ----------

ALLOWED_EXTENSIONS = {".txt", ".md", ".py", ".js", ".ts", ".json", ".html", ".css", ".csv", ".log"}


def allowed_file(filename):
    return Path(filename).suffix.lower() in ALLOWED_EXTENSIONS


@app.route("/api/upload", methods=["POST"])
def api_upload():
    if "file" not in request.files:
        return jsonify({"error": "no file"}), 400
    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "no filename"}), 400
    if not allowed_file(file.filename):
        return jsonify({"error": "file type not allowed"}), 400
    # Sanitize filename
    safe_name = str(uuid.uuid4()) + "_" + file.filename.replace("/", "_").replace("\\", "_")
    file.save(UPLOADS_DIR / safe_name)
    return jsonify({"ok": True, "name": safe_name, "original": file.filename})


@app.route("/api/uploads", methods=["GET"])
def api_uploads():
    files = []
    if UPLOADS_DIR.exists():
        for f in sorted(UPLOADS_DIR.iterdir()):
            if f.is_file():
                files.append({
                    "name": f.name,
                    "size": f.stat().st_size,
                })
    return jsonify({"files": files})


@app.route("/api/uploads/<filename>", methods=["DELETE"])
def api_delete_upload(filename):
    filename = filename.replace("/", "_").replace("\\", "_")
    p = UPLOADS_DIR / filename
    if p.exists():
        p.unlink()
    return jsonify({"ok": True})


@app.route("/api/uploads/<filename>/content", methods=["GET"])
def api_upload_content(filename):
    filename = filename.replace("/", "_").replace("\\", "_")
    p = UPLOADS_DIR / filename
    if not p.exists():
        return jsonify({"error": "not found"}), 404
    try:
        content = p.read_text(encoding="utf-8")
        return jsonify({"content": content})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
