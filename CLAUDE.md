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

### アセットの identity と archive path (Issue #41)

投稿内のアセットは `AssetKey` で一意に指す。通常のアセットは `{ kind: 'image' | 'file', assetId }` で、`assetId` は FANBOX が返す asset の `id` である。カバーは `id` を持たないので `{ kind: 'cover' }` という post 内一意の sentinel にする。
配列位置や `encodeFileName` 後の名前を identity にしない。位置も名前も、収集後にアセットを間引くと別のアセットを指しうるため。

archive path (ZIP 内の名前) を決めるのは `ArchivePathAllocator` だけである。従来の採番規則 (同名グループの件数に依存して `_1` / `_2` を付ける) は `createLegacyArchivePathAllocator` として保持し、`DownloadObject` / `DownloadManage` の任意引数で差し替えられる。

- `PostObj.html` は文字列ではなく `HtmlFragment[]` (文字列と `{ assetRef: AssetKey }` の列)。`getImageLinkTag` などのリンクタグ生成はパス文字列を埋め込まず、`assetRef` を持つ断片を返す
- 断片から archive path への解決は `stringify()` (finalize) の時点で行う。したがって HTML 内の参照と `DownloadJsonObj` の `files[].encodedName` / `cover.name` は、定義上ずれない
- 従来この 2 つが一致していたのは「同名グループへの `addFile` がすべて終わってから HTML を生成する」という `addByPostInfo` の呼び出し順序に依存していたためで、契約としては書かれていなかった
従来の出力から変わるのは次の 3 点だけで、いずれも壊れていた出力を直すものである。それ以外は `DownloadJsonObj` の内容・キー順・`posts[].files` の並び順・投稿ディレクトリの採番を含めて変わらない。

- カバーの割り当て名は `encodeFileName` を通す。従来は情報 JSON の `cover.name` だけが未エンコードで、HTML 側の参照はエンコード済みだったため、`/` を含む拡張子のような入力で両者がずれていた (ZIP の事前検証で落ちる)。割り当てを 1 箇所にまとめる以上どちらかに寄せる必要があり、参照先が実在する側に揃えた
- `name` と `url` がどちらも同じで `assetId` が異なるアセットが同一投稿内にあると、HTML の参照が変わる。従来は `FileObject.equals` が `name` と `url` の一致でアセットを同定していたため、両方の参照が先頭の archive path に解決し、2 つ目のファイルは ZIP に入るのに誰からも参照されなかった。`AssetKey` は両者を区別する
- `setTags` を呼ばずに `stringify()` したときのタグの並びが、投稿名でグループ化した辞書の列挙順から収集順に変わる。`fanbox-collector` は `applyTags()` で明示設定するので、FANBOX の収集経路はこの既定を通らない

legacy allocator には既知の名前衝突がある。投稿内で archive 名が重複し (`a` が 2 件と `a_1` が 1 件あると `a_1.png` が 2 つできる。カバーは常に `cover.<ext>` なので、同名の添付や `cover` というタイトルの image 投稿と衝突する)、投稿ディレクトリ名も同じ形で重複する (投稿名 `a`, `a`, `a_1` で `a_1` が 2 つ)。採番規則そのものの欠陥で、直すと出力が変わるため、archive path を postId 由来に変える段階で扱う。

finalize では衝突を検出しない。legacy 自身が作れる衝突を例外にすると、`cover` というタイトルの投稿のような現実的な入力でダウンロード全体が落ち、いま得られている「1 ファイルだけ影に入った ZIP」より悪くなる。投稿ディレクトリ名の重複は `downloadZip` が弾くが、その検証は `showSaveFilePicker` より前にあるので、finalize に移しても早期失敗にはならない
- アセットの付随メタデータ (`size` / `width` / `height`) と投稿タイプ (`PostObj.postType`) は内部表現に保持するが `DownloadJsonObj` には出さない。利用側の絞り込み条件のために持つ

`fanbox-collector` 側の検証も変わる。

