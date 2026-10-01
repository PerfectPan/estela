export function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 17 L8.5 9 L13 14 L21 5"
        stroke="var(--foreground)"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <circle cx="3" cy="17" r="2" fill="var(--background)" stroke="var(--kind-request)" stroke-width="1.6" />
      <circle cx="8.5" cy="9" r="2" fill="var(--background)" stroke="var(--foreground)" stroke-width="1.6" />
      <circle cx="13" cy="14" r="2" fill="var(--background)" stroke="var(--foreground)" stroke-width="1.6" />
      <circle cx="21" cy="5" r="2" fill="var(--kind-request)" />
    </svg>
  )
}
