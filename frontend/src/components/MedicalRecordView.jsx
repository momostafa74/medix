import { Box, Chip, Stack, Typography } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import { Section } from './common';
import ProtectedFile from './ProtectedFile';
import { ageFrom, fmtDate, fmtShortDate } from '../utils/format';
import { DOC_TYPE, GENDER, SEVERITY } from '../utils/labels';
import { tokens } from '../theme';

/** Read-only medical record (used by doctors). Patients get the editable version. */
export default function MedicalRecordView({ data }) {
  const r = data.record || {};
  const p = data.patient;
  return (
    <Grid container spacing={2}>
      <Grid xs={12}>
        <Box sx={{ p: 2, borderRadius: '12px', bgcolor: tokens.mint, display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          <Typography sx={{ fontWeight: 600 }}>{p.fullName}</Typography>
          {p.gender && <Typography>{GENDER[p.gender]}</Typography>}
          {p.dateOfBirth && <Typography>{ageFrom(p.dateOfBirth)} سنة</Typography>}
          {p.bloodType && <Typography>فصيلة الدم: <b dir="ltr">{p.bloodType}</b></Typography>}
        </Box>
      </Grid>
      <Grid xs={12} md={6}>
        <Section title="الحساسية">
          {r.allergies?.length ? r.allergies.map((a) => (
            <Stack key={a.id} direction="row" spacing={1} alignItems="center" sx={{ py: 0.5 }}>
              <Typography sx={{ fontWeight: 600 }}>{a.allergen}</Typography>
              {a.severity && <Chip size="small" color={a.severity === 'SEVERE' ? 'error' : 'default'} label={SEVERITY[a.severity]} />}
              {a.reaction && <Typography variant="body2" color="text.secondary">{a.reaction}</Typography>}
            </Stack>
          )) : <Typography color="text.secondary">لا توجد حساسية مسجلة</Typography>}
        </Section>
      </Grid>
      <Grid xs={12} md={6}>
        <Section title="الأمراض المزمنة والتشخيصات">
          {r.conditions?.length ? r.conditions.map((c) => (
            <Box key={c.id} sx={{ py: 0.5 }}>
              <Typography component="div" sx={{ fontWeight: 600 }}>{c.name} {c.isChronic && <Chip size="small" label="مزمن" sx={{ marginInlineStart: 1 }} />}</Typography>
              {c.diagnosedAt && <Typography variant="body2" color="text.secondary">منذ {fmtShortDate(c.diagnosedAt)}</Typography>}
            </Box>
          )) : <Typography color="text.secondary">لا يوجد</Typography>}
        </Section>
      </Grid>
      <Grid xs={12} md={6}>
        <Section title="الأدوية الحالية">
          {r.medications?.length ? r.medications.map((m) => (
            <Typography component="div" key={m.id} sx={{ py: 0.5 }}>
              <b>{m.name}</b> {[m.dosage, m.frequency].filter(Boolean).join(' • ')} {!m.isCurrent && <Chip size="small" label="متوقف" />}
            </Typography>
          )) : <Typography color="text.secondary">لا يوجد</Typography>}
        </Section>
      </Grid>
      <Grid xs={12} md={6}>
        <Section title="العمليات السابقة">
          {r.surgeries?.length ? r.surgeries.map((s) => (
            <Typography key={s.id} sx={{ py: 0.5 }}><b>{s.name}</b> {s.performedAt && `— ${fmtShortDate(s.performedAt)}`} {s.hospital && `• ${s.hospital}`}</Typography>
          )) : <Typography color="text.secondary">لا يوجد</Typography>}
        </Section>
      </Grid>
      {r.notes && (
        <Grid xs={12}>
          <Section title="ملاحظات المريض"><Typography sx={{ whiteSpace: 'pre-line' }}>{r.notes}</Typography></Section>
        </Grid>
      )}
      <Grid xs={12} md={6}>
        <Section title="المستندات المرفوعة">
          {data.documents?.length ? data.documents.map((d) => (
            <Stack key={d.id} direction="row" justifyContent="space-between" alignItems="center" sx={{ py: 0.5 }}>
              <Box>
                <Typography sx={{ fontWeight: 600 }}>{d.title}</Typography>
                <Typography variant="caption" color="text.secondary">{DOC_TYPE[d.type]} • {fmtShortDate(d.documentDate || d.createdAt)}</Typography>
              </Box>
              {d.file && <ProtectedFile fileId={d.file.id} />}
            </Stack>
          )) : <Typography color="text.secondary">لا توجد مستندات</Typography>}
        </Section>
      </Grid>
      <Grid xs={12} md={6}>
        <Section title="الزيارات السابقة">
          {data.visits?.length ? data.visits.map((v) => (
            <Typography key={v.id} sx={{ py: 0.5 }}>{fmtDate(v.startAt)} — {v.provider} {v.specialty && `(${v.specialty})`}</Typography>
          )) : <Typography color="text.secondary">لا توجد زيارات مكتملة</Typography>}
        </Section>
      </Grid>
    </Grid>
  );
}
