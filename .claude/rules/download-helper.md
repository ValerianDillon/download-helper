---
paths:
  - 'download-helper.ts'
  - 'download-helper.test.ts'
---

# アセットの identity と archive path (Issue #41)

投稿内のアセットは `AssetKey` で一意に指す。通常のアセットは `{ kind: 'image' | 'file', assetId }` で、`assetId` は FANBOX が返す asset の `id`。カバーは `id` を持たないので `{ kind: 'cover' }` という投稿内一意の sentinel にする。

**配列位置や `encodeFileName` 後の名前を identity にしない。** 位置も名前も、収集後にアセットを間引くと別のアセットを指しうる。

archive path (ZIP 内の名前) を決めるのは `ArchivePathAllocator` だけである。

- `PostObj.html` は文字列ではなく `HtmlFragment[]`。リンクタグ生成はパス文字列を埋め込まず、アセットへの参照を持つ断片を返す
- 断片から archive path への解決は finalize の時点で行う。したがって HTML 内の参照と `DownloadJsonObj` の `files[].encodedName` / `cover.name` は定義上ずれない
- 従来の採番規則は `createLegacyArchivePathAllocator` として保持し、`DownloadObject` / `DownloadManage` の任意引数で差し替えられる

allocator が満たすべき契約と、finalize が検出できる範囲は `ArchivePathAllocator` の JSDoc が SoT。決定性と入力の非変更は戻り値だけでは判定できないので検出しない。

## 直さないと決めた既知の欠陥

いずれも legacy allocator の採番規則そのものに由来し、直すと出力が変わる。archive path を postId 由来に変える段階で扱う。

- 投稿内で archive 名が衝突する (`a` が 2 件と `a_1` が 1 件で `a_1.png` が 2 つ)。カバーは常に `cover.<ext>` なので、同名の添付や `cover` というタイトルの image 投稿とも衝突する
- 投稿ディレクトリ名も同じ形で衝突する
- `%` を含む archive 名は HTML の参照が実在しないファイルを指す。`encodeURI` が `%` 自体を符号化しないため

finalize では衝突を検出しない。legacy 自身が作れる衝突を例外にすると、`cover` というタイトルの投稿のような現実的な入力でダウンロード全体が落ち、いま得られている「1 ファイルだけ影に入った ZIP」より悪くなる。

# 選択条件からダウンロード対象を導出する (Issue #42)

`Selection` は「投稿の集合 (postId) × 拡張子の集合 × カバーを含めるか × 投稿本文を含めるか」の積 (AND) である。
カバーは「投稿が選択済み AND `includeCover`」で、拡張子の選択はカバーには適用しない。
投稿本文は「投稿が選択済み AND `includeBody`」で、添付やカバーを選ばなくても本文だけを保存できる。
`includeBody` を省略した既存の呼び出しは本文を含める。

`DownloadObject.project(selection, options?)` が `DownloadJsonObj` を返す。入力は変更せず、同じ入力と `Selection` に対して決定的。

- **選択で間引いても archive path を再採番しない。** 割り当ては選択前の全アセットから行い、`Selection` は出力に載せるかどうかだけに使う
- **finalize の契約検査は選択の可否によらず全投稿に対して行う。** 選択された投稿でだけ検査すると、入力の正当性が選択内容に依存してしまう
- root の `tags` は選択後の投稿に残っているものだけを出す。`setTags` の並び (支援額タグを先頭に置く) は保つ
- 「絞り込まずに全部落とす」も projection を経た結果として表す (`selectAll()`)。ZIP 入力の経路を 1 本にするため、`stringify()` は `project(selectAll())` に委譲する

## 選択 UI 向けの読み取りビュー (Issue #49)

`DownloadObject.listPosts()` が収集済みの投稿を `PostSummary[]` として返す。
利用側が `Selection` を組み立てるための提示に使う。

- 内部表現の複製を返す。`PostObj` / `FileObj` をそのまま返すと、`readonly` を外した参照から収集結果を書き換えられ、`project()` の出力が UI の提示と食い違う。`key` だけは `freezeAssetKey` 済みなので共有する
- `html` / `info` / `url` は含めない。選択の提示に使わない値を公開 API に載せると利用側が収集結果をもう一部保持することになる (`info` は投稿 1 件分の情報ファイルの中身そのものなので特に大きい)
- `extension` は `normalizeExtension` を通した形。`Selection.extensions` とそのまま突き合わせられる
- カバーは `files` に混ぜず `cover` に分ける。拡張子の選択は `files` にだけ効き、カバーは `includeCover` だけで決まるという `Selection` の意味論に合わせる
- archive path は返さず、allocator も呼ばない。含めると選択が変わるたびに採番を走らせることになる

サイズを `DownloadManifest` に足す形は採らない。
ZIP に書き出すスキーマの変更になるうえ、選択画面は ZIP 生成の前に出るので manifest では間に合わない。

