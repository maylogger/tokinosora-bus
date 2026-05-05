"use client"

import type { ReactNode } from "react"

type TimedToastContentProps = {
  sentence: ReactNode
  timeText: string
}

export function TimedToastContent({
  sentence,
  timeText,
}: TimedToastContentProps) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-base sm:text-sm">{sentence}</span>
      <span className="text-xs text-muted-foreground">{timeText}</span>
    </div>
  )
}
