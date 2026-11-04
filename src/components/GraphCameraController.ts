import { MathUtils, PerspectiveCamera, Quaternion, Vector3 } from "three";
import type { OrbitKey } from "../hooks/useHoldShortcut";

type Transition = {
  fromTarget: Vector3;
  toTarget: Vector3;
  fromDistance: number;
  toDistance: number;
  elapsed: number;
  duration: number;
};
export const CAMERA_TRANSITION_SECONDS = 0.9;
export const EXECUTION_FOCUS_SECONDS = 0.6;

/** One quaternion camera frame for every input. No spherical conversion/lookAt at poles. */
export class GraphCameraController {
  readonly target = new Vector3();
  readonly orientation = new Quaternion();
  readonly minDistance = 12;
  readonly maxDistance = 85;
  private transition: Transition | null = null;
  private keys = new Set<OrbitKey>();
  private manual = false;
  private lastManual = -10000;
  private autoEnabled = true;
  private yawVelocity = 0;
  private pitchVelocity = 0;
  private pendingYaw = 0;
  private pendingPitch = 0;
  private offset = new Vector3();
  private axis = new Vector3();
  private increment = new Quaternion();
  private executionRun: number | string = -1;
  private executionNode: string | null = null;
  private executionRunning = false;
  private pendingFocus: { runId: number | string; nodeId: string } | null = null;
  private focusNode: string | null = null;
  private executionHadFocus = false;

