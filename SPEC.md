# 4Sight Sandbox — visual workspace contract

**Phase 5 update:** the frontend now uses the durable backend run lifecycle, ordered SSE and persisted Referee evaluation. `README.md`'s Phase 5 section describes the active integration and trust boundary. The original offline lifecycle/fixture descriptions below are historical design references only; `useDemonstration` is not the application execution path. Graph IDs/layout, camera, shortcuts and visual design remain preserved. All proposed security actions remain simulated; there is no SOAR/host execution.

## Workflow contract

The original product specification was not available. Only the five stable IDs below were supplied. Names and descriptions are illustrative, local demo content and can be replaced by an adapter when the authoritative contract is provided.

| ID   | Illustrative step | Transition |
| ---- | ----------------- | ---------- |
| N-01 | Receive alert     | N-02       |
| N-02 | Enrich context    | N-03       |
| N-03 | Assess threat     | N-04       |
| N-04 | Contain endpoint  | N-05       |
| N-05 | Review & report   | —          |

`WorkflowStep` owns stable identity, description, illustrative technique references, and tool metadata. `GraphEntity` separates `workflow` and `metadata` nodes. Metadata IDs are namespaced `M-*`, display-only, and never executable. Workflow edges remain a directed chain, separately represented from display-only relationship edges.

Graph positions use a deterministic spring/repulsion layout initialized from clustered spherical coordinates. The simulation settles before the scene is created. Coordinates remain stable for the scene lifetime. The same scene and selection survive responsive layout and immersive transitions.

## Scenario workspace and source material

`ScenarioWorkspace` stores `selectedSource: ImportedSource | null` and `additionalContext: string` independently. There is no mutually exclusive Custom Scenario type. Optional multiline context (8,000 characters maximum) never replaces the base scenario and remains when sources change. Empty/whitespace context is valid because the field is optional. This draft and imported source text are untrusted user data; they never alter governance or execute instructions.

`ImportedSource` normalizes stable ID, name, source type, original format, description, technique IDs, raw content, source URL/import time where available, sample flag, and material type. Source material is explicitly distinct from an executable/validated scenario. The current built-in Endpoint compromise reference is the only demo-capable source. Run is disabled for any nonempty substantive context or imported/external sample source, with an explanation that composed-input evaluation is unavailable. Editing context or confirming another source pauses the previous reference demonstration without relabeling its graph as generated results.

Scenario Explorer uses the existing native dialog system. It supports library name search, exact MITRE technique filtering, pending preview, explicit Use Scenario confirmation and cancellation that preserves the committed workspace. JSON, YAML/YML, TXT and LOG imports are local-only and capped at 256 KiB. JSON/YAML are syntax-validated; YAML uses the core schema without custom tags or aliases. Unsupported formats, binary/empty text, oversized/overcomplex documents, duplicate YAML keys and unsafe object keys are rejected. Confirmed imports join the session library; preview text is rendered literally. YAML parsing is lazy-loaded only for YAML files.

The Explorer has its own fixed shell styles rather than inheriting the help dialog's narrow content-driven box. Desktop dimensions are `min(1100px, 92vw)` by `min(760px, 88dvh)`, with fixed header/navigation/footer tracks and `minmax(0, 1fr)` content. Source/preview columns use 40/60 space, list/summary/raw text scroll inside bounded regions, and titles clamp to two lines only on cards. Preview names remain complete; JSON display is pretty-printed without altering raw content. At ≤820px, Browse sources / Preview source become separate panels inside the same shell. Short-height layouts avoid nested source-list scrolling. Import logic and confirmation semantics remain unchanged.

URL import validates HTTP(S) URLs without credentials, but does not send a request or create a falsely retrieved source. Direct browser fetching is not assumed due to CORS and no proxy/backend is provided. `sourceAdapters` describes MITRE ATT&CK (technique metadata), Sigma (detection rules) and Atomic Red Team (test definitions). These expose local illustrative samples, not live synchronization, validated playbooks or executable tests. CSV is not supported. No database, backend, command runner or evaluation engine is added.

Context relationships is a single session-local graph preference in Settings → Graph Preferences. It controls the existing `showContext` state and no longer appears in the primary scenario sidebar.

The only Settings entry is a 40×40 header gear immediately beside the profile icon, visible with collapsed drawers and hidden with the header in immersive mode. The sidebar is split into a pinned title, scrollable form, and pinned demonstration/footer area. Form order is AI Agent / Model → Scenario Source → Additional Context. The agent selector restores the original no-connected-model state and offers an explicitly simulated local demo runner; no live model/agent configuration exists. Its session-local selection never resets source/context or pretends to execute inference. Reference playback is independent of live AI availability.

## UI state

React owns drawers, selected/hovered/focused IDs, demo run state, view mode, intro stage, immersive intent, and transition phase. Three.js owns rendering, geometry, projected labels, and camera/orbit state. No per-frame React updates.

Immersive mode is application-only. Drawer preferences are retained independently and restored on exit. An 800ms monotonic Space hold toggles once; physical-down tracking and generation tokens prevent stale timers. Event timestamps classify a released press independently from main-thread delivery delay. Form/interactive controls are excluded, blur/visibility cancel, and higher-priority dialogs own Escape. Two short Space presses within 350ms toggle cursor visibility; long holds never seed double press. The immersive button transfers focus to canvas after activation to avoid native Space-to-click conflicts. Arrow keys orbit only in canvas focus context.

