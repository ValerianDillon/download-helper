# download-helper

ブックマークレット用のダウンロード UI パッケージ。fanbox-downloader から利用される。
[furubarug/download-helper](https://github.com/furubarug/download-helper) からforkしたもの。

## コマンド

- `npm run build` — `tsc` で `download-helper.ts` → `download-helper.js` にコンパイル
- テスト・リントの設定はなし

## プロジェクト構成

```
download-helper.ts    # ソースコード（単一ファイル）
download-helper.js    # コンパイル済み出力（コミット対象）
package.json
tsconfig.json
```

- `package.json` の `files` で `download-helper.js` と `download-helper.ts` を配布対象に指定
- `download-helper.js` はgit管理対象。ビルド後に差分があればコミットすること
- npm パッケージとしてではなく `github:ValerianDillon/download-helper#release/X.X.X` で参照される

## 技術スタック

- TypeScript 4.x（strict モード）→ ES2017 ターゲット、ES2015 モジュール出力
- runtime 依存パッケージなし
- CDN 経由で動的読み込み: Vue.js 3.2, Bootstrap 5.0, StreamSaver.js 2.0, web-streams-polyfill

## アーキテクチャ

単一ファイルにレイヤード構成:

1. **DownloadUtils** — ユーティリティ（メディア判定、ファイル名エンコード、fetch ラッパー、sleep）
2. **DownloadObject / PostObject / FileObject** — ダウンロードデータのラッパークラス群
3. **DownloadHelper** — 最上位クラス。UI 生成、ZIP ダウンロード、HTML 生成を統合

主な機能:
- ZIP ダウンロード（StreamSaver.js 経由）
- Vue.js ベースのタグフィルタリング UI
- リトライ機能付き fetch（レート制限対策）
- ファイル名の Windows 互換エンコーディング（全角記号への置換）

## コーディング規約

- JSDoc 形式のドキュメントコメント（日本語）
- クラス: PascalCase、メソッド/変数: camelCase
- strict モード有効

## Git運用

- リリースは `release/X.X.X` ブランチで管理
- コミットの author/committer は ValerianDillon であること
