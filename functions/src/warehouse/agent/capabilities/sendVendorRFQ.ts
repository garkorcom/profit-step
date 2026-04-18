/**
 * UC4.c — Send Request-for-Quote email to a vendor.
 *
 * Interface-first design: an `RFQEmailProvider` executes the send.
 * Production wires SendGrid; tests / dev pass a stub that captures
 * the message without actually sending.
 *
 * Reference: docs/warehouse/improvements/10_vendor_email/SPEC.md.
 */

// ═══════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════

export interface RFQLineItem {
  itemHint: string;
  qty: number;
  unit: string;
  specs?: string;
}

export interface RFQRequest {
  /** Vendor directory id for audit reference. */
  vendorId: string;
  vendorName: string;
  vendorEmail: string;
  projectId?: string;
  projectName?: string;
  requesterName: string;
  requesterCompany: string;
  items: RFQLineItem[];
  /** Optional note from requester, e.g. "please quote pickup vs delivery". */
  note?: string;
}

export interface RFQEnvelope {
  to: string;
  from: string;
  subject: string;
  body: string;
  replyTo: string;
  customArgs: {
    rfqId: string;
    projectId?: string;
    vendorId: string;
  };
}

export interface RFQSendResult {
  rfqId: string;
  envelope: RFQEnvelope;
  sentAt: string;
  providerMessageId?: string;
}

export interface RFQEmailProvider {
  readonly name: string;
  send(envelope: RFQEnvelope): Promise<{ messageId?: string }>;
}

// ═══════════════════════════════════════════════════════════════════
//  Compose envelope
// ═══════════════════════════════════════════════════════════════════

export interface ComposeRFQOptions {
  /** Sender mailbox — must be a verified sender domain with the provider. */
  fromAddress: string;
  replyToAddress: string;
}

export function composeRFQEnvelope(
  request: RFQRequest,
  options: ComposeRFQOptions,
  rfqId: string,
): RFQEnvelope {
  const projectTag = request.projectName ? ` for ${request.projectName}` : '';
  const subject = `RFQ: ${request.items.length} items${projectTag} — ${request.requesterCompany}`;

  const itemsList = request.items
    .map((item, i) => {
      const specsPart = item.specs ? ` — ${item.specs}` : '';
      return `${i + 1}. ${item.itemHint} × ${item.qty} ${item.unit}${specsPart}`;
    })
    .join('\n');

  const lines: string[] = [
    `Hi ${request.vendorName},`,
    '',
    `Requesting quote for the following${projectTag}:`,
    '',
    itemsList,
    '',
    'Please reply with:',
    '- Price per unit',
    '- Availability / lead time',
    '- Payment terms',
    '',
  ];
  if (request.note) {
    lines.push(`Note: ${request.note}`, '');
  }
  if (request.projectId) {
    lines.push(`Project ref: ${request.projectId}`);
  }
  lines.push(`RFQ ref: ${rfqId}`, '', 'Thanks,', request.requesterName, request.requesterCompany);

  return {
    to: request.vendorEmail,
    from: options.fromAddress,
    replyTo: options.replyToAddress,
    subject,
    body: lines.join('\n'),
    customArgs: {
      rfqId,
      projectId: request.projectId,
      vendorId: request.vendorId,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
//  Public entry point
// ═══════════════════════════════════════════════════════════════════

let rfqCounter = 0;
function generateRfqId(): string {
  const ts = Date.now().toString(36);
  const seq = (++rfqCounter).toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `rfq_${ts}_${seq}_${rand}`;
}

export interface SendRFQOptions {
  provider: RFQEmailProvider;
  compose: ComposeRFQOptions;
  /** Precomputed id — useful for tests that want determinism. */
  rfqId?: string;
}

export async function sendVendorRFQ(
  request: RFQRequest,
  options: SendRFQOptions,
): Promise<RFQSendResult> {
  if (!request.vendorEmail) {
    throw new Error('sendVendorRFQ: vendor has no contactEmail');
  }
  if (request.items.length === 0) {
    throw new Error('sendVendorRFQ: RFQ must have at least one item');
  }

  const rfqId = options.rfqId ?? generateRfqId();
  const envelope = composeRFQEnvelope(request, options.compose, rfqId);

  const providerResult = await options.provider.send(envelope);

  return {
    rfqId,
    envelope,
    sentAt: new Date().toISOString(),
    providerMessageId: providerResult.messageId,
  };
}

// ═══════════════════════════════════════════════════════════════════
//  In-memory stub provider (for dev + tests)
// ═══════════════════════════════════════════════════════════════════

export class InMemoryRFQEmailProvider implements RFQEmailProvider {
  readonly name = 'in_memory_stub';
  readonly sent: RFQEnvelope[] = [];
  private messageIdSeq = 0;

  async send(envelope: RFQEnvelope): Promise<{ messageId?: string }> {
    this.sent.push(envelope);
    return { messageId: `mem-${++this.messageIdSeq}` };
  }

  clear(): void {
    this.sent.length = 0;
  }
}
