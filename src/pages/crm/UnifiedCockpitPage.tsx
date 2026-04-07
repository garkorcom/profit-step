/**
 * @fileoverview UnifiedCockpitPage - Single page for all task details
 *
 * Works with gtd_tasks collection directly.
 * Replaces both NoteCockpitPage and GTDTaskDetailsPage.
 *
 * Features:
 * - Sticky header with status, timer, actions
 * - Main content: title, description, checklist
 * - Control panel: client, team, schedule, finance
 *
 * @module pages/crm/UnifiedCockpitPage
 */

import React from 'react';
import { useParams } from 'react-router-dom';
import {
  Box, Typography, TextField, Button, IconButton, Paper,
  Breadcrumbs, Link, Chip, Select, MenuItem, FormControl,
  Autocomplete, Avatar, Divider, Checkbox,
  Alert, List, ListItem, ListItemIcon, Tab, Tabs, Stack, Snackbar,
  CircularProgress, Tooltip, InputAdornment, FormControlLabel,
  Accordion, AccordionSummary, AccordionDetails,
  useMediaQuery, useTheme,
} from '@mui/material';
import {
  ArrowBack as BackIcon,
  PlayArrow as PlayIcon,
  Stop as StopIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  DragIndicator as DragIcon,
  AccessTime as TimeIcon,
  Person as PersonIcon,
  CalendarMonth as CalendarIcon,
  Schedule as ScheduleIcon,
  Inventory as InventoryIcon,
  Contacts as ContactsIcon,
  WhatsApp as WhatsAppIcon,
  Telegram as TelegramIcon,
  ExpandMore as ExpandMoreIcon,
  Receipt as EstimateIcon,
  BarChart as PercentageIcon,
  Architecture as BlueprintsIcon,
} from '@mui/icons-material';
import { GTDTask } from '../../types/gtd.types';
import { SmartCockpitInput } from '../../components/tasks/SmartCockpitInput';
import { TaskHistoryTimeline } from '../../components/gtd/TaskHistoryTimeline';
import { format as formatDate } from 'date-fns';
import { ru } from 'date-fns/locale';
import TaskMaterialsTab from '../../components/crm/TaskMaterialsTab';
import GlobalContactQuickAdd from '../../components/contacts/GlobalContactQuickAdd';
import GTDSubtasksTable from '../../components/gtd/GTDSubtasksTable';

import {
  useCockpitTask,
  WorkSessionsList,
  EstimatesTabContent,
  BlueprintsTabContent,
  STATUS_OPTIONS,
  PRIORITY_OPTIONS,
} from '../../components/cockpit';

// ═══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════

