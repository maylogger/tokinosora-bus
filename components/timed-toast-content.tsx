"use client"

import moment from "moment"
import "moment/locale/ja"
import "moment/locale/zh-tw"
import { useEffect, useMemo, useState, type ReactNode } from "react"

import { getI18nDictionary, type Locale } from "@/lib/i18n"

const SECOND_MS = 1_000
const MINUTE_MS = 60 * SECOND_MS
const RELATIVE_TIME_REFRESH_MS = 30 * SECOND_MS
const TEN_SECONDS_MS = 10 * SECOND_MS
const MIN_REFRESH_DELAY_MS = 100

type TimedToastContentProps = {
  backgroundImageUrl?: string
  locale: Locale
  sentence: ReactNode
  timestamp: number
}

function formatRelativeTime(
  locale: Locale,
  timestamp: number,
  now: number
): string {
  const relativeTime = getI18nDictionary(locale).relativeTime
  const elapsedMs = Math.max(0, now - timestamp)

  if (elapsedMs < TEN_SECONDS_MS) return relativeTime.justNow

  if (elapsedMs < MINUTE_MS) {
    return relativeTime.secondsAgo(Math.floor(elapsedMs / TEN_SECONDS_MS) * 10)
  }

  return moment(timestamp).locale(relativeTime.momentLocale).from(now)
}

function getRelativeTimeRefreshDelay(timestamp: number, now: number): number {
  const elapsedMs = Math.max(0, now - timestamp)

  if (elapsedMs < TEN_SECONDS_MS) {
    return Math.max(MIN_REFRESH_DELAY_MS, TEN_SECONDS_MS - elapsedMs)
  }

  if (elapsedMs < MINUTE_MS) {
    return Math.max(
      MIN_REFRESH_DELAY_MS,
      TEN_SECONDS_MS - (elapsedMs % TEN_SECONDS_MS)
    )
  }

  return RELATIVE_TIME_REFRESH_MS
}

export function TimedToastContent({
  backgroundImageUrl,
  locale,
  sentence,
  timestamp,
}: TimedToastContentProps) {
  const [now, setNow] = useState(() => Date.now())
  const relativeTime = getI18nDictionary(locale).relativeTime
  const timeText = useMemo(
    () => formatRelativeTime(locale, timestamp, now),
    [locale, now, timestamp]
  )
  const refreshDelay = getRelativeTimeRefreshDelay(timestamp, now)

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setNow(Date.now()), refreshDelay)

    return () => window.clearTimeout(timeoutId)
  }, [now, refreshDelay, timestamp])

  return (
    <div className="p-5 pr-32">
      {backgroundImageUrl ? (
        <img
          aria-hidden="true"
          alt=""
          className="pointer-events-none absolute right-0 bottom-0 h-auto w-[75%] object-contain object-bottom-right"
          src={backgroundImageUrl}
        />
      ) : null}
      <div className="relative z-10 flex flex-col gap-1">
        <span className="text-base text-shadow-lg sm:text-sm">{sentence}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {relativeTime.updatedLabel}
          {timeText}
        </span>
      </div>
    </div>
  )
}
