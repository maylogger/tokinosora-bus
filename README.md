# Tokinosora Bus

Tokinosora Bus 是一個 Next.js 16 App Router 小網站，用全螢幕 Google Maps 顯示空媽公車的即時位置、到站狀態，以及空媽生日廣告凹槽相關地點。

目前預設追蹤車牌是 `EAL-0080`，路線是臺北公車 `307`。網址可以用 `plate` query 暫時改查其他車牌，但畫面文案仍固定顯示「空媽公車 EAL-0080」。

## 使用者看到什麼

打開網站後，畫面會是一張全螢幕 Google Maps。網站會依系統深淺色主題套用不同地圖樣式，並關閉大多數預設地圖 UI，只保留縮放控制。

地圖初始會先縮放到 `307` 路線範圍。取得即時資料後，網站會依目前子路線與方向畫出對應路線，並用 A2 到離站事件搭配路線 polyline 推估公車 marker 位置。marker 位置更新時會用 2 秒平滑移動；剛進網站若最新 A2 是離站事件，會直接放在依事件時間推估出的兩站之間位置，不會從上一站一路飛過去。

第一次取得公車推估位置時，地圖會自動聚焦到該位置並放大到街區層級。放大後會逐步顯示路線站牌：zoom `14` 以上顯示站牌圓點，zoom `16` 以上顯示站名。

地圖也會顯示空媽生日廣告凹槽地點：

- zoom `12` 以上顯示「空媽生日廣告地下街凹槽地點」。
- zoom `15` 以上顯示「地下街出口 Y25」。

手機操作上，地圖支援 Google Maps 的一般手勢，也加了一個單指快速縮放：快速點兩下後按住，上下滑動就能以觸點為中心縮放。

畫面上方會出現即時狀態 toast，例如：

```text
空媽公車 EAL-0080 即將在 3 分鐘到達「下一站」 (๑╹ᆺ╹)
剛剛
```

每次收到新的狀態時，網站會清掉既有 toast 並顯示最新一則。toast 下方的時間會用「剛剛」、「10 秒前」、「1 分鐘前」這類相對時間自動更新。

## 網站一開始做什麼

進入網站或重新整理時，流程是：

1. 讀取網址上的 `plate` 參數。
2. 將車牌 trim 並轉成大寫；如果沒有指定車牌，就使用 `EAL-0080`。
3. 以 client-only component 載入 Google Maps，避免在 SSR 階段建立地圖。
4. 檢查 `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`；沒有 key 時不載入地圖，也不開始查即時公車資料。
5. 開始輪詢 `/api/bus-position?plate=...`。
6. 用 API 回傳的路線、靠站事件與狀態訊息更新地圖和 toast。

範例：

```text
/
```

會追蹤預設車牌 `EAL-0080`。

```text
/?plate=EAL-0080
```

會追蹤指定車牌 `EAL-0080`。

## 資料來源與狀態邏輯

前端每一輪只呼叫一次 `/api/bus-position`。後端會整合多個 TDX 公車 API，再回傳前端需要的單一結果。

目前會用到的 TDX 資料有：

- `A2 RealTimeNearStop`：提供到站／離站事件、站序、站名、子路線與方向。30 秒內的新 A2 事件會優先變成「進站中」或「已離開」訊息，也是前端推估 marker 位置的即時校正來源。
- `EstimatedTimeOfArrival`：提供到站預估秒數，用來產生「即將在 X 分鐘到達」訊息。
- `StopOfRoute`：當 ETA 缺少車牌過濾結果或站序不足時，用路線站序輔助判斷下一站。

後端產生狀態訊息的順序大致是：

1. A2 找不到車時，回傳「尚未發車」。
2. 找不到方向時，回傳「資料更新中」。
3. A2 有 30 秒內的新進站／離站事件時，優先顯示「進站中」或「已離開」。
4. 還沒過第一站時，用第一站 ETA 顯示「已發車，即將在 X 分鐘到達...」。
5. 已過第一站時，用下一站 ETA 顯示「即將在 X 分鐘到達...」。
6. 如果已發車但 ETA 暫時不足，會退回「已發車」或 A2 的「已離開某站」訊息。

靠近最後一站時沒有另外硬寫終點站文案，而是沿用同一套規則：如果 A2 有 30 秒內的新事件，就會顯示「進站中『最後一站站名』」或「已離開『最後一站站名』」。如果已經在最後一站附近、下一站 ETA 查不到，後端會優先用 A2 的站名退回「已離開某站」；連 A2 站名也不足時，才退回「已發車」。

## 輪詢更新方式

前端會在載入後立刻查一次 `/api/bus-position`，之後依 TDX 資料時間戳安排下一輪。

A2 到離站事件是推估車位的校正點，所以前端會看 `GPSTime` 或 `UpdateTime`，以約 20 秒資料週期推算下一次理論更新時間，再延後約 5 秒去抓，避免剛好抓到舊資料。

如果這一輪拿到的時間戳和上一輪相同，代表 TDX 可能還沒更新完成，前端會縮短為約 12 秒後重試。如果沒有時間戳或查不到車，就使用 60 秒的保守重試間隔。