## 収集結果の import/export

`DownloadObject.exportSnapshot()` は、選択前の収集結果を `DownloadObjectSnapshot` として返す。
`DownloadObject.fromSnapshot()` は JSON 往復後の値を検証し、通常どおり `listPosts()` と `project()` を使える `DownloadObject` に戻す。

`DownloadJsonObj` を import 元にはしない。
これは選択後の完成形であり、除外済みアセットの `AssetKey` と HTML 断片を持たないため、別の選択条件へ安全に導出し直せない。

snapshot は URL、投稿情報、HTML 断片、metadata、アセット identity を保持する。
archive path は保持せず、復元時に現在の利用側が `ArchivePathAllocator` を渡す。
差分ダウンロードの凍結名は利用側の履歴が所有する情報であり、収集結果へ混ぜない。

外部 JSON を受ける `fromSnapshot()` は、配列の hole、型、metadata の非負整数、本文アセット key の重複、HTML カードと参照先 key の一致、カード key が投稿のアセットとして存在することを検証する。
ルート HTML の creator link に入る URL は `#main` または有効な HTTP(S) URL に制限する。
snapshot の HTML 文字列は collector と helper が生成する静的なタグ・属性・URL scheme の部分集合に制限し、event handler や script を ZIP 内の HTML へ持ち込ませない。
返した snapshot と復元後の内部表現は参照を共有しない。

## 除外されたアセットの描画

カードごとプレースホルダーに差し替える。カードを消すと、後からアーカイブを見たときに元の投稿に何が含まれていたかが失われる。画像・動画・音声のカードは `src` でも参照するので、リンクを無効化するだけでは実在しないファイルを読みに行くカードが残る。

**アセットへの参照はカードの中にしか置けない。** カードの外に置けると、カードごと差し替えても参照だけが残る。参照先はそのカードの `key` に限り、`setHtml` が検証する。

投稿が持たないアセットを参照するカードは、通常の収集結果では finalize、外部 snapshot では import 時に例外にする。プレースホルダーで描くと「選択条件で外した」のか「登録し忘れた」のか区別できなくなる。

## download-manifest.json

ZIP ルートに書き出す。**アセットは投稿にネストする** — `postId` の一意性を保証しない以上、平坦に並べると同じ postId の投稿が 2 件あったときにどちらのものか分からなくなる。

- 主張するのは「plan に含めた」「選択条件で除外した」までで、「実際に書けた」とは主張しない
- URL は持たない。必要になれば `post.info` を取り直せば得られる
- 選択条件を `informationText` に混ぜない。`informationText` は収集時の内部表現で、選択条件はダウンロード実行側の情報なので、混ぜると出所が曖昧になる

`manifest` は projection を経た印でもある。`isDownloadJsonObj` がこれを必須にすることで、絞り込みを経ていないオブジェクトを ZIP 入力として受け付けない。印として働かせるには形だけでは足りないので、内容が JSON 側と対応することまで検証する (検証項目は `DownloadManifest` の JSDoc が SoT)。

`DownloadJsonObj.posts[].postId` と `bodyIncluded` は manifest の投稿および選択条件と突き合わせる。
`assetId` が実際の FANBOX アセットに結び付いていることや、`excluded` の網羅性・実在性は `DownloadJsonObj` 側に対応する値が無いので確かめられない。
突き合わせのためだけにアセット identity を JSON へ重複して写す設計は採らない。

manifest は「projection がこう記録した」ことを表すのであって、その全記録が実際の FANBOX レスポンスと一致することを ZIP の受け手が検証できるわけではない。

## post.json

各投稿ディレクトリには本文や添付の選択にかかわらず `post.json` を書く。
これは FANBOX の生レスポンスではなく、投稿 identity、日時、投稿タイプ、本文の保存有無、元アセット名と archive 名の対応を持つ安定したメタデータである。
本文だけを選ばなかった場合は `body.included=false` と `body.storedFilename=null` にする。
本文、添付、カバーのすべてが無い投稿は利用側の UI が選択対象から外すため、ライブラリは「選択された投稿には `post.json` を書く」という単純な契約を保つ。

## 入力の契約と読み出し

`DownloadJsonObj` は `project()` の出力か、それを `JSON.parse` した結果であることを契約とする。getter・`Array` の派生クラス・独自の `Symbol.iterator`・`toJSON` は含まれない前提で、任意のオブジェクトを安全に扱えるとは主張しない。

- `isDownloadJsonObj` は `unknown` を受ける型ガードなので、**manifest の検証は投稿の型検証を通してから行う**。先に行うと壊れた `posts` / `cover` を参照して例外を投げる
- `downloadZip` は **manifest を一度だけ読んで素の値に写し、その写しだけを検証と書き出しに使う**。検証と書き出しで別々に読むと両者を食い違わせられる
- 未知のプロパティは拒否しないが、書き出すのは検証済みのフィールドだけを写した canonical な manifest
- 配列は hole が無いことを確かめてから要素を見る。`every` / `some` / `reduce` は hole を飛ばす

