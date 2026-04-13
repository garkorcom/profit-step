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
// portalRoutes is mounted BEFORE authMiddleware in agentApi.ts — it's
// imported directly there, not via this barrel, to keep the "public
// vs authenticated" distinction visible at the mount site.
