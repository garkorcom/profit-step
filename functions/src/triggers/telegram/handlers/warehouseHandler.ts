/**
 * Warehouse AI handler — routes worker bot messages to the UC1 / UC2 / UC3
 * capabilities.
 *
 * SAFETY: This handler is guarded by a **feature flag** so it only activates
 * for explicitly whitelisted Telegram user IDs. Non-beta users are unaffected
 * and fall through to the existing handler chain.
 *
 * Enable via env var:
 *   WAREHOUSE_BETA_USERS=123456789,987654321
 *
 * Integration point: `onWorkerBotMessage.ts:handleMessage` calls
 * `tryHandleWarehouseMessage()` BEFORE the main dispatch. If it returns true,
 * the existing flow is skipped (the message was claimed by this handler).
 * If it returns false, everything else runs as usual.
 *
 * Capabilities covered here:
 *   - UC1 on-site voice: free text starting with "на <client>" / "я на" / "тут есть"
 *   - UC2 receipt vision: photo messages when user is in the beta list
 *   - UC3 auto-writeoff: callback-driven (from TaskAgent integration) — not in MVP
 *   - /stock command: show balances at user's van
 *
 * All writes pass through the existing REST endpoints (`/api/warehouse/*`) so
 * this handler stays thin.
 */

import axios from 'axios';
import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';
import { sendMessage, findPlatformUser } from '../telegramUtils';
import {
  parseOnSiteInventory,
  parseReceipt,
  type ParseOnSiteInventoryResult,
  type ParseReceiptResult,
} from '../../../warehouse/agent';
import {
  loadCatalog,
  loadClients,
  loadVendors,
} from '../../../warehouse/api/loaders';

function getWorkerBotToken(): string {
  return process.env.WORKER_BOT_TOKEN || '';
}

// ═══════════════════════════════════════════════════════════════════
//  Feature flag
// ═══════════════════════════════════════════════════════════════════

