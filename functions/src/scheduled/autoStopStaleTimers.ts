/**
 * Auto-Stop Stale Timers - Scheduled Function
 *
 * Runs hourly to automatically stop work sessions that have been active for more than 12 hours.
 * This prevents extremely long sessions that are likely due to users forgetting to stop their timers.
 */

import * as functions from 'firebase-functions';
import { autoStopStaleTimers } from '../agent/routes/timeTracking';

/**
 * Scheduled function that runs every hour to auto-stop stale timers
 * Timezone: UTC (Firebase default)
 * Schedule: Every hour at minute 0 (0 * * * *)
 */
export const scheduledAutoStopStaleTimers = functions
  .runWith({
    timeoutSeconds: 540, // 9 minutes timeout
    memory: '256MB',
  })
  .pubsub
  .schedule('0 * * * *') // Run every hour at minute 0
  .timeZone('UTC')
  .onRun(async (context) => {
    try {
      console.log('🕒 Auto-stop stale timers: Starting scheduled run', {
        eventId: context.eventId,
        timestamp: context.timestamp
      });

      const result = await autoStopStaleTimers();

      if (result.totalStopped > 0) {
        console.log('🕒 Auto-stop stale timers: Sessions auto-stopped', {
          totalStopped: result.totalStopped,
          sessions: result.stoppedSessions.map(s => ({
            sessionId: s.sessionId,
            employeeName: s.employeeName,
            durationHours: Math.round(s.durationMinutes / 60 * 10) / 10,
            task: s.task,
          })),
        });

        // Optional: Send notification to admin/Slack about auto-stopped sessions
        // This can be implemented later if needed
      } else {
        console.log('🕒 Auto-stop stale timers: No stale sessions found');
      }

      return {
        success: true,
        totalStopped: result.totalStopped,
        timestamp: new Date().toISOString(),
      };

    } catch (error: any) {
      console.error('🕒 Auto-stop stale timers: Scheduled run failed', {
        error: error.message,
        stack: error.stack,
        eventId: context.eventId,
      });

      // Don't throw - let the function complete so it can retry next time
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  });