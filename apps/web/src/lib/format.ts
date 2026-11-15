/**
 * Every date, time, duration, and number shown in the UI goes through this module.
 * `Intl.DateTimeFormat`, `Intl.RelativeTimeFormat`, and `Intl.NumberFormat` follow the locale;
 * the token abbreviation (`118.4k`, `2.41M`) does not.
 */

function startOfDay(ts: number): number {
  const date = new Date(ts)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** Monday 00:00 in the local time zone. */
function startOfWeek(ts: number): number {
  const date = new Date(startOfDay(ts))
  const offset = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - offset)
  return date.getTime()
}

export type DayBucket = { kind: 'today' | 'yesterday' | 'week' } | { kind: 'day'; day: number }

/** Session list groups: today, yesterday, earlier this week, then one group per calendar day. */
export function dayBucket(ts: number, now = Date.now()): DayBucket {
  const day = startOfDay(ts)
  const today = startOfDay(now)
  if (day >= today) {
    return { kind: 'today' }
  }
  // `setDate` rather than 24 h, so a daylight-saving change does not shift the boundary.
  const yesterdayDate = new Date(today)
  yesterdayDate.setDate(yesterdayDate.getDate() - 1)
  const yesterday = yesterdayDate.getTime()
  if (day === yesterday) {
    return { kind: 'yesterday' }
  }
  if (day >= startOfWeek(now)) {
    return { kind: 'week' }
  }
  return { kind: 'day', day }
}

export function bucketKey(bucket: DayBucket): string {
  return bucket.kind === 'day' ? `day-${bucket.day}` : bucket.kind
}

/** "Today" / "今天" and "Yesterday" / "昨天" come from `Intl.RelativeTimeFormat`. */
export function relativeDay(offset: 0 | -1, locale: string): string {
  const text = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(offset, 'day')
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1)
}

export function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)
}

/**
 * Locale-independent. `118400` → `118.4k`, `884000` → `884k`, `2410000` → `2.41M`, `1200000` → `1.20M`
 * (millions keep two decimals, as in the design).
 */