- asset の `id` を必須フィールドとして検証する (`body.images[]` / `body.files[]` / `imageMap` / `fileMap`)
- `imageMap` / `fileMap` はマップのキーと値の `id` が一致することも検証する。identity として使う以上、不一致のまま通すと別のアセットを同一視しうる
- `body.images` / `body.files` 内で `id` が重複していれば `invalid` にする (`missing` には `body.images[1].id` のように衝突した位置を入れる)
- `size` / `width` / `height` は非負の安全な整数でなければ欠落として扱う。収集が読まない付随メタデータなので、型が違っても `invalid` にはしない

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

`DownloadObject` / `DownloadManage` はどちらも第 3 引数で `ArchivePathAllocator` を受け取る（省略時は legacy allocator）。

`fanbox-collector.ts` は FANBOX API の型定義、`DownloadManage`（収集時の状態管理）、`addByPostInfo` /
`convertImageMap` / `convertFileMap` / `convertEmbedMap` / `convertUrlEmbedMap`（postInfo → DownloadObject 変換）
をまとめたもの。fanbox-downloader（ブックマークレット）と fanbox-downloader-extension の両方から参照される。
投稿一覧の取得・ページネーション・レート制限などの API 呼び出し自体は含めず、各利用側に委ねる。

`addByPostInfo` は判別可能な `AddPostResult` を返す（Issue #14、破壊的変更）。
`{ status: 'added' }` は取り込み成功、`{ status: 'ignored' }` は `isIgnoreFree` による意図的な除外で、いずれも利用側は数えない想定である。
`{ status: 'unavailable'; reason: 'restricted' | 'missing-body' }` は本文を取り込めなかった投稿で、`reason` は `postInfo.isRestricted` が真なら `'restricted'`、それ以外（`postInfo` 自体が無い、または `body` が無い）なら `'missing-body'` になる。
`{ status: 'invalid'; postId; type; missing }` は既知の投稿タイプなのに `addByPostInfo` が実際に読み取るフィールドが欠けている構造的な不一致で、`missing` に欠けたフィールドのパス（例: `'body.images'`）を列挙する。
`{ status: 'unsupported'; postId; type }` は未知の投稿タイプで、本文を読めないため取り込まないが、収集全体は中断しない。
呼び出し側が中断すべきかどうかを判断できるよう、`unavailable` / `unsupported` は投稿単位の欠落として続行してよい失敗、`invalid` は本文形式の前提が崩れている（＝新しい API 仕様に追随が必要な）失敗として区別できる設計にしている。
旧版（v4.4.0 以前）は `AddPostResult` が `'added' | 'ignored' | 'unavailable' | 'invalid'` という文字列そのものだった。
旧文字列と新 `status` の対応は `'added'` → `{ status: 'added' }`、`'ignored'` → `{ status: 'ignored' }`、`'unavailable'` → `{ status: 'unavailable'; reason: ... }`、`'invalid'` → `{ status: 'invalid'; postId; type; missing }` であり、加えて新設の `'unsupported'` は旧版では `'added'` として登録されていた未知タイプの投稿に対応する。

## コーディング規約

- Biome (recommended ルールセット) で強制。設定は `biome.json` に記載
- インデント: スペース2つ
- シングルクォート、セミコロンあり、末尾カンマあり
- `lineWidth: 120`
- JSDoc 形式のドキュメントコメント（日本語）
- クラス: PascalCase、メソッド/変数: camelCase
- 交差型の `}` と `& (` の間にコメントを置かない。Biome が実行のたびに行順を並べ替えるため
  `bun run lint` が冪等でなくなり、CI の「lint / build 後に作業ツリーが汚れていないこと」の検査が必ず落ちる。
  型そのものについての説明は宣言の上の JSDoc に書く

## Git運用

- コミットの author/committer は ValerianDillon であること
- **`gh pr create` は fork 元 (furubarug/download-helper) をデフォルトのベースリポジトリにする。** 必ず `--repo ValerianDillon/download-helper --base main` を指定すること

## リリース手順

1. `package.json` の `version` を更新
2. `bun run build`
3. コミット・push
4. `git tag vX.X.X && git push origin vX.X.X`
