/**
 * Routes barrel export — all domain routers
 */
export { default as clientRoutes } from './clients';
export { default as dashboardRoutes } from './dashboard';
export { default as taskRoutes } from './tasks';
export { default as costRoutes } from './costs';
export { default as timeTrackingRoutes } from './timeTracking';
export { default as financeRoutes } from './finance';
export { default as userRoutes } from './users';
export { default as estimateRoutes } from './estimates';
export { default as projectRoutes } from './projects';
export { default as siteRoutes } from './sites';
export { default as erpRoutes } from './erp';
export { default as inventoryRoutes } from './inventory';
export { default as sharingRoutes } from './sharing';
export { default as activityRoutes } from './activity';
export { default as fileRoutes } from './files';
export { default as feedbackRoutes } from './feedback';
export { default as teamRoutes } from './teams';
export { default as webhookRoutes } from './webhooks';
export { default as meetingRoutes } from './meetings';
export { default as clientInsightsRoutes } from './clientInsights';
export { default as dealRoutes } from './deals';
export { default as projectAutomationRoutes } from './projectAutomation';
export { default as paymentScheduleRoutes } from './paymentSchedules';
// portalRoutes is mounted BEFORE authMiddleware in agentApi.ts — it's
// imported directly there, not via this barrel, to keep the "public
// vs authenticated" distinction visible at the mount site.
