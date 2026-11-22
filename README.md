# Discord Webtool

Cloudflare Pages 上で動く Discord 連射ツール。トークン・変数・ログはすべてブラウザの localStorage（端末プロファイル別）に保存され、サーバー側は無状態プロキシのみ。

## デプロイ

1. このリポジトリを GitHub に push（public でも private でも可）
2. Cloudflare ダッシュボード → Workers & Pages → Create → Pages → Connect to Git
3. リポジトリを選択
4. 設定:
   - Framework preset: `None`
   - Build command: （空）
   - Build output directory: `public`
5. Save and Deploy → 発行された `*.pages.dev` を開く

`functions/` は自動で Pages Functions としてデプロイされる。追加設定は不要。

## ローカル