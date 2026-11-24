import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Box, Card, Chip, InputAdornment, MenuItem, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import HomeOutlined from '@mui/icons-material/HomeOutlined';
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import { useQueryClient } from '@tanstack/react-query';
import { useLabOrders, useMyLab } from '../../api/labs';
import { useRealtime } from '../../auth/AuthProvider';
import DataTable from '../../components/DataTable';
import { ErrorState, PageHeader, useDebounced } from '../../components/common';
import { LabStatusChip } from '../../components/lab/LabUi';
import { fmtDateTime, fmtMoney } from '../../utils/format';
import { tokens } from '../../theme';

export const BOARD_TABS = [
  { key: 'waiting', label: 'بانتظار العينة', status: 'NEW_ORDER,PAID' },
  { key: 'lab', label: 'بالمعمل', status: 'SAMPLE_COLLECTED,SAMPLE_RECEIVED,PROCESSING' },
  { key: 'review', label: 'إدخال ومراجعة', status: 'RESULT_ENTERED,UNDER_REVIEW' },
  { key: 'ready', label: 'جاهزة للتسليم', status: 'APPROVED' },
  { key: 'delivered', label: 'تم التسليم', status: 'DELIVERED' },
  { key: 'cancelled', label: 'ملغاة', status: 'CANCELLED' },
  { key: 'all', label: 'الكل', status: '' },
];

export default function LabOrdersBoard() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const tab = params.get('tab') || (params.get('critical') ? 'all' : 'waiting');
  const critical = params.get('critical') === 'true';
  const [text, setText] = useState('');
  const [mode, setMode] = useState('');
  const [branchId, setBranchId] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const search = useDebounced(text);
  const { data: me } = useMyLab();
  useRealtime('lab:order', () => qc.invalidateQueries({ queryKey: ['lab-orders'] }));
  const t = BOARD_TABS.find((x) => x.key === tab) || BOARD_TABS[0];
  const { data, isLoading, error, refetch } = useLabOrders('lab', {
    status: t.status,
    search,
    mode,
    branchId,
    critical: critical ? 'true' : undefined,
    page,
    pageSize,
    sortDir: ['waiting', 'lab'].includes(tab) ? 'asc' : 'desc',
  });
  return (
    <>
      <PageHeader title="الطلبات" subtitle="من الحجز حتى تسليم النتيجة — ابحث بالكود أو اسم المريض أو رقم الهاتف أو باركود العينة." />
      <Card sx={{ mb: 2 }}>
        <Tabs value={tab} onChange={(_, v) => { setParams({ tab: v }); setPage(1); }} variant="scrollable" allowScrollButtonsMobile>
          {BOARD_TABS.map((x) => <Tab key={x.key} value={x.key} label={x.label} />)}
        </Tabs>
      </Card>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField size="small" fullWidth placeholder="كود الطلب، اسم المريض، الهاتف أو باركود العينة" value={text} onChange={(e) => { setText(e.target.value); setPage(1); }} InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }} />
        <TextField size="small" select label="المكان" value={mode} onChange={(e) => { setMode(e.target.value); setPage(1); }} sx={{ minWidth: 150 }}>
          <MenuItem value="">الكل</MenuItem>
          <MenuItem value="BRANCH">بالفرع</MenuItem>
          <MenuItem value="HOME">سحب منزلي</MenuItem>
        </TextField>
        {me?.branches?.length > 1 && (
          <TextField size="small" select label="الفرع" value={branchId} onChange={(e) => { setBranchId(e.target.value); setPage(1); }} sx={{ minWidth: 170 }}>
            <MenuItem value="">كل الفروع</MenuItem>
            {me.branches.map((b) => <MenuItem key={b.id} value={b.id}>{b.name}</MenuItem>)}
          </TextField>
        )}
        {critical && <Chip color="error" label="نتائج حرجة فقط" onDelete={() => setParams({ tab })} />}
      </Stack>
      {error && <ErrorState error={error} onRetry={refetch} />}
      <Card>
        <DataTable
          loading={isLoading}
          rows={data?.items}
          total={data?.total}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
          onRowClick={(o) => nav(`/provider/orders/${o.id}`)}
          columns={[
            { key: 'code', label: 'الطلب', render: (o) => <Typography dir="ltr" sx={{ fontWeight: 600, fontSize: 14 }}>{o.code}</Typography> },
            {
              key: 'patient',
              label: 'المريض',
              render: (o) => (
                <Box>
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <Typography sx={{ fontWeight: 600 }}>{o.patientName}</Typography>
                    {o.criticalCount > 0 && <WarningAmberRounded sx={{ color: tokens.signal, fontSize: 18 }} titleAccess="قيمة حرجة" />}
                  </Stack>
                  <Typography variant="caption" color="text.secondary" dir="ltr">{o.patientPhone}</Typography>
                </Box>
              ),
            },
            { key: 'items', label: 'التحاليل', render: (o) => <Typography variant="body2" dir="ltr" sx={{ textAlign: 'right', maxWidth: 220 }} noWrap>{o.itemsLabel}</Typography> },
            { key: 'when', label: 'الموعد', render: (o) => <Typography variant="body2">{fmtDateTime(o.scheduledAt)}</Typography> },
            { key: 'where', label: 'المكان', render: (o) => (o.homeCollection ? <Chip size="small" icon={<HomeOutlined />} label="منزلي" /> : <Typography variant="body2">{o.branchName}</Typography>) },
            { key: 'total', label: 'المبلغ', render: (o) => <Typography variant="body2" color={o.paymentStatus === 'PAID' ? 'success.main' : 'text.primary'}>{fmtMoney(o.total)}</Typography> },
            { key: 'status', label: 'الحالة', render: (o) => <LabStatusChip value={o.status} /> },
          ]}
        />
      </Card>
    </>
  );
}
