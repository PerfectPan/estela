const SOURCE_CHARS = 2_048
const OUTPUT_CHARS = 512

/** One-line preview, same bounds as dsh trajectoryPreviewText. */
export function previewText(text: string): string {
  const source = text.slice(0, SOURCE_CHARS)
  const compact = source.replace(/\s+/g, ' ').trim()
  const preview = compact.slice(0, OUTPUT_CHARS).trimEnd()
  return source.length < text.length || preview.length < compact.length
    ? `${preview}…`
    : preview
}

export function previewUnknown(value: unknown): string {
  if (value == null)
    return ''
  if (typeof value === 'string')
    return previewText(value)
  try {
    return previewText(JSON.stringify(value))
  }
  catch {
    return ''
  }
}
