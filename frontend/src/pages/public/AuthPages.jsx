import { useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { Alert, Box, Button, Card, Checkbox, Container, Divider, FormControlLabel, IconButton, InputAdornment, MenuItem, Stack, TextField, Typography } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import Visibility from '@mui/icons-material/VisibilityOutlined';
import VisibilityOff from '@mui/icons-material/VisibilityOffOutlined';
import { api, errorMessage } from '../../api/client';
import { useQuery } from '@tanstack/react-query';
import { homeFor, useAuth } from '../../auth/AuthProvider';
import { useSpecialties } from '../../api/queries';
import LocationSelect from '../../components/LocationSelect';
import { Brand } from '../../components/common';

const PHONE = /^(\+?20|0)?1[0125]\d{8}$/;
const PASSWORD = /^(?=.*[A-Za-z؀-ۿ])(?=.*\d).{8,72}$/;
const PASSWORD_HELP = '8 أحرف على الأقل وتحتوي على حروف وأرقام';

function Shell({ title, subtitle, children, width = 440 }) {
  return (
    <Container sx={{ py: { xs: 4, md: 7 } }}>
      <Card sx={{ maxWidth: width, mx: 'auto', p: { xs: 2.5, md: 4 } }}>
        <Box sx={{ mb: 2 }}>
          <Brand />
        </Box>
        <Typography variant="h4" component="h1">
          {title}
        </Typography>
        {subtitle && (
          <Typography color="text.secondary" sx={{ mt: 0.5, mb: 1 }}>
            {subtitle}
          </Typography>
        )}
        <Box sx={{ mt: 2 }}>{children}</Box>
      </Card>
    </Container>
  );
}

export function PasswordField({ field, ...props }) {
  const [show, setShow] = useState(false);
  return (
    <TextField
      {...field}
      {...props}
      type={show ? 'text' : 'password'}
      InputProps={{
        endAdornment: (
          <InputAdornment position="end">
            <IconButton onClick={() => setShow((s) => !s)} edge="end" aria-label={show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}>
              {show ? <VisibilityOff /> : <Visibility />}
            </IconButton>
          </InputAdornment>
        ),
      }}
    />
  );
}

export function Login() {
  const { login, verifyTwoFactor } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [err, setErr] = useState('');
  const [locked, setLocked] = useState(false);
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [busy, setBusy] = useState(false);
  const { register, handleSubmit, control, formState } = useForm({ defaultValues: { identifier: '', password: '' } });
  const go = (user) => {
    const next = params.get('next');
    nav(next && next.startsWith('/') && !next.startsWith('//') ? next : homeFor(user), { replace: true });
  };
  const fail = (e) => {
    setErr(errorMessage(e));
    setLocked(e?.response?.status === 423);
  };
  const submit = async (v) => {
    setErr('');
    setLocked(false);
    try {
      const r = await login(v.identifier.trim(), v.password);
      if (r?.twoFactorRequired) setChallenge(r.challengeToken);
      else go(r);
    } catch (e) {
      fail(e);
    }
  };
  const verify = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      go(await verifyTwoFactor(challenge, code.trim()));
    } catch (ex) {
      fail(ex);
      if (ex?.response?.data?.error === 'TWO_FACTOR_CHALLENGE_EXPIRED' || ex?.response?.status === 423) setChallenge(null);
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  if (challenge) {
    return (
      <Shell title="التحقق بخطوتين" subtitle={useBackup ? 'أدخل أحد الأكواد الاحتياطية اللي حفظتها وقت التفعيل' : 'افتح تطبيق المصادقة على موبايلك واكتب الكود المكون من 6 أرقام'}>
        <Stack key="two-factor" component="form" spacing={2} onSubmit={verify} noValidate>
          {err && <Alert severity="error">{err}</Alert>}
          <TextField
            label={useBackup ? 'الكود الاحتياطي' : 'كود التحقق'}
            value={code}
            onChange={(e) => setCode(useBackup ? e.target.value.toUpperCase() : e.target.value.replace(/\D/g, '').slice(0, 6))}
            autoFocus
            autoComplete="one-time-code"
            inputProps={{ dir: 'ltr', inputMode: useBackup ? 'text' : 'numeric', style: { textAlign: 'center', letterSpacing: 6, fontSize: 22 }, 'aria-label': 'كود التحقق' }}
          />
          <Button type="submit" variant="contained" size="large" disabled={busy || (useBackup ? code.replace(/[^A-Z0-9]/g, '').length < 8 : code.length !== 6)}>
            {busy ? 'جاري التحقق…' : 'تأكيد'}
          </Button>
          <Button onClick={() => { setUseBackup(!useBackup); setCode(''); setErr(''); }}>{useBackup ? 'استخدم تطبيق المصادقة' : 'مش معاك الموبايل؟ استخدم كوداً احتياطياً'}</Button>
          <Button color="inherit" onClick={() => { setChallenge(null); setCode(''); setErr(''); }}>رجوع</Button>
        </Stack>
      </Shell>
    );
  }
  return (
    <Shell title="تسجيل الدخول" subtitle="أهلاً بك من جديد">
      <Stack component="form" spacing={2} onSubmit={handleSubmit(submit)} noValidate>
        {err && (
          <Alert severity={locked ? 'warning' : 'error'} action={locked ? <Button color="inherit" size="small" component={RouterLink} to="/forgot-password">إعادة تعيين</Button> : undefined}>
            {err}
          </Alert>
        )}
        <TextField label="رقم الموبايل أو البريد الإلكتروني" autoComplete="username" autoFocus {...register('identifier', { required: true })} error={!!formState.errors.identifier} />
        <Controller name="password" control={control} rules={{ required: true }} render={({ field, fieldState }) => <PasswordField field={field} label="كلمة المرور" autoComplete="current-password" error={!!fieldState.error} />} />
        <Box sx={{ textAlign: 'left' }}>
          <Typography component={RouterLink} to="/forgot-password" variant="body2" color="primary">
            نسيت كلمة المرور؟
          </Typography>
        </Box>
        <Button type="submit" variant="contained" size="large" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? 'جاري الدخول…' : 'دخول'}
        </Button>
        <Divider />
        <Typography variant="body2" sx={{ textAlign: 'center' }}>
          ليس لديك حساب؟ <RouterLink to="/register">أنشئ حساب مريض</RouterLink> أو <RouterLink to="/register/doctor">سجّل كطبيب</RouterLink>
        </Typography>
      </Stack>
    </Shell>
  );
}