The same keyboard controller owns Ctrl+Space → Run/Resume/Stop. Modified Space never seeds hold/double-tap state, ignores repeats and latches until physical Space release (independent of Ctrl release order). Pressing a modifier during a plain-Space hold cancels that gesture without converting it into simulation input. Focused text/native controls and dialogs retain ownership; tagged simulation controls suppress native plain-Space clicks but accept Ctrl+Space and Enter/click. There is no plain-Space simulation listener.

The immersive simulation button is absolutely anchored 10px above the existing toolbar's left edge, with a matching Retry button 10px beside it; zoom/recenter/legend geometry and styling are unchanged. They use the authoritative `running`/`demoIndex` state, execution guard and single timer. Sidebar Pause/Resume retains progress; Stop uses the existing Reset-to-idle transition (`running=false`, `demoIndex=-1`), cancels the pending demo timer and simulation-layer voices, and starts from the first step on Run. Completed runs restart only through Retry; the main control becomes a report/results toggle. No stopped/failed states are fabricated, no second simulation is created, and mode transitions never reset progress. Audio cancellation affects only the simulation bus, preserving synthesis design and ambient/interaction layers.

`GraphCameraController` owns one normalized quaternion frame, target and distance for every camera operation. Incremental local yaw/pitch uses a single axis-angle rotation per update and rotates camera-up with the frame, without spherical conversion, polar clamps, or lookAt reconstruction at poles. Canvas pointer events handle drag, pan, middle-drag zoom and touch pinch. The existing render loop handles keyboard, damped wheel, idle movement and eased target/distance navigation/Center. Transitions preserve orientation, including inversion. No graph coordinates or geometry change.

`GraphAudioEngine` uses one AudioContext and a master gain/compressor with separate ambient, intro, interaction and simulation buses. `INTRO_TIMELINE` schedules one-shot initialization; filtered drones/noise, slow gain/filter/pan modulation continue at idle. Master mute fades/suspends, unmute fades back, and hidden pages suspend. Saved mute and reduced-motion silence are preserved. Autoplay remains browser-controlled: permitted gestures unlock sound even after intro, without replaying expired cues. Selection/navigation are deliberate events (no hover audio); rapid navigation replaces the previous voice group. `demoAudioEvents` derives enter/completion events from committed demoIndex progression, without independent simulation state or extra execution timers. Reset/pause/skips do not imply success. Failure and interception cues are distinct supported engine events, but no producer exists in this demo; no outcomes are fabricated.

Ordinary wheel events are consumed only on the canvas in a non-passive listener. Pixel/line/page deltas preserve both axes and feed bounded angular displacement into the shared quaternion controller's frame-time-based damping. Wheel input cancels camera transitions and yields to pointer drag. Zoom buttons, touch pinch, middle-drag and Ctrl+wheel remain available; sidebar/menu/dialog scrolling is unaffected.

Canvas pointer-down latches `DragMode` as `orbit` or `pan`: left + Ctrl is pan, ordinary left is orbit, and right drag remains pan. Pan moves camera target and position together at fixed orientation/distance, cancels navigation/idle movement, survives Ctrl release until pointer-up, and is canceled by pointer cancellation, lost capture, blur or unmount. Empty-space selection is not triggered by a pan gesture.

Colors derive only from existing Detection, Investigation, Decision, Response, Review categories and local demo states. Metadata remains neutral gray; demo completion green is not a security pass result. Selection/hover use two reusable localized halo sprites and a ring, with no dynamic lights or postprocessing.

## Demonstration boundaries

The Run demo control advances illustrative states using a local timer. It does not execute commands or evaluate playbook correctness. The Results Panel shows an explicitly simulated FULL PASS fixture, never real model/referee evidence. The step-by-step view is a secondary local workflow visualization, not a state-machine referee.

## Results lifecycle

`useDemonstration` owns one timer generation and derives `simulationStatus` (`idle`, `running`, `paused`, `completed`) from the authoritative progress state. It also owns the run-scoped `evaluationResult`, audit trail and independent `isResultsOpen`. Completing the five-step reference run creates a simulated FULL PASS result (`hallucinationRate: 0`, `ruleAdherence: 100`, `backendVerified: false`) and opens Results automatically. Total Steps counts unique completed executable nodes; entered-only/skipped rows are excluded. Audit timestamps come from actual monotonic progress, including pause/resume. No referee decisions or conditional branches are invented.

Results close/reopen preserves the snapshot and graph/camera/demo state. Ctrl+Space and the existing simulation controls toggle Results after completion and cannot restart execution. Results is non-modal so the same controls stay available outside its bounded overlay; Escape closes Results before immersive exit, and native modals retain priority. Retry invalidates/cancels the prior timer, clears old result/audit state, snapshots current source/context/agent and starts a new run. Retry is disabled while running to prevent duplicate loops. Stop retains its reset-to-idle behavior; Pause retains progress. Imported/composed inputs remain guarded; completed historical results remain readable even if current inputs change.

One immersive Retry button matches the existing 42×42 simulation button, sits 10px beside it, and uses the same handler as sidebar Retry. Zoom/recenter and legend geometry are untouched. The compact Results UI has a fixed header/footer, scrollable execution audit, responsive metric cards and explicit fixture labels. SOAR JSON export is disabled with an explanation; no CrowdStrike/SOAR delivery is claimed.
