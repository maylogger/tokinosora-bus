"use client"

import dynamic from "next/dynamic"

const BusRouteMap = dynamic(
  () =>
    import("@/components/bus-route-map").then((m) => ({
      default: m.BusRouteMap,
    })),
  {
    ssr: false,
    loading: () => (
      <div
        className="bg-muted h-svh w-full shrink-0"
        aria-busy="true"
      />
    ),
  },
)

export function RouteMapSection() {
  return <BusRouteMap />
}
