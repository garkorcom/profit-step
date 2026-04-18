/**
 * Ledger tab — read-only stock movement history with filters + CSV export.
 * Backend requires at least one of: itemId / locationId / projectId / documentId.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
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
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import SearchIcon from '@mui/icons-material/Search';
import toast from 'react-hot-toast';
import { useAuth } from '../../auth/AuthContext';
import { projectsApi } from '../../api/projectsApi';
import {
  listItems,
  listLedger,
  listLocations,
  type WhItemClient,
  type WhLedgerEntryClient,
  type WhLocationClient,
} from '../../api/warehouseApi';

function toCsv(rows: Array<Record<string, string | number>>): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(','));
  }
  return lines.join('\n');
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function formatDate(value: WhLedgerEntryClient['eventDate']): string {
  if (typeof value === 'string') return new Date(value).toLocaleString('ru-RU');
  if (value && 'seconds' in value) return new Date(value.seconds * 1000).toLocaleString('ru-RU');
  return '—';
}

export default function LedgerTab({ search: _search }: { search: string }) {
  const { userProfile } = useAuth();
  const [items, setItems] = useState<WhItemClient[]>([]);
  const [locations, setLocations] = useState<WhLocationClient[]>([]);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);

  const [itemId, setItemId] = useState<string>('');
  const [locationId, setLocationId] = useState<string>('');
  const [projectId, setProjectId] = useState<string>('');
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');

  const [entries, setEntries] = useState<WhLedgerEntryClient[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    (async () => {
      const [itemList, locList] = await Promise.all([listItems({ max: 1000 }), listLocations({ includeInactive: false })]);
      setItems(itemList);
      setLocations(locList);
    })();
  }, []);

  useEffect(() => {
    const companyId = userProfile?.companyId;
    if (!companyId) return;
    projectsApi
      .getAll(companyId)
      .then((res) => setProjects(res.map((p: { id: string; name?: string }) => ({ id: p.id, name: p.name ?? p.id }))))
      .catch(() => {});
  }, [userProfile?.companyId]);

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const locationById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);

  const itemOptions = useMemo(() => items.map((i) => ({ id: i.id, label: `${i.name} · ${i.sku}` })), [items]);
  const locationOptions = useMemo(() => locations.map((l) => ({ id: l.id, label: `${l.name} · ${l.locationType}` })), [locations]);

  const hasFilter = !!(itemId || locationId || projectId);

  async function handleSearch() {
    if (!hasFilter) {
      toast.error('Выберите хотя бы один фильтр: Товар / Локация / Проект');
      return;
    }
    setLoading(true);
    setSearched(true);
    try {
      const res = await listLedger({
        itemId: itemId || undefined,
        locationId: locationId || undefined,
        projectId: projectId || undefined,
        from: from ? new Date(from).toISOString() : undefined,
        to: to ? new Date(to + 'T23:59:59').toISOString() : undefined,
      });
      setEntries(res.entries);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Не удалось загрузить ledger');
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (entries.length === 0) return;
    const rows = entries.map((e) => ({
      eventDate: formatDate(e.eventDate),
      docId: e.documentId,
      item: itemById.get(e.itemId)?.name ?? e.itemId,
      sku: itemById.get(e.itemId)?.sku ?? '',
      location: locationById.get(e.locationId)?.name ?? e.locationId,
      direction: e.direction,
      deltaQty: e.deltaQty,
      unitCost: e.unitCostAtPosting,
      totalCost: Math.round((e.deltaQty * e.unitCostAtPosting) * 100) / 100,
      projectId: e.projectId ?? '',
      phaseCode: e.phaseCode ?? '',
      costCategory: e.costCategory ?? '',
    }));
    downloadCsv(`ledger-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows));
    toast.success('CSV скачан');
  }

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={2}>
          <Typography variant="subtitle2">Фильтры (нужен хотя бы один)</Typography>
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
            <Autocomplete
              size="small"
              options={itemOptions}
              getOptionLabel={(o) => o.label}
              value={itemOptions.find((o) => o.id === itemId) ?? null}
              onChange={(_, v) => setItemId(v?.id ?? '')}
              renderInput={(p) => <TextField {...p} label="Товар" />}
              sx={{ minWidth: 280 }}
            />
            <Autocomplete
              size="small"
              options={locationOptions}
              getOptionLabel={(o) => o.label}
              value={locationOptions.find((o) => o.id === locationId) ?? null}
              onChange={(_, v) => setLocationId(v?.id ?? '')}
              renderInput={(p) => <TextField {...p} label="Локация" />}
              sx={{ minWidth: 260 }}
            />
            <Autocomplete
              size="small"
              options={projects}
              getOptionLabel={(o) => o.name}
              value={projects.find((p) => p.id === projectId) ?? null}
              onChange={(_, v) => setProjectId(v?.id ?? '')}
              renderInput={(p) => <TextField {...p} label="Проект" />}
              sx={{ minWidth: 260 }}
            />
            <TextField
              size="small"
              label="От"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              size="small"
              label="До"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <Button variant="contained" startIcon={<SearchIcon />} onClick={handleSearch} disabled={loading || !hasFilter}>
              Показать
            </Button>
            <Button
              variant="outlined"
              startIcon={<DownloadIcon />}
              onClick={handleExport}
              disabled={entries.length === 0}
            >
              CSV
            </Button>
          </Stack>
        </Stack>
      </Paper>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : !searched ? (
        <Alert severity="info">Выберите фильтр и нажмите «Показать» для загрузки истории движений.</Alert>
      ) : entries.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>
          Нет записей по выбранным фильтрам.
        </Paper>
      ) : (
        <>
          <Typography variant="body2" color="text.secondary">
            Найдено: <strong>{entries.length}</strong> (макс 500)
          </Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Дата</TableCell>
                  <TableCell>Товар</TableCell>
                  <TableCell>Локация</TableCell>
                  <TableCell>Документ</TableCell>
                  <TableCell align="right">Δ Qty</TableCell>
                  <TableCell align="right">Цена</TableCell>
                  <TableCell align="right">Сумма</TableCell>
                  <TableCell>Проект / фаза</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {entries.map((e) => {
                  const item = itemById.get(e.itemId);
                  const isOut = e.direction === 'out';
                  return (
                    <TableRow key={e.id} hover>
                      <TableCell>{formatDate(e.eventDate)}</TableCell>
                      <TableCell>{item?.name ?? e.itemId}</TableCell>
                      <TableCell>{locationById.get(e.locationId)?.name ?? e.locationId}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{e.documentId}</TableCell>
                      <TableCell align="right">
                        <Typography component="span" color={isOut ? 'error.main' : 'success.main'} fontWeight={500}>
                          {e.deltaQty > 0 ? '+' : ''}
                          {e.deltaQty}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">${e.unitCostAtPosting?.toFixed(2) ?? '—'}</TableCell>
                      <TableCell align="right">
                        ${((e.deltaQty ?? 0) * (e.unitCostAtPosting ?? 0)).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        {e.projectId ? (
                          <Typography variant="caption">
                            {e.projectId}
                            {e.phaseCode ? ` · ${e.phaseCode}` : ''}
                          </Typography>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
    </Stack>
  );
}
