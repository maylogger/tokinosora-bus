"use client"

import {
  APIProvider,
  ColorScheme,
  Map,
  Marker,
  Polyline,
  useMap,
} from "@vis.gl/react-google-maps"
import { useTheme } from "next-themes"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import routePaths from "@/data/bus-route-paths.json"
import { cleanMapStyles } from "@/lib/clean-map-styles"
import { darkMapStyles } from "@/lib/dark-map-styles"
import { TRACKED_BUS_PLATE } from "@/lib/live-bus-config"

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

/** 與 Sonner toast id 對應，避免重複堆疊、離線／上線時可關閉 */
const LIVE_BUS_OFFLINE_TOAST_ID = "live-bus-eal0080-offline"
const LIVE_BUS_ONLINE_TOAST_ID = "live-bus-eal0080-online"

/** 淺色主題路線與車標強調色 */
const ROUTE_ACCENT_LIGHT = "#ff8ab5"
/** 深色主題路線與車標強調色 */
const ROUTE_ACCENT_DARK = "#db2777"

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

/** TDX A1 資料約每分鐘更新一次 */
const LIVE_BUS_DATA_INTERVAL_MS = 60_000
/** TDX 資料理論更新後，延後幾秒再抓，避開剛更新完成前的舊資料 */
const LIVE_BUS_REFRESH_OFFSET_MS = 5_000
/** 若抓到同一筆 TDX 時間戳，縮短補抓間隔以等待下一筆資料出現 */
const LIVE_BUS_STALE_RETRY_MS = 12_000
/** 沒有時間戳或暫時抓不到車時，維持較保守的重試間隔 */
const LIVE_BUS_FALLBACK_RETRY_MS = 60_000
/** 每次取得新車位後，marker 滑動到新座標的時間 */
const LIVE_BUS_MOVE_ANIMATION_MS = 2_000
const LIVE_BUS_MARKER_SIZE = {
  width: 120,
  height: 102,
}
const LIVE_BUS_MARKER_ANCHOR = {
  x: 56,
  y: 90,
}

type LiveBusPositionResponse = {
  tracked?: boolean
  lat?: number
  lng?: number
  updateTime?: string | null
  gpsTime?: string | null
}

function parseTdxTimestamp(value: string | null | undefined): number | null {
  if (!value) return null

  const normalized = value.trim().replace(" ", "T")
  const hasTimeZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized)
  const timestamp = Date.parse(hasTimeZone ? normalized : `${normalized}+08:00`)

  return Number.isFinite(timestamp) ? timestamp : null
}

function nextLiveBusDelay(dataTimestamp: number | null, isFresh: boolean): number {
  if (!dataTimestamp) return LIVE_BUS_FALLBACK_RETRY_MS
  if (!isFresh) return LIVE_BUS_STALE_RETRY_MS

  const nextExpectedUpdate =
    dataTimestamp + LIVE_BUS_DATA_INTERVAL_MS + LIVE_BUS_REFRESH_OFFSET_MS

  return Math.max(nextExpectedUpdate - Date.now(), LIVE_BUS_STALE_RETRY_MS)
}

function useLiveTrackedBus() {
  const [position, setPosition] = useState<google.maps.LatLngLiteral | null>(
    null,
  )
  /** 至少完成一次請求後，若仍無車位資料則為 true（含 API 錯誤／未出車） */
  const [showOfflineHint, setShowOfflineHint] = useState(false)

  useEffect(() => {
    let stopped = false
    let timeoutId: number | undefined
    let lastDataTimestamp: number | null = null

    function scheduleNextLoad(delay: number) {
      timeoutId = window.setTimeout(() => void load(), delay)
    }

    async function load() {
      let nextDelay = LIVE_BUS_FALLBACK_RETRY_MS

      try {
        const res = await fetch("/api/bus-position", { cache: "no-store" })
        const data = (await res.json()) as LiveBusPositionResponse
        if (stopped) return

        const dataTimestamp =
          parseTdxTimestamp(data.gpsTime) ?? parseTdxTimestamp(data.updateTime)
        const isFreshTimestamp =
          dataTimestamp != null && dataTimestamp !== lastDataTimestamp

        if (
          data.tracked &&
          typeof data.lat === "number" &&
          typeof data.lng === "number"
        ) {
          setPosition({ lat: data.lat, lng: data.lng })
          setShowOfflineHint(false)
          nextDelay = nextLiveBusDelay(dataTimestamp, isFreshTimestamp)
        } else {
          setPosition(null)
          setShowOfflineHint(true)
        }

        if (dataTimestamp != null) {
          lastDataTimestamp = dataTimestamp
        }
      } catch {
        if (!stopped) {
          setPosition(null)
          setShowOfflineHint(true)
        }
      }

      if (!stopped) {
        scheduleNextLoad(nextDelay)
      }
    }

    void load()
    return () => {
      stopped = true
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
    }
  }, [])

  return { position, showOfflineHint }
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3
}

