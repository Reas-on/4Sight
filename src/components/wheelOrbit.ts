type WheelInput = Pick<WheelEvent, "deltaX" | "deltaY" | "deltaMode">;
export const WHEEL_ORBIT_SENSITIVITY = 0.0018;
const MAX_DELTA = 120;

/** Normalize CSS pixel/line/page units, preserving diagonal direction and ratio. */
export function wheelOrbitDelta(
  event: WheelInput,
  width: number,
  height: number,
  lineHeight = 16,
) {
  const xUnit =
    event.deltaMode === 1 ? lineHeight : event.deltaMode === 2 ? width : 1;
  const yUnit =
    event.deltaMode === 1 ? lineHeight : event.deltaMode === 2 ? height : 1;
  const x = Number.isFinite(event.deltaX) ? event.deltaX * xUnit : 0;
  const y = Number.isFinite(event.deltaY) ? event.deltaY * yUnit : 0;
  const limit = Math.min(1, MAX_DELTA / (Math.hypot(x, y) || 1));
  return {
    yaw: x * limit * WHEEL_ORBIT_SENSITIVITY,
    pitch: y * limit * WHEEL_ORBIT_SENSITIVITY,
  };
}
