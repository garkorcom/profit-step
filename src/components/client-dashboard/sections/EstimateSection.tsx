import React, { useState } from 'react';
import {
  Box,
  Typography,
  Grid,
  Card,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  TextField,
  Button,
  Checkbox,
  FormControlLabel,
  Divider,
  Chip,
  Avatar,
  Paper,
  TableContainer,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Collapse,
  IconButton,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  Description as EstimateIcon,
  KeyboardArrowDown as ArrowDownIcon,
  KeyboardArrowUp as ArrowUpIcon,
} from '@mui/icons-material';
import {
  doc,
  updateDoc,
  collection,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../../firebase/firebase';
import type { Estimate } from '../../../types/estimate.types';

// Re-export legacy types for backward compatibility
export interface EstimateComment {
  id: number;
  text: string;
  author: string;
  date: string;
  reply: string;
}

export interface EstimateItem {
  name: string;
  price: number;
  unit: string;
  status: string;
}

export interface EstimateCategory {
  id: number;
  category: string;
  icon: React.ReactNode;
  items: EstimateItem[];
  total: number;
  comments: EstimateComment[];
  approved: boolean;
  status: string;
}

interface EstimateSectionProps {
  estimates: Estimate[];
}

function ExpandableItemRow({ item, index }: { item: any; index: number }) {
  const [open, setOpen] = useState(false);

  const desc = item.description || item.name || '';
  const qty = item.quantity ?? '';
  const unit = item.unit || '';
  // ⚠️ SECURITY: Do NOT fall back to item.unitCostPrice here — that's the
  // INTERNAL cost price and this component renders in the client portal
  // (/portal/:slug). When Phase 3 adds internal mode via a
  // `showInternalCost` prop, the internal view can opt in to showing cost
  // prices. For now, client portal only sees sell prices.
  const unitPrice = item.unitPrice ?? null;
  const itemTotal = item.total ?? item.price ?? 0;
  const notes = item.notes || '';

  const hasDetails = !!(notes || (qty && unitPrice !== null));

  return (
    <>
      <TableRow
        hover
        onClick={() => hasDetails && setOpen(!open)}
        sx={{ cursor: hasDetails ? 'pointer' : 'default', '& > *': { borderBottom: open ? 0 : undefined } }}
      >
        <TableCell sx={{ pl: 1, width: 36 }}>
          {hasDetails && (
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>
              {open ? <ArrowUpIcon fontSize="small" /> : <ArrowDownIcon fontSize="small" />}
            </IconButton>
          )}
        </TableCell>
        <TableCell>{desc}</TableCell>
        <TableCell align="right">{qty}{unit ? ` ${unit}` : ''}</TableCell>
        <TableCell align="right" sx={{ fontWeight: 'bold' }}>
          ${itemTotal.toLocaleString()}
        </TableCell>
      </TableRow>
      {hasDetails && (
        <TableRow>
          <TableCell colSpan={4} sx={{ py: 0, pl: 6, borderBottom: open ? undefined : 0 }}>
            <Collapse in={open} timeout="auto" unmountOnExit>
              <Box sx={{ py: 1.5, color: 'text.secondary' }}>
                {qty && unitPrice !== null && (
                  <Typography variant="body2" sx={{ mb: 0.5 }}>
                    <strong>Quantity:</strong> {qty} {unit} × ${Number(unitPrice).toLocaleString()}/{unit || 'ea'}
                  </Typography>
                )}
                {desc && (
                  <Typography variant="body2" sx={{ mb: 0.5 }}>
                    {desc}
                  </Typography>
                )}
                {notes && (
                  <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
                    <strong>Notes:</strong> {notes}
                  </Typography>
                )}
              </Box>
            </Collapse>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

const EstimateSection: React.FC<EstimateSectionProps> = ({ estimates }) => {
  const [newComment, setNewComment] = useState<{ [key: string]: string }>({});

  const handleAddComment = async (estimateId: string) => {
    const text = newComment[estimateId]?.trim();
    if (!text) return;

    try {
      await addDoc(collection(db, 'estimates', estimateId, 'comments'), {
        text,
        author: 'Client',
        createdAt: serverTimestamp(),
      });
      setNewComment((prev) => ({ ...prev, [estimateId]: '' }));
    } catch (err) {
      console.error('Error adding comment:', err);
    }
  };

  const handleApproveEstimate = async (estimateId: string, currentStatus: string) => {
    try {
      const newStatus = currentStatus === 'approved' ? 'sent' : 'approved';
      await updateDoc(doc(db, 'estimates', estimateId), {
        status: newStatus,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('Error approving estimate:', err);
    }
  };

  if (estimates.length === 0) {
    return (
      <Card elevation={2} sx={{ borderRadius: 2, p: 4, textAlign: 'center' }}>
        <EstimateIcon sx={{ fontSize: 48, color: '#bbb', mb: 2 }} />
        <Typography variant="h6" color="text.secondary">
          No estimates yet
        </Typography>
        <Typography variant="body2" color="text.secondary" mt={1}>
          Estimates will appear here once your project manager creates them.
        </Typography>
      </Card>
    );
  }

  return (
    <Grid container spacing={3}>
      {estimates.map((estimate) => {
        const items = estimate.clientItems || estimate.items || [];
        const total = estimate.clientSubtotal || estimate.total || 0;
        const isApproved = estimate.status === 'approved' || estimate.status === 'locked';

        return (
          <Grid size={{ xs: 12 }} key={estimate.id}>
            <Card elevation={2} sx={{ borderRadius: 2 }}>
              <Accordion>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Box display="flex" alignItems="center" width="100%" pr={2}>
                    <Avatar sx={{ bgcolor: '#2e7d32', mr: 2, width: 48, height: 48 }}>
                      <EstimateIcon />
                    </Avatar>
                    <Box flexGrow={1}>
                      <Typography variant="h6" fontWeight="bold">
                        {estimate.number || 'Estimate'}
                        {estimate.clientName ? ` — ${estimate.clientName}` : ''}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {items.length} items &bull; ${total.toLocaleString()}
                      </Typography>
                    </Box>
                    <Chip
                      label={
                        isApproved ? 'Approved' :
                        estimate.status === 'rejected' ? 'Rejected' :
                        estimate.status === 'sent' ? 'Pending Review' :
                        estimate.status === 'draft' ? 'Draft' :
                        estimate.status
                      }
                      color={
                        isApproved ? 'success' :
                        estimate.status === 'rejected' ? 'error' :
                        'warning'
                      }
                      size="small"
                    />
                  </Box>
                </AccordionSummary>
                <AccordionDetails>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ width: 36 }} />
                          <TableCell>Work Item</TableCell>
                          <TableCell align="right">Qty</TableCell>
                          <TableCell align="right">Amount</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {items.map((item, index) => (
                          <ExpandableItemRow key={(item as any).id || index} item={item} index={index} />
                        ))}
                        <TableRow>
                          <TableCell colSpan={3} sx={{ fontWeight: 'bold', borderTop: 2 }}>
                            TOTAL
                          </TableCell>
                          <TableCell align="right" sx={{ fontWeight: 'bold', fontSize: '1.1rem', borderTop: 2 }}>
                            ${total.toLocaleString()}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </TableContainer>

                  {estimate.notes && (
                    <Paper variant="outlined" sx={{ p: 2, mt: 2, backgroundColor: '#f8f9fa' }}>
                      <Typography variant="body2" color="text.secondary">
                        <strong>Notes:</strong> {estimate.notes}
                      </Typography>
                    </Paper>
                  )}

                  <Divider sx={{ my: 2 }} />

                  <Typography variant="subtitle1" gutterBottom fontWeight="bold">
                    Questions & Comments
                  </Typography>

                  <Box display="flex" gap={1} mb={2}>
                    <TextField
                      fullWidth
                      size="small"
                      placeholder="Ask a question or leave a comment..."
                      value={newComment[estimate.id] || ''}
                      onChange={(e) =>
                        setNewComment((prev) => ({ ...prev, [estimate.id]: e.target.value }))
                      }
                    />
                    <Button
                      variant="contained"
                      size="small"
                      onClick={() => handleAddComment(estimate.id)}
                      disabled={!newComment[estimate.id]?.trim()}
                    >
                      Add
                    </Button>
                  </Box>

                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={isApproved}
                        onChange={() => handleApproveEstimate(estimate.id, estimate.status)}
                        color="success"
                      />
                    }
                    label={
                      <Typography fontWeight="medium">
                        I approve this estimate
                      </Typography>
                    }
                  />
                </AccordionDetails>
              </Accordion>
            </Card>
          </Grid>
        );
      })}
    </Grid>
  );
};

export default EstimateSection;
