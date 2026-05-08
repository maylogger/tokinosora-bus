"use client"

import dynamic from "next/dynamic"
import { useEffect, useState } from "react"

import type { Locale } from "@/lib/i18n"

type BusRouteMapProps = {
  locale: Locale
  onLocaleChange: (locale: Locale) => void
  plate?: string
}

const BusRouteMap = dynamic<BusRouteMapProps>(
  () =>
    import("@/components/bus-route-map").then((m) => ({
      default: m.BusRouteMap,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="h-svh w-full shrink-0 bg-muted" aria-busy="true" />
    ),
  }
)

export function RouteMapSection({
  locale,
  plate,
}: {
  locale: Locale
  plate?: string
}) {
  const [currentLocale, setCurrentLocale] = useState(locale)

  useEffect(() => {
    document.documentElement.lang = currentLocale
  }, [currentLocale])

  return (
    <BusRouteMap
      locale={currentLocale}
      onLocaleChange={setCurrentLocale}
      plate={plate}
    />
  )
}
