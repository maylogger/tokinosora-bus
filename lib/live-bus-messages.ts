export const LIVE_BUS_MESSAGES = {
  apiReadProblem: "API 讀取不到，請稍後",
  missingGoogleMapsApiKey:
    "缺少 Google Maps API 金鑰，請於 .env.local 設定 API KEY",
  notStarted: (plate?: string) =>
    liveBusStatusMessage(
      `${liveBusDisplayName(plate)} 目前不在營運狀態`,
      "_(:3」∠)_"
    ),
  updating: liveBusStatusMessage("資料更新中", "( •́ .̫ •̀ )"),
  startedNoEta: (plate?: string) =>
    liveBusStatusMessage(`${liveBusDisplayName(plate)} 已發車`, "(๑╹ᆺ╹)"),
  firstStopFallbackName: "起點站",
  nextStopFallbackName: "下一站",
  nearStopFallbackName: "目前站",
  dataPaused: (plate?: string) =>
    liveBusStatusMessage(
      `${liveBusDisplayName(plate)} 資料暫停更新`,
      "( •́ .̫ •̀ )"
    ),
  notInService: (plate?: string) =>
    liveBusStatusMessage(
      `${liveBusDisplayName(plate)} 目前不在營運狀態`,
      "_(:3」∠)_"
    ),
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

function liveBusDisplayName(plate?: string): string {
  return plate?.trim() || "空媽公車 EAL-0080"
}

function liveBusStatusMessage(
  text: string,
  emoji: string
): LiveBusStatusMessage {
  return { text, emoji }
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
    text: `${liveBusDisplayName(plate)} 已發車，${liveBusArrivalText(minutes, stopName)}`,
    emoji: randomArrivalMessageEmoji(),
  }
}

export function liveBusNextStopMessage(
  plate: string,
  minutes: number,
  stopName: string
): LiveBusStatusMessage {
  return {
    text: `${liveBusDisplayName(plate)} ${liveBusArrivalText(minutes, stopName)}`,
    emoji: randomArrivalMessageEmoji(),
  }
}

export function liveBusArrivingAtStopMessage(
  plate: string,
  stopName: string
): LiveBusStatusMessage {
  return {
    text: `${liveBusDisplayName(plate)} 進站中「${stopName}」`,
    emoji: randomArrivalMessageEmoji(),
  }
}

export function liveBusDepartedStopMessage(
  plate: string,
  stopName: string
): LiveBusStatusMessage {
  return {
    text: `${liveBusDisplayName(plate)} 已離開「${stopName}」`,
    emoji: randomArrivalMessageEmoji(),
  }
}

export function liveBusSegmentStatusMessage(
  plate: string,
  label: string
): LiveBusStatusMessage {
  return {
    text: `${liveBusDisplayName(plate)} ${label}`,
    emoji: randomArrivalMessageEmoji(),
  }
}
