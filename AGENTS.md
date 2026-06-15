# Repository Guidelines

## Project Structure & Module Organization

This is a Node.js floorplan app with a static browser client and built-in HTTP server.

- `server.js` wires configuration, database access, services, routes, and static file serving.
- `server/` contains backend modules for auth, audit, datasets, imports, snapshots, plan copies, SQLite, and HTTP helpers.
- `index.html`, `styles.css`, and `app.js` form the main browser UI.
- `js/` contains frontend modules for rendering, domain logic, API access, canvas behavior, and import/export.
- `scripts/` contains maintenance utilities, including `scripts/manage-user.js`.
- `data/` stores local SQLite, uploads, and backups; treat it as generated runtime state.
- Sample import files live at the root as CSV and XLSX fixtures.

## Build, Test, and Development Commands

- `npm start` or `node server.js`: run the app at `http://localhost:5173` by default.
- `PORT=3000 npm start` on Unix-like shells, or `$env:PORT=3000; npm start` in PowerShell: run on a custom port.
- `npm run user -- <args>`: invoke the user-management helper.
- `docker compose up -d --build`: build and run the container with persistent `floorplan-data`.
- `docker compose logs -f`: follow container logs.

The app depends on `node:sqlite`; use Node 24 or newer unless documented otherwise.

## Coding Style & Naming Conventions

Use CommonJS on the server (`require`, `module.exports`) and keep service factories named `createXService`. Match existing JavaScript style: 2-space indentation, semicolons, double quotes, `const`/`let`, and early returns for request handling. Keep frontend modules browser-compatible unless you add a full build path.

Name files by responsibility, usually lowercase kebab-case such as `plan-copy-service.js`.

## Agent-Specific Workflow

Before implementation, read `codex-requirements.md` and preserve its long-term requirements. After implementation, read `acceptance-checklist.md`, run relevant checks, and update both documents when new lasting requirements appear. Integrate new requirements into existing sections instead of adding date-only appendices. When the user asks to execute and publish, commit and push the completed iteration to GitHub after verification.

## Testing Guidelines

There is currently no automated `npm test` script. For behavioral changes, run the app locally and verify affected viewer, editor, and admin workflows. Use `acceptance-checklist.md` as the regression checklist for UI, permissions, import, baseline, and plan-copy behavior. Add automated tests only if you also add and document the runner.

## Commit & Pull Request Guidelines

Recent commits use short imperative summaries, for example `Refine business editing and add plan diff panel`. Keep commits scoped to one coherent change.

Pull requests should include a brief problem statement, implementation summary, verification steps, and screenshots for visible UI changes. Link related issues or requirements, and call out any database, Docker, or configuration impact.

## Security & Configuration Tips

Do not commit real credentials or production `data/` contents. Override default Docker credentials in `docker-compose.yml` or environment variables before deployment. Avoid `docker compose down -v` unless intentionally deleting all persisted app data.
