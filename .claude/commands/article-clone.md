# Article Clone - 競合記事LP自動クローン

競合のアフィリエイト記事LPをスクレイピングし、テキスト差し替え＋画像AI生成で、Squad Beyond互換HTMLを出力する。

## ワークフロー

このスキルは5つのフェーズで実行する。各フェーズの完了を確認してから次へ進む。

---

### Phase 1: スクレイプ（自動 ~30秒）

ユーザーにクローン対象のURLを聞く。

```
const { scrape } = await import('./src/scraper.js');
const result = await scrape(url);
```

**実行内容:**
1. URLを受け取る
2. `node src/scraper.js <URL>` でPlaywrightスクレイプを実行
3. `output/scraped/<slug>/source.html` と `assets/` に保存される
4. アセットダウンロード数と合計サイズを報告

**報告フォーマット:**
- ページタイトル
- HTML サイズ
- ダウンロードしたアセット数（画像/動画）

---

### Phase 2: 構造解析（自動 ~5秒）

```
const { parseFromFile } = await import('./src/parser.js');
const structure = await parseFromFile('output/scraped/<slug>/source.html', 'output/analysis/<slug>/');
```

**実行内容:**
1. `node src/parser.js output/scraped/<slug>/source.html output/analysis/<slug>/` を実行
2. `structure.json` が生成される

**報告フォーマット:**
```
構造解析結果:
- ブロック数: XX
- セクション数: XX
- 画像: XX枚
- 動画: XX個
- SBウィジェット: XX個（testimonial: X, flash_text: X, etc）
- CTAリンク: XX箇所
```

---

### Phase 3: 差し替え設定（対話 ~3分）

ユーザーとの対話で差し替え内容を決定する。

**ステップ3-1: 構造サマリー提示**
- structure.jsonを読み、セクションごとの内容を要約して提示
- 頻出語（商品名候補）を一覧表示
- 既存CTAリンクを表示

**ステップ3-2: 商品情報ヒアリング**

AskUserQuestionを使って以下を聞く:
- 新しい商品名
- 新しい会社名
- 新しいCTA URL
- 追加の直接置換ペア（成分名、価格など）
- フレーズ書き換えの要否

**ステップ3-3: replacement-config.json生成**

ヒアリング結果から `output/analysis/<slug>/replacement-config.json` を生成:
```json
{
  "directReplacements": {
    "旧商品名": "新商品名",
    "旧会社名": "新会社名"
  },
  "phraseRewrites": [],
  "ctaUrl": "https://...",
  "excludeSelectors": [".small", "font[color='#888888']"]
}
```

**ステップ3-4: 画像プロンプト一覧**
- 各画像に対する生成プロンプト案を提示
- ユーザーに修正/承認を求める
- 「画像生成をスキップ」も選択肢に入れる

---

### Phase 4: 生成（自動 ~5分）

**テキスト差し替え:**
```javascript
const { applyTextModifications } = await import('./src/text-modifier.js');
const html = fs.readFileSync('output/scraped/<slug>/source.html', 'utf-8');
const config = JSON.parse(fs.readFileSync('output/analysis/<slug>/replacement-config.json', 'utf-8'));
const modifiedHtml = applyTextModifications(html, config);
```

**画像生成（GEMINI_API_KEY必須）:**
```javascript
const { generateBatch } = await import('./src/image-generator.js');
const results = await generateBatch(imageList);
```

画像生成をスキップした場合は元画像URLをそのまま使用。

---

### Phase 5: 組み立て＆検証（自動 ~10秒）

```javascript
const { buildSbHtml, validateSbHtml } = await import('./src/html-builder.js');
const finalHtml = buildSbHtml(modifiedHtml, {
  imageMap: generatedImageMap,
  ctaUrl: config.ctaUrl,
  regenerateIds: true
});
const validation = validateSbHtml(finalHtml);
```

**実行内容:**
1. SB互換HTMLを構築
2. バリデーション実行
3. `output/final/<slug>/cloned-lp.html` に保存

**最終報告:**
```
✓ クローンLP生成完了
  出力: output/final/<slug>/cloned-lp.html
  サイズ: XX KB
  ブロック数: XX
  バリデーション: OK / NG (詳細)

SBへの貼り付け手順:
1. cloned-lp.html の内容をコピー
2. SB記事エディタのHTML編集モードで貼り付け
3. プレビューで確認
```

---

## 注意事項

- 画像生成にはGEMINI_API_KEY_1, _2, _3環境変数が必要
- 動画は元URLをそのまま使用するか、静止画に置換
- フッターの法的リンク（特商法、プライバシーポリシー等）は差し替えない
- SB互換HTMLには<html>/<body>タグを含めない
