/**
 * Items tab — catalog browser with total-available-across-locations.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Chip,
  CircularProgress,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import {
  listBalancesByItem,
  listCategories,
  listItems,
  listLocations,
  type WhBalanceClient,
  type WhCategoryClient,
  type WhItemClient,
  type WhLocationClient,
} from '../../api/warehouseApi';

interface Props {
  search: string;
}

interface ItemRow {
  item: WhItemClient;
  totals: {
    onHand: number;
    reserved: number;
    available: number;
  };
}

export default function ItemsTab({ search }: Props) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<WhItemClient[]>([]);
  const [categories, setCategories] = useState<WhCategoryClient[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [balancesByItem, setBalancesByItem] = useState<Map<string, WhBalanceClient[]>>(new Map());
  const [locationsById, setLocationsById] = useState<Map<string, WhLocationClient>>(new Map());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [fetchedItems, cats, locs] = await Promise.all([
        listItems({ max: 1000 }),
        listCategories(),
        listLocations({ includeInactive: false }),
      ]);
      if (cancelled) return;
      setItems(fetchedItems);
      setCategories(cats);
      setLocationsById(new Map(locs.map((l) => [l.id, l])));

      // Fetch balances for ALL items in parallel (OK for MVP — 50 items seed)
      const balanceResults = await Promise.all(
        fetchedItems.map((i) => listBalancesByItem(i.id).then((b) => [i.id, b] as const)),
      );
      if (cancelled) return;
      setBalancesByItem(new Map(balanceResults));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rows: ItemRow[] = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items
      .filter((i) => !categoryFilter || i.category === categoryFilter)
      .filter(
        (i) =>
          !needle ||
          i.name.toLowerCase().includes(needle) ||
          i.sku.toLowerCase().includes(needle),
      )
      .map((item) => {
        const balances = balancesByItem.get(item.id) ?? [];
        const onHand = balances.reduce((a, b) => a + (b.onHandQty ?? 0), 0);
        const reserved = balances.reduce((a, b) => a + (b.reservedQty ?? 0), 0);
        return {
          item,
          totals: { onHand, reserved, available: onHand - reserved },
        };
      });
  }, [items, search, categoryFilter, balancesByItem]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (rows.length === 0 && items.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>
        Каталог пуст. Запустите <code>scripts/warehouse-reset.ts</code> чтобы засеять 50 товаров.
      </Paper>
    );
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} alignItems="center">
        <TextField
          select
          size="small"
          label="Категория"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          sx={{ minWidth: 240 }}
        >
          <MenuItem value="">Все</MenuItem>
          {categories.map((c) => (
            <MenuItem key={c.id} value={c.id}>
              {c.name}
            </MenuItem>
          ))}
        </TextField>
        <Typography variant="body2" color="text.secondary">
          {rows.length} из {items.length} товаров
        </Typography>
      </Stack>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Товар</TableCell>
              <TableCell>SKU</TableCell>
              <TableCell>Категория</TableCell>
              <TableCell align="right">На складе</TableCell>
              <TableCell align="right">Резерв</TableCell>
              <TableCell align="right">Доступно</TableCell>
              <TableCell>Ед.</TableCell>
              <TableCell align="right">Ср. цена</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map(({ item, totals }) => {
              const below = item.minStock !== undefined && totals.available < item.minStock;
              return (
                <TableRow key={item.id} hover>
                  <TableCell>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <span>{item.name}</span>
                      {below && <Chip label="low stock" color="warning" size="small" />}
                    </Stack>
                  </TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{item.sku}</TableCell>
                  <TableCell>{item.category}</TableCell>
                  <TableCell align="right">{totals.onHand}</TableCell>
                  <TableCell align="right">{totals.reserved}</TableCell>
                  <TableCell align="right">
                    <Typography
                      component="span"
                      color={totals.available < 0 ? 'error.main' : undefined}
                      fontWeight={below ? 600 : undefined}
                    >
                      {totals.available}
                    </Typography>
                  </TableCell>
                  <TableCell>{item.baseUOM}</TableCell>
                  <TableCell align="right">${item.averageCost?.toFixed(2) ?? '—'}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Stack>
  );
}
