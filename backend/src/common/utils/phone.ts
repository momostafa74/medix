/**
 * Normalises phone numbers to E.164. Egyptian local formats (01XXXXXXXXX) become
 * +201XXXXXXXXX. Returns null if the input is not a plausible number.
 */
export function normalizePhone(input: string): string | null {
  if (!input) return null;
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
  let s = input.replace(/[٠-٩]/g, (d) => String(arabicDigits.indexOf(d))).replace(/[\s\-()]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (/^01[0125]\d{8}$/.test(s)) s = '+2' + s;
  if (/^201[0125]\d{8}$/.test(s)) s = '+' + s;
  if (!/^\+\d{8,15}$/.test(s)) return null;
  return s;
}
