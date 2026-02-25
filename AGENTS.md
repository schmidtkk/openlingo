When the user asks you something, follow a 2 step Plan & Implement (PI) pattern.

All the files generated during PI should be saved into a new folder inside /agent-docs named "DD-MMM-YYYY-description-of-thing-to-implement". If the user provided a task.md file, move also into this folder. If there is no task.md file provided, create it and add the user's initial prompt inside it.

PI pattern:

1. Deeply research the codebase based on what the user asked you. Go deep into functions and code, analyse everything in great details going through everything and understanding the intricacies. Once you have all the information, write the implementation plan at a file called `plan.md`. This should include relevant information discovered during research, design decisions taken and edge cases or other things we should pay close attention to. Include a todo list at the end that describes step by step how you are going to perform this. After this, ask the user for review. Do not implement yet.
2. Once you get approval from the user, implement everything following `plan.md`, do not ask for user input anymore.

## Cursor Cloud specific instructions

### Overview

OpenLingo is a single Next.js 16 app (TypeScript, Bun runtime) with PostgreSQL 16 as the only external service. All AI features require at least one provider API key (OpenAI, Anthropic, or Google).

### Services

You don't need to start docker db, you already have a dev database ready to use in DATABASE_URL. You already have a test user in the db:
email: test@openlingo.dev
password: honestly-i-think-im-a-potato

| Service | How to start | Port |
|---------|-------------|------|
| Next.js dev server | `bun run dev` | 3000 |

### Key commands

Standard dev commands are in `package.json` scripts. Reference the README "Getting Started" section for the full setup flow. Key commands:

- **Lint**: `bun run lint` (ESLint 9; the codebase has pre-existing lint warnings/errors)
- **Build**: `bun run build`
- **Dev server**: `bun run dev`
- **DB migrations**: `bun run db:migrate`

### Non-obvious caveats

- **Bun path**: Bun is installed at `~/.bun/bin/bun`. Make sure `$BUN_INSTALL/bin` is on `$PATH` (already in `~/.bashrc`).
- **Environment file**: `.env.local` must exist with at least `DATABASE_URL`, `BETTER_AUTH_SECRET`, and `BETTER_AUTH_BASE_URL`. AI features need `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GOOGLE_AI_API_KEY`. Copy from `example.env.local` and fill in.
- **Turnstile captcha**: The signup form shows a Cloudflare Turnstile widget. With empty `NEXT_PUBLIC_TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY`, registration still works (the verification is skipped server-side when keys are absent).
- **No automated test suite**: The project has no unit/integration test framework configured. Lint (`bun run lint`) and build (`bun run build`) are the main automated checks.