/**
 * Agent API — OpenAPI 3.0 Documentation (v4.3.0)
 *
 * Serves Swagger UI at GET /api/docs
 * and raw JSON spec at GET /api/docs/spec.json
 *
 * Includes scope requirements (x-required-scopes) for multi-agent RBAC.
 */
import { Router, Request, Response } from 'express';

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────

/** Shorthand for common parameter definitions */
const pathParam = (name: string, desc: string) => ({
  name, in: 'path' as const, required: true, schema: { type: 'string' }, description: desc,
});
const queryParam = (name: string, schema: Record<string, any>, desc?: string) => ({
  name, in: 'query' as const, schema, ...(desc ? { description: desc } : {}),
});

// ─── OpenAPI Spec ──────────────────────────────────────────────

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'Profit Step Agent API',
    version: '4.3.0',
    description: [
      'CRM Agent API for multi-agent integration (OpenClaw, LangGraph, custom).',
      '',
      '## Authentication',
      '- **Mode 1 (Admin):** `Bearer AGENT_API_KEY` — full admin access',
      '- **Mode 2 (Browser):** `Bearer <Firebase JWT>` — browser sessions',
      '- **Mode 3 (Per-employee):** `Bearer <40-hex-token>` — scoped employee tokens',
      '',
      '## Scopes',
      'Per-employee tokens carry scopes (e.g. `tasks:read`, `time:write`).  ',
      'Endpoints annotated with `x-required-scopes` list the scopes needed.  ',
      'The `admin` scope always bypasses scope checks.',
    ].join('\n'),
    contact: { name: 'GARKOR Corp', url: 'https://profit-step.web.app' },
  },
  servers: [
    { url: 'https://us-central1-profit-step.cloudfunctions.net/agentApi', description: 'Production' },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'Admin API key or per-employee 40-hex token',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          code: { type: 'string', enum: ['VALIDATION_ERROR', 'CLIENT_ERROR', 'DATABASE_ERROR', 'INTERNAL_ERROR', 'FORBIDDEN'] },
          requestId: { type: 'string' },
          details: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, message: { type: 'string' } } } },
        },
      },
      AgentEvent: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          type: { type: 'string', enum: ['task', 'session', 'cost', 'estimate', 'project', 'inventory', 'payroll', 'alert'] },
          action: { type: 'string' },
          entityId: { type: 'string' },
          entityType: { type: 'string' },
          summary: { type: 'string' },
          data: { type: 'object' },
          employeeId: { type: 'string', nullable: true },
          companyId: { type: 'string', nullable: true },
          source: { type: 'string', enum: ['api', 'bot', 'trigger', 'scheduled'] },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  security: [{ BearerAuth: [] }],
  paths: {
    // ═══════════════════════════════════════════════════════════
    // SYSTEM
    // ═══════════════════════════════════════════════════════════
    '/api/health': {
      get: {
        tags: ['System'], summary: 'Health check (public)',
        security: [],
        responses: { 200: { description: 'API health status with version and uptime' } },
      },
    },

    // ═══════════════════════════════════════════════════════════
    // AGENT TOKENS (admin only)
    // ═══════════════════════════════════════════════════════════
    '/api/agent-tokens': {
      post: {
        tags: ['Agent Tokens'], summary: 'Create per-employee token',
        'x-required-scopes': ['admin'],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: {
          employeeId: { type: 'string', description: 'Firebase UID of the employee' },
          label: { type: 'string' },
          scopes: { type: 'array', items: { type: 'string' }, example: ['tasks:read', 'tasks:write', 'time:read', 'time:write'] },
          expiresInDays: { type: 'integer', default: 90 },
        }, required: ['employeeId', 'scopes'] } } } },
        responses: { 201: { description: 'Token created with plaintext token in response' } },
      },
      get: {
        tags: ['Agent Tokens'], summary: 'List all tokens',
        'x-required-scopes': ['admin'],
        responses: { 200: { description: 'Array of token metadata (without plaintext)' } },
      },
    },
    '/api/agent-tokens/{tokenId}': {
      delete: {
        tags: ['Agent Tokens'], summary: 'Revoke a token',
        'x-required-scopes': ['admin'],
        parameters: [pathParam('tokenId', 'Token document ID')],
        responses: { 200: { description: 'Token revoked' } },
      },
    },
    '/api/agent-tokens/{tokenId}/rotate': {
      post: {
        tags: ['Agent Tokens'], summary: 'Rotate token (revoke old, issue new)',
        'x-required-scopes': ['admin'],
        parameters: [pathParam('tokenId', 'Token document ID')],
        responses: { 200: { description: 'New token issued' } },
      },
    },

    // ═══════════════════════════════════════════════════════════
    // EVENT QUEUE
    // ═══════════════════════════════════════════════════════════
    '/api/events': {
      get: {
        tags: ['Events'], summary: 'Poll events for the authenticated employee',
        'x-required-scopes': ['events:read', 'admin'],
        parameters: [
          queryParam('since', { type: 'string', format: 'date-time' }, 'Return events after this timestamp'),
          queryParam('type', { type: 'string' }, 'Filter by event type'),
          queryParam('limit', { type: 'integer', default: 50 }),
        ],
        responses: { 200: { description: 'Array of AgentEvent objects' } },
      },
    },
    '/api/events/{eventId}/ack': {
      post: {
        tags: ['Events'], summary: 'Acknowledge an event',
        'x-required-scopes': ['events:read', 'admin'],
        parameters: [pathParam('eventId', 'Event document ID')],
        responses: { 200: { description: 'Event acknowledged' } },
      },
    },

    // ═══════════════════════════════════════════════════════════
    // DASHBOARD
    // ═══════════════════════════════════════════════════════════
    '/api/dashboard': {
      get: {
        tags: ['Dashboard'], summary: 'Full dashboard context',
        'x-required-scopes': ['dashboard:read', 'admin'],
        responses: { 200: { description: 'Dashboard data: active sessions, recent tasks, budget summary' } },
      },
    },
    '/api/dashboard/client/{clientId}/summary': {
      get: {
        tags: ['Dashboard'], summary: 'Client dashboard summary',
        'x-required-scopes': ['dashboard:read', 'admin'],
        parameters: [pathParam('clientId', 'Client ID')],
        responses: { 200: { description: 'Client financial summary' } },
      },
    },
    '/api/dashboard/client/{clientId}/labor-log': {
      get: {
        tags: ['Dashboard'], summary: 'Client labor log',
        'x-required-scopes': ['dashboard:read', 'admin'],
        parameters: [pathParam('clientId', 'Client ID')],
        responses: { 200: { description: 'Work sessions for client' } },
      },
    },
    '/api/dashboard/client/{clientId}/timeline': {
      get: {
        tags: ['Dashboard'], summary: 'Client project timeline',
        'x-required-scopes': ['dashboard:read', 'admin'],
        parameters: [pathParam('clientId', 'Client ID')],
        responses: { 200: { description: 'Timeline events' } },
      },
    },
    '/api/dashboard/client/{clientId}/costs-breakdown': {
      get: {
        tags: ['Dashboard'], summary: 'Client costs breakdown',
        'x-required-scopes': ['dashboard:read', 'admin'],
        parameters: [pathParam('clientId', 'Client ID')],
        responses: { 200: { description: 'Costs grouped by category' } },
      },
    },

    // ═══════════════════════════════════════════════════════════
    // TASKS (GTD)
    // ═══════════════════════════════════════════════════════════
    '/api/tasks': {
      post: {
        tags: ['Tasks'], summary: 'Create a task',
        'x-required-scopes': ['tasks:write', 'admin'],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: {
          title: { type: 'string' }, status: { type: 'string', enum: ['inbox', 'next_action', 'waiting', 'projects', 'someday', 'done'] },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
          clientId: { type: 'string' }, projectId: { type: 'string' }, assigneeId: { type: 'string' },
          dueDate: { type: 'string', format: 'date-time' }, notes: { type: 'string' },
        }, required: ['title'] } } } },
        responses: { 201: { description: 'Task created' }, 400: { description: 'Validation error' } },
      },
    },
    '/api/tasks/list': {
      get: {
        tags: ['Tasks'], summary: 'List tasks (scoped to employee for workers)',
        'x-required-scopes': ['tasks:read', 'admin'],
        parameters: [
          queryParam('status', { type: 'string' }),
          queryParam('clientId', { type: 'string' }),
          queryParam('assigneeId', { type: 'string' }),
          queryParam('limit', { type: 'integer', default: 20 }),
        ],
        responses: { 200: { description: 'Paginated task list' } },
      },
    },
    '/api/tasks/{taskId}': {
      patch: {
        tags: ['Tasks'], summary: 'Update task fields',
        'x-required-scopes': ['tasks:write', 'admin'],
        parameters: [pathParam('taskId', 'Task ID')],
        responses: { 200: { description: 'Task updated' }, 404: { description: 'Not found' } },
      },
    },

    // ═══════════════════════════════════════════════════════════
    // CLIENTS
    // ═══════════════════════════════════════════════════════════
    '/api/clients': {
      post: {
        tags: ['Clients'], summary: 'Create a client',
        'x-required-scopes': ['clients:write', 'admin'],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: {
          name: { type: 'string' }, address: { type: 'string' }, phone: { type: 'string' },
          email: { type: 'string' }, type: { type: 'string', enum: ['residential', 'commercial', 'industrial'] },
        }, required: ['name'] } } } },
        responses: { 201: { description: 'Client created' } },
      },
    },
    '/api/clients/{clientId}': {
      get: {
        tags: ['Clients'], summary: 'Get client by ID',
        'x-required-scopes': ['clients:read', 'admin'],
        parameters: [pathParam('clientId', 'Client ID')],
        responses: { 200: { description: 'Client details' } },
      },
      patch: {
        tags: ['Clients'], summary: 'Update client',
        'x-required-scopes': ['clients:write', 'admin'],
        parameters: [pathParam('clientId', 'Client ID')],
        responses: { 200: { description: 'Client updated' } },
      },
    },
    '/api/clients/search': {
      get: {
        tags: ['Clients'], summary: 'Fuzzy search clients',
        'x-required-scopes': ['clients:read', 'admin'],
        parameters: [
          queryParam('q', { type: 'string' }, 'Search query (fuzzy match)'),
          queryParam('limit', { type: 'integer', default: 5 }),
        ],
        responses: { 200: { description: 'Search results with fuzzy scores' } },
      },
    },
    '/api/clients/list': {
      get: {
        tags: ['Clients'], summary: 'List all clients',
        'x-required-scopes': ['clients:read', 'admin'],
        responses: { 200: { description: 'Paginated client list' } },
      },
    },

    // ═══════════════════════════════════════════════════════════
    // COSTS
    // ═══════════════════════════════════════════════════════════
    '/api/costs': {
      post: {
        tags: ['Costs'], summary: 'Create a cost entry',
        'x-required-scopes': ['costs:write', 'admin'],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: {
          amount: { type: 'number' }, category: { type: 'string' }, description: { type: 'string' },
          clientId: { type: 'string' }, projectId: { type: 'string' },
        }, required: ['amount', 'category', 'description'] } } } },
        responses: { 201: { description: 'Cost created' } },
      },
    },
    '/api/costs/list': {
      get: {
        tags: ['Costs'], summary: 'List costs (scoped to employee for workers)',
        'x-required-scopes': ['costs:read', 'admin'],
        parameters: [
          queryParam('clientId', { type: 'string' }),
          queryParam('projectId', { type: 'string' }),
          queryParam('category', { type: 'string' }, 'Comma-separated categories'),
          queryParam('from', { type: 'string', format: 'date' }),
          queryParam('to', { type: 'string', format: 'date' }),
        ],
        responses: { 200: { description: 'Filtered cost list' } },
      },
    },
    '/api/costs/{costId}/void': {
      post: {
        tags: ['Costs'], summary: 'Void a cost entry',
        'x-required-scopes': ['costs:write', 'admin'],
        parameters: [pathParam('costId', 'Cost ID')],
        responses: { 200: { description: 'Cost voided' } },
      },
    },

    // ═══════════════════════════════════════════════════════════
    // TIME TRACKING
    // ═══════════════════════════════════════════════════════════
    '/api/time-tracking': {
      post: {
        tags: ['Time Tracking'], summary: 'Start, stop, pause, or resume timer',
        'x-required-scopes': ['time:write', 'admin'],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: {
          action: { type: 'string', enum: ['start', 'stop', 'status'] },
          taskTitle: { type: 'string' }, taskId: { type: 'string' },
          clientId: { type: 'string' }, clientName: { type: 'string' },
          startTime: { type: 'string', format: 'date-time' },
          endTime: { type: 'string', format: 'date-time' },
        }, required: ['action'] } } } },
        responses: { 201: { description: 'Timer started' }, 200: { description: 'Timer stopped/status' } },
      },
    },
    '/api/time-tracking/active-all': {
      get: {
        tags: ['Time Tracking'], summary: 'List all active sessions',
        'x-required-scopes': ['time:read', 'admin'],
        responses: { 200: { description: 'Active sessions' } },
      },
    },
    '/api/time-tracking/summary': {
      get: {
        tags: ['Time Tracking'], summary: 'Time summary for date range',
        'x-required-scopes': ['time:read', 'admin'],
        parameters: [
          queryParam('from', { type: 'string', format: 'date' }, 'Start date (required)'),
          queryParam('to', { type: 'string', format: 'date' }, 'End date (required)'),
          queryParam('employeeId', { type: 'string' }),
        ],
        responses: { 200: { description: 'Aggregated time summary by employee' } },
      },
    },
    '/api/time-tracking/admin-stop': {
      post: {
        tags: ['Time Tracking'], summary: 'Admin force-stop a session',
        'x-required-scopes': ['admin'],
        responses: { 200: { description: 'Session force-stopped' } },
      },
    },

    // ═══════════════════════════════════════════════════════════
    // FINANCE
    // ═══════════════════════════════════════════════════════════
    '/api/finance/context': {
      get: {
        tags: ['Finance'], summary: 'Financial context overview',
        'x-required-scopes': ['admin'],
        responses: { 200: { description: 'Finance dashboard: revenue, costs, AR, AP' } },
      },
    },
    '/api/finance/projects/status': {
      get: {
        tags: ['Finance'], summary: 'All projects financial status',
        'x-required-scopes': ['projects:read', 'dashboard:read', 'admin'],
        responses: { 200: { description: 'Per-project financial overview' } },
      },
    },
    '/api/finance/transactions/batch': {
      post: {
        tags: ['Finance'], summary: 'Batch create financial transactions',
        'x-required-scopes': ['admin'],
        responses: { 201: { description: 'Transactions created' } },
      },
    },
    '/api/finance/transactions/approve': {
      post: {
        tags: ['Finance'], summary: 'Approve pending transactions',
        'x-required-scopes': ['admin'],
        responses: { 200: { description: 'Transactions approved' } },
      },
    },
    '/api/finance/transactions/undo': {
      post: {
        tags: ['Finance'], summary: 'Undo a transaction',
        'x-required-scopes': ['admin'],
        responses: { 200: { description: 'Transaction undone' } },
      },
    },

    // ═══════════════════════════════════════════════════════════
    // PROJECTS
    // ═══════════════════════════════════════════════════════════
    '/api/projects': {
      post: {
        tags: ['Projects'], summary: 'Create a project',
        'x-required-scopes': ['projects:write', 'admin'],
        responses: { 201: { description: 'Project created' } },
      },
    },
    '/api/projects/list': {
      get: {
        tags: ['Projects'], summary: 'List projects',
        'x-required-scopes': ['projects:read', 'admin'],
        responses: { 200: { description: 'Project list' } },
      },
    },
    '/api/projects/{projectId}/dashboard': {
      get: {
        tags: ['Projects'], summary: 'Project dashboard',
        'x-required-scopes': ['projects:read', 'admin'],
        parameters: [pathParam('projectId', 'Project ID')],
        responses: { 200: { description: 'Project overview with financials' } },
      },
    },
    '/api/projects/{projectId}/files': {
      post: {
        tags: ['Projects'], summary: 'Upload project file',
        'x-required-scopes': ['projects:write', 'admin'],
        parameters: [pathParam('projectId', 'Project ID')],
        responses: { 201: { description: 'File uploaded' } },
      },
      get: {
        tags: ['Projects'], summary: 'List project files',
        'x-required-scopes': ['projects:read', 'admin'],
        parameters: [pathParam('projectId', 'Project ID')],
        responses: { 200: { description: 'File list' } },
      },
    },

    // ═══════════════════════════════════════════════════════════
    // ESTIMATES
    // ═══════════════════════════════════════════════════════════
    '/api/estimates': {
      post: {
        tags: ['Estimates'], summary: 'Create an estimate',
        'x-required-scopes': ['estimates:write', 'admin'],
        responses: { 201: { description: 'Estimate created' } },
      },
    },
    '/api/estimates/list': {
      get: {
        tags: ['Estimates'], summary: 'List estimates',
        'x-required-scopes': ['estimates:read', 'admin'],
        responses: { 200: { description: 'Estimate list' } },
      },
    },
    '/api/estimates/{estimateId}': {
      patch: {
        tags: ['Estimates'], summary: 'Update estimate',
        'x-required-scopes': ['estimates:write', 'admin'],
        parameters: [pathParam('estimateId', 'Estimate ID')],
        responses: { 200: { description: 'Estimate updated' } },
      },
    },
    '/api/estimates/{estimateId}/convert-to-tasks': {
      post: {
        tags: ['Estimates'], summary: 'Convert estimate line items to GTD tasks',
        'x-required-scopes': ['estimates:write', 'admin'],
        parameters: [pathParam('estimateId', 'Estimate ID')],
        responses: { 200: { description: 'Tasks created from estimate' } },
      },
    },

    // ═══════════════════════════════════════════════════════════
    // SITES
    // ═══════════════════════════════════════════════════════════
    '/api/sites': {
      post: {
        tags: ['Sites'], summary: 'Create a site',
        'x-required-scopes': ['projects:write', 'admin'],
        responses: { 201: { description: 'Site created' } },
      },
      get: {
        tags: ['Sites'], summary: 'List sites',
        'x-required-scopes': ['projects:read', 'admin'],
        responses: { 200: { description: 'Site list' } },
      },
    },
    '/api/sites/{siteId}': {
      patch: {
        tags: ['Sites'], summary: 'Update site',
        'x-required-scopes': ['projects:write', 'admin'],
        parameters: [pathParam('siteId', 'Site ID')],
        responses: { 200: { description: 'Site updated' } },
      },
    },

    // ═══════════════════════════════════════════════════════════
    // ERP (Change Orders, Purchase Orders, Plan vs Fact)
    // ═══════════════════════════════════════════════════════════
    '/api/erp/change-orders': {
      post: {
        tags: ['ERP'], summary: 'Create change order',
        'x-required-scopes': ['erp:write', 'admin'],
        responses: { 201: { description: 'Change order created' } },
      },
      get: {
        tags: ['ERP'], summary: 'List change orders',
        'x-required-scopes': ['erp:read', 'admin'],
        responses: { 200: { description: 'Change order list' } },
      },
    },
    '/api/erp/change-orders/{coId}': {
      patch: {
        tags: ['ERP'], summary: 'Update change order',
        'x-required-scopes': ['erp:write', 'admin'],
        parameters: [pathParam('coId', 'Change order ID')],
        responses: { 200: { description: 'Change order updated' } },
      },
    },
    '/api/erp/purchase-orders': {
      post: {
        tags: ['ERP'], summary: 'Create purchase order',
        'x-required-scopes': ['erp:write', 'admin'],
        responses: { 201: { description: 'Purchase order created' } },
      },
      get: {
        tags: ['ERP'], summary: 'List purchase orders',
        'x-required-scopes': ['erp:read', 'admin'],
        responses: { 200: { description: 'Purchase order list' } },
      },
    },
    '/api/erp/plan-vs-fact/{projectId}': {
      get: {
        tags: ['ERP'], summary: 'Plan vs fact comparison',
        'x-required-scopes': ['erp:read', 'dashboard:read', 'admin'],
        parameters: [pathParam('projectId', 'Project ID')],
        responses: { 200: { description: 'Budget vs actual comparison' } },
      },
    },

    // ═══════════════════════════════════════════════════════════
    // INVENTORY
    // ═══════════════════════════════════════════════════════════
    '/api/inventory/warehouses': {
      post: {
        tags: ['Inventory'], summary: 'Create warehouse',
        'x-required-scopes': ['inventory:write', 'admin'],
        responses: { 201: { description: 'Warehouse created' } },
      },
      get: {
        tags: ['Inventory'], summary: 'List warehouses',
        'x-required-scopes': ['inventory:read', 'admin'],
        responses: { 200: { description: 'Warehouse list' } },
      },
    },
    '/api/inventory/items': {
      post: {
        tags: ['Inventory'], summary: 'Create inventory item',
        'x-required-scopes': ['inventory:write', 'admin'],
        responses: { 201: { description: 'Item created' } },
      },
      get: {
        tags: ['Inventory'], summary: 'List inventory items',
        'x-required-scopes': ['inventory:read', 'admin'],
        parameters: [
          queryParam('warehouseId', { type: 'string' }),
          queryParam('category', { type: 'string' }),
          queryParam('lowStock', { type: 'boolean' }),
        ],
        responses: { 200: { description: 'Item list' } },
      },
    },
    '/api/inventory/transactions': {
      post: {
        tags: ['Inventory'], summary: 'Create inventory transaction',
        'x-required-scopes': ['inventory:write', 'admin'],
        responses: { 201: { description: 'Transaction created' } },
      },
      get: {
        tags: ['Inventory'], summary: 'List inventory transactions',
        'x-required-scopes': ['inventory:read', 'admin'],
        responses: { 200: { description: 'Transaction list' } },
      },
    },
    '/api/inventory/norms': {
      post: {
        tags: ['Inventory'], summary: 'Create usage norm',
        'x-required-scopes': ['inventory:write', 'admin'],
        responses: { 201: { description: 'Norm created' } },
      },
      get: {
        tags: ['Inventory'], summary: 'List norms',
        'x-required-scopes': ['inventory:read', 'admin'],
        responses: { 200: { description: 'Norm list' } },
      },
    },
    '/api/inventory/write-off-by-norm': {
      post: {
        tags: ['Inventory'], summary: 'Write off inventory by norm',
        'x-required-scopes': ['inventory:write', 'admin'],
        responses: { 200: { description: 'Write-off completed' } },
      },
    },

    // ═══════════════════════════════════════════════════════════
    // PAYROLL (self-service + admin)
    // ═══════════════════════════════════════════════════════════
    '/api/payroll/my-balance': {
      get: {
        tags: ['Payroll'], summary: 'Worker: my current balance',
        'x-required-scopes': ['time:read', 'admin'],
        responses: { 200: { description: 'Running balance, YTD earned/paid, advance balance, last payment' } },
      },
    },
    '/api/payroll/my-hours': {
      get: {
        tags: ['Payroll'], summary: 'Worker: my hours this week',
        'x-required-scopes': ['time:read', 'admin'],
        parameters: [queryParam('weekOf', { type: 'string', format: 'date' }, 'Any date within the target week')],
        responses: { 200: { description: 'Daily breakdown with overtime warnings' } },
      },
    },
    '/api/payroll/my-pay': {
      get: {
        tags: ['Payroll'], summary: 'Worker: my pay stub',
        'x-required-scopes': ['time:read', 'admin'],
        parameters: [queryParam('period', { type: 'string' }, 'Period ID (YYYY-MM)')],
        responses: { 200: { description: 'Gross, deductions, net, session details' } },
      },
    },
    '/api/payroll/overtime-check': {
      get: {
        tags: ['Payroll'], summary: 'Admin: check all employees overtime',
        'x-required-scopes': ['admin'],
        parameters: [queryParam('weekOf', { type: 'string', format: 'date' })],
        responses: { 200: { description: 'Per-employee weekly hours with overtime flags' } },
      },
    },
    '/api/payroll/period/{periodId}/validate': {
      post: {
        tags: ['Payroll'], summary: 'Admin: validate period for anomalies',
        'x-required-scopes': ['admin'],
        parameters: [pathParam('periodId', 'Period ID (YYYY-MM)')],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: {
          checks: { type: 'array', items: { type: 'string', enum: [
            'hours_over_60', 'session_over_12h', 'rate_changes', 'zero_hours', 'duplicate_sessions', 'unsigned_sessions',
          ] } },
        } } } } },
        responses: { 200: { description: 'Anomaly report' } },
      },
    },

    // ═══════════════════════════════════════════════════════════
    // USERS & CONTACTS
    // ═══════════════════════════════════════════════════════════
    '/api/users/search': {
      get: {
        tags: ['Users'], summary: 'Search users (admin)',
        'x-required-scopes': ['admin'],
        parameters: [queryParam('q', { type: 'string' })],
        responses: { 200: { description: 'User search results' } },
      },
    },
    '/api/users/create-from-bot': {
      post: {
        tags: ['Users'], summary: 'Create user from bot data (admin)',
        'x-required-scopes': ['admin'],
        responses: { 201: { description: 'User created' } },
      },
    },
    '/api/contacts': {
      post: {
        tags: ['Users'], summary: 'Create a contact',
        'x-required-scopes': ['clients:write', 'admin'],
        responses: { 201: { description: 'Contact created' } },
      },
    },
    '/api/contacts/search': {
      get: {
        tags: ['Users'], summary: 'Search contacts',
        'x-required-scopes': ['clients:read', 'admin'],
        parameters: [queryParam('q', { type: 'string' })],
        responses: { 200: { description: 'Contact search results' } },
      },
    },

    // ═══════════════════════════════════════════════════════════
    // SHARING (client portal)
    // ═══════════════════════════════════════════════════════════
    '/api/sharing/generate-link': {
      post: {
        tags: ['Sharing'], summary: 'Generate client portal link',
        'x-required-scopes': ['admin'],
        responses: { 200: { description: 'Portal link with token' } },
      },
    },
  },
};

// ─── Routes ─────────────────────────────────────────────────────

// Raw JSON spec
router.get('/api/docs/spec.json', (_req: Request, res: Response) => {
  res.json(spec);
});

// Swagger UI (CDN-based, no npm dependency)
router.get('/api/docs', (_req: Request, res: Response) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>Profit Step Agent API</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/api/docs/spec.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout',
    });
  </script>
</body>
</html>`);
});

export default router;
