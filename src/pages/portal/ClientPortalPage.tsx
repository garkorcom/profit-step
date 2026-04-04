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
    category: 'ПОЛЫ (3,600 SF + балконы)',
    icon: <HomeIcon />,
    items: [
      { name: 'Демонтаж плитки + стяжки', price: 9000, unit: '$2.50/SF', status: 'pending' },
      { name: 'Вывоз мусора (high-rise)', price: 3600, unit: '$1.00/SF', status: 'pending' },
      { name: 'Подъём материалов (25 этаж)', price: 5400, unit: '$1.50/SF', status: 'pending' },
      { name: 'Укладка плитки', price: 36000, unit: '$10.00/SF', status: 'pending' },
      { name: 'Baseboards снятие/установка', price: 5400, unit: '$1.50/SF', status: 'pending' },
    ],
    total: 59400,
    comments: [
      { id: 1, text: 'What type of tile options do we have?', author: 'Client', date: '2026-04-04', reply: 'We\'ll provide 3 premium options tomorrow - Юля' },
    ],
    approved: false,
    status: 'pending',
  },
  {
    id: 2,
    category: 'MASTER BATHROOM (~$25,000)',
    icon: <PlumbingIcon />,
    items: [
      { name: 'Полный демонтаж: ванна, стекло, душевая, краны, унитаз, bidet, vanity', price: 3000, unit: 'fixed', status: 'pending' },
      { name: 'Вывоз мусора', price: 500, unit: 'fixed', status: 'pending' },
      { name: 'Сантехника: установка новой ванны, душа, кранов, унитаза', price: 5000, unit: 'fixed', status: 'pending' },
      { name: 'Плитка стены + пол', price: 8000, unit: 'fixed', status: 'pending' },
      { name: 'Стеклянная душевая (custom)', price: 3500, unit: 'fixed', status: 'pending' },
      { name: 'Vanity + зеркало + освещение', price: 2500, unit: 'fixed', status: 'pending' },
      { name: 'Мелочи (аксессуары, затирка, герметик)', price: 2500, unit: 'fixed', status: 'pending' },
    ],
    total: 25000,
    comments: [
      { id: 1, text: 'Can we see samples of the vanity options?', author: 'Client', date: '2026-04-03', reply: '' },
    ],
    approved: false,
    status: 'question',
  },
  {
    id: 3,
    category: 'GUEST BATHROOM (~$15,000-20,000)',
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
    status: 'pending',
  },
  {
    id: 4,
    category: 'ДВЕРИ',
    icon: <DoorIcon />,
    items: [
      { name: 'Демонтаж межкомнатных дверей + коробок (~10 шт)', price: 1500, unit: 'fixed', status: 'pending' },
      { name: 'Упаковка и хранение полотен', price: 0, unit: 'incl', status: 'pending' },
      { name: 'Установка обратно после плитки', price: 2000, unit: 'fixed', status: 'pending' },
      { name: 'Подрезка дверей (if needed)', price: 500, unit: 'fixed', status: 'pending' },
      { name: 'Реставрация проёмов (шпаклёвка, подкраска)', price: 1500, unit: 'fixed', status: 'pending' },
    ],
    total: 5500,
    comments: [],
    approved: true,
    status: 'approved',
  },
  {
    id: 5,
    category: 'ПОКРАСКА',
    icon: <PaletteIcon />,
    items: [
      { name: 'Подкраска стен после работ', price: 5400, unit: '$1.50/SF', status: 'pending' },
      { name: 'Полная перекраска (if needed)', price: 10800, unit: '$3.00/SF', status: 'pending' },
    ],
    total: 5400,
    comments: [
      { id: 1, text: 'Do we need to decide on paint colors now?', author: 'Client', date: '2026-04-04', reply: 'We can choose colors closer to painting stage - Абрамов' },
    ],
    approved: false,
    status: 'pending',
  },
  {
    id: 6,
    category: 'ПЕРЕНОС МЕБЕЛИ',
    icon: <BusinessIcon />,
    items: [
      { name: 'Перенос мебели (2 раза: лево→право→обратно)', price: 2000, unit: 'fixed', status: 'pending' },
      { name: 'Упаковка/защита', price: 500, unit: 'fixed', status: 'pending' },
    ],
    total: 2500,
    comments: [],
    approved: false,
    status: 'pending',
  },
];

const projectStages = [
  { name: 'Подпись', status: 'completed', progress: 100, icon: '✅', description: 'Contract signed' },
  { name: 'Дизайн', status: 'current', progress: 60, icon: '🔵', description: 'Floor plan in progress' },
  { name: 'Пермит', status: 'upcoming', progress: 0, icon: '⬜', description: 'City permits pending' },
  { name: 'Демонтаж', status: 'upcoming', progress: 0, icon: '⬜', description: 'Demo & teardown' },
  { name: 'Полы', status: 'upcoming', progress: 0, icon: '⬜', description: 'Flooring installation' },
  { name: 'Ванные', status: 'upcoming', progress: 0, icon: '⬜', description: 'Bathroom renovation' },
  { name: 'Двери', status: 'upcoming', progress: 0, icon: '⬜', description: 'Doors & trim' },
  { name: 'Покраска', status: 'upcoming', progress: 0, icon: '⬜', description: 'Painting & finishing' },
  { name: 'Сдача', status: 'upcoming', progress: 0, icon: '⬜', description: 'Final delivery' },
];

