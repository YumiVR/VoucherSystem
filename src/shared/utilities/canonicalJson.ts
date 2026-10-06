export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function ser(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new Error('Non-finite number cannot be canonicalised');
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(ser).join(',')}]`;
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj).sort();
      const parts: string[] = [];
      for (const k of keys) {
        const v = obj[k];
        if (v === undefined) throw new Error('Undefined values cannot be canonicalised');
        parts.push(`${JSON.stringify(k)}:${ser(v)}`);
      }
      return `{${parts.join(',')}}`;
    }
    default:
      throw new Error('Unsupported value in canonical JSON');
  }
}

/** Deterministic JSON: keys sorted by code unit order, no whitespace. */
export function canonicalJson(value: unknown): string {
  return ser(value);
}
