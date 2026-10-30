# Orbitfolio

繁體中文持股管理網頁原型。

## 本機開啟

直接以瀏覽器開啟 `index.html`。Supabase 尚未設定或登入時，網站使用目前瀏覽器的 `localStorage`；登入雲端帳號後則以 Supabase 作為跨裝置資料來源。

## GitHub Pages

此專案是靜態網頁，可透過 GitHub Actions 發布。先將 repository 的 **Settings → Pages → Build and deployment → Source** 設為 **GitHub Actions**，之後每次推送到 `main` 都會自動部署。

## 跨裝置登入與同步

前端已支援 Supabase Email／密碼登入，以及登入後的持股、退出計畫雲端載入與持股 CRUD。行情由 FinMind 提供最近收盤日資料（非盤中即時）；資料表和每位使用者的 Row Level Security 政策位於 `supabase/schema.sql`。

1. 在 `orbitfolio` Supabase 專案的 SQL Editor 執行 `supabase/schema.sql`。
2. Authentication → URL Configuration：將 Site URL 設為 `https://shianshe.github.io/orbitfolio/`，並將 `https://shianshe.github.io/orbitfolio/**` 加到 Redirect URLs。
3. Project URL 與 Publishable key 已填在 `supabase-config.js`。這個 publishable key 是瀏覽器公開值；絕不可將 `service_role` key 放進前端。
4. 將變更推送到 `main`，GitHub Actions 會重新部署。開啟網站後註冊並驗證 Email，再登入；首次登入會將此瀏覽器的持股匯入新帳戶，若該瀏覽器沒有持股則建立 00631L 預設資料。

前端需要的 Publishable／anon key 是公開值，安全性由 RLS 政策提供。絕不可把 `service_role` key 放進前端或提交至 repository。當雲端已存在資料時，登入會以雲端資料為準，不會覆寫雲端資料。

行情資料來源為 FinMind，免費方案限非商業用途，網站會標示來源；API 每小時有呼叫上限。資料來源故障時保留既有行情並顯示警告。

持股列可新增買進成交紀錄，輸入股數、成交單價及券商 App 顯示的實際手續費；系統依原始部位與買進紀錄累加股數、計算含手動輸入手續費的加權均價，不會估算手續費。成交紀錄與持股基礎分開保存。
