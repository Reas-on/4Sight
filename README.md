# 4Sight Sandbox

> "Steel from gods that we Steal from gods"

A standalone React + Vite + TypeScript interface for exploring a security playbook in real 3D. Three.js provides a stable clustered network, orbit controls, picking, and ambient rotation. Lucide supplies interface icons; CSS handles coordinated transitions without an additional animation runtime.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. `npm run build` runs TypeScript and the production build. `npm test` runs the interaction tests.

Browser acceptance tests: install a Playwright browser with `npx playwright install chromium`, then run `npm run test:e2e`. On NixOS, supply a compatible browser via `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` and its runtime library environment. The browser suite uses software GL and does not change system GPU settings.

## Controls

- Drag or two-finger scroll to orbit (horizontal = yaw, vertical = pitch; diagonal = both). A mouse wheel also rotates. Both axes support repeated complete revolutions through the poles, using a normalized camera-frame quaternion. Use the +/− buttons, Ctrl+scroll, or touch pinch to zoom; right-drag/two-finger touch drag to pan. Focus/click the graph, then hold arrow keys for horizontal/vertical orbit.
- Hold **Ctrl while left-dragging** the canvas to pan the workspace. The drag mode is latched at pointer-down, so releasing Ctrl mid-drag does not switch back to orbit. Center restores the canonical framing.
- Click a node to select it. Click empty graph space or the details × to clear selection. Connected-node links smoothly navigate the camera; dragging interrupts navigation or centering.
- Scenario Source opens a preview/confirm Explorer. Browse/search the existing Endpoint compromise demo, filter by MITRE technique, or import JSON/YAML/YML/TXT/LOG files up to 256 KiB. Source material and optional **Additional Context** are independent session-local inputs; changing either preserves the other.
- The Explorer uses a fixed viewport-bounded shell: desktop has a 40/60 source/preview layout with separate scroll regions; narrow screens switch between Browse sources and Preview source while keeping header/tabs/actions visible. JSON is formatted for display without modifying the imported raw source.
- The first sidebar section is **AI Agent / Model**. Choose the explicitly simulated local demo runner or the original “No model connected” state. There are no configured live agents, provider credentials, or connection workflow in this frontend. Selection is retained for the session independently of scenario/context, and the reference demonstration remains local playback.
- Additional Context is always visible, multiline and limited to 8,000 characters. Only the existing built-in demo with no substantive additional context can run. Imported/sample sources or composed inputs disable Run with a clear explanation rather than ignoring context or generating fabricated results.
- URL input validates HTTP(S) addresses but does not fetch them; the UI reports retrieval as unavailable. MITRE ATT&CK, Sigma Rules and Atomic Red Team categories contain clearly labeled local sample metadata, detection-rule material and test definitions, respectively—no live integration or execution. Confirmed file imports remain available in the session library. Imported text is inert and rendered as text, never interpreted as HTML or commands.
- The **Settings gear is in the top-right application header beside the profile icon**, with a 40×40 hit area. Settings → Graph Preferences contains Context relationships, retaining the same session-local metadata visibility setting. The application header (including Settings) is hidden during immersive mode and returns on exit.
- Expand control or hold Space **0.8 seconds** to toggle immersive mode. Escape exits.
- **Ctrl + Space** runs/resumes or stops the same demonstration before completion, and toggles its saved Results Panel after completion. In immersive mode the simulation control and matching Retry button sit 10px above the original horizontal zoom/recenter toolbar. Running shows Stop (reset to idle); paused shows Resume; idle shows Run; completed shows a report icon. The sidebar retains its distinct Pause/Resume action. Retry starts fresh and is disabled while running or when current inputs are unsupported. Plain Space never activates simulation buttons; Enter/click do. Text inputs and dialogs retain shortcut priority. OS/input-method interception of Ctrl+Space cannot be overridden; use the visible control if unavailable.
- Immersive mode hides the cursor. Two short Space presses within 350ms toggle cursor visibility; pointer interactions remain available. Focused controls/dialogs retain native keyboard behavior.
- Sound defaults ON and preserves an explicit saved mute. One AudioContext mixes intro, continuous filtered drone/noise ambience with slow stereo movement, deliberate selection/navigation cues, and committed demo transition/completion cues. Master mute fades ambience and suspends processing; unmute fades it back in. Hidden pages also suspend processing. Browser autoplay may require a click, touch, or key gesture; late permission starts ambience without replaying the intro. Reduced motion suppresses sound. Development logs use the `[4Sight audio]` prefix.
- Left and right drawers preserve their state across immersive mode.
- Graph and Steps switch between 3D relationships and the illustrative workflow.
- When the five-step reference run completes, the existing Run control becomes a Results toggle and opens the simulated FULL PASS Results Panel. Total Steps/audit entries follow actual local progression; Hallucination Rate and Rule Adherence are explicitly fixture values. Close/reopen preserves the snapshot; Retry starts a new run with the current configuration. SOAR JSON export is disabled because no verified exporter is connected.

