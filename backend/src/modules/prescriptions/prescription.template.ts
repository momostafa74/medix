import { esc } from '../pdf/pdf.service';

export interface RxPdfData {
  fontCss: string;
  platformName: string;
  doctor: { name: string; specialty?: string | null; license?: string | null; clinic?: string | null; address?: string | null; phone?: string | null };
  patient: { name: string; age?: number | null; gender?: string | null };
  rx: { code: string; issuedAt: string; validUntil?: string | null; diagnosis?: string | null; notes?: string | null; state: string; stateLabel: string };
  items: { name: string; dose: string; frequency: string; duration: string; quantity?: number | null; instructions?: string | null }[];
  qrDataUrl: string;
  verificationCode: string;
}

const C = { petrol: '#0F4C5C', ink: '#13252B', mint: '#E7F3EF', paper: '#F6F8F8', saffron: '#E9A23B', signal: '#C8432B', line: '#D9E2E2', muted: '#5B6B70' };

/** A5-friendly, print-ready Arabic prescription (self-contained, embedded font). */
export function prescriptionHtml(d: RxPdfData): string {
  const void_ = d.rx.state !== 'ACTIVE';
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(d.rx.code)}</title><style>
${d.fontCss}
*{box-sizing:border-box} html,body{margin:0;padding:0}
body{font-family:'Plex Arabic','DejaVu Sans',sans-serif;color:${C.ink};font-size:12px;line-height:1.6;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.head{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:10px;border-bottom:3px solid ${C.petrol}}
.dr h1{margin:0;font-size:19px;color:${C.petrol}}
.dr .s{color:${C.muted};font-size:11px}
.rxmark{font-size:40px;font-weight:700;color:${C.petrol};line-height:1;font-family:serif;direction:ltr}
.meta{display:flex;justify-content:space-between;gap:12px;background:${C.paper};border:1px solid ${C.line};border-radius:10px;padding:8px 12px;margin:12px 0}
.meta div span{display:block;color:${C.muted};font-size:10px} .meta div b{font-weight:600}
.dx{margin:6px 0 10px} .dx b{color:${C.petrol}}
ol{margin:0;padding:0;list-style:none;counter-reset:m}
li{counter-increment:m;display:grid;grid-template-columns:28px 1fr;gap:8px;padding:9px 0;border-bottom:1px dashed ${C.line};break-inside:avoid}
li:before{content:counter(m);width:24px;height:24px;border-radius:50%;background:${C.mint};color:${C.petrol};font-weight:700;display:flex;align-items:center;justify-content:center;font-size:12px}
.name{font-size:14px;font-weight:700;direction:ltr;text-align:right}
.sig{color:${C.ink}} .sig span{display:inline-block;margin-left:14px} .sig em{font-style:normal;color:${C.muted}}
.ins{color:${C.muted};font-size:11px}
.notes{margin-top:10px;border-right:3px solid ${C.saffron};background:${C.paper};padding:6px 10px;border-radius:4px}
.foot{display:flex;justify-content:space-between;align-items:flex-end;margin-top:18px;padding-top:10px;border-top:1px solid ${C.line}}
.stamp{color:${C.muted};font-size:10.5px}
.qr{display:flex;gap:10px;align-items:center;text-align:left} .qr img{width:92px;height:92px}
.qr small{display:block;color:${C.muted};font-size:9.5px;max-width:200px} .qr code{direction:ltr;font-family:inherit;font-size:9.5px}
.void{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}
.void span{transform:rotate(-28deg);font-size:96px;font-weight:700;color:rgba(200,67,43,.14)}
</style></head><body>
${void_ ? `<div class="void"><span>${esc(d.rx.stateLabel)}</span></div>` : ''}
<div class="head">
  <div class="dr">
    <h1>${esc(d.doctor.name)}</h1>
    ${d.doctor.specialty ? `<div class="s">${esc(d.doctor.specialty)}</div>` : ''}
    ${d.doctor.license ? `<div class="s">ترخيص رقم <span dir="ltr">${esc(d.doctor.license)}</span></div>` : ''}
    <div class="s">${esc([d.doctor.clinic, d.doctor.address].filter(Boolean).join(' — '))}${d.doctor.phone ? ` · <span dir="ltr">${esc(d.doctor.phone)}</span>` : ''}</div>
  </div>
  <div class="rxmark">℞</div>
</div>
<div class="meta">
  <div><span>اسم المريض</span><b>${esc(d.patient.name)}</b></div>
  <div><span>السن / النوع</span><b>${d.patient.age != null ? `${d.patient.age} سنة` : '—'}${d.patient.gender ? ` · ${d.patient.gender === 'MALE' ? 'ذكر' : 'أنثى'}` : ''}</b></div>
  <div><span>التاريخ</span><b>${esc(d.rx.issuedAt)}</b></div>
  <div><span>رقم الروشتة</span><b dir="ltr">${esc(d.rx.code)}</b></div>
  ${d.rx.validUntil ? `<div><span>صالحة حتى</span><b>${esc(d.rx.validUntil)}</b></div>` : ''}
</div>
${d.rx.diagnosis ? `<div class="dx"><b>التشخيص:</b> ${esc(d.rx.diagnosis)}</div>` : ''}
<ol>
${d.items
  .map(
    (i) => `<li><div><div class="name">${esc(i.name)}</div>
  <div class="sig"><span><em>الجرعة:</em> ${esc(i.dose)}</span><span><em>التكرار:</em> ${esc(i.frequency)}</span><span><em>المدة:</em> ${esc(i.duration)}</span>${i.quantity ? `<span><em>الكمية:</em> ${i.quantity} عبوة</span>` : ''}</div>
  ${i.instructions ? `<div class="ins">${esc(i.instructions)}</div>` : ''}</div></li>`,
  )
  .join('')}
</ol>
${d.rx.notes ? `<div class="notes"><b>ملاحظات:</b> ${esc(d.rx.notes)}</div>` : ''}
<div class="foot">
  <div class="stamp">روشتة إلكترونية صادرة عبر ${esc(d.platformName)} — لا تحتاج إلى ختم.<br>توقيع الطبيب: ${esc(d.doctor.name)}</div>
  <div class="qr"><div><small>للصيدلي: امسح الرمز للتحقق من الروشتة وتسجيل صرفها. الصفحة العامة لا تعرض الأدوية.</small><code>${esc(d.verificationCode)}</code></div><img src="${d.qrDataUrl}" alt=""></div>
</div>
</body></html>`;
}
