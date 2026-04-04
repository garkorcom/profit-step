import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
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
  Accordion,
  AccordionSummary,
  AccordionDetails,
  TextField,
  Button,
  Checkbox,
  FormControlLabel,
  LinearProgress,
  Avatar,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  ListItemSecondaryAction,
  Slider,
  Tab,
  Tabs,
  TableContainer,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  Home as HomeIcon,
  Timeline as TimelineIcon,
  Assignment as TaskIcon,
  Payment as PaymentIcon,
  PhotoLibrary as PhotoIcon,
  Comment as CommentIcon,
  CheckCircle as CheckCircleIcon,
  Schedule as ScheduleIcon,
  Build as BuildIcon,
  Palette as PaletteIcon,
  Plumbing as PlumbingIcon,
  MeetingRoom as DoorIcon,
  Business as BusinessIcon,
  AttachMoney as MoneyIcon,
} from '@mui/icons-material';

// Mock data based on Jim Dvorkin's estimate
const getClientData = (slug: string) => {
  // Parse slug to get client info (jim-dvorkin-2405 => Jim Dvorkin, unit 2405)
  if (slug === 'jim-dvorkin-2405') {
    return {
      id: '1',
      name: 'Jim Dvorkin',
      projectAddress: '17201 Collins Ave #2405, Sunny Isles',
      projectTitle: 'Full Renovation',
      estimateRange: '$101,400 - $113,800',
      currentStage: 'Design',
      progress: 15,
      unit: '#2405',
      startDate: '2026-04-01',
      estimatedCompletion: '2026-06-01',
    };
  }
  // Default fallback
  return {
    id: 'unknown',
    name: 'Client',
    projectAddress: 'Unknown Address',
    projectTitle: 'Project',
    estimateRange: '$0',
    currentStage: 'Planning',
    progress: 0,
    unit: '',
    startDate: '2026-04-01',
    estimatedCompletion: '2026-06-01',
  };
};

const estimateItems = [
  {
    id: 1,
    category: 'ПОЛЫ',
    icon: <HomeIcon />,
    items: [
      { name: 'Демонтаж плитки + стяжки', price: 9000, unit: '$2.50/SF', status: 'pending' },
      { name: 'Вывоз мусора (high-rise)', price: 3600, unit: '$1.00/SF', status: 'pending' },
      { name: 'Подъём материалов (25 этаж)', price: 5400, unit: '$1.50/SF', status: 'pending' },
      { name: 'Укладка плитки', price: 36000, unit: '$10.00/SF', status: 'pending' },
      { name: 'Baseboards снятие/установка', price: 5400, unit: '$1.50/SF', status: 'pending' },
    ],
    total: 59400,
    comments: [],
    approved: false,
  },
  {
    id: 2,
    category: 'MASTER BATHROOM',
    icon: <PlumbingIcon />,
    items: [
      { name: 'Полный демонтаж', price: 3000, unit: 'fixed', status: 'pending' },
      { name: 'Вывоз мусора', price: 500, unit: 'fixed', status: 'pending' },
      { name: 'Сантехника установка', price: 5000, unit: 'fixed', status: 'pending' },
      { name: 'Плитка стены + пол', price: 8000, unit: 'fixed', status: 'pending' },
      { name: 'Стеклянная душевая (custom)', price: 3500, unit: 'fixed', status: 'pending' },
      { name: 'Vanity + зеркало + освещение', price: 2500, unit: 'fixed', status: 'pending' },
      { name: 'Мелочи (аксессуары, затирка)', price: 2500, unit: 'fixed', status: 'pending' },
    ],
    total: 25000,
    comments: [],
    approved: false,
  },
  {
    id: 3,
    category: 'GUEST BATHROOM',
    icon: <PlumbingIcon />,
    items: [
      { name: 'Полный демонтаж', price: 2000, unit: 'fixed', status: 'pending' },
      { name: 'Вывоз', price: 400, unit: 'fixed', status: 'pending' },
      { name: 'Сантехника', price: 3500, unit: 'fixed', status: 'pending' },
      { name: 'Плитка стены + пол', price: 5000, unit: 'fixed', status: 'pending' },
      { name: 'Стеклянная душевая', price: 2500, unit: 'fixed', status: 'pending' },
      { name: 'Vanity + зеркало', price: 2000, unit: 'fixed', status: 'pending' },
      { name: 'Мелочи', price: 1600, unit: 'fixed', status: 'pending' },
    ],
    total: 17000,
    comments: [],
    approved: false,
  },
  {
    id: 4,
    category: 'ДВЕРИ',
    icon: <DoorIcon />,
    items: [
      { name: 'Демонтаж дверей + коробок (~10 шт)', price: 1500, unit: 'fixed', status: 'pending' },
      { name: 'Установка обратно после плитки', price: 2000, unit: 'fixed', status: 'pending' },
      { name: 'Подрезка дверей (if needed)', price: 500, unit: 'fixed', status: 'pending' },
      { name: 'Реставрация проёмов', price: 1500, unit: 'fixed', status: 'pending' },
    ],
    total: 5500,
    comments: [],
    approved: false,
  },
  {
    id: 5,
    category: 'ПОКРАСКА',
    icon: <PaletteIcon />,
    items: [
      { name: 'Подкраска стен после работ', price: 5400, unit: '$1.50/SF', status: 'pending' },
    ],
    total: 5400,
    comments: [],
    approved: false,
  },
  {
    id: 6,
    category: 'ПЕРЕНОС МЕБЕЛИ',
    icon: <BusinessIcon />,
    items: [
      { name: 'Перенос мебели (2 раза)', price: 2000, unit: 'fixed', status: 'pending' },
      { name: 'Упаковка/защита', price: 500, unit: 'fixed', status: 'pending' },
    ],
    total: 2500,
    comments: [],
    approved: false,
  },
];

