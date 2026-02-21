# Repository Guidelines

## Project Structure & Module Organization
- App entry and routing: `src/app/`
- API routes: `src/app/api/*/route.ts`
- Feature UI:
  - `src/components/upload/` (landing + file upload)
  - `src/components/dashboard/` (tables, dialogs, export flow)
  - `src/components/network/` (2D/3D graph)
  - `src/components/ui/` (shared primitives)
- Core logic: `src/lib/` (`parser.ts`, `analyzer.ts`, `excel.ts`)
- Shared types: `src/types/network.ts`
- Static assets: `public/` (favicon, sample CSV)

## Build, Test, and Development Commands
- `bun run dev` or `npm run dev`: start local server (`http://localhost:3000`)
- `bun run lint` or `npm run lint`: run ESLint
- `bun run build` or `npm run build`: production build
- `bun run start` or `npm run start`: run built app

## Coding Style & Naming Conventions
- TypeScript + React function components.
- Use `@/*` import alias (e.g. `@/lib/parser`).
- Follow existing style: semicolons, double quotes, explicit interfaces.
- File naming:
  - Components: `PascalCase.tsx`
  - Utilities: lowercase (`analyzer.ts`, `parser.ts`)
  - API handlers: `route.ts`

## Testing Guidelines
- No dedicated unit-test suite yet.
- Minimum checks before push:
  - `bun run lint`
  - `bun run build`
  - Manual verification: upload CSV, graph interactions(2D/3D, grab/zoom), Excel download

## Commit & Pull Request Guidelines
- Recommended commit format: Conventional Commits.
  - Examples: `feat: add spacebar hold grab mode`, `fix: preserve graph view on 2d-3d toggle`
- PR should include:
  - summary of user-visible changes
  - env var/config changes
  - verification steps and results
  - screenshots or short video for UI changes

## Security & Configuration Tips
- Keep secrets in `.env.local` only (`GEMINI_API_KEY`).
- Never commit `.env*`.
- API responses must sanitize filename/header values for downloads.
- Keep UTF-8 filename compatibility (`Content-Disposition` with `filename*`).
