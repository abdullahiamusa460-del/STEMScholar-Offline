import os
import json
import math
from pathlib import Path
from flask import Flask, render_template, request, jsonify
import requests

BASE_DIR = Path(__file__).resolve().parent
NOTES_DIR = BASE_DIR / "notes"
INDEX_FILE = BASE_DIR / "notes_index.json"

# Load .env manually (no extra dependency)
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
STEM_MODEL = os.environ.get("STEM_MODEL", "gemma4:e2b-it-qat")
EMBED_MODEL = os.environ.get("STEM_EMBED_MODEL", "snowflake-arctic-embed:33m")

SUBJECTS = {
    "physics": "Physics",
    "mathematics": "Mathematics",
    "chemistry": "Chemistry",
}

app = Flask(__name__)
NOTES_DIR.mkdir(exist_ok=True)

SYSTEM_PROMPT = (
    "You are STEMScholar, an offline study assistant for secondary and university students. "
    "You ONLY answer questions about Physics, Mathematics, and Chemistry. "
    "If asked about anything else, politely say you can only help with those three subjects. "
    "Use clear, simple English suitable for students. Include short examples and step-by-step "
    "working when helpful. Keep answers concise and to the point. You run offline on the user's laptop."
)


def ollama_chat(model, messages):
    url = f"{OLLAMA_HOST}/api/chat"
    payload = {
        "model": model,
        "messages": messages,
        "stream": False,
        "options": {
            "temperature": 0.4,
            "num_predict": 700,      # allow longer answers
        },
    }
    # Long timeout: first message may load the model into RAM (can be slow offline)
    r = requests.post(url, json=payload, timeout=600)
    r.raise_for_status()
    return r.json()["message"]["content"]


def ollama_chat_stream(model, messages):
    """Yield response chunks from Ollama streaming chat."""
    url = f"{OLLAMA_HOST}/api/chat"
    payload = {
        "model": model,
        "messages": messages,
        "stream": True,
        "options": {
            "temperature": 0.4,
            "num_predict": 700,      # allow longer answers
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
        content = msg.get("content", "")
        if content:
            yield content
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


@app.route("/")
def home():
    return render_template("index.html", subjects=SUBJECTS, model=STEM_MODEL)


@app.route("/api/status")
def status():
    try:
        r = requests.get(f"{OLLAMA_HOST}/api/tags", timeout=10)
        models = [m.get("name", "") for m in r.json().get("models", [])]
        return jsonify({
            "ollama": True,
            "models": models,
            "stem_model": STEM_MODEL,
            "model_ready": STEM_MODEL in models,
        })
    except Exception:
        return jsonify({
            "ollama": False,
            "models": [],
            "stem_model": STEM_MODEL,
            "model_ready": False,
        })


@app.route("/api/chat", methods=["POST"])
def api_chat():
    data = request.get_json(force=True) or {}
    message = (data.get("message") or "").strip()
    subject = data.get("subject", "physics")
    use_notes = bool(data.get("use_notes"))
    if not message:
        return jsonify({"error": "empty message"}), 400
    if subject not in SUBJECTS:
        subject = "physics"

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
            "Relevant notes from the user's own files:\n"
            f"{context}\n\n---\n\nStudent question: {message}"
        )

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT
         + f"\n\nThe student selected the subject: {SUBJECTS[subject]}. Focus on that subject."},
        {"role": "user", "content": user_content},
    ]

    try:
        reply = ollama_chat(STEM_MODEL, messages)
    except requests.ConnectionError:
        return jsonify({
            "error": "Ollama is not running. Start it in another terminal with: ollama serve"
        }), 502
    except requests.HTTPError as e:
        return jsonify({
            "error": f"Ollama error: {e}. Is the model '{STEM_MODEL}' downloaded? Try: ollama pull {STEM_MODEL}"
        }), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 502

    return jsonify({"reply": reply, "subject": subject})


@app.route("/api/chat/stream", methods=["POST"])
def api_chat_stream():
    data = request.get_json(force=True) or {}
    message = (data.get("message") or "").strip()
    subject = data.get("subject", "physics")
    use_notes = bool(data.get("use_notes"))
    if not message:
        return jsonify({"error": "empty message"}), 400
    if subject not in SUBJECTS:
        subject = "physics"

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
            "Relevant notes from the user's own files:\n"
            f"{context}\n\n---\n\nStudent question: {message}"
        )

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT
         + f"\n\nThe student selected the subject: {SUBJECTS[subject]}. Focus on that subject."},
        {"role": "user", "content": user_content},
    ]

    def generate():
        try:
            for chunk in ollama_chat_stream(STEM_MODEL, messages):
                yield f"data: {json.dumps({'chunk': chunk})}\n\n"
        except requests.ConnectionError:
            yield f"data: {json.dumps({'error': 'Ollama is not running. Start it with: ollama serve'})}\n\n"
        except requests.HTTPError as e:
            yield f"data: {json.dumps({'error': f'Ollama error: {e}'})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        yield f"data: {json.dumps({'done': True})}\n\n"

    from flask import Response
    return Response(generate(), mimetype="text/event-stream")


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


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
