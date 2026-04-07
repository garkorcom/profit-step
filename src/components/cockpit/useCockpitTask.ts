/**
 * @fileoverview useCockpitTask — State management hook for UnifiedCockpitPage
 * Centralizes all Firebase interactions, form state, autosave, and handlers.
 * @module components/cockpit/useCockpitTask
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  doc, updateDoc, onSnapshot, Timestamp, collection,
  getDocs, query, where, deleteDoc, orderBy, addDoc,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../firebase/firebase';
import { useAuth } from '../../auth/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { GTDTask, GTDStatus, GTDPriority, ChecklistItem } from '../../types/gtd.types';
import { useSessionManager } from '../../hooks/useSessionManager';
import { TaskMaterial } from '../../types/inventory.types';
import { calculateMaterialsCost } from '../../features/inventory/inventoryService';
import { Estimate } from '../../types/estimate.types';
import { estimatesApi } from '../../api/estimatesApi';
import { format as formatDate } from 'date-fns';
import { CockpitUser, CockpitClient, CoAssignee } from './cockpit.types';

interface ContactRecord {
  id: string;
  name?: string;
  roles?: string[];
  phones?: Array<{ number: string; label?: string }>;
  emails?: Array<{ address: string; label?: string }>;
  linkedProjects?: string[];
}

interface TaskHistoryEntry {
  type: string;
  description: string;
  userId?: string;
  userName?: string;
  timestamp: ReturnType<typeof Timestamp.now>;
  prompt?: string;
}

export function useCockpitTask(taskId: string | undefined) {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser, userProfile } = useAuth();

  // Context-aware back navigation
  const backPath = (location.state as Record<string, string>)?.from || '/crm/gtd';

  // Session manager for timer
  const { activeSession, startSession, stopSession } = useSessionManager(
    currentUser?.uid,
    currentUser?.displayName || undefined
  );

  // Timer elapsed seconds
  const [timerSeconds, setTimerSeconds] = useState(0);

  // Core state
  const [task, setTask] = useState<GTDTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Refs for autosave
  const savingRef = useRef(false);
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasChangesRef = useRef(false);

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<GTDStatus>('inbox');
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [clientId, setClientId] = useState<string | null>(null);
  const [clientName, setClientName] = useState<string | null>(null);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [assigneeName, setAssigneeName] = useState<string | null>(null);
  const [needsEstimate, setNeedsEstimate] = useState(false);
  const [priority, setPriority] = useState<GTDPriority>('none');

  // Planning fields
  const [estimatedDurationMinutes, setEstimatedDurationMinutes] = useState<number | ''>('');
  const [startDate, setStartDate] = useState<string>('');
  const [dueDate, setDueDate] = useState<string>('');
  const [dueDateManual, setDueDateManual] = useState(false);
  const [coAssignees, setCoAssignees] = useState<CoAssignee[]>([]);

  // Materials state
  const [materials, setMaterials] = useState<TaskMaterial[]>([]);

  // Subtasks
  const [subtasks, setSubtasks] = useState<GTDTask[]>([]);

  // Contacts
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [linkedContactIds, setLinkedContactIds] = useState<string[]>([]);

  // Linked project for files tab
  const [linkedProjectId, setLinkedProjectId] = useState<string | null>(null);
  const [globalContactOpen, setGlobalContactOpen] = useState(false);

  // Reference arrays
  const [clients, setClients] = useState<CockpitClient[]>([]);
  const [users, setUsers] = useState<CockpitUser[]>([]);

  // AI modification state
  const [isAiModifying, setIsAiModifying] = useState(false);

  // Estimates state
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [estimatesLoading, setEstimatesLoading] = useState(false);
  const [expandedEstimateId, setExpandedEstimateId] = useState<string | null>(null);

  // Tab state
  const [activeTab, setActiveTab] = useState(0);

  // ─── Load Data ──────────────────────────────────────────

  useEffect(() => {
    if (!taskId) return;

    // Real-time subscription to task
    const unsubscribe = onSnapshot(doc(db, 'gtd_tasks', taskId), (snap) => {
      if (snap.exists()) {
        const data = { id: snap.id, ...snap.data() } as GTDTask;
        setTask(data);

        // Skip form re-init when WE just saved
        if (savingRef.current) return;

        // Initialize form state
        setTitle(data.title || '');
        setDescription(data.description || '');
        setStatus(data.status);
        setChecklist(data.checklistItems || []);
        setClientId(data.clientId || null);
        setClientName(data.clientName || null);
        setAssigneeId(data.assigneeId || null);
        setAssigneeName(data.assigneeName || null);
        setNeedsEstimate(data.needsEstimate || false);
        setPriority(data.priority || 'none');
        setEstimatedDurationMinutes(data.estimatedDurationMinutes || '');

        // Convert Timestamp to date string
        if (data.startDate) {
          const sd = data.startDate as unknown as { toDate?: () => Date };
          const dateObj = sd?.toDate ? sd.toDate() : new Date(data.startDate as unknown as string);
          setStartDate(formatDate(dateObj, 'yyyy-MM-dd'));
        } else {
          setStartDate('');
        }
        if (data.dueDate) {
          const dd = data.dueDate as unknown as { toDate?: () => Date };
          const dateObj = dd?.toDate ? dd.toDate() : new Date(data.dueDate as unknown as string);
          setDueDate(formatDate(dateObj, 'yyyy-MM-dd'));
        } else {
          setDueDate('');
        }
        setDueDateManual(false);
        setCoAssignees(data.coAssignees || []);
        setMaterials(data.materials || []);
        setLinkedContactIds(data.linkedContactIds || []);

        setLoading(false);
      }
    });

    // Subtasks subscription
    const subtasksQuery = query(
      collection(db, 'gtd_tasks'),
      where('parentTaskId', '==', taskId)
    );
    const unsubSubtasks = onSnapshot(subtasksQuery, (snap) => {
      setSubtasks(snap.docs.map(d => ({ id: d.id, ...d.data() } as GTDTask)));
    });

    // Load clients
    getDocs(query(collection(db, 'clients'), where('status', '!=', 'archived')))
      .then(snap => {
        setClients(snap.docs.map(d => ({
          id: d.id,
          name: d.data().name
        })));
      });

    // Load users
    getDocs(collection(db, 'users'))
      .then(snap => {
        setUsers(snap.docs
          .map(d => ({
            id: d.id,
            displayName: d.data().displayName,
            avatarUrl: d.data().avatarUrl
          }))
          .filter(u => u.displayName)
          .sort((a, b) => a.displayName.localeCompare(b.displayName))
        );
      });

    // Load Contacts
    getDocs(query(collection(db, 'contacts'), orderBy('name')))
      .then(snap => {
        setContacts(snap.docs.map(d => ({
          id: d.id,
          ...d.data()
        } as ContactRecord)));
      });

    return () => {
      unsubscribe();
      unsubSubtasks();
    };
  }, [taskId]);

  // Look up linked project when clientId changes
  useEffect(() => {
    if (!clientId) {
      setLinkedProjectId(null);
      return;
    }
    getDocs(query(collection(db, 'projects'), where('clientId', '==', clientId)))
      .then(snap => {
        if (!snap.empty) {
          const sorted = snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => {
              const aTime = (a as Record<string, { toMillis?: () => number }>).updatedAt?.toMillis?.() || 0;
              const bTime = (b as Record<string, { toMillis?: () => number }>).updatedAt?.toMillis?.() || 0;
              return bTime - aTime;
            });
          setLinkedProjectId(sorted[0].id);
        } else {
          setLinkedProjectId(null);
        }
      })
      .catch(err => console.error('Error finding linked project:', err));
  }, [clientId]);

  // Auto-calculate end date
  useEffect(() => {
    if (!dueDateManual && startDate && estimatedDurationMinutes) {
      const start = new Date(startDate + 'T00:00:00');
      const durationMs = Number(estimatedDurationMinutes) * 60 * 1000;
      const end = new Date(start.getTime() + durationMs);
      setDueDate(formatDate(end, 'yyyy-MM-dd'));
      setHasChanges(true);
    }
  }, [startDate, estimatedDurationMinutes, dueDateManual]);

  // Timer tick
  useEffect(() => {
    const isTimerRunningForThisTask = activeSession?.relatedTaskId === taskId;
    if (!isTimerRunningForThisTask || !activeSession?.startTime) {
      setTimerSeconds(0);
      return;
    }

    const startTime = activeSession.startTime.toDate();
    const updateTimer = () => {
      const elapsed = Math.floor((Date.now() - startTime.getTime()) / 1000);
      setTimerSeconds(elapsed);
    };
    updateTimer();

    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [activeSession, taskId]);

  // Load estimates for client
  useEffect(() => {
    if (!clientId || !userProfile?.companyId) {
      setEstimates([]);
      return;
    }
    setEstimatesLoading(true);
    estimatesApi.getClientEstimates(userProfile.companyId, clientId)
      .then(data => setEstimates(data))
      .catch(err => console.error('Error loading estimates:', err))
      .finally(() => setEstimatesLoading(false));
  }, [clientId, userProfile?.companyId]);

  // ─── Handlers ──────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!taskId || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);

    try {
      // Build history events for co-assignee changes
      const prevCoIds = new Set((task?.coAssignees || []).map(c => c.id));
      const newCoIds = new Set(coAssignees.map(c => c.id));
      const historyUpdates: TaskHistoryEntry[] = [...(task?.taskHistory || []) as TaskHistoryEntry[]];

      // Detect added co-assignees
      coAssignees.forEach(ca => {
        if (!prevCoIds.has(ca.id)) {
          historyUpdates.push({
            type: 'co_assignee_added',
            description: `Добавлен соисполнитель: ${ca.name} (${ca.role === 'executor' ? 'Исполнитель' : ca.role === 'reviewer' ? 'Ревьюер' : 'Наблюдатель'})`,
            userId: currentUser?.uid,
            userName: currentUser?.displayName || '',
            timestamp: Timestamp.now(),
          });
        }
      });
      // Detect removed co-assignees
      (task?.coAssignees || []).forEach((ca: CoAssignee) => {
        if (!newCoIds.has(ca.id)) {
          historyUpdates.push({
            type: 'co_assignee_removed',
            description: `Удалён соисполнитель: ${ca.name}`,
            userId: currentUser?.uid,
            userName: currentUser?.displayName || '',
            timestamp: Timestamp.now(),
          });
        }
      });

      await updateDoc(doc(db, 'gtd_tasks', taskId), {
        title,
        description,
        status,
        checklistItems: checklist,
        clientId: clientId || null,
        clientName: clientName || null,
        assigneeId: assigneeId || null,
        assigneeName: assigneeName || null,
        needsEstimate,
        priority,
        estimatedDurationMinutes: estimatedDurationMinutes || null,
        startDate: startDate ? Timestamp.fromDate(new Date(startDate + 'T00:00:00')) : null,
        dueDate: dueDate ? Timestamp.fromDate(new Date(dueDate + 'T00:00:00')) : null,
        coAssignees: coAssignees.length > 0 ? coAssignees : [],
        coAssigneeIds: coAssignees.map(c => c.id),
        taskHistory: historyUpdates,
        materials: materials.length > 0 ? materials : [],
        materialsCostPlanned: calculateMaterialsCost(materials).planned || null,
        materialsCostActual: calculateMaterialsCost(materials).actual || null,
        linkedContactIds: linkedContactIds.length > 0 ? linkedContactIds : [],
        updatedAt: Timestamp.now()
      });
      setHasChanges(false);
      hasChangesRef.current = false;
      setLastSavedAt(new Date());
      setSaveError(null);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Ошибка автосохранения. Проверьте подключение к интернету.';
      console.error('Save failed:', error);
      setSaveError(message);
    } finally {
      setSaving(false);
      setTimeout(() => { savingRef.current = false; }, 1000);
    }
  }, [taskId, title, description, status, checklist, clientId, clientName, assigneeId, assigneeName, needsEstimate, priority, estimatedDurationMinutes, startDate, dueDate, coAssignees, materials, linkedContactIds, task, currentUser]);

  // Debounced autosave
  useEffect(() => {
    hasChangesRef.current = hasChanges;
    if (!hasChanges) return;

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);

    autoSaveTimerRef.current = setTimeout(() => {
      handleSave();
    }, 1500);

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [hasChanges, handleSave]);

  // Save on unmount
  useEffect(() => {
    return () => {
      if (hasChangesRef.current) {
        handleSave();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStatusChange = (newStatus: GTDStatus) => {
    setStatus(newStatus);
    setHasChanges(true);
  };

  const handleTimerToggle = async () => {
    if (!taskId || !currentUser || !task) return;

    const isTimerRunningForThisTask = activeSession?.relatedTaskId === taskId;

    if (isTimerRunningForThisTask) {
      await stopSession();
    } else {
      await startSession({
        id: taskId,
        title,
        clientId: clientId || '',
        clientName: clientName || '',
      } as GTDTask);
    }
  };

  const handleAiModification = async (command: string) => {
    if (!taskId || !task) return;
    setIsAiModifying(true);
    try {
      const modifyTaskCallable = httpsCallable(functions, 'modifyAiTask');

      const currentSnapshot = {
        title,
        description,
        estimatedDurationMinutes: Number(estimatedDurationMinutes) || 0,
        checklistItems: checklist
      };

      const result = await modifyTaskCallable({
        currentTask: currentSnapshot,
        userCommand: command
      });

      const data = result.data as Record<string, unknown>;

      const changedFields: string[] = [];

      if (data.title && data.title !== title) {
        setTitle(data.title as string);
        changedFields.push('название');
      }
      if (data.description !== undefined && data.description !== description) {
        setDescription(data.description as string);
        changedFields.push('описание');
      }
      if (data.estimatedDurationMinutes !== undefined && data.estimatedDurationMinutes !== estimatedDurationMinutes) {
        setEstimatedDurationMinutes(data.estimatedDurationMinutes as number);
        changedFields.push('длительность');
      }
      if (data.checklistItems) {
        setChecklist(data.checklistItems as ChecklistItem[]);
        changedFields.push('чеклист');
      }

      if (changedFields.length > 0) {
        setHasChanges(true);

        const historyUpdates: TaskHistoryEntry[] = [...(task?.taskHistory || []) as TaskHistoryEntry[]];
        historyUpdates.push({
          type: 'ai_mutation_snapshot',
          description: `AI-редактура: изменены ${changedFields.join(', ')}`,
          userId: currentUser?.uid,
          userName: currentUser?.displayName || '',
          timestamp: Timestamp.now(),
          prompt: command
        });

        await updateDoc(doc(db, 'gtd_tasks', taskId), {
          taskHistory: historyUpdates
        });
      }

    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Ошибка AI-ассистента. Проверьте логи.';
      console.error('AI Modification Failed:', error);
      setSaveError(message);
    } finally {
      setIsAiModifying(false);
    }
  };

  const handleChecklistToggle = (itemId: string) => {
    setChecklist(prev => prev.map(item =>
      item.id === itemId ? { ...item, completed: !item.completed } : item
    ));
    setHasChanges(true);
  };

  const handleAddChecklistItem = () => {
    const newItem: ChecklistItem = {
      id: crypto.randomUUID(),
      text: '',
      completed: false,
      createdAt: Timestamp.now()
    };
    setChecklist(prev => [...prev, newItem]);
    setHasChanges(true);
  };

  const handleChecklistTextChange = (itemId: string, text: string) => {
    setChecklist(prev => prev.map(item =>
      item.id === itemId ? { ...item, text } : item
    ));
    setHasChanges(true);
  };

  // Subtask handlers
  const handleUpdateSubtask = useCallback(async (subtaskId: string, updates: Partial<GTDTask>) => {
    const taskRef = doc(db, 'gtd_tasks', subtaskId);
    await updateDoc(taskRef, { ...updates, updatedAt: Timestamp.now() });
  }, []);

  const handleDeleteSubtask = useCallback(async (subtaskId: string) => {
    const taskRef = doc(db, 'gtd_tasks', subtaskId);
    await deleteDoc(taskRef);
  }, []);

  const handleAddSubtask = useCallback(async (
    parentId: string,
    subtaskTitle: string,
    budgetAmount?: number,
    extras?: { estimatedMinutes?: number; budgetCategory?: string }
  ) => {
    if (!currentUser) return;
    const newSubtask: Partial<GTDTask> = {
      title: subtaskTitle,
      status: 'next_action' as GTDStatus,
      priority: 'none' as GTDPriority,
      createdAt: Timestamp.now(),
      ownerId: currentUser.uid,
      ownerName: currentUser.displayName || 'Unknown',
      context: '',
      description: '',
      parentTaskId: parentId,
      isSubtask: true,
      budgetAmount: budgetAmount || 0,
      progressPercentage: 0,
      paidAmount: 0,
      ...(extras?.budgetCategory && { budgetCategory: extras.budgetCategory }),
      ...(extras?.estimatedMinutes && { estimatedMinutes: extras.estimatedMinutes }),
      ...(clientId && { clientId, clientName: clientName || undefined }),
    };
    await addDoc(collection(db, 'gtd_tasks'), newSubtask);
  }, [currentUser, clientId, clientName]);

  const handleDelete = async () => {
    if (!taskId) return;
    if (!window.confirm('Delete this task?')) return;

    await deleteDoc(doc(db, 'gtd_tasks', taskId));
    navigate('/crm/gtd');
  };

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return {
    // Core
    task, loading, saving, hasChanges, lastSavedAt, saveError, setSaveError,
    backPath, navigate,

    // Form state
    title, setTitle,
    description, setDescription,
    status, checklist,
    clientId, setClientId,
    clientName, setClientName,
    assigneeId, setAssigneeId,
    assigneeName, setAssigneeName,
    needsEstimate, setNeedsEstimate,
    priority, setPriority,
    estimatedDurationMinutes, setEstimatedDurationMinutes,
    startDate, setStartDate,
    dueDate, setDueDate,
    dueDateManual, setDueDateManual,
    coAssignees, setCoAssignees,
    materials, setMaterials,

    // Subtasks
    subtasks,

    // Contacts
    contacts, setContacts, linkedContactIds, setLinkedContactIds,
    linkedProjectId, globalContactOpen, setGlobalContactOpen,

    // Reference data
    clients, users,

    // AI
    isAiModifying,

    // Estimates
    estimates, estimatesLoading, expandedEstimateId, setExpandedEstimateId,

    // Tabs
    activeTab, setActiveTab,

    // Timer
    timerSeconds, activeSession, startSession, stopSession,
    currentUser,

    // Handlers
    handleSave,
    handleStatusChange,
    handleTimerToggle,
    handleAiModification,
    handleChecklistToggle,
    handleAddChecklistItem,
    handleChecklistTextChange,
    handleUpdateSubtask,
    handleDeleteSubtask,
    handleAddSubtask,
    handleDelete,
    formatTime,
    setHasChanges,
  };
}
