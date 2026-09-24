import { describe, expect, it } from 'vitest'
import {
  bucketKey,
  dayBucket,
  formatActive,
  formatDate,
  formatDayHeading,
  formatDuration,
  formatNumber,
  formatOptional,
  formatTokens,
  formatWhen,
  relativeDay,
} from './format.ts'

// Wednesday 2026-09-23, 12:00 local time.
const now = new Date(2026, 8, 23, 12, 0).getTime()
const at = (day: number, hour: number, minute = 0) => new Date(2026, 8, day, hour, minute).getTime()

describe('formatTokens', () => {
  it('abbreviates the same way in every locale', () => {
    expect(formatTokens(118_400)).toBe('118.4k')
    expect(formatTokens(884_000)).toBe('884k')
    expect(formatTokens(61_000)).toBe('61k')
    expect(formatTokens(2_410_000)).toBe('2.41M')
    expect(formatTokens(1_200_000)).toBe('1.20M')
    expect(formatTokens(999_960)).toBe('1.00M')
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(0)).toBe('0')
  })
})

describe('formatDuration', () => {
  it('writes hours and minutes in English and Chinese', () => {
    expect(formatDuration(72 * 60_000, 'en')).toBe('1h 12m')
    expect(formatDuration(63 * 60_000, 'en')).toBe('1h 03m')
    expect(formatDuration(120 * 60_000, 'en')).toBe('2h 00m')
    expect(formatDuration(31 * 60_000, 'en')).toBe('31m')
    expect(formatDuration(45_000, 'en')).toBe('45s')
    expect(formatDuration(72 * 60_000, 'zh-CN')).toBe('1小时12分')
    expect(formatDuration(120 * 60_000, 'zh-CN')).toBe('2小时')
    expect(formatDuration(31 * 60_000, 'zh-CN')).toBe('31分')
    expect(formatDuration(45_000, 'zh-CN')).toBe('45秒')
  })
})

describe('numbers', () => {
  it('group digits by locale and show a dash for undefined, never 0', () => {
    expect(formatNumber(2310, 'en')).toBe('2,310')
    expect(formatNumber(2310, 'zh-CN')).toBe('2,310')
    expect(formatOptional(undefined, String, '—')).toBe('—')
    expect(formatOptional(0, String, '—')).toBe('0')
  })
})

describe('dates', () => {
  it('buckets by local day: today, yesterday, this week, then per day', () => {
    expect(dayBucket(at(23, 9), now).kind).toBe('today')
    expect(dayBucket(at(22, 23, 59), now).kind).toBe('yesterday')
    expect(dayBucket(at(21, 8), now).kind).toBe('week')
    const older = dayBucket(at(19, 8), now)
    expect(older.kind).toBe('day')
    expect(bucketKey(older)).toBe(bucketKey(dayBucket(at(19, 22), now)))
  })

  it('uses Intl for today and yesterday in both locales', () => {
    expect(relativeDay(0, 'en')).toBe('Today')
    expect(relativeDay(-1, 'en')).toBe('Yesterday')
    expect(relativeDay(0, 'zh-CN')).toBe('今天')
    expect(relativeDay(-1, 'zh-CN')).toBe('昨天')
    expect(formatWhen(at(23, 14, 2), 'en', now)).toBe('today 14:02')
    expect(formatWhen(at(23, 14, 2), 'zh-CN', now)).toBe('今天 14:02')
  })

  it('formats the Active column and day headings per locale', () => {
    expect(formatActive(at(23, 14, 2), 'en', now)).toBe('14:02')
    expect(formatActive(at(21, 10), 'en', now)).toBe('Mon')
    expect(formatActive(at(21, 10), 'zh-CN', now)).toBe('周一')
    expect(formatActive(at(12, 10), 'en', now)).toBe('Sep 12')
    expect(formatActive(at(12, 10), 'zh-CN', now)).toBe('9月12日')
    expect(formatDate(at(12, 10), 'en', now)).not.toBe(formatDate(at(12, 10), 'zh-CN', now))
    expect(formatDayHeading(at(12, 10), 'en', now)).toBe('Sat, Sep 12')
    expect(formatDayHeading(at(12, 10), 'zh-CN', now)).toBe('9月12日周六')
  })
})
