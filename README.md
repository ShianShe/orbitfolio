# Orbitfolio

繁體中文持股管理網頁原型。

## 本機開啟

直接以瀏覽器開啟 `index.html`。持股資料目前保存在目前瀏覽器的 `localStorage`，不會跨裝置同步，也不應將真實持股資料提交到 GitHub。

## GitHub Pages

此專案是靜態網頁，可透過 GitHub Actions 發布。先將 repository 的 **Settings → Pages → Build and deployment → Source** 設為 **GitHub Actions**，之後每次推送到 `main` 都會自動部署。

目前尚未串接登入、雲端資料庫或行情來源。跨裝置登入同步需另行加入驗證與具備使用者資料隔離規則的資料庫。
