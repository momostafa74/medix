import { useState } from 'react';
import { Box, Button, Card, FormControlLabel, Pagination, Stack, Switch, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { EmptyState, ListSkeleton, PageHeader } from '../../components/common';
import { fmtDateTime } from '../../utils/format';
import { tokens } from '../../theme';

export default function NotificationsPage() {
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['notifications', 'page', page, unreadOnly],
    queryFn: () => api.get(`/notifications?page=${page}&pageSize=20${unreadOnly ? '&unreadOnly=true' : ''}`).then((r) => r.data),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const readAll = useMutation({ mutationFn: () => api.patch('/notifications/read-all'), onSuccess: invalidate });
  const readOne = useMutation({ mutationFn: (id) => api.patch(`/notifications/${id}/read`), onSuccess: invalidate });
  return (
    <>
      <PageHeader
        title="الإشعارات"
        actions={[
          <FormControlLabel key="u" control={<Switch checked={unreadOnly} onChange={(e) => { setUnreadOnly(e.target.checked); setPage(1); }} />} label="غير المقروءة فقط" />,
          <Button key="r" variant="outlined" onClick={() => readAll.mutate()}>تعليم الكل كمقروء</Button>,
        ]}
      />
      <Card>
        {isLoading ? (
          <Box sx={{ p: 2 }}><ListSkeleton /></Box>
        ) : data?.items.length ? (
          data.items.map((n) => (
            <Stack
              key={n.id}
              direction="row"
              spacing={2}
              sx={{ p: 2, borderBottom: `1px solid ${tokens.line}`, bgcolor: n.readAt ? '#fff' : tokens.mint, '&:last-child': { borderBottom: 0 } }}
            >
              <Box sx={{ flex: 1 }}>
                <Typography sx={{ fontWeight: 600 }}>{n.title}</Typography>
                <Typography color="text.secondary">{n.body}</Typography>
                <Typography variant="caption" color="text.secondary">{fmtDateTime(n.createdAt)}</Typography>
              </Box>
              {!n.readAt && (
                <Button size="small" onClick={() => readOne.mutate(n.id)} sx={{ alignSelf: 'center' }}>
                  تعليم كمقروء
                </Button>
              )}
            </Stack>
          ))
        ) : (
          <EmptyState title="لا توجد إشعارات" body="هنا ستظهر تأكيدات الحجز والتذكيرات وأي تحديثات تخص حسابك." />
        )}
      </Card>
      {data?.totalPages > 1 && (
        <Stack alignItems="center" sx={{ mt: 2 }}>
          <Pagination count={data.totalPages} page={page} onChange={(_, p) => setPage(p)} />
        </Stack>
      )}
    </>
  );
}
