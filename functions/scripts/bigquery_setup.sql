-- ═══════════════════════════════════════════════════════════════
-- BigQuery Setup Script for Profit Step Data Warehouse
-- Run this in BigQuery Console after enabling BigQuery API
-- ═══════════════════════════════════════════════════════════════

-- 1. Create Dataset
-- bq mk --dataset profit-step:profit_step_dwh

-- 2. Create partitioned audit_events_log table
CREATE TABLE IF NOT EXISTS `profit-step.profit_step_dwh.audit_events_log` (
    event_id STRING NOT NULL,
    timestamp TIMESTAMP NOT NULL,
    actor_uid STRING,
    project_id STRING,
    company_id STRING,
    entity_type STRING NOT NULL,
    entity_id STRING NOT NULL,
    event_code STRING NOT NULL,
    payload_before STRING,  -- JSON as string
    payload_after STRING,   -- JSON as string
    financial_impact FLOAT64,
    time_impact INT64
)
PARTITION BY DATE(timestamp)
CLUSTER BY entity_type, event_code
OPTIONS (
    description = 'Audit events log for Profit Step analytics',
    labels = [('env', 'production'), ('module', 'dwh')]
);

-- 3. Views for analytics

-- Financial Summary View
CREATE OR REPLACE VIEW `profit-step.profit_step_dwh.v_financial_summary` AS
SELECT
    DATE(timestamp) as date,
    SUM(CASE WHEN financial_impact > 0 THEN financial_impact ELSE 0 END) as revenue,
    SUM(CASE WHEN financial_impact < 0 THEN ABS(financial_impact) ELSE 0 END) as expenses,
    SUM(financial_impact) as net_change
FROM `profit-step.profit_step_dwh.audit_events_log`
GROUP BY DATE(timestamp)
ORDER BY date DESC;

-- Time Summary View
CREATE OR REPLACE VIEW `profit-step.profit_step_dwh.v_time_summary` AS
SELECT
    DATE(timestamp) as date,
    SUM(time_impact) as total_minutes,
    ROUND(SUM(time_impact) / 60.0, 1) as total_hours,
    COUNT(CASE WHEN event_code = 'TIMER_STOP' THEN 1 END) as sessions_completed,
    COUNT(CASE WHEN event_code = 'DEADLINE_SHIFT' THEN 1 END) as deadlines_shifted
FROM `profit-step.profit_step_dwh.audit_events_log`
GROUP BY DATE(timestamp)
ORDER BY date DESC;

-- Event Counts by Type
CREATE OR REPLACE VIEW `profit-step.profit_step_dwh.v_event_counts` AS
SELECT
    DATE(timestamp) as date,
    event_code,
    entity_type,
    COUNT(*) as event_count,
    SUM(financial_impact) as total_financial_impact,
    SUM(time_impact) as total_time_impact
FROM `profit-step.profit_step_dwh.audit_events_log`
GROUP BY DATE(timestamp), event_code, entity_type
ORDER BY date DESC, event_count DESC;

-- ═══════════════════════════════════════════════════════════════
-- BACKFILL EXISTING DATA (Run after extension is set up)
-- ═══════════════════════════════════════════════════════════════

-- Backfill Work Sessions
-- Note: Adjust field names based on your actual Firebase export structure
/*
INSERT INTO `profit-step.profit_step_dwh.audit_events_log`
SELECT
    CONCAT('evt_backfill_', document_id) as event_id,
    TIMESTAMP_SECONDS(CAST(JSON_VALUE(data, '$.endTime._seconds') AS INT64)) as timestamp,
    JSON_VALUE(data, '$.employeeId') as actor_uid,
    JSON_VALUE(data, '$.clientId') as project_id,
    JSON_VALUE(data, '$.companyId') as company_id,
    'work_session' as entity_type,
    document_id as entity_id,
    'TIMER_STOP' as event_code,
    NULL as payload_before,
    data as payload_after,
    CAST(JSON_VALUE(data, '$.sessionEarnings') AS FLOAT64) as financial_impact,
    CAST(JSON_VALUE(data, '$.durationMinutes') AS INT64) as time_impact
FROM `profit-step.your_firestore_export.work_sessions_raw`
WHERE JSON_VALUE(data, '$.status') IN ('completed', 'auto_closed');
*/
