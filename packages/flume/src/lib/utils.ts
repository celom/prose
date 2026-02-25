/**
 * Check if a value is a plain object (not array, Date, Map, Set, etc.)
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Deep merge utility for combining objects recursively.
 * - Plain objects are merged recursively
 * - Arrays are concatenated (not overwritten)
 * - Non-plain objects (Date, Map, Set, etc.) are treated as primitives
 */
export function deepMerge(
  ...objects: Array<Record<string, unknown> | null | undefined>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const obj of objects) {
    if (!isPlainObject(obj)) continue;

    for (const key in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;

      const existingVal = result[key];
      const newVal = obj[key];

      if (Array.isArray(newVal)) {
        // Arrays: concatenate with existing array or create new array
        if (Array.isArray(existingVal)) {
          result[key] = [...existingVal, ...newVal];
        } else {
          result[key] = [...newVal];
        }
      } else if (isPlainObject(newVal)) {
        // Plain objects: recursively merge
        if (isPlainObject(existingVal)) {
          result[key] = deepMerge(existingVal, newVal);
        } else {
          result[key] = deepMerge({}, newVal);
        }
      } else {
        // Primitives and non-plain objects: overwrite
        result[key] = newVal;
      }
    }
  }

  return result;
}