const projectStages = [
  { name: 'Подпись', status: 'completed', progress: 100 },
  { name: 'Дизайн', status: 'current', progress: 60 },
  { name: 'Пермит', status: 'upcoming', progress: 0 },
  { name: 'Демонтаж', status: 'upcoming', progress: 0 },
  { name: 'Полы', status: 'upcoming', progress: 0 },
  { name: 'Ванные', status: 'upcoming', progress: 0 },
  { name: 'Двери', status: 'upcoming', progress: 0 },
  { name: 'Покраска', status: 'upcoming', progress: 0 },
  { name: 'Сдача', status: 'upcoming', progress: 0 },
];

const currentTasks = [
  { id: 1, task: 'Получить floor plan от дизайнера', responsible: 'Юля (Designer)', deadline: '2026-04-10', status: 'in-progress' },
  { id: 2, task: 'Выбрать плитку для полов', responsible: 'Client', deadline: '2026-04-12', status: 'pending' },
  { id: 3, task: 'Выбрать ванны, душевые, краны', responsible: 'Client', deadline: '2026-04-15', status: 'pending' },
  { id: 4, task: 'Согласовать baseboards', responsible: 'Client', deadline: '2026-04-08', status: 'pending' },
  { id: 5, task: 'Подписать контракт', responsible: 'Client', deadline: '2026-04-05', status: 'urgent' },
];

