import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { AlertCircle, Crosshair } from "lucide-react";
import { legacyGraph, statusLabel, type GraphDataset, type StepStatus } from "../data/graph";
import { nodeColor } from "../data/nodeColors";
import { INTRO_TIMELINE } from "../data/intro";
import {
  EXECUTION_FOCUS_SECONDS,
  GraphCameraController,
} from "./GraphCameraController";
import type { OrbitKey } from "../hooks/useHoldShortcut";
import { wheelOrbitDelta } from "./wheelOrbit";

type DragMode = "orbit" | "pan";
type DragPointer = { x: number; y: number; mode: DragMode; button: number };

export type GraphControls = {
  zoom: (factor: number) => void;
  reset: () => void;
  navigateToNode: (id: string) => void;
  orbit: (key: OrbitKey, pressed: boolean) => void;
  focus: () => void;
};
type Props = {
  dataset?: GraphDataset;
  selectedNodeId: string | null;
  hoveredNodeId: string | null;
  focusedNodeId: string | null;
  onHover: (id: string | null, point?: { x: number; y: number }) => void;
  onSelect: (id: string) => void;
  onDeselect: () => void;
  introStartedAt: number;
  introComplete: boolean;
  isImmersive: boolean;
  reducedMotion: boolean;
  demoIndex: number;
  running: boolean;
  runId: number | string;
  nodeStatuses?: Record<string, StepStatus>;
  activeNodeId?: string | null;
  terminal?: boolean;
  executionIdentity?: string;
  showContext: boolean;
  visible: boolean;
};