  constructor(
    private camera: PerspectiveCamera,
    private getNodePosition: (id: string) => Vector3 | undefined,
    private fitDistance: () => number,
    private graphRadius: number,
  ) {
    camera.lookAt(this.target);
    this.orientation.copy(camera.quaternion).normalize();
  }
  private distance() {
    return this.camera.position.distanceTo(this.target);
  }
  private apply(distance = this.distance()) {
    this.camera.quaternion.copy(this.orientation);
    this.camera.up.set(0, 1, 0).applyQuaternion(this.orientation);
    this.camera.position
      .copy(this.target)
      .add(this.offset.set(0, 0, distance).applyQuaternion(this.orientation));
    this.camera.updateMatrixWorld();
  }
  private rotate(yaw: number, pitch: number) {
    const angle = Math.hypot(yaw, pitch);
    if (angle) {
      this.axis.set(pitch / angle, yaw / angle, 0);
      this.increment.setFromAxisAngle(this.axis, angle);
      this.orientation.multiply(this.increment).normalize();
    }
  }
  private moveTo(
    target: Vector3,
    distance: number,
    duration = CAMERA_TRANSITION_SECONDS,
  ) {
    this.cancelWheelOrbit();
    this.yawVelocity = 0;
    this.pitchVelocity = 0;
    this.lastManual = performance.now();
    this.transition = {
      fromTarget: this.target.clone(),
      toTarget: target.clone(),
      fromDistance: this.distance(),
      toDistance: MathUtils.clamp(distance, this.minDistance, this.maxDistance),
      elapsed: 0,
      duration,
    };
  }
  initializeDistance(distance: number) {
    this.apply(MathUtils.clamp(distance, this.minDistance, this.maxDistance));
  }
  navigateToNode(id: string, execution = false) {
    const target = this.getNodePosition(id);
    if (!target) return false;
    this.focusNode = execution ? id : null;
    this.moveTo(
      target,
      execution
        ? Math.max(
            this.minDistance,
            this.graphRadius + target.length() + 2,
            Math.min(this.distance(), this.fitDistance()),
          )
        : Math.max(
            this.distance(),
            this.graphRadius +
              Math.max(this.target.length(), target.length()) +
              2,
            this.fitDistance() * 0.72,
          ),
      execution ? EXECUTION_FOCUS_SECONDS : CAMERA_TRANSITION_SECONDS,
    );
    return true;
  }
  /** Step/run identity is the only automatic-focus trigger; manual input wins
   * for the remainder of a step and the next step may request focus again. */
  syncExecution(
    runId: number | string,
    nodeId: string | null,
    running: boolean,
    completed: boolean,
  ) {
    const changed =
      runId !== this.executionRun ||
      nodeId !== this.executionNode ||
      running !== this.executionRunning;
    if (!changed) return;
    if (running && !this.executionRunning) this.executionHadFocus = false;
    this.executionRun = runId;
    this.executionNode = nodeId;
    this.executionRunning = running;
    this.pendingFocus = null;
    this.focusNode = null;
    this.cancelTransition();
    if (this.manual || this.keys.size || this.hasWheelOrbit()) return;
    if (running && nodeId) {
      this.pendingFocus = { runId, nodeId };
      this.resolvePendingFocus();
    }
    else if (completed && this.executionHadFocus) {
      this.executionHadFocus = false;
      this.centerGraph();
    }
  }
  /** Retry on graph readiness, not a timeout. Step changes/cancel/manual input
   * invalidate the request, so late node registration cannot steal the camera. */
  private resolvePendingFocus() {
    const pending = this.pendingFocus;
    if (!pending || this.manual || this.keys.size || this.hasWheelOrbit()) return;
    if (pending.runId !== this.executionRun || pending.nodeId !== this.executionNode || !this.executionRunning) {
      this.pendingFocus = null; return;
    }
    if (this.navigateToNode(pending.nodeId, true)) {
      this.pendingFocus = null;
      this.executionHadFocus = true;
    }
  }
  get executionFocusNode() { return this.focusNode; }
  centerGraph() {
    this.moveTo(new Vector3(), this.fitDistance());
  }
  zoom(factor: number) {
    this.moveTo(this.target, this.distance() * factor);
  }
  zoomBy(factor: number) {
    this.cancelTransition();
    this.apply(
      MathUtils.clamp(
        this.distance() * factor,
        this.minDistance,
        this.maxDistance,
      ),
    );
    this.lastManual = performance.now();
  }
  pan(x: number, y: number) {
    const distance = this.distance();
    const scale =
      2 * distance * Math.tan(MathUtils.degToRad(this.camera.fov / 2));
    this.target.add(
      this.offset
        .set(-x * scale, y * scale, 0)
        .applyQuaternion(this.orientation),
    );
    this.apply(distance);
  }
  panBy(x: number, y: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.beginManualControl();
    this.pan(x, y);
    this.endManualControl();
  }
  setGraphRadius(radius: number) { this.graphRadius = radius; }
  reframe(ratio: number) {
    if (!this.manual && !this.keys.size && !this.hasWheelOrbit())
      this.moveTo(
        this.transition?.toTarget ?? this.target,
        (this.transition?.toDistance ?? this.distance()) * ratio,
      );
  }
  cancelTransition() {
    this.transition = null;
    this.pendingFocus = null;
    this.focusNode = null;
  }
  get isTransitioning() {
    return this.transition !== null;
  }
  beginManualControl() {
    this.cancelWheelOrbit();
    this.cancelTransition();
    this.manual = true;
    this.focusNode = null;
    this.yawVelocity = 0;
    this.pitchVelocity = 0;
    this.lastManual = performance.now();
  }
  endManualControl() {
    this.manual = false;
    this.lastManual = performance.now();
  }
  dragBy(yaw: number, pitch: number) {
    this.rotate(yaw, pitch);
    this.apply();
  }
  setOrbitKey(key: OrbitKey, pressed: boolean) {
    if (pressed) {
      this.cancelWheelOrbit();
      this.cancelTransition();
      this.keys.add(key);
    } else this.keys.delete(key);
    this.lastManual = performance.now();
  }
  setAutoRotation(enabled: boolean) {
    this.autoEnabled = enabled;
  }
  private hasWheelOrbit() {
    return Math.abs(this.pendingYaw) + Math.abs(this.pendingPitch) > 0.00001;
  }
  cancelWheelOrbit() {
    this.pendingYaw = 0;
    this.pendingPitch = 0;
  }
  orbitBy({ yaw, pitch }: { yaw: number; pitch: number }) {
    if (this.manual || !Number.isFinite(yaw) || !Number.isFinite(pitch)) return;
    this.cancelTransition();
    this.pendingYaw += yaw;
    this.pendingPitch += pitch;
    const limit = Math.min(
      1,
      0.6 / (Math.hypot(this.pendingYaw, this.pendingPitch) || 1),
    );
    this.pendingYaw *= limit;
    this.pendingPitch *= limit;
    this.yawVelocity = 0;
    this.pitchVelocity = 0;
    this.lastManual = performance.now();
  }
  update(dt: number, now: number, immersive: boolean, reduced: boolean) {
    this.resolvePendingFocus();
    if (this.transition && !this.manual) {
      const move = this.transition;
      move.elapsed += dt;
      const t = reduced ? 1 : Math.min(1, move.elapsed / move.duration);
      const eased = t * t * (3 - 2 * t);
      this.target.lerpVectors(move.fromTarget, move.toTarget, eased);
      this.apply(MathUtils.lerp(move.fromDistance, move.toDistance, eased));
      if (t >= 1) {
        this.transition = null;
        this.lastManual = now;
      }
      return;
    }
    if (this.manual) return;
    const blend = 1 - Math.exp(-dt * 7);
    let yaw = 0;
    let pitch = 0;
    if (this.keys.size) {
      yaw =
        (Number(this.keys.has("ArrowRight")) -
          Number(this.keys.has("ArrowLeft"))) *
        0.65;
      pitch =
        (Number(this.keys.has("ArrowDown")) -
          Number(this.keys.has("ArrowUp"))) *
        0.5;
      this.lastManual = now;
    } else if (
      this.autoEnabled &&
      !this.executionRunning &&
      !reduced &&
      !this.hasWheelOrbit()
    ) {
      const idle = MathUtils.clamp((now - this.lastManual - 3500) / 2000, 0, 1);
      yaw =
        (immersive ? -0.024 : -0.007) *
        idle *
        (0.85 + Math.sin(now / 21000) * 0.15);
      pitch = Math.cos(now / 16000) * 0.0008 * idle;
    }
    this.yawVelocity += (yaw - this.yawVelocity) * blend;
    this.pitchVelocity += (pitch - this.pitchVelocity) * blend;
    if (reduced && !this.keys.size) {
      this.yawVelocity = 0;
      this.pitchVelocity = 0;
    }
    const wheelBlend = 1 - Math.exp(-dt * 14);
    const wheelYaw = this.pendingYaw * wheelBlend;
    const wheelPitch = this.pendingPitch * wheelBlend;
    this.pendingYaw -= wheelYaw;
    this.pendingPitch -= wheelPitch;
    this.rotate(
      this.yawVelocity * dt + wheelYaw,
      this.pitchVelocity * dt + wheelPitch,
    );
    this.apply();
  }
}
