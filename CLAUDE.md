# download-helper

ブックマークレット用のダウンロード UI パッケージ。fanbox-downloader から利用される。
[furubarug/download-helper](https://github.com/furubarug/download-helper) からforkしたもの。

## コマンド

- `bun run build` — `build:js` と `build:types` をまとめて実行
- `bun run build:js` — `bun build --no-bundle` で `download-helper.ts` → `download-helper.js`、`fanbox-collector.ts` → `fanbox-collector.js` にそれぞれトランスパイル
- `bun run build:types` — `tsconfig.declaration.json` を使い `tsc --emitDeclarationOnly` で `dist/types/*.d.ts` を生成 (Issue #12)
- `bun run lint` — Biome による静的解析・フォーマット修正

## プロジェクト構成

```
download-helper.ts         # 汎用ダウンロード UI / ZIP 生成のソースコード
download-helper.js         # トランスパイル済み出力（コミット対象）
fanbox-collector.ts        # FANBOX 固有の収集ロジック (fanbox-downloader / fanbox-downloader-extension 共用)
fanbox-collector.js        # トランスパイル済み出力（コミット対象）
dist/types/                # tsc --emitDeclarationOnly の出力 (コミット対象。詳細は下記)
  download-helper.d.ts
  fanbox-collector.d.ts
biome.json                 # Biome 設定
.mise.toml                 # mise ツールバージョン管理
package.json
tsconfig.json               # エディタの型チェック用 (noEmit)
tsconfig.declaration.json   # dist/types/ 生成専用 (declaration: true, entry point を2ファイルに限定)
```

- `package.json` の `exports` で `"."` / `"./download-helper"` / `"./fanbox-collector"` それぞれの runtime (`.js`) と types (`.d.ts`) を固定している。ルートの `types` も `dist/types/download-helper.d.ts` を指す
- `download-helper.js` / `fanbox-collector.js` / `dist/types/*.d.ts` はgit管理対象。ビルド後に差分があればコミットすること
- `.d.ts` を `download-helper.ts` と同じディレクトリではなく `dist/types/` に分離しているのは、`fanbox-collector.ts` が `./download-helper` を相対 import しており、同じディレクトリに置くと宣言間の相対 import が `exports` を通らず `.ts` を再び選びうるため (Issue #12)。`dist/types/` 内で相対 import が閉じるようにしている
- `.ts` はソースであり実行時の配布対象ではないため `files` / `exports` には含めない。ただし `github:` 参照では `files` はフィルタとして機能しない (Bun の GitHub 依存は `files` を無視する) ので、リポジトリ自体には引き続き含まれる
- npm パッケージとしてではなく `github:ValerianDillon/download-helper#vX.X.X` (git tag) で参照される

## 技術スタック

- Bun でトランスパイル（TypeScript → ES module）
- Biome で静的解析・フォーマット
- tsconfig.json はエディタの型チェック用に維持
- runtime 依存パッケージなし
- CDN 経由で動的読み込み: Bootstrap 5.3
- ZIP 書き込みは File System Access API による自前実装 (Chrome/Edge のみ対応)

## アーキテクチャ

`download-helper.ts` はレイヤード構成:

1. **DownloadUtils** — ユーティリティ（メディア判定、ファイル名エンコード、fetch ラッパー、sleep）
2. **DownloadObject / PostObject / FileObject** — ダウンロードデータのラッパークラス群
3. **DownloadHelper** — 最上位クラス。UI 生成、ZIP ダウンロード、HTML 生成を統合

主な機能:
- ZIP ダウンロード（File System Access API + 自前 ZipWriter）
- Bootstrap ベースのタグフィルタリング UI
- リトライ機能付き fetch（レート制限対策）
- ファイル名の Windows 互換エンコーディング（全角記号への置換）

`DownloadHelper.downloadZip` は第 5 引数 `options?: DownloadZipOptions` で以下を差し替え可能（省略時は従来どおりの挙動）:
- `handle` — 指定時は `showSaveFilePicker` を呼ばずこのハンドルに書き込む
- `signal` — 指定時、投稿ループ / ファイルループの先頭で `aborted` を確認して中断する
- `fetchFile` — ファイル取得処理の差し替え（拡張は service worker 経由の CORS 回避プロキシを注入する）。第 3 引数
  `context.kind`（`'cover' | 'file'`）でカバー画像か投稿内添付ファイルかを呼び出し側に伝える（Issue #13）。
  引数が 2 つの既存関数もそのまま代入できる（TypeScript の関数型の部分型付けにより後方互換）

`downloadZip` は `DownloadZipResult`（`completedPostCount` / `totalPostCount` / `writtenFileCount` /
`failedFileCount` / `aborted`）を返す（Issue #13）。各件数の定義は `DownloadZipResult` の JSDoc を参照。
既存呼び出し元（`createDownloadUI` のブックマークレット向け UI）は戻り値を無視しており、そのままコンパイルできる。

`fanbox-collector.ts` は FANBOX API の型定義、`DownloadManage`（収集時の状態管理）、`addByPostInfo` /
`convertImageMap` / `convertFileMap` / `convertEmbedMap` / `convertUrlEmbedMap`（postInfo → DownloadObject 変換）
をまとめたもの。fanbox-downloader（ブックマークレット）と fanbox-downloader-extension の両方から参照される。
投稿一覧の取得・ページネーション・レート制限などの API 呼び出し自体は含めず、各利用側に委ねる。

## コーディング規約

- Biome (recommended ルールセット) で強制。設定は `biome.json` に記載
- インデント: スペース2つ
- シングルクォート、セミコロンあり、末尾カンマあり
- `lineWidth: 120`
- JSDoc 形式のドキュメントコメント（日本語）
- クラス: PascalCase、メソッド/変数: camelCase

## Git運用

- コミットの author/committer は ValerianDillon であること
- **`gh pr create` は fork 元 (furubarug/download-helper) をデフォルトのベースリポジトリにする。** 必ず `--repo ValerianDillon/download-helper --base main` を指定すること

## リリース手順

1. `package.json` の `version` を更新
2. `bun run build`
3. コミット・push
4. `git tag vX.X.X && git push origin vX.X.X`
