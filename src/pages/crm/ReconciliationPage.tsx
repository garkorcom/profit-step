import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Box, Typography, Button, Paper, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow,
  Select, MenuItem, Chip, CircularProgress, Alert,
  ToggleButton, ToggleButtonGroup, Card, CardContent,
  Checkbox, Tooltip, IconButton,
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
import SettingsIcon from '@mui/icons-material/Settings';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import ChatBubbleIcon from '@mui/icons-material/ChatBubble';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import RestoreIcon from '@mui/icons-material/Restore';
import AutoApproveRulesDialog from '../../components/crm/AutoApproveRulesDialog';
import CategoryChipPicker from '../../components/crm/CategoryChipPicker';
import TransactionNoteDrawer from '../../components/crm/TransactionNoteDrawer';
import ExpenseAnalyticsPanel from '../../components/crm/ExpenseAnalyticsPanel';
import { db } from '../../firebase/firebase';
import { collection, query, where, getDocs, Timestamp, orderBy, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { errorMessage } from '../../utils/errorMessage';
import { useAuth } from '../../auth/AuthContext';

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
    // Tampa + 100mi (match TAMPA_100MI_CITIES)
    'TAMPA', 'WESLEY CHAPEL', 'ZEPHYRHILLS', 'BRANDON', 'RIVERVIEW',
    'LUTZ', 'LAND O LAKES', 'NEW PORT RICHEY', 'PLANT CITY',
    'VALRICO', 'SEFFNER', 'TEMPLE TERRACE', 'ODESSA', 'SPRING HILL',
    'LAKELAND', 'DADE CITY', 'BROOKSVILLE',
    'ST PETERSBURG', 'CLEARWATER', 'LARGO', 'PINELLAS PARK', 'DUNEDIN',
    'TARPON SPRINGS', 'PALM HARBOR', 'SAFETY HARBOR', 'SEMINOLE',
    'SARASOTA', 'BRADENTON', 'PALMETTO', 'VENICE', 'NORTH PORT', 'ENGLEWOOD',
    'ELLENTON', 'PARRISH', 'OSPREY', 'NOKOMIS',
    'WINTER HAVEN', 'BARTOW', 'AUBURNDALE', 'HAINES CITY', 'LAKE WALES',
    'POLK CITY', 'MULBERRY', 'DAVENPORT',
    'HUDSON', 'PORT RICHEY', 'CRYSTAL RIVER', 'INVERNESS',
    'ORLANDO', 'KISSIMMEE', 'SANFORD', 'WINTER PARK', 'ALTAMONTE SPRINGS',
    'CASSELBERRY', 'OVIEDO', 'APOPKA', 'CLERMONT', 'LEESBURG',
    'MOUNT DORA', 'OCALA', 'ST CLOUD', 'WINTER GARDEN', 'CELEBRATION',
    'PORT CHARLOTTE', 'PUNTA GORDA', 'CAPE CORAL', 'FORT MYERS',
    'LEHIGH ACRES', 'BONITA SPRINGS', 'ESTERO',
    'DAYTONA BEACH', 'DELAND', 'DELTONA', 'NEW SMYRNA BEACH', 'ORMOND BEACH',
    'FERN PARK',
    // South FL + other states
    'MIAMI', 'FORT LAUDERDALE', 'HOLLYWOOD', 'POMPANO BEACH', 'BOCA RATON',
    'WEST PALM BEACH', 'JACKSONVILLE', 'GAINESVILLE', 'TALLAHASSEE',
    'NAPLES', 'HALLANDALE', 'MIRAMAR', 'HIALEAH', 'HOMESTEAD',
    'DEERFIELD BEACH', 'PLANTATION', 'DAVIE', 'SUNRISE',
    'CORAL SPRINGS', 'MARGATE', 'COCONUT CREEK', 'BOYNTON BEACH',
    'DELRAY BEACH', 'LAKE WORTH', 'PALM BEACH',
    'NEW YORK', 'CHICAGO', 'HOUSTON', 'ATLANTA', 'LEXINGTON',
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

/** Tampa + ~100 mile radius — all FL cities within driving distance */
const TAMPA_100MI_CITIES = [
  // Tampa metro core
  'tampa', 'wesley chapel', 'zephyrhills', 'brandon', 'riverview',
  'lutz', 'land o lakes', 'new port richey', 'plant city',
  'valrico', 'seffner', 'temple terrace', 'odessa', 'spring hill',
  'lakeland', 'dade city', 'brooksville',
  // Pinellas (St Pete / Clearwater)
  'st petersburg', 'clearwater', 'largo', 'pinellas park', 'dunedin',
  'tarpon springs', 'palm harbor', 'safety harbor', 'seminole', 'treasure island',
  'indian rocks beach', 'madeira beach', 'st pete beach',
  // Sarasota / Manatee
  'sarasota', 'bradenton', 'palmetto', 'venice', 'north port', 'englewood',
  'ellenton', 'parrish', 'longboat key', 'siesta key', 'osprey', 'nokomis',
  // Polk county
  'winter haven', 'bartow', 'auburndale', 'haines city', 'lake wales',
  'polk city', 'mulberry', 'eagle lake', 'lake alfred', 'davenport',
  // Pasco / Hernando / Citrus
  'hudson', 'port richey', 'holiday', 'crystal river', 'inverness',
  'homosassa', 'weeki wachee', 'san antonio',
  // Orlando metro (~85mi)
  'orlando', 'kissimmee', 'sanford', 'winter park', 'altamonte springs',
  'casselberry', 'oviedo', 'apopka', 'clermont', 'leesburg',
  'mount dora', 'tavares', 'eustis', 'ocala', 'the villages',
  'celebration', 'st cloud', 'windermere', 'winter garden',
  // Charlotte / Lee (borderline 100mi)
  'port charlotte', 'punta gorda', 'cape coral', 'fort myers',
  'lehigh acres', 'bonita springs', 'estero',
  // Volusia (Daytona, ~120mi but common for FL business)
  'daytona beach', 'deland', 'deltona', 'new smyrna beach', 'ormond beach',
  'fern park',
];

const isTampaArea = (location: string): boolean =>
  TAMPA_100MI_CITIES.includes(location.toLowerCase());

interface ReconcileTx {
  id: string;
  date: string | Timestamp;
  rawDescription: string;
  cleanMerchant: string;
  amount: number;
  paymentType: 'company' | 'cash';
  categoryId: string;
  projectId: string | null;
  employeeId?: string | null;
  employeeName?: string | null;
  note?: string;
  confidence: 'high' | 'low';
  status: 'draft' | 'approved' | 'ignored';
  verifiedBy?: string | null;
  verifiedAt?: Timestamp | null;
}

interface EmployeeOption {
  id: string;
  name: string;
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
  const { userProfile } = useAuth();

  // Data
  const [view, setView] = useState<'draft' | 'approved' | 'ignored'>('draft');
  const [transactions, setTransactions] = useState<ReconcileTx[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Filters
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [filterMonth, setFilterMonth] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [amountMin, setAmountMin] = useState<number | ''>('');
  const [amountMax, setAmountMax] = useState<number | ''>('');

  // Table state
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set()); // rows approved inline (green)
  const [rulesOpen, setRulesOpen] = useState(false);
  const [noteDrawerTxId, setNoteDrawerTxId] = useState<string | null>(null);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);

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
      employeeId: t.employeeId || null,
      employeeName: t.employeeName || null,
      confidence: t.confidence || 'low',
    }));

  const getAuthToken = async () => {
    const token = await getAuth().currentUser?.getIdToken();
    if (!token) throw new Error("Вы не авторизованы. Перезайдите.");
    return token;
  };

  const handleApproveAll = async () => {
    if (!window.confirm(`Утвердить ${filteredTransactions.length} транзакций? Это действие нельзя отменить массово.`)) return;
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

  const handleApproveSingle = async (id: string) => {
    const tx = enrichedTransactions.find(t => t.id === id);
    if (!tx) return;
    // Optimistic: mark row green immediately
    setApprovedIds(prev => new Set(prev).add(id));
    try {
      const token = await getAuthToken();
      const resp = await fetch(`${getApiUrl()}/api/finance/transactions/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ transactions: prepareForApi([tx]) }),
      });
      if (!resp.ok) throw new Error(`API ${resp.status}: ${await resp.text()}`);
      // Remove from local list after brief green flash
      setTimeout(() => {
        setTransactions(prev => prev.filter(t => t.id !== id));
        setApprovedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
      }, 800);
    } catch (e) {
      // Revert on error
      setApprovedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
      setErrorMsg("Ошибка: " + (e as Error).message);
    }
  };

  const handleIgnore = async (id: string) => {
    // Optimistic: remove from list
    setTransactions(prev => prev.filter(t => t.id !== id));
    try {
      const txRef = doc(db, 'bank_transactions', id);
      await updateDoc(txRef, { status: 'ignored', updatedAt: serverTimestamp() });
    } catch (e) {
      setErrorMsg('Ошибка скрытия: ' + (e as Error).message);
      await fetchData(); // reload on error
    }
  };

  const handleBulkIgnore = async () => {
    if (!window.confirm(`Скрыть ${selectedIds.size} транзакций?`)) return;
    const ids = Array.from(selectedIds);
    setTransactions(prev => prev.filter(t => !selectedIds.has(t.id)));
    setSelectedIds(new Set());
    try {
      await Promise.all(ids.map(id => {
        const txRef = doc(db, 'bank_transactions', id);
        return updateDoc(txRef, { status: 'ignored', updatedAt: serverTimestamp() });
      }));
    } catch (e) {
      setErrorMsg('Ошибка скрытия: ' + (e as Error).message);
      await fetchData();
    }
  };

  const handleRestore = async (id: string) => {
    setTransactions(prev => prev.filter(t => t.id !== id));
    try {
      const txRef = doc(db, 'bank_transactions', id);
      await updateDoc(txRef, { status: 'draft', updatedAt: serverTimestamp() });
    } catch (e) {
      setErrorMsg('Ошибка восстановления: ' + (e as Error).message);
      await fetchData();
    }
  };

  const handleApproveTampa = async () => {
    const tampaList = filteredTransactions.filter(t => isTampaArea(t._location));
    if (tampaList.length === 0) return alert('Нет Tampa транзакций');

    // Auto-find Tampa project from loaded projects
    const tampaProject = projects.find(p =>
      p.name.toLowerCase().includes('tampa') ||
      p.name.toLowerCase().includes('тампа')
    );

    if (!tampaProject) {
      setErrorMsg('Не найден проект Tampa. Создайте проект с "Tampa" в названии.');
      return;
    }

    if (!window.confirm(
      `Утвердить ${tampaList.length} транзакций Tampa-area → проект "${tampaProject.name}"?`
    )) return;

    // Override: set company + Tampa project on all Tampa-area txs
    const tampaForApi = tampaList.map(t => ({
      id: t.id.replace(/_split[AB]$/, ''),
      date: normalizeDate(t.date),
      rawDescription: t.rawDescription || '',
      cleanMerchant: t.cleanMerchant || '',
      amount: t.amount,
      paymentType: 'company' as const,
      categoryId: t.categoryId || 'other',
      projectId: tampaProject.id,
      employeeId: t.employeeId || null,
      employeeName: t.employeeName || null,
      confidence: t.confidence || 'low',
    }));

    setSubmitting(true);
    try {
      const token = await getAuthToken();
      const resp = await fetch(`${getApiUrl()}/api/finance/transactions/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ transactions: tampaForApi }),
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

  // ─── Note save ─────────────────────────────────────────

  const handleSaveNote = useCallback(async (txId: string, note: string) => {
    try {
      const txRef = doc(db, 'bank_transactions', txId);
      await updateDoc(txRef, { note });
      setTransactions(prev => prev.map(t => t.id === txId ? { ...t, note } : t));
    } catch (e) {
      console.error('Save note failed', e);
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

  // Month-filtered base for toggle button counts (respects month selection)
  const monthFilteredTransactions = useMemo(() =>
    filterMonth !== 'all'
      ? enrichedTransactions.filter(t => getMonthKey(t.date) === filterMonth)
      : enrichedTransactions,
    [enrichedTransactions, filterMonth]
  );

  const filterStats = useMemo(() => {
    const calc = (list: typeof monthFilteredTransactions) => ({ count: list.length, sum: fmtDollar(list.reduce((s, t) => s + Math.abs(t.amount), 0)) });
    return {
      tampa: calc(monthFilteredTransactions.filter(t => isTampaArea(t._location))),
      company: calc(monthFilteredTransactions.filter(t => t.paymentType === 'company')),
      personal: calc(monthFilteredTransactions.filter(t => t.paymentType !== 'company')),
      fuel: calc(monthFilteredTransactions.filter(t => isFuelTransaction(t))),
      unassigned: calc(monthFilteredTransactions.filter(t => t.paymentType === 'company' && !t.projectId)),
    };
  }, [monthFilteredTransactions]);

  const filteredTransactions = useMemo(() => {
    let result = enrichedTransactions;

    // Month filter
    if (filterMonth !== 'all') result = result.filter(t => getMonthKey(t.date) === filterMonth);

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(t =>
        (t.rawDescription || '').toLowerCase().includes(q) ||
        (t.cleanMerchant || '').toLowerCase().includes(q) ||
        (t._location || '').toLowerCase().includes(q)
      );
    }

    // Amount range
    if (amountMin !== '') result = result.filter(t => Math.abs(t.amount) >= amountMin);
    if (amountMax !== '') result = result.filter(t => Math.abs(t.amount) <= amountMax);

    // Quick filter
    if (quickFilter === 'tampa') result = result.filter(t => isTampaArea(t._location));
    else if (quickFilter === 'company') result = result.filter(t => t.paymentType === 'company');
    else if (quickFilter === 'personal') result = result.filter(t => t.paymentType !== 'company');
    else if (quickFilter === 'fuel') result = result.filter(t => isFuelTransaction(t));
    else if (quickFilter === 'unassigned') result = result.filter(t => t.paymentType === 'company' && !t.projectId);

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
  }, [enrichedTransactions, quickFilter, filterMonth, searchQuery, amountMin, amountMax, sortField, sortDir]);

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
  useEffect(() => { setPage(0); }, [quickFilter, filterMonth, searchQuery, amountMin, amountMax]);

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
    const esc = (s: string) => `"${(s || '').replace(/"/g, '""')}"`;
    const headers = ['Date', 'Merchant', 'Raw Description', 'Location', 'Amount', 'Type', 'Category', 'Project'];
    const rows = filteredTransactions.map(t => [
      esc(renderDate(t.date)),
      esc(t.cleanMerchant || ''),
      esc(t.rawDescription || ''),
      esc((t as unknown as { _location?: string })._location || ''),
      Math.abs(t.amount).toFixed(2),
      t.paymentType === 'company' ? 'Company' : 'Personal',
      esc(COST_CATEGORY_LABELS[t.categoryId] || t.categoryId),
      esc(projects.find(p => p.id === t.projectId)?.name || ''),
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
  }, [filteredTransactions, view, filterMonth, quickFilter, searchQuery, projects]);

  // ─── Render ─────────────────────────────────────────────

  if (loading) return <Box p={4} textAlign="center"><CircularProgress /></Box>;

  const draftTotal = filteredTransactions.length;
  const draftHighConf = filteredTransactions.filter(t => t.confidence === 'high').length;
  const draftLowConf = draftTotal - draftHighConf;
  const autopilotPercent = draftTotal > 0 ? Math.round((draftHighConf / draftTotal) * 100) : 0;
  const fmtCard = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const tampaCount = filteredTransactions.filter(t => isTampaArea(t._location)).length;

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

      {/* ─── Analytics Panel ─── */}
      {enrichedTransactions.length > 0 && (
        <ExpenseAnalyticsPanel
          transactions={filteredTransactions.map(t => ({
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
              <MenuItem value="all">Все месяцы</MenuItem>
              {availableMonths.map(mk => {
                const [y, m] = mk.split('-');
                const count = enrichedTransactions.filter(t => getMonthKey(t.date) === mk).length;
                return <MenuItem key={mk} value={mk}>{MONTH_LABELS[parseInt(m, 10) - 1]} {y} ({count})</MenuItem>;
              })}
            </Select>
          </Box>

          {/* Amount Range */}
          <Box display="flex" alignItems="center" gap={0.5}>
            <TextField
              size="small"
              type="number"
              placeholder="От $"
              value={amountMin}
              onChange={e => setAmountMin(e.target.value === '' ? '' : Number(e.target.value))}
              slotProps={{ input: { startAdornment: <InputAdornment position="start">$</InputAdornment> } }}
              sx={{ width: 95, bgcolor: 'white' }}
            />
            <Typography variant="caption" color="text.secondary">–</Typography>
            <TextField
              size="small"
              type="number"
              placeholder="До $"
              value={amountMax}
              onChange={e => setAmountMax(e.target.value === '' ? '' : Number(e.target.value))}
              slotProps={{ input: { startAdornment: <InputAdornment position="start">$</InputAdornment> } }}
              sx={{ width: 95, bgcolor: 'white' }}
            />
          </Box>

          {/* Quick Filters — scrollable */}
          {view === 'draft' && (
            <Box display="flex" alignItems="center" gap={0.5} sx={{ overflowX: 'auto', flexShrink: 0 }}>
              <FilterListIcon color="action" fontSize="small" />
              <ToggleButtonGroup size="small" value={quickFilter} exclusive onChange={(_, v) => v && setQuickFilter(v)}>
                <ToggleButton value="all">All ({monthFilteredTransactions.length})</ToggleButton>
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
          <Button size="small" variant="outlined" color="warning" startIcon={<VisibilityOffIcon />} onClick={handleBulkIgnore} disabled={submitting}>
            Скрыть ({selectedIds.size})
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
        <Table size="small" stickyHeader sx={{ tableLayout: 'fixed' }}>
          <TableHead>
            <TableRow>
              {view === 'draft' && (
                <TableCell padding="checkbox" sx={{ width: 42 }}>
                  <Checkbox
                    size="small"
                    indeterminate={selectedIds.size > 0 && !paginatedTransactions.every(t => selectedIds.has(t.id))}
                    checked={paginatedTransactions.length > 0 && paginatedTransactions.every(t => selectedIds.has(t.id))}
                    onChange={toggleSelectAll}
                  />
                </TableCell>
              )}
              <TableCell sx={{ width: 78 }}>
                <TableSortLabel active={sortField === 'date'} direction={sortField === 'date' ? sortDir : 'desc'} onClick={() => handleSort('date')}>
                  <strong>Дата</strong>
                </TableSortLabel>
              </TableCell>
              <TableCell>
                <TableSortLabel active={sortField === 'cleanMerchant'} direction={sortField === 'cleanMerchant' ? sortDir : 'asc'} onClick={() => handleSort('cleanMerchant')}>
                  <strong>Контрагент</strong>
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ width: 115 }}>
                <TableSortLabel active={sortField === 'amount'} direction={sortField === 'amount' ? sortDir : 'desc'} onClick={() => handleSort('amount')}>
                  <strong>Сумма</strong>
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ width: 100 }}><strong>Тип</strong></TableCell>
              <TableCell sx={{ width: 120 }}><strong>Сотрудник</strong></TableCell>
              <TableCell sx={{ width: 135 }}>
                <TableSortLabel active={sortField === 'categoryId'} direction={sortField === 'categoryId' ? sortDir : 'asc'} onClick={() => handleSort('categoryId')}>
                  <strong>Категория</strong>
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ width: 155 }}><strong>Проект</strong></TableCell>
              <TableCell align="center" sx={{ width: 70 }}><strong>✓</strong></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedTransactions.map(t => {
              const isLow = view === 'draft' && t.confidence === 'low';
              const loc = t._location;
              const isTampa = isTampaArea(loc);
              const isInlineApproved = approvedIds.has(t.id);
              const bg = isInlineApproved ? '#e8f5e9' : isLow ? '#fefce8' : isTampa ? '#fff8e1' : '#fff';

              return (
                <TableRow key={t.id} sx={{ backgroundColor: bg, opacity: isInlineApproved ? 0.85 : 1, transition: 'background-color 0.3s ease' }} hover>
                  {view === 'draft' && (
                    <TableCell padding="checkbox">
                      <Checkbox size="small" checked={selectedIds.has(t.id)} onChange={() => toggleSelect(t.id)} />
                    </TableCell>
                  )}
                  {/* Date */}
                  <TableCell sx={{ whiteSpace: 'nowrap', fontSize: '0.8rem' }}>{renderDate(t.date)}</TableCell>
                  {/* Merchant + Location + Raw (merged) */}
                  <TableCell>
                    <Tooltip title={t.rawDescription || ''} placement="bottom-start" arrow>
                      <Box sx={{ overflow: 'hidden' }}>
                        <Box display="flex" alignItems="center" gap={0.5}>
                          {isInlineApproved ? (
                            <CheckCircleIcon sx={{ fontSize: 14, color: 'success.main', flexShrink: 0 }} />
                          ) : isLow ? (
                            <WarningAmberIcon sx={{ fontSize: 14, color: 'warning.main', flexShrink: 0 }} />
                          ) : (
                            <CheckCircleIcon sx={{ fontSize: 14, color: 'success.light', flexShrink: 0 }} />
                          )}
                          <Typography variant="body2" fontWeight="bold" noWrap>{t.cleanMerchant}</Typography>
                        </Box>
                        {loc && (
                          <Chip label={loc} size="small" color={isTampa ? 'warning' : 'default'} variant={isTampa ? 'filled' : 'outlined'} sx={{ fontSize: '0.65rem', height: 18, mt: 0.3 }} />
                        )}
                      </Box>
                    </Tooltip>
                  </TableCell>
                  {/* Amount */}
                  <TableCell>
                    {view === 'draft' && !isInlineApproved ? (
                      <TextField
                        size="small"
                        type="number"
                        value={t.amount}
                        onChange={e => handleUpdate(t.id, 'amount', parseFloat(e.target.value) || 0)}
                        slotProps={{ input: { startAdornment: <InputAdornment position="start">$</InputAdornment>, style: { textAlign: 'right' } } }}
                        sx={{ width: 105 }}
                      />
                    ) : (
                      <Typography fontWeight="bold" fontSize="0.85rem" color={t.amount < 0 ? 'error.main' : 'text.primary'}>
                        ${Math.abs(t.amount).toFixed(2)}
                      </Typography>
                    )}
                  </TableCell>
                  {/* Type */}
                  <TableCell>
                    <Select size="small" value={t.paymentType || 'cash'} onChange={e => handleUpdate(t.id, 'paymentType', e.target.value)} sx={{ minWidth: 90, fontSize: '0.8rem', bgcolor: 'white' }} disabled={view !== 'draft' || isInlineApproved}>
                      <MenuItem value="company">🏢 Комп.</MenuItem>
                      <MenuItem value="cash">💵 Личн.</MenuItem>
                    </Select>
                  </TableCell>
                  {/* Employee (for personal expenses) */}
                  <TableCell>
                    {t.paymentType === 'cash' ? (
                      <Select
                        size="small"
                        value={t.employeeId || ''}
                        onChange={e => {
                          const emp = employees.find(em => em.id === e.target.value);
                          handleUpdate(t.id, 'employeeId', e.target.value || null);
                          handleUpdate(t.id, 'employeeName', emp?.name || null);
                        }}
                        displayEmpty
                        disabled={view !== 'draft' || isInlineApproved}
                        sx={{ minWidth: 110, fontSize: '0.75rem', bgcolor: 'white' }}
                      >
                        <MenuItem value=""><em>—</em></MenuItem>
                        {employees.map(emp => <MenuItem key={emp.id} value={emp.id}>{emp.name}</MenuItem>)}
                      </Select>
                    ) : (
                      <Typography variant="caption" color="text.disabled">—</Typography>
                    )}
                  </TableCell>
                  {/* Category — icon picker */}
                  <TableCell>
                    <CategoryChipPicker
                      value={t.categoryId || 'other'}
                      onChange={(val) => handleUpdate(t.id, 'categoryId', val)}
                      disabled={view !== 'draft' || isInlineApproved}
                    />
                  </TableCell>
                  {/* Project */}
                  <TableCell>
                    <Select size="small" value={t.projectId || ''} onChange={e => handleUpdate(t.id, 'projectId', e.target.value)} disabled={t.paymentType !== 'company' || view !== 'draft' || isInlineApproved} displayEmpty sx={{ minWidth: 140, fontSize: '0.8rem', bgcolor: 'white' }}>
                      <MenuItem value=""><em>—</em></MenuItem>
                      {projects.map(p => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
                    </Select>
                  </TableCell>
                  {/* Actions: ✓ approve / undo / hide / restore */}
                  <TableCell align="center">
                    {view === 'approved' ? (
                      <Box display="flex" alignItems="center" justifyContent="center" gap={0.5}>
                        <Tooltip title={t.verifiedBy ? `Проверил: ${t.verifiedBy}` : 'Отметить'}>
                          <Checkbox size="small" checked={!!t.verifiedBy} onChange={() => handleVerify(t.id, !!t.verifiedBy)} icon={<VerifiedIcon color="disabled" />} checkedIcon={<VerifiedIcon color="success" />} sx={{ p: 0.3 }} />
                        </Tooltip>
                        <Tooltip title="Заметка">
                          <IconButton size="small" onClick={() => setNoteDrawerTxId(t.id)} sx={{ p: 0.3 }}>
                            {t.note ? <ChatBubbleIcon fontSize="small" color="info" /> : <ChatBubbleOutlineIcon fontSize="small" color="disabled" />}
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Отменить">
                          <span><Button size="small" color="error" onClick={() => handleUndo(t.id)} disabled={submitting} sx={{ minWidth: 'auto', p: 0.3 }}><UndoIcon fontSize="small" /></Button></span>
                        </Tooltip>
                      </Box>
                    ) : view === 'ignored' ? (
                      <Tooltip title="Восстановить в черновики">
                        <IconButton size="small" color="primary" onClick={() => handleRestore(t.id)}>
                          <RestoreIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    ) : isInlineApproved ? (
                      <Tooltip title="✅ Утверждено">
                        <VerifiedIcon color="success" fontSize="small" />
                      </Tooltip>
                    ) : (
                      <Box display="flex" alignItems="center" justifyContent="center" gap={0}>
                        <Tooltip title="Утвердить">
                          <Checkbox size="small" checked={false} onChange={() => handleApproveSingle(t.id)} icon={<VerifiedIcon color="disabled" />} checkedIcon={<VerifiedIcon color="success" />} disabled={submitting} sx={{ p: 0.3 }} />
                        </Tooltip>
                        <Tooltip title="Скрыть">
                          <IconButton size="small" onClick={() => handleIgnore(t.id)} sx={{ p: 0.3 }}>
                            <VisibilityOffIcon fontSize="small" color="disabled" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Заметка">
                          <IconButton size="small" onClick={() => setNoteDrawerTxId(t.id)} sx={{ p: 0.3 }}>
                            {t.note ? <ChatBubbleIcon fontSize="small" color="info" /> : <ChatBubbleOutlineIcon fontSize="small" color="disabled" />}
                          </IconButton>
                        </Tooltip>
                      </Box>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {paginatedTransactions.length === 0 && (
              <TableRow>
                <TableCell colSpan={view === 'draft' ? 10 : 9} align="center" sx={{ py: 6 }}>
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
        onSaveNote={handleSaveNote}
      />
    </Box>
  );
};

export default ReconciliationPage;
