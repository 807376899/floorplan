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

### Debugging Discipline for Repeated Bugs

Recent failures showed a recurring pattern: fixes were aimed at the visible symptom, tests used clean synthetic data, browser checks did not follow the exact user path, and completion was claimed before verifying the original failure mode end to end. To prevent this, follow these rules for any bug fix, especially plan-copy, business editing, import, permissions, or data-merge behavior:

- First write a concrete root-cause note before changing production code. Trace the failing value through frontend state, API payload, service normalization/merge logic, database JSON, and the rendered UI. Do not stop at the first plausible cause.
- Create at least one failing regression test before the fix. The test must reproduce the dirty or historical data condition that caused the bug, not only a clean happy path.
- When the bug involves plan copies, include at least two visible plans in the test: the edited plan and another plan that must not be affected. Cover stale `dataset_json`, `copy_id`, `deleted_space_ids`, duplicate ids/codes, and active/shared rows when relevant.
- When the bug involves business editing, verify the full CRUD loop: add, save, reload, switch plan, edit, delete, and reload again. A test that only checks immediate local state is not sufficient.
- Browser verification must use the same visible UI path as the user whenever possible. For this app, prefer selecting plan/building controls and clicking floor thumbnails; if a hidden control must be set in automation, explicitly explain why and still assert against visible business list and main floorplan output.
- Wait for condition-based evidence, not fixed sleeps alone. For example, wait until status text contains the saved/deleted message and until both `#dataEditor` and `#floorplan` reflect the expected space.
- Before saying a bug is fixed, run `npm test`, perform the browser scenario that originally failed, and do a read-only database check for the relevant persisted JSON. Report the exact evidence in the final response.
- If two consecutive fixes fail for the same user-visible issue, stop adding patches. Re-open root-cause analysis, list what each failed fix assumed, and identify the shared-state or architecture boundary that the previous tests missed.

## Testing Guidelines

There is currently no automated `npm test` script. For behavioral changes, run the app locally and verify affected viewer, editor, and admin workflows. Use `acceptance-checklist.md` as the regression checklist for UI, permissions, import, baseline, and plan-copy behavior. Add automated tests only if you also add and document the runner.

## Commit & Pull Request Guidelines

Recent commits use short imperative summaries, for example `Refine business editing and add plan diff panel`. Keep commits scoped to one coherent change.

Pull requests should include a brief problem statement, implementation summary, verification steps, and screenshots for visible UI changes. Link related issues or requirements, and call out any database, Docker, or configuration impact.

## Security & Configuration Tips

Do not commit real credentials or production `data/` contents. Override default Docker credentials in `docker-compose.yml` or environment variables before deployment. Avoid `docker compose down -v` unless intentionally deleting all persisted app data.
