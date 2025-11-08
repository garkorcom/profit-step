/**
 * CompaniesPage - Main page for managing company clients (CRM)
 *
 * Features:
 * - Cursor-based pagination with client-side caching (5 min TTL)
 * - Search by company name (case-insensitive)
 * - Status filtering (active/archived/all)
 * - Export to CSV with progress feedback
 * - Keyboard shortcuts (Ctrl+N, Ctrl+R, Ctrl+E, Ctrl+F)
 * - Cost tracking and warnings
 * - Real-time CRUD operations
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  TablePagination,
  Alert,
  LinearProgress,
  Chip,
  IconButton,
  Tooltip,
  TextField,
  InputAdornment,
  ToggleButtonGroup,
  ToggleButton,
} from '@mui/material';
import {
  Add as AddIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
  Download as DownloadIcon,
} from '@mui/icons-material';
import { useAuth } from '../../auth/AuthContext';
import { debounce } from 'lodash';
import toast from 'react-hot-toast';
import { DocumentSnapshot } from 'firebase/firestore';
import {
  getCompanyClientsCount,
  getCompanyClientsPaginated,
  archiveCompany,
  restoreCompany,
} from '../../api/companiesApi';
import { Company, CompanyStatus } from '../../types/crm.types';
import CompaniesTable from '../../components/companies/CompaniesTable';
import CompanyFormDialog from '../../components/companies/CompanyFormDialog';
import CostWarningDialog from '../../components/admin/CostWarningDialog';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { costProtectionBreaker } from '../../utils/circuitBreaker';

// Константы
const DEFAULT_PAGE_SIZE = 25;
const CACHE_TTL = 5 * 60 * 1000; // 5 минут
const DEBOUNCE_DELAY = 500;

interface CachedPage {
  data: Company[];
  timestamp: number;
  firstDoc: DocumentSnapshot | null;
  lastDoc: DocumentSnapshot | null;
}

export default function CompaniesPage() {
  const { userProfile } = useAuth();

  // State
  const [page, setPage] = useState(0);
  const [pageSize] = useState(DEFAULT_PAGE_SIZE);
  const [totalCompanies, setTotalCompanies] = useState(0);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Поиск и фильтры
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<CompanyStatus>('active');

  // Пагинация и кеш
  const [pageCache, setPageCache] = useState<Map<string, CachedPage>>(new Map());
  const [cursors, setCursors] = useState<
    Map<number, { first: DocumentSnapshot | null; last: DocumentSnapshot | null }>
  >(new Map());

  // Cost tracking
  const [totalFirestoreReads, setTotalFirestoreReads] = useState(0);
  const sessionCost = useMemo(
    () => (totalFirestoreReads * 0.06) / 100000,
    [totalFirestoreReads]
  );
  const [warningDismissed, setWarningDismissed] = useState(false);

  // UI State
  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [companyToEdit, setCompanyToEdit] = useState<Company | null>(null);
  const [exporting, setExporting] = useState(false);

  // Refs
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Загрузка общего количества
  useEffect(() => {
    if (!userProfile?.companyId) return;

    const loadCount = async () => {
      try {
        const result = await getCompanyClientsCount(userProfile.companyId, statusFilter);
        setTotalCompanies(result.count);
        setTotalFirestoreReads((prev) => prev + 1);
      } catch (err) {
        console.error('Error loading companies count:', err);
      }
    };

    loadCount();
  }, [userProfile?.companyId, statusFilter]);

  // Проверка кеша
  const getCachedPage = useCallback(
    (cacheKey: string): CachedPage | null => {
      const cached = pageCache.get(cacheKey);
      if (!cached) return null;

      const now = Date.now();
      if (now - cached.timestamp > CACHE_TTL) {
        pageCache.delete(cacheKey);
        return null;
      }

      return cached;
    },
    [pageCache]
  );

  // Загрузка данных страницы
  const loadPageData = useCallback(
    async (
      pageNumber: number,
      direction: 'next' | 'prev' | 'initial' = 'initial',
      forceRefresh = false
    ) => {
      if (!userProfile?.companyId) return;

      const cacheKey = `${pageNumber}-${statusFilter}-${debouncedSearchTerm}`;

      // Проверка кеша
      if (!forceRefresh) {
        const cached = getCachedPage(cacheKey);
        if (cached) {
          setCompanies(cached.data);
          setLoading(false);
          console.log('[CACHE HIT] Companies page loaded from cache');
          return;
        }
      }

      setLoading(true);
      setError(null);

      try {
        // Определение курсоров
        let startAfterDoc: DocumentSnapshot | undefined;
        let endBeforeDoc: DocumentSnapshot | undefined;

        if (direction === 'next' && pageNumber > 0) {
          const prevCursor = cursors.get(pageNumber - 1);
          startAfterDoc = prevCursor?.last || undefined;
        } else if (direction === 'prev' && pageNumber > 0) {
          const nextCursor = cursors.get(pageNumber + 1);
          endBeforeDoc = nextCursor?.first || undefined;
        }

        // Загрузка данных
        const result = await getCompanyClientsPaginated({
          ownerCompanyId: userProfile.companyId,
          pageSize: DEFAULT_PAGE_SIZE,
          startAfterDoc,
          endBeforeDoc,
          orderBy: 'name',
          orderDirection: 'asc',
          searchTerm: debouncedSearchTerm,
          statusFilter,
        });

        setCompanies(result.companies);
        setTotalFirestoreReads((prev) => prev + result.reads);

        // Обновление курсоров
        if (result.firstDoc && result.lastDoc) {
          setCursors((prev) => {
            const newCursors = new Map(prev);
            newCursors.set(pageNumber, {
              first: result.firstDoc,
              last: result.lastDoc,
            });
            return newCursors;
          });
        }

        // Обновление кеша
        setPageCache((prev) => {
          const newCache = new Map(prev);
          newCache.set(cacheKey, {
            data: result.companies,
            timestamp: Date.now(),
            firstDoc: result.firstDoc,
            lastDoc: result.lastDoc,
          });
          return newCache;
        });
      } catch (err: any) {
        console.error('Error loading companies:', err);
        setError(err.message || 'Failed to load companies');
        toast.error('Ошибка загрузки компаний');
      } finally {
        setLoading(false);
        setInitialLoading(false);
      }
    },
    [userProfile?.companyId, statusFilter, debouncedSearchTerm, cursors, getCachedPage]
  );

  // Загрузка начальной страницы
  useEffect(() => {
    loadPageData(page, 'initial');
  }, [page, statusFilter, debouncedSearchTerm]);

  // Debounced поиск
  const debouncedSearch = useMemo(
    () =>
      debounce((term: string) => {
        setDebouncedSearchTerm(term);
        setPage(0);
        setPageCache(new Map());
        setCursors(new Map());
      }, DEBOUNCE_DELAY),
    []
  );

  // Handlers
  const handleChangePage = (event: unknown, newPage: number) => {
    const direction = newPage > page ? 'next' : 'prev';
    setPage(newPage);
    loadPageData(newPage, direction);
  };

  const handleSearch = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(event.target.value);
    debouncedSearch(event.target.value);
  };

  const handleStatusFilterChange = (
    event: React.MouseEvent<HTMLElement>,
    newStatus: CompanyStatus | null
  ) => {
    if (newStatus) {
      setStatusFilter(newStatus);
      setPage(0);
      setPageCache(new Map());
      setCursors(new Map());
    }
  };

  const handleRefresh = () => {
    setPageCache(new Map());
    setCursors(new Map());
    loadPageData(page, 'initial', true);
    toast.success('Данные обновлены');
  };

  const handleCreateCompany = () => {
    setCompanyToEdit(null);
    setFormDialogOpen(true);
  };

  const handleEditCompany = (company: Company) => {
    setCompanyToEdit(company);
    setFormDialogOpen(true);
  };

  const handleArchiveCompany = async (company: Company) => {
    try {
      if (company.isArchived) {
        await restoreCompany(company.id);
        toast.success(`Компания "${company.name}" восстановлена`);
      } else {
        await archiveCompany(company.id);
        toast.success(`Компания "${company.name}" архивирована`);
      }
      handleRefresh();
    } catch (err) {
      toast.error('Ошибка при изменении статуса компании');
    }
  };

  const handleExport = async () => {
    if (!userProfile?.companyId) return;

    setExporting(true);
    const toastId = toast.loading('Экспорт данных...');

    try {
      const allCompanies: Company[] = [];
      let lastDoc: DocumentSnapshot | null = null;
      let hasMore = true;
      let attempts = 0;
      const MAX_ATTEMPTS = 100;

      while (hasMore && attempts < MAX_ATTEMPTS) {
        const result: Awaited<ReturnType<typeof getCompanyClientsPaginated>> = await getCompanyClientsPaginated({
          ownerCompanyId: userProfile.companyId,
          pageSize: 100,
          startAfterDoc: lastDoc || undefined,
          orderBy: 'name',
          orderDirection: 'asc',
          searchTerm: '',
          statusFilter,
        });

        allCompanies.push(...result.companies);
        lastDoc = result.lastDoc;
        hasMore = result.hasNextPage;
        attempts++;

        const progress = totalCompanies > 0 ? Math.round((allCompanies.length / totalCompanies) * 100) : 0;
        toast.loading(`Экспорт... ${progress}% (${allCompanies.length} записей)`, { id: toastId });
      }

      // Создание CSV
      const headers = ['Название', 'Email', 'Телефон', 'Сайт', 'Адрес', 'Статус', 'Создана'];
      const rows = allCompanies.map((c) => {
        const createdAt = c.createdAt
          ? typeof c.createdAt === 'string'
            ? new Date(c.createdAt).toLocaleDateString('ru-RU')
            : c.createdAt.toDate().toLocaleDateString('ru-RU')
          : '';

        return [
          c.name,
          c.email || '',
          c.phone || '',
          c.website || '',
          c.address || '',
          c.isArchived ? 'Архив' : 'Активна',
          createdAt,
        ];
      });

      const csv = [
        headers.join(','),
        ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
      ].join('\n');

      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `companies-${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      URL.revokeObjectURL(url);

      toast.success(`Экспортировано ${allCompanies.length} компаний`, { id: toastId });
    } catch (err: any) {
      console.error('Export error:', err);
      toast.error('Ошибка экспорта: ' + err.message, { id: toastId });
    } finally {
      setExporting(false);
    }
  };

  // Keyboard shortcuts
  useKeyboardShortcuts({
    'ctrl+n': handleCreateCompany,
    'ctrl+r': handleRefresh,
    'ctrl+e': () => {
      if (!exporting) handleExport();
    },
    'ctrl+f': () => searchInputRef.current?.focus(),
  });

  if (initialLoading) {
    return (
      <Box sx={{ p: 3 }}>
        <LinearProgress />
        <Typography sx={{ mt: 2 }}>Загрузка компаний...</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Компании</Typography>

        <Box display="flex" gap={1}>
          <Button variant="contained" startIcon={<AddIcon />} onClick={handleCreateCompany}>
            Новая компания
          </Button>

          <Tooltip title="Экспорт в CSV (Ctrl+E)">
            <IconButton onClick={handleExport} disabled={exporting}>
              <DownloadIcon />
            </IconButton>
          </Tooltip>

          <Tooltip title="Обновить (Ctrl+R)">
            <IconButton onClick={handleRefresh} disabled={loading}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Metrics Bar */}
      {userProfile?.role === 'superadmin' && (
        <Paper elevation={0} sx={{ p: 1.5, mb: 2, bgcolor: 'background.default' }}>
          <Box display="flex" gap={2}>
            <Chip
              size="small"
              label={`Reads: ${totalFirestoreReads}`}
              color={totalFirestoreReads > 1000 ? 'warning' : 'default'}
            />
            <Chip
              size="small"
              label={`Cost: $${sessionCost.toFixed(4)}`}
              variant="outlined"
            />
            <Chip size="small" label={`Total: ${totalCompanies}`} variant="outlined" />
          </Box>
        </Paper>
      )}

      {/* Filters */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Box display="flex" gap={2} alignItems="center">
          <TextField
            inputRef={searchInputRef}
            value={searchTerm}
            placeholder="Поиск по названию... (Ctrl+F)"
            size="small"
            onChange={handleSearch}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              ),
            }}
            sx={{ flexGrow: 1, maxWidth: 400 }}
          />

          <ToggleButtonGroup
            value={statusFilter}
            exclusive
            onChange={handleStatusFilterChange}
            size="small"
          >
            <ToggleButton value="active">Активные</ToggleButton>
            <ToggleButton value="archived">Архив</ToggleButton>
            <ToggleButton value="all">Все</ToggleButton>
          </ToggleButtonGroup>
        </Box>
      </Paper>

      {/* Error */}
      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Table */}
      <Paper>
        <CompaniesTable
          companies={companies}
          loading={loading}
          onEdit={handleEditCompany}
          onArchive={handleArchiveCompany}
        />

        <TablePagination
          component="div"
          count={totalCompanies}
          page={page}
          onPageChange={handleChangePage}
          rowsPerPage={pageSize}
          rowsPerPageOptions={[pageSize]}
          disabled={loading}
          labelRowsPerPage="Компаний на странице:"
          labelDisplayedRows={({ from, to, count }) => `${from}–${to} из ${count}`}
        />
      </Paper>

      {/* Dialogs */}
      <CompanyFormDialog
        open={formDialogOpen}
        onClose={() => setFormDialogOpen(false)}
        companyToEdit={companyToEdit}
        onSaved={handleRefresh}
      />

      <CostWarningDialog
        open={totalFirestoreReads > 1000 && !warningDismissed}
        currentReads={totalFirestoreReads}
        estimatedCost={sessionCost}
        onClose={() => setWarningDismissed(true)}
        onReset={() => window.location.reload()}
      />
    </Box>
  );
}
