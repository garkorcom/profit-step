import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Container,
  Typography,
  Paper,
  Grid,
  Card,
  CardContent,
  Divider,
  Chip,
  IconButton,
  Button,
  TextField,
  Table,
  TableContainer,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  LinearProgress,
  Avatar,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Tab,
  Tabs,
  Alert,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  Home as HomeIcon,
  Timeline as TimelineIcon,
  Assignment as TaskIcon,
  Payment as PaymentIcon,
  Notes as NotesIcon,
  Link as LinkIcon,
  Visibility as VisibilityIcon,
  AttachMoney as MoneyIcon,
  TrendingUp as ProfitIcon,
  Business as InternalIcon,
  Person as ClientIcon,
  Plumbing as PlumbingIcon,
  Palette as PaletteIcon,
  MeetingRoom as DoorIcon,
  Build as BuildIcon,
} from '@mui/icons-material';

// Client data - this would come from API in real app
const getClientById = (id: string) => {
  if (id === '1' || id === 'jim-dvorkin') {
    return {
      id: '1',
      name: 'Jim Dvorkin',
      projectAddress: '17201 Collins Ave #2405, Sunny Isles',
      projectTitle: 'Full Renovation',
      currentStage: 'Design',
      progress: 15,
      unit: '#2405',
      startDate: '2026-04-01',
      estimatedCompletion: '2026-06-01',
      portalSlug: 'jim-dvorkin-2405',
      // Internal estimates (our costs)
      internalEstimate: {
        labor: 65000,
        materials: 45000,
        subcontractors: 18000,
        permits: 2400,
        overhead: 8000,
        total: 138400,
      },
      // Client estimate (what we charge)
      clientEstimate: {
        total: 184000,
        range: '$101,400 - $113,800', // This is the displayed range, actual is higher
      },
      // Margin calculations
      margin: {
        amount: 45600, // 184000 - 138400
        percentage: 24.8, // (45600 / 184000) * 100
      },
      internalNotes: [
        { id: 1, content: 'High-end client, prefers premium materials. Can charge 25%+ markup.', author: 'Абрамов', date: '2026-04-01' },
        { id: 2, content: 'Elevator access requires special scheduling - factor in extra time for material delivery.', author: 'Foreman', date: '2026-04-02' },
        { id: 3, content: 'Client mentioned possible additional work on balcony - keep good relationship.', author: 'Абрамов', date: '2026-04-03' },
      ],
    };
  }
  return null;
};

