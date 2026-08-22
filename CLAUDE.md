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

`%` を含む archive 名も、HTML の参照が実在しないファイルを指す。`encodeURI` が `%` 自体を符号化しないため、`%2F.png` というファイル名の参照が `./%2F.png` になり、ブラウザは `/.png` として解決する。これも従来からある欠陥で、直すと出力が変わるため同じ段階で扱う。

finalize では衝突を検出しない。legacy 自身が作れる衝突を例外にすると、`cover` というタイトルの投稿のような現実的な入力でダウンロード全体が落ち、いま得られている「1 ファイルだけ影に入った ZIP」より悪くなる。投稿ディレクトリ名の重複は `downloadZip` が弾くが、その検証は `showSaveFilePicker` より前にあるので、finalize に移しても早期失敗にはならない
- アセットの付随メタデータ (`size` / `width` / `height`) と投稿タイプ (`PostObj.postType`) は内部表現に保持するが `DownloadJsonObj` には出さない。利用側の絞り込み条件のために持つ

`fanbox-collector` 側の検証も変わる。

- asset の `id` を必須フィールドとして検証する (`body.images[]` / `body.files[]` / `imageMap` / `fileMap`)
- `imageMap` / `fileMap` はマップのキーと値の `id` が一致することも検証する。identity として使う以上、不一致のまま通すと別のアセットを同一視しうる
- `body.images` / `body.files` 内で `id` が重複していれば `invalid` にする (`missing` には `body.images[1].id` のように衝突した位置を入れる)
- `size` / `width` / `height` は非負の安全な整数でなければ欠落として扱う。収集が読まない付随メタデータなので、型が違っても `invalid` にはしない

### 選択条件からダウンロード対象を導出する (Issue #42)

`Selection` は「投稿の集合 (postId) × 拡張子の集合 × カバーを含めるか」の単純な積 (AND) である。カバーは「投稿が選択済み AND `includeCover`」で、拡張子の選択はカバーには適用しない (カバーは投稿の付随物であって添付の一種ではない)。拡張子の比較は `normalizeExtension` を通した形 (小文字、先頭ドット付き、無しは空文字列) で行う。

`DownloadObject.project(selection, options?)` が `DownloadJsonObj` を返す。入力は変更せず、同じ入力と `Selection` に対して決定的である (`options.now` を渡せば `generatedAt` も含めて決まる)。

- **選択で間引いても archive path を再採番しない。** 割り当ては選択前の全アセットから行い、`Selection` は出力に載せるかどうかだけに使う。間引いた後の件数で採番し直すと HTML 内の参照と一致しなくなる
- `postCount` は選択投稿数、`fileCount` は選択された `post.files` の数 (カバーを含めない。従来の `countFile` と同じ意味論)
- root の `tags` は選択後の投稿に残っているものだけを出す。`setTags` の並び (支援額タグを先頭に置く) は保つ
- 「絞り込まずに全部落とす」も projection を経た結果として表す (`selectAll()`)。ZIP 入力の経路を 1 本にするため、`stringify()` は `project(selectAll())` に委譲する

除外されたアセットは HTML 内でプレースホルダーに解決する。カードごと削除しない (後からアーカイブを見たときに元の投稿に何が含まれていたかが失われる)。画像・動画・音声のカードは `src` でも参照するので `<a>` を無効化するだけでは足りず、カード全体を差し替える。これを可能にするため `HtmlFragment` に `assetCard` (アセット 1 件のカード全体) がある。プレースホルダーには元ファイル名 / 拡張子 / 種別と「選択条件により除外しました」を残し、URL は残さない。「取得に失敗した」とは別の状態なので文言を分ける。

**アセットへの参照 (`CardBodyFragment` の `assetRef`) はカードの中にしか置けない。** カードの外に置けると、カードごと差し替えても参照だけが残り、除外したはずのアセットを指す `src` / `href` が出力に出てしまう。参照先はそのカードの `key` に限り、`setHtml` が検証する。投稿が持たないアセットを参照するカードは finalize で例外にする (プレースホルダーで描くと「選択条件で外した」のか「登録し忘れた」のか区別できなくなる)。

ZIP ルートに `download-manifest.json` を書き出す (`schemaVersion` / `creatorId` / 生成日時 / `Selection` / 投稿ごとの含めた・除外したアセット / 投稿ごと除外した投稿)。**アセットは投稿にネストする** — `postId` の一意性を保証しない以上、平坦に並べると同じ postId の投稿が 2 件あったときにどちらのものか分からなくなる。アセットは `kind` と `assetId` で投稿内を一意に指す (カバーは `assetId` を持たない)。この段階で主張するのは「plan に含めた」「選択条件で除外した」までで、「実際に書けた」とは主張しない。選択条件を `informationText` (info JSON) に混ぜない — info JSON は FANBOX の投稿メタデータで、選択条件はダウンロード実行側の情報なので、混ぜると出所が曖昧になる。

