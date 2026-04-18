/**
 * Norms tab — CRUD for bills-of-materials indexed by task type.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/EditOutlined';
import ArchiveIcon from '@mui/icons-material/ArchiveOutlined';
import toast from 'react-hot-toast';
import {
  archiveNorm,
  listItems,
  listNorms,
  type WhItemClient,
  type WhNormClient,
} from '../../api/warehouseApi';
import NormFormDialog from './NormFormDialog';
import { useWarehousePermissions } from './hooks/useWarehousePermissions';

interface Props {
  search: string;
}

export default function NormsTab({ search }: Props) {
  const perms = useWarehousePermissions();
  const [loading, setLoading] = useState(true);
  const [norms, setNorms] = useState<WhNormClient[]>([]);
  const [items, setItems] = useState<WhItemClient[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create');
  const [editNorm, setEditNorm] = useState<WhNormClient | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [normList, itemList] = await Promise.all([listNorms(), listItems({ max: 1000 })]);
        if (cancelled) return;
        setNorms(normList);
        setItems(itemList);
      } catch (e: unknown) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : 'Не удалось загрузить нормы');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return norms;
    return norms.filter(
      (n) =>
        n.taskType.toLowerCase().includes(needle) ||
        n.name.toLowerCase().includes(needle) ||
        (n.description ?? '').toLowerCase().includes(needle),
    );
  }, [norms, search]);

  function openCreate() {
    setEditNorm(null);
    setDialogMode('create');
    setDialogOpen(true);
  }

  function openEdit(norm: WhNormClient) {
    setEditNorm(norm);
    setDialogMode('edit');
    setDialogOpen(true);
  }

  async function handleArchive(norm: WhNormClient) {
    if (!window.confirm(`Архивировать норму "${norm.name}"?`)) return;
    try {
      await archiveNorm(norm.id);
      toast.success('Норма архивирована');
      setRefreshTick((t) => t + 1);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Ошибка архивации');
    }
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  const hasWriteActions = perms.canWriteCatalog;

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between">
        <Typography variant="body2" color="text.secondary">
          {filtered.length} из {norms.length} норм (BoM на task type)
        </Typography>
        {hasWriteActions && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
            Новая норма
          </Button>
        )}
      </Stack>

      {norms.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>
          Норм нет. {hasWriteActions ? 'Нажмите «Новая норма» чтобы задать BoM для типа задачи.' : ''}
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Task type</TableCell>
                <TableCell>Название</TableCell>
                <TableCell>Материалы</TableCell>
                <TableCell align="right">Labor h/ед.</TableCell>
                {hasWriteActions && <TableCell align="right">Действия</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((norm) => (
                <TableRow key={norm.id} hover>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{norm.taskType}</TableCell>
                  <TableCell>
                    <div>{norm.name}</div>
                    {norm.description && (
                      <Typography variant="caption" color="text.secondary">
                        {norm.description}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                      {norm.items.slice(0, 4).map((it, idx) => {
                        const item = itemById.get(it.itemId);
                        return (
                          <Chip
                            key={idx}
                            size="small"
                            variant="outlined"
                            label={`${item?.name ?? it.itemId} × ${it.qtyPerUnit}`}
                          />
                        );
                      })}
                      {norm.items.length > 4 && (
                        <Chip size="small" variant="outlined" label={`+${norm.items.length - 4}`} />
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell align="right">{norm.estimatedLaborHours ?? '—'}</TableCell>
                  {hasWriteActions && (
                    <TableCell align="right">
                      <Tooltip title="Редактировать">
                        <IconButton size="small" onClick={() => openEdit(norm)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Архивировать">
                        <IconButton size="small" onClick={() => handleArchive(norm)}>
                          <ArchiveIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <NormFormDialog
        open={dialogOpen}
        mode={dialogMode}
        norm={editNorm}
        items={items}
        onClose={() => setDialogOpen(false)}
        onSaved={() => setRefreshTick((t) => t + 1)}
      />
    </Stack>
  );
}
