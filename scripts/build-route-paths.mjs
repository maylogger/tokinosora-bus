/**
 * 由使用者提供的 307 路線 geometry gist 產生 data/bus-route-paths.json。
 */
import fs from "node:fs"
import path from "node:path"

const routeGeometrySources = {
  towardFuyuanStreet:
    "https://gist.githubusercontent.com/hearsilent/6f14d898ecff545e11482f7286eb9d81/raw/453849799697e72478f284a3490e426c855508ce/307_0.json",
  towardBanqiaoStation:
    "https://gist.githubusercontent.com/hearsilent/6f14d898ecff545e11482f7286eb9d81/raw/453849799697e72478f284a3490e426c855508ce/307_1.json",
}

const routeDefinitions = [
  {
    subRouteUID: "TPE157462",
    routeNameZh: "307",
    nameZh: "307莒光往板橋前站",
    source: "towardBanqiaoStation",
  },
  {
    subRouteUID: "TPE157463",
    routeNameZh: "307",
    nameZh: "307莒光往撫遠街",
    source: "towardFuyuanStreet",
  },
  {
    subRouteUID: "TPE161407",
    routeNameZh: "307西藏三民",
    nameZh: "307西藏往板橋前站",
    source: "towardBanqiaoStation",
  },
  {
    subRouteUID: "TPE161408",
    routeNameZh: "307西藏三民",
    nameZh: "307西藏往撫遠街",
    source: "towardFuyuanStreet",
  },
]

function isCoordinatePair(value) {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  )
}

function geometryCoordinates(payload, url) {
  const coordinates = payload?.geometry?.geometry?.coordinates

  if (!Array.isArray(coordinates) || !coordinates.every(isCoordinatePair)) {
    throw new Error(`無法從 ${url} 讀取 LineString 座標`)
  }

  return coordinates
}

async function loadRoutePath(sourceName, url) {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`下載 ${sourceName} 失敗：${response.status}`)
  }

  const payload = await response.json()
  const coordinates = geometryCoordinates(payload, url)

  return coordinates.map(([lng, lat]) => ({ lat, lng }))
}

const loadedPaths = await Promise.all(
  Object.entries(routeGeometrySources).map(async ([sourceName, url]) => [
    sourceName,
    await loadRoutePath(sourceName, url),
  ])
)
const pathsBySource = Object.fromEntries(loadedPaths)

const payload = {
  routes: routeDefinitions.map(({ source, ...route }) => ({
    ...route,
    path: pathsBySource[source],
  })),
}

const out = path.resolve("data/bus-route-paths.json")
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, JSON.stringify(payload, null, 2), "utf8")
console.log("wrote", out)
