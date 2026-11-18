/** The product's glyph without the tile (as in apps/web's top bar): a request trace ending at the selected request. */
export function SiteLogo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 17 L8.5 9 L13 14 L21 5"
        stroke="var(--foreground)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="3" cy="17" r="2" fill="var(--background)" stroke="var(--foreground)" strokeWidth="1.6" />
      <circle cx="8.5" cy="9" r="2" fill="var(--background)" stroke="var(--foreground)" strokeWidth="1.6" />
      <circle cx="13" cy="14" r="2" fill="var(--background)" stroke="var(--foreground)" strokeWidth="1.6" />
      <circle cx="21" cy="5" r="2.2" fill="var(--kind-request)" />
    </svg>
  )
}
