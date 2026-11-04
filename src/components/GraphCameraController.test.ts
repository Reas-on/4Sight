import { describe, expect, it, vi } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { GraphCameraController } from "./GraphCameraController";

function setup() {
  const camera = new PerspectiveCamera(40, 1.5, 0.1, 200);
  camera.position.set(0, 1, 30);
  const positions = new Map([
    ["N-01", new Vector3(-5, 3, 2)],
    ["N-03", new Vector3(4, 0, 3)],
  ]);
  const controller = new GraphCameraController(
    camera,
    (id) => positions.get(id),
    () => 32,
    9,
  );
  controller.target.set(3, 0, 0);
  controller.initializeDistance(30);
  const controls = { target: controller.target };
  controller.setAutoRotation(false);
  const advance = (seconds: number, reduced = false) => {
    for (let i = 0; i < seconds * 60; i++)
      controller.update(1 / 60, performance.now(), false, reduced);
  };
  return { camera, controls, controller, advance };
}

describe("shared graph camera controller", () => {
  it('retains dynamic focus until registration and fences stale/cancelled/manual requests', () => {
    const camera = new PerspectiveCamera(40, 1.5, 0.1, 200); camera.position.set(0, 0, 30);
    const positions = new Map<string, Vector3>();
    const controller = new GraphCameraController(camera, id => positions.get(id), () => 30, 9);
    controller.syncExecution('run:4', 'N-04', true, false);
    controller.update(0.1, 0, false, false);
    expect(controller.executionFocusNode).toBeNull();
    positions.set('N-04', new Vector3(5, 3, 2));
    controller.update(0.7, 700, false, false);
    expect(controller.executionFocusNode).toBe('N-04');
    expect(controller.target.toArray()).toEqual([5, 3, 2]);
    controller.syncExecution('run:5', 'N-05', true, false);
    controller.syncExecution('run:5', null, false, false);
    positions.set('N-05', new Vector3(8, 2, 1));
    controller.update(0.7, 1400, false, false);
    expect(controller.target.toArray()).toEqual([5, 3, 2]);
    controller.syncExecution('run:6', 'N-06', true, false);
    controller.panBy(0.01, 0.01);
    const manual = controller.target.clone();
    positions.set('N-06', new Vector3(10, 3, 0));
    controller.update(0.7, 2100, false, false);
    expect(controller.target.equals(manual)).toBe(true);
    controller.syncExecution('run:7', 'N-06', true, false);
    controller.update(0.7, 2800, false, false);
    expect(controller.target.toArray()).toEqual([10, 3, 0]);
  });
  it('returns to overview when completion follows a committed no-active-node frame', () => {
    const { controller, advance } = setup();
    controller.syncExecution('run:3', 'N-03', true, false);
    advance(0.7);
    controller.syncExecution('run:3', null, true, false);
    controller.syncExecution('run:3', null, false, true);
    advance(1);
    expect(controller.target.length()).toBeCloseTo(0);
  });
  it('wheel pan respects orientation and distance without orbiting or resuming old focus', () => {
    const { camera, controller, advance } = setup();
    controller.dragBy(0.8, 0.4);
    controller.navigateToNode('N-01');
    const target = controller.target.clone();
    const orientation = camera.quaternion.clone();
    const distance = camera.position.distanceTo(target);
    controller.panBy(0.02, -0.03);
    const delta = controller.target.clone().sub(target);
    expect(delta.dot(new Vector3(0, 0, 1).applyQuaternion(orientation))).toBeCloseTo(0);
    expect(camera.quaternion.angleTo(orientation)).toBeCloseTo(0);
    expect(camera.position.distanceTo(controller.target)).toBeCloseTo(distance);
    const after = controller.target.clone(); advance(1);
    expect(controller.target.distanceTo(after)).toBeCloseTo(0);
    controller.initializeDistance(distance * 2);
    controller.panBy(0.02, -0.03);
    expect(controller.target.distanceTo(after)).toBeCloseTo(delta.length() * 2);
  });
  it("execution focus yields for the current step, resumes next step and returns to overview", () => {
    const { controller, camera, advance } = setup();
    controller.syncExecution(1, "N-01", true, false);
    advance(0.7);
    expect(controller.target.toArray()).toEqual([-5, 3, 2]);
    controller.beginManualControl();
    controller.pan(0.02, 0.01);
    controller.endManualControl();
    const manual = controller.target.clone();
    controller.syncExecution(1, "N-01", true, false);
    advance(0.4);
    expect(controller.target.equals(manual)).toBe(true);
    controller.syncExecution(1, "N-03", true, false);
    advance(0.2);
    const midway = controller.target.clone();
    controller.syncExecution(1, null, false, false);
    advance(1);
    expect(controller.target.equals(midway)).toBe(true);
    controller.syncExecution(2, "N-01", true, false);
    advance(0.7);
    expect(controller.target.toArray()).toEqual([-5, 3, 2]);
    controller.syncExecution(2, null, false, true);
    advance(1);
    expect(controller.target.length()).toBeCloseTo(0);
    expect(camera.position.length()).toBeCloseTo(32);
  });
  it("animates target and distance when centering without an immediate jump", () => {
    const { camera, controls, controller, advance } = setup();
    const before = camera.position.clone();
    controller.centerGraph();
    expect(camera.position.equals(before)).toBe(true);
    expect(controls.target.x).toBe(3);
    advance(0.3);
    expect(controls.target.x).toBeGreaterThan(0);
    expect(controls.target.x).toBeLessThan(3);
    advance(1);
    expect(controls.target.length()).toBeCloseTo(0);
    expect(camera.position.length()).toBeCloseTo(32);
  });
  it("resolves stable IDs, smoothly retargets, and ignores missing IDs", () => {
    const { camera, controls, controller, advance } = setup();
    const before = camera.position.clone();
    controller.navigateToNode("N-01");
    expect(camera.position.equals(before)).toBe(true);
    advance(0.3);
    const middle = controls.target.clone();
    controller.navigateToNode("N-03");
    expect(controls.target.equals(middle)).toBe(true);
    advance(1);
    expect(controls.target.toArray()).toEqual([4, 0, 3]);
    controller.navigateToNode("missing");
    advance(1);
    expect(controls.target.toArray()).toEqual([4, 0, 3]);
    expect(camera.position.length()).toBeGreaterThan(9);
  });
  it("manual takeover cancels navigation without snapping back", () => {
    const { camera, controls, controller, advance } = setup();
    controller.navigateToNode("N-01");
    advance(0.2);
    controller.beginManualControl();
    const target = controls.target.clone();
    controller.dragBy(0.1, 0.02);
    const manual = camera.position.clone();
    advance(1);
    controller.endManualControl();
    advance(1);
    expect(controls.target.equals(target)).toBe(true);
    expect(camera.position.distanceTo(manual)).toBeLessThan(0.00001);
  });
  it("keyboard orbit is delta-time based and leaves the target intact", () => {
    const a = setup();
    const b = setup();
    const target = a.controls.target.clone();
    a.controller.setOrbitKey("ArrowRight", true);
    b.controller.setOrbitKey("ArrowRight", true);
    for (let i = 0; i < 60; i++)
      a.controller.update(1 / 60, 1000, false, false);
    for (let i = 0; i < 120; i++)
      b.controller.update(1 / 120, 1000, false, false);
    expect(a.camera.position.x).toBeGreaterThan(10);
    expect(a.controls.target.equals(target)).toBe(true);
    expect(a.camera.position.distanceTo(b.camera.position)).toBeLessThan(0.1);
  });
  it("repeated center commands replace the transition and reduced motion completes immediately", () => {
    const { controls, controller, advance } = setup();
    controller.centerGraph();
    advance(0.2);
    controller.centerGraph();
    advance(1);
    expect(controls.target.length()).toBeCloseTo(0);
    controller.navigateToNode("N-01");
    advance(1 / 60, true);
    expect(controls.target.toArray()).toEqual([-5, 3, 2]);
  });
  it("idle movement yields immediately and resumes gradually after inactivity with bounded pitch", () => {
    const { camera, controls, controller } = setup();
    controller.setAutoRotation(true);
    controller.beginManualControl();
    controller.endManualControl();
    const now = performance.now();
    const before = camera.position.clone();
    for (let i = 0; i < 180; i++)
      controller.update(1 / 60, now + (i * 1000) / 60, true, false);
    expect(camera.position.distanceTo(before)).toBeLessThan(0.00001);
    for (let i = 180; i < 600; i++)
      controller.update(1 / 60, now + (i * 1000) / 60, true, false);
    expect(camera.position.distanceTo(before)).toBeGreaterThan(0.1);
    const radius = camera.position.distanceTo(controls.target);
    for (let i = 600; i < 12000; i++)
      controller.update(1 / 60, now + (i * 1000) / 60, true, false);
    expect(camera.position.distanceTo(controls.target)).toBeCloseTo(radius);
    expect(Math.abs(camera.position.y - before.y)).toBeLessThan(2);
    controller.beginManualControl();
    const takeover = camera.position.clone();
    for (let i = 0; i < 60; i++)
      controller.update(1 / 60, now + 201000, true, false);
    expect(camera.position.equals(takeover)).toBe(true);
  });
  it("wheel orbit changes both axes smoothly without changing target or camera distance", () => {
    const { camera, controls, controller, advance } = setup();
    const before = camera.position.clone();
    const target = controls.target.clone();
    const distance = camera.position.distanceTo(target);
    controller.orbitBy({ yaw: 0.2, pitch: 0.1 });
    expect(camera.position.equals(before)).toBe(true);
    advance(1 / 60, true);
    const first = camera.position.clone();
    expect(first.distanceTo(before)).toBeGreaterThan(0);
    expect(first.distanceTo(before)).toBeLessThan(2);
    advance(1, true);
    expect(camera.position.x).toBeGreaterThan(before.x);
    expect(camera.position.y).toBeLessThan(before.y);
    expect(camera.position.distanceTo(target)).toBeCloseTo(distance, 8);
    expect(controls.target.equals(target)).toBe(true);
  });
  it("wheel integration is frame-rate independent", () => {
    const a = setup();
    const b = setup();
    a.controller.orbitBy({ yaw: 0.2, pitch: 0.1 });
    b.controller.orbitBy({ yaw: 0.2, pitch: 0.1 });
    for (let i = 0; i < 60; i++)
      a.controller.update(1 / 60, 1000, false, false);
    for (let i = 0; i < 144; i++)
      b.controller.update(1 / 144, 1000, false, false);
    expect(a.camera.position.distanceTo(b.camera.position)).toBeLessThan(
      0.000001,
    );
  });
  it.each([Math.PI * 2, -Math.PI * 2, Math.PI * 8, -Math.PI * 8])(
    "passes both poles and completes %r radians with continuous normalized orientation",
    (angle) => {
      const { camera, controller } = setup();
      controller.target.set(0, 0, 0);
      controller.initializeDistance(30);
      const start = controller.orientation.clone();
      let prior = start.clone();
      for (let i = 0; i < 720; i++) {
        controller.dragBy(0, angle / 720);
        expect(Math.abs(controller.orientation.length() - 1)).toBeLessThan(
          1e-12,
        );
        expect(prior.angleTo(controller.orientation)).toBeLessThan(0.04);
        prior.copy(controller.orientation);
      }
      expect(start.angleTo(controller.orientation)).toBeLessThan(1e-6);
      expect(camera.position.length()).toBeCloseTo(30, 8);
    },
  );
  it("supports multiple yaw revolutions, diagonal orbit and inverted navigation/center without orientation resets", () => {
    const { controller, camera, advance } = setup();
    const start = controller.orientation.clone();
    for (let i = 0; i < 720; i++) controller.dragBy((Math.PI * 8) / 720, 0);
    expect(start.angleTo(controller.orientation)).toBeLessThan(1e-6);
    controller.dragBy(0, Math.PI);
    const inverted = controller.orientation.clone();
    controller.navigateToNode("N-01");
    advance(1);
    expect(controller.target.toArray()).toEqual([-5, 3, 2]);
    expect(inverted.angleTo(controller.orientation)).toBeLessThan(1e-6);
    controller.centerGraph();
    advance(1);
    expect(controller.target.length()).toBeCloseTo(0);
    expect(inverted.angleTo(controller.orientation)).toBeLessThan(1e-6);
    for (let i = 0; i < 1000; i++) controller.dragBy(0.02, 0.03);
    expect(camera.position.toArray().every(Number.isFinite)).toBe(true);
    expect(controller.orientation.length()).toBeCloseTo(1, 12);
  });
  it.each([1, -1])(
    "wheel pitch crosses both poles over multiple revolutions (direction %i)",
    (direction) => {
      const { controller, advance, camera } = setup();
      const initial = controller.orientation.clone();
      const distance = camera.position.distanceTo(controller.target);
      for (let i = 0; i < 128; i++) {
        controller.orbitBy({ yaw: 0, pitch: (direction * Math.PI) / 16 });
        advance(1);
      }
      expect(initial.angleTo(controller.orientation)).toBeLessThan(0.00001);
      expect(camera.position.distanceTo(controller.target)).toBeCloseTo(
        distance,
        8,
      );
    },
  );
  it("arrow pitch passes inversion and pan preserves distance in the inverted frame", () => {
    const { controller, advance, camera } = setup();
    controller.setOrbitKey("ArrowDown", true);
    advance(7);
    controller.setOrbitKey("ArrowDown", false);
    advance(1);
    expect(camera.up.y).toBeLessThan(-0.8);
    const distance = camera.position.distanceTo(controller.target);
    controller.pan(0.1, 0.15);
    expect(camera.position.distanceTo(controller.target)).toBeCloseTo(
      distance,
      8,
    );
  });
  it("manual pan translates camera and target equally without rotating and cancels navigation", () => {
    const { controller, camera, advance } = setup();
    controller.navigateToNode("N-01");
    advance(0.2);
    controller.beginManualControl();
    const position = camera.position.clone();
    const target = controller.target.clone();
    const orientation = controller.orientation.clone();
    const distance = position.distanceTo(target);
    controller.pan(0.08, -0.04);
    expect(
      camera.position
        .clone()
        .sub(position)
        .distanceTo(controller.target.clone().sub(target)),
    ).toBeLessThan(1e-8);
    expect(camera.position.distanceTo(controller.target)).toBeCloseTo(
      distance,
      8,
    );
    expect(orientation.angleTo(controller.orientation)).toBeLessThan(1e-8);
    const after = controller.target.clone();
    advance(1);
    controller.endManualControl();
    advance(1);
    expect(controller.target.equals(after)).toBe(true);
    controller.centerGraph();
    advance(1);
    expect(controller.target.length()).toBeCloseTo(0);
    expect(camera.position.length()).toBeCloseTo(32);
  });
  it("idle orbit resumes after pan inactivity and future node navigation still settles correctly", () => {
    const { controller, camera, advance } = setup();
    controller.setAutoRotation(true);
    controller.beginManualControl();
    controller.pan(0.06, 0.02);
    controller.endManualControl();
    const now = performance.now();
    const position = camera.position.clone();
    for (let i = 0; i < 180; i++)
      controller.update(1 / 60, now + (i * 1000) / 60, false, false);
    expect(camera.position.distanceTo(position)).toBeLessThan(1e-8);
    for (let i = 180; i < 420; i++)
      controller.update(1 / 60, now + (i * 1000) / 60, false, false);
    expect(camera.position.distanceTo(position)).toBeGreaterThan(0.05);
    controller.navigateToNode("N-03");
    advance(1);
    expect(controller.target.toArray()).toEqual([4, 0, 3]);
  });
  it("wheel interrupts navigation, manual drag cancels wheel inertia, zoom buttons still work", () => {
    const { camera, controls, controller, advance } = setup();
    controller.navigateToNode("N-01");
    advance(0.2);
    const target = controls.target.clone();
    controller.orbitBy({ yaw: 0.2, pitch: 0 });
    advance(1);
    expect(controls.target.equals(target)).toBe(true);
    controller.orbitBy({ yaw: 0.2, pitch: 0.1 });
    controller.beginManualControl();
    const takeover = camera.position.clone();
    advance(0.5);
    expect(camera.position.equals(takeover)).toBe(true);
    controller.endManualControl();
    const distance = camera.position.distanceTo(target);
    controller.zoom(0.85);
    advance(1);
    expect(camera.position.distanceTo(target)).toBeCloseTo(distance * 0.85);
  });
});
