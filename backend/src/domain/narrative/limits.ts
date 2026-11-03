import { NarrativeValidationError } from './errors.js';

export function assertBoundedNarrativeData(value: unknown): void {
  const stack: { value: unknown; depth: number; exit?: boolean }[] = [{ value, depth: 0 }];
  const ancestors = new Set<object>();
  let nodes = 0;
  let bytes = 0;
  while (stack.length) {
    const item = stack.pop()!;
    if (item.exit) { ancestors.delete(item.value as object); continue; }
    if (++nodes > 20_000 || item.depth > 32) throw new NarrativeValidationError('Narrative structure exceeds resource limits');
    if (typeof item.value === 'string') bytes += Buffer.byteLength(item.value);
    else if (typeof item.value === 'object' && item.value !== null) {
      const object = item.value;
      if (Array.isArray(object) && (object.length > 1000 || Object.keys(object).length !== object.length ||
          Object.keys(object).some((key) => !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= object.length))) {
        throw new NarrativeValidationError('Narrative arrays must be dense and bounded');
      }
      if (Object.getOwnPropertySymbols(object).length) throw new NarrativeValidationError('Symbol properties are not JSON data');
      if (ancestors.has(object)) throw new NarrativeValidationError('Cyclic narrative data is not allowed');
      if (!Array.isArray(object) && ![Object.prototype, null].includes(Object.getPrototypeOf(object))) {
        throw new NarrativeValidationError('Narrative data must contain plain JSON objects');
      }
      ancestors.add(object);
      stack.push({ value: object, depth: item.depth, exit: true });
      const descriptors = Object.getOwnPropertyDescriptors(object);
      if (Object.keys(descriptors).length > 1000) throw new NarrativeValidationError('Narrative collection exceeds resource limits');
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (Array.isArray(object) && key === 'length') continue;
        if (['__proto__', 'prototype', 'constructor'].includes(key) || !('value' in descriptor)) {
          throw new NarrativeValidationError('Unsafe narrative property');
        }
        bytes += Buffer.byteLength(key);
        stack.push({ value: descriptor.value, depth: item.depth + 1 });
      }
    } else if (typeof item.value !== 'boolean' && item.value !== null &&
      !(typeof item.value === 'number' && Number.isFinite(item.value))) {
      throw new NarrativeValidationError('Narrative data must be JSON serializable');
    }
    if (bytes > 262_144) throw new NarrativeValidationError('Narrative data exceeds 256 KiB');
  }
}
