/**
 * Locations tab — shows all locations grouped by type, clickable rows
 * expand to balances at that location.
 */

import React, { useEffect, useState } from 'react';
import {
  Box,
  Chip,
  CircularProgress,
  Collapse,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import KeyboardArrowDown from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUp from '@mui/icons-material/KeyboardArrowUp';
import {
  listBalancesByLocation,
  listItems,
  listLocations,
  type LocationType,
  type WhBalanceClient,
  type WhItemClient,
  type WhLocationClient,
} from '../../api/warehouseApi';

const TYPE_LABELS: Record<LocationType, { label: string; color: 'primary' | 'secondary' | 'default' | 'warning' }> = {
  warehouse: { label: 'Склад', color: 'primary' },
  van: { label: 'Van', color: 'secondary' },
  site: { label: 'Site', color: 'default' },
  quarantine: { label: 'Quarantine', color: 'warning' },
};

interface Props {
  search: string;
}

export default function LocationsTab({ search }: Props) {
  const [loading, setLoading] = useState(true);
  const [locations, setLocations] = useState<WhLocationClient[]>([]);
  const [itemsById, setItemsById] = useState<Map<string, WhItemClient>>(new Map());
  const [balancesByLocation, setBalancesByLocation] = useState<Map<string, WhBalanceClient[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [locs, items] = await Promise.all([listLocations(), listItems({ max: 1000 })]);
      if (cancelled) return;
      setLocations(locs);
      setItemsById(new Map(items.map((i) => [i.id, i])));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggleExpand(locId: string) {
    const next = new Set(expanded);
    if (next.has(locId)) {
      next.delete(locId);
      setExpanded(next);
      return;
    }
    next.add(locId);
    setExpanded(next);
    if (!balancesByLocation.has(locId)) {
      const rows = await listBalancesByLocation(locId);
      setBalancesByLocation((prev) => {
        const m = new Map(prev);
        m.set(locId, rows);
        return m;
      });
    }
  }

  const needle = search.trim().toLowerCase();
  const filtered = needle
    ? locations.filter(
        (l) =>
          l.name.toLowerCase().includes(needle) ||
          l.locationType.includes(needle) ||
          (l.ownerEmployeeId ?? '').toLowerCase().includes(needle),
      )
    : locations;

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (filtered.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>
        Локаций не найдено. Запустите <code>scripts/warehouse-reset.ts</code> чтобы заполнить базу.
      </Paper>
    );
  }

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell width={40} />
            <TableCell>Название</TableCell>
            <TableCell>Тип</TableCell>
            <TableCell>Владелец / адрес</TableCell>
            <TableCell align="right">Позиций</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {filtered.map((loc) => {
            const open = expanded.has(loc.id);
            const balances = balancesByLocation.get(loc.id) ?? [];
            const nonZeroCount = balances.filter((b) => (b.onHandQty ?? 0) > 0).length;
            const tag = TYPE_LABELS[loc.locationType] ?? TYPE_LABELS.warehouse;
            return (
              <React.Fragment key={loc.id}>
                <TableRow hover>
                  <TableCell>
                    <IconButton size="small" onClick={() => toggleExpand(loc.id)}>
                      {open ? <KeyboardArrowUp /> : <KeyboardArrowDown />}
                    </IconButton>
                  </TableCell>
                  <TableCell>{loc.name}</TableCell>
                  <TableCell>
                    <Chip size="small" label={tag.label} color={tag.color} />
                  </TableCell>
                  <TableCell>
                    {loc.locationType === 'van'
                      ? loc.ownerEmployeeId ?? '—'
                      : loc.address ?? '—'}
                  </TableCell>
                  <TableCell align="right">{open ? nonZeroCount : '…'}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell colSpan={5} sx={{ py: 0, borderBottom: open ? undefined : 'none' }}>
                    <Collapse in={open} unmountOnExit>
                      <Box sx={{ py: 2 }}>
                        {balances.length === 0 ? (
                          <Typography variant="body2" color="text.secondary">
                            Здесь пока нет движений.
                          </Typography>
                        ) : (
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell>Товар</TableCell>
                                <TableCell align="right">На складе</TableCell>
                                <TableCell align="right">Резерв</TableCell>
                                <TableCell align="right">Доступно</TableCell>
                                <TableCell>Ед.</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {balances
                                .filter((b) => (b.onHandQty ?? 0) > 0 || (b.reservedQty ?? 0) > 0)
                                .sort((a, b) => (b.onHandQty ?? 0) - (a.onHandQty ?? 0))
                                .map((b) => {
                                  const item = itemsById.get(b.itemId);
                                  return (
                                    <TableRow key={b.id}>
                                      <TableCell>{item?.name ?? b.itemId}</TableCell>
                                      <TableCell align="right">{b.onHandQty ?? 0}</TableCell>
                                      <TableCell align="right">{b.reservedQty ?? 0}</TableCell>
                                      <TableCell align="right">
                                        <Typography
                                          component="span"
                                          color={b.availableQty < 0 ? 'error.main' : undefined}
                                          fontWeight={b.availableQty < 0 ? 600 : undefined}
                                        >
                                          {b.availableQty ?? 0}
                                        </Typography>
                                      </TableCell>
                                      <TableCell>{item?.baseUOM ?? '—'}</TableCell>
                                    </TableRow>
                                  );
                                })}
                            </TableBody>
                          </Table>
                        )}
                      </Box>
                    </Collapse>
                  </TableCell>
                </TableRow>
              </React.Fragment>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
