import { useParams } from 'react-router-dom';
import { Avatar, Box, Button, Card, Container, Skeleton, Stack, Typography } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import WhatsApp from '@mui/icons-material/WhatsApp';
import PhoneOutlined from '@mui/icons-material/PhoneOutlined';
import { useQuery } from '@tanstack/react-query';
import { api, fileUrl } from '../../api/client';
import { Rating } from '../../components/DoctorCard';
import ChatButton from '../../components/ChatButton';
import { useAuth } from '../../auth/AuthProvider';
import { EmptyState, ErrorState, Section } from '../../components/common';
import { fmtMoney } from '../../utils/format';
import { PROVIDER_TYPE } from '../../utils/labels';
import { whatsappLink } from '../../utils/whatsapp';
import { tokens } from '../../theme';
import { Navigate } from 'react-router-dom';
import { LabCatalogSection } from './LabBooking';
import { RadiologyCatalogSection } from './RadiologyBooking';
import { PharmacyCatalogSection } from './Pharmacy';

const DAY_SHORT = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/** Groups days with identical hours: "السبت–الخميس 08:00–22:00 • الجمعة 13:00–21:00". */
export function hoursText(hours) {
  const order = [6, 0, 1, 2, 3, 4, 5];
  const byDay = Object.fromEntries(order.map((d) => [d, hours.filter((h) => h.day === d).map((h) => `من ${hm(h.open)} إلى ${hm(h.close)}`).join('، ')]));
  const out = [];
  for (const d of order) {
    if (!byDay[d]) continue;
    const last = out[out.length - 1];
    if (last && last.text === byDay[d] && order.indexOf(last.to) === order.indexOf(d) - 1) last.to = d;
    else out.push({ from: d, to: d, text: byDay[d] });
  }
  return out.map((g) => `${DAY_SHORT[g.from]}${g.to !== g.from ? ` إلى ${DAY_SHORT[g.to]}` : ''}: ${g.text}`).join(' • ');
}

export default function ProviderProfile() {
  const { key } = useParams();
  const { user } = useAuth();
  const { data: p, isLoading, error, refetch } = useQuery({
    queryKey: ['provider', key],
    queryFn: () => api.get(`/providers/${encodeURIComponent(key)}`).then((r) => r.data),
  });
  if (error) return <Container sx={{ py: 6 }}>{error.response?.status === 404 ? <EmptyState title="غير موجود" body="الرابط غير صحيح أو الحساب غير متاح حالياً." /> : <ErrorState error={error} onRetry={refetch} />}</Container>;
  if (isLoading) return <Container sx={{ py: 4 }}><Skeleton variant="rounded" height={220} /></Container>;
  if (p.type === 'DOCTOR') return <Navigate to={`/doctors/${p.slug}`} replace />;
  const wa = whatsappLink(p.whatsappNumber, { doctorName: p.nameAr });
  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Card sx={{ p: 3 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2.5} alignItems={{ sm: 'center' }}>
          <Avatar variant="rounded" src={fileUrl(p.logoFileId) || undefined} sx={{ width: 96, height: 96, bgcolor: tokens.mint, color: tokens.petrol, fontSize: 36, fontWeight: 700 }}>
            {p.nameAr[0]}
          </Avatar>
          <Box sx={{ flex: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {PROVIDER_TYPE[p.type]}
            </Typography>
            <Typography variant="h3" component="h1" sx={{ fontSize: '1.8rem' }}>
              {p.nameAr}
            </Typography>
            <Rating value={p.ratingAvg} count={p.ratingCount} />
            {p.description && <Typography sx={{ mt: 1 }}>{p.description}</Typography>}
          </Box>
          <Stack spacing={1}>
            {(!user || user.patientId) && <ChatButton payload={{ type: 'PATIENT_PROVIDER', providerId: p.id }} label="راسلنا" />}
            {wa && (
              <Button variant="contained" color="success" startIcon={<WhatsApp />} href={wa} target="_blank" rel="noopener noreferrer">
                تواصل عبر واتساب
              </Button>
            )}
            {p.phone && (
              <Button variant="outlined" startIcon={<PhoneOutlined />} href={`tel:${p.phone}`} dir="ltr">
                {p.phone}
              </Button>
            )}
          </Stack>
        </Stack>
      </Card>
      {p.type === 'LABORATORY' ? (
        <Box sx={{ mt: 3 }}>
          <LabCatalogSection slug={p.slug} />
        </Box>
      ) : p.type === 'RADIOLOGY' ? (
        <Box sx={{ mt: 3 }}>
          <RadiologyCatalogSection slug={p.slug} />
        </Box>
      ) : p.type === 'PHARMACY' ? (
        <Box sx={{ mt: 3 }}>
          <PharmacyCatalogSection slug={p.slug} />
        </Box>
      ) : null}
      <Grid container spacing={2} sx={{ mt: 0 }}>
        <Grid xs={12} md={['LABORATORY', 'RADIOLOGY', 'PHARMACY'].includes(p.type) && !p.services.length ? 12 : 7}>
          <Section title="الفروع">
            <Stack spacing={2}>
              {p.branches.map((b) => (
                <Box key={b.id}>
                  <Typography sx={{ fontWeight: 600 }}>{b.name}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {[b.address, b.area?.nameAr, b.city?.nameAr].filter(Boolean).join('، ')}
                  </Typography>
                  {b.phone && (
                    <Typography variant="body2" dir="ltr" sx={{ textAlign: 'right' }}>
                      {b.phone}
                    </Typography>
                  )}
                  {b.openingHours?.length ? (
                    <Typography variant="body2" color="text.secondary">مواعيد العمل: {hoursText(b.openingHours)}</Typography>
                  ) : b.workingHours && (
                    <Typography variant="body2" color="text.secondary">
                      مواعيد العمل: {Object.values(b.workingHours).join(' / ')}
                    </Typography>
                  )}
                </Box>
              ))}
            </Stack>
          </Section>
        </Grid>
        <Grid xs={12} md={5} sx={{ display: ['LABORATORY', 'RADIOLOGY', 'PHARMACY'].includes(p.type) && !p.services.length ? 'none' : undefined }}>
          <Section title="الخدمات">
            {p.services.length ? (
              p.services.map((s) => (
                <Stack key={s.id} direction="row" justifyContent="space-between" sx={{ py: 0.75 }}>
                  <Typography>{s.name}</Typography>
                  <Typography sx={{ fontWeight: 600 }}>{fmtMoney(s.price)}</Typography>
                </Stack>
              ))
            ) : (
              <Typography color="text.secondary">لم تتم إضافة خدمات بعد.</Typography>
            )}
          </Section>
        </Grid>
      </Grid>
    </Container>
  );
}
