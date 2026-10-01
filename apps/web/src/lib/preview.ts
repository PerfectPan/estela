const SOURCE_CHARS = 2_048
const OUTPUT_CHARS = 512

/** Bidi embedding, override, and isolate controls (U+202A–202E, U+2066–2069). */
const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/g

/**
 * Session text shows bidi controls as visible escapes (`<U+202E>`), so a recorded command
 * cannot reorder what the reader sees.
 */
export function escapeBidi(text: string): string {
  return text.replace(BIDI_CONTROLS, char => `<U+${char.charCodeAt(0).toString(16).toUpperCase()}>`)
}

/** One-line preview, same bounds as dsh trajectoryPreviewText. */
export function previewText(text: string): string {
  const source = text.slice(0, SOURCE_CHARS)
  const compact = escapeBidi(source.replace(/\s+/g, ' ').trim())
  const preview = compact.slice(0, OUTPUT_CHARS).trimEnd()
  return source.length < text.length || preview.length < compact.length ? `${preview}…` : preview
}

export function previewUnknown(value: unknown): string {
  if (value == null) {
    return ''
  }
  if (typeof value === 'string') {
    return previewText(value)
  }
  try {
    return previewText(JSON.stringify(value))
  } catch {
    return ''
  }
}