# picker より前の検証 (Issue #52)

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
2 回の結果が一致することは、入力が素の値であることと、`encodeFileName` が決定的であることに依る。

ZIP の上限のうち、完成形のエントリ名が ZIP 仕様の UTF-8 65,535 bytes を超えることは archive 名だけで確定するため `preflight` で弾く。
エントリ数、offset、central directory の大きさは ZIP64 で表現できるため ZIP32 の上限では弾かない。

実際の `downloadZip` は WritableStream に直接書ける zip.js を使い、4 GiB を超えると ZIP64 へ自動移行する。
自前 `ZipWriter` は従来の境界条件とバイト列を固定する互換テストのために残し、ZIP 生成経路では使わない。

**完成形のパス文字列は組み立てない。** 病的な入力では 64 KiB 級の文字列がエントリ数ぶん必要になり、検査そのものがメモリを食い潰す。
区切りの `/` を挟む連結なのでサロゲート対が分断されることはなく、部分ごとのバイト長を足した値は連結後のバイト長と一致する。

**archive 名は `preflight` が組み立てた書き込み計画 (`PostWritePlan`) を `downloadZip` がそのまま使う。**
書き込み時に `encodeFileName` を呼び直すと、検証した名前と実際に書く名前が別々に決まる。
投稿メタデータ名は `post.json` に固定し、投稿ディレクトリ直下の他の名前 (`index.html` / カバー / 添付) との衝突も見る。
アセット同士の衝突は legacy allocator が作りうるものとして許容しているので、ここでは扱わない。

**`encodeFileName` が返す名前は決定的であることを契約とする。**
利用側が自分で picker を開く経路では `preflight` が 2 回走るので、呼び出しごとに違う名前を返す実装を渡すと 2 回の結果が食い違い、事前検証を通ったのに保存先を確保した後で初めて失敗する。
通信やスリープを行う他のメソッドはこの要求の対象外である。

**picker の待機中に呼び出し側が入力を書き換えた場合までは守れない。**
`downloadZip` は待機の後にも投稿の並び・本文・URL を読む。
解決には入力を参照しない snapshot 化が要る (Issue #53)。

利用側が事前に通した結果を `downloadZip` へ渡して検証を省く口は用意しない。
渡された結果が本当にその入力から得たものかを `downloadZip` 側で確かめられず、「検証済み」を利用側の申告で信じることになる。

# 対象単位の書き込み結果 (Issue #54)

`DownloadZipResult.assets` が、選択されたアセット 1 件ごとの結果を返す。
件数フィールドからは「どれを書けたか」が分からず、利用側 (差分ダウンロード) が保存実績を記録できない。

**`AssetKey` ではなく archive path で指す。**
`downloadZip` は書き込み時に identity を持っておらず、`DownloadJsonObj` 側 (`encodedName`) と `DownloadManifest` 側 (`assetId`) を突き合わせる手段は `(encodedName, originalName)` の組による多重集合の対応しかない。
legacy allocator が投稿内で archive 名を衝突させうる以上、これは一意性が保証された写像ではないので、実際に知っていること (どのパスに書けたか) だけを報告する。
`AssetKey` への対応付けは、allocator を決めた利用側が自分の allocator を逆に引いて行う。

`AssetKey` を `DownloadJsonObj` にも載せる案は採らない。
`manifest.included[].assetId` と同じ値を 2 箇所に置くことになり、identity の重複として退けた形と同じになる。

**結果は入力に対して網羅的にする。**
中断で到達しなかった対象も `skipped` として残す。
結果が無いことを「保存できていない」の代わりにすると、利用側が件数から推測することになる。

既存の件数フィールドは残す。対象単位の結果から導けるが、利用側が既に読んでいる。

`DownloadZipResult` は公開型なので、必須フィールドの追加は**構築している**利用側 (モックや fixture) を型エラーにする。読むだけの利用側と実行時の互換性には影響しなくても、メジャーで出す。

# ZIP のパス衝突

ルート直下の固定ファイル名 (`index.html` / `download-manifest.json`) と同名の投稿ディレクトリ、投稿ディレクトリ直下の固定ファイル名 (`index.html` / `post.json`) と同名のアセットは `downloadZip` が拒否する。
同じパスがファイルとディレクトリの両方になり、展開できない ZIP になるためである。

比較は大文字小文字を畳み、末尾の空白とピリオドを落としてから行う。Windows と既定の macOS は大文字小文字を区別せず、Windows は末尾の空白とピリオドを取り除いて解釈する。

legacy allocator のアセット同士の衝突を許容するのとは扱いが違う。あちらは 1 ファイルが影に入るだけだが、こちらはアーカイブ全体が壊れる。
