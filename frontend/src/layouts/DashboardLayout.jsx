import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { Link as RouterLink, NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  AppBar,
  Avatar,
  Box,
  Chip,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Badge,
  Menu,
  MenuItem,
  Toolbar,
  Typography,
  useMediaQuery,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import { useTheme } from '@mui/material/styles';
import { Brand } from '../components/common';
import NotificationsBell from '../components/NotificationsBell';
import { useAuth } from '../auth/AuthProvider';
import { fileUrl } from '../api/client';
import { tokens } from '../theme';
import { ROLE_LABEL } from '../utils/labels';

const WIDTH = 256;

/**
 * Shared shell for every dashboard. `nav` is [{ to, label, icon, end?, perm?, group? }].
 * Items whose `perm` the user lacks are hidden (the API enforces it regardless).
 */
export default function DashboardLayout({ nav, base, banner }) {
  const { user, logout, can } = useAuth();
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up('md'));
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState(null);
  const navigate = useNavigate();
  const items = nav.filter((i) => !i.perm || can(i.perm));
  const hasChat = items.some((i) => i.badge === 'chat');
  const { data: chatUnread } = useQuery({
    queryKey: ['chat', 'unread'],
    queryFn: () => api.get('/chat/unread-count').then((r) => r.data),
    enabled: hasChat,
    refetchInterval: 60_000,
  });
  const groups = [...new Set(items.map((i) => i.group || ''))];

  const drawer = (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: '#fff' }}>
      <Box sx={{ p: 2 }}>
        <RouterLink to="/" style={{ textDecoration: 'none' }}>
          <Brand />
        </RouterLink>
      </Box>
      <Box sx={{ flex: 1, overflowY: 'auto', px: 1 }} component="nav" aria-label="القائمة الرئيسية">
        {groups.map((g) => (
          <List key={g || 'main'} dense subheader={g ? <ListSubheader sx={{ bgcolor: 'transparent', lineHeight: '32px' }}>{g}</ListSubheader> : null}>
            {items
              .filter((i) => (i.group || '') === g)
              .map((i) => (
                <ListItemButton
                  key={i.to}
                  component={NavLink}
                  to={i.to}
                  end={i.end}
                  onClick={() => setOpen(false)}
                  sx={{
                    borderRadius: '8px',
                    mb: 0.25,
                    color: tokens.inkSoft,
                    '& .MuiListItemIcon-root': { color: 'inherit', minWidth: 36 },
                    '&.active': { bgcolor: tokens.mint, color: tokens.petrol, fontWeight: 600, '& .MuiListItemText-primary': { fontWeight: 600 } },
                  }}
                >
                  <ListItemIcon>{i.icon}</ListItemIcon>
                  <ListItemText primary={i.label} />
                  {i.badge === 'chat' && chatUnread?.count > 0 && (
                    <Badge badgeContent={chatUnread.count} color="secondary" max={99} sx={{ mr: 1.5 }} />
                  )}
                </ListItemButton>
              ))}
          </List>
        ))}
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <Drawer
        variant={desktop ? 'permanent' : 'temporary'}
        // With the RTL stylis plugin, "left" is flipped to the right edge.
        anchor="left"
        open={desktop || open}
        onClose={() => setOpen(false)}
        sx={{ width: { md: WIDTH }, flexShrink: 0, '& .MuiDrawer-paper': { width: WIDTH, borderRight: `1px solid ${tokens.line}`, borderLeft: 0 } }}
      >
        {drawer}
      </Drawer>
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: `1px solid ${tokens.line}`, bgcolor: '#fff' }}>
          <Toolbar sx={{ gap: 1 }}>
            {!desktop && (
              <IconButton onClick={() => setOpen(true)} aria-label="القائمة">
                <MenuIcon />
              </IconButton>
            )}
            <Box sx={{ flex: 1 }} />
            <NotificationsBell allHref={`${base}/notifications`} />
            <IconButton onClick={(e) => setAnchor(e.currentTarget)} aria-label="الحساب">
              <Avatar src={fileUrl(user?.avatarFileId) || undefined} sx={{ width: 34, height: 34, bgcolor: tokens.petrol, fontSize: 15 }}>
                {user?.fullName?.[0]}
              </Avatar>
            </IconButton>
            <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
              <Box sx={{ px: 2, py: 1 }}>
                <Typography sx={{ fontWeight: 600 }}>{user?.fullName}</Typography>
                <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, flexWrap: 'wrap' }}>
                  {user?.roles.map((r) => (
                    <Chip key={r} size="small" label={ROLE_LABEL[r] || r} />
                  ))}
                </Box>
              </Box>
              <Divider />
              <MenuItem onClick={() => { setAnchor(null); navigate(`${base}/settings`); }}>الإعدادات والأمان</MenuItem>
              <MenuItem onClick={() => { setAnchor(null); navigate('/'); }}>الموقع العام</MenuItem>
              <MenuItem onClick={async () => { setAnchor(null); await logout(); navigate('/login'); }} sx={{ color: 'error.main' }}>
                تسجيل الخروج
              </MenuItem>
            </Menu>
          </Toolbar>
        </AppBar>
        {banner}
        <Box component="main" sx={{ p: { xs: 2, md: 3 }, maxWidth: 1400, width: '100%', mx: 'auto' }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}
