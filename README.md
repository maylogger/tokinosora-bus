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

## 什麼時候會查無動態

如果同一輪檢查裡，A2 查不到靠站動態，A1 也查不到即時座標，網站會顯示固定提示：

```text
空媽公車（EAL-0080）可能尚未出車，請稍後資訊
```

這個提示代表「目前兩種資料都暫時沒有這台車」，不代表一定沒出車。可能原因包含車輛真的尚未出車、TDX 資料還沒更新、或即時資料短暫空窗。

後端 API 在查不到資料時會回傳 `tracked: false` 和 `reason`，例如：

- 查 A2 時找不到靠站動態，會回「車牌 EAL-0080 本時段未在靠站動態資料列中」。
- 查 A1 時找不到即時座標，會回「車牌 EAL-0080 本時段未在即時資料列中」。
- TDX 請求失敗時，會回傳錯誤原因。

前端不會直接顯示 API 的 `reason`。它只判斷這一輪 A1 和 A2 是否都沒有資料；如果都沒有，就用同一個 toast id 顯示上面的提示，避免每 60 秒重查時一直新增重複訊息。

只要下一輪 A2 查到靠站資料，或 A1 查到座標，這個查無動態提示就會關掉。

## 後續怎麼更新

網站會持續輪詢資料，但不是用固定死板的秒數。

A1 資料大約每分鐘更新一次，所以前端會看 A1 回傳的 `GPSTime` 或 `UpdateTime`，推算下一次理論更新時間，再稍微延後幾秒去抓，避免剛好抓到舊資料。

如果抓到同一筆時間戳，代表 TDX 可能還沒更新完成，網站會縮短下一次重試時間。

如果沒有時間戳或暫時抓不到資料，就使用比較保守的重試間隔。

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
