/**
 * @fileoverview Tab panel components for SiteDashboard.
 * Each tab is a focused, typed component.
 */
import React from 'react';
import {
  Box, Typography, Paper, Grid, Card, CardContent, Chip, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, TablePagination, Button,
  LinearProgress, Collapse, Alert, List, ListItem, ListItemAvatar,
  ListItemText, Avatar, TextField, InputAdornment, Link,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import PersonIcon from '@mui/icons-material/Person';
import SearchIcon from '@mui/icons-material/Search';

import type { GTDTask } from '../../types/gtd.types';
import type { Estimate } from '../../types/estimate.types';
import type { Contact } from '../../types/contact.types';
import type { SiteData } from '../../api/sitesApi';
import type {
  PaymentSchedule, NpsRequest, PunchList, WorkAct, WarrantyTask,
  PlanVsFactData, PurchaseOrder, ChangeOrder, CostRecord, WorkSession,
  CostsSummary, SessionsSummary, EstimateLineItem,
} from './siteDashboard.types';
import { PRIORITY_COLORS, ESTIMATE_STATUS_COLORS } from './siteDashboard.types';

// ─── TabPanel wrapper ─────────────────────────────────────

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

export function TabPanel({ children, value, index, ...other }: TabPanelProps) {
  return (
    <div role="tabpanel" hidden={value !== index} id={`site-tabpanel-${index}`} aria-labelledby={`site-tab-${index}`} {...other}>
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TAB 1: TASKS
// ═══════════════════════════════════════════════════════════

interface TasksTabProps {
  tasks: GTDTask[];
  site: SiteData;
  siteId: string;
  navigate: (path: string) => void;
}

export const TasksTab: React.FC<TasksTabProps> = ({ tasks, site, siteId, navigate }) => {
  const [page, setPage] = React.useState(0);
  const [rowsPerPage, setRowsPerPage] = React.useState(20);

  return (
    <>
      <Box display="flex" justifyContent="flex-end" mb={2}>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate(`/crm/gtd/new?clientId=${site.clientId}&siteId=${siteId}`)}>
          Создать задачу
        </Button>
      </Box>
      {tasks.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}><Typography color="text.secondary">No tasks found for this site</Typography></Paper>
      ) : (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Title</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Priority</TableCell>
                <TableCell>Due Date</TableCell>
                <TableCell>Type</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {tasks.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage).map(task => {
                const extended = task as GTDTask & { taskType?: string; category?: string };
                return (
                  <TableRow key={task.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/crm/gtd/${task.id}`)}>
                    <TableCell><Typography variant="body2" fontWeight={600}>{task.title}</Typography></TableCell>
                    <TableCell><Chip label={task.status} size="small" color={task.status === 'done' ? 'success' : task.status === 'next_action' ? 'primary' : 'default'} /></TableCell>
                    <TableCell>
                      <Chip label={task.priority || 'normal'} size="small" sx={{
                        bgcolor: (PRIORITY_COLORS[task.priority || 'normal'] || '#9e9e9e') + '22',
                        color: PRIORITY_COLORS[task.priority || 'normal'] || '#9e9e9e',
                        fontWeight: 600,
                      }} />
                    </TableCell>
                    <TableCell>
                      {task.dueDate
                        ? (typeof task.dueDate === 'string'
                          ? task.dueDate
                          : (task.dueDate as { toDate?: () => Date })?.toDate?.()?.toLocaleDateString() || '—')
                        : '—'}
                    </TableCell>
                    <TableCell><Typography variant="caption" color="text.secondary">{extended.taskType || extended.category || '—'}</Typography></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {tasks.length > 20 && (
            <TablePagination component="div" count={tasks.length} page={page}
              onPageChange={(_, p) => setPage(p)} rowsPerPage={rowsPerPage}
              onRowsPerPageChange={e => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
              rowsPerPageOptions={[20, 50, 100]} />
          )}
        </TableContainer>
      )}
    </>
  );
};

// ═══════════════════════════════════════════════════════════
// TAB 2: ESTIMATES
// ═══════════════════════════════════════════════════════════

interface EstimatesTabProps {
  estimates: Estimate[];
  site: SiteData;
  siteId: string;
  navigate: (path: string) => void;
}

export const EstimatesTab: React.FC<EstimatesTabProps> = ({ estimates, site, siteId, navigate }) => {
  const [expanded, setExpanded] = React.useState<string | null>(null);

  return (
    <>
      <Box display="flex" justifyContent="flex-end" mb={2}>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate(`/crm/estimates/new?clientId=${site.clientId}&siteId=${siteId}`)}>
          Создать estimate
        </Button>
      </Box>
      {estimates.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}><Typography color="text.secondary">No estimates found</Typography></Paper>
      ) : (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell width={40} />
                <TableCell>Number</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Total</TableCell>
                <TableCell>Created</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {estimates.map(est => {
                const ext = est as Estimate & { description?: string; validUntil?: { toDate?: () => Date }; items?: EstimateLineItem[] };
                return (
                  <React.Fragment key={est.id}>
                    <TableRow hover sx={{ cursor: 'pointer' }} onClick={() => setExpanded(expanded === est.id ? null : est.id)}>
                      <TableCell>{expanded === est.id ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}</TableCell>
                      <TableCell><Typography variant="body2" fontWeight={600}>{est.number || est.id.slice(0, 8)}</Typography></TableCell>
                      <TableCell><Chip label={est.status} size="small" color={ESTIMATE_STATUS_COLORS[est.status] || 'default'} /></TableCell>
                      <TableCell align="right"><Typography variant="body2" fontWeight={600}>${est.total?.toLocaleString() || '0'}</Typography></TableCell>
                      <TableCell>{est.createdAt?.toDate?.()?.toLocaleDateString() || '—'}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={5} sx={{ p: 0, border: expanded === est.id ? undefined : 'none' }}>
                        <Collapse in={expanded === est.id} timeout="auto" unmountOnExit>
                          <Box sx={{ p: 2, bgcolor: 'action.hover' }}>
                            <Grid container spacing={2}>
                              <Grid size={{ xs: 12, sm: 6 }}>
                                <Typography variant="caption" color="text.secondary">Description</Typography>
                                <Typography variant="body2">{ext.description || '—'}</Typography>
                              </Grid>
                              <Grid size={{ xs: 12, sm: 3 }}>
                                <Typography variant="caption" color="text.secondary">Valid Until</Typography>
                                <Typography variant="body2">{ext.validUntil?.toDate?.()?.toLocaleDateString() || '—'}</Typography>
                              </Grid>
                              <Grid size={{ xs: 12, sm: 3 }}>
                                <Typography variant="caption" color="text.secondary">Items</Typography>
                                <Typography variant="body2">{ext.items?.length || 0} line items</Typography>
                              </Grid>
                            </Grid>
                            {ext.items && ext.items.length > 0 && (
                              <Table size="small" sx={{ mt: 1 }}>
                                <TableHead>
                                  <TableRow>
                                    <TableCell>Item</TableCell>
                                    <TableCell align="right">Qty</TableCell>
                                    <TableCell align="right">Rate</TableCell>
                                    <TableCell align="right">Amount</TableCell>
                                  </TableRow>
                                </TableHead>
                                <TableBody>
                                  {ext.items.map((rawItem, idx) => {
                                    const item = rawItem as unknown as Record<string, unknown> & typeof rawItem;
                                    const name = (item.name as string | undefined) ?? item.description ?? '—';
                                    const rate = (item.rate as number | undefined) ?? item.unitPrice ?? 0;
                                    const amount = (item.amount as number | undefined) ?? ((item.quantity || 1) * rate);
                                    return (
                                    <TableRow key={idx}>
                                      <TableCell>{name}</TableCell>
                                      <TableCell align="right">{item.quantity || 1}</TableCell>
                                      <TableCell align="right">${rate.toLocaleString()}</TableCell>
                                      <TableCell align="right">${amount.toLocaleString()}</TableCell>
                                    </TableRow>
                                    );
                                  })}
                                </TableBody>
                              </Table>
                            )}
                          </Box>
                        </Collapse>
                      </TableCell>
                    </TableRow>
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </>
  );
};

// ═══════════════════════════════════════════════════════════
// TAB 3: BUDGET (Процентовка)
// ═══════════════════════════════════════════════════════════

interface BudgetTabProps {
  tasks: GTDTask[];
}

export const BudgetTab: React.FC<BudgetTabProps> = ({ tasks }) => {
  const parentTasks = tasks.filter(t => {
    const ext = t as GTDTask & { isSubtask?: boolean };
    return ext.isSubtask !== true;
  });
  const subtasks = tasks.filter(t => {
    const ext = t as GTDTask & { isSubtask?: boolean };
    return ext.isSubtask === true;
  });

  if (parentTasks.length === 0) {
    return <Paper sx={{ p: 4, textAlign: 'center' }}><Typography color="text.secondary">No tasks with budget data found</Typography></Paper>;
  }

  type BudgetTask = GTDTask & { parentTaskId?: string; budgetAmount?: number; totalEarnings?: number; budgetCategory?: string };

  let grandBudget = 0;
  let grandSpent = 0;
  parentTasks.forEach(task => {
    const children = subtasks.filter(st => (st as BudgetTask).parentTaskId === task.id);
    grandBudget += children.reduce((s, c) => s + ((c as BudgetTask).budgetAmount || 0), 0);
    grandSpent += children.reduce((s, c) => s + ((c as BudgetTask).totalEarnings || 0), 0);
  });
  const grandDebt = grandBudget - grandSpent;
  const grandPercent = grandBudget > 0 ? Math.min(100, Math.round((grandSpent / grandBudget) * 100)) : 0;

  return (
    <Box>
      <Typography variant="h6" gutterBottom>Budget Breakdown (Процентовка)</Typography>
      <Paper sx={{ p: 2, mb: 3 }}>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
          <Typography variant="subtitle2">Общий прогресс</Typography>
          <Typography variant="subtitle2" fontWeight={700}>{grandPercent}%</Typography>
        </Box>
        <LinearProgress variant="determinate" value={grandPercent} sx={{
          height: 10, borderRadius: 5, bgcolor: '#e0e0e0',
          '& .MuiLinearProgress-bar': { bgcolor: grandPercent >= 100 ? '#4caf50' : grandPercent >= 75 ? '#ff9800' : '#2196f3', borderRadius: 5 },
        }} />
      </Paper>

      {parentTasks.map(task => {
        const children = subtasks.filter(st => (st as BudgetTask).parentTaskId === task.id);
        const totalBudget = children.reduce((s, c) => s + ((c as BudgetTask).budgetAmount || 0), 0);
        const totalSpent = children.reduce((s, c) => s + ((c as BudgetTask).totalEarnings || 0), 0);
        const totalDebt = totalBudget - totalSpent;
        const percent = totalBudget > 0 ? Math.min(100, Math.round((totalSpent / totalBudget) * 100)) : 0;

        return (
          <Paper key={task.id} sx={{ p: 2, mb: 2 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
              <Typography variant="subtitle1" fontWeight={700}>{task.title}</Typography>
              <Box display="flex" gap={2}>
                <Typography variant="body2" color="text.secondary">Budget: <strong>${totalBudget.toLocaleString()}</strong></Typography>
                <Typography variant="body2" sx={{ color: totalSpent >= totalBudget ? '#4caf50' : 'text.secondary' }}>Paid: <strong>${totalSpent.toLocaleString()}</strong></Typography>
                <Typography variant="body2" sx={{ color: totalDebt > 0 ? '#f44336' : '#4caf50', fontWeight: 700 }}>
                  {totalDebt > 0 ? `Debt: $${totalDebt.toLocaleString()}` : 'Оплачено ✓'}
                </Typography>
              </Box>
            </Box>
            <LinearProgress variant="determinate" value={percent} sx={{
              height: 6, borderRadius: 3, mb: 1, bgcolor: '#e0e0e0',
              '& .MuiLinearProgress-bar': { bgcolor: percent >= 100 ? '#4caf50' : '#2196f3', borderRadius: 3 },
            }} />
            {children.length > 0 ? (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Subtask</TableCell><TableCell>Category</TableCell>
                      <TableCell align="right">Budget</TableCell><TableCell align="right">Paid</TableCell>
                      <TableCell align="right">Debt</TableCell><TableCell>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {children.map(st => {
                      const bst = st as BudgetTask;
                      const stBudget = bst.budgetAmount || 0;
                      const stPaid = bst.totalEarnings || 0;
                      const stDebt = stBudget - stPaid;
                      return (
                        <TableRow key={st.id}>
                          <TableCell>{st.title}</TableCell>
                          <TableCell><Chip label={bst.budgetCategory || '—'} size="small" variant="outlined" /></TableCell>
                          <TableCell align="right">${stBudget.toLocaleString()}</TableCell>
                          <TableCell align="right" sx={{ color: stPaid >= stBudget && stBudget > 0 ? '#4caf50' : undefined, fontWeight: stPaid >= stBudget && stBudget > 0 ? 700 : undefined }}>
                            ${stPaid.toLocaleString()}
                          </TableCell>
                          <TableCell align="right" sx={{ color: stDebt > 0 ? '#f44336' : '#4caf50', fontWeight: 700 }}>
                            {stDebt > 0 ? `$${stDebt.toLocaleString()}` : '✓'}
                          </TableCell>
                          <TableCell><Chip label={st.status} size="small" color={st.status === 'done' ? 'success' : 'default'} /></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : (
              <Typography variant="body2" color="text.secondary">No subtasks</Typography>
            )}
          </Paper>
        );
      })}

      <Paper sx={{ p: 2, bgcolor: 'action.hover' }}>
        <Grid container spacing={2} alignItems="center">
          <Grid size={{ xs: 12, sm: 3 }}><Typography variant="h6" fontWeight={700}>ИТОГО</Typography></Grid>
          <Grid size={{ xs: 4, sm: 3 }}>
            <Typography variant="body2" color="text.secondary">Budget</Typography>
            <Typography variant="h6" fontWeight={700}>${grandBudget.toLocaleString()}</Typography>
          </Grid>
          <Grid size={{ xs: 4, sm: 3 }}>
            <Typography variant="body2" color="text.secondary">Paid</Typography>
            <Typography variant="h6" fontWeight={700} sx={{ color: '#4caf50' }}>${grandSpent.toLocaleString()}</Typography>
          </Grid>
          <Grid size={{ xs: 4, sm: 3 }}>
            <Typography variant="body2" color="text.secondary">Debt</Typography>
            <Typography variant="h6" fontWeight={700} sx={{ color: grandDebt > 0 ? '#f44336' : '#4caf50' }}>
              {grandDebt > 0 ? `$${grandDebt.toLocaleString()}` : 'Оплачено ✓'}
            </Typography>
          </Grid>
        </Grid>
      </Paper>
    </Box>
  );
};

// ═══════════════════════════════════════════════════════════
// TAB 4: FINANCE
// ═══════════════════════════════════════════════════════════

interface FinanceTabProps {
  planVsFact: PlanVsFactData | null;
  purchaseOrders: PurchaseOrder[];
  changeOrders: ChangeOrder[];
  costs: CostRecord[];
  costsSummary: CostsSummary;
}

export const FinanceTab: React.FC<FinanceTabProps> = ({ planVsFact, purchaseOrders, changeOrders, costs, costsSummary }) => (
  <>
    {planVsFact && (
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>📊 Plan vs Fact</Typography>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 4 }}>
            <Card variant="outlined"><CardContent>
              <Typography variant="body2" color="text.secondary">Planned (Estimates)</Typography>
              <Typography variant="h5" fontWeight={700}>${(planVsFact.planned?.total || 0).toLocaleString()}</Typography>
            </CardContent></Card>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <Card variant="outlined"><CardContent>
              <Typography variant="body2" color="text.secondary">Actual (Costs)</Typography>
              <Typography variant="h5" fontWeight={700} sx={{ color: (planVsFact.actual?.total || 0) > (planVsFact.planned?.total || 0) ? '#f44336' : '#4caf50' }}>
                ${(planVsFact.actual?.total || 0).toLocaleString()}
              </Typography>
            </CardContent></Card>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <Card variant="outlined"><CardContent>
              <Typography variant="body2" color="text.secondary">Variance</Typography>
              <Typography variant="h5" fontWeight={700} sx={{ color: (planVsFact.variance?.total || 0) >= 0 ? '#4caf50' : '#f44336' }}>
                ${(planVsFact.variance?.total || 0).toLocaleString()}
              </Typography>
            </CardContent></Card>
          </Grid>
        </Grid>
        {planVsFact.alerts && planVsFact.alerts.length > 0 && (
          <Box sx={{ mt: 2 }}>
            {planVsFact.alerts.map((alert, idx) => (
              <Alert key={idx} severity={alert.includes('🚨') ? 'error' : 'warning'} sx={{ mb: 1 }}>{alert}</Alert>
            ))}
          </Box>
        )}
        <Box sx={{ mt: 2 }}>
          <Box display="flex" justifyContent="space-between" mb={0.5}>
            <Typography variant="body2">Budget Consumption</Typography>
            <Typography variant="body2" fontWeight={700}>{planVsFact.margin?.actual || 0}%</Typography>
          </Box>
          <LinearProgress variant="determinate" value={Math.min(100, planVsFact.margin?.actual || 0)} sx={{
            height: 8, borderRadius: 4, bgcolor: '#e0e0e0',
            '& .MuiLinearProgress-bar': { bgcolor: (planVsFact.margin?.actual || 0) > 100 ? '#f44336' : (planVsFact.margin?.actual || 0) > 90 ? '#ff9800' : '#4caf50', borderRadius: 4 },
          }} />
        </Box>
      </Paper>
    )}

    {purchaseOrders.length > 0 && (
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>🛒 Purchase Orders ({purchaseOrders.length})</Typography>
        <TableContainer><Table size="small">
          <TableHead><TableRow>
            <TableCell>Vendor</TableCell><TableCell>Category</TableCell><TableCell>Status</TableCell>
            <TableCell align="right">Total</TableCell><TableCell align="right">Variance</TableCell>
          </TableRow></TableHead>
          <TableBody>
            {purchaseOrders.map(po => (
              <TableRow key={po.id}>
                <TableCell><Typography variant="body2" fontWeight={600}>{po.vendor}</Typography></TableCell>
                <TableCell><Chip label={po.category || 'Other'} size="small" variant="outlined" /></TableCell>
                <TableCell><Chip label={po.status} size="small" color={po.status === 'received' ? 'success' : po.status === 'approved' ? 'info' : 'default'} /></TableCell>
                <TableCell align="right">${(po.total || 0).toLocaleString()}</TableCell>
                <TableCell align="right" sx={{ color: (po.variancePercent || 0) > 0 ? '#f44336' : '#4caf50' }}>
                  {po.variancePercent ? `${po.variancePercent > 0 ? '+' : ''}${po.variancePercent.toFixed(1)}%` : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table></TableContainer>
      </Paper>
    )}

    {changeOrders.length > 0 && (
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>📝 Change Orders ({changeOrders.length})</Typography>
        <TableContainer><Table size="small">
          <TableHead><TableRow>
            <TableCell>#</TableCell><TableCell>Title</TableCell><TableCell>Status</TableCell>
            <TableCell align="right">Internal</TableCell><TableCell align="right">Client</TableCell>
          </TableRow></TableHead>
          <TableBody>
            {changeOrders.map(co => (
              <TableRow key={co.id}>
                <TableCell><Typography variant="body2" fontWeight={600}>{co.number}</Typography></TableCell>
                <TableCell>{co.title}</TableCell>
                <TableCell><Chip label={co.status} size="small" color={co.status === 'approved' ? 'success' : co.status === 'rejected' ? 'error' : 'default'} /></TableCell>
                <TableCell align="right">${(co.internalTotal || 0).toLocaleString()}</TableCell>
                <TableCell align="right">${(co.clientTotal || 0).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table></TableContainer>
      </Paper>
    )}

    <Grid container spacing={2} sx={{ mb: 3 }}>
      <Grid size={{ xs: 12, sm: 4 }}>
        <Card><CardContent>
          <Box display="flex" alignItems="center" gap={1}>
            <AttachMoneyIcon color="primary" /><Typography variant="body2" color="text.secondary">Total Costs</Typography>
          </Box>
          <Typography variant="h4" fontWeight={700} sx={{ mt: 1 }}>${costsSummary.total.toLocaleString()}</Typography>
          <Typography variant="caption" color="text.secondary">{costs.length} transactions</Typography>
        </CardContent></Card>
      </Grid>
      {Object.entries(costsSummary.byCategory).slice(0, 4).map(([cat, amount]) => (
        <Grid size={{ xs: 12, sm: 4 }} key={cat}>
          <Card><CardContent>
            <Typography variant="body2" color="text.secondary">{cat}</Typography>
            <Typography variant="h5" fontWeight={600}>${amount.toLocaleString()}</Typography>
          </CardContent></Card>
        </Grid>
      ))}
    </Grid>

    {costs.length === 0 ? (
      <Paper sx={{ p: 4, textAlign: 'center' }}><Typography color="text.secondary">No costs recorded</Typography></Paper>
    ) : (
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead><TableRow>
            <TableCell>Description</TableCell><TableCell>Category</TableCell>
            <TableCell align="right">Amount</TableCell><TableCell>Date</TableCell>
          </TableRow></TableHead>
          <TableBody>
            {costs.map(c => (
              <TableRow key={c.id}>
                <TableCell>{c.description || c.notes || '—'}</TableCell>
                <TableCell><Chip label={c.category || 'Other'} size="small" variant="outlined" /></TableCell>
                <TableCell align="right"><Typography fontWeight={600}>${(c.amount || 0).toLocaleString()}</Typography></TableCell>
                <TableCell>{c.date || c.createdAt?.toDate?.()?.toLocaleDateString() || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    )}
  </>
);

// ═══════════════════════════════════════════════════════════
// TAB 5: QUALITY
// ═══════════════════════════════════════════════════════════

interface QualityTabProps {
  workActs: WorkAct[];
  punchLists: PunchList[];
  warrantyTasks: WarrantyTask[];
}

export const QualityTab: React.FC<QualityTabProps> = ({ workActs, punchLists, warrantyTasks }) => (
  <>
    <Paper sx={{ p: 3, mb: 3 }}>
      <Typography variant="h6" gutterBottom>📝 Work Acts</Typography>
      {workActs.length === 0 ? (
        <Typography color="text.secondary">No work acts created yet</Typography>
      ) : (
        <>
          {(() => {
            const signed = workActs.filter(a => a.status === 'signed').length;
            const total = workActs.length;
            const pct = total > 0 ? Math.round((signed / total) * 100) : 0;
            return (
              <Box sx={{ mb: 2 }}>
                <Box display="flex" justifyContent="space-between" mb={0.5}>
                  <Typography variant="body2">Signed: {signed} / {total}</Typography>
                  <Typography variant="body2" fontWeight={700}>{pct}%</Typography>
                </Box>
                <LinearProgress variant="determinate" value={pct} sx={{
                  height: 10, borderRadius: 5, bgcolor: '#e0e0e0',
                  '& .MuiLinearProgress-bar': { bgcolor: pct >= 100 ? '#4caf50' : pct >= 50 ? '#ff9800' : '#2196f3', borderRadius: 5 },
                }} />
              </Box>
            );
          })()}
          <TableContainer><Table size="small">
            <TableHead><TableRow>
              <TableCell>#</TableCell><TableCell>Phase</TableCell>
              <TableCell align="right">Planned</TableCell><TableCell align="right">Actual</TableCell>
              <TableCell>Status</TableCell><TableCell>Punch List</TableCell>
            </TableRow></TableHead>
            <TableBody>
              {workActs.map(act => (
                <TableRow key={act.id}>
                  <TableCell><Typography variant="body2" fontWeight={600}>{act.number}</Typography></TableCell>
                  <TableCell>{act.phaseName}</TableCell>
                  <TableCell align="right">${(act.plannedAmount || 0).toLocaleString()}</TableCell>
                  <TableCell align="right">${(act.actualAmount || 0).toLocaleString()}</TableCell>
                  <TableCell>
                    <Chip label={act.status?.replace(/_/g, ' ')} size="small" color={
                      act.status === 'signed' ? 'success' : act.status === 'ready_to_sign' ? 'info' :
                      act.status === 'punch_list' ? 'warning' : act.status === 'disputed' ? 'error' : 'default'
                    } />
                  </TableCell>
                  <TableCell>
                    {act.blockedByPunchList ? <Chip label="🚫 Blocked" size="small" color="error" variant="outlined" /> :
                     act.punchListId ? <Chip label="✅ Resolved" size="small" color="success" variant="outlined" /> :
                     <Typography variant="caption" color="text.secondary">—</Typography>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table></TableContainer>
        </>
      )}
    </Paper>

    <Paper sx={{ p: 3, mb: 3 }}>
      <Typography variant="h6" gutterBottom>📌 Punch Lists</Typography>
      {punchLists.length === 0 ? (
        <Typography color="text.secondary">No punch lists created yet</Typography>
      ) : (
        punchLists.map(pl => (
          <Paper key={pl.id} variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
              <Typography variant="subtitle1" fontWeight={700}>{pl.title}</Typography>
              <Box display="flex" gap={1}>
                <Chip label={`Open: ${pl.openItems || 0}`} size="small" color="error" variant="outlined" />
                <Chip label={`Fixed: ${pl.fixedItems || 0}`} size="small" color="warning" variant="outlined" />
                <Chip label={`Verified: ${pl.verifiedItems || 0}`} size="small" color="success" variant="outlined" />
              </Box>
            </Box>
            {pl.isResolved && <Chip label="✅ All Resolved" size="small" color="success" sx={{ mb: 1 }} />}
            {pl.items && pl.items.length > 0 && (
              <Table size="small">
                <TableHead><TableRow>
                  <TableCell>Description</TableCell><TableCell>Location</TableCell>
                  <TableCell>Priority</TableCell><TableCell>Status</TableCell>
                </TableRow></TableHead>
                <TableBody>
                  {pl.items.map(item => (
                    <TableRow key={item.id}>
                      <TableCell>{item.description}</TableCell>
                      <TableCell>{item.location || '—'}</TableCell>
                      <TableCell><Chip label={item.priority} size="small" color={item.priority === 'critical' ? 'error' : item.priority === 'major' ? 'warning' : 'default'} /></TableCell>
                      <TableCell><Chip label={item.status?.replace(/_/g, ' ')} size="small" color={item.status === 'verified' ? 'success' : item.status === 'fixed' ? 'info' : item.status === 'open' ? 'error' : 'default'} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Paper>
        ))
      )}
    </Paper>

    <Paper sx={{ p: 3 }}>
      <Typography variant="h6" gutterBottom>🛡️ Warranty Tasks</Typography>
      {warrantyTasks.length === 0 ? (
        <Typography color="text.secondary">No warranty tasks</Typography>
      ) : (
        <Table size="small">
          <TableHead><TableRow>
            <TableCell>Description</TableCell><TableCell>Priority</TableCell>
            <TableCell>Status</TableCell><TableCell align="right">Cost</TableCell>
          </TableRow></TableHead>
          <TableBody>
            {warrantyTasks.map(wt => (
              <TableRow key={wt.id}>
                <TableCell>{wt.description}</TableCell>
                <TableCell><Chip label={wt.priority} size="small" color={wt.priority === 'urgent' ? 'error' : wt.priority === 'high' ? 'warning' : 'default'} /></TableCell>
                <TableCell><Chip label={wt.status} size="small" color={wt.status === 'resolved' ? 'success' : wt.status === 'in_progress' ? 'info' : 'default'} /></TableCell>
                <TableCell align="right">${(wt.cost || 0).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Paper>
  </>
);

// ═══════════════════════════════════════════════════════════
// TAB 6: TIME TRACKING
// ═══════════════════════════════════════════════════════════

interface TimeTabProps {
  sessions: WorkSession[];
  sessionsSummary: SessionsSummary;
}

export const TimeTab: React.FC<TimeTabProps> = ({ sessions, sessionsSummary }) => (
  <>
    <Grid container spacing={2} sx={{ mb: 3 }}>
      <Grid size={{ xs: 12, sm: 4 }}>
        <Card><CardContent>
          <Box display="flex" alignItems="center" gap={1}>
            <AccessTimeIcon color="primary" /><Typography variant="body2" color="text.secondary">Total Hours</Typography>
          </Box>
          <Typography variant="h4" fontWeight={700} sx={{ mt: 1 }}>{(sessionsSummary.totalMinutes / 60).toFixed(1)}h</Typography>
        </CardContent></Card>
      </Grid>
      <Grid size={{ xs: 12, sm: 4 }}>
        <Card><CardContent>
          <Box display="flex" alignItems="center" gap={1}>
            <AttachMoneyIcon color="success" /><Typography variant="body2" color="text.secondary">Total Earnings</Typography>
          </Box>
          <Typography variant="h4" fontWeight={700} sx={{ mt: 1 }}>${sessionsSummary.totalEarnings.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Typography>
        </CardContent></Card>
      </Grid>
      <Grid size={{ xs: 12, sm: 4 }}>
        <Card><CardContent>
          <Typography variant="body2" color="text.secondary">Sessions</Typography>
          <Typography variant="h4" fontWeight={700} sx={{ mt: 1 }}>{sessions.length}</Typography>
        </CardContent></Card>
      </Grid>
    </Grid>

    {Object.values(sessionsSummary.byEmployee).length > 0 && (
      <Paper sx={{ mb: 3 }}>
        <TableContainer><Table size="small">
          <TableHead><TableRow>
            <TableCell>Employee</TableCell><TableCell align="right">Hours</TableCell><TableCell align="right">Earnings</TableCell>
          </TableRow></TableHead>
          <TableBody>
            {Object.values(sessionsSummary.byEmployee).map(emp => (
              <TableRow key={emp.name}>
                <TableCell>{emp.name}</TableCell>
                <TableCell align="right">{(emp.minutes / 60).toFixed(1)}h</TableCell>
                <TableCell align="right">${emp.earnings.toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table></TableContainer>
      </Paper>
    )}

    {sessions.filter(s => s.status !== 'completed').length > 0 && (
      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle2" gutterBottom>🟢 В процессе</Typography>
        {sessions.filter(s => s.status !== 'completed').map(s => (
          <Box key={s.id} display="flex" alignItems="center" gap={2} sx={{ py: 0.5 }}>
            <Chip label="In Progress" size="small" color="success" variant="outlined" />
            <Typography variant="body2">{s.employeeName || 'Unknown'}</Typography>
            <Typography variant="caption" color="text.secondary">Started: {s.startTime?.toDate?.()?.toLocaleString() || '—'}</Typography>
          </Box>
        ))}
      </Paper>
    )}

    {sessions.length === 0 && (
      <Paper sx={{ p: 4, textAlign: 'center' }}><Typography color="text.secondary">No time tracking sessions found</Typography></Paper>
    )}
  </>
);

// ═══════════════════════════════════════════════════════════
// TAB 7: CONTACTS
// ═══════════════════════════════════════════════════════════

interface ContactsTabProps {
  contacts: Contact[];
  site: SiteData;
  navigate: (path: string) => void;
}

export const ContactsTab: React.FC<ContactsTabProps> = ({ contacts, site, navigate }) => {
  const [search, setSearch] = React.useState('');
  const filtered = contacts.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <TextField placeholder="Поиск по имени..." size="small" value={search} onChange={e => setSearch(e.target.value)}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
          sx={{ minWidth: 250 }} />
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate(`/crm/contacts/new?linkedProject=${site.clientId}`)}>
          Добавить контакт
        </Button>
      </Box>
      {filtered.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">{search ? 'No contacts match your search' : 'No contacts linked to this project'}</Typography>
        </Paper>
      ) : (
        <List>
          {filtered.map(c => (
            <ListItem key={c.id} sx={{ bgcolor: 'background.default', mb: 1, borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
              <ListItemAvatar><Avatar sx={{ bgcolor: 'secondary.main' }}><PersonIcon /></Avatar></ListItemAvatar>
              <ListItemText
                primary={<Typography variant="body2" fontWeight={700}>{c.name}</Typography>}
                secondary={
                  <Box>
                    {c.roles && c.roles.length > 0 && <Typography variant="caption" color="text.secondary" display="block">{c.roles.join(', ')}</Typography>}
                    {c.phones && c.phones.length > 0 && (
                      <Typography variant="caption" display="block">
                        📞 {c.phones.map((p: { number?: string } | string, idx: number) => {
                          const phone = typeof p === 'string' ? p : p.number || '';
                          return (
                            <React.Fragment key={idx}>
                              {idx > 0 && ', '}
                              <Link href={`tel:${phone}`} color="primary" underline="hover">{phone}</Link>
                            </React.Fragment>
                          );
                        })}
                      </Typography>
                    )}
                    {c.emails && c.emails.length > 0 && (
                      <Typography variant="caption" color="text.secondary" display="block">
                        ✉️ {c.emails.map((e: { address?: string } | string) => typeof e === 'string' ? e : e.address || '').join(', ')}
                      </Typography>
                    )}
                  </Box>
                }
              />
            </ListItem>
          ))}
        </List>
      )}
    </>
  );
};

// ═══════════════════════════════════════════════════════════
// INFO tab sub-components
// ═══════════════════════════════════════════════════════════

interface PaymentScheduleCardProps {
  paymentSchedules: PaymentSchedule[];
}

export const PaymentScheduleCard: React.FC<PaymentScheduleCardProps> = ({ paymentSchedules }) => {
  if (paymentSchedules.length === 0) return null;

  return (
    <Paper sx={{ p: 3, mt: 3 }}>
      <Typography variant="h6" gutterBottom>💳 Payment Schedule</Typography>
      {paymentSchedules.map(ps => (
        <Box key={ps.id} sx={{ mb: 2 }}>
          <Box display="flex" justifyContent="space-between" mb={1}>
            <Typography variant="body2" color="text.secondary">
              Total: ${(ps.totalAmount || 0).toLocaleString()} | Paid: ${(ps.totalPaid || 0).toLocaleString()} | Pending: ${(ps.totalPending || 0).toLocaleString()}
            </Typography>
          </Box>
          <LinearProgress variant="determinate"
            value={ps.totalAmount > 0 ? Math.min(100, Math.round((ps.totalPaid / ps.totalAmount) * 100)) : 0}
            sx={{ height: 8, borderRadius: 4, mb: 2, bgcolor: '#e0e0e0', '& .MuiLinearProgress-bar': { bgcolor: '#4caf50', borderRadius: 4 } }} />
          {ps.milestones && ps.milestones.length > 0 && (
            <Table size="small">
              <TableHead><TableRow>
                <TableCell>Milestone</TableCell><TableCell align="right">Amount</TableCell>
                <TableCell align="right">Paid</TableCell><TableCell>Status</TableCell>
              </TableRow></TableHead>
              <TableBody>
                {ps.milestones.map(ms => (
                  <TableRow key={ms.id}>
                    <TableCell>{ms.milestoneName}</TableCell>
                    <TableCell align="right">${(ms.amount || 0).toLocaleString()}</TableCell>
                    <TableCell align="right">${(ms.paidAmount || 0).toLocaleString()}</TableCell>
                    <TableCell>
                      <Chip label={ms.status?.replace(/_/g, ' ')} size="small" color={
                        ms.status === 'paid' ? 'success' : ms.status === 'overdue' ? 'error' :
                        ms.status === 'invoiced' ? 'info' : ms.status === 'partially_paid' ? 'warning' : 'default'
                      } />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Box>
      ))}
    </Paper>
  );
};

interface NpsCardProps {
  npsRequests: NpsRequest[];
}

export const NpsCard: React.FC<NpsCardProps> = ({ npsRequests }) => {
  if (npsRequests.length === 0) return null;

  return (
    <Paper sx={{ p: 3, mt: 3 }}>
      <Typography variant="h6" gutterBottom>⭐ NPS & Reviews</Typography>
      {npsRequests.map(nps => (
        <Box key={nps.id} display="flex" alignItems="center" gap={2} sx={{ py: 1 }}>
          <Chip label={nps.status} size="small" color={nps.status === 'responded' ? 'success' : nps.status === 'sent' ? 'info' : 'default'} />
          {nps.score !== undefined && <Typography variant="body1" fontWeight={700}>Score: {nps.score}/10</Typography>}
          {nps.reviewText && <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>"{nps.reviewText}"</Typography>}
          <Typography variant="caption" color="text.secondary">Channel: {nps.channel}</Typography>
        </Box>
      ))}
    </Paper>
  );
};