export function formatTokens(value: number): string {
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  if (abs >= 999_950) {
    return `${sign}${(abs / 1_000_000).toFixed(2)}M`
  }
  // 999.5 rounds to 1000: show it as 1k, not 1000.
  if (abs >= 999.5) {
    return `${sign}${(abs / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  }
  return `${sign}${Math.round(abs)}`
}

function formatClock(ts: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ts)
}

function formatWeekday(ts: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(ts)
}

export function formatDate(ts: number, locale: string, now = Date.now()): string {
  const sameYear = new Date(ts).getFullYear() === new Date(now).getFullYear()
  return new Intl.DateTimeFormat(
    locale,
    sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' },
  ).format(ts)
}

/** A day group header for a calendar day: `Mon, Sep 15` / `9月15日周一`. */
export function formatDayHeading(ts: number, locale: string, now = Date.now()): string {
  const sameYear = new Date(ts).getFullYear() === new Date(now).getFullYear()
  return new Intl.DateTimeFormat(
    locale,
    sameYear
      ? { weekday: 'short', month: 'short', day: 'numeric' }
      : { year: 'numeric', month: 'short', day: 'numeric' },
  ).format(ts)
}

/** The "Active" column: a clock time today and yesterday, the weekday this week, a date before. */
export function formatActive(ts: number, locale: string, now = Date.now()): string {
  const bucket = dayBucket(ts, now)
  if (bucket.kind === 'today' || bucket.kind === 'yesterday') {
    return formatClock(ts, locale)
  }
  if (bucket.kind === 'week') {
    return formatWeekday(ts, locale)
  }
  return formatDate(ts, locale, now)
}

/** The preview header: `today 14:02`, `yesterday 17:22`, or a date and time. */
export function formatWhen(ts: number, locale: string, now = Date.now()): string {
  const bucket = dayBucket(ts, now)
  const clock = formatClock(ts, locale)
  if (bucket.kind === 'today' || bucket.kind === 'yesterday') {
    const day = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(bucket.kind === 'today' ? 0 : -1, 'day')
    return `${day} ${clock}`
  }
  return `${formatDate(ts, locale, now)} ${clock}`
}

/** `1h 12m`, `1h 03m`, `31m`, `45s`; Chinese `1小时12分`, `31分`, `45秒`. Numbers go through `Intl.NumberFormat`. */
export function formatDuration(ms: number, locale: string): string {
  const totalSeconds = Math.round(Math.abs(ms) / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const zh = locale.toLowerCase().startsWith('zh')
  const n = (value: number) => formatNumber(value, locale)
  const parts: string[] = []
  if (hours > 0) {
    parts.push(zh ? `${n(hours)}小时` : `${n(hours)}h`)
  }
  if (minutes > 0 || (hours > 0 && !zh)) {
    parts.push(zh ? `${n(minutes)}分` : `${hours > 0 ? String(minutes).padStart(2, '0') : n(minutes)}m`)
  }
  if (hours === 0 && minutes === 0) {
    parts.push(zh ? `${n(seconds)}秒` : `${n(seconds)}s`)
  }
  return (ms < 0 ? '-' : '') + parts.join(zh ? '' : ' ')
}

/** `undefined` is "not recorded" or "not read yet": it shows the dash, never 0. */
export function formatOptional(value: number | undefined, text: (value: number) => string, dash: string): string {
  return value === undefined ? dash : text(value)
}

/** Ledger time column: elapsed since the session start, `36:10` or `1:02:05`. Locale-independent. */
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = String(total % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`
}

/** Session header start time: `Tue, 23 Sep, 14:02` / `9月23日周二 14:02`, with the year when it is not this year. */
export function formatStart(ts: number, locale: string, now = Date.now()): string {
  const sameYear = new Date(ts).getFullYear() === new Date(now).getFullYear()
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' as const }),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(ts)
}

/** Load progress: `12.3 MB`, `845 kB` (decimal units, as file managers show them). */
export function formatBytes(bytes: number, locale: string): string {
  const [unit, divisor] =
    bytes >= 1e9
      ? (['gigabyte', 1e9] as const)
      : bytes >= 1e6
        ? (['megabyte', 1e6] as const)
        : (['kilobyte', 1e3] as const)
  return new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: 1 }).format(
    bytes / divisor,
  )
}

/** The ledger time column for an event: elapsed since `start`, or empty when the event has no time. */
export function elapsedFrom(ts: number | undefined, start: number): string {
  return ts === undefined || ts <= 0 ? '' : formatElapsed(ts - start)
}

/** `2.41M / 61k`; one dash when neither side was recorded. */
export function formatInOut(input: number | undefined, output: number | undefined, dash: string): string {
  if (input === undefined && output === undefined) {
    return dash
  }
  return `${formatOptional(input, formatTokens, dash)} / ${formatOptional(output, formatTokens, dash)}`
}

const USD = { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol' } as const

/**
 * A USD amount: `$1,234.56`, `$0.42`, `$0.0034` (two significant digits below a cent, so a small request does
 * not read as `$0.00`), and `<$0.0001` below that; `$0.00` only for an exact 0. `$` in every locale.
 */
export function formatUsd(value: number, locale: string): string {
  if (value === 0) {
    return new Intl.NumberFormat(locale, { ...USD, minimumFractionDigits: 2 }).format(0)
  }
  if (Math.abs(value) < 0.0001) {
    return `<${new Intl.NumberFormat(locale, { ...USD, maximumFractionDigits: 4 }).format(0.0001)}`
  }
  if (Math.abs(value) < 0.01) {
    return new Intl.NumberFormat(locale, { ...USD, maximumSignificantDigits: 2 }).format(value)
  }
  return new Intl.NumberFormat(locale, { ...USD, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
}

/** A ratio as a whole percent: `0.934` → `93%`. */
export function formatPercent(ratio: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(ratio)
}
