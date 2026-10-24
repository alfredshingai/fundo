# Fundo 🎓

**Fundo** is a **100% free and open source** AI-powered learning platform. No subscriptions,
no locked features, no ads, no tracking — now and forever. The project is actively developed
and **looking for contributors and collaborators** of every kind: code, design, docs, ideas,
translations, testing. Jump in — see [CONTRIBUTING.md](CONTRIBUTING.md) to get started.

![License](https://img.shields.io/badge/license-MIT-green) ![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen) ![Deno](https://img.shields.io/badge/runtime-Deno%202-black)

Turn your **PDF, DOCX, TXT and MD** files into study notes, flashcards and quizzes —
with **XP, levels, daily streaks, reward sounds and flashcard read-aloud**.

Free and open source. Bring your own AI: free providers work out of the box, or run
fully offline with Ollama. Your documents and API keys never leave your machine.

> **No video. No audio. No spoken explanations or podcasts.** Sound is limited to
> short reward effects and reading your own flashcards aloud.

## Run it

Requires [Deno](https://deno.com) (v2+).

```bash
deno task dev
```

Then open **http://localhost:3000**. Data lives in `~/.fundo` (SQLite DB +
uploaded files + extracted text).

On Windows you can also double-click **Start Fundo.bat** (or run
`start-server.ps1` in PowerShell) — it starts the server detached and pings the
health endpoints.

The server binds to `127.0.0.1` by default. Set `HOST=0.0.0.0` when deploying to
a platform that requires a public bind, and `PORT` to change the port.

## First-time setup

1. Open **AI Settings**.
2. Pick a provider — free options first:
   - **OpenCode Zen** (`https://opencode.ai/zen/v1`, e.g. `deepseek-v4-flash-free`)
   - **OpenRouter** (`https://openrouter.ai/api/v1`, any model ending in `:free`)
3. Paste your API key → **Save** → **Test connection**.
4. Upload a document and Fundo generates notes, flashcards and a quiz.

Also supported: OpenAI, Anthropic, Google Gemini, Ollama (fully offline), or any
custom OpenAI-compatible endpoint.

## What it does

| Step | Detail |
|---|---|
| Upload guard | Only `.pdf .docx .txt .md` — media files are explicitly rejected with a clear message |
| Extraction | pdfjs (PDF text layer), DOCX ZIP/XML parser, TXT/MD with encoding fallback |
| Chunking | Long documents are split at paragraph/sentence boundaries (~12k chars) |
| AI generation | One structured JSON call → markdown notes + 8–16 flashcards + 8–12 MCQs with explanations |
| Storage | SQLite: documents, notes, flashcards, quizzes, attempts, XP, settings |
| Review | Flip-card UI with SM-2 spaced repetition (Again/Hard/Good/Easy), keyboard shortcuts (Space, 1–4), due-first ordering and a "due only" filter |
| Quiz | Multiple choice with instant per-question explanations, retake anytime |
| Gamification | +XP per correct answer/grade, level every 250 XP, daily streaks, level-up popups, confetti, WebAudio sound effects |
| **Course Mode** | Structured courses: intro + goal/familiarity picker → warm-up quiz → 6–10 sections with lessons & checkpoints (sequential unlock) → cumulative final quiz. XP at every step (+15 warm-up, +30 section, +10/checkpoint, +40 perfect final) |
| Export | One click: notes as Markdown, flashcards as CSV (Anki/Quizlet/Excel-friendly), quiz as Markdown with answer key |
| Sounds | Correct/wrong/level-up/streak chimes (WebAudio) + browser TTS reads flashcards aloud (reading only, never explanations) |
| Regenerate | Re-run AI generation on stored extracted text without re-uploading |

## Architecture

```
fundo/
├── server/
│   ├── main.ts      # Deno HTTP server: static files + /api/* dispatch
│   ├── api.ts       # Route handlers (upload, documents, review, quiz, settings)
│   ├── store.ts     # SQLite schema + XP/streak/level logic
│   ├── extract.ts   # PDF/DOCX/TXT extraction + chunking
│   ├── ai.ts        # Multi-provider AI client + study-set prompt
│   └── courses.ts   # Background course generation pipeline
├── public/
│   ├── index.html   # App shell
│   ├── app.js       # SPA: dashboard, upload, review, quiz, courses, settings
│   ├── sounds.js    # WebAudio SFX + SpeechSynthesis read-aloud
│   └── styles.css
└── start-server.ps1 # Windows detached launcher
```

## Contributing — collaborators wanted 🤝

Fundo is an independent open source project, and it grows faster with help. Whether
you write code, design UI, write docs, translate, or just test things and file good
bug reports — you're welcome here.

**Areas where help is most needed right now:**
- 📄 OCR support for scanned/image-only PDFs
- 🔌 More AI providers and better model defaults
- 🌍 Translations / internationalization
- 🎨 UI polish, themes (light mode), accessibility
- 🧪 Tests and CI
- 📖 Documentation and tutorials

Read [CONTRIBUTING.md](CONTRIBUTING.md) for the dev setup and guidelines — the whole
app runs with two commands and zero paid services. If you'd like to collaborate
long-term (features, roadmap, maintaining), open an issue or a discussion and say hi.

## Notes & limits

- Scanned/image-only PDFs have no text layer and need OCR — not included.
- AI output can contain errors: always cross-check against the original document.
- Your API key is stored locally in `~/.fundo/fundo.db` and is only sent to the
  provider you configure.

## License

[MIT](LICENSE) © 2026 Alfred Shingai & Fundo contributors
