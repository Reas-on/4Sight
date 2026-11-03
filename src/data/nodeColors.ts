import { nodeById, statusFor, steps } from "./graph";

// Only existing workflow categories/statuses receive semantic colors.
const categoryColors: Record<string, number> = {
  Detection: 0x849fba,
  Investigation: 0x82a9a5,
  Decision: 0xa395b7,
  Response: 0x85b1bd,
  Review: 0x9aa6b0,
};
export function nodeColor(id: string, demoIndex: number) {
  const node = nodeById.get(id);
  if (!node || node.kind === "metadata") return 0x7e8d99;
  const status = statusFor(id, demoIndex);
  if (status === "complete") return 0x8bb69c;
  if (status === "active") return 0xc4ac80;
  return (
    categoryColors[steps.find((step) => step.id === id)?.category ?? ""] ??
    0x9aa6b0
  );
}
