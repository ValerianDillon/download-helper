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

### 選択 UI 向けの読み取りビュー (Issue #49)

`DownloadObject.listPosts()` が収集済みの投稿を `PostSummary[]` として返す。
利用側が `Selection` を組み立てるための提示に使う。

- 内部表現の複製を返す。`PostObj` / `FileObj` をそのまま返すと、`readonly` を外した参照から収集結果を書き換えられ、`project()` の出力が UI の提示と食い違う。`key` だけは `freezeAssetKey` 済みなので共有する
- `html` / `info` / `url` は含めない。選択の提示に使わない値を公開 API に載せると利用側が収集結果をもう一部保持することになる (`info` は投稿 1 件分の情報ファイルの中身そのものなので特に大きい)
- `extension` は `normalizeExtension` を通した形。`Selection.extensions` とそのまま突き合わせられる
- カバーは `files` に混ぜず `cover` に分ける。拡張子の選択は `files` にだけ効き、カバーは `includeCover` だけで決まるという `Selection` の意味論に合わせる
- archive path は返さず、allocator も呼ばない。含めると選択が変わるたびに採番を走らせることになる

サイズを `DownloadManifest` に足す形は採らない。
ZIP に書き出すスキーマの変更になるうえ、選択画面は ZIP 生成の前に出るので manifest では間に合わない。

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

## picker より前の検証 (Issue #52)

`showSaveFilePicker` は**解決した時点で対象ファイルの中身を空にする**。
新規なら 0 バイトで作成し、既存ファイルを選べばその内容を消す (File System Access 仕様 3.4 の "Set entry's binary data to an empty byte sequence")。
保存先を確保してから入力の不備で落ちると、書くものが無いまま利用者のファイルだけが空になる。

そこで、入力の構造と archive 名から判定できる失敗を `DownloadHelper.preflight()` に集約した。

- `downloadZip` は自分で picker を開く場合、その前にこれを実行する
- `options.handle` を渡す利用側は自分で picker を呼ぶので、**その前に自分で `preflight()` を呼ぶ必要がある**
- `preflight()` は検証を通った入力 (`json`、渡したオブジェクトと同一)・manifest の写し・`encodedId` を返す。`downloadZip` はそれを受け取って使い、自分では計算し直さない

`downloadZip` の中で検証を二重に走らせないのは、値を返す getter を仕込んだ入力を 2 回読むことになり「検証を通った値」と「書き出される値」が食い違うため。
検証の条件を `preflight` と `downloadZip` に分けて持たない。
分けると、利用側が `preflight` を通しても picker の後で落ちる条件が生まれる。

**`options.handle` を渡す経路では `preflight` が 2 回走る** (利用側の事前実行と `downloadZip` 冒頭の実行)。
2 回の結果が一致することは、入力が素の値であることと、utils が返す名前が決定的であることに依る。

ZIP の上限のうち**入力の構造と archive 名から超過が確定するもの**もここで弾く。

- 完成形のエントリ名の UTF-8 バイト長 (カバー・添付も含む)
- 中断せずに完走した場合に固定で書かれるエントリ数 (ルート 3 件 + 投稿ごと 3 件)
- 同じエントリを名前と固定ヘッダだけで積んだ central directory の offset と size の**下限**

カバーと添付は取得に失敗すれば書かれないので件数とバイト数には積まない。
上限側で数えると、一部の取得が失敗すれば収まるダウンロードまで拒否することになる。
extra field と本体のバイト数も積まない。加算方向にしか効かないので、積まずに超えるなら実際の書き込みでも必ず超える。

**本文の大きさで上限に達する入力は通ってしまう。**
固定で書かれる本文 (ルート HTML・manifest・投稿ごとの情報ファイルと HTML) と日時 extra は入力から確定するが、積まない。
本文まで見積もり始めると生成物を丸ごと保持する形 (Issue #53 の snapshot 化) へ踏み込むことになり、この API の役割を超える。

**完成形のパス文字列は組み立てない。** 病的な入力では 64 KiB 級の文字列がエントリ数ぶん必要になり、検査そのものがメモリを食い潰す。
区切りの `/` を挟む連結なのでサロゲート対が分断されることはなく、部分ごとのバイト長を足した値は連結後のバイト長と一致する。

`central directory` の下限が上限を超えたかの判定は `assertZipUint32FieldWithinLimit` に委ねる。
`0xFFFFFFFF` 自体が ZIP64 の sentinel なので境界は `>=` であり、ここで比較を書き直すとちょうど上限の入力だけが picker 後に落ちる。

**archive 名は `preflight` が組み立てた書き込み計画 (`PostWritePlan`) を `downloadZip` がそのまま使う。**
書き込み時に `createInformationFile` や `encodeFileName` を呼び直すと、検証した名前と実際に書く名前が別々に決まる。
情報ファイル名は `DownloadUtils` が決めるので、アセット名と同じくパスセグメントとして検証し、投稿ディレクトリ直下の他の名前 (`index.html` / カバー / 添付) との衝突も見る。
予約名の検査は掛けない (`info.json` / `info.txt` はこの名前自身が予約されている側なので必ず落ちる)。
アセット同士の衝突は legacy allocator が作りうるものとして許容しているので、ここでは扱わない。

**`encodeFileName` と `createInformationFile` が返す名前は決定的であることを契約とする。**
利用側が自分で picker を開く経路では `preflight` が 2 回走るので、呼び出しごとに違う名前を返す実装を渡すと 2 回の結果が食い違い、事前検証を通ったのに保存先を確保した後で初めて失敗する。
通信やスリープを行う他のメソッドはこの要求の対象外である。

**picker の待機中に呼び出し側が入力を書き換えた場合までは守れない。**
`downloadZip` は待機の後にも投稿の並び・本文・URL を読む。
解決には入力を参照しない snapshot 化が要る (Issue #53)。

利用側が事前に通した結果を `downloadZip` へ渡して検証を省く口は用意しない。
渡された結果が本当にその入力から得たものかを `downloadZip` 側で確かめられず、「検証済み」を利用側の申告で信じることになる。

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
