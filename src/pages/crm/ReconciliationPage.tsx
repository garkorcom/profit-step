import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Button, Paper, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow,
  Select, MenuItem, CircularProgress, Alert,
  Checkbox, Tooltip,
  TablePagination, TableSortLabel,
} from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import AutoApproveRulesDialog from '../../components/crm/AutoApproveRulesDialog';
import TransactionNoteDrawer from '../../components/crm/TransactionNoteDrawer';
import ExpenseAnalyticsPanel from '../../components/crm/ExpenseAnalyticsPanel';
import { SummaryCards, FilterBar, BulkActionToolbar, TransactionRow, AskEmployeeDialog } from '../../components/reconciliation';
import { db } from '../../firebase/firebase';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { errorMessage } from '../../utils/errorMessage';
import { useAuth } from '../../auth/AuthContext';
import { useReconciliationFilters } from '../../hooks/useReconciliationFilters';
import { useTransactionMutations } from '../../hooks/useTransactionMutations';
import { useReconciliationExport } from '../../hooks/useReconciliationExport';
import {
  type ReconcileTx,
  type EmployeeOption,
  type SortField,
  normalizeDate,
  isTampaArea,
} from '../../components/reconciliation/types';

// ─── Component ──────────────────────────────────────────────

const ReconciliationPage: React.FC = () => {
  const { userProfile } = useAuth();

  // ─── Core data state ─────────────────────────────────────
  const [view, setView] = useState<'draft' | 'approved' | 'ignored'>('draft');
  const [transactions, setTransactions] = useState<ReconcileTx[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ─── Selection state ─────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ─── UI toggle state ─────────────────────────────────────
  const [rulesOpen, setRulesOpen] = useState(false);
  const [noteDrawerTxId, setNoteDrawerTxId] = useState<string | null>(null);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);

  // ─── Data Fetching ───────────────────────────────────────

  const fetchData = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const txQuery = view === 'draft'
        ? query(collection(db, 'bank_transactions'), where('status', '==', 'draft'))
        : view === 'ignored'
        ? query(collection(db, 'bank_transactions'), where('status', '==', 'ignored'))
        : query(collection(db, 'bank_transactions'), where('status', '==', 'approved'), orderBy('updatedAt', 'desc'));
      const txSnap = await getDocs(txQuery);
      setTransactions(txSnap.docs.map(d => ({ id: d.id, ...d.data() } as ReconcileTx)));

      const [prjSnap, empSnap] = await Promise.all([
        getDocs(query(collection(db, 'projects'), where('status', '==', 'active'))),
        userProfile?.companyId
          ? getDocs(query(collection(db, 'users'), where('companyId', '==', userProfile.companyId), where('status', '==', 'active')))
          : Promise.resolve(null),
      ]);
      setProjects(prjSnap.docs.map(d => ({ id: d.id, name: d.data().name || d.id })));
      if (empSnap) {
        setEmployees(empSnap.docs.map(d => ({ id: d.id, name: d.data().displayName || d.data().email || d.id })).sort((a, b) => a.name.localeCompare(b.name)));
      }
    } catch (e: unknown) {
      console.error("Failed to fetch:", e);
      const msg = errorMessage(e);
      setErrorMsg(msg.includes('index')
        ? "Требуется создать индекс Firestore. " + msg
        : "Ошибка: " + msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // ─── Hooks ───────────────────────────────────────────────

  const filters = useReconciliationFilters(transactions);

  const mutations = useTransactionMutations({
    transactions,
    setTransactions,
    enrichedTransactions: filters.enrichedTransactions,
    filteredTransactions: filters.filteredTransactions,
    projects,
    fetchData,
    setErrorMsg,
    selectedIds,
    setSelectedIds,
  });

  const { handleExportCSV, handleExportPDF, handleExportByMonthZip, zipExporting } = useReconciliationExport({
    filteredTransactions: filters.filteredTransactions,
    projects,
    view,
    filterMonth: filters.filterMonth,
    quickFilter: filters.quickFilter,
    searchQuery: filters.searchQuery,
  });

  // ─── Selection handlers ──────────────────────────────────

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const pageIds = filters.paginatedTransactions.map(t => t.id);
    const allSelected = pageIds.every(id => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds(prev => { const next = new Set(prev); pageIds.forEach(id => next.delete(id)); return next; });
    } else {
      setSelectedIds(prev => { const next = new Set(prev); pageIds.forEach(id => next.add(id)); return next; });
    }
  };

  // ─── Render ──────────────────────────────────────────────

  if (loading) return <Box p={4} textAlign="center"><CircularProgress /></Box>;

  const draftTotal = filters.filteredTransactions.length;
  const draftHighConf = filters.filteredTransactions.filter(t => t.confidence === 'high').length;
  const draftLowConf = draftTotal - draftHighConf;
  const autopilotPercent = draftTotal > 0 ? Math.round((draftHighConf / draftTotal) * 100) : 0;
  const tampaCount = filters.filteredTransactions.filter(t => isTampaArea(t._location)).length;

  return (
    <Box p={3} sx={{ maxWidth: 1500, mx: 'auto' }}>
      {/* ─── Header ─── */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={2}>
        <Box display="flex" alignItems="center" gap={2}>
          <Typography variant="h4" fontWeight="bold">Reconciliation Hub</Typography>
          <Select size="small" value={view} onChange={e => { setView(e.target.value as 'draft' | 'approved' | 'ignored'); setSelectedIds(new Set()); }} sx={{ minWidth: 200, bgcolor: 'white' }}>
            <MenuItem value="draft">⏳ Черновики (Draft)</MenuItem>
            <MenuItem value="approved">✅ Утвержденные</MenuItem>
          </Select>
        </Box>
        <Box display="flex" alignItems="center" gap={1}>
          <Tooltip title="Правила авто-утверждения">
            <Button size="small" variant="outlined" startIcon={<SettingsIcon />} onClick={() => setRulesOpen(true)}>
              Правила
            </Button>
          </Tooltip>
          <Button size="small" variant="outlined" startIcon={<FileDownloadIcon />} onClick={handleExportCSV} disabled={!filters.filteredTransactions.length}>
            CSV
          </Button>
          <Button size="small" variant="outlined" startIcon={<PictureAsPdfIcon />} onClick={handleExportPDF} disabled={!filters.filteredTransactions.length}>
            PDF
          </Button>
          <Tooltip title="Полный бекап за год: bank_transactions + costs, по месяцам, ZIP-архив">
            <span>
              <Button
                size="small"
                variant="outlined"
                color="secondary"
                startIcon={<Inventory2Icon />}
                onClick={() => handleExportByMonthZip()}
                disabled={zipExporting}
              >
                {zipExporting ? 'Архивирую...' : 'ZIP по месяцам'}
              </Button>
            </span>
          </Tooltip>
          <Typography variant="body2" color="text.secondary" sx={{ mx: 1 }}>
            {filters.filteredTransactions.length} из {filters.enrichedTransactions.length}
          </Typography>
          {view === 'draft' && (
            <>
              <Button variant="outlined" color="warning" size="small" disabled={!tampaCount || mutations.submitting} onClick={mutations.handleApproveTampa}>
                ✅ Tampa ({tampaCount})
              </Button>
              <Button variant="contained" color="success" size="medium" disabled={!filters.filteredTransactions.length || mutations.submitting} onClick={mutations.handleApproveAll}>
                {mutations.submitting ? 'Сохранение...' : 'Утвердить всё'}
              </Button>
            </>
          )}
        </Box>
      </Box>

      {/* ─── Summary Cards (clickable, react to filters) ─── */}
      {filters.enrichedTransactions.length > 0 && (
        <SummaryCards
          summaryData={filters.summaryData}
          quickFilter={filters.quickFilter}
          onQuickFilterChange={filters.setQuickFilter}
        />
      )}

      {/* ─── Analytics Panel ─── */}
      {filters.enrichedTransactions.length > 0 && (
        <ExpenseAnalyticsPanel
          transactions={filters.filteredTransactions.map(t => ({
            amount: t.amount,
            categoryId: t.categoryId,
            cleanMerchant: t.cleanMerchant,
            date: normalizeDate(t.date),
            paymentType: t.paymentType,
          }))}
          expanded={analyticsOpen}
          onToggle={() => setAnalyticsOpen(prev => !prev)}
        />
      )}

      {/* ─── Filters Row ─── */}
      {filters.enrichedTransactions.length > 0 && (
        <FilterBar
          searchQuery={filters.searchQuery}
          onSearchChange={filters.setSearchQuery}
          filterMonth={filters.filterMonth}
          onFilterMonthChange={filters.setFilterMonth}
          availableMonths={filters.availableMonths}
          enrichedTransactions={filters.enrichedTransactions}
          amountMin={filters.amountMin}
          onAmountMinChange={filters.setAmountMin}
          amountMax={filters.amountMax}
          onAmountMaxChange={filters.setAmountMax}
          quickFilter={filters.quickFilter}
          onQuickFilterChange={filters.setQuickFilter}
          monthFilteredTransactions={filters.monthFilteredTransactions}
          filterStats={filters.filterStats}
          view={view}
        />
      )}

      {/* ─── Bulk Action Toolbar ─── */}
      {selectedIds.size > 0 && view === 'draft' && (
        <BulkActionToolbar
          selectedCount={selectedIds.size}
          submitting={mutations.submitting}
          onBulkUpdate={mutations.handleBulkUpdate}
          onApproveSelected={mutations.handleApproveSelected}
          onBulkIgnore={mutations.handleBulkIgnore}
          onClearSelection={() => setSelectedIds(new Set())}
        />
      )}

      {/* ─── AI Stats ─── */}
      {view === 'draft' && draftTotal > 0 && (
        <Paper sx={{ p: 1.5, mb: 2, display: 'flex', gap: 4, bgcolor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 2 }} elevation={0}>
          <Box>
            <Typography variant="body2" color="text.secondary">Автоматизировано ИИ</Typography>
            <Typography variant="h5" color="success.main" fontWeight="bold">{autopilotPercent}%</Typography>
          </Box>
          <Box>
            <Typography variant="body2" color="text.secondary">По правилам</Typography>
            <Typography variant="h6" color="success.main">{draftHighConf} шт.</Typography>
          </Box>
          <Box>
            <Typography variant="body2" color="text.secondary">Угадано LLM</Typography>
            <Typography variant="h6" color="warning.main">{draftLowConf} шт.</Typography>
          </Box>
        </Paper>
      )}

      {errorMsg && <Alert severity="error" sx={{ mb: 2 }}>{errorMsg}</Alert>}

      {/* ─── Table ─── */}
      <TableContainer component={Paper} elevation={2} sx={{ maxHeight: 'calc(100vh - 340px)' }}>
        <Table size="small" stickyHeader sx={{ tableLayout: 'fixed' }}>
          <TableHead>
            <TableRow>
              {view === 'draft' && (
                <TableCell padding="checkbox" sx={{ width: 42 }}>
                  <Checkbox
                    size="small"
                    indeterminate={selectedIds.size > 0 && !filters.paginatedTransactions.every(t => selectedIds.has(t.id))}
                    checked={filters.paginatedTransactions.length > 0 && filters.paginatedTransactions.every(t => selectedIds.has(t.id))}
                    onChange={toggleSelectAll}
                  />
                </TableCell>
              )}
              <TableCell sx={{ width: 78 }}>
                <TableSortLabel active={filters.sortField === 'date'} direction={filters.sortField === 'date' ? filters.sortDir : 'desc'} onClick={() => filters.handleSort('date' as SortField)}>
                  <strong>Дата</strong>
                </TableSortLabel>
              </TableCell>
              <TableCell>
                <TableSortLabel active={filters.sortField === 'cleanMerchant'} direction={filters.sortField === 'cleanMerchant' ? filters.sortDir : 'asc'} onClick={() => filters.handleSort('cleanMerchant' as SortField)}>
                  <strong>Контрагент</strong>
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ width: 220 }}>
                <TableSortLabel active={filters.sortField === 'amount'} direction={filters.sortField === 'amount' ? filters.sortDir : 'desc'} onClick={() => filters.handleSort('amount' as SortField)}>
                  <strong>Сумма</strong>
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ width: 100 }}><strong>Тип</strong></TableCell>
              <TableCell sx={{ width: 120 }}><strong>Сотрудник</strong></TableCell>
              <TableCell sx={{ width: 135 }}>
                <TableSortLabel active={filters.sortField === 'categoryId'} direction={filters.sortField === 'categoryId' ? filters.sortDir : 'asc'} onClick={() => filters.handleSort('categoryId' as SortField)}>
                  <strong>Категория</strong>
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ width: 155 }}><strong>Проект</strong></TableCell>
              <TableCell align="center" sx={{ width: 70 }}><strong>✓</strong></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filters.paginatedTransactions.map(t => (
              <TransactionRow
                key={t.id}
                t={t}
                view={view}
                isSelected={selectedIds.has(t.id)}
                isInlineApproved={mutations.approvedIds.has(t.id)}
                isDuplicate={filters.duplicateIds.has(t.id)}
                submitting={mutations.submitting}
                employees={employees}
                projects={projects}
                onSelect={toggleSelect}
                onUpdate={mutations.handleUpdate}
                onApproveSingle={mutations.handleApproveSingle}
                onIgnore={mutations.handleIgnore}
                onRestore={mutations.handleRestore}
                onUndo={mutations.handleUndo}
                onVerify={mutations.handleVerify}
                onOpenNote={setNoteDrawerTxId}
                onOpenAskDialog={(id) => { mutations.setAskDialogTxId(id); mutations.setAskMessage(''); }}
              />
            ))}
            {filters.paginatedTransactions.length === 0 && (
              <TableRow>
                <TableCell colSpan={view === 'draft' ? 10 : 9} align="center" sx={{ py: 6 }}>
                  <Typography variant="h6" color="text.secondary">
                    {filters.searchQuery ? `Ничего не найдено по "${filters.searchQuery}"` : view === 'draft' ? "🎉 Нет выписок для сверки." : "Список пуст."}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* ─── Pagination ─── */}
      <TablePagination
        component="div"
        count={filters.filteredTransactions.length}
        page={filters.page}
        onPageChange={(_, p) => filters.setPage(p)}
        rowsPerPage={filters.rowsPerPage}
        onRowsPerPageChange={e => { filters.setRowsPerPage(parseInt(e.target.value, 10)); filters.setPage(0); }}
        rowsPerPageOptions={[25, 50, 100]}
        labelRowsPerPage="Строк:"
        labelDisplayedRows={({ from, to, count }) => `${from}–${to} из ${count}`}
      />

      {/* Auto-approve rules dialog */}
      <AutoApproveRulesDialog open={rulesOpen} onClose={() => setRulesOpen(false)} />

      {/* Transaction note drawer */}
      <TransactionNoteDrawer
        open={!!noteDrawerTxId}
        onClose={() => setNoteDrawerTxId(null)}
        transaction={(() => {
          if (!noteDrawerTxId) return null;
          const tx = transactions.find(t => t.id === noteDrawerTxId);
          if (!tx) return null;
          const proj = projects.find(p => p.id === tx.projectId);
          return {
            id: tx.id,
            cleanMerchant: tx.cleanMerchant,
            rawDescription: tx.rawDescription,
            amount: tx.amount,
            date: normalizeDate(tx.date),
            categoryId: tx.categoryId,
            paymentType: tx.paymentType,
            projectName: proj?.name,
            note: tx.note,
          };
        })()}
        onSaveNote={mutations.handleSaveNote}
      />

      {/* Ask Employee via Telegram dialog */}
      <AskEmployeeDialog
        open={!!mutations.askDialogTxId}
        transaction={mutations.askDialogTxId ? transactions.find(t => t.id === mutations.askDialogTxId) || null : null}
        message={mutations.askMessage}
        onMessageChange={mutations.setAskMessage}
        sending={mutations.askSending}
        onSend={mutations.handleAskEmployee}
        onClose={() => { mutations.setAskDialogTxId(null); mutations.setAskMessage(''); }}
      />
    </Box>
  );
};

export default ReconciliationPage;
