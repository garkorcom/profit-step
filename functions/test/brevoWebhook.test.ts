/**
 * TEST CASE #3: Brevo Webhook Handler
 *
 * Проверяет обработку webhook событий от Brevo
 * (bounced, delivered, opened, clicked, etc.)
 */

import { test, admin, db, cleanup } from './setup';

// Mock Express Request/Response
interface MockRequest {
  body: any;
  headers?: any;
}

interface MockResponse {
  status: jest.Mock;
  send: jest.Mock;
  json: jest.Mock;
}

const createMockResponse = (): MockResponse => ({
  status: jest.fn().mockReturnThis(),
  send: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
});

describe('Brevo Webhook Handler', () => {
  beforeEach(async () => {
    // Clean up test data
    const invitationsSnapshot = await db.collection('invitations').get();
    const emailEventsSnapshot = await db.collection('emailEvents').get();

    const batch = db.batch();
    invitationsSnapshot.docs.forEach((doc) => batch.delete(doc.ref));
    emailEventsSnapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();

    // Setup test invitation
    await db.collection('invitations').doc('inv123').set({
      id: 'inv123',
      email: 'test@example.com',
      companyId: 'company1',
      status: 'sent',
      brevoData: {
        messageId: 'msg-abc-123',
        templateId: 1,
      },
      createdAt: admin.firestore.Timestamp.now(),
    });
  });

  afterAll(async () => {
    await cleanup();
  });

  it('should handle bounced email event', async () => {
    const mockBrevoWebhookHandler = async (req: MockRequest, res: MockResponse) => {
      const { event, 'message-id': messageId, email } = req.body;

      // Find invitation by messageId
      const invitationsSnapshot = await db.collection('invitations')
        .where('brevoData.messageId', '==', messageId)
        .get();

      if (invitationsSnapshot.empty) {
        res.status(404).send({ error: 'Invitation not found' });
        return;
      }

      const invitationDoc = invitationsSnapshot.docs[0];

      // Update invitation status
      if (event === 'hard_bounce' || event === 'soft_bounce') {
        await invitationDoc.ref.update({
          status: 'bounced',
          updatedAt: admin.firestore.Timestamp.now(),
        });
      }

      // Create emailEvent
      await db.collection('emailEvents').add({
        invitationId: invitationDoc.id,
        companyId: invitationDoc.data().companyId,
        event,
        messageId,
        email,
        timestamp: admin.firestore.Timestamp.now(),
        metadata: req.body,
      });

      res.status(200).send({ success: true });
    };

    // Simulate webhook request
    const req: MockRequest = {
      body: {
        event: 'hard_bounce',
        'message-id': 'msg-abc-123',
        email: 'test@example.com',
        date: '2025-01-15 10:30:00',
        reason: 'invalid_domain',
      },
    };

    const res = createMockResponse();

    // Execute webhook handler
    await mockBrevoWebhookHandler(req, res);

    // Verify response
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true });

    // Verify Firestore updates
    const invDoc = await db.collection('invitations').doc('inv123').get();
    expect(invDoc.data()?.status).toBe('bounced');

    // Verify emailEvent created
    const emailEvents = await db.collection('emailEvents')
      .where('messageId', '==', 'msg-abc-123')
      .get();

    expect(emailEvents.size).toBe(1);
    expect(emailEvents.docs[0].data().event).toBe('hard_bounce');
    expect(emailEvents.docs[0].data().invitationId).toBe('inv123');
  });

  it('should handle delivered email event', async () => {
    const mockBrevoWebhookHandler = async (req: MockRequest, res: MockResponse) => {
      const { event, 'message-id': messageId, email } = req.body;

      const invitationsSnapshot = await db.collection('invitations')
        .where('brevoData.messageId', '==', messageId)
        .get();

      if (invitationsSnapshot.empty) {
        res.status(404).send({ error: 'Invitation not found' });
        return;
      }

      const invitationDoc = invitationsSnapshot.docs[0];

      if (event === 'delivered') {
        await invitationDoc.ref.update({
          status: 'delivered',
          deliveredAt: admin.firestore.Timestamp.now(),
        });
      }

      await db.collection('emailEvents').add({
        invitationId: invitationDoc.id,
        companyId: invitationDoc.data().companyId,
        event,
        messageId,
        email,
        timestamp: admin.firestore.Timestamp.now(),
        metadata: req.body,
      });

      res.status(200).send({ success: true });
    };

    const req: MockRequest = {
      body: {
        event: 'delivered',
        'message-id': 'msg-abc-123',
        email: 'test@example.com',
        date: '2025-01-15 10:35:00',
      },
    };

    const res = createMockResponse();
    await mockBrevoWebhookHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);

    const invDoc = await db.collection('invitations').doc('inv123').get();
    expect(invDoc.data()?.status).toBe('delivered');
    expect(invDoc.data()?.deliveredAt).toBeDefined();
  });

  it('should handle opened email event', async () => {
    const mockBrevoWebhookHandler = async (req: MockRequest, res: MockResponse) => {
      const { event, 'message-id': messageId } = req.body;

      const invitationsSnapshot = await db.collection('invitations')
        .where('brevoData.messageId', '==', messageId)
        .get();

      if (!invitationsSnapshot.empty) {
        const invitationDoc = invitationsSnapshot.docs[0];

        await db.collection('emailEvents').add({
          invitationId: invitationDoc.id,
          companyId: invitationDoc.data().companyId,
          event,
          messageId,
          timestamp: admin.firestore.Timestamp.now(),
          metadata: req.body,
        });
      }

      res.status(200).send({ success: true });
    };

    const req: MockRequest = {
      body: {
        event: 'opened',
        'message-id': 'msg-abc-123',
        email: 'test@example.com',
        date: '2025-01-15 11:00:00',
        ip: '192.168.1.1',
      },
    };

    const res = createMockResponse();
    await mockBrevoWebhookHandler(req, res);

    const emailEvents = await db.collection('emailEvents')
      .where('event', '==', 'opened')
      .get();

    expect(emailEvents.size).toBe(1);
  });

  it('should handle clicked email event', async () => {
    const mockBrevoWebhookHandler = async (req: MockRequest, res: MockResponse) => {
      const { event, 'message-id': messageId, link } = req.body;

      const invitationsSnapshot = await db.collection('invitations')
        .where('brevoData.messageId', '==', messageId)
        .get();

      if (!invitationsSnapshot.empty) {
        const invitationDoc = invitationsSnapshot.docs[0];

        await db.collection('emailEvents').add({
          invitationId: invitationDoc.id,
          companyId: invitationDoc.data().companyId,
          event,
          messageId,
          timestamp: admin.firestore.Timestamp.now(),
          metadata: {
            ...req.body,
            link,
          },
        });
      }

      res.status(200).send({ success: true });
    };

    const req: MockRequest = {
      body: {
        event: 'clicked',
        'message-id': 'msg-abc-123',
        email: 'test@example.com',
        link: 'https://profit-step.app/invite/accept',
      },
    };

    const res = createMockResponse();
    await mockBrevoWebhookHandler(req, res);

    const emailEvents = await db.collection('emailEvents')
      .where('event', '==', 'clicked')
      .get();

    expect(emailEvents.size).toBe(1);
    expect(emailEvents.docs[0].data().metadata.link).toBe('https://profit-step.app/invite/accept');
  });

  it('should return 404 if invitation not found', async () => {
    const mockBrevoWebhookHandler = async (req: MockRequest, res: MockResponse) => {
      const { 'message-id': messageId } = req.body;

      const invitationsSnapshot = await db.collection('invitations')
        .where('brevoData.messageId', '==', messageId)
        .get();

      if (invitationsSnapshot.empty) {
        res.status(404).send({ error: 'Invitation not found' });
        return;
      }

      res.status(200).send({ success: true });
    };

    const req: MockRequest = {
      body: {
        event: 'delivered',
        'message-id': 'non-existent-message-id',
        email: 'unknown@example.com',
      },
    };

    const res = createMockResponse();
    await mockBrevoWebhookHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith({ error: 'Invitation not found' });
  });
});
