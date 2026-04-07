/**
 * Converts a string to a URL-friendly slug.
 * "Jim Dvorkin" → "jim-dvorkin"
 * "24 Isla Bahia Dr" → "24-isla-bahia-dr"
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}
