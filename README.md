# オセロ対戦(QR接続・サーバー不要)

GitHub Pages などの静的ホスティングだけで動く、スマホ同士のオセロ対戦ゲームです。
WebRTC DataChannel で端末同士が直接通信し、接続情報はQRコード(またはコピー&ペースト)で交換します。

## 遊び方
1. 両者がこのページを開く(カメラ利用のため **HTTPS** で配信すること)
2. Aさん「対戦を作成」→ 招待QRを表示
3. Bさん「対戦に参加」→ 招待QRを読み取る → 返信QRが表示される
4. Aさん「② 相手の返信を読み取る」→ Bさんの返信QRを読み取る
5. 接続されると自動で対戦開始(Aが黒・先手)

カメラが使えない場合は、表示されたコードをコピーしてLINE等で送り、貼り付けても接続できます。

## 公開方法
リポジトリのルートをそのまま GitHub Pages(Settings → Pages → Deploy from a branch)で公開してください。
ローカル確認: `npx serve .` や `python -m http.server`(localhost はカメラ可。LAN内IPはHTTPSが必要)。

## 構成
- `index.html` / `style.css` — 画面
- `js/othello.js` — ルール
- `js/rtc.js` — WebRTC と接続コードの圧縮/展開
- `js/app.js` — UI・QR・対戦制御
- `vendor/` — qrcode-generator(MIT)、jsQR(Apache-2.0)

## 注意
- 接続コード交換後はGoogleのSTUNを補助的に使います。同じWi-Fiでもルーターの「AP分離」が有効だと繋がりません。
- 一部のネットワーク(厳しいNAT)ではTURNが無いと接続できない場合があります。
- iOS Safari は 16.4 以降を推奨(接続コードの圧縮に使用)。

a