import { z } from 'zod';

export const TimeTrackingSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('start'),
    taskId: z.string().optional(),
    taskTitle: z.string().min(1),
    clientId: z.string().optional(),
    clientName: z.string().optional(),
    projectId: z.string().optional(),
    startTime: z.string().optional(),
    siteId: z.string().optional(),
  }),
  z.object({
    action: z.literal('stop'),
    endTime: z.string().optional(),
  }),
  z.object({ action: z.literal('status') }),
]);

export const ActiveSessionsQuerySchema = z.object({
  clientId: z.string().optional(),
});

export const TimeSummaryQuerySchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  employeeId: z.string().optional(),
});

export const AdminStopSchema = z.object({
  sessionId: z.string().min(1),
  endTime: z.string().optional(),
});

export const AdminStartSchema = z.object({
  employeeId: z.string().min(1),
  taskTitle: z.string().min(1),
  clientId: z.string().optional(),
  clientName: z.string().optional(),
  projectId: z.string().optional(),
  taskId: z.string().optional(),
  startTime: z.string().optional(),
});
