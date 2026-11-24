import { Stack } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import { ErrorState, ListSkeleton, PageHeader } from '../../components/common';
import { BranchesManager, DocumentsManager, ProviderInfoForm, ServicesManager, useMyProvider } from '../../components/ProviderManagement';
import { PROVIDER_TYPE } from '../../utils/labels';

/**
 * Labs / radiology centers / pharmacies: profile, branches, services and verification
 * are live now. Orders, results and inventory modules arrive in phases 4–6 on the
 * same provider record.
 */
export default function ProviderHome() {
  const { data: provider, isLoading, error, refetch } = useMyProvider();
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading) return <ListSkeleton rows={4} height={120} />;
  if (!provider) return <ErrorState error={{ response: { data: { message: 'لا يوجد حساب مقدم خدمة مرتبط بهذا المستخدم' } } }} />;
  return (
    <>
      <PageHeader title={provider.nameAr} subtitle={PROVIDER_TYPE[provider.type]} />
      <Grid container spacing={2}>
        <Grid xs={12} lg={7}>
          <Stack spacing={2}>
            <ProviderInfoForm provider={provider} />
            <ServicesManager provider={provider} />
          </Stack>
        </Grid>
        <Grid xs={12} lg={5}>
          <Stack spacing={2}>
            <DocumentsManager provider={provider} />
            <BranchesManager provider={provider} />
          </Stack>
        </Grid>
      </Grid>
    </>
  );
}
