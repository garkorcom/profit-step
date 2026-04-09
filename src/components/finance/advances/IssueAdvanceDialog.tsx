/**
 * IssueAdvanceDialog — create a new advance (issue money to employee).
 * Creates a document in `advance_accounts` collection.
 */

import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  FormControl, InputLabel, Select, MenuItem, Alert, Box, CircularProgress,
  InputAdornment,
} from '@mui/material';
import {
  collection, addDoc, getDocs, Timestamp, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../../firebase/firebase';
import { useAuth } from '../../../auth/AuthContext';
import toast from 'react-hot-toast';

// ── Props ──────────────────────────────────────────────────────────────────

interface IssueAdvanceDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  employees: Array<{ id: string; name: string }>;
}

interface Project {
  id: string;
  name: string;
}

// ── Component ──────────────────────────────────────────────────────────────

const IssueAdvanceDialog: React.FC<IssueAdvanceDialogProps> = ({
  open, onClose, onSaved, employees,
}) => {
  const { currentUser, userProfile } = useAuth();

  // Form state
  const [employeeId, setEmployeeId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');

  // UI state
  const [saving, setSaving] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);

  // ── Fetch projects for dropdown ───────────────────────────────────────

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

  // ── Reset form when dialog opens ─────────────────────────────────────

  useEffect(() => {
    if (open) {
      setEmployeeId('');
      setProjectId('');
      setAmount('');
      setDescription('');
    }
  }, [open]);

  // ── Helpers ───────────────────────────────────────────────────────────

  const selectedEmployee = employees.find(e => e.id === employeeId);
  const selectedProject = projects.find(p => p.id === projectId);
  const parsedAmount = parseFloat(amount);
  const isValid = employeeId && parsedAmount > 0 && description.trim().length > 0;

  // ── Save ──────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!isValid || !currentUser) return;

    setSaving(true);
    try {
      const now = Timestamp.now();
      await addDoc(collection(db, 'advance_accounts'), {
        employeeId,
        employeeName: selectedEmployee?.name || '',
        projectId: projectId || null,
        projectName: selectedProject?.name || null,
        amount: Math.round(parsedAmount * 100) / 100,
        status: 'open',
        description: description.trim(),
        issuedAt: now,
        createdBy: currentUser.uid,
        createdByName: userProfile?.displayName || currentUser.email || 'Unknown',
        createdAt: serverTimestamp(),
      });

      toast.success(`Advance $${parsedAmount.toFixed(2)} issued to ${selectedEmployee?.name}`);
      onSaved();
      onClose();
    } catch (err) {
      console.error('Error issuing advance:', err);
      toast.error('Failed to issue advance');
    } finally {
      setSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Issue Advance (PO)</DialogTitle>
      <DialogContent>
        <Alert severity="info" sx={{ mb: 2, mt: 1 }}>
          Issuing an advance transfers company funds to an employee. The employee
          must report expenses with receipts or return unused funds.
        </Alert>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          {/* Employee */}
          <FormControl fullWidth required>
            <InputLabel>Employee</InputLabel>
            <Select
              value={employeeId}
              label="Employee"
              onChange={e => setEmployeeId(e.target.value)}
            >
              {employees.map(emp => (
                <MenuItem key={emp.id} value={emp.id}>{emp.name}</MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Project (optional) */}
          <FormControl fullWidth>
            <InputLabel>Project (optional)</InputLabel>
            <Select
              value={projectId}
              label="Project (optional)"
              onChange={e => setProjectId(e.target.value)}
              disabled={loadingProjects}
            >
              <MenuItem value="">— No project —</MenuItem>
              {loadingProjects ? (
                <MenuItem disabled>
                  <CircularProgress size={16} sx={{ mr: 1 }} /> Loading...
                </MenuItem>
              ) : (
                projects.map(proj => (
                  <MenuItem key={proj.id} value={proj.id}>{proj.name}</MenuItem>
                ))
              )}
            </Select>
          </FormControl>

          {/* Amount */}
          <TextField
            label="Amount"
            type="number"
            fullWidth
            required
            value={amount}
            onChange={e => setAmount(e.target.value)}
            InputProps={{
              startAdornment: <InputAdornment position="start">$</InputAdornment>,
            }}
            inputProps={{ min: 0.01, step: 0.01 }}
            helperText="How much cash is being given to the employee"
          />

          {/* Description */}
          <TextField
            label="Purpose / Description"
            fullWidth
            required
            multiline
            rows={2}
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="e.g. Purchase drywall and screws for Kitchen remodel project"
            helperText="Describe what the advance is for"
          />
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={saving || !isValid}
        >
          {saving ? 'Issuing...' : 'Issue Advance'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default IssueAdvanceDialog;
