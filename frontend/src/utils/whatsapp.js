import { fmtDate, fmtTime } from './format';

/**
 * Builds a wa.me deep link with a pre-filled booking message. The core booking
 * flow never depends on WhatsApp; this is an alternative contact channel.
 * (A WhatsApp Business API sender lives behind the backend's channel adapter.)
 */
export function whatsappLink(number, { doctorName, specialty, slot, patientName } = {}) {
  if (!number) return null;
  const digits = number.replace(/[^\d]/g, '');
  const lines = [
    `مرحباً ${doctorName || ''}،`,
    'أرغب في حجز موعد.',
    specialty ? `\nالتخصص:\n${specialty}` : '',
    slot ? `\nاليوم المفضل:\n${fmtDate(slot.startAt)}` : '',
    slot ? `\nالوقت المفضل:\n${fmtTime(slot.startAt)}` : '',
    patientName ? `\nالمريض:\n${patientName}` : '',
    '\n(عبر ميديكس)',
  ].filter(Boolean);
  return `https://wa.me/${digits}?text=${encodeURIComponent(lines.join('\n'))}`;
}
