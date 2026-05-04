"use client"

import { APIProvider, Map, Polyline, useMap } from "@vis.gl/react-google-maps"
import { useEffect } from "react"

import routePaths from "@/data/bus-route-paths.json"
import { cleanMapStyles } from "@/lib/clean-map-styles"

type BusRoutePathEntry = {
  subRouteUID: string
  routeNameZh: string
  nameZh: string
  path: google.maps.LatLngLiteral[]
}

const routes = routePaths.routes as BusRoutePathEntry[]

/** 專案寫死顯示此子路線；若需更換請改此常數或調整 data */
const FIXED_SUB_ROUTE_UID = "TPE157462"

const fixedRoute =
  routes.find((r) => r.subRouteUID === FIXED_SUB_ROUTE_UID) ?? routes[0]
const path = fixedRoute?.path ?? []

const defaultCenter: google.maps.LatLngLiteral = {
  lat: 25.045,
  lng: 121.52,
}

/** fitBounds 四邊留白（手機／桌機共用同一組數值） */
const ROUTE_VIEW_PADDING: google.maps.Padding = {
  top: 4,
  bottom: 4,
  left: 4,
  right: 4,
}

/** 將視窗縮放至包住整條路線 */
function FitRouteBounds({ path }: { path: google.maps.LatLngLiteral[] }) {
  const map = useMap()

  useEffect(() => {
    if (!map || path.length === 0) return

    const fit = () => {
      const bounds = new google.maps.LatLngBounds()
      for (const p of path) bounds.extend(p)
      map.fitBounds(bounds, ROUTE_VIEW_PADDING)
    }

    fit()
    window.addEventListener("resize", fit)
    return () => window.removeEventListener("resize", fit)
  }, [map, path])

  return null
}

export function BusRouteMap() {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

  if (!apiKey) {
    return (
      <div
        className="h-svh w-full shrink-0 bg-muted"
        role="alert"
        aria-label="缺少 Google Maps API 金鑰，請於 .env.local 設定 API KEY"
      />
    )
  }

  return (
    <div className="h-svh w-full overflow-hidden">
      <APIProvider apiKey={apiKey}>
        <Map
          className="size-full"
          defaultCenter={defaultCenter}
          defaultZoom={11}
          gestureHandling="greedy"
          disableDefaultUI
          zoomControl
          clickableIcons={false}
          styles={cleanMapStyles}
          colorScheme="LIGHT"
        >
          <FitRouteBounds path={path} />
          {path.length > 1 ? (
            <Polyline
              path={path}
              strokeColor="#ff8ab5"
              strokeOpacity={0.95}
              strokeWeight={3.3}
              geodesic
            />
          ) : null}
        </Map>
      </APIProvider>
    </div>
  )
}
