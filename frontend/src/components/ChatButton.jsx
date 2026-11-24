import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, CircularProgress, IconButton, Tooltip } from '@mui/material';
import ChatBubbleOutline from '@mui/icons-material/ChatBubbleOutline';
import { useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { errorMessage } from '../api/client';
import { chatPathFor, openRoom } from '../api/chat';
import { useAuth } from '../auth/AuthProvider';

/** Opens (or reuses) a conversation and jumps to it. Anonymous visitors are sent to login first. */
export default function ChatButton({ payload, label = 'مراسلة', icon = false, ...props }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!user) return nav(`/login?next=${encodeURIComponent(loc.pathname)}`);
    setBusy(true);
    try {
      const room = await openRoom(payload);
      qc.invalidateQueries({ queryKey: ['chat'] });
      nav(chatPathFor(user, room.id));
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    } finally {
      setBusy(false);
    }
  };
  if (icon) {
    return (
      <Tooltip title={label}>
        <span>
          <IconButton onClick={go} disabled={busy} aria-label={label} {...props}>
            {busy ? <CircularProgress size={18} /> : <ChatBubbleOutline />}
          </IconButton>
        </span>
      </Tooltip>
    );
  }
  return (
    <Button variant="outlined" startIcon={busy ? <CircularProgress size={16} /> : <ChatBubbleOutline />} onClick={go} disabled={busy} {...props}>
      {label}
    </Button>
  );
}
