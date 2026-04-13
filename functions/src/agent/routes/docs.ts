/**
 * Agent API — OpenAPI 3.0 Documentation
 *
 * Auto-serves Swagger UI at GET /api/docs
 * and raw JSON spec at GET /api/docs/spec.json
 */
import { Router, Request, Response } from 'express';

const router = Router();

// ─── OpenAPI Spec ──────────────────────────────────────────────

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'Profit Step Agent API',
    version: '4.4.0',
    description: 'CRM Agent API for OpenClaw integration — tasks, clients, costs, time tracking, finance, projects, and more.',
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
        description: 'Agent API key',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          code: { type: 'string', enum: ['VALIDATION_ERROR', 'CLIENT_ERROR', 'DATABASE_ERROR', 'INTERNAL_ERROR'] },
          requestId: { type: 'string' },
          details: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, message: { type: 'string' } } } },
        },
      },
    },
  },
  security: [{ BearerAuth: [] }],
  paths: {
    // ─── Health ─────────────────────────────
    '/api/health': {
      get: {
        tags: ['System'],
        summary: 'Health check',
        responses: { 200: { description: 'API health status' } },
      },
    },

    // ─── Dashboard ──────────────────────────
    '/api/dashboard': {
      get: {
        tags: ['Dashboard'],
        summary: 'Full dashboard context',
        responses: { 200: { description: 'Dashboard data with active sessions, recent tasks, budget' } },
      },
    },

    // ─── Tasks ──────────────────────────────
    '/api/tasks': {
      post: {
        tags: ['Tasks'],
        summary: 'Create a new task',
        requestBody: {
          content: { 'application/json': { schema: { type: 'object', properties: {
            title: { type: 'string' }, status: { type: 'string', enum: ['inbox', 'next_action', 'waiting', 'projects', 'someday', 'done'] },
            priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
            clientId: { type: 'string' }, projectId: { type: 'string' }, assigneeId: { type: 'string' },
            dueDate: { type: 'string', format: 'date-time' }, notes: { type: 'string' },
          }, required: ['title'] } } },
        },
        responses: { 201: { description: 'Task created' }, 400: { description: 'Validation error' } },
      },
    },
    '/api/tasks/list': {
      get: {
        tags: ['Tasks'],
        summary: 'List tasks with filters',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'clientId', in: 'query', schema: { type: 'string' } },
          { name: 'assigneeId', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
        ],
        responses: { 200: { description: 'Paginated task list' } },
      },
    },
    '/api/tasks/{taskId}': {
      patch: {
        tags: ['Tasks'],
        summary: 'Update task fields',
        parameters: [{ name: 'taskId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Task updated' }, 404: { description: 'Task not found' } },
      },
    },

    // ─── Clients ─────────────────────────────
    '/api/clients': {
      post: {
        tags: ['Clients'],
        summary: 'Create a new client',
        requestBody: {
          content: { 'application/json': { schema: { type: 'object', properties: {
            name: { type: 'string' }, address: { type: 'string' }, phone: { type: 'string' },
            email: { type: 'string' }, type: { type: 'string', enum: ['residential', 'commercial', 'industrial'] },
          }, required: ['name'] } } },
        },
        responses: { 201: { description: 'Client created' } },
      },
    },
    '/api/clients/search': {
      get: {
        tags: ['Clients'],
        summary: 'Fuzzy search clients',
        parameters: [
          { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 5 } },
        ],
        responses: { 200: { description: 'Search results with fuzzy scores' } },
      },
    },
    '/api/clients/list': {
      get: {
        tags: ['Clients'],
        summary: 'List all clients',
        responses: { 200: { description: 'Paginated client list' } },
      },
    },

    // ─── Costs ───────────────────────────────
    '/api/costs': {
      post: {
        tags: ['Costs'],
        summary: 'Create a cost entry',
        requestBody: {
          content: { 'application/json': { schema: { type: 'object', properties: {
            amount: { type: 'number' }, category: { type: 'string' }, description: { type: 'string' },
            clientId: { type: 'string' }, projectId: { type: 'string' },
          }, required: ['amount', 'category', 'description'] } } },
        },
        responses: { 201: { description: 'Cost created' } },
      },
    },
    '/api/costs/list': {
      get: {
        tags: ['Costs'],
        summary: 'List costs with filters',
        parameters: [
          { name: 'clientId', in: 'query', schema: { type: 'string' } },
          { name: 'projectId', in: 'query', schema: { type: 'string' } },
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } },
        ],
        responses: { 200: { description: 'Filtered cost list' } },
      },
    },

    // ─── Time Tracking ──────────────────────
    '/api/time-tracking': {
      post: {
        tags: ['Time Tracking'],
        summary: 'Start, stop, or check timer status',
        requestBody: {
          content: { 'application/json': { schema: { type: 'object', properties: {
            action: { type: 'string', enum: ['start', 'stop', 'status'] },
            taskTitle: { type: 'string' }, taskId: { type: 'string' },
            clientId: { type: 'string' }, startTime: { type: 'string', format: 'date-time' },
            endTime: { type: 'string', format: 'date-time' },
          }, required: ['action'] } } },
        },
        responses: { 201: { description: 'Timer started' }, 200: { description: 'Timer stopped/status' } },
      },
    },
    '/api/time-tracking/active-all': {
      get: { tags: ['Time Tracking'], summary: 'List all active sessions', responses: { 200: { description: 'Active sessions' } } },
    },
    '/api/time-tracking/summary': {
      get: {
        tags: ['Time Tracking'], summary: 'Time summary for date range',
        parameters: [
          { name: 'from', in: 'query', required: true, schema: { type: 'string', format: 'date' } },
          { name: 'to', in: 'query', required: true, schema: { type: 'string', format: 'date' } },
          { name: 'employeeId', in: 'query', schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Aggregated time summary by employee' } },
      },
    },

    // ─── Finance ─────────────────────────────
    '/api/finance/context': {
      get: { tags: ['Finance'], summary: 'Financial context overview', responses: { 200: { description: 'Finance dashboard data' } } },
    },

    // ─── Projects ────────────────────────────
    '/api/projects': {
      post: { tags: ['Projects'], summary: 'Create a new project', responses: { 201: { description: 'Project created' } } },
    },
    '/api/projects/list': {
      get: { tags: ['Projects'], summary: 'List active projects', responses: { 200: { description: 'Project list' } } },
    },

    // ─── Users ───────────────────────────────
    '/api/users/list': {
      get: { tags: ['Users'], summary: 'List team members', responses: { 200: { description: 'User list' } } },
    },

    // ─── ERP ─────────────────────────────────
    '/api/erp/punch-list': {
      post: { tags: ['ERP'], summary: 'Create punch list item', responses: { 201: { description: 'Punch list created' } } },
    },
    '/api/erp/work-acts': {
      get: { tags: ['ERP'], summary: 'List work acts', responses: { 200: { description: 'Work acts' } } },
    },

    // ─── Files ──────────────────────────────
    '/api/files/upload': {
      post: {
        tags: ['Files'],
        summary: 'Upload file (base64)',
        requestBody: {
          content: { 'application/json': { schema: { type: 'object', properties: {
            fileName: { type: 'string' }, contentType: { type: 'string' }, base64Data: { type: 'string' },
            category: { type: 'string', enum: ['photo', 'document', 'receipt', 'blueprint', 'signature', 'estimate', 'invoice', 'permit', 'other'] },
            description: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } },
            clientId: { type: 'string' }, projectId: { type: 'string' }, taskId: { type: 'string' }, costId: { type: 'string' },
          }, required: ['fileName', 'base64Data'] } } },
        },
        responses: { 201: { description: 'File uploaded' }, 400: { description: 'Validation error' } },
      },
    },
    '/api/files/upload-from-url': {
      post: {
        tags: ['Files'],
        summary: 'Upload file from URL',
        requestBody: {
          content: { 'application/json': { schema: { type: 'object', properties: {
            sourceUrl: { type: 'string', format: 'uri' }, fileName: { type: 'string' },
            category: { type: 'string' }, clientId: { type: 'string' }, description: { type: 'string' },
          }, required: ['sourceUrl'] } } },
        },
        responses: { 201: { description: 'File downloaded and stored' } },
      },
    },
    '/api/files/search': {
      get: {
        tags: ['Files'],
        summary: 'Search/list files',
        parameters: [
          { name: 'clientId', in: 'query', schema: { type: 'string' } },
          { name: 'projectId', in: 'query', schema: { type: 'string' } },
          { name: 'taskId', in: 'query', schema: { type: 'string' } },
          { name: 'category', in: 'query', schema: { type: 'string' } },
          { name: 'tag', in: 'query', schema: { type: 'string' } },
          { name: 'dateFrom', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'dateTo', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
        ],
        responses: { 200: { description: 'File list' } },
      },
    },
    '/api/files/stats': {
      get: {
        tags: ['Files'],
        summary: 'File statistics',
        parameters: [
          { name: 'clientId', in: 'query', schema: { type: 'string' } },
          { name: 'projectId', in: 'query', schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Stats by category, size, counts' } },
      },
    },
    '/api/files/{fileId}': {
      patch: {
        tags: ['Files'],
        summary: 'Update file metadata/tags',
        parameters: [{ name: 'fileId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'File updated' }, 404: { description: 'Not found' } },
      },
      delete: {
        tags: ['Files'],
        summary: 'Delete file (storage + metadata)',
        parameters: [{ name: 'fileId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'File deleted' }, 404: { description: 'Not found' } },
      },
    },
    '/api/clients/{clientId}/files': {
      get: {
        tags: ['Files', 'Clients'],
        summary: 'All files linked to a client',
        parameters: [{ name: 'clientId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Client files with category breakdown' } },
      },
    },
    '/api/gtd-tasks/{taskId}/files': {
      get: {
        tags: ['Files', 'Tasks'],
        summary: 'Files linked to a task',
        parameters: [{ name: 'taskId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Task files' } },
      },
    },
    '/api/costs/{costId}/receipt': {
      get: {
        tags: ['Files', 'Costs'],
        summary: 'Receipt file + OCR data for a cost',
        parameters: [{ name: 'costId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Receipt with OCR data' }, 404: { description: 'Cost not found' } },
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
