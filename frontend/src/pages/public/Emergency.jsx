import { useState } from 'react';
import { Box, Button, Container, Stack, Tab, Tabs, Typography } from '@mui/material';
import PhoneInTalk from '@mui/icons-material/PhoneInTalk';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../../api/client';
import { usePublicSettings } from '../../api/queries';
import LocationSelect from '../../components/LocationSelect';
import { EmptyState, ListSkeleton } from '../../components/common';
import { ProviderRow } from './Providers';
import { tokens } from '../../theme';

/** Location-based discovery by area today; ready for GPS once branches carry coordinates. */
export default function Emergency() {
  const { data: settings } = usePublicSettings();
  const [loc, setLoc] = useState({});
  const [type, setType] = useState('PHARMACY');
  const { data, isLoading } = useQuery({
    queryKey: ['emergency', type, loc],
    queryFn: () => api.get(`/providers${qs({ type, ...loc, pageSize: 20 })}`).then((r) => r.data),
  });
  const hotline = settings?.['emergency.hotline'] || '123';
  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Box sx={{ bgcolor: tokens.signal, color: '#fff', borderRadius: '14px', p: 3 }}>
        <Typography variant="h3" component="h1">
          حالة طارئة؟
        </Typography>
        <Typography sx={{ mt: 1, opacity: 0.9 }}>في الحالات التي تهدد الحياة اتصل بالإسعاف فوراً — لا تنتظر حجز موعد.</Typography>
        <Button href={`tel:${hotline}`} variant="contained" sx={{ mt: 2, bgcolor: '#fff', color: tokens.signal, '&:hover': { bgcolor: '#fff' } }} startIcon={<PhoneInTalk />} size="large">
          اتصل بالإسعاف {hotline}
        </Button>
      </Box>
      <Typography variant="h4" component="h2" sx={{ mt: 4, mb: 2 }}>
        الأقرب لك
      </Typography>
      <LocationSelect value={loc} onChange={setLoc} />
      <Tabs value={type} onChange={(_, v) => setType(v)} sx={{ mt: 2 }} variant="scrollable">
        <Tab value="PHARMACY" label="صيدليات" />
        <Tab value="HOSPITAL" label="مستشفيات" />
        <Tab value="LABORATORY" label="معامل" />
        <Tab value="RADIOLOGY" label="أشعة" />
      </Tabs>
      <Stack spacing={1.5} sx={{ mt: 2 }}>
        {isLoading ? <ListSkeleton rows={3} height={100} /> : data?.items.length ? data.items.map((p) => <ProviderRow key={p.id} p={p} />) : <EmptyState title="لا توجد نتائج في هذه المنطقة" body="اختر مدينة أو منطقة أخرى." />}
      </Stack>
    </Container>
  );
}
