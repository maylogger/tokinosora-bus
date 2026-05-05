# Tokinosora Bus

這是一個只做一件事的小網站：在地圖上追蹤指定公車，並用提示訊息顯示它目前跑到哪一站。

目前預設追蹤車牌是 `EAL-0080`，路線是台北公車 `307`，方向顯示為「莒光 → 板橋前站」。

## 使用者看到什麼

打開網站後，畫面會是一張全螢幕 Google Maps。

地圖上會畫出固定的 307 路線。當即時定位資料有回傳座標時，地圖會顯示一個空媽的ぬんぬん (๑╹ᆺ╹) 圖示，代表目前公車位置。

畫面上方會出現 toast 訊息，例如：

```text
空媽公車（EAL-0080）正在行駛 307 路線的「莒光 → 板橋前站」方向，目前在第 18 站「中山市場」
21:26
```

每次靠站資訊真的更新時，網站會新增一則新的 toast。舊 toast 不會被覆蓋，這樣可以留下公車經過各站的時間紀錄。

## 網站一開始做什麼

進入網站或重新整理時，流程是：

1. 先讀網址上的 `plate` 參數。
2. 如果網址沒有指定車牌，就使用預設車牌 `EAL-0080`。
3. 載入 Google Maps 和固定路線。
4. 先查 A2 靠站動態，用來顯示目前站名、站序、方向與時間。
5. 再查 A1 即時座標，用來顯示地圖上的車輛 marker。

範例：

```text
/
```

會追蹤預設車牌 `EAL-0080`。

```text
/?plate=EAL-0080
```

會追蹤指定車牌 `EAL-0080`。

## A1 和 A2 是什麼

這個網站使用 TDX 的兩種公車動態資料。

`A2 RealTimeNearStop` 是靠站動態。它告訴我們「這台車目前接近或停靠哪一站」，所以適合拿來顯示 toast 文字，例如第幾站、站名、方向、時間。

`A1 RealTimeByFrequency` 是定時定位。它告訴我們「這台車目前的經緯度」，所以適合拿來畫地圖上的 marker。

簡單講：

- A2 負責文字狀態。
- A1 負責地圖座標。

這也是為什麼網站一開始會先查 A2：就算 A1 當下短暫沒有座標，只要 A2 有資料，使用者仍然可以知道這台車目前在哪一站附近。

## 什麼時候會顯示 API 讀取問題

如果同一輪檢查裡，A1 或 A2 任一邊真的讀取失敗，網站會顯示固定提示：

```text
API 讀取出問題，請聯繫勞哥回報狀況
```

這裡的「讀取失敗」是指 API 回傳非 2xx、TDX 回錯誤、被限流，或前端請求本身丟出例外。這種狀況代表資料來源或中間 API 有問題，需要回報。

A2 查不到靠站動態本身不算錯誤。因為 `RealTimeNearStop` 只會列出目前有靠站狀態的車，某台車暫時不在 A2 資料列中是正常情況。這時只要 API 有成功回應，前端不會顯示「API 讀取出問題」。

A1 查不到即時座標也不一定代表 API 壞掉。後端如果成功讀到 TDX A1 資料，但指定車牌不在資料列中，會用 `200` 回傳 `tracked: false`；前端會把它視為暫時沒有該車資料，而不是 API 讀取失敗。

後端 API 在查不到資料時會回傳 `tracked: false` 和 `reason`，例如：

- 查 A2 時找不到靠站動態，會回「車牌 EAL-0080 本時段未在靠站動態資料列中」。
- 查 A1 時找不到即時座標，會回「車牌 EAL-0080 本時段未在即時資料列中」。
- TDX 請求失敗時，會用 `502` 回傳錯誤原因。

前端不會直接顯示 API 的 `reason`。它只判斷這一輪 A1 或 A2 是否有讀取失敗；如果有，就用同一個 toast id 顯示上面的提示，避免每 60 秒重查時一直新增重複訊息。

只要下一輪 A1 和 A2 都成功讀取，這個 API 讀取問題提示就會關掉。

## 後續怎麼更新

網站會持續輪詢資料，但不是用固定死板的秒數。

A1 資料大約每分鐘更新一次，所以前端會看 A1 回傳的 `GPSTime` 或 `UpdateTime`，推算下一次理論更新時間，再稍微延後幾秒去抓，避免剛好抓到舊資料。