export function Register() {
  const { register: signUp } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [err, setErr] = useState('');
  const [withName, setWithName] = useState(false);
  const { register, handleSubmit, control, watch, formState } = useForm({ defaultValues: { phone: '', password: '', confirm: '', fullName: '' } });
  const e = formState.errors;
  const submit = async (v) => {
    setErr('');
    try {
      await signUp({ phone: v.phone, password: v.password, ...(v.fullName.trim() ? { fullName: v.fullName.trim() } : {}) });
      nav(params.get('next') || '/patient', { replace: true });
    } catch (ex) {
      setErr(errorMessage(ex));
    }
  };
  return (
    <Shell title="إنشاء حساب مريض" subtitle="رقم موبايلك وكلمة سر — وخلاص. الحساب مجاني للمرضى دائماً." width={460}>
      <Stack component="form" spacing={2} onSubmit={handleSubmit(submit)} noValidate>
        {err && <Alert severity="error">{err}</Alert>}
        <TextField label="رقم الموبايل" required autoFocus inputProps={{ dir: 'ltr', inputMode: 'tel', autoComplete: 'tel' }} placeholder="01xxxxxxxxx" {...register('phone', { required: 'مطلوب', pattern: { value: PHONE, message: 'رقم موبايل مصري غير صحيح' } })} error={!!e.phone} helperText={e.phone?.message || 'هتدخل بيه بعد كده'} />
        <Controller name="password" control={control} rules={{ required: 'مطلوب', minLength: { value: 6, message: '6 أحرف أو أرقام على الأقل' } }} render={({ field, fieldState }) => <PasswordField field={field} label="كلمة السر" autoComplete="new-password" required error={!!fieldState.error} helperText={fieldState.error?.message || '6 أحرف أو أرقام على الأقل'} />} />
        <Controller name="confirm" control={control} rules={{ required: 'مطلوب', validate: (v) => v === watch('password') || 'كلمتا السر غير متطابقتين' }} render={({ field, fieldState }) => <PasswordField field={field} label="تأكيد كلمة السر" autoComplete="new-password" required error={!!fieldState.error} helperText={fieldState.error?.message} />} />
        {withName ? (
          <TextField label="اسمك (اختياري)" {...register('fullName', { minLength: { value: 2, message: 'حرفين على الأقل' } })} error={!!e.fullName} helperText={e.fullName?.message || 'يظهر للطبيب عند الحجز — تقدر تضيفه بعدين'} />
        ) : (
          <Button size="small" onClick={() => setWithName(true)} sx={{ alignSelf: 'flex-start' }}>+ إضافة الاسم (اختياري)</Button>
        )}
        <Button type="submit" variant="contained" size="large" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? 'جاري إنشاء الحساب…' : 'إنشاء الحساب'}
        </Button>
        <Typography variant="body2" sx={{ textAlign: 'center' }}>
          لديك حساب بالفعل؟ <RouterLink to="/login">سجّل الدخول</RouterLink>
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
          طبيب أو معمل أو صيدلية؟ <RouterLink to="/register/doctor">سجّل كطبيب</RouterLink> · <RouterLink to="/register/provider">سجّل منشأتك</RouterLink>
        </Typography>
      </Stack>
    </Shell>
  );
}

