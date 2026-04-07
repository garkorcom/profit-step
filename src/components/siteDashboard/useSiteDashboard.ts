/**
 * @fileoverview Data-loading hook for SiteDashboard.
 * Consolidates 10+ Firestore / callable loaders into a single hook.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { sitesApi, SiteData } from '../../api/sitesApi';
import { crmApi } from '../../api/crmApi';
import { Client } from '../../types/crm.types';
import { GTDTask } from '../../types/gtd.types';
import { Estimate } from '../../types/estimate.types';
import { Contact } from '../../types/contact.types';
import { punchListApi, workActsApi, paymentScheduleApi, warrantyApi, npsApi, planVsFactApi } from '../../api/erpV4Api';
import type {
  CostRecord, WorkSession, PunchList, WorkAct, PaymentSchedule,
  WarrantyTask, NpsRequest, PlanVsFactData, PurchaseOrder, ChangeOrder,
  CostsSummary, SessionsSummary,
} from './siteDashboard.types';

export interface UseSiteDashboardArgs {
  siteId: string | undefined;
  companyId: string | undefined;
  tabValue: number;
}

export function useSiteDashboard({ siteId, companyId, tabValue }: UseSiteDashboardArgs) {
  // ─── Core state ─────────────────────────────────────────
  const [site, setSite] = useState<SiteData | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ─── Tab data ───────────────────────────────────────────
  const [tasks, setTasks] = useState<GTDTask[]>([]);
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [costs, setCosts] = useState<CostRecord[]>([]);
  const [sessions, setSessions] = useState<WorkSession[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);

  // ─── ERP V4 data ────────────────────────────────────────
  const [punchLists, setPunchLists] = useState<PunchList[]>([]);
  const [workActs, setWorkActs] = useState<WorkAct[]>([]);
  const [paymentSchedules, setPaymentSchedules] = useState<PaymentSchedule[]>([]);
  const [warrantyTasks, setWarrantyTasks] = useState<WarrantyTask[]>([]);
  const [npsRequests, setNpsRequests] = useState<NpsRequest[]>([]);
  const [planVsFact, setPlanVsFact] = useState<PlanVsFactData | null>(null);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [changeOrders, setChangeOrders] = useState<ChangeOrder[]>([]);

  // ─── Load site + client ─────────────────────────────────
  useEffect(() => {
    const load = async () => {
      if (!siteId) return;
      setLoading(true);
      try {
        const siteData = await sitesApi.getSiteById(siteId);
        if (!siteData) { setError('Site not found'); return; }
        setSite(siteData);
        const clientData = await crmApi.getClientById(siteData.clientId);
        if (clientData) setClient(clientData);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Error loading site:', e);
        setError(message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [siteId]);

  // ─── Individual loaders ─────────────────────────────────

  const loadTasks = useCallback(async () => {
    if (!site) return;
    const q = query(collection(db, 'gtd_tasks'), where('clientId', '==', site.clientId), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    const allTasks = snap.docs.map(d => ({ id: d.id, ...d.data() } as GTDTask));
    const filtered = allTasks.filter(t => {
      const task = t as GTDTask & { siteId?: string };
      return task.siteId === siteId || !task.siteId;
    });
    setTasks(filtered);
  }, [site, siteId]);

  const loadEstimates = useCallback(async () => {
    if (!site || !companyId) return;
    const q = query(collection(db, 'estimates'), where('companyId', '==', companyId), where('clientId', '==', site.clientId));
    const snap = await getDocs(q);
    setEstimates(snap.docs.map(d => ({ id: d.id, ...d.data() } as Estimate)));
  }, [site, companyId]);

  const loadCosts = useCallback(async () => {
    if (!site) return;
    const q = query(collection(db, 'costs'), where('clientId', '==', site.clientId));
    const snap = await getDocs(q);
    setCosts(snap.docs.map(d => ({ id: d.id, ...d.data() } as CostRecord)));
  }, [site]);

  const loadSessions = useCallback(async () => {
    if (!site) return;
    const q = query(collection(db, 'work_sessions'), where('clientId', '==', site.clientId));
    const snap = await getDocs(q);
    setSessions(snap.docs.map(d => ({ id: d.id, ...d.data() } as WorkSession)));
  }, [site]);

  const loadContacts = useCallback(async () => {
    if (!site) return;
    const q = query(collection(db, 'contacts'), where('linkedProjects', 'array-contains', site.clientId));
    const snap = await getDocs(q);
    setContacts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Contact)));
  }, [site]);

  // ERP V4 loaders
  const loadPunchLists = useCallback(async () => {
    if (!site) return;
    try { const r = await punchListApi.getByProject(site.clientId); setPunchLists(r?.data || []); }
    catch (e) { console.error('Error loading punch lists:', e); setPunchLists([]); }
  }, [site]);

  const loadWorkActs = useCallback(async () => {
    if (!site) return;
    try { const r = await workActsApi.getByProject(site.clientId); setWorkActs(r?.data || []); }
    catch (e) { console.error('Error loading work acts:', e); setWorkActs([]); }
  }, [site]);

  const loadPaymentSchedules = useCallback(async () => {
    if (!site) return;
    try { const r = await paymentScheduleApi.getByProject(site.clientId); setPaymentSchedules(r?.data || []); }
    catch (e) { console.error('Error loading payment schedules:', e); setPaymentSchedules([]); }
  }, [site]);

  const loadWarrantyTasks = useCallback(async () => {
    if (!site) return;
    try { const r = await warrantyApi.getByProject(site.clientId); setWarrantyTasks(r?.data || []); }
    catch (e) { console.error('Error loading warranty tasks:', e); setWarrantyTasks([]); }
  }, [site]);

  const loadNpsRequests = useCallback(async () => {
    if (!site) return;
    try { const r = await npsApi.getStatus(site.clientId); setNpsRequests(r?.data || []); }
    catch (e) { console.error('Error loading NPS:', e); setNpsRequests([]); }
  }, [site]);

  const loadPlanVsFact = useCallback(async () => {
    if (!site) return;
    try { const r = await planVsFactApi.get({ clientId: site.clientId }); setPlanVsFact(r?.data || null); }
    catch (e) { console.error('Error loading plan vs fact:', e); setPlanVsFact(null); }
  }, [site]);

  const loadPurchaseOrders = useCallback(async () => {
    if (!site || !companyId) return;
    try {
      const q = query(collection(db, `companies/${companyId}/purchase_orders`), where('projectId', '==', site.clientId));
      const snap = await getDocs(q);
      setPurchaseOrders(snap.docs.map(d => ({ id: d.id, ...d.data() } as PurchaseOrder)));
    } catch (e) { console.error('Error loading purchase orders:', e); setPurchaseOrders([]); }
  }, [site, companyId]);

  const loadChangeOrders = useCallback(async () => {
    if (!site || !companyId) return;
    try {
      const q = query(collection(db, `companies/${companyId}/change_orders`), where('projectId', '==', site.clientId));
      const snap = await getDocs(q);
      setChangeOrders(snap.docs.map(d => ({ id: d.id, ...d.data() } as ChangeOrder)));
    } catch (e) { console.error('Error loading change orders:', e); setChangeOrders([]); }
  }, [site, companyId]);

  // ─── Tab-based loading ──────────────────────────────────
  useEffect(() => {
    if (!site || !companyId) return;
    const loadTabData = async () => {
      try {
        switch (tabValue) {
          case 0: await loadPaymentSchedules(); await loadNpsRequests(); break;
          case 1: await loadTasks(); break;
          case 2: await loadEstimates(); break;
          case 3: if (tasks.length === 0) await loadTasks(); break;
          case 4: await loadCosts(); await loadPlanVsFact(); await loadPurchaseOrders(); await loadChangeOrders(); break;
          case 5: await loadPunchLists(); await loadWorkActs(); break;
          case 6: await loadSessions(); break;
          case 7: await loadContacts(); break;
        }
      } catch (e) { console.error('Error loading tab data:', e); }
    };
    loadTabData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabValue, site]);

  // ─── Computed summaries ─────────────────────────────────

  const costsSummary: CostsSummary = useMemo(() => {
    const total = costs.reduce((sum, c) => sum + (c.amount || 0), 0);
    const byCategory: Record<string, number> = {};
    costs.forEach(c => {
      const cat = c.category || 'Other';
      byCategory[cat] = (byCategory[cat] || 0) + (c.amount || 0);
    });
    return { total, byCategory };
  }, [costs]);

  const sessionsSummary: SessionsSummary = useMemo(() => {
    let totalMinutes = 0;
    let totalEarnings = 0;
    const byEmployee: Record<string, { name: string; minutes: number; earnings: number }> = {};
    sessions.forEach(s => {
      const mins = s.durationMinutes || 0;
      const rate = s.hourlyRate || 0;
      const earnings = (mins / 60) * rate;
      totalMinutes += mins;
      totalEarnings += earnings;
      const empName = s.employeeName || 'Unknown';
      if (!byEmployee[empName]) byEmployee[empName] = { name: empName, minutes: 0, earnings: 0 };
      byEmployee[empName].minutes += mins;
      byEmployee[empName].earnings += earnings;
    });
    return { totalMinutes, totalEarnings, byEmployee };
  }, [sessions]);

  return {
    site, setSite, client, loading, error,
    tasks, estimates, costs, sessions, contacts,
    punchLists, workActs, paymentSchedules, warrantyTasks,
    npsRequests, planVsFact, purchaseOrders, changeOrders,
    costsSummary, sessionsSummary,
    loadWarrantyTasks,
  };
}
