# download-helper

ブックマークレットとブラウザ拡張が共用する、FANBOX 収集ロジックと ZIP 生成の共有ライブラリ。
[furubarug/download-helper](https://github.com/furubarug/download-helper) から fork した。

利用側は 2 つある。ValerianDillon/fanbox-downloader (ブックマークレット) と ValerianDillon/fanbox-downloader-extension (Chrome 拡張)。
npm ではなく `github:ValerianDillon/download-helper#vX.X.X` (git tag) で参照される。

## コマンド

- `bun run build` — `build:js` (トランスパイル) と `build:types` (`.d.ts` 生成) をまとめて実行
- `bun run lint` — Biome による静的解析・フォーマット修正
- `bun run typecheck` — `tsc --noEmit`
- `bun test` — ユニットテスト

## ビルド成果物の扱い

- `download-helper.js` / `fanbox-collector.js` / `api-session.js` / `dist/types/*.d.ts` は git 管理対象。ビルド後に差分があればコミットする
- `.d.ts` を `.ts` と同じディレクトリではなく `dist/types/` に置くのは、宣言間の相対 import が `exports` を通らず `.ts` を再び選びうるため (Issue #12)。`dist/types/` 内で相対 import が閉じるようにしている
- `.ts` は `files` / `exports` に含めない。ただし `github:` 参照では `files` がフィルタとして機能しない (Bun は無視する) ので、リポジトリ自体には残る

## 環境の制約

- ZIP 書き込みは File System Access API による自前実装。Chrome / Edge でしか動かない
- Bootstrap 5.3 は CDN から動的に読み込む。runtime の依存パッケージは持たない

## アセットの identity と archive path (Issue #41)

投稿内のアセットは `AssetKey` で一意に指す。通常のアセットは `{ kind: 'image' | 'file', assetId }` で、`assetId` は FANBOX が返す asset の `id`。カバーは `id` を持たないので `{ kind: 'cover' }` という投稿内一意の sentinel にする。

**配列位置や `encodeFileName` 後の名前を identity にしない。** 位置も名前も、収集後にアセットを間引くと別のアセットを指しうる。

archive path (ZIP 内の名前) を決めるのは `ArchivePathAllocator` だけである。

- `PostObj.html` は文字列ではなく `HtmlFragment[]`。リンクタグ生成はパス文字列を埋め込まず、アセットへの参照を持つ断片を返す
- 断片から archive path への解決は finalize の時点で行う。したがって HTML 内の参照と `DownloadJsonObj` の `files[].encodedName` / `cover.name` は定義上ずれない
- 従来この 2 つが一致していたのは `addByPostInfo` の呼び出し順序に依存していたためで、契約としては書かれていなかった
- 従来の採番規則は `createLegacyArchivePathAllocator` として保持し、`DownloadObject` / `DownloadManage` の任意引数で差し替えられる

allocator が満たすべき契約と、finalize が検出できる範囲は `ArchivePathAllocator` の JSDoc が SoT。決定性と入力の非変更は戻り値だけでは判定できないので検出しない。

### 直さないと決めた既知の欠陥

いずれも legacy allocator の採番規則そのものに由来し、直すと出力が変わる。archive path を postId 由来に変える段階で扱う。

- 投稿内で archive 名が衝突する (`a` が 2 件と `a_1` が 1 件で `a_1.png` が 2 つ)。カバーは常に `cover.<ext>` なので、同名の添付や `cover` というタイトルの image 投稿とも衝突する
- 投稿ディレクトリ名も同じ形で衝突する
- `%` を含む archive 名は HTML の参照が実在しないファイルを指す。`encodeURI` が `%` 自体を符号化しないため

finalize では衝突を検出しない。legacy 自身が作れる衝突を例外にすると、`cover` というタイトルの投稿のような現実的な入力でダウンロード全体が落ち、いま得られている「1 ファイルだけ影に入った ZIP」より悪くなる。

## 選択条件からダウンロード対象を導出する (Issue #42)

`Selection` は「投稿の集合 (postId) × 拡張子の集合 × カバーを含めるか」の単純な積 (AND)。カバーは「投稿が選択済み AND `includeCover`」で、拡張子の選択はカバーには適用しない (カバーは投稿の付随物であって添付の一種ではない)。

`DownloadObject.project(selection, options?)` が `DownloadJsonObj` を返す。入力は変更せず、同じ入力と `Selection` に対して決定的。

- **選択で間引いても archive path を再採番しない。** 割り当ては選択前の全アセットから行い、`Selection` は出力に載せるかどうかだけに使う
- **finalize の契約検査は選択の可否によらず全投稿に対して行う。** 選択された投稿でだけ検査すると、入力の正当性が選択内容に依存してしまう
- root の `tags` は選択後の投稿に残っているものだけを出す。`setTags` の並び (支援額タグを先頭に置く) は保つ
- 「絞り込まずに全部落とす」も projection を経た結果として表す (`selectAll()`)。ZIP 入力の経路を 1 本にするため、`stringify()` は `project(selectAll())` に委譲する

### 除外されたアセットの描画

カードごとプレースホルダーに差し替える。カードを消すと、後からアーカイブを見たときに元の投稿に何が含まれていたかが失われる。画像・動画・音声のカードは `src` でも参照するので、リンクを無効化するだけでは実在しないファイルを読みに行くカードが残る。

**アセットへの参照はカードの中にしか置けない。** カードの外に置けると、カードごと差し替えても参照だけが残る。参照先はそのカードの `key` に限り、`setHtml` が検証する。

投稿が持たないアセットを参照するカードは finalize で例外にする。プレースホルダーで描くと「選択条件で外した」のか「登録し忘れた」のか区別できなくなる。

### download-manifest.json

ZIP ルートに書き出す。**アセットは投稿にネストする** — `postId` の一意性を保証しない以上、平坦に並べると同じ postId の投稿が 2 件あったときにどちらのものか分からなくなる。

- 主張するのは「plan に含めた」「選択条件で除外した」までで、「実際に書けた」とは主張しない
- URL は持たない。必要になれば `post.info` を取り直せば得られる
- 選択条件を `informationText` (info JSON) に混ぜない。info JSON は FANBOX の投稿メタデータで、選択条件はダウンロード実行側の情報なので、混ぜると出所が曖昧になる

`manifest` は projection を経た印でもある。`isDownloadJsonObj` がこれを必須にすることで、絞り込みを経ていないオブジェクトを ZIP 入力として受け付けない。印として働かせるには形だけでは足りないので、内容が JSON 側と対応することまで検証する (検証項目は `DownloadManifest` の JSDoc が SoT)。

**検証できない範囲がある。** `postId` / `assetId` などが実際の投稿・アセットに結び付いていること、`excluded` の網羅性・実在性は、`DownloadJsonObj` 側に対応する値が無いので確かめられない。突き合わせのためだけに identity を JSON へ写す設計は採らない (同じ値が 2 箇所になり、ずれたときにどちらが正しいか決められない)。

つまり manifest は「projection がこう記録した」ことを表すのであって、その記録が実際の収集結果と一致することを ZIP の受け手が検証できるわけではない。検証が担うのは「projection を経ていない入力を弾く」ところまで。

### 入力の契約と読み出し

`DownloadJsonObj` は `project()` の出力か、それを `JSON.parse` した結果であることを契約とする。getter・`Array` の派生クラス・独自の `Symbol.iterator`・`toJSON` は含まれない前提で、任意のオブジェクトを安全に扱えるとは主張しない。

- `isDownloadJsonObj` は `unknown` を受ける型ガードなので、**manifest の検証は投稿の型検証を通してから行う**。先に行うと壊れた `posts` / `cover` を参照して例外を投げる
- `downloadZip` は **manifest を一度だけ読んで素の値に写し、その写しだけを検証と書き出しに使う**。検証と書き出しで別々に読むと両者を食い違わせられる
- 未知のプロパティは拒否しないが、書き出すのは検証済みのフィールドだけを写した canonical な manifest
- 配列は hole が無いことを確かめてから要素を見る。`every` / `some` / `reduce` は hole を飛ばす

## ZIP のパス衝突

ルート直下の固定ファイル名 (`index.html` / `download-manifest.json`) と同名の投稿ディレクトリ、投稿ディレクトリ直下の固定ファイル名 (`index.html` / `info.json` / `info.txt`) と同名のアセットは `downloadZip` が拒否する。同じパスがファイルとディレクトリの両方になり、展開できない ZIP になるため。

比較は大文字小文字を畳み、末尾の空白とピリオドを落としてから行う。Windows と既定の macOS は大文字小文字を区別せず、Windows は末尾の空白とピリオドを取り除いて解釈する。

legacy allocator のアセット同士の衝突を許容するのとは扱いが違う。あちらは 1 ファイルが影に入るだけだが、こちらはアーカイブ全体が壊れる。

## fanbox-collector の検証境界

`addByPostInfo` の入口が検証境界。収集が実際に読むフィールドだけを厳密に確かめ、情報 JSON に写すだけの付随メタデータは型を見ない (`invalid` は収集全体の中断を意味するため、読まないフィールドの型変化で全件止めない)。

- asset の `id` は必須。`imageMap` / `fileMap` はマップのキーと値の `id` が一致することも確かめる。identity として使う以上、不一致のまま通すと別のアセットを同一視しうる
- `body.images` / `body.files` 内で `id` が重複していれば `invalid`
- `size` / `width` / `height` は非負の安全な整数でなければ欠落として扱う
- `PostObj.postId` の一意性は検証しない。一覧ページの重複などで同じ投稿が 2 回来ても収集を止めないことを優先する。同じ postId の投稿が 2 件あれば選択は両方に同時に効く

`addByPostInfo` の戻り値 `AddPostResult` は、呼び出し側が「投稿単位の欠落として続行してよい失敗」と「API 仕様への追随が必要な失敗」を区別できるように判別可能な形にしてある。各 variant の意味は型の JSDoc が SoT。

## コーディング規約

- Biome (recommended ルールセット) で強制。設定は `biome.json` が SoT
- JSDoc は日本語で書く
- **交差型の `}` と `& (` の間にコメントを置かない。** Biome が実行のたびに行順を並べ替えるため `bun run lint` が冪等でなくなり、CI の「lint / build 後に作業ツリーが汚れていないこと」の検査が必ず落ちる。型の説明は宣言の上の JSDoc に書く

## Git 運用

- コミットの author/committer は ValerianDillon であること
- **`gh pr create` は fork 元 (furubarug/download-helper) をデフォルトのベースリポジトリにする。** 必ず `--repo ValerianDillon/download-helper --base main` を指定する

## リリース手順

破壊的変更を含む PR をマージしたら、別 PR で version を上げる。

1. `package.json` の `version` を更新し、`release: vX.Y.Z` というタイトルで PR を出す
2. マージ後に `git tag vX.Y.Z && git push origin vX.Y.Z`
3. 利用側 2 リポジトリの `package.json` の tag 参照を更新する