const GraphCanvas = memo(
  forwardRef<GraphControls, Props>(function GraphCanvas(props, ref) {
    const dataset = props.dataset ?? legacyGraph;
    const host = useRef<HTMLDivElement>(null);
    const labelHost = useRef<HTMLDivElement>(null);
    const latest = useRef(props);
    latest.current = props;
    const api = useRef<GraphControls>({
      zoom: () => {},
      reset: () => {},
      navigateToNode: () => {},
      orbit: () => {},
      focus: () => {},
    });
    const [error, setError] = useState(false);
    useImperativeHandle(
      ref,
      () => ({
        zoom: (factor) => api.current.zoom(factor),
        reset: () => api.current.reset(),
        navigateToNode: (id) => api.current.navigateToNode(id),
        orbit: (key, pressed) => api.current.orbit(key, pressed),
        focus: () => api.current.focus(),
      }),
      [],
    );

    useEffect(() => {
      const graph = dataset;
      const { neighbors, steps } = dataset;
      const container = host.current!;
      let renderer: THREE.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
        });
      } catch {
        setError(true);
        return;
      }
      setError(false);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
      renderer.setClearColor(0x101318, 0);
      renderer.domElement.setAttribute(
        "aria-label",
        "Interactive 3D playbook graph. Drag, scroll, or use arrow keys to orbit. Use zoom buttons, touch pinch, or Ctrl+scroll to zoom. Click empty space to clear selection.",
      );
      renderer.domElement.setAttribute("role", "region");
      renderer.domElement.tabIndex = 0;
      renderer.domElement.dataset.graphKeyboard = "true";
      container.prepend(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
      camera.position.set(0, 1.2, 30);

      const group = new THREE.Group();
      scene.add(group);
      const sphereGeometry = new THREE.SphereGeometry(1, 12, 10);
      const nodes = graph.nodes.map((node, i) => {
        const material = new THREE.MeshBasicMaterial({
          color: node.kind === "workflow" ? 0xa0d0da : 0x7799a5,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        });
        const mesh = new THREE.Mesh(sphereGeometry, material);
        const radius =
          node.kind === "workflow" ? 0.145 : 0.038 + (i % 4) * 0.007;
        mesh.position.set(...node.position);
        mesh.scale.setScalar(radius);
        mesh.userData = { id: node.id, radius, index: i };
        group.add(mesh);
        return mesh;
      });
      const meshes = new Map(
        nodes.map((mesh) => [mesh.userData.id as string, mesh]),
      );
      const lines = graph.edges.map((edge) => {
        const geometry = new THREE.BufferGeometry().setFromPoints([
          meshes.get(edge.source)!.position,
          meshes.get(edge.target)!.position,
        ]);
        const material = new THREE.LineBasicMaterial({
          color: edge.kind === "workflow" ? 0x82b4c3 : 0x63848f,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        });
        const line = new THREE.Line(geometry, material);
        group.add(line);
        return line;
      });
      const ringGeometry = new THREE.RingGeometry(0.23, 0.25, 40);
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: 0xa7cdd6,
        transparent: true,
        opacity: 0.65,
        side: THREE.DoubleSide,
        depthTest: false,
      });
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.visible = false;
      group.add(ring);
      const haloPixels = new Uint8Array(32 * 32 * 4);
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < 32; x++) {
          const i = (y * 32 + x) * 4;
          const radius = Math.hypot((x - 15.5) / 15.5, (y - 15.5) / 15.5);
          haloPixels[i] = haloPixels[i + 1] = haloPixels[i + 2] = 255;
          haloPixels[i + 3] = Math.round(
            Math.pow(Math.max(0, 1 - radius), 2.4) * 255,
          );
        }
      const haloTexture = new THREE.DataTexture(haloPixels, 32, 32);
      haloTexture.needsUpdate = true;
      const makeHalo = () => {
        const sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: haloTexture,
            color: 0xa5cbd5,
            transparent: true,
            opacity: 0,
            depthWrite: false,
          }),
        );
        sprite.visible = false;
        group.add(sprite);
        return sprite;
      };
      const selectedHalo = makeHalo();
      const hoverHalo = makeHalo();
      const highlightColor = new THREE.Color(0xd5e6eb);
      const materialColor = new THREE.Color();
      const targetScale = new THREE.Vector3();

      const labels = graph.nodes
        .filter((n) => n.kind === "workflow")
        .map((node) => {
          const label = document.createElement("div");
          label.className = "graph-label";
          const dot = document.createElement("span");
          dot.className = "label-dot";
          const name = document.createElement("span");
          name.textContent = node.name;
          const id = document.createElement("small");
          id.textContent = node.id;
          label.append(dot, name, id);
          labelHost.current!.append(label);
          return { element: label, status: id, mesh: meshes.get(node.id)!, id: node.id };
        });

      let width = 1;
      let height = 1;
      let previousFit = 0;
      let pointerDown = { x: 0, y: 0 };
      let pointerMoved = false;
      let lastHover: string | null = null;
      let previousImmersive = latest.current.isImmersive;
      const fitDistance = () =>
        (9 /
          Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) /
          Math.min(1, camera.aspect)) *
        (latest.current.isImmersive ? 0.91 : 1.04);
      const graphRadius =
        Math.max(
          ...graph.nodes.map((node) =>
            new THREE.Vector3(...node.position).length(),
          ),
        ) + 0.3;
      const cameraController = new GraphCameraController(
        camera,
        (id) => meshes.get(id)?.getWorldPosition(new THREE.Vector3()),
        fitDistance,
        graphRadius,
      );
      const resize = () => {
        const rect = container.getBoundingClientRect();
        width = Math.max(1, rect.width);
        height = Math.max(1, rect.height);
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        const fit = fitDistance();
        if (previousFit === 0) cameraController.initializeDistance(fit);
        else if (Math.abs(fit / previousFit - 1) > 0.001)
          cameraController.reframe(fit / previousFit);
        previousFit = fit;
      };
      const observer = new ResizeObserver(resize);
      observer.observe(container);
      resize();
      const raycaster = new THREE.Raycaster();
      const mouse = new THREE.Vector2();
      const pick = (event: PointerEvent) => {
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.set(
          ((event.clientX - rect.left) / width) * 2 - 1,
          (-(event.clientY - rect.top) / height) * 2 + 1,
        );
        raycaster.setFromCamera(mouse, camera);
        // A slightly larger raycast proxy makes small metadata nodes practical to pick.
        nodes.forEach((mesh) => mesh.scale.multiplyScalar(1.8));
        scene.updateMatrixWorld(true);
        const hit = raycaster.intersectObjects(
          nodes.filter(
            (_, i) =>
              latest.current.showContext || graph.nodes[i].kind === "workflow",
          ),
          false,
        )[0];
        nodes.forEach((mesh) => mesh.scale.divideScalar(1.8));
        scene.updateMatrixWorld(true);
        return hit ? String(hit.object.userData.id) : null;
      };
      const pointerMove = (event: PointerEvent) => {
        if (
          Math.hypot(
            event.clientX - pointerDown.x,
            event.clientY - pointerDown.y,
          ) > 5
        )
          pointerMoved = true;
        if (pointers.has(event.pointerId)) {
          const previous = pointers.get(event.pointerId)!;
          if (pointers.size === 1) {
            const dx = event.clientX - previous.x,
              dy = event.clientY - previous.y;
            if (previous.mode === "pan")
              cameraController.pan(dx / height, dy / height);
            else if (previous.button === 1)
              cameraController.zoomBy(Math.exp(dy * 0.005));
            else
              cameraController.dragBy(
                (-dx / height) * Math.PI,
                (-dy / height) * Math.PI,
              );
          } else {
            const old = touchMetrics();
            pointers.set(event.pointerId, {
              ...previous,
              x: event.clientX,
              y: event.clientY,
            });
            const next = touchMetrics();
            if (old.distance && next.distance)
              cameraController.zoomBy(old.distance / next.distance);
            cameraController.pan(
              (next.x - old.x) / height,
              (next.y - old.y) / height,
            );
          }
          pointers.set(event.pointerId, {
            ...previous,
            x: event.clientX,
            y: event.clientY,
          });
          return;
        }
        const id = pick(event);
        renderer.domElement.style.cursor = id ? "pointer" : "grab";
        if (id !== lastHover) {
          lastHover = id;
          latest.current.onHover(id, { x: event.clientX, y: event.clientY });
        }
      };
      const pointerLeave = () => {
        lastHover = null;
        latest.current.onHover(null);
      };
      const pointerStart = (event: PointerEvent) => {
        pointerDown = { x: event.clientX, y: event.clientY };
        pointerMoved = false;
        renderer.domElement.focus({ preventScroll: true });
        // Latch the mode once: modifier changes during a drag never change it.
        const mode: DragMode =
          event.button === 2 || (event.button === 0 && event.ctrlKey)
            ? "pan"
            : "orbit";
        pointers.set(event.pointerId, {
          x: event.clientX,
          y: event.clientY,
          mode,
          button: event.button,
        });
        if (pointers.size > 1) pointerMoved = true;
        renderer.domElement.setPointerCapture(event.pointerId);
        controlStart();
      };
      const pointerEnd = (event: PointerEvent) => {
        const pointer = pointers.get(event.pointerId);
        if (!pointer) return;
        pointers.delete(event.pointerId);
        if (renderer.domElement.hasPointerCapture(event.pointerId))
          renderer.domElement.releasePointerCapture(event.pointerId);
        if (!pointers.size) controlEnd();
        if (
          event.button !== 0 ||
          pointer.mode === "pan" ||
          pointerMoved ||
          Math.hypot(
            event.clientX - pointerDown.x,
            event.clientY - pointerDown.y,
          ) > 5
        )
          return;
        const id = pick(event);
        if (id) latest.current.onSelect(id);
        else latest.current.onDeselect();
      };
      const controlStart = () => {
        cameraController.beginManualControl();
        pointerLeave();
      };
      const controlEnd = () => {
        cameraController.endManualControl();
      };
      const wheel = (event: WheelEvent) => {
        if (
          event.defaultPrevented ||
          !latest.current.visible ||
          document.querySelector('dialog[open],[aria-modal="true"]')
        )
          return;
        if (event.ctrlKey) {
          event.preventDefault();
          cameraController.zoomBy(
            Math.exp(Math.max(-120, Math.min(120, event.deltaY)) * 0.005),
          );
          return;
        }
        const lineHeight =
          parseFloat(getComputedStyle(renderer.domElement).lineHeight) || 16;
        const delta = wheelOrbitDelta(event, width, height, lineHeight);
        if (!delta.yaw && !delta.pitch) return;
        event.preventDefault();
        cameraController.orbitBy(delta);
        pointerLeave();
      };
      renderer.domElement.addEventListener("wheel", wheel, {
        capture: true,
        passive: false,
      });
      const pointers = new Map<number, DragPointer>();
      const touchMetrics = () => {
        const points = [...pointers.values()];
        return {
          x: (points[0].x + points[1].x) / 2,
          y: (points[0].y + points[1].y) / 2,
          distance: Math.hypot(
            points[0].x - points[1].x,
            points[0].y - points[1].y,
          ),
        };
      };
      const cancelPointers = () => {
        const ids = [...pointers.keys()];
        pointers.clear();
        pointerMoved = true;
        for (const id of ids) {
          if (renderer.domElement.hasPointerCapture(id))
            renderer.domElement.releasePointerCapture(id);
        }
        controlEnd();
      };
      const lostPointerCapture = (event: PointerEvent) => {
        if (pointers.has(event.pointerId)) cancelPointers();
      };
      const contextMenu = (event: Event) => event.preventDefault();
      renderer.domElement.addEventListener("pointermove", pointerMove);
      renderer.domElement.addEventListener("pointerleave", pointerLeave);
      renderer.domElement.addEventListener("pointerdown", pointerStart);
      renderer.domElement.addEventListener("pointerup", pointerEnd);
      renderer.domElement.addEventListener("pointercancel", cancelPointers);
      renderer.domElement.addEventListener(
        "lostpointercapture",
        lostPointerCapture,
      );
      renderer.domElement.addEventListener("contextmenu", contextMenu);
      const lostContext = (event: Event) => {
        event.preventDefault();
        setError(true);
      };
      renderer.domElement.addEventListener("webglcontextlost", lostContext);

      api.current = {
        zoom: (factor) => cameraController.zoom(factor),
        reset: () => cameraController.centerGraph(),
        navigateToNode: (id) => cameraController.navigateToNode(id),
        orbit: (key, pressed) => cameraController.setOrbitKey(key, pressed),
        focus: () => renderer.domElement.focus({ preventScroll: true }),
      };
      const projected = new THREE.Vector3();
      let previousTime = performance.now();
      let hidden = document.hidden;
      let executionKey = "";
      let executionStarted = 0;
      const visibility = () => {
        hidden = document.hidden;
        previousTime = performance.now();
        if (hidden) cancelPointers();
        if (hidden) cameraController.cancelWheelOrbit();
      };
      const blur = () => {
        cancelPointers();
        cameraController.cancelWheelOrbit();
      };
      document.addEventListener("visibilitychange", visibility);
      window.addEventListener("blur", blur);

      renderer.setAnimationLoop(() => {
        const now = performance.now();
        const dt = Math.min((now - previousTime) / 1000, 0.05);
        previousTime = now;
        if (hidden || !latest.current.visible) return;
        const state = latest.current;
        const elapsed = now - state.introStartedAt;
        const blend = 1 - Math.exp(-dt * 7);
        if (state.isImmersive !== previousImmersive) {
          const fit = fitDistance();
          cameraController.reframe(fit / previousFit);
          previousFit = fit;
          previousImmersive = state.isImmersive;
        }
        const executionNode = state.running
          ? (state.activeNodeId !== undefined ? state.activeNodeId : steps[state.demoIndex]?.id ?? null)
          : null;
        cameraController.syncExecution(
          state.executionIdentity ?? state.runId,
          executionNode,
          state.running,
          state.terminal ?? state.demoIndex >= steps.length,
        );
        const nextExecutionKey = `${state.executionIdentity ?? state.runId}:${executionNode ?? ""}`;
        if (nextExecutionKey !== executionKey) {
          executionKey = nextExecutionKey;
          executionStarted = now;
        }
        cameraController.update(
          dt,
          now,
          state.isImmersive,
          state.reducedMotion,
        );
        const processing =
          !!executionNode &&
          (state.reducedMotion ||
            (!cameraController.isTransitioning &&
              now - executionStarted >= EXECUTION_FOCUS_SECONDS * 1000));
        container.dataset.executionNode = executionNode ?? "";
        container.dataset.executionPhase = executionNode
          ? processing
            ? "processing"
            : "focusing"
          : "idle";
        const active =
          executionNode ??
          state.selectedNodeId ??
          state.hoveredNodeId ??
          state.focusedNodeId;
        const connected = active ? neighbors.get(active) : null;
        const skipIntro = state.reducedMotion || state.introComplete;
        const formation = skipIntro
          ? 1
          : THREE.MathUtils.smoothstep(elapsed, 350, INTRO_TIMELINE.formation);
        group.scale.setScalar(0.92 + formation * 0.08);
        nodes.forEach((mesh, index) => {
          const node = graph.nodes[index];
          const isMain = node.kind === "workflow";
          mesh.visible = state.showContext || isMain;
          const related =
            !active || active === node.id || connected?.has(node.id);
          const reveal = skipIntro
            ? 1
            : THREE.MathUtils.smoothstep(
                elapsed,
                INTRO_TIMELINE.nodes + index * 5,
                650 + index * 5,
              );
          const hovered = state.hoveredNodeId === node.id;
          const alpha =
            reveal *
            (active === node.id
              ? 1
              : hovered
                ? 0.95
                : related
                  ? isMain
                    ? 0.95
                    : 0.68
                  : executionNode
                    ? 0.3
                    : 0.19);
          mesh.material.opacity += (alpha - mesh.material.opacity) * blend;
          materialColor.setHex(nodeColor(node.id, state.demoIndex, state.nodeStatuses, dataset));
          const selected =
            executionNode === node.id || state.selectedNodeId === node.id;
          materialColor.lerp(
            highlightColor,
            selected
              ? executionNode === node.id && !processing
                ? 0.22
                : 0.45
              : hovered
                ? 0.2
                : 0,
          );
          mesh.material.color.lerp(materialColor, blend);
          const scale =
            mesh.userData.radius * (selected ? 1.22 : hovered ? 1.12 : 1);
          mesh.scale.lerp(targetScale.setScalar(scale), blend);
        });
        lines.forEach((line, i) => {
          const edge = graph.edges[i];
          line.visible = state.showContext || edge.kind === "workflow";
          const related = edge.source === active || edge.target === active;
          const reveal = skipIntro
            ? 1
            : THREE.MathUtils.smoothstep(
                elapsed,
                INTRO_TIMELINE.edges + i * 2,
                1200 + i * 2,
              );
          const hoveredEdge =
            edge.source === state.hoveredNodeId ||
            edge.target === state.hoveredNodeId;
          const alpha =
            reveal *
            (active
              ? related
                ? 0.58
                : hoveredEdge
                  ? 0.3
                  : executionNode
                    ? 0.09
                    : 0.055
              : edge.kind === "workflow"
                ? 0.4
                : 0.17);
          line.material.opacity += (alpha - line.material.opacity) * blend;
        });
        ring.visible =
          !!active && (state.showContext || active.startsWith("N-"));
        if (active && meshes.has(active)) {
          ring.position.copy(meshes.get(active)!.position);
          ring.quaternion.copy(camera.quaternion);
          ring.scale.setScalar(active.startsWith("N-") ? 1 : 0.65);
          ringMaterial.opacity =
            executionNode || state.selectedNodeId ? 0.8 : 0.38;
        }
        const updateHalo = (
          halo: typeof selectedHalo,
          id: string | null,
          selected: boolean,
        ) => {
          const mesh = id ? meshes.get(id) : undefined;
          halo.visible = !!mesh && (state.showContext || id!.startsWith("N-"));
          if (!mesh) return;
          halo.position.copy(mesh.position);
          halo.scale.setScalar(mesh.userData.radius * (selected ? 9 : 7));
          halo.material.color.copy(mesh.material.color);
          halo.material.opacity = formation * (selected ? 0.34 : 0.19);
        };
        updateHalo(selectedHalo, executionNode ?? state.selectedNodeId, true);
        updateHalo(
          hoverHalo,
          state.hoveredNodeId !== state.selectedNodeId
            ? state.hoveredNodeId
            : null,
          false,
        );
        scene.updateMatrixWorld(true);
        labels.forEach((label) => {
          label.element.dataset.status = state.nodeStatuses?.[label.id] ?? "ready";
          const text = `${label.id} · ${statusLabel(state.nodeStatuses?.[label.id] ?? "ready")}`;
          if (label.status.textContent !== text) label.status.textContent = text;
          label.mesh.getWorldPosition(projected);
          projected.project(camera);
          const related =
            !active || active === label.id || connected?.has(label.id);
          label.element.style.transform = `translate(${(projected.x * 0.5 + 0.5) * width + 13}px, ${(-projected.y * 0.5 + 0.5) * height - 13}px)`;
          label.element.style.opacity = String(
            projected.z < 1 && projected.z > -1
              ? formation * (related ? 1 : 0.35)
              : 0,
          );
          label.element.dataset.active = String(active === label.id);
        });
        renderer.render(scene, camera);
      });

      return () => {
        renderer.setAnimationLoop(null);
        cancelPointers();
        observer.disconnect();
        document.removeEventListener("visibilitychange", visibility);
        window.removeEventListener("blur", blur);
        renderer.domElement.removeEventListener("wheel", wheel, true);
        renderer.domElement.removeEventListener("pointermove", pointerMove);
        renderer.domElement.removeEventListener("pointerleave", pointerLeave);
        renderer.domElement.removeEventListener("pointerdown", pointerStart);
        renderer.domElement.removeEventListener("pointerup", pointerEnd);
        renderer.domElement.removeEventListener(
          "pointercancel",
          cancelPointers,
        );
        renderer.domElement.removeEventListener(
          "lostpointercapture",
          lostPointerCapture,
        );
        renderer.domElement.removeEventListener("contextmenu", contextMenu);
        renderer.domElement.removeEventListener(
          "webglcontextlost",
          lostContext,
        );
        sphereGeometry.dispose();
        ringGeometry.dispose();
        ringMaterial.dispose();
        haloTexture.dispose();
        selectedHalo.material.dispose();
        hoverHalo.material.dispose();
        nodes.forEach((mesh) => mesh.material.dispose());
        lines.forEach((line) => {
          line.geometry.dispose();
          line.material.dispose();
        });
        labels.forEach((label) => label.element.remove());
        renderer.dispose();
        renderer.domElement.remove();
      };
    }, [dataset]);

    return (
      <div ref={host} className="graph-renderer" data-testid="graph-renderer">
        <div className="graph-labels" ref={labelHost} aria-hidden="true" />
        {error && (
          <div className="graph-error" role="status">
            <AlertCircle size={24} />
            <h3>3D rendering is unavailable</h3>
            <p>
              Your browser could not initialize WebGL. You can still explore
              every workflow step in Steps view or the node browser.
            </p>
          </div>
        )}
        <div className="graph-origin" aria-hidden="true">
          <Crosshair size={10} />
        </div>
      </div>
    );
  }),
);

export default GraphCanvas;
