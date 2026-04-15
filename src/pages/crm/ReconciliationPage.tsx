import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Box, Typography, Button, Paper, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow,
  Select, MenuItem, Chip, CircularProgress, Alert,
  ToggleButton, ToggleButtonGroup, Card, CardContent,
  Checkbox, Tooltip, FormControlLabel, Switch,
  TextField, InputAdornment, TablePagination, TableSortLabel,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import UndoIcon from '@mui/icons-material/Undo';
import FilterListIcon from '@mui/icons-material/FilterList';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import SearchIcon from '@mui/icons-material/Search';
import VerifiedIcon from '@mui/icons-material/Verified';
import { db } from '../../firebase/firebase';
import { collection, query, where, getDocs, Timestamp, orderBy, limit, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { errorMessage } from '../../utils/errorMessage';

const COST_CATEGORY_LABELS: Record<string, string> = {
  materials: '🧱 Материалы',
  tools: '🛠️ Инструменты',
  reimbursement: '💷 Возмещение',
  fuel: '⛽ Топливо',
  housing: '🏠 Жилье (Рента)',
  food: '🍔 Питание',
  permit: '📄 Документы',
  other: '📦 Прочее',
};

type QuickFilter = 'all' | 'tampa' | 'company' | 'personal' | 'unassigned' | 'fuel';
type SortField = 'date' | 'amount' | 'cleanMerchant' | 'categoryId';
type SortDir = 'asc' | 'desc';

const FUEL_KEYWORDS = ['TESLA', 'SHELL', 'CHEVRON', 'EXXON', 'MARATHON', 'RACETRAC', 'CIRCLE K', 'WAWA', 'CHARGEPOINT', 'PILOT', 'SUPERCHARGER'];

const isFuelTransaction = (t: { categoryId: string; rawDescription: string }): boolean => {
  if (t.categoryId === 'fuel') return true;
  const upper = (t.rawDescription || '').toUpperCase();
  return FUEL_KEYWORDS.some(kw => upper.includes(kw));
};

const MONTH_LABELS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

const parseLocation = (rawDescription: string): string => {
  if (!rawDescription) return '';
  const upper = rawDescription.toUpperCase();
  const knownCities = [
    'TAMPA', 'WESLEY CHAPEL', 'ZEPHYRHILLS', 'BRANDON', 'RIVERVIEW',
    'LAKELAND', 'CLEARWATER', 'ST PETERSBURG', 'SARASOTA', 'ORLANDO',
    'MIAMI', 'FORT LAUDERDALE', 'HOLLYWOOD', 'POMPANO BEACH', 'BOCA RATON',
    'WEST PALM BEACH', 'JACKSONVILLE', 'GAINESVILLE', 'TALLAHASSEE',
    'LEXINGTON', 'DEERFIELD BEACH', 'PLANTATION', 'DAVIE', 'SUNRISE',
    'CORAL SPRINGS', 'MARGATE', 'COCONUT CREEK', 'BOYNTON BEACH',
    'DELRAY BEACH', 'LAKE WORTH', 'PALM BEACH', 'NAPLES', 'CAPE CORAL',
    'FORT MYERS', 'PORT CHARLOTTE', 'KISSIMMEE', 'DAYTONA BEACH',
    'NEW YORK', 'CHICAGO', 'HOUSTON', 'ATLANTA', 'LUTZ', 'LAND O LAKES',
    'NEW PORT RICHEY', 'SPRING HILL', 'BROOKSVILLE', 'DADE CITY',
    'PLANT CITY', 'VALRICO', 'SEFFNER', 'TEMPLE TERRACE', 'ODESSA',
    'FERN PARK', 'HALLANDALE', 'MIRAMAR', 'HIALEAH', 'HOMESTEAD',
  ];
  for (const city of knownCities) {
    if (upper.includes(city)) return city.charAt(0) + city.slice(1).toLowerCase();
  }
  const stateMatch = upper.match(/\b([A-Z][A-Z\s]+?)\s+[A-Z]{2}\s*\d{0,5}\s*$/);
  if (stateMatch) {
    const candidate = stateMatch[1].trim();
    if (candidate.length >= 3 && candidate.length <= 25) {
      return candidate.charAt(0) + candidate.slice(1).toLowerCase();
    }
  }
  return '';
};

const isTampaArea = (location: string): boolean => {
  const tampaAreaCities = [
    'tampa', 'wesley chapel', 'zephyrhills', 'brandon', 'riverview',
    'lutz', 'land o lakes', 'new port richey', 'plant city',
    'valrico', 'seffner', 'temple terrace', 'odessa', 'spring hill',
    'lakeland', 'dade city',
  ];
  return tampaAreaCities.includes(location.toLowerCase());
};

interface ReconcileTx {
  id: string;
  date: string | Timestamp;
  rawDescription: string;
  cleanMerchant: string;
  amount: number;
  paymentType: 'company' | 'cash';
  categoryId: string;
  projectId: string | null;
  confidence: 'high' | 'low';
  status: 'draft' | 'approved' | 'ignored';
  verifiedBy?: string | null;
  verifiedAt?: Timestamp | null;
}

// ─── Helpers ────────────────────────────────────────────────

/** Parse any date-like value to a JS Date */
const toDate = (d: string | Timestamp | Date | null | undefined): Date | null => {
  if (!d) return null;
  if (typeof d === 'string') return new Date(d);
  if (d instanceof Date) return d;
  if (typeof (d as Timestamp).toDate === 'function') return (d as Timestamp).toDate();
  return null;
};

const renderDate = (d: string | Timestamp | Date | null | undefined) => {
  const date = toDate(d);
  return date ? date.toLocaleDateString() : '';
};

const normalizeDate = (d: string | Timestamp | Date | null | undefined): string => {
  const date = toDate(d);
  return date ? date.toISOString() : new Date().toISOString();
};

const getMonthKey = (d: string | Timestamp | Date | null | undefined): string => {
  const date = toDate(d);
  if (!date || isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

const fmtDollar = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toFixed(1).replace(/\.0$/, '')}K` : `$${n.toFixed(0)}`;

// ─── Component ──────────────────────────────────────────────

const ReconciliationPage: React.FC = () => {
  // Data
  const [view, setView] = useState<'draft' | 'approved'>('draft');
  const [transactions, setTransactions] = useState<ReconcileTx[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Filters
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [filterMonth, setFilterMonth] = useState<string>('all');
  const [hideReturns, setHideReturns] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Table state
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ─── Data Fetching ──────────────────────────────────────

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const fetchData = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const txQuery = view === 'draft'
        ? query(collection(db, 'bank_transactions'), where('status', '==', 'draft'))
        : query(collection(db, 'bank_transactions'), where('status', '==', 'approved'), orderBy('updatedAt', 'desc'), limit(50));
      const txSnap = await getDocs(txQuery);
      setTransactions(txSnap.docs.map(d => ({ id: d.id, ...d.data() } as ReconcileTx)));

      const prjSnap = await getDocs(query(collection(db, 'projects'), where('status', '==', 'active')));
      setProjects(prjSnap.docs.map(d => ({ id: d.id, name: d.data().name || d.id })));
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

  // ─── Mutations ──────────────────────────────────────────

  const handleUpdate = (id: string, field: keyof ReconcileTx, value: unknown) => {
    setTransactions(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t));
  };

  const handleSplit = (id: string) => {
    setTransactions(prev => {
      const idx = prev.findIndex(t => t.id === id);
      if (idx === -1) return prev;
      const original = prev[idx];
      const half = parseFloat((original.amount / 2).toFixed(2));
      const newTxs = [...prev];
      newTxs.splice(idx, 1,
        { ...original, id: `${original.id}_splitA`, amount: half },
        { ...original, id: `${original.id}_splitB`, amount: half },
      );
      return newTxs;
    });
  };

  const getApiUrl = () => import.meta.env.VITE_FIREBASE_FUNCTIONS_URL || 'https://us-central1-profit-step.cloudfunctions.net/agentApi';

  const prepareForApi = (txs: ReconcileTx[]) =>
    txs.map(t => ({
      id: t.id.replace(/_split[AB]$/, ''),
      date: normalizeDate(t.date),
      rawDescription: t.rawDescription || '',
      cleanMerchant: t.cleanMerchant || '',
      amount: t.amount,
      paymentType: t.paymentType || 'cash',
      categoryId: t.categoryId || 'other',
      projectId: t.projectId || null,
      confidence: t.confidence || 'low',
    }));

  const getAuthToken = async () => {
    const token = await getAuth().currentUser?.getIdToken();
    if (!token) throw new Error("Вы не авторизованы. Перезайдите.");
    return token;
  };

  const handleApproveAll = async () => {
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const token = await getAuthToken();
      const resp = await fetch(`${getApiUrl()}/api/finance/transactions/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ transactions: prepareForApi(filteredTransactions) }),
      });
      if (!resp.ok) throw new Error(`API ${resp.status}: ${await resp.text()}`);
      await fetchData();
    } catch (e) {
      setErrorMsg("Ошибка: " + (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleApproveSelected = async () => {
    if (selectedIds.size === 0) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const token = await getAuthToken();
      const selected = filteredTransactions.filter(t => selectedIds.has(t.id));
      const resp = await fetch(`${getApiUrl()}/api/finance/transactions/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ transactions: prepareForApi(selected) }),
      });
      if (!resp.ok) throw new Error(`API ${resp.status}: ${await resp.text()}`);
      setSelectedIds(new Set());
      await fetchData();
    } catch (e) {
      setErrorMsg("Ошибка: " + (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleApproveTampa = async () => {
    const tampaList = enrichedTransactions.filter(t => isTampaArea(t._location) && t.status === 'draft');
    if (tampaList.length === 0) return alert('Нет Tampa транзакций');
    if (!window.confirm(`Утвердить ${tampaList.length} Tampa транзакций?`)) return;
    setSubmitting(true);
    try {
      const token = await getAuthToken();
      const resp = await fetch(`${getApiUrl()}/api/finance/transactions/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ transactions: prepareForApi(tampaList) }),
      });
      if (!resp.ok) throw new Error(`API ${resp.status}: ${await resp.text()}`);
      await fetchData();
    } catch (e) {
      setErrorMsg("Ошибка Tampa: " + (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUndo = async (transactionId: string) => {
    if (!window.confirm('Отменить утверждение и удалить cost?')) return;
    setSubmitting(true);
    try {
      const token = await getAuthToken();
      const resp = await fetch(`${getApiUrl()}/api/finance/transactions/undo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ transactionIds: [transactionId] }),
      });
      if (!resp.ok) throw new Error(`API Error: ${resp.status}`);
      await fetchData();
    } catch (e) {
      alert("Ошибка: " + (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerify = useCallback(async (transactionId: string, currentlyVerified: boolean) => {
    try {
      const user = getAuth().currentUser;
      if (!user) return;
      const txRef = doc(db, 'bank_transactions', transactionId);
      if (currentlyVerified) {
        await updateDoc(txRef, { verifiedBy: null, verifiedAt: null });
        setTransactions(prev => prev.map(t =>
          t.id === transactionId ? { ...t, verifiedBy: null, verifiedAt: null } : t
        ));
      } else {
        const name = user.displayName || user.email || user.uid;
        await updateDoc(txRef, { verifiedBy: name, verifiedAt: serverTimestamp() });
        setTransactions(prev => prev.map(t =>
          t.id === transactionId ? { ...t, verifiedBy: name, verifiedAt: Timestamp.now() } : t
        ));
      }
    } catch (e) {
      console.error('Verify failed', e);
    }
  }, []);

  // ─── Bulk Category/Type Change ──────────────────────────

  const handleBulkUpdate = (field: 'categoryId' | 'paymentType', value: string) => {
    setTransactions(prev => prev.map(t =>
      selectedIds.has(t.id) ? { ...t, [field]: value } : t
    ));
  };

  // ─── Selection ──────────────────────────────────────────

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const pageIds = paginatedTransactions.map(t => t.id);
    const allSelected = pageIds.every(id => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds(prev => { const next = new Set(prev); pageIds.forEach(id => next.delete(id)); return next; });
    } else {
      setSelectedIds(prev => { const next = new Set(prev); pageIds.forEach(id => next.add(id)); return next; });
    }
  };

  // ─── Computed Data ──────────────────────────────────────

  const enrichedTransactions = useMemo(() =>
    transactions.map(t => ({ ...t, _location: parseLocation(t.rawDescription) })),
    [transactions]
  );

  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    enrichedTransactions.forEach(t => { const mk = getMonthKey(t.date); if (mk) months.add(mk); });
    return Array.from(months).sort().toReversed();
  }, [enrichedTransactions]);

  const filterStats = useMemo(() => {
    const calc = (list: typeof enrichedTransactions) => ({ count: list.length, sum: fmtDollar(list.reduce((s, t) => s + Math.abs(t.amount), 0)) });
    return {
      tampa: calc(enrichedTransactions.filter(t => isTampaArea(t._location))),
      company: calc(enrichedTransactions.filter(t => t.paymentType === 'company')),
      personal: calc(enrichedTransactions.filter(t => t.paymentType !== 'company')),
      fuel: calc(enrichedTransactions.filter(t => isFuelTransaction(t))),
      unassigned: calc(enrichedTransactions.filter(t => !t.projectId && !t.paymentType)),
    };
  }, [enrichedTransactions]);

  const filteredTransactions = useMemo(() => {
    let result = enrichedTransactions;

    // Month filter
    if (filterMonth !== 'all') result = result.filter(t => getMonthKey(t.date) === filterMonth);

    // Hide returns
    if (hideReturns) result = result.filter(t => t.amount <= 0);

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(t =>
        (t.rawDescription || '').toLowerCase().includes(q) ||
        (t.cleanMerchant || '').toLowerCase().includes(q) ||
        (t._location || '').toLowerCase().includes(q)
      );
    }

    // Quick filter
    if (quickFilter === 'tampa') result = result.filter(t => isTampaArea(t._location));
    else if (quickFilter === 'company') result = result.filter(t => t.paymentType === 'company');
    else if (quickFilter === 'personal') result = result.filter(t => t.paymentType !== 'company');
    else if (quickFilter === 'fuel') result = result.filter(t => isFuelTransaction(t));
    else if (quickFilter === 'unassigned') result = result.filter(t => !t.projectId && !t.paymentType);

    // Sort
    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'amount') {
        cmp = Math.abs(a.amount) - Math.abs(b.amount);
      } else if (sortField === 'date') {
        cmp = (toDate(a.date)?.getTime() || 0) - (toDate(b.date)?.getTime() || 0);
      } else if (sortField === 'cleanMerchant') {
        cmp = (a.cleanMerchant || '').localeCompare(b.cleanMerchant || '');
      } else if (sortField === 'categoryId') {
        cmp = (a.categoryId || '').localeCompare(b.categoryId || '');
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });

    return result;
  }, [enrichedTransactions, quickFilter, filterMonth, hideReturns, searchQuery, sortField, sortDir]);

  // Summary from FILTERED data (reacts to filters)
  const summaryData = useMemo(() => {
    const src = filteredTransactions;
    const tampa = src.filter(t => isTampaArea(t._location)).reduce((s, t) => s + Math.abs(t.amount), 0);
    const company = src.filter(t => t.paymentType === 'company').reduce((s, t) => s + Math.abs(t.amount), 0);
    const personal = src.filter(t => t.paymentType !== 'company').reduce((s, t) => s + Math.abs(t.amount), 0);
    const total = src.reduce((s, t) => s + Math.abs(t.amount), 0);
    return { tampa, company, personal, total };
  }, [filteredTransactions]);

  // Pagination
  const paginatedTransactions = useMemo(() =>
    filteredTransactions.slice(page * rowsPerPage, (page + 1) * rowsPerPage),
    [filteredTransactions, page, rowsPerPage]
  );

  // Reset page when filter changes
  useEffect(() => { setPage(0); }, [quickFilter, filterMonth, hideReturns, searchQuery]);

  // ─── Column Sort ────────────────────────────────────────

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  // ─── CSV Export ─────────────────────────────────────────

  const handleExportCSV = useCallback(() => {
    const BOM = '\uFEFF';
    const headers = ['Date', 'Merchant', 'Raw Description', 'Location', 'Amount', 'Type', 'Category', 'Project'];
    const rows = filteredTransactions.map(t => [
      renderDate(t.date),
      t.cleanMerchant || '',
      `"${(t.rawDescription || '').replace(/"/g, '""')}"`,
      (t as unknown as { _location?: string })._location || '',
      Math.abs(t.amount).toFixed(2),
      t.paymentType === 'company' ? 'Company' : 'Personal',
      COST_CATEGORY_LABELS[t.categoryId] || t.categoryId,
      projects.find(p => p.id === t.projectId)?.name || '',
    ]);
    const csv = BOM + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reconciliation-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filteredTransactions, projects]);

  // ─── PDF Export ─────────────────────────────────────────

  const handleExportPDF = useCallback(async () => {
    const { default: jsPDF } = await import('jspdf');
    await import('jspdf-autotable');
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const now = new Date();
    pdf.setFontSize(16);
    pdf.text(`Reconciliation Report — ${now.toLocaleDateString('ru-RU')}`, 14, 15);
    pdf.setFontSize(9);
    const filterInfo: string[] = [];
    if (view !== 'draft') filterInfo.push(`View: ${view}`);
    if (filterMonth !== 'all') filterInfo.push(`Month: ${filterMonth}`);
    if (quickFilter !== 'all') filterInfo.push(`Filter: ${quickFilter}`);
    if (searchQuery) filterInfo.push(`Search: ${searchQuery}`);
    if (hideReturns) filterInfo.push('Returns hidden');
    if (filterInfo.length > 0) pdf.text(`Filters: ${filterInfo.join(' | ')}`, 14, 22);

    const tableData = filteredTransactions.map(t => [
      renderDate(t.date),
      t.cleanMerchant || '',
      (t as unknown as { _location?: string })._location || '',
      `$${Math.abs(t.amount).toFixed(2)}${t.amount > 0 ? ' (ret)' : ''}`,
      t.paymentType === 'company' ? 'Company' : 'Personal',
      COST_CATEGORY_LABELS[t.categoryId] || t.categoryId,
      projects.find(p => p.id === t.projectId)?.name || '',
      t.verifiedBy ? '✓' : '',
    ]);
    type PdfExt = { autoTable: (o: Record<string, unknown>) => void; lastAutoTable?: { finalY?: number } };
    const ext = pdf as unknown as PdfExt;
    ext.autoTable({
      head: [['Date', 'Merchant', 'Location', 'Amount', 'Type', 'Category', 'Project', '✓']],
      body: tableData,
      startY: filterInfo.length > 0 ? 26 : 20,
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [59, 130, 246], fontSize: 8 },
    });
    const finalY = ext.lastAutoTable?.finalY || 200;
    const total = filteredTransactions.reduce((s, t) => s + Math.abs(t.amount), 0);
    pdf.setFontSize(10);
    pdf.text(`Total: $${total.toLocaleString('en-US', { minimumFractionDigits: 2 })} | Count: ${filteredTransactions.length}`, 14, finalY + 8);
    pdf.save(`reconciliation-${now.toISOString().slice(0, 10)}.pdf`);
  }, [filteredTransactions, view, filterMonth, quickFilter, hideReturns, searchQuery, projects]);

  // ─── Render ─────────────────────────────────────────────

  if (loading) return <Box p={4} textAlign="center"><CircularProgress /></Box>;

  const draftTotal = filteredTransactions.length;
  const draftHighConf = filteredTransactions.filter(t => t.confidence === 'high').length;
  const draftLowConf = draftTotal - draftHighConf;
  const autopilotPercent = draftTotal > 0 ? Math.round((draftHighConf / draftTotal) * 100) : 0;
  const fmtCard = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const tampaCount = enrichedTransactions.filter(t => isTampaArea(t._location) && t.status === 'draft').length;

  return (
    <Box p={3} sx={{ maxWidth: 1500, mx: 'auto' }}>
      {/* ─── Header ─── */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={2}>
        <Box display="flex" alignItems="center" gap={2}>
          <Typography variant="h4" fontWeight="bold">Reconciliation Hub</Typography>
          <Select size="small" value={view} onChange={e => { setView(e.target.value as 'draft' | 'approved'); setSelectedIds(new Set()); }} sx={{ minWidth: 200, bgcolor: 'white' }}>
            <MenuItem value="draft">⏳ Черновики (Draft)</MenuItem>
            <MenuItem value="approved">✅ Утвержденные</MenuItem>
          </Select>
        </Box>
        <Box display="flex" alignItems="center" gap={1}>
          <Button size="small" variant="outlined" startIcon={<FileDownloadIcon />} onClick={handleExportCSV} disabled={!filteredTransactions.length}>
            CSV
          </Button>
          <Button size="small" variant="outlined" startIcon={<PictureAsPdfIcon />} onClick={handleExportPDF} disabled={!filteredTransactions.length}>
            PDF
          </Button>
          <Typography variant="body2" color="text.secondary" sx={{ mx: 1 }}>
            {filteredTransactions.length} из {enrichedTransactions.length}
          </Typography>
          {view === 'draft' && (
            <>
              <Button variant="outlined" color="warning" size="small" disabled={!tampaCount || submitting} onClick={handleApproveTampa}>
                ✅ Tampa ({tampaCount})
              </Button>
              <Button variant="contained" color="success" size="medium" disabled={!filteredTransactions.length || submitting} onClick={handleApproveAll}>
                {submitting ? 'Сохранение...' : 'Утвердить всё'}
              </Button>
            </>
          )}
        </Box>
      </Box>

      {/* ─── Summary Cards (clickable, react to filters) ─── */}
      {enrichedTransactions.length > 0 && (
        <Box display="flex" gap={1.5} mb={2} flexWrap="wrap">
          {([
            { key: 'tampa' as QuickFilter, label: '🏗️ Tampa', value: summaryData.tampa, bg: '#fff3e0', border: '#ffe0b2', color: 'warning.dark' },
            { key: 'company' as QuickFilter, label: '🏢 Company', value: summaryData.company, bg: '#e3f2fd', border: '#bbdefb', color: 'primary.dark' },
            { key: 'personal' as QuickFilter, label: '👤 Personal', value: summaryData.personal, bg: '#fce4ec', border: '#f8bbd0', color: 'error.dark' },
          ]).map(c => (
            <Card
              key={c.key}
              onClick={() => setQuickFilter(quickFilter === c.key ? 'all' : c.key)}
              sx={{
                minWidth: 130, cursor: 'pointer', transition: 'all 0.15s',
                bgcolor: c.bg,
                border: quickFilter === c.key ? `2px solid ${c.border}` : `1px solid ${c.border}`,
                boxShadow: quickFilter === c.key ? 3 : 0,
                transform: quickFilter === c.key ? 'scale(1.03)' : 'none',
                '&:hover': { boxShadow: 2 },
              }}
              elevation={0}
            >
              <CardContent sx={{ py: 1, px: 2, '&:last-child': { pb: 1 } }}>
                <Typography variant="caption" color="text.secondary">{c.label}</Typography>
                <Typography variant="h6" fontWeight="bold" color={c.color}>{fmtCard(c.value)}</Typography>
              </CardContent>
            </Card>
          ))}
          <Card sx={{ minWidth: 130, bgcolor: '#f5f5f5', border: '1px solid #e0e0e0' }} elevation={0}>
            <CardContent sx={{ py: 1, px: 2, '&:last-child': { pb: 1 } }}>
              <Typography variant="caption" color="text.secondary">📊 Total</Typography>
              <Typography variant="h6" fontWeight="bold">{fmtCard(summaryData.total)}</Typography>
            </CardContent>
          </Card>
        </Box>
      )}

      {/* ─── Filters Row ─── */}
      {enrichedTransactions.length > 0 && (
        <Box mb={2} display="flex" alignItems="center" gap={1.5} flexWrap="wrap">
          {/* Search */}
          <TextField
            size="small"
            placeholder="Поиск по контрагенту..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
            sx={{ width: 220, bgcolor: 'white' }}
          />

          {/* Month */}
          <Box display="flex" alignItems="center" gap={0.5}>
            <CalendarMonthIcon color="action" fontSize="small" />
            <Select size="small" value={filterMonth} onChange={e => setFilterMonth(e.target.value)} sx={{ minWidth: 170, bgcolor: 'white' }}>
              <MenuItem value="all">Все месяцы ({enrichedTransactions.length})</MenuItem>
              {availableMonths.map(mk => {
                const [y, m] = mk.split('-');
                const count = enrichedTransactions.filter(t => getMonthKey(t.date) === mk).length;
                return <MenuItem key={mk} value={mk}>{MONTH_LABELS[parseInt(m, 10) - 1]} {y} ({count})</MenuItem>;
              })}
            </Select>
          </Box>

          {/* Hide Returns */}
          <FormControlLabel
            control={<Switch size="small" checked={hideReturns} onChange={e => setHideReturns(e.target.checked)} />}
            label="Скрыть возвраты"
          />

          {/* Quick Filters — scrollable */}
          {view === 'draft' && (
            <Box display="flex" alignItems="center" gap={0.5} sx={{ overflowX: 'auto', flexShrink: 0 }}>
              <FilterListIcon color="action" fontSize="small" />
              <ToggleButtonGroup size="small" value={quickFilter} exclusive onChange={(_, v) => v && setQuickFilter(v)}>
                <ToggleButton value="all">All ({enrichedTransactions.length})</ToggleButton>
                <ToggleButton value="tampa">🏗️ Tampa ({filterStats.tampa.count})</ToggleButton>
                <ToggleButton value="company">🏢 Комп. ({filterStats.company.count})</ToggleButton>
                <ToggleButton value="personal">👤 Личн. ({filterStats.personal.count})</ToggleButton>
                <ToggleButton value="fuel">⛽ Топливо ({filterStats.fuel.count})</ToggleButton>
                <ToggleButton value="unassigned">❓ Без кат. ({filterStats.unassigned.count})</ToggleButton>
              </ToggleButtonGroup>
            </Box>
          )}
        </Box>
      )}

      {/* ─── Bulk Action Toolbar ─── */}
      {selectedIds.size > 0 && view === 'draft' && (
        <Paper sx={{ p: 1.5, mb: 2, display: 'flex', alignItems: 'center', gap: 2, bgcolor: '#e3f2fd', border: '1px solid #90caf9', borderRadius: 2 }} elevation={0}>
          <Typography variant="body2" fontWeight="bold">Выбрано: {selectedIds.size}</Typography>
          <Select size="small" displayEmpty value="" onChange={e => { if (e.target.value) handleBulkUpdate('categoryId', e.target.value); }} sx={{ minWidth: 150, bgcolor: 'white' }}>
            <MenuItem value="" disabled><em>Категория...</em></MenuItem>
            {Object.keys(COST_CATEGORY_LABELS).map(c => <MenuItem key={c} value={c}>{COST_CATEGORY_LABELS[c]}</MenuItem>)}
          </Select>
          <Select size="small" displayEmpty value="" onChange={e => { if (e.target.value) handleBulkUpdate('paymentType', e.target.value); }} sx={{ minWidth: 140, bgcolor: 'white' }}>
            <MenuItem value="" disabled><em>Тип...</em></MenuItem>
            <MenuItem value="company">🏢 Компания</MenuItem>
            <MenuItem value="cash">💵 Личные</MenuItem>
          </Select>
          <Button size="small" variant="contained" color="success" onClick={handleApproveSelected} disabled={submitting}>
            ✅ Утвердить ({selectedIds.size})
          </Button>
          <Button size="small" variant="text" onClick={() => setSelectedIds(new Set())}>Сбросить</Button>
        </Paper>
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
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              {view === 'draft' && (
                <TableCell padding="checkbox">
                  <Checkbox
                    size="small"
                    indeterminate={selectedIds.size > 0 && !paginatedTransactions.every(t => selectedIds.has(t.id))}
                    checked={paginatedTransactions.length > 0 && paginatedTransactions.every(t => selectedIds.has(t.id))}
                    onChange={toggleSelectAll}
                  />
                </TableCell>
              )}
              <TableCell><strong>Статус</strong></TableCell>
              <TableCell>
                <TableSortLabel active={sortField === 'date'} direction={sortField === 'date' ? sortDir : 'desc'} onClick={() => handleSort('date')}>
                  <strong>Дата</strong>
                </TableSortLabel>
              </TableCell>
              <TableCell><strong>Из Банка</strong></TableCell>
              <TableCell>
                <TableSortLabel active={sortField === 'cleanMerchant'} direction={sortField === 'cleanMerchant' ? sortDir : 'asc'} onClick={() => handleSort('cleanMerchant')}>
                  <strong>Контрагент</strong>
                </TableSortLabel>
              </TableCell>
              <TableCell><strong>Локация</strong></TableCell>
              <TableCell>
                <TableSortLabel active={sortField === 'amount'} direction={sortField === 'amount' ? sortDir : 'desc'} onClick={() => handleSort('amount')}>
                  <strong>Сумма</strong>
                </TableSortLabel>
              </TableCell>
              <TableCell><strong>Тип</strong></TableCell>
              <TableCell>
                <TableSortLabel active={sortField === 'categoryId'} direction={sortField === 'categoryId' ? sortDir : 'asc'} onClick={() => handleSort('categoryId')}>
                  <strong>Категория</strong>
                </TableSortLabel>
              </TableCell>
              <TableCell><strong>Проект</strong></TableCell>
              <TableCell align="center"><strong>✓</strong></TableCell>
              <TableCell align="right"><strong>Действия</strong></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedTransactions.map(t => {
              const isLow = view === 'draft' && t.confidence === 'low';
              const loc = t._location;
              const isTampa = isTampaArea(loc);
              const bg = isLow ? '#fefce8' : isTampa ? '#fff8e1' : '#fff';

              return (
                <TableRow key={t.id} sx={{ backgroundColor: bg }} hover>
                  {view === 'draft' && (
                    <TableCell padding="checkbox">
                      <Checkbox size="small" checked={selectedIds.has(t.id)} onChange={() => toggleSelect(t.id)} />
                    </TableCell>
                  )}
                  <TableCell>
                    {view === 'draft' ? (
                      isLow
                        ? <Chip icon={<WarningAmberIcon />} label="LLM" color="warning" size="small" variant="outlined" />
                        : <Chip icon={<CheckCircleIcon />} label="Правило" color="success" size="small" variant="outlined" />
                    ) : (
                      <Chip icon={<CheckCircleIcon />} label="OK" color="primary" size="small" variant="outlined" />
                    )}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{renderDate(t.date)}</TableCell>
                  <TableCell sx={{ fontSize: '0.78rem', color: 'text.secondary', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.rawDescription}
                  </TableCell>
                  <TableCell sx={{ fontWeight: 'bold', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.cleanMerchant}
                  </TableCell>
                  <TableCell>
                    {loc ? (
                      <Chip label={loc} size="small" color={isTampa ? 'warning' : 'default'} variant={isTampa ? 'filled' : 'outlined'} sx={{ fontSize: '0.73rem' }} />
                    ) : (
                      <Typography variant="caption" color="text.disabled">—</Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {view === 'draft' ? (
                      <TextField
                        size="small"
                        type="number"
                        value={t.amount}
                        onChange={e => handleUpdate(t.id, 'amount', parseFloat(e.target.value) || 0)}
                        slotProps={{ input: { startAdornment: <InputAdornment position="start">$</InputAdornment>, style: { textAlign: 'right' } } }}
                        sx={{ width: 100 }}
                      />
                    ) : (
                      <Typography fontWeight="bold" color={t.amount < 0 ? 'error.main' : 'success.main'}>
                        ${Math.abs(t.amount).toFixed(2)}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Select size="small" value={t.paymentType || 'cash'} onChange={e => handleUpdate(t.id, 'paymentType', e.target.value)} sx={{ minWidth: 120, bgcolor: 'white' }} disabled={view === 'approved'}>
                      <MenuItem value="company">🏢 Комп.</MenuItem>
                      <MenuItem value="cash">💵 Личн.</MenuItem>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Select size="small" value={t.categoryId || 'other'} onChange={e => handleUpdate(t.id, 'categoryId', e.target.value)} sx={{ minWidth: 140, bgcolor: 'white' }} disabled={view === 'approved'}>
                      {Object.keys(COST_CATEGORY_LABELS).map(c => (
                        <MenuItem key={c} value={c}>{COST_CATEGORY_LABELS[c]}</MenuItem>
                      ))}
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Select size="small" value={t.projectId || ''} onChange={e => handleUpdate(t.id, 'projectId', e.target.value)} disabled={t.paymentType !== 'company' || view === 'approved'} displayEmpty sx={{ minWidth: 150, bgcolor: 'white' }}>
                      <MenuItem value=""><em>—</em></MenuItem>
                      {projects.map(p => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
                    </Select>
                  </TableCell>
                  <TableCell align="center">
                    {view === 'approved' && (
                      <Tooltip title={t.verifiedBy ? `Проверил: ${t.verifiedBy}` : 'Отметить'}>
                        <Checkbox size="small" checked={!!t.verifiedBy} onChange={() => handleVerify(t.id, !!t.verifiedBy)} icon={<VerifiedIcon color="disabled" />} checkedIcon={<VerifiedIcon color="success" />} />
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {view === 'approved' ? (
                      <Button variant="outlined" color="error" size="small" startIcon={<UndoIcon />} onClick={() => handleUndo(t.id)} disabled={submitting}>
                        Undo
                      </Button>
                    ) : (
                      <Button variant="outlined" size="small" onClick={() => handleSplit(t.id)} disabled={submitting} sx={{ minWidth: 'auto' }}>
                        ✂️
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {paginatedTransactions.length === 0 && (
              <TableRow>
                <TableCell colSpan={12} align="center" sx={{ py: 6 }}>
                  <Typography variant="h6" color="text.secondary">
                    {searchQuery ? `Ничего не найдено по "${searchQuery}"` : view === 'draft' ? "🎉 Нет выписок для сверки." : "Список пуст."}
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
        count={filteredTransactions.length}
        page={page}
        onPageChange={(_, p) => setPage(p)}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={e => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
        rowsPerPageOptions={[25, 50, 100]}
        labelRowsPerPage="Строк:"
        labelDisplayedRows={({ from, to, count }) => `${from}–${to} из ${count}`}
      />
    </Box>
  );
};

export default ReconciliationPage;
