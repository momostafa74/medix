import { useState } from 'react';
import { Link as RouterLink, NavLink, Outlet } from 'react-router-dom';
import { AppBar, Box, Button, Container, Drawer, IconButton, List, ListItemButton, ListItemText, Stack, Toolbar, Typography } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import { Brand } from '../components/common';
import NotificationsBell from '../components/NotificationsBell';
import { homeFor, useAuth } from '../auth/AuthProvider';
import { usePublicSettings } from '../api/queries';
import { tokens } from '../theme';

const LINKS = [
  { to: '/doctors', label: 'الأطباء' },
  { to: '/specialties', label: 'التخصصات' },
  { to: '/labs', label: 'المعامل' },
  { to: '/lab-tests', label: 'أسعار التحاليل' },
  { to: '/radiology', label: 'مراكز الأشعة' },
  { to: '/medicines', label: 'الأدوية' },
  { to: '/pharmacies', label: 'الصيدليات' },
  { to: '/emergency', label: 'الطوارئ' },
];

export default function PublicLayout() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const { data: settings } = usePublicSettings();
  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <a href="#main" className="skip-link" style={{ position: 'absolute', insetInlineStart: -9999 }} onFocus={(e) => (e.target.style.insetInlineStart = '8px')} onBlur={(e) => (e.target.style.insetInlineStart = '-9999px')}>
        تخطي إلى المحتوى
      </a>
      <AppBar position="sticky" color="inherit" sx={{ borderBottom: `1px solid ${tokens.line}`, bgcolor: 'rgba(255,255,255,.96)', backdropFilter: 'blur(6px)' }} elevation={0}>
        <Container maxWidth="lg">
          <Toolbar disableGutters sx={{ gap: 2 }}>
            <IconButton sx={{ display: { md: 'none' } }} onClick={() => setOpen(true)} aria-label="القائمة">
              <MenuIcon />
            </IconButton>
            <RouterLink to="/" style={{ textDecoration: 'none' }} aria-label="الصفحة الرئيسية">
              <Brand />
            </RouterLink>
            <Stack direction="row" spacing={0.5} sx={{ display: { xs: 'none', md: 'flex' }, mx: 2 }} component="nav">
              {LINKS.map((l) => (
                <Button
                  key={l.to}
                  component={NavLink}
                  to={l.to}
                  color="inherit"
                  sx={{ fontWeight: 500, '&.active': { color: 'primary.main', bgcolor: tokens.mint } }}
                >
                  {l.label}
                </Button>
              ))}
            </Stack>
            <Box sx={{ flex: 1 }} />
            {user ? (
              <>
                <NotificationsBell />
                <Button component={RouterLink} to={homeFor(user)} variant="contained">
                  لوحتي
                </Button>
              </>
            ) : (
              <>
                <Button component={RouterLink} to="/login" color="inherit">
                  تسجيل الدخول
                </Button>
                <Button component={RouterLink} to="/register" variant="contained" sx={{ display: { xs: 'none', sm: 'inline-flex' } }}>
                  إنشاء حساب
                </Button>
              </>
            )}
          </Toolbar>
        </Container>
      </AppBar>
      <Drawer anchor="left" open={open} onClose={() => setOpen(false)}>
        <Box sx={{ width: 260, p: 2 }}>
          <Brand />
          <List>
            {LINKS.map((l) => (
              <ListItemButton key={l.to} component={NavLink} to={l.to} onClick={() => setOpen(false)}>
                <ListItemText primary={l.label} />
              </ListItemButton>
            ))}
          </List>
        </Box>
      </Drawer>
      <Box component="main" id="main" sx={{ flex: 1 }}>
        <Outlet />
      </Box>
      <Box component="footer" sx={{ bgcolor: tokens.petrolDark, color: '#fff', mt: 8, py: 5 }}>
        <Container maxWidth="lg">
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={4} justifyContent="space-between">
            <Box sx={{ maxWidth: 340 }}>
              <Brand light />
              <Typography sx={{ mt: 1.5, opacity: 0.85 }} variant="body2">
                ابحث عن طبيب معتمد، اختر الموعد اللي يناسبك، واحجز في دقيقة — من غير مكالمات ولا انتظار.
              </Typography>
            </Box>
            <Stack direction="row" spacing={6}>
              <Stack spacing={1}>
                <Typography sx={{ fontWeight: 600 }}>للمرضى</Typography>
                <FooterLink to="/doctors">ابحث عن طبيب</FooterLink>
                <FooterLink to="/specialties">كل التخصصات</FooterLink>
                <FooterLink to="/lab-tests">قارن أسعار التحاليل</FooterLink>
                <FooterLink to="/radiology-services">ابحث عن فحص أشعة</FooterLink>
                <FooterLink to="/medicines">قارن أسعار الأدوية</FooterLink>
                <FooterLink to="/verify-document">التحقق من تقرير</FooterLink>
                <FooterLink to="/register">إنشاء حساب</FooterLink>
              </Stack>
              <Stack spacing={1}>
                <Typography sx={{ fontWeight: 600 }}>لمقدمي الخدمة</Typography>
                <FooterLink to="/register/doctor">انضم كطبيب</FooterLink>
                <FooterLink to="/register/provider?type=LABORATORY">سجّل معملك</FooterLink>
                <FooterLink to="/register/provider?type=RADIOLOGY">سجّل مركز الأشعة</FooterLink>
                <FooterLink to="/register/provider?type=PHARMACY">سجّل صيدليتك</FooterLink>
                <FooterLink to="/login">دخول مقدمي الخدمة</FooterLink>
              </Stack>
            </Stack>
            <Box>
              <Typography sx={{ fontWeight: 600 }}>الدعم</Typography>
              <Typography variant="body2" sx={{ opacity: 0.85, mt: 1 }} dir="ltr">
                {settings?.['platform.supportPhone']}
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.85 }}>
                {settings?.['platform.supportEmail']}
              </Typography>
            </Box>
          </Stack>
          <Typography variant="caption" sx={{ display: 'block', mt: 4, opacity: 0.6 }}>
            © {new Date().getFullYear()} ميديكس. المعلومات المعروضة لا تغني عن استشارة الطبيب.
          </Typography>
        </Container>
      </Box>
    </Box>
  );
}

function FooterLink({ to, children }) {
  return (
    <Typography component={RouterLink} to={to} variant="body2" sx={{ color: '#fff', opacity: 0.85, textDecoration: 'none', '&:hover': { opacity: 1, textDecoration: 'underline' } }}>
      {children}
    </Typography>
  );
}