const UnifiedCockpitPage: React.FC = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const { taskId } = useParams<{ taskId: string }>();

  const ctx = useCockpitTask(taskId);

  // ─── Render ─────────────────────────────────────────────

  if (ctx.loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (!ctx.task) {
    return (
      <Box p={3}>
        <Alert severity="error">Task not found</Alert>
        <Button onClick={() => ctx.navigate(ctx.backPath)} sx={{ mt: 2 }}>
          Back to Cockpit
        </Button>
      </Box>
    );
  }

  const isTimerRunningForThisTask = ctx.activeSession?.relatedTaskId === taskId;

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* ═══════════════════════════════════════════════════════════ */}
      {/* STICKY HEADER */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <Paper
        elevation={2}
        sx={{
          p: 2,
          position: 'sticky',
          top: 0,
          zIndex: 100,
          borderRadius: 0,
        }}
      >
        <Box display="flex" alignItems="center" justifyContent="space-between">
          {/* Left: Navigation */}
          <Box display="flex" alignItems="center" gap={2}>
            <IconButton onClick={() => ctx.navigate(ctx.backPath)}>
              <BackIcon />
            </IconButton>
            <Breadcrumbs>
              <Link
                component="button"
                variant="body2"
                onClick={() => ctx.navigate(ctx.backPath)}
                underline="hover"
              >
                {ctx.backPath === '/crm/tasks-masonry' ? 'Touch Board' : 'Cockpit'}
              </Link>
              {ctx.clientName && (
                <Typography variant="body2" color="text.primary">
                  {ctx.clientName}
                </Typography>
              )}
            </Breadcrumbs>
          </Box>

          {/* Center: Status Selector */}
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <Select
              value={ctx.status}
              onChange={(e) => ctx.handleStatusChange(e.target.value as typeof ctx.status)}
              sx={{
                bgcolor: STATUS_OPTIONS.find(s => s.value === ctx.status)?.color + '20',
                '& .MuiSelect-select': { py: 1 },
              }}
            >
              {STATUS_OPTIONS.map(opt => (
                <MenuItem key={opt.value} value={opt.value}>
                  <Chip
                    size="small"
                    label={opt.label}
                    sx={{ bgcolor: opt.color + '30', color: opt.color }}
                  />
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Right: Timer & Actions */}
          <Box display="flex" alignItems="center" gap={2}>
            {/* Source Audio Link */}
            {ctx.task?.sourceAudioUrl && (
              <Chip
                label="🎙️ Voice"
                color="info"
                variant="outlined"
                component="a"
                href={ctx.task.sourceAudioUrl}
                target="_blank"
                clickable
              />
            )}

            {/* Timer Button */}
            <Button
              variant={isTimerRunningForThisTask ? 'contained' : 'outlined'}
              color={isTimerRunningForThisTask ? 'error' : 'success'}
              startIcon={isTimerRunningForThisTask ? <StopIcon /> : <PlayIcon />}
              onClick={ctx.handleTimerToggle}
              sx={{
                minWidth: 160,
                animation: isTimerRunningForThisTask ? 'pulse 1.5s infinite' : 'none',
                '@keyframes pulse': {
                  '0%': { opacity: 1 },
                  '50%': { opacity: 0.7 },
                  '100%': { opacity: 1 },
                },
              }}
            >
              {isTimerRunningForThisTask ? ctx.formatTime(ctx.timerSeconds) : 'Start Work'}
            </Button>

            {/* Autosave indicator */}
            {ctx.saving && (
              <Box display="flex" alignItems="center" gap={0.5} sx={{ color: '#8E8E93' }}>
                <CircularProgress size={14} sx={{ color: '#8E8E93' }} />
                <Typography variant="caption">Saving…</Typography>
              </Box>
            )}
            {!ctx.saving && ctx.lastSavedAt && !ctx.hasChanges && (
              <Typography variant="caption" sx={{ color: '#34C759', fontWeight: 500 }}>
                ✓ Saved
              </Typography>
            )}

            {/* Delete Button */}
            <IconButton color="error" onClick={ctx.handleDelete}>
              <DeleteIcon />
            </IconButton>
          </Box>
        </Box>
      </Paper>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* MAIN CONTENT AREA (2 columns) */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 3 }}>
          {/* LEFT COLUMN: Content (65%) */}
          <Box sx={{ flex: { xs: '1 1 100%', md: '1 1 55%' }, minWidth: 0 }}>
            <SmartCockpitInput
              onCommandSubmit={ctx.handleAiModification}
              isLoading={ctx.isAiModifying}
            />

            <Paper sx={{ p: 3 }}>
              {/* Title */}
              <TextField
                fullWidth
                variant="standard"
                placeholder="Task title..."
                value={ctx.title}
                onChange={(e) => { ctx.setTitle(e.target.value); ctx.setHasChanges(true); }}
                InputProps={{
                  sx: { fontSize: '1.5rem', fontWeight: 600 },
                }}
                sx={{ mb: 2 }}
              />

              {/* Description */}
              <TextField
                fullWidth
                multiline
                rows={3}
                variant="outlined"
                placeholder="Task description..."
                value={ctx.description}
                onChange={(e) => { ctx.setDescription(e.target.value); ctx.setHasChanges(true); }}
                sx={{ mb: 3 }}
              />

              {/* Subtasks / Budget Table */}
              {taskId && (
                <GTDSubtasksTable
                  parentTaskId={taskId}
                  allTasks={ctx.subtasks}
                  onUpdateTask={ctx.handleUpdateSubtask}
                  onDeleteTask={ctx.handleDeleteSubtask}
                  onAddSubtask={ctx.handleAddSubtask}
                  onStartSession={(st) => {
                    ctx.startSession({
                      id: st.id,
                      title: st.title,
                      clientId: ctx.clientId || '',
                      clientName: ctx.clientName || '',
                    } as GTDTask);
                  }}
                  onStopSession={() => ctx.stopSession()}
                  activeSession={ctx.activeSession}
                />
              )}

              <Divider sx={{ my: 2 }} />

              {/* Block A: Client */}
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                🏢 Client
              </Typography>

              <Autocomplete
                value={ctx.clients.find(c => c.id === ctx.clientId) || null}
                options={ctx.clients}
                getOptionLabel={(opt) => opt.name}
                onChange={(_, newVal) => {
                  ctx.setClientId(newVal?.id || null);
                  ctx.setClientName(newVal?.name || null);
                  ctx.setHasChanges(true);
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Client"
                    size="small"
                  />
                )}
                sx={{ mb: 2 }}
              />

              <Divider sx={{ my: 2 }} />
              <Divider sx={{ my: 2 }} />
            </Paper>
          </Box>

          {/* RIGHT COLUMN: Control Panel (45%) */}
          <Box sx={{ flex: { xs: '1 1 100%', md: '1 1 45%' }, minWidth: 0 }}>
            <Paper sx={{ p: 3 }}>
              {/* Checklist */}
              <Typography variant="h6" gutterBottom>
                Checklist ({ctx.checklist.filter(i => i.completed).length}/{ctx.checklist.length})
              </Typography>

              <List dense>
                {ctx.checklist.map((item, index) => (
                  <ListItem
                    key={item.id}
                    sx={{
                      bgcolor: item.completed ? 'action.hover' : 'transparent',
                      borderRadius: 1,
                      mb: 0.5,
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      <IconButton size="small" sx={{ cursor: 'grab' }}>
                        <DragIcon fontSize="small" />
                      </IconButton>
                    </ListItemIcon>
                    <Checkbox
                      checked={item.completed}
                      onChange={() => ctx.handleChecklistToggle(item.id)}
                      size="small"
                    />
                    <TextField
                      fullWidth
                      variant="standard"
                      value={item.text}
                      onChange={(e) => ctx.handleChecklistTextChange(item.id, e.target.value)}
                      placeholder={`Step ${index + 1}`}
                      sx={{
                        textDecoration: item.completed ? 'line-through' : 'none',
                        opacity: item.completed ? 0.6 : 1,
                      }}
                    />
                  </ListItem>
                ))}
              </List>

              <Button
                startIcon={<AddIcon />}
                onClick={ctx.handleAddChecklistItem}
                sx={{ mt: 1 }}
              >
                Add step
              </Button>

              <Divider sx={{ my: 3 }} />

              {/* Activity Tabs */}
              <Tabs value={ctx.activeTab} onChange={(_, v) => ctx.setActiveTab(v)} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile>
                <Tab icon={<TimeIcon />} label="Журнал работ" />
                <Tab icon={<PersonIcon />} label="История" />
                <Tab icon={<InventoryIcon />} label="Материалы" />
                <Tab icon={<ContactsIcon />} label="Справочник" />
                <Tab icon={<BlueprintsIcon />} label="Blueprints" />
                <Tab icon={<EstimateIcon />} label="Estimates" />
                <Tab icon={<PercentageIcon />} label="Процентовка" />
              </Tabs>

              {ctx.activeTab === 0 && (
                <Box sx={{ py: 2, maxHeight: '60vh', overflowY: 'auto', pr: 1 }}>
                  {isTimerRunningForThisTask && (
                    <Alert severity="success" sx={{ mb: 2 }}>
                      🟢 Сейчас идёт работа...
                    </Alert>
                  )}
                  {ctx.task.totalTimeSpentMinutes && ctx.task.totalTimeSpentMinutes > 0 ? (
                    <Typography variant="body2" sx={{ mb: 2 }}>
                      Общее время: <strong>{Math.floor(ctx.task.totalTimeSpentMinutes / 60)}ч {ctx.task.totalTimeSpentMinutes % 60}м</strong>
                      {ctx.task.totalEarnings ? ` · ${ctx.task.totalEarnings.toFixed(2)}` : ''}
                    </Typography>
                  ) : (
                    !isTimerRunningForThisTask && (
                      <Typography color="text.secondary" variant="body2">
                        Нет записей о работе
                      </Typography>
                    )
                  )}
                  <WorkSessionsList taskId={taskId || ''} />
                </Box>
              )}

              {ctx.activeTab === 1 && (
                <TaskHistoryTimeline task={ctx.task} />
              )}

              {ctx.activeTab === 2 && (
                <TaskMaterialsTab
                  taskId={taskId || ''}
                  materials={ctx.materials}
                  clientId={ctx.clientId || undefined}
                  clientName={ctx.clientName || undefined}
                  userId={ctx.currentUser?.uid || ''}
                  userName={ctx.currentUser?.displayName || ''}
                  onMaterialsChange={(updated) => {
                    ctx.setMaterials(updated);
                    ctx.setHasChanges(true);
                  }}
                />
              )}

              {ctx.activeTab === 4 && (
                <Box sx={{ py: 2, pr: 1 }}>
                  {ctx.linkedProjectId ? (
                    <BlueprintsTabContent projectId={ctx.linkedProjectId} />
                  ) : (
                    <Alert severity="info">
                      Для работы с чертежами необходимо привязать задачу к клиенту с активным проектом.
                    </Alert>
                  )}
                </Box>
              )}

              {ctx.activeTab === 5 && (
                <Box sx={{ py: 2, pr: 1 }}>
                  <EstimatesTabContent
                    estimates={ctx.estimates}
                    loading={ctx.estimatesLoading}
                    expandedId={ctx.expandedEstimateId}
                    onToggle={(id) => ctx.setExpandedEstimateId(prev => prev === id ? null : id)}
                  />
                </Box>
              )}

              {ctx.activeTab === 6 && (
                <Box sx={{ py: 2, pr: 1 }}>
                  {taskId ? (
                    <GTDSubtasksTable
                      parentTaskId={taskId}
                      allTasks={ctx.subtasks}
                      onUpdateTask={ctx.handleUpdateSubtask}
                      onDeleteTask={ctx.handleDeleteSubtask}
                      onAddSubtask={ctx.handleAddSubtask}
                      onStartSession={(st) => {
                        ctx.startSession({
                          id: st.id,
                          title: st.title,
                          clientId: ctx.clientId || '',
                          clientName: ctx.clientName || '',
                        } as GTDTask);
                      }}
                      onStopSession={() => ctx.stopSession()}
                      activeSession={ctx.activeSession}
                    />
                  ) : (
                    <Alert severity="info">Загрузка задачи...</Alert>
                  )}
                </Box>
              )}

              {ctx.activeTab === 3 && (
                <Box sx={{ py: 2, pr: 1 }}>
                  <Box display="flex" gap={2} alignItems="center" mb={3}>
                    <Autocomplete
                      multiple
                      fullWidth
                      size="small"
                      value={ctx.contacts.filter(c => ctx.linkedContactIds.includes(c.id))}
                      options={ctx.contacts}
                      getOptionLabel={(opt) => opt.name || ''}
                      onChange={(_, newVal) => {
                        const newIds = newVal.map(v => v.id);
                        ctx.setLinkedContactIds(newIds);
                        ctx.setHasChanges(true);
                      }}
                      renderInput={(params) => (
                        <TextField {...params} label="Привязать контакт из базы" placeholder="Имя, телефон..." />
                      )}
                    />
                    <Button
                      variant="outlined"
                      startIcon={<AddIcon />}
                      onClick={() => ctx.setGlobalContactOpen(true)}
                      sx={{ whiteSpace: 'nowrap' }}
                    >
                      Новый
                    </Button>
                  </Box>

                  <Stack spacing={2}>
                    {ctx.linkedContactIds.length === 0 ? (
                      <Typography color="text.secondary" variant="body2">Нет привязанных контактов.</Typography>
                    ) : (
                      ctx.contacts.filter(c => ctx.linkedContactIds.includes(c.id)).map(contact => (
                        <Paper key={contact.id} variant="outlined" sx={{ p: 2, bgcolor: 'background.default' }}>
                          <Box display="flex" alignItems="flex-start" gap={2}>
                            <Avatar sx={{ width: 44, height: 44, bgcolor: 'primary.main', fontWeight: 600 }}>
                              {contact.name?.charAt(0)}
                            </Avatar>
                            <Box flex={1}>
                              <Typography variant="subtitle1" fontWeight={600} mb={0.5}>{contact.name}</Typography>
                              {contact.roles && contact.roles.length > 0 && (
                                <Box display="flex" gap={0.5} mb={1.5} flexWrap="wrap">
                                  {contact.roles.map((r: string) => (
                                    <Chip key={r} label={r} size="small" variant="outlined" sx={{ height: 22, fontSize: '0.7rem' }} />
                                  ))}
                                </Box>
                              )}
                              <Box display="flex" flexDirection="column" gap={0.5}>
                                {(contact.phones || []).map((p, i) => {
                                  const cleanNumber = p.number.replace(/\D/g, '');
                                  return (
                                    <Box key={i} display="flex" alignItems="center" gap={1} mb={0.5}>
                                      <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center' }}>
                                        <Link href={`tel:${p.number}`} underline="hover" color="primary.main" fontWeight={500}>📞 {p.number}</Link>
                                        {p.label ? <Typography component="span" variant="caption" color="text.secondary" ml={1}>• {p.label}</Typography> : ''}
                                      </Typography>
                                      <IconButton component="a" size="small" href={`https://wa.me/${cleanNumber}`} target="_blank" rel="noopener noreferrer" color="success" sx={{ padding: '2px' }} title="WhatsApp">
                                        <WhatsAppIcon fontSize="small" sx={{ fontSize: 18 }} />
                                      </IconButton>
                                      <IconButton component="a" size="small" href={`https://t.me/+${cleanNumber}`} target="_blank" rel="noopener noreferrer" color="info" sx={{ padding: '2px' }} title="Telegram">
                                        <TelegramIcon fontSize="small" sx={{ fontSize: 18 }} />
                                      </IconButton>
                                    </Box>
                                  );
                                })}
                                {(contact.emails || []).map((e, i) => (
                                  <Typography key={i} variant="body2">
                                    <Link href={`mailto:${e.address}`} underline="hover" color="info.main">✉️ {e.address}</Link>
                                    {e.label ? <Typography component="span" variant="caption" color="text.secondary" ml={1}>• {e.label}</Typography> : ''}
                                  </Typography>
                                ))}
                              </Box>
                            </Box>
                          </Box>
                        </Paper>
                      ))
                    )}
                  </Stack>

                  <GlobalContactQuickAdd
                    open={ctx.globalContactOpen}
                    onClose={() => ctx.setGlobalContactOpen(false)}
                    onContactAdded={(newContact: { id?: string; name?: string }) => {
                      ctx.setContacts(prev => [...prev, newContact as typeof prev[number]].sort((a, b) => (a.name || '').localeCompare(b.name || '')));
                      if (newContact.id) {
                        ctx.setLinkedContactIds(prev => [...prev, newContact.id!]);
                        ctx.setHasChanges(true);
                      }
                    }}
                  />
                </Box>
              )}

              <Divider sx={{ my: 2 }} />

              {/* Block B: Team */}
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                👤 Исполнитель
              </Typography>

              <Autocomplete
                value={ctx.users.find(u => u.id === ctx.assigneeId) || null}
                options={ctx.users}
                getOptionLabel={(opt) => opt.displayName}
                onChange={(_, newVal) => {
                  ctx.setAssigneeId(newVal?.id || null);
                  ctx.setAssigneeName(newVal?.displayName || null);
                  ctx.setHasChanges(true);
                }}
                renderInput={(params) => (
                  <TextField {...params} label="Исполнитель" size="small" />
                )}
                renderOption={(props, option) => (
                  <li {...props}>
                    <Avatar sx={{ width: 24, height: 24, mr: 1 }} src={option.avatarUrl}>
                      {option.displayName?.charAt(0)}
                    </Avatar>
                    {option.displayName}
                  </li>
                )}
                sx={{ mb: 2 }}
              />

              {/* Co-assignees */}
              <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                Соисполнители
              </Typography>

              {ctx.coAssignees.length > 0 && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mb: 1 }}>
                  {ctx.coAssignees.map(ca => (
                    <Box key={ca.id} display="flex" alignItems="center" gap={0.5}>
                      <Chip
                        label={ca.name}
                        size="small"
                        avatar={<Avatar sx={{ width: 20, height: 20 }}>{ca.name?.charAt(0)}</Avatar>}
                        onDelete={() => {
                          ctx.setCoAssignees(prev => prev.filter(c => c.id !== ca.id));
                          ctx.setHasChanges(true);
                        }}
                        sx={{ flexShrink: 0 }}
                      />
                      <Box
                        component="select"
                        value={ca.role || 'executor'}
                        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                          ctx.setCoAssignees(prev => prev.map(c =>
                            c.id === ca.id ? { ...c, role: e.target.value as typeof ca.role } : c
                          ));
                          ctx.setHasChanges(true);
                        }}
                        sx={{
                          border: '1px solid',
                          borderColor: 'divider',
                          borderRadius: 1,
                          px: 0.5,
                          py: 0.25,
                          fontSize: '0.7rem',
                          bgcolor: 'transparent',
                          cursor: 'pointer',
                          outline: 'none',
                          color: 'text.secondary',
                        }}
                      >
                        <option value="executor">Исполнитель</option>
                        <option value="reviewer">Ревьюер</option>
                        <option value="observer">Наблюдатель</option>
                      </Box>
                    </Box>
                  ))}
                </Box>
              )}

              <Autocomplete
                value={null}
                options={ctx.users.filter(u => u.id !== ctx.assigneeId && !ctx.coAssignees.some(ca => ca.id === u.id))}
                getOptionLabel={(opt) => opt.displayName}
                onChange={(_, newVal) => {
                  if (newVal) {
                    ctx.setCoAssignees(prev => [...prev, { id: newVal.id, name: newVal.displayName, role: 'executor' as const }]);
                    ctx.setHasChanges(true);
                  }
                }}
                renderInput={(params) => (
                  <TextField {...params} label="Добавить соисполнителя" size="small" />
                )}
                renderOption={(props, option) => (
                  <li {...props}>
                    <Avatar sx={{ width: 24, height: 24, mr: 1 }} src={option.avatarUrl}>
                      {option.displayName?.charAt(0)}
                    </Avatar>
                    {option.displayName}
                  </li>
                )}
                sx={{ mb: 3 }}
                blurOnSelect
                clearOnBlur
              />

              <Divider sx={{ my: 2 }} />

              {/* Block B2: Metadata — Creator, Time */}
              <Accordion disableGutters variant="outlined" sx={{ mb: 2, '&:before': { display: 'none' }, borderRadius: 1 }}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="subtitle2" color="text.secondary">
                    📋 Информация
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Stack spacing={1} sx={{ mb: 3 }}>
                    {ctx.task.ownerName && (
                      <Box display="flex" justifyContent="space-between" alignItems="center">
                        <Typography variant="body2" color="text.secondary">Создал</Typography>
                        <Typography variant="body2" fontWeight={500}>{ctx.task.ownerName}</Typography>
                      </Box>
                    )}
                    {ctx.task.createdAt && (
                      <Box display="flex" justifyContent="space-between" alignItems="center">
                        <Typography variant="body2" color="text.secondary">Дата создания</Typography>
                        <Typography variant="body2" fontWeight={500}>
                          {formatDate(
                            (ctx.task.createdAt as unknown as { toDate?: () => Date })?.toDate
                              ? (ctx.task.createdAt as unknown as { toDate: () => Date }).toDate()
                              : new Date(ctx.task.createdAt as unknown as string),
                            'dd MMM yyyy, HH:mm',
                            { locale: ru }
                          )}
                        </Typography>
                      </Box>
                    )}
                    {ctx.task.updatedAt && (
                      <Box display="flex" justifyContent="space-between" alignItems="center">
                        <Typography variant="body2" color="text.secondary">Обновлено</Typography>
                        <Typography variant="body2">
                          {formatDate(
                            (ctx.task.updatedAt as unknown as { toDate?: () => Date })?.toDate
                              ? (ctx.task.updatedAt as unknown as { toDate: () => Date }).toDate()
                              : new Date(ctx.task.updatedAt as unknown as string),
                            'dd MMM yyyy, HH:mm',
                            { locale: ru }
                          )}
                        </Typography>
                      </Box>
                    )}
                  </Stack>
                </AccordionDetails>
              </Accordion>
              <Divider sx={{ my: 2 }} />

              {/* Block B3: Planning */}
              <Accordion defaultExpanded={!isMobile} disableGutters variant="outlined" sx={{ mb: 2, '&:before': { display: 'none' }, borderRadius: 1 }}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="subtitle2" color="text.secondary">
                    📅 Планирование
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  {/* Estimated Duration */}
                  <TextField
                    fullWidth
                    size="small"
                    label="Планируемое время (мин)"
                    type="number"
                    value={ctx.estimatedDurationMinutes}
                    onChange={(e) => {
                      const val = e.target.value ? Math.max(0, Number(e.target.value)) : '';
                      ctx.setEstimatedDurationMinutes(val);
                      ctx.setHasChanges(true);
                    }}
                    InputProps={{
                      inputProps: { min: 0 },
                      startAdornment: <InputAdornment position="start"><ScheduleIcon fontSize="small" /></InputAdornment>,
                      endAdornment: ctx.estimatedDurationMinutes ? (
                        <InputAdornment position="end">
                          <Typography variant="caption" color="text.secondary">
                            {Math.floor(Number(ctx.estimatedDurationMinutes) / 60)}ч {Number(ctx.estimatedDurationMinutes) % 60}м
                          </Typography>
                        </InputAdornment>
                      ) : null,
                    }}
                    sx={{ mb: 2 }}
                  />

                  {/* Plan Start Date */}
                  <TextField
                    fullWidth
                    size="small"
                    label="План старта"
                    type="date"
                    value={ctx.startDate}
                    onChange={(e) => { ctx.setStartDate(e.target.value); ctx.setHasChanges(true); }}
                    InputLabelProps={{ shrink: true }}
                    InputProps={{
                      startAdornment: <InputAdornment position="start"><CalendarIcon fontSize="small" /></InputAdornment>,
                    }}
                    sx={{ mb: 2 }}
                  />

                  {/* Due Date */}
                  <TextField
                    fullWidth
                    size="small"
                    label={!ctx.dueDateManual && ctx.startDate && ctx.estimatedDurationMinutes ? 'План окончания (авто)' : 'План окончания'}
                    type="date"
                    value={ctx.dueDate}
                    onChange={(e) => { ctx.setDueDate(e.target.value); ctx.setDueDateManual(true); ctx.setHasChanges(true); }}
                    InputLabelProps={{ shrink: true }}
                    InputProps={{
                      startAdornment: <InputAdornment position="start"><CalendarIcon fontSize="small" /></InputAdornment>,
                      endAdornment: ctx.dueDateManual && ctx.startDate && ctx.estimatedDurationMinutes ? (
                        <InputAdornment position="end">
                          <Tooltip title="Сбросить на авто-расчёт">
                            <IconButton size="small" onClick={() => { ctx.setDueDateManual(false); ctx.setHasChanges(true); }}>
                              <ScheduleIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </InputAdornment>
                      ) : null,
                    }}
                    sx={{
                      mb: 3,
                      '& .MuiOutlinedInput-root': !ctx.dueDateManual && ctx.startDate && ctx.estimatedDurationMinutes ? {
                        bgcolor: 'action.hover',
                      } : {},
                    }}
                    helperText={!ctx.dueDateManual && ctx.startDate && ctx.estimatedDurationMinutes ? 'Авто-расчёт от старта + длительность' : undefined}
                  />

                  {/* Show in Calendar Button */}
                  {(ctx.startDate || ctx.dueDate) && (
                    <Button
                      fullWidth
                      size="small"
                      startIcon={<CalendarIcon />}
                      onClick={() => {
                        const targetDate = ctx.dueDate || ctx.startDate;
                        ctx.navigate(`/crm/calendar?date=${targetDate}`);
                      }}
                      sx={{
                        mb: 1,
                        textTransform: 'none',
                        justifyContent: 'flex-start',
                        color: 'primary.main',
                        fontWeight: 500,
                      }}
                    >
                      Показать в календаре
                    </Button>
                  )}
                </AccordionDetails>
              </Accordion>
              <Divider sx={{ my: 2 }} />

              {/* Block C & D: Settings */}
              <Accordion disableGutters variant="outlined" sx={{ mb: 2, '&:before': { display: 'none' }, borderRadius: 1 }}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="subtitle2" color="text.secondary">
                    ⚙️ Приоритет и Финансы
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  {/* Block C: Priority */}
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                    🎯 Priority
                  </Typography>

                  <Box display="flex" gap={1} flexWrap="wrap" mb={3}>
                    {PRIORITY_OPTIONS.map(opt => (
                      <Chip
                        key={opt.value}
                        label={opt.label}
                        onClick={() => { ctx.setPriority(opt.value); ctx.setHasChanges(true); }}
                        sx={{
                          bgcolor: ctx.priority === opt.value ? opt.color : 'transparent',
                          color: ctx.priority === opt.value ? 'white' : opt.color,
                          border: `1px solid ${opt.color}`,
                          cursor: 'pointer',
                        }}
                      />
                    ))}
                  </Box>

                  {/* Block D: Finance */}
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                    💰 Finance
                  </Typography>

                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={ctx.needsEstimate}
                        onChange={(e) => { ctx.setNeedsEstimate(e.target.checked); ctx.setHasChanges(true); }}
                      />
                    }
                    label="Needs estimate"
                    sx={{ mb: 2 }}
                  />
                </AccordionDetails>
              </Accordion>
            </Paper>
          </Box>
        </Box>
      </Box>

      {/* ERROR SNACKBAR */}
      <Snackbar
        open={!!ctx.saveError}
        autoHideDuration={6000}
        onClose={() => ctx.setSaveError(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => ctx.setSaveError(null)} severity="error" sx={{ width: '100%' }}>
          {ctx.saveError}
        </Alert>
      </Snackbar>

      {/* MOBILE: STICKY BOTTOM ACTION BAR */}
      {isMobile && (
        <Paper
          elevation={8}
          sx={{
            position: 'sticky',
            bottom: 0,
            zIndex: 100,
            p: 2,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            bgcolor: 'background.paper',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          <Button
            variant={isTimerRunningForThisTask ? 'contained' : 'outlined'}
            color={isTimerRunningForThisTask ? 'error' : 'success'}
            startIcon={isTimerRunningForThisTask ? <StopIcon /> : <PlayIcon />}
            onClick={ctx.handleTimerToggle}
            fullWidth
            size="large"
            sx={{
              animation: isTimerRunningForThisTask ? 'pulse 1.5s infinite' : 'none',
            }}
          >
            {isTimerRunningForThisTask ? ctx.formatTime(ctx.timerSeconds) : 'Start Work'}
          </Button>
        </Paper>
      )}
    </Box>
  );
};

export default UnifiedCockpitPage;
