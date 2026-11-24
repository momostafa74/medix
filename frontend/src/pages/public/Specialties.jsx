import { Link as RouterLink } from 'react-router-dom';
import { Box, ButtonBase, Container, Skeleton, Stack, Typography } from '@mui/material';
import { useSpecialties } from '../../api/queries';
import SpecialtyIcon from '../../components/SpecialtyIcon';
import { ErrorState } from '../../components/common';
import { tokens } from '../../theme';

export default function Specialties() {
  const { data = [], isLoading, error, refetch } = useSpecialties();
  const roots = data.filter((s) => !s.parentId);
  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h3" component="h1" sx={{ mb: 3 }}>
        التخصصات الطبية
      </Typography>
      {error && <ErrorState error={error} onRetry={refetch} />}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2,1fr)', md: 'repeat(3,1fr)' }, gap: 1.5 }}>
        {isLoading
          ? Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} variant="rounded" height={110} />)
          : roots.map((s) => {
              const subs = data.filter((x) => x.parentId === s.id);
              return (
                <Box key={s.id} sx={{ border: `1px solid ${tokens.line}`, borderRadius: '12px', bgcolor: '#fff', p: 2 }}>
                  <ButtonBase component={RouterLink} to={`/doctors?specialtySlug=${s.slug}`} sx={{ width: '100%', justifyContent: 'flex-start', gap: 1.5, borderRadius: '8px' }}>
                    <Box sx={{ width: 44, height: 44, borderRadius: '10px', bgcolor: tokens.mint, color: tokens.petrol, display: 'grid', placeItems: 'center' }}>
                      <SpecialtyIcon name={s.icon} />
                    </Box>
                    <Box sx={{ textAlign: 'start' }}>
                      <Typography variant="h6" component="h2">
                        {s.nameAr}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {s.doctorCount} طبيب • {s.nameEn}
                      </Typography>
                    </Box>
                  </ButtonBase>
                  {subs.length > 0 && (
                    <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap>
                      {subs.map((x) => (
                        <Typography key={x.id} component={RouterLink} to={`/doctors?specialtySlug=${x.slug}`} variant="body2" sx={{ color: tokens.petrol }}>
                          {x.nameAr}
                        </Typography>
                      ))}
                    </Stack>
                  )}
                </Box>
              );
            })}
      </Box>
    </Container>
  );
}
