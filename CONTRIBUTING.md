# Contributing to Fundo 🎓

Thank you for wanting to make Fundo better! Fundo is a **free and open source**
(MIT) AI-powered learning platform, and contributions of every kind are welcome —
not just code.

## The project in one paragraph

Fundo turns PDF/DOCX/TXT/MD documents into AI-generated study notes, flashcards and
quizzes, with spaced-repetition review, structured courses, and gamification
(XP, levels, streaks). It is **local-first**: your documents and API keys stay on
your machine. It is **documents-only by design**: no video, no audio lectures, no
podcasts — just short reward sounds and optional flashcard read-aloud.

## Principles (please keep them)

1. **Free and open, forever.** No paid tiers, no ads, no tracking, no accounts.
2. **Local-first and private.** User data lives in `~/.fundo` on their machine.
   Never send a user's documents or keys anywhere except the AI provider they
   configured themselves.
3. **No frameworks.** The frontend is vanilla JS + CSS; the backend is Deno +
   a few small npm packages. Don't add React/Vue/etc. — keep dependencies minimal.
4. **Documents only.** Don't add media upload (video/audio) features.

## Dev setup — two commands

Install [Deno](https://deno.com) v2+, then:

```bash
deno task dev      # start the app on http://localhost:3000
deno task check    # type-check the server
```

That's it — no build step, no database server, no paid services. Data lives in
`~/.fundo`. To test AI features you'll need a free API key (OpenCode Zen or any
OpenRouter `:free` model works — see the README's *First-time setup*). If you
don't want to use AI at all, everything except generation still works.

## Where help is needed

- 📄 **OCR** for scanned/image-only PDFs (currently rejected with a clear message)
- 🔌 **More AI providers** and better free-model defaults
- 🌍 **Translations** — all UI strings are currently English-only
- 🎨 **UI polish** — light theme, accessibility, mobile layout
- 🧪 **Tests** — server route tests, extraction tests, CI setup
- 📖 **Docs** — screenshots, tutorials, deployment guides
- 🐞 **Bug reports** — reproducible steps in a GitHub issue are gold

Have your own idea? Open an issue first so we can align on the approach before
you invest time.

## How to submit a change

1. Fork the repo and create a branch: `git checkout -b my-feature`
2. Make your change (small, focused commits are appreciated)
3. Run `deno task check` and manually test the affected flows
4. Open a Pull Request describing **what** changed and **why**
5. Match the existing style: TypeScript on the server, vanilla JS on the client,
   comments only where the code can't explain itself

## Reporting bugs

Open a GitHub issue with:
- what you did, what you expected, what happened instead
- your OS and Deno version (`deno --version`)
- the relevant console/log output (`server.err.log` captures server errors)
- **never** paste your API key into an issue

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE) alongside the rest of the project.
