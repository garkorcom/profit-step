/**
 * Selfie check-in skip-branch tests.
 *
 * Covers F-3 (worker skips start selfie), F-7 (worker skips end photo) and
 * F-4 (admin is pushed in both cases). The full media-upload flow (Telegram
 * file download → Storage upload → face verification) lives behind real HTTP
 * clients and is exercised only in manual smoke tests — these unit tests
 * focus on the Firestore side-effects and admin notification trigger so a
 * regression that silently drops the skip fields fails CI before production.
 */

// --- Mocks -----------------------------------------------------------------

const mockUpdate = jest.fn().mockResolvedValue(undefined);
const mockActivityAdd = jest.fn().mockResolvedValue({ id: 'activity-log-id' });

const mockGetActiveSession = jest.fn();
const mockSendMessage = jest.fn().mockResolvedValue(undefined);
const mockSendMainMenu = jest.fn().mockResolvedValue(undefined);
const mockSendAdminNotification = jest.fn().mockResolvedValue(undefined);
const mockFindPlatformUser = jest.fn().mockResolvedValue(null);
const mockFinalizeSession = jest.fn().mockResolvedValue(undefined);

// firebase-admin is referenced for Timestamp.now() and FieldValue.serverTimestamp().
// Don't need the real SDK — only the shape. Zero network calls in this test file.
jest.mock('firebase-admin', () => {
    const fakeNow = { seconds: 1_700_000_000, nanoseconds: 0 };
    const firestore = () => ({
        collection: (name: string) => {
            if (name === 'activity_logs') {
                return { add: mockActivityAdd };
            }
            throw new Error(`Unexpected collection in skip handler: ${name}`);
        },
    });
    (firestore as any).Timestamp = { now: () => fakeNow };
    (firestore as any).FieldValue = { serverTimestamp: () => 'SERVER_TIMESTAMP' };
    return {
        firestore,
        storage: () => ({ bucket: () => ({ name: 'mock-bucket', file: () => ({ save: jest.fn() }) }) }),
    };
});

