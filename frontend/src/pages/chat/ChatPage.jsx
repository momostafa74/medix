import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert,
  Avatar,
  Badge,
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Menu,
  MenuItem,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import SendRounded from '@mui/icons-material/SendRounded';
import AttachFile from '@mui/icons-material/AttachFile';
import MoreVert from '@mui/icons-material/MoreVert';
import ArrowForward from '@mui/icons-material/ArrowForward';
import SearchIcon from '@mui/icons-material/Search';
import DoneAll from '@mui/icons-material/DoneAll';
import Done from '@mui/icons-material/Done';
import Schedule from '@mui/icons-material/Schedule';
import SupportAgent from '@mui/icons-material/SupportAgentOutlined';
import ForumOutlined from '@mui/icons-material/ForumOutlined';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { api, errorMessage, fileUrl, qs, uploadFile } from '../../api/client';
import { openRoom } from '../../api/chat';
import { useAuth, useRealtime } from '../../auth/AuthProvider';
import { EmptyState, useDebounced } from '../../components/common';
import ProtectedFile from '../../components/ProtectedFile';
import { inTz } from '../../utils/format';
import { tokens } from '../../theme';
import dayjs from 'dayjs';

const TEAM_TABS = { '': 'الكل', SUPPORT: 'الدعم', ADMIN_PROVIDER: 'الجهات', reported: 'البلاغات' };

/**
 * Two-pane messenger used by every dashboard. Messages arrive over Socket.IO;
 * sending is optimistic (clientId) and reconciled with the server echo.
 */
