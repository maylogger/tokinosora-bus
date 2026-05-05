export const LIVE_BUS_MESSAGES = {
  apiReadProblem: "API 讀取不到，請稍後",
  missingGoogleMapsApiKey:
    "缺少 Google Maps API 金鑰，請於 .env.local 設定 API KEY",
  notStarted: () => `${liveBusDisplayName()} 尚未發車 _(:3」∠)_`,
  updating: "資料更新中 ( •́ .̫ •̀ )",
  startedNoEta: () => `${liveBusDisplayName()} 已發車 (๑╹ᆺ╹)`,
  firstStopFallbackName: "起點站",
  nextStopFallbackName: "下一站",
}

export type LiveBusStatusMessage =
  | string
  | {
      text: string
      emoji: string
    }

const ARRIVAL_MESSAGE_EMOJIS = [
  "( `･ㅂ･)و",
  "(✿╹◡╹)ﾉ",
  "(｡•ᴗ•｡)♡",
  "(๑╹ᆺ╹)",
  "(*´꒳`*)ﾟ*.・♡",
  "₍₍ ◝(•̀ㅂ•́)◟ ⁾⁾",
] as const

function liveBusDisplayName(): string {
  return `空媽公車 EAL-0080`
}

function randomArrivalMessageEmoji(): string {
  return ARRIVAL_MESSAGE_EMOJIS[
    Math.floor(Math.random() * ARRIVAL_MESSAGE_EMOJIS.length)
  ]
}

function liveBusArrivalText(minutes: number, stopName: string): string {
  if (minutes === 0) {
    return `即將到達「${stopName}」`
  }

  return `即將在 ${minutes} 分鐘到達「${stopName}」`
}

export function liveBusBeforeFirstStopMessage(
  plate: string,
  minutes: number,
  stopName: string
): LiveBusStatusMessage {
  return {
    text: `${liveBusDisplayName()} 已發車，${liveBusArrivalText(minutes, stopName)}`,
    emoji: randomArrivalMessageEmoji(),
  }
}

export function liveBusNextStopMessage(
  plate: string,
  minutes: number,
  stopName: string
): LiveBusStatusMessage {
  return {
    text: `${liveBusDisplayName()} ${liveBusArrivalText(minutes, stopName)}`,
    emoji: randomArrivalMessageEmoji(),
  }
}