jest.mock('firebase-functions', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

jest.mock('../src/triggers/telegram/telegramUtils', () => ({
    sendMessage: (...args: unknown[]) => mockSendMessage(...args),
    getActiveSession: (...args: unknown[]) => mockGetActiveSession(...args),
    sendMainMenu: (...args: unknown[]) => mockSendMainMenu(...args),
    findPlatformUser: (...args: unknown[]) => mockFindPlatformUser(...args),
}));

jest.mock('../src/triggers/telegram/handlers/profileHandlers', () => ({
    sendAdminNotification: (...args: unknown[]) => mockSendAdminNotification(...args),
}));

jest.mock('../src/triggers/telegram/handlers/sessionManager', () => ({
    finalizeSession: (...args: unknown[]) => mockFinalizeSession(...args),
}));

// GTD / Inbox / faceVerification aren't reached by handleSkipMedia, but the
// module imports them at top level. Stub to avoid loading heavy deps.
jest.mock('../src/triggers/telegram/handlers/gtdHandler', () => ({}));
jest.mock('../src/triggers/telegram/handlers/inboxHandler', () => ({}));
jest.mock('../src/services/faceVerificationService', () => ({
    verifyEmployeeFace: jest.fn().mockResolvedValue({ match: true, confidence: 99 }),
}));

// --- Test helpers ----------------------------------------------------------

function buildSession(overrides: Record<string, unknown>) {
    const data = { employeeName: 'Иван', clientName: 'BMW Tampa', clientId: 'client-1', companyId: 'company-1', ...overrides };
    return {
        id: 'session-1',
        ref: { id: 'session-1', update: mockUpdate },
        data: () => data,
    };
}

// --- Tests -----------------------------------------------------------------

describe('handleSkipMedia — selfie check-in audit trail', () => {
    let handleSkipMedia: (chatId: number, userId: number) => Promise<void>;

    beforeAll(async () => {
        // Import AFTER mocks are registered.
        ({ handleSkipMedia } = await import('../src/triggers/telegram/handlers/mediaHandler'));
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('F-3: skip at shift start writes audit fields, pushes admin, chains plan step', async () => {
        mockGetActiveSession.mockResolvedValue(buildSession({ awaitingStartPhoto: true }));

        await handleSkipMedia(/* chatId */ 111, /* userId */ 222);

        expect(mockUpdate).toHaveBeenCalledTimes(1);
        const payload = mockUpdate.mock.calls[0][0];
        expect(payload).toMatchObject({
            awaitingStartPhoto: false,
            awaitingStartVoice: true,            // 2026-04-17: chain plan step
            skippedStartPhoto: true,
            startPhotoSkipped: true,
            startPhotoSkipReason: 'worker_refused_no_camera',
        });
        expect(payload.startPhotoSkippedAt).toBeDefined();

        // Admin push with worker + project context.
        expect(mockSendAdminNotification).toHaveBeenCalledTimes(1);
        const adminMsg = mockSendAdminNotification.mock.calls[0][0] as string;
        expect(adminMsg).toContain('Start selfie skipped');
        expect(adminMsg).toContain('Иван');
        expect(adminMsg).toContain('BMW Tampa');

        // Main menu is NOT shown yet — the shift is only "announced" after
        // the plan step completes (voice / text / second skip).
        expect(mockSendMainMenu).not.toHaveBeenCalled();

        // Worker sees 2 messages: skip acknowledgement + plan prompt.
        expect(mockSendMessage).toHaveBeenCalledTimes(2);
        const planPrompt = mockSendMessage.mock.calls[1][1] as string;
        expect(planPrompt).toContain('планируешь');

        // Activity log for project timeline.
        expect(mockActivityAdd).toHaveBeenCalledTimes(1);
        expect(mockActivityAdd.mock.calls[0][0]).toMatchObject({
            projectId: 'client-1',
            content: 'Селфи старта пропущено работником',
        });
    });

    it('F-3b: skip at plan step (awaitingStartVoice) announces shift start + shows menu', async () => {
        mockGetActiveSession.mockResolvedValue(buildSession({ awaitingStartVoice: true }));

        await handleSkipMedia(111, 222);

        expect(mockUpdate).toHaveBeenCalledTimes(1);
        const payload = mockUpdate.mock.calls[0][0];
        expect(payload).toMatchObject({
            awaitingStartVoice: false,
            skippedStartVoice: true,
        });

        // Announcement + main menu — this is the moment the worker sees "Смена начата!"
        expect(mockSendMessage).toHaveBeenCalledTimes(1);
        const announcement = mockSendMessage.mock.calls[0][1] as string;
        expect(announcement).toContain('Смена начата');
        expect(announcement).toContain('BMW Tampa');
        expect(mockSendMainMenu).toHaveBeenCalledWith(111, 222);

        // Plan-skip is not an admin-visible event — no push, no activity log.
        expect(mockSendAdminNotification).not.toHaveBeenCalled();
        expect(mockActivityAdd).not.toHaveBeenCalled();
    });

    it('F-7: skip at shift end writes audit fields + keeps voice step + pushes admin', async () => {
        mockGetActiveSession.mockResolvedValue(buildSession({ awaitingEndPhoto: true }));

        await handleSkipMedia(111, 222);

        expect(mockUpdate).toHaveBeenCalledTimes(1);
        const payload = mockUpdate.mock.calls[0][0];
        expect(payload).toMatchObject({
            awaitingEndPhoto: false,
            awaitingEndVoice: true,       // end flow still wants the voice report
            skippedEndPhoto: true,
            endPhotoSkipped: true,
            endPhotoSkipReason: 'worker_skipped_on_finish',
        });
        expect(payload.endPhotoSkippedAt).toBeDefined();

        expect(mockSendAdminNotification).toHaveBeenCalledTimes(1);
        expect(mockSendAdminNotification.mock.calls[0][0]).toContain('Final photo skipped');

        expect(mockActivityAdd).toHaveBeenCalledWith(expect.objectContaining({
            content: 'Финальное фото пропущено работником',
        }));
    });

    it('does not touch Firestore when there is no active session', async () => {
        mockGetActiveSession.mockResolvedValue(null);

        await handleSkipMedia(111, 222);

        expect(mockUpdate).not.toHaveBeenCalled();
        expect(mockSendAdminNotification).not.toHaveBeenCalled();
        expect(mockActivityAdd).not.toHaveBeenCalled();
    });

    it('does not push admin when skipping a step that is not a photo', async () => {
        mockGetActiveSession.mockResolvedValue(buildSession({ awaitingStartVoice: true }));

        await handleSkipMedia(111, 222);

        expect(mockSendAdminNotification).not.toHaveBeenCalled();
        expect(mockActivityAdd).not.toHaveBeenCalled();
    });

    it('skips activity_logs when session has no concrete project (clientId "no_project")', async () => {
        mockGetActiveSession.mockResolvedValue(buildSession({
            awaitingStartPhoto: true,
            clientId: 'no_project',
        }));

        await handleSkipMedia(111, 222);

        // Audit fields still written to the session doc…
        expect(mockUpdate).toHaveBeenCalledTimes(1);
        // …but no activity_log (keeps timeline clean from "system" noise).
        expect(mockActivityAdd).not.toHaveBeenCalled();
        // Admin push still fires — Denis still wants to know.
        expect(mockSendAdminNotification).toHaveBeenCalledTimes(1);
    });
});
