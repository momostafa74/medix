import { Box, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, Skeleton } from '@mui/material';
import { EmptyState } from './common';

/**
 * Server-paginated table. columns: [{ key, label, render?(row), align?, width?, nowrap? }]
 */
export default function DataTable({ columns, rows = [], loading, total = 0, page = 1, pageSize = 20, onPageChange, onPageSizeChange, empty, onRowClick, dense }) {
  return (
    <Box>
      <TableContainer sx={{ overflowX: 'auto' }}>
        <Table size={dense ? 'small' : 'medium'}>
          <TableHead>
            <TableRow>
              {columns.map((c) => (
                <TableCell key={c.key} align={c.align} sx={{ width: c.width }}>
                  {c.label}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {loading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    {columns.map((c) => (
                      <TableCell key={c.key}>
                        <Skeleton />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : rows.map((r, i) => (
                  <TableRow
                    key={r.id ?? i}
                    hover={!!onRowClick}
                    onClick={onRowClick ? () => onRowClick(r) : undefined}
                    sx={{ cursor: onRowClick ? 'pointer' : 'default' }}
                  >
                    {columns.map((c) => (
                      <TableCell key={c.key} align={c.align} sx={c.nowrap ? { whiteSpace: 'nowrap' } : undefined}>
                        {c.render ? c.render(r) : r[c.key] ?? '—'}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </TableContainer>
      {!loading && rows.length === 0 && (empty || <EmptyState title="لا توجد بيانات" />)}
      {onPageChange && total > 0 && (
        <TablePagination
          component="div"
          count={total}
          page={page - 1}
          rowsPerPage={pageSize}
          onPageChange={(_, p) => onPageChange(p + 1)}
          onRowsPerPageChange={onPageSizeChange ? (e) => onPageSizeChange(parseInt(e.target.value, 10)) : undefined}
          rowsPerPageOptions={onPageSizeChange ? [10, 20, 50, 100] : [pageSize]}
          labelRowsPerPage="عدد الصفوف"
          labelDisplayedRows={({ from, to, count }) => `${from}–${to} من ${count}`}
        />
      )}
    </Box>
  );
}