/** Providers pay a monthly subscription after a free trial; patients never pay. */
function PlanNote({ type }) {
  const { data } = useQuery({ queryKey: ['subscription', 'plans', type], queryFn: () => api.get(`/subscriptions/plans?type=${type}`).then((r) => r.data), staleTime: 300_000 });
  const plan = data?.find((p) => p.isDefault) || data?.[0];
  return (
    <Alert severity="info" icon={false}>
      تبدأ بفترة تجريبية مجانية، وبعدها اشتراك {plan ? <b>{plan.nameAr} — {plan.price} ج.م / {plan.durationDays === 30 ? 'شهر' : `${plan.durationDays} يوم`}</b> : 'شهري'}. لو الاشتراك انتهى بيتقفل الحساب ويختفي من البحث لحد التجديد (أونلاين أو إنستاباي / فودافون كاش / تحويل بنكي).
    </Alert>
  );
}

export function RegisterDoctor() {
  const { registerDoctor } = useAuth();
  const nav = useNavigate();
  const { data: specialties = [] } = useSpecialties();
  const [err, setErr] = useState('');
  const [loc, setLoc] = useState({});
  const { register, handleSubmit, control, formState, watch } = useForm({
    defaultValues: { fullName: '', title: 'د.', phone: '', email: '', password: '', specialtyId: '', subSpecialtyIds: [], gender: '', qualifications: '', licenseNumber: '', licenseAuthority: 'نقابة الأطباء', experienceYears: '', consultationPrice: '', bio: '', clinicName: '', clinicAddress: '' },
  });
  const e = formState.errors;
  const primary = watch('specialtyId');
  const roots = specialties.filter((s) => !s.parentId);
  const subs = specialties.filter((s) => s.parentId && s.parentId === primary);
  const submit = async (v) => {
    setErr('');
    try {
      await registerDoctor({
        fullName: v.fullName,
        title: v.title,
        phone: v.phone,
        email: v.email,
        password: v.password,
        specialtyId: v.specialtyId,
        subSpecialtyIds: v.subSpecialtyIds,
        gender: v.gender || undefined,
        qualifications: v.qualifications,
        licenseNumber: v.licenseNumber,
        licenseAuthority: v.licenseAuthority || undefined,
        experienceYears: Number(v.experienceYears),
        consultationPrice: Number(v.consultationPrice),
        bio: v.bio || undefined,
        clinic: v.clinicName ? { name: v.clinicName, address: v.clinicAddress, cityId: loc.cityId, areaId: loc.areaId } : undefined,
      });
      nav('/doctor/profile', { replace: true });
    } catch (ex) {
      setErr(errorMessage(ex));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };
  const req = { required: 'مطلوب' };
  return (
    <Shell title="انضم كطبيب" subtitle="بعد التسجيل ارفع صورة الترخيص من ملفك، وسيظهر ملفك للمرضى بعد مراجعة الإدارة." width={720}>
      <Stack component="form" spacing={2.5} onSubmit={handleSubmit(submit)} noValidate>
        <PlanNote type="DOCTOR" />
        {err && <Alert severity="error">{err}</Alert>}
        <Typography variant="h6">بيانات الحساب</Typography>
        <Grid container spacing={2}>
          <Grid xs={4} sm={2}>
            <Controller name="title" control={control} render={({ field }) => (
              <TextField select label="اللقب" {...field}>
                {['د.', 'أ.د.', 'أ.م.د.'].map((x) => (
                  <MenuItem key={x} value={x}>{x}</MenuItem>
                ))}
              </TextField>
            )} />
          </Grid>
          <Grid xs={8} sm={6}>
            <TextField label="الاسم بالكامل" required {...register('fullName', { ...req, minLength: { value: 3, message: '3 أحرف على الأقل' } })} error={!!e.fullName} helperText={e.fullName?.message} />
          </Grid>
          <Grid xs={12} sm={4}>
            <Controller name="gender" control={control} render={({ field }) => (
              <TextField select label="النوع" {...field}>
                <MenuItem value="">—</MenuItem>
                <MenuItem value="MALE">طبيب</MenuItem>
                <MenuItem value="FEMALE">طبيبة</MenuItem>
              </TextField>
            )} />
          </Grid>
          <Grid xs={12} sm={6}>
            <TextField label="رقم الموبايل (وواتساب)" required inputProps={{ dir: 'ltr' }} {...register('phone', { ...req, pattern: { value: PHONE, message: 'رقم موبايل غير صحيح' } })} error={!!e.phone} helperText={e.phone?.message} />
          </Grid>
          <Grid xs={12} sm={6}>
            <TextField label="البريد الإلكتروني" required type="email" inputProps={{ dir: 'ltr' }} {...register('email', { ...req, pattern: { value: /^\S+@\S+\.\S+$/, message: 'بريد غير صحيح' } })} error={!!e.email} helperText={e.email?.message} />
          </Grid>
          <Grid xs={12}>
            <Controller name="password" control={control} rules={{ ...req, pattern: { value: PASSWORD, message: PASSWORD_HELP } }} render={({ field, fieldState }) => <PasswordField field={field} label="كلمة المرور" autoComplete="new-password" required error={!!fieldState.error} helperText={fieldState.error?.message || PASSWORD_HELP} />} />
          </Grid>
        </Grid>
        <Divider />
        <Typography variant="h6">البيانات المهنية</Typography>
        <Grid container spacing={2}>
          <Grid xs={12} sm={6}>
            <Controller name="specialtyId" control={control} rules={req} render={({ field, fieldState }) => (
              <TextField select label="التخصص الرئيسي" required {...field} error={!!fieldState.error}>
                {roots.map((s) => (
                  <MenuItem key={s.id} value={s.id}>{s.nameAr}</MenuItem>
                ))}
              </TextField>
            )} />
          </Grid>
          <Grid xs={12} sm={6}>
            <Controller name="subSpecialtyIds" control={control} render={({ field }) => (
              <TextField select label="تخصصات فرعية" SelectProps={{ multiple: true }} {...field} disabled={!subs.length} helperText={!subs.length ? 'لا توجد تخصصات فرعية لهذا التخصص' : ''}>
                {subs.map((s) => (
                  <MenuItem key={s.id} value={s.id}>{s.nameAr}</MenuItem>
                ))}
              </TextField>
            )} />
          </Grid>
          <Grid xs={12} sm={6}>
            <TextField label="رقم الترخيص" required {...register('licenseNumber', req)} error={!!e.licenseNumber} />
          </Grid>
          <Grid xs={12} sm={6}>
            <TextField label="جهة الترخيص" {...register('licenseAuthority')} />
          </Grid>
          <Grid xs={6}>
            <TextField label="سنوات الخبرة" required type="number" inputProps={{ min: 0, max: 70 }} {...register('experienceYears', req)} error={!!e.experienceYears} />
          </Grid>
          <Grid xs={6}>
            <TextField label="سعر الكشف (ج.م)" required type="number" inputProps={{ min: 0 }} {...register('consultationPrice', req)} error={!!e.consultationPrice} />
          </Grid>
          <Grid xs={12}>
            <TextField label="المؤهلات العلمية" required multiline minRows={2} {...register('qualifications', { ...req, minLength: { value: 3, message: 'مطلوب' } })} error={!!e.qualifications} />
          </Grid>
          <Grid xs={12}>
            <TextField label="نبذة عنك (تظهر للمرضى)" multiline minRows={3} {...register('bio')} />
          </Grid>
        </Grid>
        <Divider />
        <Typography variant="h6">العيادة (يمكن إضافتها لاحقاً)</Typography>
        <Grid container spacing={2}>
          <Grid xs={12} sm={6}>
            <TextField label="اسم العيادة" {...register('clinicName')} />
          </Grid>
          <Grid xs={12} sm={6}>
            <TextField label="عنوان العيادة" {...register('clinicAddress', { validate: (v, all) => !all.clinicName || v.trim().length >= 3 || 'أدخل العنوان' })} error={!!e.clinicAddress} helperText={e.clinicAddress?.message} />
          </Grid>
        </Grid>
        <LocationSelect value={loc} onChange={setLoc} />
        <Button type="submit" variant="contained" size="large" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? 'جاري التسجيل…' : 'إرسال طلب الانضمام'}
        </Button>
      </Stack>
    </Shell>
  );
}

