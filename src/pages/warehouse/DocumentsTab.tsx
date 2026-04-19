/**
 * Documents tab — list with filters + detail drawer + post/void.
 * Spec: Improvement 11 §7, §8.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  IconButton,
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
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import CheckIcon from '@mui/icons-material/CheckCircleOutline';
import BlockIcon from '@mui/icons-material/BlockOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import toast from 'react-hot-toast';
import { useAuth } from '../../auth/AuthContext';
import { projectsApi } from '../../api/projectsApi';
import {
  getDocument,
  listDocuments,
  listItems,
  listLocations,
  postDocument,
  voidDocument,
  type DocStatus,
  type DocType,
  type WhDocumentClient,
  type WhDocumentLineClient,
  type WhItemClient,
  type WhLocationClient,
} from '../../api/warehouseApi';
import DocumentFormDialog from './DocumentFormDialog';
import CycleCountDialog from './CycleCountDialog';
import { useWarehousePermissions } from './hooks/useWarehousePermissions';

const DOC_TYPE_LABELS: Record<DocType, { emoji: string; label: string }> = {
  receipt: { emoji: '📥', label: 'Приход' },
  issue: { emoji: '📤', label: 'Списание' },
  transfer: { emoji: '🚚', label: 'Перемещение' },
  count: { emoji: '⚖️', label: 'Инвентаризация' },
  adjustment: { emoji: '🔧', label: 'Корректировка' },
  reversal: { emoji: '↩️', label: 'Reversal' },
};

const STATUS_COLORS: Record<DocStatus, 'default' | 'primary' | 'success' | 'warning' | 'error'> = {
  draft: 'default',
  ready_for_review: 'warning',
  posted: 'success',
  voided: 'error',
  expired: 'default',
};

interface Props {
  search: string;
}

function formatEventDate(value: WhDocumentClient['eventDate'] | undefined): string {
  if (!value) return '—';
  if (typeof value === 'string') {
    try {
      return new Date(value).toLocaleDateString('ru-RU');
    } catch {
      return value;
    }
  }
  if ('seconds' in value) {
    return new Date(value.seconds * 1000).toLocaleDateString('ru-RU');
  }
  return '—';
}

export default function DocumentsTab({ search }: Props) {
  const perms = useWarehousePermissions();
  const { userProfile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [docs, setDocs] = useState<WhDocumentClient[]>([]);
  const [items, setItems] = useState<WhItemClient[]>([]);
  const [locations, setLocations] = useState<WhLocationClient[]>([]);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [filterType, setFilterType] = useState<DocType | ''>('');
  const [filterStatus, setFilterStatus] = useState<DocStatus | ''>('');
  const [createOpen, setCreateOpen] = useState(false);
  const [cycleCountOpen, setCycleCountOpen] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<WhDocumentClient | null>(null);
  const [selectedLines, setSelectedLines] = useState<WhDocumentLineClient[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState<'wrong_qty' | 'wrong_items' | 'duplicate' | 'other'>('wrong_qty');
  const [voidNote, setVoidNote] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [docRes, itemList, locList] = await Promise.all([
          listDocuments({
            docType: filterType || undefined,
            status: filterStatus || undefined,
            limit: 100,
          }),
          listItems({ max: 1000 }),
          listLocations({ includeInactive: false }),
        ]);
        if (cancelled) return;
        setDocs(docRes.documents);
        setItems(itemList);
        setLocations(locList);
      } catch (e: any) {
        if (!cancelled) toast.error(e?.message ?? 'Не удалось загрузить документы');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filterType, filterStatus, refreshTick]);

  useEffect(() => {
    const companyId = userProfile?.companyId;
    if (!companyId) return;
    let cancelled = false;
    projectsApi
      .getAll(companyId)
      .then((res) => {
        if (cancelled) return;
        setProjects(res.map((p: any) => ({ id: p.id, name: p.name ?? p.id })));
      })
      .catch(() => {
        // Non-fatal — projects picker will be empty but user can still pick system projects manually.
      });
    return () => {
      cancelled = true;
    };
  }, [userProfile?.companyId]);

  const locationById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return docs;
    return docs.filter(
      (d) =>
        d.docNumber.toLowerCase().includes(needle) ||
        (d.note ?? '').toLowerCase().includes(needle) ||
        (d.vendorReceiptNumber ?? '').toLowerCase().includes(needle),
    );
  }, [docs, search]);

  async function openDetail(doc: WhDocumentClient) {
    setSelectedDoc(doc);
    setSelectedLines([]);
    setDetailLoading(true);
    try {
      const res = await getDocument(doc.id);
      setSelectedDoc(res.document);
      setSelectedLines(res.lines);
    } catch (e: any) {
      toast.error(e?.message ?? 'Не удалось загрузить документ');
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetail() {
    setSelectedDoc(null);
    setSelectedLines([]);
  }

  async function handlePost(doc: WhDocumentClient) {
    if (!window.confirm(`Провести документ ${doc.docNumber}? Балансы обновятся.`)) return;
    setActionLoading(true);
    try {
      await postDocument(doc.id);
      toast.success(`✅ ${doc.docNumber} проведён`);
      setRefreshTick((t) => t + 1);
      if (selectedDoc?.id === doc.id) {
        await openDetail(doc);
      }
    } catch (e: any) {
      toast.error(e?.message ?? 'Не удалось провести');
    } finally {
      setActionLoading(false);
    }
  }

  function openVoidDialog(doc: WhDocumentClient) {
    setSelectedDoc(doc);
    setVoidReason('wrong_qty');
    setVoidNote('');
    setVoidOpen(true);
  }

  async function handleVoidConfirm() {
    if (!selectedDoc) return;
    setActionLoading(true);
    try {
      const result = await voidDocument(selectedDoc.id, voidReason, voidNote.trim() || undefined);
      if (result.reversalDocumentId) {
        toast.success(`↩️ Создан reversal ${result.reversalDocumentId}`);
      } else {
        toast.success('Документ отменён');
      }
      setVoidOpen(false);
      setRefreshTick((t) => t + 1);
      if (selectedDoc) await openDetail(selectedDoc);
    } catch (e: any) {
      toast.error(e?.message ?? 'Не удалось отменить');
    } finally {
      setActionLoading(false);
    }
  }

  function renderLocation(id?: string): string {
    if (!id) return '—';
    return locationById.get(id)?.name ?? id;
  }

  function renderDoc(doc: WhDocumentClient) {
    const type = DOC_TYPE_LABELS[doc.docType];
    const locLabel =
      doc.docType === 'transfer'
        ? `${renderLocation(doc.sourceLocationId)} → ${renderLocation(doc.destinationLocationId)}`
        : renderLocation(doc.sourceLocationId ?? doc.destinationLocationId ?? doc.locationId);
    return (
      <TableRow key={doc.id} hover onClick={() => openDetail(doc)} sx={{ cursor: 'pointer' }}>
        <TableCell sx={{ fontFamily: 'monospace' }}>{doc.docNumber}</TableCell>
        <TableCell>
          {type.emoji} {type.label}
        </TableCell>
        <TableCell>
          <Chip size="small" label={doc.status} color={STATUS_COLORS[doc.status]} variant="outlined" />
        </TableCell>
        <TableCell>{formatEventDate(doc.eventDate)}</TableCell>
        <TableCell>{locLabel}</TableCell>
        <TableCell align="right">${doc.totals?.total?.toFixed(2) ?? '—'}</TableCell>
        <TableCell align="right" onClick={(e) => e.stopPropagation()}>
          {doc.status === 'draft' && perms.canPostDocuments && (
            <Tooltip title="Провести (post)">
              <IconButton size="small" color="success" onClick={() => handlePost(doc)} disabled={actionLoading}>
                <CheckIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          {(doc.status === 'draft' || doc.status === 'posted') &&
            (doc.status === 'posted' ? perms.canVoidPosted : perms.canPostDocuments) && (
              <Tooltip title={doc.status === 'posted' ? 'Отменить (reversal)' : 'Отменить draft'}>
                <IconButton size="small" color="error" onClick={() => openVoidDialog(doc)} disabled={actionLoading}>
                  <BlockIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
        </TableCell>
      </TableRow>
    );
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between">
        <Stack direction="row" spacing={2} alignItems="center">
          <TextField
            select
            size="small"
            label="Тип"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as DocType | '')}
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="">Все типы</MenuItem>
            {(Object.keys(DOC_TYPE_LABELS) as DocType[]).map((t) => (
              <MenuItem key={t} value={t}>
                {DOC_TYPE_LABELS[t].emoji} {DOC_TYPE_LABELS[t].label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Статус"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as DocStatus | '')}
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="">Все статусы</MenuItem>
            <MenuItem value="draft">draft</MenuItem>
            <MenuItem value="posted">posted</MenuItem>
            <MenuItem value="voided">voided</MenuItem>
            <MenuItem value="expired">expired</MenuItem>
          </TextField>
          <Tooltip title="Обновить">
            <IconButton onClick={() => setRefreshTick((t) => t + 1)}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
          <Typography variant="body2" color="text.secondary">
            {filtered.length} из {docs.length}
          </Typography>
        </Stack>
        {perms.canCreateDocuments && (
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" onClick={() => setCycleCountOpen(true)}>
              ⚖️ Инвентаризация
            </Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
              Новый документ
            </Button>
          </Stack>
        )}
      </Stack>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : filtered.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>
          Документов не найдено. {perms.canCreateDocuments && 'Создайте первый.'}
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>№</TableCell>
                <TableCell>Тип</TableCell>
                <TableCell>Статус</TableCell>
                <TableCell>Дата</TableCell>
                <TableCell>Локации</TableCell>
                <TableCell align="right">Сумма</TableCell>
                <TableCell align="right">Действия</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>{filtered.map(renderDoc)}</TableBody>
          </Table>
        </TableContainer>
      )}

      <DocumentFormDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={() => setRefreshTick((t) => t + 1)}
        items={items}
        locations={locations}
        projects={projects}
      />

      <CycleCountDialog
        open={cycleCountOpen}
        onClose={() => setCycleCountOpen(false)}
        onSaved={() => setRefreshTick((t) => t + 1)}
        items={items}
        locations={locations}
      />

      <Drawer
        anchor="right"
        open={!!selectedDoc && !voidOpen}
        onClose={closeDetail}
        PaperProps={{ sx: { width: { xs: '100%', sm: 560 } } }}
      >
        {selectedDoc && (
          <Box sx={{ p: 3 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
              <Typography variant="h6">
                {DOC_TYPE_LABELS[selectedDoc.docType].emoji} {selectedDoc.docNumber}
              </Typography>
              <IconButton onClick={closeDetail}>
                <CloseIcon />
              </IconButton>
            </Stack>

            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1}>
                <Chip
                  size="small"
                  label={selectedDoc.status}
                  color={STATUS_COLORS[selectedDoc.status]}
                  variant="outlined"
                />
                <Chip size="small" label={DOC_TYPE_LABELS[selectedDoc.docType].label} variant="outlined" />
              </Stack>

              <Typography variant="body2">
                <strong>Дата:</strong> {formatEventDate(selectedDoc.eventDate)}
              </Typography>
              {selectedDoc.sourceLocationId && (
                <Typography variant="body2">
                  <strong>Источник:</strong> {renderLocation(selectedDoc.sourceLocationId)}
                </Typography>
              )}
              {selectedDoc.destinationLocationId && (
                <Typography variant="body2">
                  <strong>Назначение:</strong> {renderLocation(selectedDoc.destinationLocationId)}
                </Typography>
              )}
              {selectedDoc.locationId && (
                <Typography variant="body2">
                  <strong>Локация:</strong> {renderLocation(selectedDoc.locationId)}
                </Typography>
              )}
              {selectedDoc.reason && (
                <Typography variant="body2">
                  <strong>Причина:</strong> {selectedDoc.reason}
                </Typography>
              )}
              {selectedDoc.projectId && (
                <Typography variant="body2">
                  <strong>Проект:</strong> {selectedDoc.projectId}
                </Typography>
              )}
              {selectedDoc.vendorReceiptNumber && (
                <Typography variant="body2">
                  <strong>Накладная:</strong> {selectedDoc.vendorReceiptNumber}
                </Typography>
              )}
              {selectedDoc.note && (
                <Alert severity="info" sx={{ whiteSpace: 'pre-wrap' }}>
                  {selectedDoc.note}
                </Alert>
              )}
              {selectedDoc.reversedByDocumentId && (
                <Alert severity="warning">Отменён документом {selectedDoc.reversedByDocumentId}</Alert>
              )}
              {selectedDoc.reversalOfDocumentId && (
                <Alert severity="info">Reversal документа {selectedDoc.reversalOfDocumentId}</Alert>
              )}

              <Typography variant="subtitle2" sx={{ mt: 2 }}>
                Строки
              </Typography>
              {detailLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                  <CircularProgress size={24} />
                </Box>
              ) : (
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Товар</TableCell>
                        <TableCell align="right">Кол-во</TableCell>
                        <TableCell>UOM</TableCell>
                        <TableCell align="right">$/ед</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {selectedLines.map((line, i) => {
                        const item = itemById.get(line.itemId);
                        return (
                          <TableRow key={line.id ?? i}>
                            <TableCell>{item?.name ?? line.itemId}</TableCell>
                            <TableCell align="right">{line.qty}</TableCell>
                            <TableCell>{line.uom}</TableCell>
                            <TableCell align="right">
                              {line.unitCost !== undefined ? `$${line.unitCost.toFixed(2)}` : '—'}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}

              {selectedDoc.totals && (
                <Typography variant="body2" sx={{ textAlign: 'right' }}>
                  <strong>Сумма:</strong> ${selectedDoc.totals.total.toFixed(2)} {selectedDoc.totals.currency}
                </Typography>
              )}

              <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
                {selectedDoc.status === 'draft' && perms.canPostDocuments && (
                  <Button
                    variant="contained"
                    color="success"
                    startIcon={<CheckIcon />}
                    onClick={() => handlePost(selectedDoc)}
                    disabled={actionLoading}
                  >
                    Провести
                  </Button>
                )}
                {(selectedDoc.status === 'draft' || selectedDoc.status === 'posted') &&
                  (selectedDoc.status === 'posted' ? perms.canVoidPosted : perms.canPostDocuments) && (
                    <Button
                      variant="outlined"
                      color="error"
                      startIcon={<BlockIcon />}
                      onClick={() => openVoidDialog(selectedDoc)}
                      disabled={actionLoading}
                    >
                      {selectedDoc.status === 'posted' ? 'Отменить (reversal)' : 'Отменить draft'}
                    </Button>
                  )}
              </Stack>
            </Stack>
          </Box>
        )}
      </Drawer>

      <Dialog open={voidOpen} onClose={() => setVoidOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Отменить документ {selectedDoc?.docNumber}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {selectedDoc?.status === 'posted' && (
              <Alert severity="warning">
                Будет создан reversal документ с обратными проводками. Оригинал пометится voided.
              </Alert>
            )}
            <TextField
              select
              label="Причина"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value as typeof voidReason)}
              fullWidth
            >
              <MenuItem value="wrong_qty">Неверное количество</MenuItem>
              <MenuItem value="wrong_items">Неверные товары</MenuItem>
              <MenuItem value="duplicate">Дубликат</MenuItem>
              <MenuItem value="other">Другое</MenuItem>
            </TextField>
            <TextField
              label="Комментарий"
              value={voidNote}
              onChange={(e) => setVoidNote(e.target.value)}
              multiline
              minRows={2}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVoidOpen(false)} disabled={actionLoading}>
            Отмена
          </Button>
          <Button color="error" variant="contained" onClick={handleVoidConfirm} disabled={actionLoading}>
            {actionLoading ? 'Отмена…' : 'Подтвердить'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