export default function ChatPage() {
  const { user, can } = useAuth();
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up('md'));
  const [params, setParams] = useSearchParams();
  const roomId = params.get('room');
  const isTeam = can('chat.support');
  const [tab, setTab] = useState('');
  const [text, setText] = useState('');
  const search = useDebounced(text);
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();

  const roomsQuery = useQuery({
    queryKey: ['chat', 'rooms', tab, search],
    queryFn: () =>
      api
        .get(`/chat/rooms${qs({ search, pageSize: 50, ...(tab === 'reported' ? { reported: true } : tab ? { type: tab } : {}) })}`)
        .then((r) => r.data),
    placeholderData: keepPreviousData,
  });
  const rooms = roomsQuery.data?.items || [];

  useRealtime('chat:presence', () => qc.invalidateQueries({ queryKey: ['chat'] }));

  const select = (id) => setParams(id ? { room: id } : {}, { replace: false });

  const startSupport = async () => {
    try {
      const providerId = user.providers?.[0]?.id;
      const room = providerId && !user.patientId ? await openRoom({ type: 'ADMIN_PROVIDER', providerId }) : await openRoom({ type: 'SUPPORT' });
      qc.invalidateQueries({ queryKey: ['chat', 'rooms'] });
      select(room.id);
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    }
  };

  const showList = desktop || !roomId;
  const showThread = desktop || !!roomId;

  return (
    <Box sx={{ height: { xs: 'calc(100vh - 96px)', md: 'calc(100vh - 112px)' }, display: 'flex', border: `1px solid ${tokens.line}`, borderRadius: '12px', overflow: 'hidden', bgcolor: '#fff' }}>
      {showList && (
        <Box sx={{ width: { xs: '100%', md: 340 }, borderInlineEnd: { md: `1px solid ${tokens.line}` }, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <Box sx={{ p: 2, pb: 1 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
              <Typography variant="h5" component="h1">الرسائل</Typography>
              {!isTeam && (
                <Button size="small" startIcon={<SupportAgent />} onClick={startSupport}>
                  {user.patientId ? 'الدعم' : 'راسل الإدارة'}
                </Button>
              )}
            </Stack>
            <TextField
              placeholder="ابحث بالاسم"
              value={text}
              onChange={(e) => setText(e.target.value)}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }}
              inputProps={{ 'aria-label': 'بحث في المحادثات' }}
            />
          </Box>
          {isTeam && (
            <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="fullWidth" sx={{ px: 1, minHeight: 40, '& .MuiTab-root': { minHeight: 40, minWidth: 0, px: 1 } }}>
              {Object.entries(TEAM_TABS).map(([k, v]) => <Tab key={k} value={k} label={v} />)}
            </Tabs>
          )}
          <Box sx={{ flex: 1, overflowY: 'auto' }} role="list" aria-label="المحادثات">
            {roomsQuery.isLoading ? (
              <Box sx={{ p: 2 }}>{[1, 2, 3, 4].map((i) => <Skeleton key={i} height={64} />)}</Box>
            ) : rooms.length ? (
              rooms.map((r) => <RoomRow key={r.id} r={r} me={user.id} active={r.id === roomId} onClick={() => select(r.id)} />)
            ) : (
              <EmptyState
                icon={<ForumOutlined />}
                title="لا توجد محادثات"
                body={user.patientId ? 'من صفحة أي طبيب اضغط «مراسلة» لبدء محادثة.' : isTeam ? 'ستظهر هنا رسائل الدعم ومقدمي الخدمة.' : 'تظهر هنا رسائل المرضى والإدارة.'}
              />
            )}
          </Box>
        </Box>
      )}
      {showThread && (
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {roomId ? (
            <Thread key={roomId} roomId={roomId} onBack={() => select(null)} desktop={desktop} />
          ) : (
            <Box sx={{ flex: 1, display: 'grid', placeItems: 'center', bgcolor: tokens.paper }}>
              <EmptyState icon={<ForumOutlined />} title="اختر محادثة" body="اختر محادثة من القائمة لعرض الرسائل." />
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

function RoomRow({ r, me, active, onClick }) {
  const preview = r.lastMessage ? (r.lastMessage.senderId === me ? 'أنت: ' : '') + (r.lastMessage.body || '📎 مرفق') : 'لا توجد رسائل بعد';
  return (
    <ButtonBase
      onClick={onClick}
      role="listitem"
      aria-current={active ? 'true' : undefined}
      sx={{ width: '100%', justifyContent: 'flex-start', gap: 1.5, px: 2, py: 1.25, textAlign: 'start', bgcolor: active ? tokens.mint : 'transparent', borderBottom: `1px solid ${tokens.line}` }}
    >
      <Badge overlap="circular" variant="dot" invisible={!r.online} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} sx={{ '& .MuiBadge-badge': { bgcolor: tokens.success, boxShadow: '0 0 0 2px #fff' } }}>
        <Avatar src={fileUrl(r.avatarFileId) || undefined} sx={{ bgcolor: r.type === 'PATIENT_PROVIDER' ? tokens.mint : tokens.saffronSoft, color: tokens.petrol, fontWeight: 700 }}>
          {r.type !== 'PATIENT_PROVIDER' && r.side !== 'MOD' && (r.title.includes('ميديكس')) ? <SupportAgent fontSize="small" /> : r.title?.[0]}
        </Avatar>
      </Badge>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="baseline" spacing={1}>
          <Typography noWrap sx={{ fontWeight: r.unread ? 700 : 600 }}>{r.title}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
            {r.lastMessage ? shortTime(r.lastMessage.createdAt) : ''}
          </Typography>
        </Stack>
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
          <Typography variant="body2" noWrap color={r.unread ? 'text.primary' : 'text.secondary'}>
            {r.isBlocked ? 'محادثة محظورة' : preview}
          </Typography>
          {r.unread > 0 && (
            <Box sx={{ minWidth: 20, height: 20, px: 0.75, borderRadius: 10, bgcolor: tokens.saffron, color: tokens.ink, fontSize: 12, fontWeight: 700, display: 'grid', placeItems: 'center' }}>{r.unread}</Box>
          )}
          {r.reported && r.side === 'MOD' && <Typography variant="caption" color="error">بلاغ</Typography>}
        </Stack>
      </Box>
    </ButtonBase>
  );
}

const shortTime = (d) => {
  const t = inTz(d);
  return t.isSame(dayjs(), 'day') ? t.format('h:mm A').replace('AM', 'ص').replace('PM', 'م') : t.format('D MMM');
};

function Thread({ roomId, onBack, desktop }) {
  const { user, socket } = useAuth();
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [otherReadAt, setOtherReadAt] = useState(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [typing, setTyping] = useState(false);
  const [menu, setMenu] = useState(null);
  const [reportOpen, setReportOpen] = useState(false);
  const scroller = useRef(null);
  const stickToBottom = useRef(true);
  const typingTimer = useRef(null);

  const roomQ = useQuery({ queryKey: ['chat', 'room', roomId], queryFn: () => api.get(`/chat/rooms/${roomId}`).then((r) => r.data) });
  const room = roomQ.data;

  const markRead = useCallback(() => {
    if (document.hidden) return;
    api.post(`/chat/rooms/${roomId}/read`).then(() => qc.invalidateQueries({ queryKey: ['chat'] })).catch(() => undefined);
  }, [roomId, qc]);

  useEffect(() => {
    let alive = true;
    api
      .get(`/chat/rooms/${roomId}/messages?limit=30`)
      .then((r) => {
        if (!alive) return;
        setMessages(r.data.items);
        setHasMore(r.data.hasMore);
        setOtherReadAt(r.data.otherReadAt);
        stickToBottom.current = true;
        markRead();
      })
      .catch((e) => enqueueSnackbar(errorMessage(e), { variant: 'error' }));
    return () => {
      alive = false;
    };
  }, [roomId, markRead, enqueueSnackbar]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, typing]);

  useRealtime('chat:message', (m) => {
    if (m.roomId !== roomId) return;
    setMessages((list) => {
      if (list.some((x) => x.id === m.id)) return list;
      const i = m.clientId ? list.findIndex((x) => x.clientId === m.clientId && x.pending) : -1;
      if (i >= 0) {
        const copy = [...list];
        copy[i] = m;
        return copy;
      }
      return [...list, m];
    });
    if (m.sender.id !== user.id) {
      setTyping(false);
      const el = scroller.current;
      stickToBottom.current = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 120;
      markRead();
    }
  });
  useRealtime('chat:typing', (t) => {
    if (t.roomId !== roomId || t.userId === user.id) return;
    setTyping(true);
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTyping(false), 3500);
  });
  useRealtime('chat:read', (r) => {
    if (r.roomId === roomId && r.userId !== user.id && room && r.side !== room.side) setOtherReadAt(r.at);
  });
  useRealtime('chat:room', (r) => {
    if (r.roomId === roomId) qc.invalidateQueries({ queryKey: ['chat'] });
  });
  useEffect(() => {
    const onVis = () => !document.hidden && markRead();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [markRead]);

  const loadOlder = async () => {
    if (!messages.length) return;
    setLoadingOlder(true);
    const el = scroller.current;
    const prevHeight = el?.scrollHeight || 0;
    try {
      const r = await api.get(`/chat/rooms/${roomId}/messages?limit=30&before=${encodeURIComponent(messages[0].createdAt)}`);
      stickToBottom.current = false;
      setMessages((list) => [...r.data.items, ...list]);
      setHasMore(r.data.hasMore);
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight;
      });
    } finally {
      setLoadingOlder(false);
    }
  };

  const send = async ({ body, file }) => {
    const clientId = `c${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    const optimistic = { id: clientId, clientId, pending: true, roomId, body, createdAt: new Date().toISOString(), sender: { id: user.id, name: user.fullName }, file: file ? { id: file.id, mimeType: file.mimeType, originalName: file.originalName, size: file.size } : null };
    stickToBottom.current = true;
    setMessages((l) => [...l, optimistic]);
    const fail = (msg) => {
      setMessages((l) => l.map((x) => (x.clientId === clientId && x.pending ? { ...x, failed: true } : x)));
      enqueueSnackbar(msg || 'تعذّر إرسال الرسالة', { variant: 'error' });
    };
    const payload = { roomId, body: body || undefined, fileId: file?.id, clientId };
    if (socket?.connected) {
      socket.timeout(8000).emit('chat:send', payload, (err, ack) => {
        if (err) return fail('انقطع الاتصال، حاول مرة أخرى');
        if (!ack?.ok) return fail(ack?.error);
        setMessages((l) => (l.some((x) => x.id === ack.message.id) ? l.filter((x) => x.clientId !== clientId || !x.pending) : l.map((x) => (x.clientId === clientId ? ack.message : x))));
      });
    } else {
      try {
        const { data } = await api.post(`/chat/rooms/${roomId}/messages`, payload);
        setMessages((l) => (l.some((x) => x.id === data.id) ? l.filter((x) => x.clientId !== clientId || !x.pending) : l.map((x) => (x.clientId === clientId ? data : x))));
      } catch (e) {
        fail(errorMessage(e));
      }
    }
    qc.invalidateQueries({ queryKey: ['chat', 'rooms'] });
  };

  const action = async (path, okMsg) => {
    setMenu(null);
    try {
      await api.post(`/chat/rooms/${roomId}/${path}`);
      enqueueSnackbar(okMsg, { variant: 'success' });
      qc.invalidateQueries({ queryKey: ['chat'] });
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    }
  };

  const grouped = useMemo(() => {
    const out = [];
    let lastDay = null;
    messages.forEach((m) => {
      const day = inTz(m.createdAt).format('YYYY-MM-DD');
      if (day !== lastDay) {
        out.push({ divider: true, key: `d${day}`, label: inTz(m.createdAt).isSame(dayjs(), 'day') ? 'اليوم' : inTz(m.createdAt).format('dddd D MMMM') });
        lastDay = day;
      }
      out.push(m);
    });
    return out;
  }, [messages]);

  const lastMineRead = otherReadAt ? new Date(otherReadAt).getTime() : 0;

  return (
    <>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ px: 2, py: 1.25, borderBottom: `1px solid ${tokens.line}` }}>
        {!desktop && (
          <IconButton onClick={onBack} aria-label="رجوع للمحادثات"><ArrowForward /></IconButton>
        )}
        <Avatar src={fileUrl(room?.avatarFileId) || undefined} sx={{ bgcolor: tokens.mint, color: tokens.petrol, fontWeight: 700 }}>{room?.title?.[0]}</Avatar>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography noWrap sx={{ fontWeight: 700 }}>{room?.title || ' '}</Typography>
          <Typography variant="caption" color={typing ? 'primary' : 'text.secondary'} aria-live="polite">
            {typing ? 'يكتب الآن…' : room?.online ? 'متصل الآن' : room?.subtitle === 'مريض' ? 'مريض' : room?.subtitle || ''}
          </Typography>
        </Box>
        {room && !room.moderator && (
          <>
            <IconButton aria-label="خيارات المحادثة" onClick={(e) => setMenu(e.currentTarget)}><MoreVert /></IconButton>
            <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
              {room.canBlock && !room.isBlocked && <MenuItem onClick={() => action('block', 'تم حظر المحادثة')}>حظر المحادثة</MenuItem>}
              {room.canUnblock && <MenuItem onClick={() => action('unblock', 'تم إلغاء الحظر')}>إلغاء الحظر</MenuItem>}
              <MenuItem onClick={() => { setMenu(null); setReportOpen(true); }} sx={{ color: 'error.main' }}>إبلاغ عن المحادثة</MenuItem>
            </Menu>
          </>
        )}
        {room?.moderator && room.reported && (
          <Button size="small" onClick={() => action('dismiss-report', 'تم إغلاق البلاغ')}>إغلاق البلاغ</Button>
        )}
      </Stack>
      {room?.moderator && <Alert severity="warning" sx={{ borderRadius: 0 }}>وضع المراجعة: هذه محادثة خاصة تم الإبلاغ عنها. اطلاعك عليها مسجّل، ولا يمكنك الإرسال.</Alert>}
      {room?.isBlocked && <Alert severity="info" sx={{ borderRadius: 0 }}>هذه المحادثة محظورة ولا يمكن إرسال رسائل جديدة.</Alert>}

      <Box
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        sx={{ flex: 1, overflowY: 'auto', px: { xs: 1.5, md: 3 }, py: 2, bgcolor: tokens.paper }}
        role="log"
        aria-live="polite"
        aria-label="الرسائل"
      >
        {hasMore && (
          <Box sx={{ textAlign: 'center', mb: 1 }}>
            <Button size="small" onClick={loadOlder} disabled={loadingOlder}>{loadingOlder ? 'جاري التحميل…' : 'رسائل أقدم'}</Button>
          </Box>
        )}
        {!messages.length && roomQ.isSuccess && (
          <Typography color="text.secondary" sx={{ textAlign: 'center', mt: 6 }}>ابدأ المحادثة — الرسائل تصل فوراً.</Typography>
        )}
        {grouped.map((m) =>
          m.divider ? (
            <Typography key={m.key} variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', my: 1.5 }}>{m.label}</Typography>
          ) : (
            <Bubble key={m.id} m={m} mine={m.sender.id === user.id} read={new Date(m.createdAt).getTime() <= lastMineRead} />
          ),
        )}
        {typing && (
          <Box sx={{ display: 'inline-flex', gap: 0.5, px: 1.5, py: 1, borderRadius: '14px', bgcolor: '#fff', border: `1px solid ${tokens.line}` }} aria-hidden>
            {[0, 1, 2].map((i) => (
              <Box key={i} sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: tokens.inkSoft, animation: 'medixDot 1.2s infinite', animationDelay: `${i * 0.2}s`, '@keyframes medixDot': { '0%,80%,100%': { opacity: 0.3 }, '40%': { opacity: 1 } } }} />
            ))}
          </Box>
        )}
      </Box>

      {room?.canSend && <Composer roomId={roomId} socket={socket} onSend={send} />}
      <ReportDialog open={reportOpen} roomId={roomId} onClose={() => setReportOpen(false)} />
    </>
  );
}

function Bubble({ m, mine, read }) {
  const isImage = m.file?.mimeType?.startsWith('image/');
  return (
    <Stack alignItems={mine ? 'flex-end' : 'flex-start'} sx={{ mb: 0.75 }}>
      {!mine && m.sender?.name && m.sender.side !== 'A' && m.sender.name.startsWith('فريق') && (
        <Typography variant="caption" color="text.secondary" sx={{ px: 1 }}>{m.sender.name}</Typography>
      )}
      <Box
        sx={{
          maxWidth: { xs: '85%', md: '70%' },
          px: 1.5,
          py: 1,
          borderRadius: '14px',
          borderEndEndRadius: mine ? '4px' : '14px',
          borderEndStartRadius: mine ? '14px' : '4px',
          bgcolor: mine ? tokens.petrol : '#fff',
          color: mine ? '#fff' : tokens.ink,
          border: mine ? 'none' : `1px solid ${tokens.line}`,
          opacity: m.pending ? 0.7 : 1,
          outline: m.failed ? `2px solid ${tokens.signal}` : 'none',
        }}
      >
        {m.file && (isImage ? <ChatImage file={m.file} /> : <Box sx={{ mb: m.body ? 0.5 : 0, '& .MuiButton-root': { color: mine ? '#fff' : undefined } }}><ProtectedFile fileId={m.file.id} label={m.file.originalName || 'ملف مرفق'} /></Box>)}
        {m.body && <Typography sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.7 }}>{m.body}</Typography>}
        <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="flex-end" sx={{ mt: 0.25, opacity: 0.75 }}>
          <Typography sx={{ fontSize: 11 }}>{inTz(m.createdAt).format('h:mm A').replace('AM', 'ص').replace('PM', 'م')}</Typography>
          {mine && (m.pending ? <Schedule sx={{ fontSize: 14 }} /> : read ? <DoneAll sx={{ fontSize: 15, color: tokens.saffron }} titleAccess="مقروءة" /> : <Done sx={{ fontSize: 15 }} titleAccess="تم الإرسال" />)}
        </Stack>
      </Box>
      {m.failed && <Typography variant="caption" color="error">لم تُرسل</Typography>}
    </Stack>
  );
}

/** Private image: fetched with the bearer token and shown from a blob URL. */
function ChatImage({ file }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let url;
    let alive = true;
    api.get(`/files/${file.id}`, { responseType: 'blob' }).then((r) => {
      if (!alive) return;
      url = URL.createObjectURL(r.data);
      setSrc(url);
    }).catch(() => undefined);
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [file.id]);
  if (!src) return <Skeleton variant="rounded" width={200} height={140} sx={{ mb: 0.5 }} />;
  return (
    <Box component="a" href={src} target="_blank" rel="noopener noreferrer" sx={{ display: 'block', mb: 0.5 }}>
      <Box component="img" src={src} alt={file.originalName || 'صورة مرفقة'} sx={{ display: 'block', maxWidth: 260, maxHeight: 260, borderRadius: '10px', objectFit: 'cover' }} />
    </Box>
  );
}

function Composer({ roomId, socket, onSend }) {
  const [body, setBody] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef();
  const lastTyping = useRef(0);
  const { enqueueSnackbar } = useSnackbar();
  const submit = (e) => {
    e?.preventDefault();
    const text = body.trim();
    if (!text) return;
    setBody('');
    onSend({ body: text });
  };
  const onType = (v) => {
    setBody(v);
    if (socket?.connected && Date.now() - lastTyping.current > 2000) {
      lastTyping.current = Date.now();
      socket.emit('chat:typing', { roomId });
    }
  };
  const attach = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) return enqueueSnackbar('الحد الأقصى للمرفق 10 ميجابايت', { variant: 'error' });
    setUploading(true);
    try {
      const file = await uploadFile(f, 'CHAT_ATTACHMENT');
      const caption = body.trim();
      setBody('');
      onSend({ body: caption || undefined, file });
    } catch (err) {
      enqueueSnackbar(errorMessage(err), { variant: 'error' });
    } finally {
      setUploading(false);
    }
  };
  return (
    <Box component="form" onSubmit={submit} sx={{ display: 'flex', alignItems: 'flex-end', gap: 1, p: 1.5, borderTop: `1px solid ${tokens.line}`, bgcolor: '#fff' }}>
      <input ref={fileRef} type="file" hidden accept="image/jpeg,image/png,image/webp,application/pdf" onChange={attach} />
      <Tooltip title="إرفاق صورة أو PDF">
        <span>
          <IconButton onClick={() => fileRef.current.click()} disabled={uploading} aria-label="إرفاق ملف">
            {uploading ? <CircularProgress size={20} /> : <AttachFile />}
          </IconButton>
        </span>
      </Tooltip>
      <TextField
        multiline
        maxRows={5}
        placeholder="اكتب رسالتك…"
        value={body}
        onChange={(e) => onType(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        inputProps={{ 'aria-label': 'نص الرسالة', maxLength: 4000 }}
        sx={{ '& .MuiOutlinedInput-root': { borderRadius: '20px', bgcolor: tokens.paper } }}
      />
      <IconButton type="submit" color="primary" disabled={!body.trim()} aria-label="إرسال" sx={{ bgcolor: body.trim() ? tokens.petrol : 'transparent', color: body.trim() ? '#fff' : undefined, '&:hover': { bgcolor: tokens.petrolDark }, transform: 'scaleX(-1)' }}>
        <SendRounded />
      </IconButton>
    </Box>
  );
}

function ReportDialog({ open, roomId, onClose }) {
  const [reason, setReason] = useState('');
  const { enqueueSnackbar } = useSnackbar();
  const submit = async () => {
    try {
      await api.post(`/chat/rooms/${roomId}/report`, { reason });
      enqueueSnackbar('تم إرسال البلاغ لفريق ميديكس', { variant: 'success' });
      setReason('');
      onClose();
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    }
  };
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>إبلاغ عن المحادثة</DialogTitle>
      <DialogContent>
        <Typography color="text.secondary" sx={{ mb: 1.5 }}>سيتمكن فريق ميديكس من مراجعة هذه المحادثة للتحقق من البلاغ.</Typography>
        <TextField label="سبب البلاغ" multiline minRows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>إلغاء</Button>
        <Button variant="contained" color="error" disabled={reason.trim().length < 3} onClick={submit}>إرسال البلاغ</Button>
      </DialogActions>
    </Dialog>
  );
}

