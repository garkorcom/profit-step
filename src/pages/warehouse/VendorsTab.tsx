/**
 * Vendors tab — CRUD for suppliers.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Link,
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
  archiveVendor,
  listCategories,
  listVendors,
  type VendorType,
  type WhCategoryClient,
  type WhVendorClient,
} from '../../api/warehouseApi';
import VendorFormDialog from './VendorFormDialog';
import { useWarehousePermissions } from './hooks/useWarehousePermissions';

const VENDOR_TYPE_LABELS: Record<VendorType, { label: string; color: 'primary' | 'secondary' | 'default' | 'warning' }> = {
  big_box: { label: 'big box', color: 'primary' },
  local_supply: { label: 'local', color: 'secondary' },
  subcontractor_proxy: { label: 'subcontractor', color: 'warning' },
  online: { label: 'online', color: 'default' },
};

interface Props {
  search: string;
}

export default function VendorsTab({ search }: Props) {
  const perms = useWarehousePermissions();
  const [loading, setLoading] = useState(true);
  const [vendors, setVendors] = useState<WhVendorClient[]>([]);
  const [categories, setCategories] = useState<WhCategoryClient[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create');
  const [editVendor, setEditVendor] = useState<WhVendorClient | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [vendorList, cats] = await Promise.all([listVendors(), listCategories()]);
        if (cancelled) return;
        setVendors(vendorList);
        setCategories(cats);
      } catch (e: unknown) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : 'Не удалось загрузить поставщиков');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return vendors;
    return vendors.filter(
      (v) =>
        v.name.toLowerCase().includes(needle) ||
        (v.contactName ?? '').toLowerCase().includes(needle) ||
        (v.contactEmail ?? '').toLowerCase().includes(needle),
    );
  }, [vendors, search]);

  function openCreate() {
    setEditVendor(null);
    setDialogMode('create');
    setDialogOpen(true);
  }

  function openEdit(v: WhVendorClient) {
    setEditVendor(v);
    setDialogMode('edit');
    setDialogOpen(true);
  }

  async function handleArchive(v: WhVendorClient) {
    if (!window.confirm(`Архивировать «${v.name}»?`)) return;
    try {
      await archiveVendor(v.id);
      toast.success('Поставщик архивирован');
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
          {filtered.length} из {vendors.length}
        </Typography>
        {hasWriteActions && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
            Новый поставщик
          </Button>
        )}
      </Stack>

      {vendors.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>
          Поставщиков нет. {hasWriteActions ? 'Нажмите «Новый поставщик» чтобы начать.' : ''}
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Название</TableCell>
                <TableCell>Тип</TableCell>
                <TableCell>Контакт</TableCell>
                <TableCell>Категории</TableCell>
                <TableCell>Условия</TableCell>
                {hasWriteActions && <TableCell align="right">Действия</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((v) => {
                const tag = VENDOR_TYPE_LABELS[v.vendorType];
                return (
                  <TableRow key={v.id} hover>
                    <TableCell>
                      <div>{v.name}</div>
                      {v.contactName && (
                        <Typography variant="caption" color="text.secondary">
                          {v.contactName}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={tag.label} color={tag.color} variant="outlined" />
                    </TableCell>
                    <TableCell>
                      {v.contactEmail && (
                        <div>
                          <Link href={`mailto:${v.contactEmail}`}>{v.contactEmail}</Link>
                        </div>
                      )}
                      {v.contactPhone && (
                        <Typography variant="caption" color="text.secondary">
                          {v.contactPhone}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                        {(v.preferredForCategories ?? []).slice(0, 3).map((catId) => (
                          <Chip
                            key={catId}
                            size="small"
                            variant="outlined"
                            label={categoryById.get(catId)?.name ?? catId}
                          />
                        ))}
                        {(v.preferredForCategories ?? []).length > 3 && (
                          <Chip
                            size="small"
                            variant="outlined"
                            label={`+${(v.preferredForCategories ?? []).length - 3}`}
                          />
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell>{v.defaultPaymentTerms ?? '—'}</TableCell>
                    {hasWriteActions && (
                      <TableCell align="right">
                        <Tooltip title="Редактировать">
                          <IconButton size="small" onClick={() => openEdit(v)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Архивировать">
                          <IconButton size="small" onClick={() => handleArchive(v)}>
                            <ArchiveIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <VendorFormDialog
        open={dialogOpen}
        mode={dialogMode}
        vendor={editVendor}
        categories={categories}
        onClose={() => setDialogOpen(false)}
        onSaved={() => setRefreshTick((t) => t + 1)}
      />
    </Stack>
  );
}