export function ForgotPassword() {
  const [done, setDone] = useState(null);
  const [err, setErr] = useState('');
  const { register, handleSubmit, formState } = useForm();
  const submit = async (v) => {
    setErr('');
    try {
      const { data } = await api.post('/auth/forgot-password', { identifier: v.identifier.trim() });
      setDone(data);
    } catch (e) {
      setErr(errorMessage(e));
    }
  };
  return (
    <Shell title="نسيت كلمة المرور" subtitle="أدخل رقم الموبايل أو البريد المسجل وسنرسل لك رابط إعادة التعيين">
      {done ? (
        <Stack spacing={2}>
          <Alert severity="success">{done.message}</Alert>
          {done.devToken && (
            <Alert severity="info">
              بيئة التطوير: <RouterLink to={`/reset-password?token=${done.devToken}`}>افتح رابط إعادة التعيين</RouterLink>
            </Alert>
          )}
          <Button component={RouterLink} to="/login">العودة لتسجيل الدخول</Button>
        </Stack>
      ) : (
        <Stack component="form" spacing={2} onSubmit={handleSubmit(submit)}>
          {err && <Alert severity="error">{err}</Alert>}
          <TextField label="رقم الموبايل أو البريد" required {...register('identifier', { required: true })} />
          <Button type="submit" variant="contained" disabled={formState.isSubmitting}>
            إرسال الرابط
          </Button>
        </Stack>
      )}
    </Shell>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [err, setErr] = useState('');
  const { handleSubmit, control, formState, watch } = useForm({ defaultValues: { newPassword: '', confirm: '' } });
  const submit = async (v) => {
    setErr('');
    try {
      await api.post('/auth/reset-password', { token: params.get('token'), newPassword: v.newPassword });
      nav('/login?reset=1', { replace: true });
    } catch (e) {
      setErr(errorMessage(e));
    }
  };
  if (!params.get('token')) return <Shell title="رابط غير صالح"><Alert severity="error">الرابط ناقص. اطلب رابطاً جديداً من صفحة نسيت كلمة المرور.</Alert></Shell>;
  return (
    <Shell title="تعيين كلمة مرور جديدة">
      <Stack component="form" spacing={2} onSubmit={handleSubmit(submit)}>
        {err && <Alert severity="error">{err}</Alert>}
        <Controller name="newPassword" control={control} rules={{ required: true, pattern: { value: PASSWORD, message: PASSWORD_HELP } }} render={({ field, fieldState }) => <PasswordField field={field} label="كلمة المرور الجديدة" autoComplete="new-password" error={!!fieldState.error} helperText={PASSWORD_HELP} />} />
        <Controller name="confirm" control={control} rules={{ validate: (v) => v === watch('newPassword') || 'كلمتا المرور غير متطابقتين' }} render={({ field, fieldState }) => <PasswordField field={field} label="تأكيد كلمة المرور" error={!!fieldState.error} helperText={fieldState.error?.message} />} />
        <Button type="submit" variant="contained" disabled={formState.isSubmitting}>
          حفظ كلمة المرور
        </Button>
      </Stack>
    </Shell>
  );
}

export function VerifyEmail() {
  const [params] = useSearchParams();
  const { user, ready, reload } = useAuth();
  const [state, setState] = useState('idle');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (!ready || !user || state !== 'idle') return;
    setState('busy');
    api
      .post('/auth/verification/confirm', { token: params.get('token') })
      .then(() => { setState('ok'); reload(); })
      .catch((e) => { setState('err'); setMsg(errorMessage(e)); });
  }, [ready, user, state, params, reload]);
  if (ready && !user) return <Shell title="تأكيد البريد"><Alert severity="info">سجّل الدخول أولاً ثم افتح الرابط مرة أخرى. <RouterLink to={`/login?next=${encodeURIComponent('/verify?token=' + params.get('token'))}`}>تسجيل الدخول</RouterLink></Alert></Shell>;
  return (
    <Shell title="تأكيد البريد الإلكتروني">
      {state === 'ok' && <Alert severity="success">تم تأكيد بريدك الإلكتروني.</Alert>}
      {state === 'err' && <Alert severity="error">{msg}</Alert>}
      {state === 'busy' && <Typography>جاري التأكيد…</Typography>}
      <Button component={RouterLink} to={homeFor(user)} sx={{ mt: 2 }}>متابعة</Button>
    </Shell>
  );
}

