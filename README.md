# STEMScholar-Offline AI

A fully offline AI study assistant for STEM subjects. Runs locally on your laptop using Ollama — no internet required after model download.

## 🚀 Features

### Subjects
- **Physics** — formulas, step-by-step working, examples
- **Mathematics** — step-by-step solutions, reasoning, worked examples
- **Chemistry** — reactions, equations, concept explanations
- **Biology** — concepts, processes, terminology
- **Computer Science** — algorithms, programming, code examples
- **Engineering** — principles, calculations, design concepts

### AI Features
- **Streaming responses** — watch the AI type in real-time
- **Model selection** — choose any Ollama model you have installed
- **Temperature control** — adjust creativity vs. precision
- **Max tokens** — control response length
- **Chat history** — multiple conversations, auto-saved locally
- **Conversation context** — AI remembers recent messages in each chat
- **Notes search** — upload your own .txt notes and search them with AI
- **Works with reasoning models** — supports models with thinking fields (e.g., gemma4)

### Appearance & Customization
- **Dark / Light theme** — toggle between themes
- **Accent color picker** — 6 preset colors + custom color
- **Font size adjustment** — 12px to 20px
- **Glassmorphism UI** — modern frosted-glass design
- **Responsive** — works on mobile and desktop

### Chat Features
- **Markdown rendering** — bold, italic, code blocks, math equations, lists
- **Copy to clipboard** — one-click copy of any message
- **Regenerate** — retry the last AI response
- **Delete messages** — remove individual messages
- **Export chat** — download conversation as .txt file
- **Keyboard shortcut** — `Ctrl+Enter` to send

## 📦 Requirements

- Python 3.8+
- [Ollama](https://ollama.ai) running locally
- Flask (`pip install -r requirements.txt`)

## 🛠️ Setup

```bash
# Clone the repository
git clone https://github.com/abdullahiamusa460-del/STEMScholar-Offline.git
cd STEMScholar-Offline

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Linux/Mac
# or: venv\Scripts\activate  # Windows

# Install dependencies
pip install -r requirements.txt

# Start Ollama (in another terminal)
ollama serve

# Pull a model (optional, gemma4:e2b-it-qat is default)
ollama pull gemma4:e2b-it-qat

# Start STEMScholar
python app.py

# Open http://127.0.0.1:5000
```

## ⚙️ Configuration

Edit `.env` to change the default model, Ollama host, or embedding model.

UI settings (theme, accent color, font size, temperature, etc.) can be changed in the Settings panel and are saved to `user_settings.json`.

## 📁 Project Structure

```
STEMScholar-Offline/
├── app.py              # Flask backend with all API routes
├── requirements.txt    # Python dependencies
├── .env               # Environment configuration
├── README.md          # This file
├── static/
│   ├── app.js         # Frontend JavaScript
│   └── style.css      # Styles with dark/light themes
├── templates/
│   └── index.html     # Main HTML template
├── notes/             # Your .txt study notes
├── chats/             # Auto-saved chat sessions
└── user_settings.json # Auto-generated UI preferences
```

## 🔒 Privacy

Everything runs offline on your machine. No data is sent to external servers. Your notes, chats, and settings are stored locally as JSON and text files.

## 📄 License

MIT