`manifest` は projection を経た印でもある。`isDownloadJsonObj` がこれを必須にすることで、絞り込みを経ていないオブジェクトを ZIP 入力として受け付けない。印として働かせるには形だけでは足りないので、各要素の型に加えて次まで検証する (形だけ整えた manifest を付けただけの入力を通さないため)。

- `creatorId` が `id` と一致すること
- `manifest.posts` が JSON の投稿と件数・`archiveDirectory` で **同じ index に対応する**こと (`manifest.posts` は収集順と定義しているため。集合として含まれるだけでは通さない)
- 各投稿の `included` が JSON の `files[].encodedName` / `originalName` および `cover.name` と 1 対 1 で対応すること
- 同じアセットが `included` と `excluded` の両方に無いこと
- `postCount` / `fileCount` が JSON の実件数と一致すること
- 記録された `Selection` と内容が矛盾しないこと (出力に載っている投稿が `postIds` に含まれる、`excludedPosts` が `postIds` に含まれない、含めた / 除外したアセットの拡張子が `extensions` と対応する、カバーの扱いが `includeCover` と一致する)

検証できないものが 2 つある。どちらも `DownloadJsonObj` 側に対応する値が無いためで、突き合わせのためだけに identity を JSON へ写す設計は採らない (同じ値を 2 箇所に置いて一致を確かめる形になり、ずれたときにどちらが正しいか決められない)。

- `excludedPosts` の網羅性。projection 後の JSON には元の投稿一覧が残らない
- `postId` / `kind` / `assetId` / `extension` が実際の投稿・アセットに結び付いていること。これらは manifest にしか無いので、投稿間で `postId` を入れ替えても検証を通る

`isDownloadJsonObj` は `unknown` を受ける型ガードなので、**manifest の検証は投稿の型検証を通してから行う**。先に行うと、壊れた `posts` / `cover` を参照して例外を投げてしまう。

未知のプロパティは拒否しないが、**書き出すのは検証済みのフィールドだけを写した canonical な manifest である**。受け取ったオブジェクトをそのまま直列化すると、URL を持たせた入力がそのまま `download-manifest.json` に残る (getter や `toJSON` も同じ経路で効く)。写すときは入力配列の `map` や iterator を呼ばず index で読む — `Array` の派生クラスで `map` を差し替えられると、写した先に細工を混ぜられるため。

配列は `isDenseArray` で hole が無いことを確かめてから要素を見る。`every` / `some` / `reduce` は hole を飛ばすので、`new Array(3)` のような疎配列はどんな述語でも通ってしまい、書き出すと `[null, null, null]` になる。

`DownloadJsonObj` は `project()` の出力か、それを `JSON.parse` した結果であることを契約とする。getter・`Array` の派生クラス・独自の `Symbol.iterator`・`toJSON` は含まれない前提で、任意のオブジェクトを安全に扱えるとは主張しない。

その上で `downloadZip` は **manifest を一度だけ読んで素の値に写し (`snapshotManifest`)、その写しだけを検証と書き出しに使う**。検証と書き出しで別々に読むと、読むたびに値を変える getter で「検証を通った値」と「書き出される値」を食い違わせられる。検証側も各フィールドを 1 回だけ読み、未信頼の配列に対して `map` / `every` / iterator を呼ばない (index で読む)。

ZIP ルート直下の固定ファイル名 (`index.html` / `download-manifest.json`) と同名の投稿ディレクトリ、および投稿ディレクトリ直下の固定ファイル名 (`index.html` / `info.json` / `info.txt`) と同名のアセットは `downloadZip` が拒否する。比較は大文字小文字を畳み、末尾の空白とピリオドを落としてから行う (Windows と既定の macOS は大文字小文字を区別せず、Windows は末尾の空白とピリオドを取り除いて解釈するため、完全一致だけでは `INDEX.HTML` や `index.html.` がすり抜ける)。同じパスがファイルとディレクトリの両方になり、展開できない ZIP になるため。legacy allocator の名前衝突 (同名グループの採番など) を許容するのとは扱いが違う — あちらは「1 ファイルだけ影に入った ZIP」で済むが、こちらはアーカイブ全体が壊れる。`index.html` の衝突は #42 以前からある欠陥で、ここで併せて塞いだ。

`PostObj.postId` は `Selection` が投稿を指すキーである。一意性は検証しない (一覧ページの重複などで同じ投稿が 2 回来ても収集を止めないことを優先する)。同じ postId の投稿が 2 件あれば選択は両方に同時に効く。

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
