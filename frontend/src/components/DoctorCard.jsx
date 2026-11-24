import { Avatar, Box, Button, Card, Chip, Stack, Typography } from '@mui/material';
import StarRounded from '@mui/icons-material/StarRounded';
import PlaceOutlined from '@mui/icons-material/PlaceOutlined';
import VerifiedRounded from '@mui/icons-material/VerifiedRounded';
import VideocamOutlined from '@mui/icons-material/VideocamOutlined';
import HomeOutlined from '@mui/icons-material/HomeOutlined';
import { Link as RouterLink } from 'react-router-dom';
import { fileUrl } from '../api/client';
import { fmtMoney } from '../utils/format';
import { tokens } from '../theme';

export function DoctorAvatar({ doctor, size = 72 }) {
  const src = fileUrl(doctor.avatarFileId || doctor.logoFileId);
  const initials = (doctor.fullName || doctor.displayName || '').trim().split(' ').slice(0, 2).map((w) => w[0]).join(' ');
  return (
    <Avatar src={src || undefined} alt={doctor.displayName} sx={{ width: size, height: size, bgcolor: tokens.mint, color: tokens.petrol, fontWeight: 700, fontSize: size / 3.2 }}>
      {initials}
    </Avatar>
  );
}

export function Rating({ value, count, size = 'body2' }) {
  if (!count) return <Typography variant={size} color="text.secondary">لا توجد تقييمات بعد</Typography>;
  return (
    <Stack direction="row" alignItems="center" spacing={0.25}>
      <StarRounded sx={{ color: tokens.saffron, fontSize: 20 }} />
      <Typography variant={size} sx={{ fontWeight: 700 }}>
        {Number(value).toFixed(1)}
      </Typography>
      <Typography variant={size} color="text.secondary">
        ({count} تقييم)
      </Typography>
    </Stack>
  );
}

export default function DoctorCard({ d }) {
  const branch = d.branches?.[0];
  return (
    <Card sx={{ p: 2.25 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <DoctorAvatar doctor={d} size={84} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" alignItems="center" spacing={0.75}>
            <Typography variant="h6" component="h3" sx={{ fontSize: '1.1rem' }}>
              {d.displayName}
            </Typography>
            {d.verified && <VerifiedRounded sx={{ color: tokens.petrol, fontSize: 18 }} titleAccess="طبيب معتمد" />}
          </Stack>
          <Typography color="text.secondary" variant="body2">
            {d.primarySpecialty?.nameAr}
            {d.experienceYears ? ` • خبرة ${d.experienceYears} سنة` : ''}
          </Typography>
          <Box sx={{ mt: 0.75 }}>
            <Rating value={d.ratingAvg} count={d.ratingCount} />
          </Box>
          {branch && (
            <Stack direction="row" spacing={0.5} alignItems="flex-start" sx={{ mt: 0.75, color: 'text.secondary' }}>
              <PlaceOutlined sx={{ fontSize: 18, mt: '3px' }} />
              <Typography variant="body2">
                {[branch.area?.nameAr, branch.city?.nameAr].filter(Boolean).join('، ')} — {branch.address}
              </Typography>
            </Stack>
          )}
          <Stack direction="row" spacing={0.75} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
            {d.onlineAvailable && <Chip size="small" icon={<VideocamOutlined />} label="كشف أونلاين" variant="outlined" />}
            {d.homeVisitAvailable && <Chip size="small" icon={<HomeOutlined />} label="زيارة منزلية" variant="outlined" />}
          </Stack>
        </Box>
        <Stack justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'flex-end' }} spacing={1.5} sx={{ minWidth: 150 }}>
          <Box sx={{ textAlign: { sm: 'left' } }}>
            <Typography variant="caption" color="text.secondary">
              سعر الكشف
            </Typography>
            <Typography sx={{ fontWeight: 700, fontSize: 20, color: tokens.petrol }}>{fmtMoney(d.consultationPrice)}</Typography>
          </Box>
          <Button component={RouterLink} to={`/doctors/${d.slug || d.id}`} variant="contained">
            احجز موعد
          </Button>
        </Stack>
      </Stack>
    </Card>
  );
}
