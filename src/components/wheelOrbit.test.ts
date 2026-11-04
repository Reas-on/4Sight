import { describe, expect, it } from "vitest";
import { wheelGesture, wheelPanDelta, wheelOrbitDelta, WHEEL_ORBIT_SENSITIVITY } from "./wheelOrbit";

it('distinguishes physical Ctrl pan from synthesized pinch and normal orbit', () => {
  const event = { ctrlKey: true, altKey: false, metaKey: false };
  expect(wheelGesture(event, true)).toBe('pan');
  expect(wheelGesture(event, false)).toBe('pinch');
  expect(wheelGesture({ ...event, ctrlKey: false }, false)).toBe('orbit');
  expect(wheelGesture({ ...event, metaKey: true }, true)).toBe('native');
  expect(wheelPanDelta({ deltaX: 16, deltaY: -32, deltaMode: 0 }, 800, 600)).toEqual({ x: 16 / 600, y: -32 / 600 });
  expect(wheelPanDelta({ deltaX: 1, deltaY: -2, deltaMode: 1 }, 800, 600)).toEqual({ x: 16 / 600, y: -32 / 600 });
});

describe("normalized wheel orbit", () => {
  it("preserves independent fractional pixel axes and diagonal direction", () => {
    expect(
      wheelOrbitDelta({ deltaX: 2.5, deltaY: -3.5, deltaMode: 0 }, 800, 600),
    ).toEqual({
      yaw: 2.5 * WHEEL_ORBIT_SENSITIVITY,
      pitch: -3.5 * WHEEL_ORBIT_SENSITIVITY,
    });
    expect(
      wheelOrbitDelta({ deltaX: 10, deltaY: 0, deltaMode: 0 }, 800, 600).pitch,
    ).toBe(0);
    expect(
      wheelOrbitDelta({ deltaX: 0, deltaY: 10, deltaMode: 0 }, 800, 600).yaw,
    ).toBe(0);
  });
  it("normalizes mouse line units and browser page units", () => {
    expect(
      wheelOrbitDelta({ deltaX: 1, deltaY: 2, deltaMode: 1 }, 800, 600),
    ).toEqual(
      wheelOrbitDelta({ deltaX: 16, deltaY: 32, deltaMode: 0 }, 800, 600),
    );
    expect(
      wheelOrbitDelta({ deltaX: 0.1, deltaY: 0.1, deltaMode: 2 }, 800, 600),
    ).toEqual(
      wheelOrbitDelta({ deltaX: 80, deltaY: 60, deltaMode: 0 }, 800, 600),
    );
  });
  it("limits large inputs without losing the diagonal ratio, ignores nonfinite input", () => {
    const delta = wheelOrbitDelta(
      { deltaX: 10000, deltaY: -5000, deltaMode: 0 },
      800,
      600,
    );
    expect(Math.hypot(delta.yaw, delta.pitch)).toBeCloseTo(
      120 * WHEEL_ORBIT_SENSITIVITY,
    );
    expect(delta.yaw / delta.pitch).toBeCloseTo(-2);
    expect(
      wheelOrbitDelta(
        { deltaX: NaN, deltaY: Infinity, deltaMode: 0 },
        800,
        600,
      ),
    ).toEqual({ yaw: 0, pitch: 0 });
  });
});
