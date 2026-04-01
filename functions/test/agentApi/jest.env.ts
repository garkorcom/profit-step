/**
 * Jest Environment Setup for Agent API Tests
 * Sets env vars BEFORE any module imports (setupFiles, not setupFilesAfterSetup)
 */
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
process.env.AGENT_API_KEY = 'test-agent-key';
process.env.OWNER_UID = 'test-owner-uid';
process.env.OWNER_DISPLAY_NAME = 'Test Owner';
process.env.OWNER_COMPANY_ID = 'test-company-id';
process.env.NODE_ENV = 'test';