const paymentSchedule = [
  { stage: 'Contract Signing', amount: 15300, percentage: 15, status: 'pending', dueDate: '2026-04-05' },
  { stage: 'Design Completion', amount: 10200, percentage: 10, status: 'upcoming', dueDate: '2026-04-20' },
  { stage: 'Material Delivery', amount: 35700, percentage: 35, status: 'upcoming', dueDate: '2026-05-01' },
  { stage: 'Mid-Construction', amount: 25500, percentage: 25, status: 'upcoming', dueDate: '2026-05-15' },
  { stage: 'Project Completion', amount: 15300, percentage: 15, status: 'upcoming', dueDate: '2026-06-01' },
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

const ClientPortalPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const [tabValue, setTabValue] = useState(0);
  const [newComment, setNewComment] = useState<{ [key: number]: string }>({});
  const [timelineProgress, setTimelineProgress] = useState(1);

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const handleAddComment = (categoryId: number) => {
    if (newComment[categoryId]?.trim()) {
      // In real app, this would be an API call
      console.log(`Adding comment for category ${categoryId}: ${newComment[categoryId]}`);
      setNewComment(prev => ({ ...prev, [categoryId]: '' }));
    }
  };

  const handleApproveItem = (categoryId: number) => {
    // In real app, this would be an API call
    console.log(`Approving category ${categoryId}`);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return '#ff9800';
      case 'approved': return '#4caf50';
      case 'question': return '#2196f3';
      case 'declined': return '#f44336';
      default: return '#9e9e9e';
    }
  };

  const getTaskStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return '#4caf50';
      case 'in-progress': return '#2196f3';
      case 'pending': return '#ff9800';
      case 'urgent': return '#f44336';
      default: return '#9e9e9e';
    }
  };

  const getPaymentStatusColor = (status: string) => {
    switch (status) {
      case 'paid': return '#4caf50';
      case 'pending': return '#ff9800';
      case 'upcoming': return '#9e9e9e';
      case 'overdue': return '#f44336';
      default: return '#9e9e9e';
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
        <Paper elevation={2} sx={{ mb: 3, p: 3, borderRadius: 2 }}>
          <Grid container spacing={3} alignItems="center">
            <Grid size={{ xs: 12, md: 8 }}>
              <Typography variant="h4" gutterBottom sx={{ fontWeight: 'bold', color: '#2e7d32' }}>
                {clientData.name}
              </Typography>
              <Typography variant="h6" color="text.secondary" gutterBottom>
                {clientData.projectTitle}
              </Typography>
              <Typography variant="body1" color="text.secondary">
                📍 {clientData.projectAddress}
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }} sx={{ textAlign: { xs: 'left', md: 'right' } }}>
              <Typography variant="h5" sx={{ fontWeight: 'bold', color: '#2e7d32', mb: 1 }}>
                {clientData.estimateRange}
              </Typography>
              <Chip
                label={`${clientData.currentStage} • ${clientData.progress}% Complete`}
                color="primary"
                size="medium"
              />
            </Grid>
          </Grid>

          {/* Overall Progress */}
          <Box sx={{ mt: 3 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
              <Typography variant="body2" fontWeight="medium">Overall Progress</Typography>
              <Typography variant="body2" fontWeight="medium">{clientData.progress}%</Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={clientData.progress}
              sx={{ height: 8, borderRadius: 4 }}
            />
          </Box>
        </Paper>

        {/* Navigation Tabs */}
        <Paper elevation={1} sx={{ mb: 3 }}>
          <Tabs value={tabValue} onChange={handleTabChange} variant="scrollable" scrollButtons="auto">
            <Tab icon={<MoneyIcon />} label="Estimate" />
            <Tab icon={<TimelineIcon />} label="Timeline" />
            <Tab icon={<TaskIcon />} label="Tasks" />
            <Tab icon={<PaymentIcon />} label="Payments" />
            <Tab icon={<PhotoIcon />} label="Gallery" />
          </Tabs>
        </Paper>

        {/* Estimate Tab */}
        <TabPanel value={tabValue} index={0}>
          <Grid container spacing={3}>
            {estimateItems.map((category) => (
              <Grid size={{ xs: 12 }} key={category.id}>
                <Card elevation={2} sx={{ borderRadius: 2 }}>
                  <Accordion>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Box display="flex" alignItems="center" width="100%" pr={2}>
                        <Avatar sx={{ bgcolor: '#2e7d32', mr: 2, width: 48, height: 48 }}>
                          {category.icon}
                        </Avatar>
                        <Box flexGrow={1}>
                          <Typography variant="h6" fontWeight="bold">
                            {category.category}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {category.items.length} items • ${category.total.toLocaleString()}
                          </Typography>
                        </Box>
                        <Chip
                          label={category.approved ? "Approved" : "Pending Review"}
                          color={category.approved ? "success" : "warning"}
                          size="small"
                        />
                      </Box>
                    </AccordionSummary>
                    <AccordionDetails>
                      <TableContainer>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Work Item</TableCell>
                              <TableCell align="right">Rate</TableCell>
                              <TableCell align="right">Amount</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {category.items.map((item, index) => (
                              <TableRow key={index}>
                                <TableCell>{item.name}</TableCell>
                                <TableCell align="right">{item.unit}</TableCell>
                                <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                                  ${item.price.toLocaleString()}
                                </TableCell>
                              </TableRow>
                            ))}
                            <TableRow>
                              <TableCell colSpan={2} sx={{ fontWeight: 'bold', borderTop: 2 }}>
                                TOTAL {category.category}
                              </TableCell>
                              <TableCell align="right" sx={{ fontWeight: 'bold', fontSize: '1.1rem', borderTop: 2 }}>
                                ${category.total.toLocaleString()}
                              </TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </TableContainer>

                      <Divider sx={{ my: 2 }} />

                      {/* Comments Section */}
                      <Typography variant="subtitle1" gutterBottom fontWeight="bold">
                        Questions & Comments
                      </Typography>

                      <Box display="flex" gap={1} mb={2}>
                        <TextField
                          fullWidth
                          size="small"
                          placeholder="Ask a question or leave a comment..."
                          value={newComment[category.id] || ''}
                          onChange={(e) => setNewComment(prev => ({ ...prev, [category.id]: e.target.value }))}
                        />
                        <Button
                          variant="contained"
                          size="small"
                          onClick={() => handleAddComment(category.id)}
                          disabled={!newComment[category.id]?.trim()}
                        >
                          Add
                        </Button>
                      </Box>

                      {/* Approval Checkbox */}
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={category.approved}
                            onChange={() => handleApproveItem(category.id)}
                            color="success"
                          />
                        }
                        label={
                          <Typography fontWeight="medium">
                            I approve this section of work
                          </Typography>
                        }
                      />
                    </AccordionDetails>
                  </Accordion>
                </Card>
              </Grid>
            ))}
          </Grid>
        </TabPanel>

        {/* Timeline Tab */}
        <TabPanel value={tabValue} index={1}>
          <Card elevation={2} sx={{ borderRadius: 2, p: 3 }}>
            <Typography variant="h5" gutterBottom fontWeight="bold">
              Project Timeline
            </Typography>

            <Box sx={{ px: 2, py: 4 }}>
              <Slider
                value={timelineProgress}
                onChange={(e, value) => setTimelineProgress(value as number)}
                min={0}
                max={projectStages.length - 1}
                step={1}
                marks={projectStages.map((stage, index) => ({
                  value: index,
                  label: stage.name,
                }))}
                valueLabelDisplay="off"
                sx={{ mb: 4 }}
              />
            </Box>

            <Grid container spacing={2}>
              {projectStages.map((stage, index) => (
                <Grid size={{ xs: 6, sm: 4, md: 3 }} key={index}>
                  <Card
                    variant="outlined"
                    sx={{
                      textAlign: 'center',
                      p: 2,
                      backgroundColor: stage.status === 'current' ? '#e8f5e8' :
                                    stage.status === 'completed' ? '#f0f9f0' : '#fafafa',
                      borderColor: stage.status === 'current' ? '#2e7d32' : '#e0e0e0',
                      borderWidth: stage.status === 'current' ? 2 : 1,
                    }}
                  >
                    <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                      {stage.name}
                    </Typography>
                    <LinearProgress
                      variant="determinate"
                      value={stage.progress}
                      sx={{ mb: 1, height: 6, borderRadius: 3 }}
                      color={stage.status === 'completed' ? 'success' : 'primary'}
                    />
                    <Typography variant="caption" color="text.secondary">
                      {stage.progress}%
                    </Typography>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </Card>
        </TabPanel>

        {/* Tasks Tab */}
        <TabPanel value={tabValue} index={2}>
          <Card elevation={2} sx={{ borderRadius: 2 }}>
            <CardContent>
              <Typography variant="h5" gutterBottom fontWeight="bold">
                Current Action Items
              </Typography>

              <List>
                {currentTasks.map((task) => (
                  <React.Fragment key={task.id}>
                    <ListItem>
                      <ListItemIcon>
                        <Avatar
                          sx={{
                            bgcolor: getTaskStatusColor(task.status),
                            width: 32,
                            height: 32
                          }}
                        >
                          <TaskIcon sx={{ fontSize: 18 }} />
                        </Avatar>
                      </ListItemIcon>
                      <ListItemText
                        primary={task.task}
                        secondary={`Responsible: ${task.responsible} • Due: ${task.deadline}`}
                      />
                      <ListItemSecondaryAction>
                        <Chip
                          label={task.status}
                          size="small"
                          sx={{
                            backgroundColor: getTaskStatusColor(task.status),
                            color: 'white',
                            textTransform: 'capitalize'
                          }}
                        />
                      </ListItemSecondaryAction>
                    </ListItem>
                    <Divider />
                  </React.Fragment>
                ))}
              </List>
            </CardContent>
          </Card>
        </TabPanel>

        {/* Payments Tab */}
        <TabPanel value={tabValue} index={3}>
          <Card elevation={2} sx={{ borderRadius: 2 }}>
            <CardContent>
              <Typography variant="h5" gutterBottom fontWeight="bold">
                Payment Schedule
              </Typography>

              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Payment Stage</TableCell>
                      <TableCell align="center">Percentage</TableCell>
                      <TableCell align="right">Amount</TableCell>
                      <TableCell align="center">Due Date</TableCell>
                      <TableCell align="center">Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {paymentSchedule.map((payment, index) => (
                      <TableRow key={index}>
                        <TableCell>{payment.stage}</TableCell>
                        <TableCell align="center">{payment.percentage}%</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                          ${payment.amount.toLocaleString()}
                        </TableCell>
                        <TableCell align="center">{payment.dueDate}</TableCell>
                        <TableCell align="center">
                          <Chip
                            label={payment.status}
                            size="small"
                            sx={{
                              backgroundColor: getPaymentStatusColor(payment.status),
                              color: 'white',
                              textTransform: 'capitalize'
                            }}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>

              <Box mt={3} p={2} sx={{ backgroundColor: '#f0f9f0', borderRadius: 1 }}>
                <Typography variant="body1" fontWeight="bold" color="success.dark">
                  💡 Next Payment Due: ${paymentSchedule[0].amount.toLocaleString()} on {paymentSchedule[0].dueDate}
                </Typography>
                <Typography variant="body2" color="text.secondary" mt={1}>
                  Contract signing payment to begin the project
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </TabPanel>

        {/* Gallery Tab */}
        <TabPanel value={tabValue} index={4}>
          <Card elevation={2} sx={{ borderRadius: 2 }}>
            <CardContent>
              <Typography variant="h5" gutterBottom fontWeight="bold">
                Project Gallery
              </Typography>

              <Grid container spacing={3}>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Paper
                    elevation={1}
                    sx={{
                      p: 4,
                      textAlign: 'center',
                      backgroundColor: '#f9f9f9',
                      borderRadius: 2,
                      minHeight: 200,
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center'
                    }}
                  >
                    <PhotoIcon sx={{ fontSize: 48, color: '#bbb', mb: 2 }} />
                    <Typography variant="h6" color="text.secondary" gutterBottom>
                      Design Renders
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      3D renders and design plans will appear here once completed
                    </Typography>
                  </Paper>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Paper
                    elevation={1}
                    sx={{
                      p: 4,
                      textAlign: 'center',
                      backgroundColor: '#f9f9f9',
                      borderRadius: 2,
                      minHeight: 200,
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center'
                    }}
                  >
                    <BuildIcon sx={{ fontSize: 48, color: '#bbb', mb: 2 }} />
                    <Typography variant="h6" color="text.secondary" gutterBottom>
                      Progress Photos
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Construction progress photos will be uploaded here
                    </Typography>
                  </Paper>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </TabPanel>
      </Container>
    </Box>
  );
};

export default ClientPortalPage;