const currentTasks = [
  {
    id: 1,
    task: 'Подписать контракт',
    responsible: 'Client',
    deadline: '2026-04-05',
    status: 'urgent',
    description: 'Contract signing payment to begin the project'
  },
  {
    id: 2,
    task: 'Получить floor plan от дизайнера',
    responsible: 'Юля (Designer)',
    deadline: '2026-04-10',
    status: 'in-progress',
    description: 'Complete architectural plans for permit submission'
  },
  {
    id: 3,
    task: 'Выбрать плитку для полов',
    responsible: 'Client',
    deadline: '2026-04-12',
    status: 'pending',
    description: 'Choose tile options for 3,600 SF flooring'
  },
  {
    id: 4,
    task: 'Выбрать ванны, душевые, краны',
    responsible: 'Client',
    deadline: '2026-04-15',
    status: 'pending',
    description: 'Select fixtures for Master & Guest bathrooms'
  },
  {
    id: 5,
    task: 'Согласовать baseboards',
    responsible: 'Client',
    deadline: '2026-04-08',
    status: 'pending',
    description: 'Approve baseboard style and finish'
  },
  {
    id: 6,
    task: 'Выбрать краску',
    responsible: 'Client',
    deadline: '2026-04-20',
    status: 'pending',
    description: 'Select paint colors for all rooms'
  },
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

  const clientData = getClientData(slug || '');

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
        <Paper elevation={2} sx={{ mb: 3, p: { xs: 2, md: 3 }, borderRadius: 2 }}>
          <Grid container spacing={{ xs: 2, md: 3 }} alignItems="center">
            <Grid size={{ xs: 12, md: 8 }}>
              <Typography
                variant="h4"
                gutterBottom
                sx={{
                  fontWeight: 'bold',
                  color: '#2e7d32',
                  fontSize: { xs: '1.5rem', md: '2.125rem' }
                }}
              >
                {clientData.name}
              </Typography>
              <Typography
                variant="h6"
                color="text.secondary"
                gutterBottom
                sx={{ fontSize: { xs: '1rem', md: '1.25rem' } }}
              >
                {clientData.projectTitle}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center' }}>
                📍 {clientData.projectAddress}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                Start: {clientData.startDate} • Est. Completion: {clientData.estimatedCompletion}
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }} sx={{ textAlign: { xs: 'center', md: 'right' } }}>
              <Typography
                variant="h5"
                sx={{
                  fontWeight: 'bold',
                  color: '#2e7d32',
                  mb: 1,
                  fontSize: { xs: '1.25rem', md: '1.5rem' }
                }}
              >
                {clientData.estimateRange}
              </Typography>
              <Chip
                label={`${clientData.currentStage} • ${clientData.progress}% Complete`}
                color="primary"
                size="medium"
                sx={{ mb: { xs: 2, md: 0 } }}
              />
            </Grid>
          </Grid>

          {/* Overall Progress */}
          <Box sx={{ mt: { xs: 2, md: 3 } }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
              <Typography variant="body2" fontWeight="medium">Overall Progress</Typography>
              <Typography variant="body2" fontWeight="medium">{clientData.progress}%</Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={clientData.progress}
              sx={{ height: { xs: 10, md: 8 }, borderRadius: 4 }}
            />
          </Box>
        </Paper>

        {/* Navigation Tabs */}
        <Paper elevation={1} sx={{ mb: 3, position: 'sticky', top: 0, zIndex: 10 }}>
          <Tabs
            value={tabValue}
            onChange={handleTabChange}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
            sx={{
              '& .MuiTab-root': {
                minHeight: { xs: 60, md: 72 },
                fontSize: { xs: '0.8rem', md: '0.875rem' }
              }
            }}
          >
            <Tab icon={<MoneyIcon />} label="Estimate" iconPosition="top" />
            <Tab icon={<TimelineIcon />} label="Timeline" iconPosition="top" />
            <Tab icon={<TaskIcon />} label="Tasks" iconPosition="top" />
            <Tab icon={<PaymentIcon />} label="Payments" iconPosition="top" />
            <Tab icon={<PhotoIcon />} label="Gallery" iconPosition="top" />
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
                          label={category.status === 'approved' ? "✅ Approved" :
                                 category.status === 'question' ? "❓ Question" :
                                 "⏳ Pending Review"}
                          color={category.status === 'approved' ? "success" :
                                 category.status === 'question' ? "info" : "warning"}
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

                      {/* Show existing comments */}
                      {category.comments && category.comments.length > 0 && (
                        <Box mb={2}>
                          {category.comments.map((comment: any) => (
                            <Paper key={comment.id} variant="outlined" sx={{ p: 2, mb: 1, backgroundColor: '#f8f9fa' }}>
                              <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={1}>
                                <Typography variant="body2" fontWeight="bold">
                                  {comment.author}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {comment.date}
                                </Typography>
                              </Box>
                              <Typography variant="body2" mb={1}>
                                {comment.text}
                              </Typography>
                              {comment.reply && (
                                <Box sx={{ pl: 2, borderLeft: '3px solid #2e7d32', backgroundColor: '#e8f5e8', p: 1, borderRadius: 1 }}>
                                  <Typography variant="body2" color="success.dark">
                                    <strong>Reply:</strong> {comment.reply}
                                  </Typography>
                                </Box>
                              )}
                            </Paper>
                          ))}
                        </Box>
                      )}

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

            <Box sx={{ px: { xs: 1, md: 2 }, py: 4 }}>
              <Typography variant="body1" gutterBottom textAlign="center" color="text.secondary">
                Drag the slider to explore project timeline
              </Typography>
              <Slider
                value={timelineProgress}
                onChange={(e, value) => setTimelineProgress(value as number)}
                min={0}
                max={projectStages.length - 1}
                step={1}
                marks={projectStages.map((stage, index) => ({
                  value: index,
                  label: stage.icon + (window.innerWidth > 600 ? ` ${stage.name}` : ''),
                }))}
                valueLabelDisplay="off"
                sx={{
                  mb: 4,
                  '& .MuiSlider-markLabel': {
                    fontSize: { xs: '0.7rem', md: '0.875rem' }
                  }
                }}
              />

              {/* Current stage details */}
              <Paper variant="outlined" sx={{ p: 2, backgroundColor: '#f0f9f0', borderColor: '#2e7d32' }}>
                <Typography variant="h6" color="success.dark" gutterBottom>
                  {projectStages[timelineProgress].icon} {projectStages[timelineProgress].name}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {projectStages[timelineProgress].description}
                </Typography>
                <Box display="flex" alignItems="center" mt={1}>
                  <Typography variant="body2" sx={{ mr: 1 }}>
                    Progress:
                  </Typography>
                  <LinearProgress
                    variant="determinate"
                    value={projectStages[timelineProgress].progress}
                    sx={{ flexGrow: 1, mr: 1 }}
                  />
                  <Typography variant="body2">
                    {projectStages[timelineProgress].progress}%
                  </Typography>
                </Box>
              </Paper>
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
                        secondary={
                          <>
                            <Typography variant="body2" color="text.secondary">
                              {task.description}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              Responsible: {task.responsible} • Due: {task.deadline}
                            </Typography>
                          </>
                        }
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
                      borderRadius: 2,
                      overflow: 'hidden'
                    }}
                  >
                    <Box sx={{ p: 3, backgroundColor: '#2e7d32', color: 'white' }}>
                      <Typography variant="h6" gutterBottom>
                        🎨 Design Renders
                      </Typography>
                      <Typography variant="body2" sx={{ opacity: 0.9 }}>
                        Future vision of your space
                      </Typography>
                    </Box>
                    <Box sx={{ p: 3, textAlign: 'center', minHeight: 180 }}>
                      <PhotoIcon sx={{ fontSize: 48, color: '#bbb', mb: 2 }} />
                      <Typography variant="body2" color="text.secondary">
                        3D renders and design plans will appear here once Юля completes the floor plan
                      </Typography>
                      <Typography variant="caption" color="text.secondary" display="block" mt={1}>
                        Expected: April 10-15, 2026
                      </Typography>
                    </Box>
                  </Paper>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Paper
                    elevation={1}
                    sx={{
                      borderRadius: 2,
                      overflow: 'hidden'
                    }}
                  >
                    <Box sx={{ p: 3, backgroundColor: '#1976d2', color: 'white' }}>
                      <Typography variant="h6" gutterBottom>
                        📸 Progress Photos
                      </Typography>
                      <Typography variant="body2" sx={{ opacity: 0.9 }}>
                        Before, during & after
                      </Typography>
                    </Box>
                    <Box sx={{ p: 3, textAlign: 'center', minHeight: 180 }}>
                      <BuildIcon sx={{ fontSize: 48, color: '#bbb', mb: 2 }} />
                      <Typography variant="body2" color="text.secondary">
                        Construction progress photos will be uploaded daily during work
                      </Typography>
                      <Typography variant="caption" color="text.secondary" display="block" mt={1}>
                        Photo updates start with demo phase
                      </Typography>
                    </Box>
                  </Paper>
                </Grid>
                <Grid size={{ xs: 12 }}>
                  <Paper elevation={1} sx={{ borderRadius: 2, p: 3 }}>
                    <Typography variant="h6" gutterBottom color="primary">
                      📍 Virtual Walkthrough
                    </Typography>
                    <Typography variant="body2" color="text.secondary" mb={2}>
                      Once work begins, we'll create 360° virtual tours of your progress so you can see the transformation from anywhere.
                    </Typography>
                    <Chip label="Coming Soon" color="primary" variant="outlined" size="small" />
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