/** Returns the set of Telegram user IDs enrolled in the warehouse beta. */
export function getBetaUsers(): Set<string> {
  const raw = process.env.WAREHOUSE_BETA_USERS || '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

export function isWarehouseBetaUser(userId: number | string): boolean {
  const beta = getBetaUsers();
  if (beta.size === 0) return false;
  return beta.has(String(userId));
}

// ═══════════════════════════════════════════════════════════════════
//  Entry point — called from onWorkerBotMessage
// ═══════════════════════════════════════════════════════════════════

/**
 * Try to handle the given Telegram message as a warehouse-AI interaction.
 * Returns `true` if the message was claimed (existing handlers should be
 * skipped), `false` otherwise.
 */
export async function tryHandleWarehouseMessage(message: any): Promise<boolean> {
  const chatId = message?.chat?.id;
  const userId = message?.from?.id;
  if (!chatId || !userId) return false;

  if (!isWarehouseBetaUser(userId)) return false;

  try {
    const text: string | undefined = message.text;
    const photos: Array<{ file_id: string; file_size?: number }> | undefined = message.photo;

    // /stock [item?] — show balances
    if (text === '/stock' || text?.startsWith('/stock ')) {
      await handleStockCommand(chatId, userId, text.replace(/^\/stock\s*/, '').trim());
      return true;
    }

    // /onsite <text> — explicit on-site voice
    if (text?.startsWith('/onsite ')) {
      await handleOnSiteText(chatId, userId, text.slice('/onsite '.length));
      return true;
    }

    // Photo — treat as receipt if large enough (excludes stickers/gifs which don't have .photo)
    if (photos && photos.length > 0) {
      const largest = photos[photos.length - 1];
      await handleReceiptPhoto(chatId, userId, largest.file_id);
      return true;
    }

    // Heuristic: free text that looks like on-site inventory
    if (text && looksLikeOnSitePhrase(text)) {
      await handleOnSiteText(chatId, userId, text);
      return true;
    }

    return false;
  } catch (e: any) {
    logger.error('warehouseHandler: uncaught error — falling through', {
      error: e?.message,
      userId,
    });
    // Do NOT rethrow — let the existing flow continue so the bot stays alive.
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════
//  Heuristic — detect on-site phrases in free text
// ═══════════════════════════════════════════════════════════════════

const ON_SITE_PATTERNS: RegExp[] = [
  /^\s*на\s+[A-Za-zА-Яа-яЁё]/i, // "на Dvorkin ..."
  /^\s*я\s+на\s+/i, // "я на объекте"
  /^\s*тут\s+(есть|лежит|лежат|остал)/i, // "тут есть 3 коробки"
  /^\s*at\s+[A-Za-z0-9]/i, // "at Dvorkin ..." / "at 500 Biscayne"
  /^\s*here\s+(is|are)\s+/i, // "here are 5 outlets"
];

export function looksLikeOnSitePhrase(text: string): boolean {
  if (!text || text.length < 8) return false;
  // Commands + simple phrases should not trigger
  if (text.startsWith('/')) return false;
  return ON_SITE_PATTERNS.some((re) => re.test(text));
}

// ═══════════════════════════════════════════════════════════════════
//  UC1 — on-site parse
// ═══════════════════════════════════════════════════════════════════

export async function handleOnSiteText(chatId: number, userId: number, text: string): Promise<void> {
  await sendMessage(chatId, '🤖 Распознаю инвентарь...');

  const db = admin.firestore();
  const [catalog, clients] = await Promise.all([loadCatalog(db), loadClients(db)]);

  const platformUser = await findPlatformUser(userId).catch(() => null);
  const uid = platformUser?.id ?? String(userId);

  const result: ParseOnSiteInventoryResult = await parseOnSiteInventory({
    userId: uid,
    text,
    catalog,
    clients,
  });

  if (!result.ok) {
    await sendMessage(chatId, onSiteFailureMessage(result.reason));
    return;
  }

  const lines = result.items
    .map((i) => {
      const tag = i.needsClarification ? ' ❓' : i.catalogItemId ? ' ✅' : ' ⚠️';
      return `• ${i.name} × ${i.qty} ${i.unit}${tag}`;
    })
    .join('\n');

  const siteLabel = result.siteHint.clientName || result.siteHint.addressHint || '—';
  const body =
    `📋 *Виртуальный склад объекта: ${siteLabel}*\n\n` +
    lines +
    '\n\n✅ — распознано автоматически\n❓ — требует подтверждения\n⚠️ — новая позиция, не в каталоге' +
    '\n\n_(следующий шаг: подтверждение через веб-UI; в MVP создаётся draft через API)_';

  await sendMessage(chatId, body);
}

function onSiteFailureMessage(reason: string): string {
  switch (reason) {
    case 'not_on_site':
      return '🤔 Не похоже на описание инвентаря. Попробуй: "на Dvorkin 3 розетки и катушка провода".';
    case 'too_vague':
      return '🤔 Слишком кратко. Напиши что конкретно и сколько.';
    case 'no_items':
      return '🤔 Не нашёл позиций в тексте. Попробуй упомянуть конкретные материалы.';
    case 'ai_unavailable':
      return '⚠️ AI временно недоступен, попробуй через минуту.';
    default:
      return '⚠️ Не смог распарсить. Попробуй переформулировать.';
  }
}

// ═══════════════════════════════════════════════════════════════════
//  UC2 — receipt photo
// ═══════════════════════════════════════════════════════════════════

export async function handleReceiptPhoto(chatId: number, userId: number, fileId: string): Promise<void> {
  await sendMessage(chatId, '🤖 Распознаю чек...');

  const imageBase64 = await downloadTelegramFileBase64(fileId);
  if (!imageBase64) {
    await sendMessage(chatId, '⚠️ Не смог скачать фото. Попробуй отправить заново.');
    return;
  }

  const db = admin.firestore();
  const [catalog, vendors] = await Promise.all([loadCatalog(db), loadVendors(db)]);

  const platformUser = await findPlatformUser(userId).catch(() => null);
  const uid = platformUser?.id ?? String(userId);

  const result: ParseReceiptResult = await parseReceipt({
    userId: uid,
    imageBase64,
    imageMimeType: 'image/jpeg',
    catalog,
    vendors,
  });

  if (!result.ok) {
    await sendMessage(chatId, receiptFailureMessage(result.reason));
    return;
  }

  const matchedLines = result.items
    .filter((i) => !!i.catalogItemId)
    .map((i) => `• ${i.name} × ${i.qty} ${i.unit} ≈ $${(i.totalPrice ?? 0).toFixed(2)}`)
    .join('\n');
  const unmatched = result.draftPayload.unmatched.length;

  const body =
    `📋 *${result.vendor.name}${result.vendor.storeNumber ? ' ' + result.vendor.storeNumber : ''}*` +
    (result.date ? ` — ${result.date}` : '') +
    (result.totals.total ? ` — $${result.totals.total.toFixed(2)}` : '') +
    '\n\n' +
    (matchedLines || '(ничего не распознано)') +
    (unmatched > 0 ? `\n\n⚠️ Не в каталоге: ${unmatched} позиций — создадим вручную позже.` : '') +
    '\n\n_(следующий шаг: подтверждение через веб-UI; в MVP создаётся draft через API)_';

  await sendMessage(chatId, body);
}

function receiptFailureMessage(reason: string): string {
  switch (reason) {
    case 'not_a_receipt':
      return '🤔 Это не похоже на чек. Отправь фото с чётким текстом.';
    case 'receipt_unreadable':
      return '⚠️ Чек нечитаемый. Попробуй переснять при хорошем свете, без бликов.';
    case 'no_items':
      return '🤔 На чеке нет позиций.';
    case 'ai_unavailable':
      return '⚠️ AI временно недоступен, попробуй через минуту.';
    default:
      return '⚠️ Не смог распарсить чек.';
  }
}

// ═══════════════════════════════════════════════════════════════════
//  /stock — show balances at user's location (informational only)
// ═══════════════════════════════════════════════════════════════════

export async function handleStockCommand(
  chatId: number,
  userId: number,
  filter: string,
): Promise<void> {
  const db = admin.firestore();

  // Best-effort resolve the user's van: match ownerEmployeeId via users table.
  const platformUser = await findPlatformUser(userId).catch(() => null);
  const ownerEmployeeId = platformUser?.id;

  if (!ownerEmployeeId) {
    await sendMessage(chatId, '⚠️ Не нашёл твой профиль. Свяжись с администратором.');
    return;
  }

  const locSnap = await db
    .collection('wh_locations')
    .where('ownerEmployeeId', '==', ownerEmployeeId)
    .where('isActive', '==', true)
    .limit(1)
    .get();

  if (locSnap.empty) {
    await sendMessage(chatId, '⚠️ Твой van не найден в системе. Создай его в админке.');
    return;
  }

  const locationId = locSnap.docs[0].id;
  const locationName = locSnap.docs[0].data()?.name ?? locationId;

  const balances = await db
    .collection('wh_balances')
    .where('locationId', '==', locationId)
    .limit(100)
    .get();

  if (balances.empty) {
    await sendMessage(chatId, `📦 *${locationName}*\n\nПока пусто.`);
    return;
  }

  const rows = balances.docs
    .map((d) => d.data() as any)
    .filter((b) => (b.onHandQty ?? 0) > 0)
    .sort((a, b) => (b.onHandQty ?? 0) - (a.onHandQty ?? 0));

  if (rows.length === 0) {
    await sendMessage(chatId, `📦 *${locationName}*\n\nПока пусто.`);
    return;
  }

  // Fetch item names in a single pass (simple for MVP)
  const itemIds = rows.map((r) => r.itemId);
  const items = await db.getAll(
    ...itemIds.map((id) => db.collection('wh_items').doc(id)),
  );
  const nameById = new Map<string, string>(
    items.filter((i) => i.exists).map((i) => [i.id, (i.data() as any)?.name ?? i.id]),
  );

  const needle = filter.toLowerCase();
  const list = rows
    .map((r) => {
      const name = nameById.get(r.itemId) ?? r.itemId;
      if (needle && !name.toLowerCase().includes(needle)) return null;
      return `• ${name}: *${r.onHandQty ?? 0}*`;
    })
    .filter(Boolean);

  await sendMessage(
    chatId,
    `📦 *${locationName}*${filter ? ` — поиск "${filter}"` : ''}\n\n${list.slice(0, 40).join('\n')}`,
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Helpers — Telegram file download
// ═══════════════════════════════════════════════════════════════════

async function downloadTelegramFileBase64(fileId: string): Promise<string | null> {
  const token = getWorkerBotToken();
  if (!token) return null;
  try {
    const infoResp = await axios.get(
      `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`,
      { timeout: 10000 },
    );
    const filePath = infoResp.data?.result?.file_path;
    if (!filePath) return null;
    const fileResp = await axios.get(
      `https://api.telegram.org/file/bot${token}/${filePath}`,
      { responseType: 'arraybuffer', timeout: 15000 },
    );
    return Buffer.from(fileResp.data).toString('base64');
  } catch (e: any) {
    logger.warn('warehouseHandler: photo download failed', { error: e.message });
    return null;
  }
}
