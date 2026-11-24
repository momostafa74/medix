import ar from './ar';
import en from './en';

/**
 * Minimal i18n layer. Arabic is primary; English keys can be filled in en.js and
 * switched via setLocale(). Components call t('key', { var }) — never hard-code UI copy
 * that may need translating.
 */
const dictionaries = { ar, en };
let locale = (typeof localStorage !== 'undefined' && safeGet('medix.locale')) || 'ar';

function safeGet(k) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

export const getLocale = () => locale;
export function setLocale(l) {
  locale = dictionaries[l] ? l : 'ar';
  try {
    localStorage.setItem('medix.locale', locale);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
}

export function t(key, vars) {
  const s = dictionaries[locale]?.[key] ?? dictionaries.ar[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? '').toString()) : s;
}
