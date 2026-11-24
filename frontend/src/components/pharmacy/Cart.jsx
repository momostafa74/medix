import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Badge, Box, Button, Paper, Stack, Typography } from '@mui/material';
import ShoppingCartOutlined from '@mui/icons-material/ShoppingCartOutlined';
import { useConfirm } from '../common';
import { fmtMoney } from '../../utils/format';
import { tokens } from '../../theme';

/**
 * One cart, one pharmacy (prices and stock are per pharmacy). Kept in sessionStorage
 * only — it disappears with the tab and never leaves the browser; the server re-prices
 * every line when the order is placed.
 */
const KEY = 'medix.cart';
const CartCtx = createContext(null);
const EMPTY = { pharmacy: null, lines: [], prescriptionId: null };

const load = () => {
  try {
    return JSON.parse(sessionStorage.getItem(KEY)) || EMPTY;
  } catch {
    return EMPTY;
  }
};

export function CartProvider({ children }) {
  const [cart, setCart] = useState(load);
  const confirm = useConfirm();
  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(cart));
    } catch {
      /* storage unavailable — cart stays in memory */
    }
  }, [cart]);

  /** pharmacy: { key, nameAr, slug }; switching pharmacy asks before clearing. */
  const ensurePharmacy = useCallback(
    async (pharmacy) => {
      if (cart.pharmacy && cart.pharmacy.key !== pharmacy.key && (cart.lines.length || cart.prescriptionId)) {
        const ok = await confirm({ title: 'سلة من صيدلية أخرى', body: `سلتك الحالية من ${cart.pharmacy.nameAr}. هل تريد تفريغها والطلب من ${pharmacy.nameAr}؟`, confirmText: 'تفريغ السلة' });
        if (!ok) return false;
        setCart({ ...EMPTY, pharmacy });
        return true;
      }
      if (!cart.pharmacy || cart.pharmacy.key !== pharmacy.key) setCart((c) => ({ ...c, pharmacy }));
      return true;
    },
    [cart, confirm],
  );

  const add = useCallback(
    async (pharmacy, item, qty = 1) => {
      if (!(await ensurePharmacy(pharmacy))) return false;
      setCart((c) => {
        const ex = c.lines.find((l) => l.medicineId === item.medicineId);
        const lines = ex ? c.lines.map((l) => (l.medicineId === item.medicineId ? { ...l, quantity: Math.min(50, l.quantity + qty) } : l)) : [...c.lines, { ...item, quantity: qty }];
        return { ...c, pharmacy, lines };
      });
      return true;
    },
    [ensurePharmacy],
  );

  const value = useMemo(
    () => ({
      cart,
      count: cart.lines.reduce((s, l) => s + l.quantity, 0),
      subtotal: Math.round(cart.lines.reduce((s, l) => s + l.quantity * l.price, 0) * 100) / 100,
      add,
      ensurePharmacy,
      setQty: (medicineId, q) => setCart((c) => ({ ...c, lines: q <= 0 ? c.lines.filter((l) => l.medicineId !== medicineId) : c.lines.map((l) => (l.medicineId === medicineId ? { ...l, quantity: Math.min(50, q) } : l)) })),
      setPrescription: (prescriptionId) => setCart((c) => ({ ...c, prescriptionId })),
      /** Replace the cart (e.g. filling a whole prescription at one pharmacy). */
      replace: (pharmacy, lines, prescriptionId = null) => setCart({ pharmacy, lines, prescriptionId }),
      clear: () => setCart(EMPTY),
      qtyOf: (medicineId) => cart.lines.find((l) => l.medicineId === medicineId)?.quantity || 0,
    }),
    [cart, add, ensurePharmacy],
  );
  return <CartCtx.Provider value={value}>{children}</CartCtx.Provider>;
}

export const useCart = () => useContext(CartCtx);

/** Sticky bottom bar on pharmacy pages while the cart has items from that pharmacy. */
export function CartBar({ pharmacyKey }) {
  const { cart, count, subtotal } = useCart();
  if (!count || (pharmacyKey && cart.pharmacy?.key !== pharmacyKey)) return null;
  return (
    <Paper elevation={6} sx={{ position: 'sticky', bottom: 16, mt: 2, p: 1.5, borderRadius: '14px', bgcolor: tokens.petrol, color: '#fff', zIndex: 5 }}>
      <Stack direction="row" alignItems="center" spacing={2}>
        <Badge badgeContent={count} color="secondary"><ShoppingCartOutlined /></Badge>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 700 }} noWrap>{cart.pharmacy?.nameAr}</Typography>
          <Typography variant="body2" sx={{ opacity: 0.85 }}>{fmtMoney(subtotal)} قبل التوصيل</Typography>
        </Box>
        <Button variant="contained" color="secondary" component={RouterLink} to="/checkout">إتمام الطلب</Button>
      </Stack>
    </Paper>
  );
}
