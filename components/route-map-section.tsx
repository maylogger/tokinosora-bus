"use client"

import dynamic from "next/dynamic"

import type { Locale } from "@/lib/i18n"

const BusRouteMap = dynamic<{ locale: Locale; plate?: string }>(
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
  return <BusRouteMap locale={locale} plate={plate} />
}
