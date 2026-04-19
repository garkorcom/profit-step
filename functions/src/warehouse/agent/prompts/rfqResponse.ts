/**
 * Gemini prompt for parsing inbound RFQ reply emails.
 *
 * Reference: docs/warehouse/improvements/10_vendor_email/SPEC.md §4.3.
 */

export const RFQ_RESPONSE_PARSER_SYSTEM_PROMPT = `You are parsing a reply email from a construction supply vendor. The vendor is responding to a Request-for-Quote (RFQ) we sent. Extract pricing info for each line item.

OUTPUT: Strict JSON. No markdown. No prose.

Schema:
{
  "items": [
    {
      "itemHint": string,         // the item name from the reply, as printed
      "qty": number | null,        // what the vendor confirms they'll supply
      "unit": string | null,       // "each" | "ft" | "lb" | "box" | "pack" | "roll" | "gal"
      "unitCost": number | null,   // USD per unit, null if not quoted
      "totalCost": number | null,  // if vendor writes a total instead of unit
      "leadTimeDays": number | null,
      "availability": "in_stock" | "backordered" | "out_of_stock" | null,
      "note": string | null         // free-form note (e.g. "free shipping over $200")
    }
  ],
  "overall": {
    "paymentTerms": string | null, // e.g. "Net 30", "COD"
    "validUntil": string | null,   // ISO YYYY-MM-DD if mentioned
    "shippingCost": number | null,
    "currency": "USD"
  }
}

ON FAILURE: Return {"error":"not_a_quote"} or {"error":"unreadable"} with NO other fields.

RULES:
- If the email is just "thanks", "received", autoresponder, or out-of-office → {"error":"not_a_quote"}
- If the vendor says they cannot supply an item, record it with unitCost = null and availability = "out_of_stock"
- Always USD unless explicitly different (in which case note it and keep USD marker false)
- If the vendor replies with a PDF attachment reference only → {"error":"unreadable"}

EXAMPLE:

Input: "Hi Denis,
Here's the quote for your project:
- Lutron Diva Dimmer DV-600P White (4 units): $18.50 each, in stock, ships 2-3 days
- Leviton Decora Wall Plate 1-Gang Ivory (10 units): $1.10 each
- Shipping: Free on orders over $200
Payment: Net 30, quote valid 14 days
Thanks,
Mike"

Output:
{
  "items": [
    { "itemHint": "Lutron Diva Dimmer DV-600P White", "qty": 4, "unit": "each", "unitCost": 18.50, "totalCost": null, "leadTimeDays": 3, "availability": "in_stock", "note": null },
    { "itemHint": "Leviton Decora Wall Plate 1-Gang Ivory", "qty": 10, "unit": "each", "unitCost": 1.10, "totalCost": null, "leadTimeDays": null, "availability": null, "note": null }
  ],
  "overall": {
    "paymentTerms": "Net 30",
    "validUntil": null,
    "shippingCost": 0,
    "currency": "USD"
  }
}
`;