如果抓到同一筆時間戳，代表 TDX 可能還沒更新完成，網站會縮短下一次重試時間。

如果沒有時間戳或暫時抓不到資料，就使用比較保守的重試間隔。

每次排下一輪輪詢時，前端會加上最多 5 秒的隨機延遲。這可以分散很多 client 同時進站或重新整理時的請求尖峰，避免大家在同一秒打到 `/api/bus-position`。

每一輪更新時會做兩件事：

1. 先查 A2，如果站名、站序或時間有變，就新增一則 toast。
2. 再查 A1，如果有座標，就更新地圖 marker。

## 前端邏輯

主要邏輯在 `components/bus-route-map.tsx`。

它負責：

- 載入 Google Maps。
- 畫出固定路線。
- 查詢 `/api/bus-position`。
- 用 A2 回傳的靠站資料產生 toast。
- 用 A1 回傳的經緯度顯示 marker。
- 把 marker 座標吸附到路線附近，避免定位點和路線有一點誤差時看起來偏掉。
- 依地圖 zoom 調整 marker 大小。
- 在 marker 移動時做平滑動畫。

## 後端 API 邏輯

主要 API 在 `app/api/bus-position/route.ts`。

同一支 API 有兩種查法。

查 A2 靠站動態：

```text
/api/bus-position?plate=EAL-0080&source=near-stop
```

這會呼叫 TDX 的 `RealTimeNearStop`，回傳目前靠近哪個站牌。

查 A1 即時座標：

```text
/api/bus-position?plate=EAL-0080
```

這會呼叫 TDX 的 `RealTimeByFrequency`，回傳目前經緯度。

後端會處理 TDX token。如果有設定 `TDX_ACCESS_TOKEN`，就直接使用；否則會用 `TDX_CLIENT_ID` 和 `TDX_CLIENT_SECRET` 去換 token，並暫存在伺服器記憶體裡，避免每次請求都重新認證。

後端 API 成功回應會帶 `Cache-Control: public, max-age=0, s-maxage=15, stale-while-revalidate=45`。部署在 Vercel 時，這讓同一個 `plate` / `source` 查詢可以短時間由 CDN 回應，很多人同時看同一台車時，不會每個 client 都穿透到 TDX。

後端也會對同一個 TDX URL 做短時間記憶體快取，目前 fresh 快取是 15 秒。這是為了避免本機開發時 reload、HMR 或 React dev mode 在短時間內重複觸發 A1/A2 請求，導致 TDX 回 `429 API rate limit exceeded`。如果同一個 TDX 請求已經在進行中，後端也會共用同一個 promise，不會再送出第二次完全相同的上游請求。

如果 TDX 短暫回 429、5xx 或非 JSON，但這個 server instance 在 2 分鐘內有同一個 TDX URL 的最後成功資料，後端會先回這份 stale 資料，並在回應 header 加上 `X-TDX-Cache: stale`。只有完全沒有可用資料時，API 才會回 `502`，前端才會顯示「API 讀取出問題，請聯繫勞哥回報狀況」。

需要注意的是，記憶體快取和 pending promise 去重只保護同一個 Vercel function instance；跨 instance、跨 region 還是要靠 CDN cache 才能收斂流量。如果未來流量再變大，較完整的做法會是用排程集中抓 TDX，再把結果寫到 Vercel KV、Redis 或其他共享儲存，client 只讀共享快取。

## 主要設定

目前幾個重要設定集中在 `lib/live-bus-config.ts`：

- `DEFAULT_TRACKED_BUS_PLATE`：預設追蹤車牌。
- `TRACKED_BUS_ROUTE_DISPLAY`：TDX 查詢用的路線名稱，目前是 `307`。
- `TRACKED_BUS_DIRECTION_DISPLAY`：畫面顯示用的方向文字。

Google Maps API key 需要設定：

```text
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=你的 Google Maps API Key
```

TDX 可以設定：

```text
TDX_ACCESS_TOKEN=你的 TDX access token
```

或：

```text
TDX_CLIENT_ID=你的 TDX client id
TDX_CLIENT_SECRET=你的 TDX client secret
```

## 開發指令

啟動開發伺服器：

```bash
pnpm dev
```

型別檢查：

```bash
pnpm typecheck
```

建置：

```bash
pnpm build
```