The current demo has no failure/interception outcomes. `NODE_FAILED` and `NODE_INTERCEPTED` have distinct caution cues in the engine, but are not emitted by this successful illustrative sequence. Completion tones mean local demonstration progression, never security validation.

**All execution states are simulated.** No LLM, security evaluation, or SOAR integration is present, and the frontend is not connected to the backend yet. See `SPEC.md` for the provisional contract and data boundaries. The original repository and reference screenshots were not available.

## Repository layout

```text
.
├── src/                 React + Vite frontend
├── public/
├── e2e/
├── backend/             Fastify + TypeScript API foundation
├── compose.yaml         PostgreSQL and backend services
├── .env.example
├── SPEC.md
└── README.md
```

The existing frontend remains at the repository root and continues to use its current npm commands.

## Backend foundation (Phase 0)

The backend is a Fastify service using TypeScript strict mode, PostgreSQL, Drizzle ORM, TypeBox request validation, and Pino structured logging through Fastify. It is a foundation only: it has health and readiness endpoints, no simulation endpoints, and no business schema.

### Local setup

Requirements: Node.js 24 and Docker.

```sh
cp .env.example .env
docker compose up -d db

cd backend
npm install
npm run db:migrate
npm run dev
```

Verify the service:

```sh
curl http://127.0.0.1:3001/health
curl http://127.0.0.1:3001/ready
```

`/health` reports process liveness. `/ready` checks PostgreSQL connectivity and returns `503` when the database is unavailable.

### Full Docker Compose stack

```sh
docker compose up --build
```

The backend is bound to `127.0.0.1:3001` and PostgreSQL to `127.0.0.1:5433`. The named `postgres-data` volume persists the database across restarts. The backend service applies pending Drizzle migrations before starting and does not destroy existing data.

### Backend scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the API with file watching |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run start` | Run the compiled API |
| `npm run typecheck` | Type-check without emitting |
| `npm run test` | Run Vitest (test infrastructure ready) |
| `npm run db:generate` | Generate a Drizzle migration from the schema |
| `npm run db:migrate` | Apply pending Drizzle migrations |

### Environment

`DATABASE_URL` is required and must be a PostgreSQL connection URL. All supported variables are documented in `.env.example`. Real `.env` files and credentials must never be committed.

## Narrative Engine (Phase 1)

The deterministic narrative domain module lives in `backend/src/domain/narrative/`. It is pure TypeScript with no Fastify, PostgreSQL, Drizzle, React, browser, or AI provider dependencies.

It provides validated world state, data-defined conditions and storylets, deterministic eligibility resolution, atomic effects, transition records, terminal detection, and a maximum-transition guard.

The canonical fixture is SSH Brute Force (`T1110.001`) with three paths:

- External source: triage, simulated perimeter block, close.
- Protected internal source: triage, SOC escalation, safe containment, close.
- SOC escalation: protected internal triage, explicit escalation outcome, follow-up, terminal close.

Outcome selection is explicit and deterministic. The engine does not perform AI inference, policy arbitration, persistence, or REST exposure.

### Storylet to graph node mapping

This mapping is documentation only; the domain module never imports frontend or Three.js code.

| Storylet | Graph node |
| --- | --- |
| `triage-ssh-brute-force` | `N-01` Receive alert |
| `block-external-source` | `N-04` Contain endpoint |
| `escalate-protected-source` | `N-04` Contain endpoint |
| `soc-escalation-follow-up` | `N-04` Contain endpoint |
| `close-ssh-incident` | `N-05` Review & report |

`N-02` Enrich context and `N-03` Assess threat remain contextual nodes without dedicated storylets in this fixture. Frontend integration is deferred to a later phase.

### Current scope

Phase 0 infrastructure and the Phase 1 Narrative Engine core are implemented. Simulation REST endpoints, run persistence, Referee Engine integration, AI inference, and evaluation reporting remain planned for later phases.
