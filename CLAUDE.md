# Article Cloner

競合アフィリエイト記事LPの自動クローンシステム。Squad Beyond互換HTMLを出力。

## プロジェクト構成

```
src/
  scraper.js        - Playwrightスクレイピング + アセットDL
  parser.js         - Cheerio HTML構造解析
  text-modifier.js  - テキスト差し替えエンジン
  image-generator.js - Gemini API画像生成（3キーローテ）
  html-builder.js   - SB互換HTML組み立て
  utils.js          - 共通ユーティリティ
```

## 使い方

`/article-clone` スキルで対話的にクローン実行。

## SB互換HTML ルール（厳守）

1. **画像**: `<picture>` + `<source type="image/webp" data-srcset>` + `<img class="lazyload" data-src>`
2. **動画**: `<video class="ql-video lazyload" autoplay muted loop playsinline>` + `<source type="video/mp4" data-src>`
3. **ID**: `sb-part-XXXXX` + `sb-custom-part-XXXXX` は必ず一意のIDを生成
4. **CSS**: 各ウィジェットにスコープド `<style>` ブロック（`#sb-part-XXX.sb-custom-part-XXX` セレクタ）
5. **禁止**: `<html>`, `<body>` タグは含めない（SBフラグメントのため）
6. **末尾**: video margin reset ウィジェットを必ず含める

## 環境変数

- `GEMINI_API_KEY_1`, `GEMINI_API_KEY_2`, `GEMINI_API_KEY_3` - 画像生成用
- `GEMINI_API_KEY` - フォールバック用単一キー

## 技術スタック

- Node.js (ESM)
- Playwright (chromium headless)
- Cheerio (HTML解析)
- Sharp (画像リサイズ)
- Gemini API (画像生成)