export function NotFound() {
  return (
    <Container sx={{ py: 10, textAlign: 'center' }}>
      <Typography variant="h2">الصفحة غير موجودة</Typography>
      <Typography color="text.secondary" sx={{ mt: 1 }}>تأكد من الرابط أو ارجع للصفحة الرئيسية.</Typography>
      <Button component={RouterLink} to="/" variant="contained" sx={{ mt: 3 }}>الصفحة الرئيسية</Button>
    </Container>
  );
}

const PROVIDER_KINDS = {
  LABORATORY: { label: 'معمل تحاليل', home: 'نقدم خدمة سحب العينات من المنزل', next: '/provider/lab-settings' },
  RADIOLOGY: { label: 'مركز أشعة', home: 'نقدم أشعة منزلية', next: '/provider/radiology-settings' },
  PHARMACY: { label: 'صيدلية', home: 'نقدم خدمة التوصيل', next: '/provider' },
};

/** Labs, radiology centers and pharmacies sign up; the profile stays hidden until admin approval. */
export function RegisterProvider() {
  const { applyAuth } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [err, setErr] = useState('');
  const [loc, setLoc] = useState({});
  const [type, setType] = useState(PROVIDER_KINDS[params.get('type')] ? params.get('type') : 'LABORATORY');
  const { register, handleSubmit, formState, watch, setValue } = useForm({
    defaultValues: { fullName: '', phone: '', email: '', password: '', nameAr: '', nameEn: '', description: '', whatsappNumber: '', licenseNumber: '', homeService: false, branchName: 'الفرع الرئيسي', branchAddress: '', branchPhone: '' },
  });
  const e = formState.errors;
  const req = { required: 'مطلوب' };
  const submit = async (v) => {
    setErr('');
    try {
      const { data } = await api.post('/auth/register/provider', {
        type,
        fullName: v.fullName,
        phone: v.phone,
        email: v.email,
        password: v.password,
        nameAr: v.nameAr,
        nameEn: v.nameEn || undefined,
        description: v.description || undefined,
        whatsappNumber: v.whatsappNumber || undefined,
        licenseNumber: v.licenseNumber || undefined,
        homeService: !!v.homeService,
        branch: { name: v.branchName, address: v.branchAddress, phone: v.branchPhone || undefined, cityId: loc.cityId, areaId: loc.areaId },
      });
      applyAuth(data);
      nav(PROVIDER_KINDS[type].next, { replace: true });
    } catch (ex) {
      setErr(errorMessage(ex));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };
  return (
    <Shell title="انضم كمقدم خدمة" subtitle="سجّل معملك أو مركزك أو صيدليتك. بعد التسجيل ارفع الترخيص والسجل التجاري، وسيظهر حسابك للمرضى بعد مراجعة الإدارة." width={720}>
      <Stack component="form" spacing={2.5} onSubmit={handleSubmit(submit)} noValidate>
        <PlanNote type={type} />
        {err && <Alert severity="error">{err}</Alert>}
        <TextField select label="نوع النشاط" value={type} onChange={(ev) => setType(ev.target.value)}>
          {Object.entries(PROVIDER_KINDS).map(([k, v]) => <MenuItem key={k} value={k}>{v.label}</MenuItem>)}
        </TextField>
        <Typography variant="h6">بيانات المنشأة</Typography>
        <Grid container spacing={2}>
          <Grid xs={12} sm={6}><TextField label="الاسم بالعربية" required {...register('nameAr', { ...req, minLength: { value: 3, message: '3 أحرف على الأقل' } })} error={!!e.nameAr} helperText={e.nameAr?.message} /></Grid>
          <Grid xs={12} sm={6}><TextField label="الاسم بالإنجليزية (اختياري)" {...register('nameEn')} inputProps={{ dir: 'ltr' }} /></Grid>
          <Grid xs={12}><TextField label="نبذة" multiline minRows={2} {...register('description')} /></Grid>
          <Grid xs={12} sm={6}><TextField label="رقم الترخيص / السجل التجاري" {...register('licenseNumber')} /></Grid>
          <Grid xs={12} sm={6}><TextField label="رقم واتساب (اختياري)" {...register('whatsappNumber')} inputProps={{ dir: 'ltr' }} /></Grid>
          <Grid xs={12}>
            <FormControlLabel control={<Checkbox checked={watch('homeService')} onChange={(ev) => setValue('homeService', ev.target.checked)} />} label={PROVIDER_KINDS[type].home} />
          </Grid>
        </Grid>
        <Typography variant="h6">الفرع الرئيسي</Typography>
        <Grid container spacing={2}>
          <Grid xs={12} sm={6}><TextField label="اسم الفرع" required {...register('branchName', req)} error={!!e.branchName} helperText={e.branchName?.message} /></Grid>
          <Grid xs={12} sm={6}><TextField label="هاتف الفرع" {...register('branchPhone')} inputProps={{ dir: 'ltr' }} /></Grid>
          <Grid xs={12}><TextField label="العنوان بالتفصيل" required {...register('branchAddress', { ...req, minLength: { value: 3, message: 'العنوان قصير' } })} error={!!e.branchAddress} helperText={e.branchAddress?.message} /></Grid>
          <Grid xs={12}><LocationSelect value={loc} onChange={setLoc} size="medium" /></Grid>
        </Grid>
        <Typography variant="h6">حساب المسؤول</Typography>
        <Grid container spacing={2}>
          <Grid xs={12} sm={6}><TextField label="اسم المسؤول" required {...register('fullName', { ...req, minLength: { value: 3, message: '3 أحرف على الأقل' } })} error={!!e.fullName} helperText={e.fullName?.message} /></Grid>
          <Grid xs={12} sm={6}><TextField label="رقم الموبايل" required {...register('phone', req)} error={!!e.phone} helperText={e.phone?.message} inputProps={{ dir: 'ltr' }} /></Grid>
          <Grid xs={12} sm={6}><TextField label="البريد الإلكتروني" type="email" required {...register('email', req)} error={!!e.email} helperText={e.email?.message} inputProps={{ dir: 'ltr' }} /></Grid>
          <Grid xs={12} sm={6}><TextField label="كلمة المرور" type="password" required {...register('password', { ...req, minLength: { value: 8, message: '8 أحرف على الأقل' } })} error={!!e.password} helperText={e.password?.message || 'حروف وأرقام، 8 على الأقل'} /></Grid>
        </Grid>
        <Button type="submit" size="large" variant="contained" disabled={formState.isSubmitting}>{formState.isSubmitting ? 'جاري التسجيل…' : 'إنشاء الحساب'}</Button>
      </Stack>
    </Shell>
  );
}
