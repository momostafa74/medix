import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';

const TAGS = /<\/?[a-z][^>]*>/gi;
const SCRIPTY = /(javascript:|on\w+\s*=)/gi;

function clean(value: unknown, depth = 0): unknown {
  if (depth > 8) return value;
  if (typeof value === 'string') return value.replace(TAGS, '').replace(SCRIPTY, '').trim();
  if (Array.isArray(value)) return value.map((v) => clean(v, depth + 1));
  if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      out[k] = k.toLowerCase().includes('password') ? v : clean(v, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * Input sanitisation (defence in depth against stored XSS): strips HTML tags and
 * inline handlers from every incoming body/query string. Passwords are untouched.
 * React escapes on output as the primary XSS defence.
 */
@Injectable()
export class SanitizePipe implements PipeTransform {
  transform(value: unknown, meta: ArgumentMetadata) {
    if (meta.type === 'body' || meta.type === 'query') return clean(value);
    return value;
  }
}