每次排下一輪輪詢時，前端會再加上最多 5 秒的隨機延遲，分散多個 client 同時進站或重新整理時的請求尖峰。

如果前端請求 `/api/bus-position` 失敗，會顯示：

```text
API 讀取不到，請稍後
```

這裡的失敗是指 API 回傳非 2xx，或前端 fetch 本身丟出例外。單純查不到指定車牌不一定是錯誤；只要後端能成功讀到 TDX 資料，就會用 `200` 回傳 `tracked: false` 與對應狀態。

## 前端邏輯

主要邏輯在 `components/bus-route-map.tsx`。

它負責：

- 載入 Google Maps 與依主題切換地圖樣式。
- 查詢 `/api/bus-position` 並安排下一輪輪詢。
- 用後端回傳的 `statusMessage` 顯示 toast。
- 用 A2 到離站事件、站牌座標與 polyline 推估公車 marker 位置；目前進站事件會優先錨到回報站序的下一站，進站訊息也會優先顯示下一站，避免接近下一站時回到上一站。
- 依 A2 的子路線與方向選擇要畫的 `307` 路線。
- 依 zoom 顯示站牌圓點、站名與空媽生日廣告地點。
- 離站事件會從目前站往下一站推進，並在收到下一筆 A2 前停在下一站前方，避免推估位置自行越站。
- 支援手機單指快速縮放手勢。

`components/route-map-section.tsx` 會用 dynamic import 載入 `BusRouteMap`，並關閉 SSR。`components/timed-toast-content.tsx` 負責 toast 內的相對時間顯示。

## 後端 API 邏輯

主要 API 在 `app/api/bus-position/route.ts`。

一般前端查詢：

```text
/api/bus-position?plate=EAL-0080
```

這會回傳整合後的結果，可能包含：

- `tracked`：這一輪是否找到該車。
- `subRouteUID` / `direction`：用來選擇地圖上的路線與站牌。
- `nearStop`：A2 靠站資訊，包含 `stopSequence` 與 `a2EventType`，前端會用它推估 marker 位置。
- `statusMessage`：前端要顯示的 toast 文字。
- `gpsTime` / `updateTime`：前端安排下一輪輪詢用的資料時間。
- `reason`：後端診斷用訊息，前端目前不直接顯示。

同一支 API 也保留 `source=near-stop` 查法：

```text
/api/bus-position?plate=EAL-0080&source=near-stop
```

這只查 A2 `RealTimeNearStop`，主要用來直接檢查靠站資料。

後端會處理 TDX token。如果有設定 `TDX_ACCESS_TOKEN`，就直接使用；否則會用 `TDX_CLIENT_ID` 和 `TDX_CLIENT_SECRET` 換 token，並暫存在伺服器記憶體裡。換 token 期間也會共用同一個 pending promise，避免同時送出多筆認證請求。

成功回應會帶：

```text
Cache-Control: public, max-age=0, s-maxage=15, stale-while-revalidate=45
```

這讓同一個查詢在部署環境可短時間透過 CDN 收斂流量。錯誤回應則會使用 `Cache-Control: no-store`。

後端也會對同一個 TDX URL 做短時間記憶體快取：

- fresh 快取 15 秒。
- stale 快取 2 分鐘。
- 同一個 TDX URL 如果已有請求進行中，會共用同一個 promise。

如果 TDX 短暫回 429、5xx 或非 JSON，但同一個 server instance 在 2 分鐘內有最後成功資料，後端會先回 stale 資料，並在回應 header 加上：

```text
X-TDX-Cache: stale
```

需要注意的是，記憶體快取與 pending promise 去重只保護同一個 server instance；跨 instance、跨 region 還是要靠 CDN cache 收斂流量。

## 主要設定

幾個重要設定集中在 `lib/live-bus-config.ts`：

- `DEFAULT_TRACKED_BUS_PLATE`：預設追蹤車牌，目前是 `EAL-0080`。
- `TRACKED_BUS_ROUTE_DISPLAY`：TDX 查詢用的路線名稱，目前是 `307`。
- `TRACKED_BUS_DIRECTION_DISPLAY`：沒有子路線名稱可判斷時使用的方向 fallback，目前是「莒光 → 板橋前站」。

靜態地圖資料放在：

- `data/bus-route-paths.json`：`307` 子路線軌跡。
- `data/bus-307-stops.json`：`307` 子路線站牌。
- `data/soramama-ad-location.json`：空媽生日廣告凹槽與出口標記。

Google Maps API key 需要設定：

```text
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=你的 Google Maps API Key
```

TDX 可以設定固定 token：

```text
TDX_ACCESS_TOKEN=你的 TDX access token
```

或使用 client credentials：

```text
TDX_CLIENT_ID=你的 TDX client id
TDX_CLIENT_SECRET=你的 TDX client secret
```

沒有有效 Google Maps API key 時，地圖不會載入。沒有有效 TDX credentials 時，app 仍可啟動與建置，但即時 API 可能會因 TDX 授權失敗而回錯誤。

## 開發指令

啟動開發伺服器：

```bash
pnpm dev
```

執行 ESLint：

```bash
pnpm lint
```

型別檢查：

```bash
pnpm typecheck
```

格式化：

```bash
pnpm format
```

建置：

```bash
pnpm build
```
