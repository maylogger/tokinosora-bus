/** 公路總局 TDX 公車路線 Shape（精簡欄位，僅供地圖使用） */

export type TdxLocalized = { Zh_tw?: string; En?: string }

export type TdxStopPosition = {
  PositionLat: number
  PositionLon: number
}

export type TdxRouteStop = {
  StopSequence: number
  StopPosition: TdxStopPosition
  StopName?: TdxLocalized
}

export type TdxBusSubRoute = {
  SubRouteUID: string
  SubRouteName?: TdxLocalized
  Direction: number
  Stops: TdxRouteStop[]
}

/** 依 StopSequence 排序後轉成 Google Maps 路徑（站與站直線連接；非道路擬合） */
export function pathFromTdxStops(stops: TdxRouteStop[]): google.maps.LatLngLiteral[] {
  return [...stops]
    .sort((a, b) => a.StopSequence - b.StopSequence)
    .map((s) => ({
      lat: s.StopPosition.PositionLat,
      lng: s.StopPosition.PositionLon,
    }))
}

export function labelFromSubRoute(route: TdxBusSubRoute): string {
  return route.SubRouteName?.Zh_tw?.trim() || route.SubRouteUID
}