function useAnimatedLatLng(position: google.maps.LatLngLiteral) {
  const [animatedPosition, setAnimatedPosition] =
    useState<google.maps.LatLngLiteral>(position)
  const animatedPositionRef = useRef(position)

  useEffect(() => {
    const from = animatedPositionRef.current

    if (from.lat === position.lat && from.lng === position.lng) {
      animatedPositionRef.current = position
      setAnimatedPosition(position)
      return
    }

    let frame = 0
    let stopped = false
    const startedAt = performance.now()
    const deltaLat = position.lat - from.lat
    const deltaLng = position.lng - from.lng

    function tick(now: number) {
      if (stopped) return

      const progress = Math.min(
        (now - startedAt) / LIVE_BUS_MOVE_ANIMATION_MS,
        1,
      )
      const easedProgress = easeOutCubic(progress)
      const nextPosition = {
        lat: from.lat + deltaLat * easedProgress,
        lng: from.lng + deltaLng * easedProgress,
      }

      animatedPositionRef.current = nextPosition
      setAnimatedPosition(nextPosition)

      if (progress < 1) {
        frame = window.requestAnimationFrame(tick)
      }
    }

    frame = window.requestAnimationFrame(tick)
    return () => {
      stopped = true
      window.cancelAnimationFrame(frame)
    }
  }, [position])

  return animatedPosition
}

function LiveTrackedBusMarker({
  position,
}: {
  position: google.maps.LatLngLiteral
}) {
  const animatedPosition = useAnimatedLatLng(position)

  return (
    <Marker
      position={animatedPosition}
      title={`即時車位 ${TRACKED_BUS_PLATE}`}
      zIndex={999}
      icon={{
        url: "/marker.png",
        scaledSize: new google.maps.Size(
          LIVE_BUS_MARKER_SIZE.width,
          LIVE_BUS_MARKER_SIZE.height,
        ),
        anchor: new google.maps.Point(
          LIVE_BUS_MARKER_ANCHOR.x,
          LIVE_BUS_MARKER_ANCHOR.y,
        ),
      }}
    />
  )
}

/** 需在已取得 Google Maps API Key 後再掛即時資料與 Sonner（避免不必要請求）。 */
function BusRouteMapInner({ apiKey }: { apiKey: string }) {
  const { resolvedTheme } = useTheme()
  const { position: liveBusPosition, showOfflineHint } = useLiveTrackedBus()
  /** 曾因「尚未出車」而出現過離線提示時為 true（用於偵測「之後追到車」並只噴一次已出車訊息）。 */
  const wasShowingOfflineRef = useRef(false)

  useEffect(() => {
    if (showOfflineHint) {
      wasShowingOfflineRef.current = true
      toast("空媽公車尚未出車，請稍後", {
        id: LIVE_BUS_OFFLINE_TOAST_ID,
        duration: Number.POSITIVE_INFINITY,
        icon: null,
      })
      return
    }

    toast.dismiss(LIVE_BUS_OFFLINE_TOAST_ID)

    if (liveBusPosition && wasShowingOfflineRef.current) {
      toast.dismiss(LIVE_BUS_ONLINE_TOAST_ID)
      toast("空媽公車已出車", {
        id: LIVE_BUS_ONLINE_TOAST_ID,
        duration: 6_000,
        icon: null,
      })
      wasShowingOfflineRef.current = false
    }
  }, [showOfflineHint, liveBusPosition])

  useEffect(() => {
    return () => {
      toast.dismiss(LIVE_BUS_OFFLINE_TOAST_ID)
      toast.dismiss(LIVE_BUS_ONLINE_TOAST_ID)
    }
  }, [])

  const isDarkMap = resolvedTheme === "dark"
  const routeAccent = isDarkMap ? ROUTE_ACCENT_DARK : ROUTE_ACCENT_LIGHT
  /**
   * colorScheme 須與自訂 styles 一致：`FOLLOW_SYSTEM` 只認 OS，按下 d 強制亮／暗時會與
   * resolvedTheme 脫勾，向量底圖內建的深淺路徑與 JSON style 疊加，常在圖磚交界出現異常線條。
   */
  const mapColorScheme = isDarkMap ? ColorScheme.DARK : ColorScheme.LIGHT

  // 外層不參與 tab 順序，並關閉子節點 outline，避免 globals 的 * outline 在圖上閃爍
  return (
    <div
      className="h-svh w-full overflow-hidden outline-none [&_*:focus]:outline-none [&_*:focus-visible]:outline-none"
      tabIndex={-1}
    >
      <APIProvider apiKey={apiKey}>
        <Map
          className="size-full outline-none [&_*:focus]:outline-none [&_*:focus-visible]:outline-none"
          defaultCenter={defaultCenter}
          defaultZoom={11}
          gestureHandling="greedy"
          disableDefaultUI
          zoomControl
          clickableIcons={false}
          styles={isDarkMap ? darkMapStyles : cleanMapStyles}
          colorScheme={mapColorScheme}
        >
          <FitRouteBounds path={path} />
          {path.length > 1 ? (
            <Polyline
              path={path}
              strokeColor={routeAccent}
              strokeOpacity={0.95}
              strokeWeight={3.3}
              geodesic
            />
          ) : null}
          {liveBusPosition ? (
            <LiveTrackedBusMarker position={liveBusPosition} />
          ) : null}
        </Map>
      </APIProvider>
    </div>
  )
}

export function BusRouteMap() {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

  if (!apiKey) {
    return (
      <div
        className="bg-muted h-svh w-full shrink-0"
        role="alert"
        aria-label="缺少 Google Maps API 金鑰，請於 .env.local 設定 API KEY"
      />
    )
  }

  return <BusRouteMapInner apiKey={apiKey} />
}
