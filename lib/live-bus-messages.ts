export const LIVE_BUS_MESSAGES = {
  apiReadProblem: "API 讀取不到，請稍後",
  missingGoogleMapsApiKey:
    "缺少 Google Maps API 金鑰，請於 .env.local 設定 API KEY",
  notStarted: "空媽公車尚未發車 _(:3」∠)_",
  updating: "資料更新中",
  startedNoEta: "空媽公車已發車（暫無預估時間）",
  firstStopFallbackName: "起點站",
  nextStopFallbackName: "下一站",
}

export function liveBusBeforeFirstStopMessage(
  minutes: number,
  stopName: string
): string {
  return `空媽公車已發車，即將在 ${minutes} 分鐘到達「${stopName}」`
}

export function liveBusNextStopMessage(
  minutes: number,
  stopName: string
): string {
  return `空媽公車即將在 ${minutes} 分鐘到達「${stopName}」`
}
