/**
 * useTransactionMutations — All Firestore write handlers for the Reconciliation page.
 *
 * Extracted from ReconciliationPage.tsx to reduce file size.
 */
import { useState, useCallback, useRef } from 'react';
import { doc, updateDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db } from '../firebase/firebase';
import {
  type ReconcileTx,
  type EnrichedTx,
  normalizeDate,
  isTampaArea,
} from '../components/reconciliation/types';

interface MutationsDeps {
  transactions: ReconcileTx[];
  setTransactions: React.Dispatch<React.SetStateAction<ReconcileTx[]>>;
  enrichedTransactions: EnrichedTx[];
  filteredTransactions: EnrichedTx[];
  projects: { id: string; name: string }[];
  fetchData: () => Promise<void>;
  setErrorMsg: (msg: string | null) => void;
  selectedIds: Set<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
}

const getApiUrl = () => import.meta.env.VITE_FIREBASE_FUNCTIONS_URL || 'https://us-central1-profit-step.cloudfunctions.net/agentApi';

const getAuthToken = async () => {
  const token = await getAuth().currentUser?.getIdToken();
  if (!token) throw new Error("Вы не авторизованы. Перезайдите.");
  return token;
};

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

export function useTransactionMutations(deps: MutationsDeps) {
  const {
    transactions,
    setTransactions,
    enrichedTransactions,
    filteredTransactions,
    projects,
    fetchData,
    setErrorMsg,
    selectedIds,
    setSelectedIds,
  } = deps;

  const [submitting, setSubmitting] = useState(false);
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set());

  // Synchronous in-flight guard. State updates are async, so a rapid double-click
  // can fire two API calls before approvedIds propagates. A ref is mutated
  // synchronously, so the second click sees the lock and returns early.
  const pendingApprovalsRef = useRef<Set<string>>(new Set());

  // ─── Local field update (no Firestore write) ─────────────
  const handleUpdate = (id: string, field: keyof ReconcileTx, value: unknown) => {
    setTransactions(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t));
  };

  // ─── Split transaction in half ───────────────────────────
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

  // ─── Approve all filtered ────────────────────────────────
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

  // ─── Approve selected ────────────────────────────────────
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

  // ─── Approve single (with optimistic green flash) ────────
  const handleApproveSingle = async (id: string) => {
    // Idempotency guard: drop the call if an approval for this id is already
    // in flight. Without this, a rapid double-click creates two API requests
    // and the backend produces two `costs` rows for the same transaction.
    if (pendingApprovalsRef.current.has(id)) return;
    const tx = enrichedTransactions.find(t => t.id === id);
    if (!tx) return;
    pendingApprovalsRef.current.add(id);
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
        pendingApprovalsRef.current.delete(id);
      }, 800);
    } catch (e) {
      // Revert on error
      setApprovedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
      pendingApprovalsRef.current.delete(id);
      setErrorMsg("Ошибка: " + (e as Error).message);
    }
  };

  // ─── Ignore single ──────────────────────────────────────
  // Capture the row before the optimistic remove so we can restore it
  // immediately on failure — without that, the row vanishes for the
  // duration of fetchData() and reappears, which on slow networks
  // looks like the action was committed when in fact it failed.
  const handleIgnore = async (id: string) => {
    const removed = transactions.find(t => t.id === id);
    setTransactions(prev => prev.filter(t => t.id !== id));
    try {
      const txRef = doc(db, 'bank_transactions', id);
      await updateDoc(txRef, { status: 'ignored', updatedAt: serverTimestamp() });
    } catch (e) {
      if (removed) setTransactions(prev => [removed, ...prev]);
      setErrorMsg('Ошибка скрытия: ' + (e as Error).message);
    }
  };

  // ─── Bulk ignore ─────────────────────────────────────────
  const handleBulkIgnore = async () => {
    if (!window.confirm(`Скрыть ${selectedIds.size} транзакций?`)) return;
    const ids = Array.from(selectedIds);
    const removed = transactions.filter(t => selectedIds.has(t.id));
    setTransactions(prev => prev.filter(t => !selectedIds.has(t.id)));
    setSelectedIds(new Set());
    try {
      await Promise.all(ids.map(id => {
        const txRef = doc(db, 'bank_transactions', id);
        return updateDoc(txRef, { status: 'ignored', updatedAt: serverTimestamp() });
      }));
    } catch (e) {
      // Best-effort restore. Some writes may have succeeded; fetchData
      // brings the source of truth back in sync.
      setTransactions(prev => [...removed, ...prev]);
      setErrorMsg('Ошибка скрытия: ' + (e as Error).message);
      await fetchData();
    }
  };

  // ─── Restore (from ignored back to draft) ────────────────
  const handleRestore = async (id: string) => {
    const removed = transactions.find(t => t.id === id);
    setTransactions(prev => prev.filter(t => t.id !== id));
    try {
      const txRef = doc(db, 'bank_transactions', id);
      await updateDoc(txRef, { status: 'draft', updatedAt: serverTimestamp() });
    } catch (e) {
      if (removed) setTransactions(prev => [removed, ...prev]);
      setErrorMsg('Ошибка восстановления: ' + (e as Error).message);
    }
  };

  // ─── Approve all Tampa-area ──────────────────────────────
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
      `Утвердить ${tampaList.length} транзакций Tampa-area -> проект "${tampaProject.name}"?`
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

  // ─── Undo (approved -> draft, remove cost) ───────────────
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

  // ─── Toggle verify status ────────────────────────────────
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
  }, [setTransactions]);

  // ─── Save note ───────────────────────────────────────────
  const handleSaveNote = useCallback(async (txId: string, note: string) => {
    try {
      const txRef = doc(db, 'bank_transactions', txId);
      await updateDoc(txRef, { note });
      setTransactions(prev => prev.map(t => t.id === txId ? { ...t, note } : t));
    } catch (e) {
      console.error('Save note failed', e);
    }
  }, [setTransactions]);

  // ─── Ask employee via Telegram ───────────────────────────
  const [askDialogTxId, setAskDialogTxId] = useState<string | null>(null);
  const [askMessage, setAskMessage] = useState('');
  const [askSending, setAskSending] = useState(false);

  const handleAskEmployee = useCallback(async () => {
    if (!askDialogTxId) return;
    setAskSending(true);
    try {
      const token = await getAuthToken();
      const resp = await fetch(`${getApiUrl()}/api/finance/transactions/${askDialogTxId}/ask-employee`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: askMessage || undefined }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `API ${resp.status}`);

      // Update local state with clarification status
      setTransactions(prev => prev.map(t =>
        t.id === askDialogTxId
          ? { ...t, clarificationStatus: data.clarificationStatus as ReconcileTx['clarificationStatus'] }
          : t
      ));

      setAskDialogTxId(null);
      setAskMessage('');

      if (!data.delivered) {
        setErrorMsg(`Telegram не доставлен: ${data.reason} -- ${data.details || ''}`);
      }
    } catch (e) {
      setErrorMsg('Ошибка отправки: ' + (e as Error).message);
    } finally {
      setAskSending(false);
    }
  }, [askDialogTxId, askMessage, setTransactions, setErrorMsg]);

  // ─── Bulk field update (category / paymentType) ──────────
  // Persists to /api/finance/transactions/bulk-update so the change
  // survives a page reload. Optimistic local update first; on API
  // failure, errorMsg is shown and fetchData() reloads the truth.
  const handleBulkUpdate = useCallback(async (field: 'categoryId' | 'paymentType', value: string) => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);

    // Optimistic local update
    setTransactions(prev => prev.map(t =>
      selectedIds.has(t.id) ? { ...t, [field]: value } : t
    ));

    try {
      const token = await getAuthToken();
      const resp = await fetch(`${getApiUrl()}/api/finance/transactions/bulk-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids, patch: { [field]: value } }),
      });
      if (!resp.ok) throw new Error(`API ${resp.status}: ${await resp.text()}`);
      const data = await resp.json() as { updated: number; skipped: number };
      if (data.skipped > 0) {
        setErrorMsg(`Обновлено ${data.updated}, пропущено ${data.skipped} (не draft или не найдено)`);
      }
    } catch (e) {
      setErrorMsg('Не удалось сохранить bulk-обновление: ' + (e as Error).message);
      await fetchData(); // revert by reloading the truth
    }
  }, [selectedIds, setTransactions, setErrorMsg, fetchData]);

  return {
    submitting,
    approvedIds,
    handleUpdate,
    handleSplit,
    handleApproveAll,
    handleApproveSelected,
    handleApproveSingle,
    handleIgnore,
    handleBulkIgnore,
    handleRestore,
    handleApproveTampa,
    handleUndo,
    handleVerify,
    handleSaveNote,
    handleBulkUpdate,
    // Ask employee
    askDialogTxId, setAskDialogTxId,
    askMessage, setAskMessage,
    askSending,
    handleAskEmployee,
  };
}