const internalEstimateBreakdown = [
  {
    id: 1,
    category: 'ПОЛЫ (Internal)',
    icon: <HomeIcon />,
    internal: {
      laborCost: 25000,
      materialCost: 22000,
      subcontractCost: 0,
      total: 47000,
    },
    client: {
      total: 59400,
    },
    markup: 12400,
    marginPercent: 26.4,
  },
  {
    id: 2,
    category: 'MASTER BATHROOM (Internal)',
    icon: <PlumbingIcon />,
    internal: {
      laborCost: 12000,
      materialCost: 8000,
      subcontractCost: 0,
      total: 20000,
    },
    client: {
      total: 25000,
    },
    markup: 5000,
    marginPercent: 25.0,
  },
  {
    id: 3,
    category: 'GUEST BATHROOM (Internal)',
    icon: <PlumbingIcon />,
    internal: {
      laborCost: 8500,
      materialCost: 5500,
      subcontractCost: 0,
      total: 14000,
    },
    client: {
      total: 17000,
    },
    markup: 3000,
    marginPercent: 21.4,
  },
  {
    id: 4,
    category: 'ДВЕРИ (Internal)',
    icon: <DoorIcon />,
    internal: {
      laborCost: 3000,
      materialCost: 500,
      subcontractCost: 0,
      total: 3500,
    },
    client: {
      total: 5500,
    },
    markup: 2000,
    marginPercent: 57.1,
  },
  {
    id: 5,
    category: 'ПОКРАСКА (Internal)',
    icon: <PaletteIcon />,
    internal: {
      laborCost: 3500,
      materialCost: 900,
      subcontractCost: 0,
      total: 4400,
    },
    client: {
      total: 5400,
    },
    markup: 1000,
    marginPercent: 22.7,
  },
  {
    id: 6,
    category: 'ПЕРЕНОС МЕБЕЛИ (Internal)',
    icon: <BuildIcon />,
    internal: {
      laborCost: 1500,
      materialCost: 100,
      subcontractCost: 0,
      total: 1600,
    },
    client: {
      total: 2500,
    },
    markup: 900,
    marginPercent: 56.3,
  },
];

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`simple-tabpanel-${index}`}
      aria-labelledby={`simple-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

const ClientDashboardPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tabValue, setTabValue] = useState(0);
  const [newNote, setNewNote] = useState('');

  const client = getClientById(id || '');

  useEffect(() => {
    if (!client) {
      // In real app, you might want to show a 404 or redirect
      console.error('Client not found:', id);
    }
  }, [client, id]);

  if (!client) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">Client not found</Alert>
      </Box>
    );
  }

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const handleViewPortal = () => {
    window.open(`/portal/${client.portalSlug}`, '_blank');
  };

  const handleAddNote = () => {
    if (newNote.trim()) {
      // In real app, this would be an API call
      console.log('Adding internal note:', newNote);
      setNewNote('');
    }
  };

  return (
    <Box sx={{
      minHeight: '100vh',
      backgroundColor: '#f5f7fa',
      py: { xs: 2, md: 4 }
    }}>
      <Container maxWidth="lg">
        {/* Header */}
        <Paper elevation={2} sx={{ mb: 3, p: { xs: 2, md: 3 }, borderRadius: 2 }}>
          <Grid container spacing={{ xs: 2, md: 3 }} alignItems="center">
            <Grid size={{ xs: 12, md: 6 }}>
              <Box display="flex" alignItems="center" mb={1}>
                <InternalIcon sx={{ mr: 1, color: '#1976d2' }} />
                <Typography variant="h5" sx={{ fontWeight: 'bold', color: '#1976d2' }}>
                  INTERNAL DASHBOARD
                </Typography>
              </Box>
              <Typography variant="h4" gutterBottom sx={{ fontWeight: 'bold', color: '#2e7d32' }}>
                {client.name}
              </Typography>
              <Typography variant="h6" color="text.secondary" gutterBottom>
                {client.projectTitle}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                📍 {client.projectAddress}
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }} sx={{ textAlign: { xs: 'center', md: 'right' } }}>
              <Box display="flex" flexDirection={{ xs: 'column', md: 'column' }} gap={2}>
                <Button
                  variant="outlined"
                  startIcon={<VisibilityIcon />}
                  onClick={handleViewPortal}
                  sx={{ alignSelf: { xs: 'center', md: 'flex-end' } }}
                >
                  View Client Portal
                </Button>
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    Internal Cost:
                  </Typography>
                  <Typography variant="h6" color="error.main" fontWeight="bold">
                    ${client.internalEstimate.total.toLocaleString()}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    Client Price:
                  </Typography>
                  <Typography variant="h6" color="success.main" fontWeight="bold">
                    ${client.clientEstimate.total.toLocaleString()}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    Profit Margin:
                  </Typography>
                  <Typography variant="h5" color="primary.main" fontWeight="bold">
                    ${client.margin.amount.toLocaleString()} ({client.margin.percentage}%)
                  </Typography>
                </Box>
              </Box>
            </Grid>
          </Grid>

          {/* Progress Bar */}
          <Box sx={{ mt: { xs: 2, md: 3 } }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
              <Typography variant="body2" fontWeight="medium">
                Project Progress: {client.currentStage}
              </Typography>
              <Typography variant="body2" fontWeight="medium">{client.progress}%</Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={client.progress}
              sx={{ height: { xs: 10, md: 8 }, borderRadius: 4 }}
            />
          </Box>
        </Paper>

        {/* Navigation Tabs */}
        <Paper elevation={1} sx={{ mb: 3 }}>
          <Tabs
            value={tabValue}
            onChange={handleTabChange}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
          >
            <Tab icon={<MoneyIcon />} label="Dual Estimates" iconPosition="top" />
            <Tab icon={<ProfitIcon />} label="Margin Analysis" iconPosition="top" />
            <Tab icon={<NotesIcon />} label="Internal Notes" iconPosition="top" />
            <Tab icon={<TimelineIcon />} label="Timeline" iconPosition="top" />
          </Tabs>
        </Paper>

        {/* Dual Estimates Tab */}
        <TabPanel value={tabValue} index={0}>
          <Grid container spacing={3}>
            {internalEstimateBreakdown.map((category) => (
              <Grid size={{ xs: 12 }} key={category.id}>
                <Card elevation={2} sx={{ borderRadius: 2 }}>
                  <Accordion defaultExpanded={category.id <= 2}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Box display="flex" alignItems="center" width="100%" pr={2}>
                        <Avatar sx={{ bgcolor: '#1976d2', mr: 2, width: 48, height: 48 }}>
                          {category.icon}
                        </Avatar>
                        <Box flexGrow={1}>
                          <Typography variant="h6" fontWeight="bold">
                            {category.category}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            Margin: ${category.markup.toLocaleString()} ({category.marginPercent}%)
                          </Typography>
                        </Box>
                        <Box sx={{ textAlign: 'right' }}>
                          <Typography variant="body2" color="error.main">
                            Internal: ${category.internal.total.toLocaleString()}
                          </Typography>
                          <Typography variant="body2" color="success.main">
                            Client: ${category.client.total.toLocaleString()}
                          </Typography>
                        </Box>
                      </Box>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Grid container spacing={2}>
                        <Grid size={{ xs: 12, md: 6 }}>
                          <Paper variant="outlined" sx={{ p: 2, backgroundColor: '#ffebee' }}>
                            <Typography variant="h6" color="error.main" gutterBottom>
                              <InternalIcon sx={{ mr: 1 }} />
                              Internal Costs
                            </Typography>
                            <TableContainer>
                              <Table size="small">
                                <TableBody>
                                  <TableRow>
                                    <TableCell>Labor</TableCell>
                                    <TableCell align="right">${category.internal.laborCost.toLocaleString()}</TableCell>
                                  </TableRow>
                                  <TableRow>
                                    <TableCell>Materials</TableCell>
                                    <TableCell align="right">${category.internal.materialCost.toLocaleString()}</TableCell>
                                  </TableRow>
                                  <TableRow>
                                    <TableCell>Subcontractors</TableCell>
                                    <TableCell align="right">${category.internal.subcontractCost.toLocaleString()}</TableCell>
                                  </TableRow>
                                  <TableRow>
                                    <TableCell sx={{ fontWeight: 'bold', borderTop: 2 }}>Total Cost</TableCell>
                                    <TableCell align="right" sx={{ fontWeight: 'bold', fontSize: '1.1rem', borderTop: 2 }}>
                                      ${category.internal.total.toLocaleString()}
                                    </TableCell>
                                  </TableRow>
                                </TableBody>
                              </Table>
                            </TableContainer>
                          </Paper>
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                          <Paper variant="outlined" sx={{ p: 2, backgroundColor: '#e8f5e8' }}>
                            <Typography variant="h6" color="success.main" gutterBottom>
                              <ClientIcon sx={{ mr: 1 }} />
                              Client Pricing
                            </Typography>
                            <TableContainer>
                              <Table size="small">
                                <TableBody>
                                  <TableRow>
                                    <TableCell>Client Price</TableCell>
                                    <TableCell align="right">${category.client.total.toLocaleString()}</TableCell>
                                  </TableRow>
                                  <TableRow>
                                    <TableCell>Our Cost</TableCell>
                                    <TableCell align="right">-${category.internal.total.toLocaleString()}</TableCell>
                                  </TableRow>
                                  <TableRow>
                                    <TableCell sx={{ fontWeight: 'bold', borderTop: 2, color: 'primary.main' }}>Profit</TableCell>
                                    <TableCell align="right" sx={{ fontWeight: 'bold', fontSize: '1.1rem', borderTop: 2, color: 'primary.main' }}>
                                      ${category.markup.toLocaleString()}
                                    </TableCell>
                                  </TableRow>
                                  <TableRow>
                                    <TableCell sx={{ fontWeight: 'bold', color: 'primary.main' }}>Margin %</TableCell>
                                    <TableCell align="right" sx={{ fontWeight: 'bold', fontSize: '1.1rem', color: 'primary.main' }}>
                                      {category.marginPercent}%
                                    </TableCell>
                                  </TableRow>
                                </TableBody>
                              </Table>
                            </TableContainer>
                          </Paper>
                        </Grid>
                      </Grid>
                    </AccordionDetails>
                  </Accordion>
                </Card>
              </Grid>
            ))}
          </Grid>
        </TabPanel>

        {/* Margin Analysis Tab */}
        <TabPanel value={tabValue} index={1}>
          <Card elevation={2} sx={{ borderRadius: 2, p: 3 }}>
            <Typography variant="h5" gutterBottom fontWeight="bold" color="primary">
              Profit Margin Analysis
            </Typography>

            <Alert severity="success" sx={{ mb: 3 }}>
              <Typography variant="body1">
                <strong>Excellent margins!</strong> Overall project margin of {client.margin.percentage}%
                exceeds our 20% target. Total profit: ${client.margin.amount.toLocaleString()}
              </Typography>
            </Alert>

            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Category</TableCell>
                    <TableCell align="right">Internal Cost</TableCell>
                    <TableCell align="right">Client Price</TableCell>
                    <TableCell align="right">Profit</TableCell>
                    <TableCell align="right">Margin %</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {internalEstimateBreakdown.map((category) => (
                    <TableRow key={category.id}>
                      <TableCell>{category.category.replace(' (Internal)', '')}</TableCell>
                      <TableCell align="right" sx={{ color: 'error.main' }}>
                        ${category.internal.total.toLocaleString()}
                      </TableCell>
                      <TableCell align="right" sx={{ color: 'success.main' }}>
                        ${category.client.total.toLocaleString()}
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                        ${category.markup.toLocaleString()}
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                        {category.marginPercent}%
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold', fontSize: '1.1rem', borderTop: 2 }}>
                      TOTAL PROJECT
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 'bold', color: 'error.main', borderTop: 2 }}>
                      ${client.internalEstimate.total.toLocaleString()}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 'bold', color: 'success.main', borderTop: 2 }}>
                      ${client.clientEstimate.total.toLocaleString()}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 'bold', color: 'primary.main', fontSize: '1.2rem', borderTop: 2 }}>
                      ${client.margin.amount.toLocaleString()}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 'bold', color: 'primary.main', fontSize: '1.2rem', borderTop: 2 }}>
                      {client.margin.percentage}%
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
        </TabPanel>

        {/* Internal Notes Tab */}
        <TabPanel value={tabValue} index={2}>
          <Card elevation={2} sx={{ borderRadius: 2, p: 3 }}>
            <Typography variant="h5" gutterBottom fontWeight="bold" color="error.main">
              🔒 Internal Notes (Team Only)
            </Typography>

            <Alert severity="warning" sx={{ mb: 3 }}>
              These notes are private and will never be visible to the client
            </Alert>

            {/* Add new note */}
            <Paper variant="outlined" sx={{ p: 2, mb: 3, backgroundColor: '#f8f9fa' }}>
              <Typography variant="h6" gutterBottom>Add Internal Note</Typography>
              <Box display="flex" gap={1}>
                <TextField
                  fullWidth
                  multiline
                  rows={2}
                  placeholder="Add internal note (team observations, pricing strategy, client behavior, etc.)"
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                />
                <Button
                  variant="contained"
                  onClick={handleAddNote}
                  disabled={!newNote.trim()}
                  sx={{ minWidth: 100 }}
                >
                  Add
                </Button>
              </Box>
            </Paper>

            {/* Show existing notes */}
            <List>
              {client.internalNotes.map((note) => (
                <React.Fragment key={note.id}>
                  <ListItem alignItems="flex-start">
                    <ListItemIcon>
                      <Avatar sx={{ bgcolor: '#1976d2', width: 40, height: 40 }}>
                        <NotesIcon />
                      </Avatar>
                    </ListItemIcon>
                    <ListItemText
                      primary={
                        <Box display="flex" justifyContent="space-between" alignItems="flex-start">
                          <Typography variant="body1" fontWeight="bold">
                            {note.author}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {note.date}
                          </Typography>
                        </Box>
                      }
                      secondary={
                        <Typography variant="body2" sx={{ mt: 1 }}>
                          {note.content}
                        </Typography>
                      }
                    />
                  </ListItem>
                  <Divider />
                </React.Fragment>
              ))}
            </List>
          </Card>
        </TabPanel>

        {/* Timeline Tab */}
        <TabPanel value={tabValue} index={3}>
          <Card elevation={2} sx={{ borderRadius: 2, p: 3 }}>
            <Typography variant="h5" gutterBottom fontWeight="bold">
              Internal Timeline View
            </Typography>

            <Alert severity="info" sx={{ mb: 3 }}>
              This is the same timeline as shown to the client, but with internal completion targets and notes
            </Alert>

            <Box sx={{ textAlign: 'center', py: 4 }}>
              <Typography variant="h6" color="text.secondary">
                Internal timeline integration coming soon...
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Will show internal deadlines, crew assignments, and material delivery schedules
              </Typography>
            </Box>
          </Card>
        </TabPanel>
      </Container>
    </Box>
  );
};

export default ClientDashboardPage;