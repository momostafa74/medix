import { useEffect, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import EditOutlined from '@mui/icons-material/EditOutlined';
import SearchIcon from '@mui/icons-material/Search';
import ArrowUpward from '@mui/icons-material/ArrowUpward';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { api, errorMessage, qs } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import DataTable from '../../components/DataTable';
import { EmptyState, ErrorState, ListSkeleton, PageHeader, useConfirm, useDebounced } from '../../components/common';
import { fmtMoney } from '../../utils/format';
import { GENDER } from '../../utils/labels';
import { tokens } from '../../theme';

const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
const blankRange = () => ({ gender: '', ageMinYears: '', ageMaxYears: '', low: '', high: '', criticalLow: '', criticalHigh: '', textRange: '' });
const blankParam = () => ({ name: '', unit: '', resultType: 'NUMERIC', ranges: [blankRange()] });

function rangeSummary(r) {
  const who = [r.gender && GENDER[r.gender], (r.ageMinYears != null || r.ageMaxYears != null) && `${r.ageMinYears ?? 0}–${r.ageMaxYears ?? '∞'} سنة`].filter(Boolean).join(' ');
  const val = r.textRange || [r.low ?? '', r.high ?? ''].join(' – ');
  return `${who ? `${who}: ` : ''}${val}`;
}

function TestDialog({ test, categories, onClose }) {
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!test) return setF(null);
    setF(
      test === 'new'
        ? { code: '', name: '', categoryId: '', description: '', price: '', sampleType: 'دم', preparationInstructions: '', turnaroundHours: 24, isActive: true, parameters: [blankParam()] }
        : {
            ...test,
            categoryId: test.categoryId || '',
            description: test.description || '',
            sampleType: test.sampleType || '',
            preparationInstructions: test.preparationInstructions || '',
            turnaroundHours: test.turnaroundHours ?? '',
            parameters: test.parameters.map((p) => ({
              id: p.id,
              name: p.name,
              unit: p.unit || '',
              resultType: p.resultType,
              ranges: (p.ranges.length ? p.ranges : [{}]).map((r) => Object.fromEntries(Object.entries({ ...blankRange(), ...r }).map(([k, v]) => [k, v ?? '']))),
            })),
          },
    );
  }, [test]);
  if (!f) return null;
  const setP = (i, patch) => setF({ ...f, parameters: f.parameters.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const setR = (i, k, patch) => setP(i, { ranges: f.parameters[i].ranges.map((r, j) => (j === k ? { ...r, ...patch } : r)) });
  const save = async () => {
    setBusy(true);
    try {
      const body = {
        code: f.code.trim(),
        name: f.name.trim(),
        categoryId: f.categoryId || null,
        description: f.description || null,
        price: Number(f.price),
        sampleType: f.sampleType || null,
        preparationInstructions: f.preparationInstructions || null,
        turnaroundHours: f.turnaroundHours === '' ? null : Number(f.turnaroundHours),
        isActive: f.isActive,
        parameters: f.parameters.map((p) => ({
          ...(p.id ? { id: p.id } : {}),
          name: p.name.trim(),
          unit: p.unit || null,
          resultType: p.resultType,
          ranges: p.ranges
            .filter((r) => [r.low, r.high, r.criticalLow, r.criticalHigh, r.textRange].some((x) => x !== '' && x !== null))
            .map((r) => ({
              gender: r.gender || null,
              ageMinYears: num(r.ageMinYears),
              ageMaxYears: num(r.ageMaxYears),
              low: p.resultType === 'TEXT' ? null : num(r.low),
              high: p.resultType === 'TEXT' ? null : num(r.high),
              criticalLow: p.resultType === 'TEXT' ? null : num(r.criticalLow),
              criticalHigh: p.resultType === 'TEXT' ? null : num(r.criticalHigh),
              textRange: r.textRange || null,
            })),
        })),
      };
      if (test === 'new') await api.post('/labs/me/tests', body);
      else await api.put(`/labs/me/tests/${test.id}`, body);
      enqueueSnackbar('تم حفظ التحليل', { variant: 'success' });
      qc.invalidateQueries({ queryKey: ['lab'] });
      onClose();
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{test === 'new' ? 'تحليل جديد' : `تعديل ${test.name}`}</DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={2}>
          <Grid xs={12} sm={3}><TextField label="الكود" required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} inputProps={{ dir: 'ltr' }} helperText="CBC، FBS… يُستخدم في مقارنة الأسعار" /></Grid>
          <Grid xs={12} sm={5}><TextField label="الاسم" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Grid>
          <Grid xs={6} sm={2}><TextField label="السعر" required type="number" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} InputProps={{ endAdornment: <InputAdornment position="end">ج.م</InputAdornment> }} /></Grid>
          <Grid xs={6} sm={2}><TextField label="النتيجة خلال (ساعة)" type="number" value={f.turnaroundHours} onChange={(e) => setF({ ...f, turnaroundHours: e.target.value })} /></Grid>
          <Grid xs={12} sm={4}>
            <TextField select label="التصنيف" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>
              <MenuItem value="">بدون</MenuItem>
              {categories.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid xs={12} sm={4}><TextField label="نوع العينة" value={f.sampleType} onChange={(e) => setF({ ...f, sampleType: e.target.value })} helperText="تُجمّع العينات بنفس النوع في أنبوبة واحدة" /></Grid>
          <Grid xs={12} sm={4}><FormControlLabel control={<Switch checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />} label="متاح للحجز" /></Grid>
          <Grid xs={12}><TextField label="تعليمات التحضير للمريض" value={f.preparationInstructions} onChange={(e) => setF({ ...f, preparationInstructions: e.target.value })} placeholder="مثال: صيام 8-12 ساعة" /></Grid>
          <Grid xs={12}><TextField label="الوصف" multiline minRows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Grid>
        </Grid>
        <Divider sx={{ my: 2 }} />
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="h6">بنود النتيجة والمعدلات الطبيعية</Typography>
          <Button startIcon={<AddIcon />} onClick={() => setF({ ...f, parameters: [...f.parameters, blankParam()] })}>بند</Button>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          أضف أكثر من مدى للبند حسب النوع أو السن — يختار النظام الأدق للمريض تلقائياً. الحدود الحرجة تطلق تنبيهاً فورياً لمدير المعمل.
        </Typography>
        <Stack spacing={1.5}>
          {f.parameters.map((p, i) => (
            <Card key={p.id || `n${i}`} sx={{ p: 1.5, bgcolor: tokens.paper }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
                <TextField size="small" label="البند" value={p.name} onChange={(e) => setP(i, { name: e.target.value })} inputProps={{ dir: 'auto' }} />
                <TextField size="small" label="الوحدة" value={p.unit} onChange={(e) => setP(i, { unit: e.target.value })} inputProps={{ dir: 'ltr' }} sx={{ maxWidth: { sm: 130 } }} />
                <TextField size="small" select label="نوع القيمة" value={p.resultType} onChange={(e) => setP(i, { resultType: e.target.value })} sx={{ minWidth: 130 }}>
                  <MenuItem value="NUMERIC">رقمية</MenuItem>
                  <MenuItem value="TEXT">نصية</MenuItem>
                </TextField>
                <Box sx={{ flex: 1 }} />
                <Tooltip title="لأعلى"><span><IconButton size="small" disabled={i === 0} onClick={() => { const ps = [...f.parameters]; [ps[i - 1], ps[i]] = [ps[i], ps[i - 1]]; setF({ ...f, parameters: ps }); }}><ArrowUpward fontSize="small" /></IconButton></span></Tooltip>
                <IconButton size="small" color="error" aria-label="حذف البند" disabled={f.parameters.length === 1} onClick={() => setF({ ...f, parameters: f.parameters.filter((_, j) => j !== i) })}><DeleteOutline fontSize="small" /></IconButton>
              </Stack>
              <Stack spacing={1} sx={{ mt: 1 }}>
                {p.ranges.map((r, k) => (
                  <Stack key={k} direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
                    <TextField size="small" select label="النوع" value={r.gender} onChange={(e) => setR(i, k, { gender: e.target.value })} sx={{ width: 100 }}>
                      <MenuItem value="">الكل</MenuItem>
                      <MenuItem value="MALE">ذكر</MenuItem>
                      <MenuItem value="FEMALE">أنثى</MenuItem>
                    </TextField>
                    <TextField size="small" label="من سن" type="number" value={r.ageMinYears} onChange={(e) => setR(i, k, { ageMinYears: e.target.value })} sx={{ width: 86 }} />
                    <TextField size="small" label="إلى سن" type="number" value={r.ageMaxYears} onChange={(e) => setR(i, k, { ageMaxYears: e.target.value })} sx={{ width: 86 }} />
                    {p.resultType === 'TEXT' ? (
                      <TextField size="small" label="القيمة الطبيعية" value={r.textRange} onChange={(e) => setR(i, k, { textRange: e.target.value })} inputProps={{ dir: 'ltr' }} sx={{ width: 180 }} />
                    ) : (
                      <>
                        <TextField size="small" label="الحد الأدنى" type="number" value={r.low} onChange={(e) => setR(i, k, { low: e.target.value })} sx={{ width: 100 }} />
                        <TextField size="small" label="الحد الأقصى" type="number" value={r.high} onChange={(e) => setR(i, k, { high: e.target.value })} sx={{ width: 100 }} />
                        <TextField size="small" label="حرج أقل من" type="number" value={r.criticalLow} onChange={(e) => setR(i, k, { criticalLow: e.target.value })} sx={{ width: 106 }} />
                        <TextField size="small" label="حرج أعلى من" type="number" value={r.criticalHigh} onChange={(e) => setR(i, k, { criticalHigh: e.target.value })} sx={{ width: 110 }} />
                      </>
                    )}
                    <IconButton size="small" aria-label="حذف المدى" onClick={() => setP(i, { ranges: p.ranges.length > 1 ? p.ranges.filter((_, j) => j !== k) : [blankRange()] })}><DeleteOutline fontSize="small" /></IconButton>
                  </Stack>
                ))}
                <Box><Button size="small" startIcon={<AddIcon />} onClick={() => setP(i, { ranges: [...p.ranges, blankRange()] })}>مدى لفئة أخرى</Button></Box>
              </Stack>
            </Card>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose}>إلغاء</Button>
        <Button variant="contained" disabled={busy || !f.code || !f.name || f.price === '' || f.parameters.some((p) => !p.name.trim())} onClick={save}>حفظ</Button>
      </DialogActions>
    </Dialog>
  );
}

function PackageDialog({ pkg, tests, onClose }) {
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const [f, setF] = useState(null);
  useEffect(() => {
    if (!pkg) return setF(null);
    setF(pkg === 'new' ? { name: '', description: '', price: '', isActive: true, tests: [] } : { ...pkg, description: pkg.description || '', tests: tests.filter((t) => pkg.tests.some((x) => x.id === t.id)) });
  }, [pkg, tests]);
  if (!f) return null;
  const separate = f.tests.reduce((s, t) => s + Number(t.price), 0);
  const save = async () => {
    try {
      const body = { name: f.name, description: f.description || null, price: Number(f.price), isActive: f.isActive, testIds: f.tests.map((t) => t.id) };
      if (pkg === 'new') await api.post('/labs/me/packages', body);
      else await api.put(`/labs/me/packages/${pkg.id}`, body);
      enqueueSnackbar('تم حفظ الباقة', { variant: 'success' });
      qc.invalidateQueries({ queryKey: ['lab'] });
      onClose();
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    }
  };
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{pkg === 'new' ? 'باقة جديدة' : 'تعديل الباقة'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <TextField label="اسم الباقة" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
          <TextField label="الوصف" multiline minRows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          <Autocomplete
            multiple
            options={tests}
            value={f.tests}
            onChange={(_, v) => setF({ ...f, tests: v })}
            getOptionLabel={(t) => `${t.name} (${t.code})`}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            renderInput={(p) => <TextField {...p} label="التحاليل المشمولة" />}
          />
          <TextField label="سعر الباقة" type="number" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} required InputProps={{ endAdornment: <InputAdornment position="end">ج.م</InputAdornment> }}
            helperText={f.tests.length ? `سعر التحاليل منفردة ${fmtMoney(separate)}${f.price !== '' && Number(f.price) < separate ? ` — توفير ${fmtMoney(separate - Number(f.price))} للمريض` : ''}` : ''} />
          <FormControlLabel control={<Switch checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />} label="متاحة للحجز" />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose}>إلغاء</Button>
        <Button variant="contained" disabled={!f.name || f.price === '' || f.tests.length < 2} onClick={save}>حفظ</Button>
      </DialogActions>
    </Dialog>
  );
}

function CategoriesPanel({ categories, canEdit }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { enqueueSnackbar } = useSnackbar();
  const [name, setName] = useState('');
  const call = async (fn) => {
    try {
      await fn();
      qc.invalidateQueries({ queryKey: ['lab'] });
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    }
  };
  return (
    <Card sx={{ p: 2 }}>
      {canEdit && (
        <Stack direction="row" spacing={1} sx={{ mb: 2 }} component="form" onSubmit={(e) => { e.preventDefault(); if (name.trim()) call(() => api.post('/labs/me/categories', { name })).then(() => setName('')); }}>
          <TextField size="small" label="تصنيف جديد" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" variant="contained">إضافة</Button>
        </Stack>
      )}
      <Stack spacing={1}>
        {categories.map((c) => (
          <Stack key={c.id} direction="row" alignItems="center" justifyContent="space-between" sx={{ p: 1, borderRadius: '8px', border: `1px solid ${tokens.line}` }}>
            <Typography>{c.name}</Typography>
            {canEdit && (
              <Stack direction="row">
                <IconButton size="small" aria-label="تعديل" onClick={() => { const n = window.prompt('اسم التصنيف', c.name); if (n?.trim()) call(() => api.patch(`/labs/me/categories/${c.id}`, { name: n })); }}><EditOutlined fontSize="small" /></IconButton>
                <IconButton size="small" color="error" aria-label="حذف" onClick={async () => { if (await confirm({ title: 'حذف التصنيف؟', body: 'التحاليل التابعة له ستبقى بدون تصنيف.', danger: true })) call(() => api.delete(`/labs/me/categories/${c.id}`)); }}><DeleteOutline fontSize="small" /></IconButton>
              </Stack>
            )}
          </Stack>
        ))}
        {!categories.length && <Typography color="text.secondary">لا توجد تصنيفات.</Typography>}
      </Stack>
    </Card>
  );
}

export default function LabCatalog() {
  const { can } = useAuth();
  const canEdit = can('lab.catalog.manage');
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { enqueueSnackbar } = useSnackbar();
  const [tab, setTab] = useState('tests');
  const [text, setText] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  const [editingPkg, setEditingPkg] = useState(null);
  const search = useDebounced(text);
  const tests = useQuery({ queryKey: ['lab', 'tests', search, page], queryFn: () => api.get(`/labs/me/tests${qs({ search, page, pageSize: 20 })}`).then((r) => r.data), placeholderData: keepPreviousData });
  const allTests = useQuery({ queryKey: ['lab', 'tests', 'all'], queryFn: () => api.get('/labs/me/tests?pageSize=100').then((r) => r.data.items) });
  const packages = useQuery({ queryKey: ['lab', 'packages'], queryFn: () => api.get('/labs/me/packages').then((r) => r.data) });
  const categories = useQuery({ queryKey: ['lab', 'categories'], queryFn: () => api.get('/labs/me/categories').then((r) => r.data) });
  const del = async (url, title) => {
    if (!(await confirm({ title, body: 'إذا كان مستخدماً في طلبات سابقة سيتم إيقافه بدلاً من حذفه للحفاظ على السجل.', danger: true, confirmText: 'حذف' }))) return;
    try {
      const { data } = await api.delete(url);
      enqueueSnackbar(data.deactivated ? 'تم الإيقاف (مستخدم في طلبات سابقة)' : 'تم الحذف', { variant: 'success' });
      qc.invalidateQueries({ queryKey: ['lab'] });
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    }
  };
  return (
    <>
      <PageHeader
        title="التحاليل والباقات"
        subtitle="الأسعار والمعدلات الطبيعية هنا هي ما يراه المريض ويُحسب به الطلب."
        actions={canEdit && (tab === 'packages' ? <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditingPkg('new')}>باقة جديدة</Button> : tab === 'tests' ? <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing('new')}>تحليل جديد</Button> : null)}
      />
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab value="tests" label="التحاليل" />
        <Tab value="packages" label="الباقات" />
        <Tab value="categories" label="التصنيفات" />
      </Tabs>
      {tab === 'tests' && (
        <>
          <TextField size="small" placeholder="ابحث بالاسم أو الكود" value={text} onChange={(e) => { setText(e.target.value); setPage(1); }} sx={{ mb: 2, maxWidth: 360 }} InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }} />
          {tests.error && <ErrorState error={tests.error} onRetry={tests.refetch} />}
          <Card>
            <DataTable
              loading={tests.isLoading}
              rows={tests.data?.items}
              total={tests.data?.total}
              page={page}
              pageSize={20}
              onPageChange={setPage}
              onRowClick={canEdit ? (t) => setEditing(t) : undefined}
              empty={<EmptyState title="لا توجد تحاليل" body="أضف أول تحليل مع بنوده ومعدلاته الطبيعية." />}
              columns={[
                { key: 'code', label: 'الكود', render: (t) => <Typography dir="ltr" sx={{ fontWeight: 600 }}>{t.code}</Typography> },
                { key: 'name', label: 'التحليل', render: (t) => <Box><Typography sx={{ fontWeight: 600 }}>{t.name}</Typography><Typography variant="caption" color="text.secondary">{t.category?.name || 'بدون تصنيف'} • {t.sampleType || '—'}</Typography></Box> },
                { key: 'params', label: 'البنود', render: (t) => <Tooltip title={t.parameters.map((p) => `${p.name}: ${p.ranges.map(rangeSummary).join(' | ') || '—'}`).join('\n')}><Typography variant="body2">{t.parameters.length} بند</Typography></Tooltip> },
                { key: 'price', label: 'السعر', render: (t) => fmtMoney(t.price) },
                { key: 'active', label: 'الحالة', render: (t) => <Chip size="small" label={t.isActive ? 'متاح' : 'موقوف'} color={t.isActive ? 'success' : 'default'} variant="outlined" /> },
                ...(canEdit ? [{ key: 'x', label: '', render: (t) => <IconButton size="small" color="error" aria-label="حذف" onClick={(e) => { e.stopPropagation(); del(`/labs/me/tests/${t.id}`, `حذف ${t.name}؟`); }}><DeleteOutline fontSize="small" /></IconButton> }] : []),
              ]}
            />
          </Card>
        </>
      )}
      {tab === 'packages' &&
        (packages.isLoading ? <ListSkeleton rows={2} height={120} /> : packages.data?.length ? (
          <Grid container spacing={2}>
            {packages.data.map((p) => (
              <Grid key={p.id} xs={12} md={6}>
                <Card sx={{ p: 2, height: '100%', opacity: p.isActive ? 1 : 0.6 }}>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="h6">{p.name}</Typography>
                    {canEdit && (
                      <Stack direction="row">
                        <IconButton size="small" aria-label="تعديل" onClick={() => setEditingPkg(p)}><EditOutlined fontSize="small" /></IconButton>
                        <IconButton size="small" color="error" aria-label="حذف" onClick={() => del(`/labs/me/packages/${p.id}`, `حذف ${p.name}؟`)}><DeleteOutline fontSize="small" /></IconButton>
                      </Stack>
                    )}
                  </Stack>
                  {p.description && <Typography variant="body2" color="text.secondary">{p.description}</Typography>}
                  <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ my: 1 }}>{p.tests.map((t) => <Chip key={t.id} size="small" label={t.name} />)}</Stack>
                  <Typography sx={{ fontWeight: 700, color: tokens.petrol }}>{fmtMoney(p.price)} <Typography component="span" variant="body2" color="text.secondary">بدلاً من {fmtMoney(p.separatePrice)}</Typography></Typography>
                  {!p.isVisible && <Alert severity="warning" sx={{ mt: 1 }}>أخفتها إدارة المنصة من الصفحة العامة.</Alert>}
                </Card>
              </Grid>
            ))}
          </Grid>
        ) : (
          <EmptyState title="لا توجد باقات" body="الباقات تجمع عدة تحاليل بسعر مخفض (فحص شامل، متابعة سكر…)." />
        ))}
      {tab === 'categories' && (categories.data ? <CategoriesPanel categories={categories.data} canEdit={canEdit} /> : <ListSkeleton rows={2} />)}
      {editing && <TestDialog test={editing} categories={categories.data || []} onClose={() => setEditing(null)} />}
      {editingPkg && <PackageDialog pkg={editingPkg} tests={(allTests.data || []).filter((t) => t.isActive)} onClose={() => setEditingPkg(null)} />}
    </>
  );
}
