/**
 * Inbound RFQ email webhook — SendGrid Inbound Parse POSTs here.
 *
 * Parses the email body via Gemini, correlates to our original RFQ via
 * the rfq_... token we embed in outgoing emails, and persists a quote
 * to wh_vendor_quotes. Also fires a webhook event the Estimate agent
 * can subscribe to.
 *
 * Reference: docs/warehouse/improvements/10_vendor_email/SPEC.md §4.1.
 *
 * SECURITY NOTE: the route is mounted AFTER agent-token middleware by
 * default, so SendGrid must include our webhook HMAC secret in the
 * configured URL path. For MVP we also accept an optional shared secret
 * in an X-Webhook-Secret header (set via RFQ_INBOUND_SHARED_SECRET env).
 */

import { Router } from 'express';
import { db, FieldValue, logger } from '../../../agent/routeContext';
import { parseRfqReply, correlateRfqId } from '../../agent';
import { wrapRoute } from '../errorHandler';

const router = Router();

router.post(
  '/api/warehouse/agent/rfq-inbound',
  wrapRoute(async (req, res) => {
    const requiredSecret = process.env.RFQ_INBOUND_SHARED_SECRET;
    if (requiredSecret) {
      const provided = req.header('X-Webhook-Secret') ?? '';
      if (provided !== requiredSecret) {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'invalid webhook secret' } });
        return;
      }
    }

    // SendGrid Inbound Parse sends `text` (plain) + `html` + `subject`. Accept both
    // the multipart-derived fields and a simple JSON shape used by our own tests.
    const body = (req.body?.text ?? req.body?.emailBody ?? '') as string;
    const subject = (req.body?.subject ?? '') as string;
    const inReplyTo = (req.body?.['In-Reply-To'] ?? req.body?.inReplyTo ?? '') as string;
    const references = (req.body?.References ?? req.body?.references ?? '') as string;
    const fromAddress = (req.body?.from ?? '') as string;

    if (!body || body.length < 20) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'empty or too-short email body' },
      });
      return;
    }

    // Correlate to original RFQ
    const rfqId = correlateRfqId({ subject, body, inReplyTo, references });
    let vendorId: string | undefined;
    let projectId: string | undefined;
    if (rfqId) {
      const rfqSnap = await db.collection('wh_rfq_records').doc(rfqId).get();
      if (rfqSnap.exists) {
        const data = rfqSnap.data() as any;
        vendorId = data.vendorId;
        projectId = data.projectId ?? undefined;
      }
    }

    const parsed = await parseRfqReply({ emailBody: body, rfqId: rfqId ?? undefined, vendorId });

    // Persist quote (always — even failure, for audit)
    const quoteRef = db.collection('wh_vendor_quotes').doc();
    await quoteRef.set({
      id: quoteRef.id,
      schemaVersion: 1,
      rfqId: rfqId ?? null,
      vendorId: vendorId ?? null,
      projectId: projectId ?? null,
      fromAddress: fromAddress || null,
      subject: subject || null,
      parseOk: parsed.ok,
      parseReason: parsed.ok ? null : parsed.reason,
      items: parsed.ok ? parsed.items : null,
      overall: parsed.ok ? parsed.overall : null,
      rawBody: body.slice(0, 10000), // truncate to avoid Firestore 1MB limit
      receivedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      createdBy: 'rfq_inbound_webhook',
      createdByType: 'system',
    });

    // Update the RFQ record status if we could correlate
    if (rfqId) {
      const status = parsed.ok ? 'quoted' : 'parse_failed';
      await db.collection('wh_rfq_records').doc(rfqId).set(
        {
          status,
          quoteId: quoteRef.id,
          quotedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    // Fire event (tests can subscribe; for prod this becomes a real webhook
    // delivery via the existing webhooks infrastructure).
    await db.collection('wh_events').add({
      schemaVersion: 1,
      eventType: parsed.ok ? 'warehouse.vendor_quote_received' : 'warehouse.rfq_reply_unparsed',
      entityType: 'rfq',
      entityId: rfqId ?? quoteRef.id,
      payload: {
        rfqId: rfqId ?? null,
        quoteId: quoteRef.id,
        vendorId: vendorId ?? null,
        projectId: projectId ?? null,
        items: parsed.ok ? parsed.items.length : 0,
      },
      occurredAt: FieldValue.serverTimestamp(),
    });

    logger.info('🏭 warehouse:rfq-inbound', {
      rfqId: rfqId ?? 'uncorrelated',
      quoteId: quoteRef.id,
      parseOk: parsed.ok,
      itemCount: parsed.ok ? parsed.items.length : 0,
    });

    res.status(200).json({
      quoteId: quoteRef.id,
      rfqId: rfqId ?? null,
      parseOk: parsed.ok,
      reason: parsed.ok ? null : (parsed as any).reason,
    });
  }),
);

export default router;
