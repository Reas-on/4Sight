function freezeData<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach((child: unknown) => freezeData(child));
    Object.freeze(value);
  }
  return value;
}

export function immutableDataSnapshot<T>(value: T): T {
  return freezeData(structuredClone(value));
}
