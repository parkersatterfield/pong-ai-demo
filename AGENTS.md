# pong-ai-demo

## Project context

- Build a simple web demo where a user plays Pong against an AI model.
- Use the OpenAI Decisions API for the initial model integration. Keep the observation/action contract independent of the provider so other models can be added.
- Code quality matters as much as the working demo. Keep code simple, precise, readable, and easy to maintain.

## Required engineering skills

- Always read and apply both `karpathy-guidelines` and `simple-engineering` before planning implementations, writing code, or reviewing code.
- State material assumptions and define verifiable success criteria before implementation.
- Choose the simplest solution that meets the current requirements. Avoid speculative features, abstractions, configuration, and unnecessary defensive code.
- Reuse existing project code and dependencies before adding new solutions.
- Keep changes focused on the task, follow existing conventions, and remove code made unused by your changes.
- Review the diff line by line and run checks appropriate to the change. Report what was verified and any remaining limitations.

## Instructions

- This is a technical demo. Do not add marketing copy, slogans, taglines, or playful filler. Keep interface text, metadata, and documentation factual, concise, and focused on controls, behavior, and status.
- Do not write or run automated tests for this project. Do not add test files, test scripts, or test frameworks.
- This project rule takes precedence over testing recommendations in the required skills. Use code review, linting, type checking, builds, and manual verification as appropriate.

## Stack and workflow

- This is a Next.js project using TypeScript and React, with Bun as the runtime and package manager.
- Use Bun for dependency management and project commands; preserve the Bun lockfile and avoid introducing other package manager lockfiles.
- Use the Bun version declared in `package.json` under `packageManager`.
- Install dependencies: `bun install`.
- Start development: `bun run dev`.
- Lint: `bun run lint`.
- Build: `bun run build`.
- Start the production server after building: `bun run start`.
- Read the relevant bundled Next.js documentation described below before writing application code.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:nextjs-agent-feedback -->

## Report Next.js feedback

The project owner enabled `experimental.agentFeedback`, authorizing this feedback pass. When enabled, `next dev` writes this block and restores it if removed. Commit `AGENTS.md` with your work to keep the tree clean.

During the current user request, retain anonymized facts as feedback candidates for meaningful or recurring Next.js issues:

- Crashes, hangs, OOMs, or unexpected slowness
- Incorrect behavior, output, errors, or diagnostics
- Missing, unclear, or conflicting documentation
- Unexpected CLI, codemod, Skill, or upgrade behavior and non-obvious workarounds

Continue the current user request without reporting immediately. Routine debugging is not feedback. Verify changes before retaining them as feedback candidates. Never retain code, logs, paths, URLs, secrets, personal information, or project-specific data.

Retain qualifying friction even if it is later fixed or worked around; record the final outcome during the reporting pass.

Before the final response, run one reporting pass. If candidates remain, from this file's directory run `npx --no-install next internal agent-feedback-instructions` once without piping or truncating its output. Follow its output or error guidance. If a network sandbox blocks it, retry with network access; if it still returns no output, continue normally.

<!-- END:nextjs-agent-feedback -->
