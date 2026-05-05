"use client"

import dynamic from "next/dynamic"

const BusRouteMap = dynamic<{ plate?: string }>(
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

export function RouteMapSection({ plate }: { plate?: string }) {
  return <BusRouteMap plate={plate} />
}
