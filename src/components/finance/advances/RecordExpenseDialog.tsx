/**
 * RecordExpenseDialog — record an expense against an open advance.
 * Creates a document in `advance_transactions` with type 'expense_report'.
 * Supports receipt file upload to Firebase Storage.
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  FormControl, InputLabel, Select, MenuItem, Alert, Box, Typography,
  InputAdornment, CircularProgress,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import {
  collection, addDoc, getDocs, serverTimestamp,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db } from '../../../firebase/firebase';
import { storage } from '../../../firebase/firebase';
import { useAuth } from '../../../auth/AuthContext';
import { COST_CATEGORIES } from '../../../types/finance.types';
import type { AdvanceAccount, AdvanceTransaction } from '../../../types/advanceAccount.types';
import { computeAdvanceBalance } from '../../../types/advanceAccount.types';
import toast from 'react-hot-toast';

// ── Props ──────────────────────────────────────────────────────────────────

interface RecordExpenseDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** Only open advances */
  advances: AdvanceAccount[];
  transactions: AdvanceTransaction[];
}

interface Project {
  id: string;
  name: string;
}

// ── Component ──────────────────────────────────────────────────────────────

const RecordExpenseDialog: React.FC<RecordExpenseDialogProps> = ({
  open, onClose, onSaved, advances, transactions,
}) => {
  const { currentUser } = useAuth();

  // Form state
  const [advanceId, setAdvanceId] = useState('');
  const [amount, setAmount] = useState('');
  const [projectId, setProjectId] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);

  // UI state
  const [saving, setSaving] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);

  // ── Fetch projects ────────────────────────────────────────────────────

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const fetchProjects = async () => {
      setLoadingProjects(true);
      try {
        const snap = await getDocs(collection(db, 'projects'));
        const list = snap.docs.map(d => ({
          id: d.id,
          name: (d.data().name || d.data().title || 'Unnamed') as string,
        }));
        if (!cancelled) {
          setProjects(list.sort((a, b) => a.name.localeCompare(b.name)));
        }
      } catch (err) {
        console.error('Error fetching projects:', err);
      } finally {
        if (!cancelled) setLoadingProjects(false);
      }
    };

    fetchProjects();
    return () => { cancelled = true; };
  }, [open]);

  // ── Reset form ────────────────────────────────────────────────────────

  useEffect(() => {
    if (open) {
      setAdvanceId('');
      setAmount('');
      setProjectId('');
      setCategory('');
      setDescription('');
      setReceiptFile(null);
    }
  }, [open]);

  // ── Computed values ───────────────────────────────────────────────────

  const selectedAdvance = advances.find(a => a.id === advanceId);
  const selectedProject = projects.find(p => p.id === projectId);
  const remainingBalance = useMemo(() => {
    if (!selectedAdvance) return 0;
    return computeAdvanceBalance(selectedAdvance, transactions);
  }, [selectedAdvance, transactions]);

  const parsedAmount = parseFloat(amount);
  const isValid = advanceId && parsedAmount > 0 && description.trim().length > 0;
  const isOverspend = parsedAmount > remainingBalance;

  // ── Pre-select project from advance ───────────────────────────────────

  useEffect(() => {
    if (selectedAdvance?.projectId) {
      setProjectId(selectedAdvance.projectId);
    }
  }, [selectedAdvance]);

  // ── Upload receipt ────────────────────────────────────────────────────

  const uploadReceipt = async (file: File, txId: string): Promise<string> => {
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `advance_receipts/${advanceId}/${txId}.${ext}`;
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, file);
    return getDownloadURL(storageRef);
  };

  // ── Save ──────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!isValid || !currentUser || !selectedAdvance) return;

    setSaving(true);
    try {
      // Create the transaction document first (to get ID for receipt path)
      const txData: Record<string, unknown> = {
        advanceId,
        employeeId: selectedAdvance.employeeId,
        employeeName: selectedAdvance.employeeName,
        type: 'expense_report',
        amount: Math.round(parsedAmount * 100) / 100,
        projectId: projectId || null,
        projectName: selectedProject?.name || null,
        category: category || null,
        description: description.trim(),
        hasReceipt: !!receiptFile,
        receiptUrl: null,
        createdBy: currentUser.uid,
        createdAt: serverTimestamp(),
        status: 'active',
      };

      const docRef = await addDoc(collection(db, 'advance_transactions'), txData);

      // Upload receipt if provided
      if (receiptFile) {
        try {
          const receiptUrl = await uploadReceipt(receiptFile, docRef.id);
          // Update doc with receipt URL
          const { updateDoc, doc } = await import('firebase/firestore');
          await updateDoc(doc(db, 'advance_transactions', docRef.id), { receiptUrl });
        } catch (uploadErr) {
          console.error('Receipt upload failed:', uploadErr);
          toast.error('Expense recorded but receipt upload failed');
        }
      }

      toast.success(`Expense $${parsedAmount.toFixed(2)} recorded against advance`);
      onSaved();
      onClose();
    } catch (err) {
      console.error('Error recording expense:', err);
      toast.error('Failed to record expense');
    } finally {
      setSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Record Expense</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          {/* Advance selection */}
          <FormControl fullWidth required>
            <InputLabel>Advance</InputLabel>
            <Select
              value={advanceId}
              label="Advance"
              onChange={e => setAdvanceId(e.target.value)}
            >
              {advances.length === 0 ? (
                <MenuItem disabled>No open advances</MenuItem>
              ) : (
                advances.map(adv => (
                  <MenuItem key={adv.id} value={adv.id}>
                    {adv.employeeName} — ${adv.amount.toLocaleString()}
                    {adv.projectName ? ` (${adv.projectName})` : ''}
                  </MenuItem>
                ))
              )}
            </Select>
          </FormControl>

          {/* Remaining balance info */}
          {selectedAdvance && (
            <Alert severity={remainingBalance > 0 ? 'info' : 'warning'} sx={{ py: 0.5 }}>
              <Typography variant="body2">
                Remaining balance: <strong>${remainingBalance.toLocaleString()}</strong>
                {' '}of ${selectedAdvance.amount.toLocaleString()} issued
              </Typography>
            </Alert>
          )}

          {/* Amount */}
          <TextField
            label="Expense Amount"
            type="number"
            fullWidth
            required
            value={amount}
            onChange={e => setAmount(e.target.value)}
            InputProps={{
              startAdornment: <InputAdornment position="start">$</InputAdornment>,
            }}
            inputProps={{ min: 0.01, step: 0.01 }}
            error={isOverspend}
            helperText={isOverspend
              ? `Exceeds remaining balance by $${(parsedAmount - remainingBalance).toFixed(2)}`
              : undefined
            }
          />

          {/* Project (may differ from advance project — cross-project expenses) */}
          <FormControl fullWidth>
            <InputLabel>Project</InputLabel>
            <Select
              value={projectId}
              label="Project"
              onChange={e => setProjectId(e.target.value)}
              disabled={loadingProjects}
            >
              <MenuItem value="">— No project —</MenuItem>
              {projects.map(proj => (
                <MenuItem key={proj.id} value={proj.id}>{proj.name}</MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Category */}
          <FormControl fullWidth>
            <InputLabel>Category</InputLabel>
            <Select
              value={category}
              label="Category"
              onChange={e => setCategory(e.target.value)}
            >
              <MenuItem value="">— No category —</MenuItem>
              {COST_CATEGORIES.map(cat => (
                <MenuItem key={cat.id} value={cat.id}>{cat.label}</MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Description */}
          <TextField
            label="Description"
            fullWidth
            required
            multiline
            rows={2}
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="e.g. Bought 20 sheets of drywall at Home Depot"
          />

          {/* Receipt upload */}
          <Box>
            <Button
              component="label"
              variant="outlined"
              startIcon={receiptFile ? <CheckCircleIcon /> : <CloudUploadIcon />}
              color={receiptFile ? 'success' : 'primary'}
              fullWidth
            >
              {receiptFile ? receiptFile.name : 'Upload Receipt (photo/PDF)'}
              <input
                type="file"
                hidden
                accept="image/*,.pdf"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) setReceiptFile(file);
                }}
              />
            </Button>
            {!receiptFile && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                Receipt is recommended but not required for V1
              </Typography>
            )}
          </Box>

          {/* Overspend warning */}
          {isOverspend && (
            <Alert severity="warning">
              <Typography variant="body2">
                This expense exceeds the remaining advance balance. The employee
                will be owed a reimbursement of ${(parsedAmount - remainingBalance).toFixed(2)}.
              </Typography>
            </Alert>
          )}
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={saving || !isValid}
          color={isOverspend ? 'warning' : 'primary'}
        >
          {saving ? <CircularProgress size={20} /> : 'Record Expense'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default RecordExpenseDialog;
