import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Button, Card, Link, MenuItem, Stack, TextField, Typography } from '@mui/material';
import ReceiptOutlined from '@mui/icons-material/ReceiptOutlined';
import { useSnackbar } from 'notistack';
import { errorMessage } from '../../api/client';
import { ENTITY_LABEL, PAYMENT_STATUS, PAY_METHOD, downloadReceipt, patientRecordLink, usePayments } from '../../api/payments';
import DataTable from '../../components/DataTable';
import { EmptyState, ErrorState, PageHeader } from '../../components/common';
import { PaymentStatusChip } from '../../components/payments/PayUi';
import { fmtDateTime, fmtMoney } from '../../utils/format';

export function PatientPayments() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const { enqueueSnackbar } = useSnackbar();
  const { data, isLoading, error, refetch } = usePayments('mine', { page, pageSize: 15, status });
  const receipt = (p) => downloadReceipt(p).catch((e) => enqueueSnackbar(errorMessage(e), { variant: 'error' }));
  return (
    <>
      <PageHeader title="مدفوعاتي" subtitle="كل ما دفعته على المنصة — أونلاين أو في مكان الخدمة — مع الإيصالات والمبالغ المستردة." />
      <Card sx={{ p: 2, mb: 2 }}>
        <TextField select size="small" label="الحالة" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} sx={{ minWidth: 200 }}>
          <MenuItem value="">الكل</MenuItem>
          {['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'FAILED'].map((k) => <MenuItem key={k} value={k}>{PAYMENT_STATUS[k].label}</MenuItem>)}
        </TextField>
      </Card>
      {error && <ErrorState error={error} onRetry={refetch} />}
      <Card>
        <DataTable
          loading={isLoading}
          rows={data?.items || []}
          total={data?.total || 0}
          page={page}
          pageSize={15}
          onPageChange={setPage}
          columns={[
            { key: 'createdAt', label: 'التاريخ', nowrap: true, render: (r) => fmtDateTime(r.paidAt || r.createdAt) },
            {
              key: 'description',
              label: 'الخدمة',
              render: (r) => {
                const to = patientRecordLink(r.entityType, r.entityId);
                return (
                  <Stack>
                    {to ? <Link component={RouterLink} to={to} underline="hover">{r.description}</Link> : r.description}
                    <Typography variant="caption" color="text.secondary">{ENTITY_LABEL[r.entityType]} • <span dir="ltr">{r.code}</span></Typography>
                  </Stack>
                );
              },
            },
            { key: 'method', label: 'الطريقة', render: (r) => PAY_METHOD[r.method] },
            { key: 'amount', label: 'المبلغ', nowrap: true, render: (r) => <>{fmtMoney(r.amount)}{r.refundedAmount > 0 && <Typography variant="caption" color="success.main" display="block">استرد {fmtMoney(r.refundedAmount)}</Typography>}</> },
            { key: 'status', label: 'الحالة', render: (r) => <PaymentStatusChip value={r.status} /> },
            {
              key: 'act',
              label: '',
              render: (r) => r.status !== 'FAILED' && <Button size="small" startIcon={<ReceiptOutlined />} onClick={() => receipt(r)}>الإيصال</Button>,
            },
          ]}
          empty={<EmptyState title="لا توجد مدفوعات" body="عند دفع كشف أو طلب تحاليل أو أشعة أو أدوية ستظهر هنا مع إيصالها." />}
        />
      </Card>
    </>
  );
}
