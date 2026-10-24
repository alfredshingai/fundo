# StudyForge ⚒️

Turn your **PDF, DOCX, TXT and MD** files into study notes, flashcards and quizzes —
with **XP, levels, daily streaks, reward sounds and flashcard read-aloud**.

> Like Turbo AI, but local, private, and documents-only. **No video. No audio. No
> spoken explanations or podcasts.** Sound is limited to short reward effects and
> reading your own flashcards aloud.

## Run it

Requires [Deno](https://deno.com) (v2+).

```bash
deno task dev
```

Then open **http://localhost:3000**. Data lives in `~/.studyforge` (SQLite DB +
uploaded files + extracted text).

On Windows without Deno on PATH, run `start-server.ps1` (PowerShell) — it starts
the server detached and pings the health endpoints.

## First-time setup

1. Open **AI Settings**.
2. Pick a provider — free options first:
   - **OpenCode Zen** (`https://opencode.ai/zen/v1`, e.g. `grok-code-fast-1`)
   - **OpenRouter** (`https://openrouter.ai/api/v1`, any model ending in `:free`)
3. Paste your API key → **Save** → **Test connection**.
4. Upload a document and StudyForge generates notes, flashcards and a quiz.

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
| Review | Flip-card UI with SM-2 spaced repetition (Again/Hard/Good/Easy), keyboard shortcuts (Space, 1–4) |
| Quiz | Multiple choice with instant per-question explanations, retake anytime |
| Gamification | +XP per correct answer/grade, level every 250 XP, daily streaks, level-up popups, confetti, WebAudio sound effects |
| **Course Mode** | Turbo-style structured courses: intro + goal/familiarity picker → warm-up quiz → 6–10 sections with lessons & checkpoints (sequential unlock) → cumulative final quiz. XP at every step (+15 warm-up, +30 section, +10/checkpoint, +40 perfect final) |
| Sounds | Correct/wrong/level-up/streak chimes (WebAudio) + browser TTS reads flashcards aloud (reading only, never explanations) |
| Regenerate | Re-run AI generation on stored extracted text without re-uploading |

## Architecture

```
studyforge/
├── server/
│   ├── main.ts      # Deno HTTP server: static files + /api/* dispatch
│   ├── api.ts       # Route handlers (upload, documents, review, quiz, settings)
│   ├── store.ts     # SQLite schema + XP/streak/level logic
│   ├── extract.ts   # PDF/DOCX/TXT extraction + chunking
│   └── ai.ts        # Multi-provider AI client + study-set prompt
├── public/
│   ├── index.html   # App shell
│   ├── app.js       # SPA: dashboard, upload, review, quiz, settings
│   ├── sounds.js    # WebAudio SFX + SpeechSynthesis read-aloud
│   └── styles.css
└── start-server.ps1 # Windows detached launcher
```

## Notes & limits

- Scanned/image-only PDFs have no text layer and need OCR — not included.
- AI output can contain errors: always cross-check against the original document.
- Your API key is stored locally in `~/.studyforge/studyforge.db` and is only sent
  to the provider you configure.
