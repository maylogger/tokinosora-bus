"use client"

import moment from "moment"
import "moment/locale/zh-tw"
import { useEffect, useMemo, useState, type ReactNode } from "react"

moment.locale("zh-tw")

const SECOND_MS = 1_000
const MINUTE_MS = 60 * SECOND_MS
const RELATIVE_TIME_REFRESH_MS = 30 * SECOND_MS
const TEN_SECONDS_MS = 10 * SECOND_MS
const MIN_REFRESH_DELAY_MS = 100

type TimedToastContentProps = {
  backgroundImageUrl?: string
  sentence: ReactNode
  timestamp: number
}

function formatRelativeTime(timestamp: number, now: number): string {
  const elapsedMs = Math.max(0, now - timestamp)

  if (elapsedMs < TEN_SECONDS_MS) return "剛剛"

  if (elapsedMs < MINUTE_MS) {
    return `${Math.floor(elapsedMs / TEN_SECONDS_MS) * 10} 秒前`
  }

  return moment(timestamp).from(now)
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
  sentence,
  timestamp,
}: TimedToastContentProps) {
  const [now, setNow] = useState(() => Date.now())
  const timeText = useMemo(
    () => formatRelativeTime(timestamp, now),
    [now, timestamp]
  )
  const refreshDelay = getRelativeTimeRefreshDelay(timestamp, now)

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setNow(Date.now()), refreshDelay)

    return () => window.clearTimeout(timeoutId)
  }, [now, refreshDelay, timestamp])

  return (
    <div className="p-5 pr-28">
      {backgroundImageUrl ? (
        <img
          aria-hidden="true"
          alt=""
          className="pointer-events-none absolute right-0 bottom-0 h-[125%] w-auto object-contain object-bottom-right"
          src={backgroundImageUrl}
        />
      ) : null}
      <div className="relative z-10 flex flex-col gap-1">
        <span className="text-base sm:text-sm">{sentence}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          更新時間：{timeText}
        </span>
      </div>
    </div>
  )
}
