import { ZipWriter as ZipJsWriter } from '@zip.js/zip.js/lib/zip-core-writer.js';

/**
 * ダウンロード用のObject
 *
 * posts は収集順の配列で保持する。archive path の採番に使う「同名グループ」は allocator が
 * 組み立てる (ArchivePathAllocator)。内部表現がグループ構造を持つと、採番規則を知っている場所が
 * 増えて HTML とファイルパスの結合を切れないため。
 */
export type DownloadObj = { posts: PostObj[]; id: string };

/**
 * 投稿情報のObject
 *
 * files は収集順の配列。html は文字列ではなく断片列で、アセットへの参照は archive path ではなく
 * AssetKey で持つ (archive path が確定するのは allocator を通す finalize 時であり、
 * それ以前に文字列として埋め込むと採番の変化に追従できないため)。
 */
export type PostObj = {
  /**
   * FANBOX の postId。`Selection` が投稿を指すキーになる。
   *
   * 一意性は検証しない。同じ postId の投稿が 2 件登録された場合、選択は両方に同時に効く。
   * 一覧ページの重複などで同じ投稿が 2 回来ても収集を止めないことを優先する
   */
  postId: string;
  name: string;
  info: string;
  files: BodyFileObj[];
  html: HtmlFragment[];
  tags: string[];
  cover?: CoverFileObj;
  publishedDatetime?: string;
  updatedDatetime?: string;
  /** FANBOX の投稿タイプ。収集結果の絞り込み条件として利用側が読む (この層では使わない) */
  postType?: string;
};

/**
 * 収集済みの DownloadObject を、選択前の状態で持ち運ぶための JSON 形式。
 *
 * `DownloadJsonObj` は選択後の完成形なので、そこから添付を外しても HTML のアセット参照を
 * 作り直せない。この snapshot は `HtmlFragment` と `AssetKey` を保持し、import 後も通常の
 * `listPosts()` / `project()` を使えるようにする。
 */
export type DownloadObjectSnapshot = {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly url: string;
  /** `setTags` が呼ばれていなければ null。空配列とは区別する。 */
  readonly tags: readonly string[] | null;
  readonly posts: readonly {
    readonly postId: string;
    readonly name: string;
    readonly info: string;
    readonly files: readonly Readonly<BodyFileObj>[];
    readonly html: readonly HtmlFragment[];
    readonly tags: readonly string[];
    readonly cover?: Readonly<CoverFileObj>;
    readonly publishedDatetime?: string;
    readonly updatedDatetime?: string;
    readonly postType?: string;
  }[];
};

/**
 * 本文中のアセットの種別
 *
 * FANBOX が返すどのコレクション由来か (images / imageMap か、files / fileMap か) を表す。
 */
export type BodyAssetKind = 'image' | 'file';

/** アセットの種別。カバー画像は投稿に高々 1 つで、本文中のアセットとは別枠になる */
export type AssetKind = 'cover' | BodyAssetKind;

/**
 * 投稿内でアセットを一意に指す鍵
 *
 * 配列位置にも encodeFileName 後の名前にも依存しない。位置や名前を identity にすると、
 * 収集後にアセットを間引いたときに別のアセットを同一視しうる。
 * カバーは URL 文字列しか持たず id が無いため、投稿内で一意な sentinel として表す。
 */
export type BodyAssetKey = { readonly kind: BodyAssetKind; readonly assetId: string };

/** カバーを指す鍵。投稿に高々 1 つなので、識別子を持たない sentinel 1 種類しかない */
export type CoverAssetKey = { readonly kind: 'cover' };

/** 投稿内でアセットを一意に指す鍵。カバーは投稿に高々 1 つなので sentinel で表す */
export type AssetKey = CoverAssetKey | BodyAssetKey;

/**
 * AssetKey を凍結した複製にする。
 *
 * identity は登録後に変わってはならない。呼び出し側から渡された参照をそのまま持つと、
 * 追加後に書き換えられて、重複検査を通り抜けた 2 つのアセットが同じ archive path へ
 * 解決しうる。型の readonly は実行時には効かないので複製して凍結する。
 */
function freezeAssetKey<T extends AssetKey>(key: T): T {
  return Object.freeze(
    key.kind === 'cover' ? { kind: 'cover' as const } : { kind: key.kind, assetId: key.assetId },
  ) as T;
}

/**
 * AssetKey を Map のキーに使える文字列にする。
 * kind を前置するので、image と file で同じ assetId が来ても衝突しない。
 */
export function assetKeyToString(key: AssetKey): string {
  return key.kind === 'cover' ? 'cover' : `${key.kind}:${key.assetId}`;
}

/**
 * アセットの付随メタデータ
 *
 * いずれも API が返さないことがあるため optional。size は file 系にのみ存在し image 系には無く、
 * width / height はその逆である (実測 2026-08-22)。
 * 非負の安全な整数でない値は欠落として扱う (decoder が落とす)。
 */
export type AssetMetadata = {
  /** バイト数 (file 系のみ) */
  readonly size?: number;
  /** 画像の幅 (image 系のみ) */
  readonly width?: number;
  /** 画像の高さ (image 系のみ) */
  readonly height?: number;
};

/**
 * ファイル用のObject
 *
 * key はこのアセットの identity、metadata は情報表示や絞り込みに使う付随情報で、
 * どちらも archive path の採番には使わない。
 */
export type FileObj = {
  url: string;
  name: string;
  extension: string;
  key: AssetKey;
  metadata: AssetMetadata;
};

/** 本文中のアセット。カバーの sentinel は持たない (addFile の型の境界を allocator まで通す) */
export type BodyFileObj = FileObj & { readonly key: BodyAssetKey };

/** カバー画像。鍵は sentinel に限る (カバーの席に本文アセットを置けないようにする) */
export type CoverFileObj = FileObj & { readonly key: CoverAssetKey };

/**
 * PostObject.addFile に渡すアセット
 */
export type AssetInput = {
  /**
   * 本文アセットの鍵。カバーの sentinel は受け付けない。
   * 受け付けると、カバーと同じ鍵を持つ本文アセットが HTML でカバーのパスに解決され、
   * 実体は別名で出力される (参照と実体がずれる)
   */
  key: BodyAssetKey;
  name: string;
  extension: string;
  url: string;
  metadata?: AssetMetadata;
};

/**
 * アセット 1 件を表すカード全体の断片
 *
 * 選択条件で除外されたアセットは、カードごとプレースホルダーに差し替える。
 * 画像・動画・音声のカードは `src` でもアセットを参照するので、リンクを無効化するだけでは
 * 実在しないファイルを読みに行くカードが残る。
 *
 * `body` の中の `assetRef` はこのカードの `key` を指す。カードを丸ごと差し替えれば
 * 参照も一緒に消えるので、除外時に `body` を走査する必要はない。
 */
export type AssetCardFragment = {
  readonly key: AssetKey;
  readonly body: readonly CardBodyFragment[];
};

/**
 * カードの中身の断片
 *
 * `assetRef` はアセットへの参照で、finalize 時に allocator が割り当てた archive path へ解決する。
 * 参照はカードの中にしか置けない。カードの外に置けると、カードごとプレースホルダーへ差し替えても
 * 参照だけが残り、除外したはずのアセットを指す `src` / `href` が出力に出てしまう。
 * 参照先はそのカードの `key` に限る (`setHtml` が検証する)。
 */
export type CardBodyFragment = string | { readonly assetRef: AssetKey };

/**
 * 投稿 HTML の断片
 *
 * 文字列はそのまま出力する。`assetCard` はアセット 1 件のカード全体で、
 * 選択条件で除外されたときにプレースホルダーへ差し替える単位になる。
 */
export type HtmlFragment = string | { readonly assetCard: AssetCardFragment };

/**
 * 選択条件
 *
 * 投稿の集合 / 拡張子の集合 / カバーを含めるか、の 3 つの単純な積 (AND) である。
 * カバーは「投稿が選択済み AND `includeCover`」で、拡張子の選択はカバーには適用しない
 * (カバーは投稿の付随物であって添付の一種ではないため)。
 */
export type Selection = {
  /** 選択された投稿の postId */
  readonly postIds: ReadonlySet<string>;
  /** 選択された拡張子。`normalizeExtension` を通した形 (小文字、先頭ドット付き、無しは空文字列) */
  readonly extensions: ReadonlySet<string>;
  /** カバーを含めるか */
  readonly includeCover: boolean;
  /** 投稿本文の HTML を含めるか */
  readonly includeBody?: boolean;
};

/**
 * 拡張子を `Selection` と突き合わせられる形に正規化する。
 * FANBOX は同じ形式でも大文字と小文字が混ざるため、比較は小文字で行う
 * @param extension `FileObj.extension` (先頭ドット付き、または空文字列)
 */
export function normalizeExtension(extension: string): string {
  return extension.toLowerCase();
}

/**
 * 選択 UI 向けのアセットの読み取りビュー
 *
 * `FileObj` をそのまま返さない。URL は projection と ZIP 生成だけが使う値で、選択の提示には
 * 要らない。返すのは「どのアセットが、どういう名前と拡張子で、どれだけの大きさか」だけにする。
 */
export type AssetSummary<K extends AssetKey = AssetKey> = {
  /** アセットの identity。`FileObj.key` と同一の凍結済みオブジェクト */
  readonly key: K;
  /** 元のファイル名 (`encodeFileName` を通す前) */
  readonly name: string;
  /** `normalizeExtension` を通した拡張子。`Selection.extensions` とそのまま突き合わせられる */
  readonly extension: string;
  /**
   * 付随メタデータの複製。
   *
   * どのフィールドが入るかは `AssetMetadata` の型では区別されない。`fanbox-collector` が
   * 組み立てる値では `size` が file 系に、`width` / `height` が image 系に付く (実測 2026-08-22)。
   */
  readonly metadata: AssetMetadata;
};

/** 本文中のアセットの読み取りビュー。カバーの sentinel は持たない */
export type BodyAssetSummary = AssetSummary<BodyAssetKey>;

/** カバー画像の読み取りビュー。鍵は sentinel に限る */
export type CoverAssetSummary = AssetSummary<CoverAssetKey>;

/**
 * 選択 UI 向けの投稿の読み取りビュー
 *
 * カバーを `files` に混ぜないのは `Selection` の意味論に合わせるためである。拡張子の選択は
 * `files` にだけ効き、カバーは `includeCover` だけで決まる。混ぜて返すと利用側が毎回 `kind` で
 * 振り分けることになり、振り分け忘れがそのまま選択条件の誤りになる。
 *
 * `html` / `info` / `url` は含めない。選択の提示に使わない値を公開 API に載せると、利用側が
 * 収集結果をもう一部保持することになる (`info` は投稿 1 件分の情報ファイルの中身そのものなので
 * 特に大きい)。
 */
export type PostSummary = {
  readonly postId: string;
  readonly name: string;
  readonly tags: readonly string[];
  readonly files: readonly BodyAssetSummary[];
  readonly cover?: CoverAssetSummary;
  readonly publishedDatetime?: string;
  readonly updatedDatetime?: string;
  readonly postType?: string;
};

/**
 * `FileObj` を読み取りビューに写す。
 *
 * `key` は `freezeAssetKey` を通った凍結済みオブジェクトなので共有してよいが、`metadata` は
 * `addFile` の呼び出し側が渡したオブジェクトをそのまま保持している (`asset.metadata ?? {}`) ため
 * 複製する。
 * @param file 写す対象のアセット
 */
function summarizeAsset<T extends FileObj>(file: T): AssetSummary<T['key']> {
  return {
    key: file.key,
    name: file.name,
    extension: normalizeExtension(file.extension),
    metadata: { ...file.metadata },
  };
}

/**
 * `download-manifest.json` に書き出すアセットの記述
 *
 * `assetId` はカバー以外に付く (カバーは投稿に高々 1 つで id を持たない)。
 * `kind` と併せてアセットを投稿内で一意に指す
 */
export type ManifestAsset = {
  readonly originalName: string;
  readonly extension: string;
} & ({ readonly kind: 'cover' } | { readonly kind: BodyAssetKind; readonly assetId: string });

/**
 * 含めたアセットの記述。ZIP に入るので archive 名を持つ
 */
export type IncludedManifestAsset = ManifestAsset & { readonly archiveName: string };

/**
 * manifest に記録する投稿 1 件分
 *
 * アセットは投稿にネストする。postId の一意性を保証しない以上、アセットを平坦に並べると
 * 同じ postId の投稿が 2 件あったときにどちらのものか分からなくなる
 */
export type ManifestPost = {
  readonly postId: string;
  readonly archiveDirectory: string;
  readonly included: readonly IncludedManifestAsset[];
  /** 除外したアセットは ZIP に存在しないので archive 名を持たない */
  readonly excluded: readonly ManifestAsset[];
};

/**
 * ZIP ルートに書き出す `download-manifest.json` の内容
 *
 * この段階で主張するのは「plan に含めた」「選択条件で除外した」までで、「実際に書けた」とは
 * 主張しない。実行結果を対象単位で扱えるようになってから written / failed / aborted を足す。
 * URL は持たない (必要になれば post.info を取り直せば得られるし、保存量も減る)。
 *
 * `isDownloadJsonObj` が突き合わせられるのは、`DownloadJsonObj` 側にも現れる値だけである。
 * 次のものは対応する相手が無いので検証できない。
 *
 * - `postId` / `kind` / `assetId` / `extension` が実際の投稿・アセットに結び付いていること
 *   (投稿間で `postId` を入れ替えても、`assetId` を書き換えても通る)
 * - `excludedPosts` と各投稿の `excluded` の網羅性と実在性。除外された対象は ZIP にも JSON にも
 *   現れないので、消しても架空の対象を足しても通る
 * - 除外アセットと included なカバーの `originalName` (JSON 側のカバーは `url` と archive 名しか持たない)
 *
 * 突き合わせのためだけに identity を JSON 側へ写す設計は採らない。同じ値を 2 箇所に置いて
 * 一致を確かめる形になり、ずれたときにどちらが正しいのかを決められないため。
 * したがって manifest は「projection がこう記録した」ことを表すのであって、その記録が
 * 実際の収集結果と一致することを ZIP の受け手が検証できるわけではない。
 */
export type DownloadManifest = {
  readonly schemaVersion: 1;
  readonly creatorId: string;
  /** 生成日時 (ISO 8601) */
  readonly generatedAt: string;
  readonly selection: {
    readonly postIds: readonly string[];
    readonly extensions: readonly string[];
    readonly includeCover: boolean;
    readonly includeBody: boolean;
  };
  /** 選択された投稿。収集順。含めた / 除外したアセットをこの下に持つ */
  readonly posts: readonly ManifestPost[];
  /** 投稿ごと除外された投稿。アセットは個別に載せない (投稿単位で除外と分かる) */
  readonly excludedPosts: readonly { readonly postId: string }[];
};

/**
 * 断片列を区切り文字で連結する。
 *
 * parts の要素が空配列でも区切りは入れる (文字列連結時代の `[...].join(separator)` と同じ意味論。
 * 描画しない block が区切りごと消えると、前後の block の間隔が変わって出力が変わる)。
 */
export function joinHtmlFragments(parts: readonly HtmlFragment[][], separator: string): HtmlFragment[] {
  const joined: HtmlFragment[] = [];
  parts.forEach((part, index) => {
    if (index > 0) joined.push(separator);
    joined.push(...part);
  });
  return joined;
}

/**
 * ダウンロード用JSON元オブジェクト
 *
 * 値は `DownloadObject.project()` の出力か、それを `JSON.parse` した結果であることを契約とする。
 * したがって getter・`Array` の派生クラス・独自の `Symbol.iterator`・`toJSON` は含まれない。
 * 検証と書き出しはそれでも読み出しを 1 回に畳んで素の値に写すが (`snapshotManifest`)、
 * これは「検証したものと書き出すものを同一にする」ためであって、任意のオブジェクトを
 * 安全に扱えることを主張するものではない。
 */
export type DownloadJsonObj = {
  posts: {
    postId: string;
    originalName: string;
    encodedName: string;
    informationText: string;
    htmlText: string;
    bodyIncluded: boolean;
    files: { url: string; originalName: string; encodedName: string }[];
    tags: string[];
    cover?: { url: string; name: string };
    publishedDatetime?: string;
    updatedDatetime?: string;
    postType?: string;
  }[];
  id: string;
  url: string;
  tags: string[];
  fileCount: number;
  postCount: number;
  /**
   * projection が付ける。これが無い入力は downloadZip が受け付けない
   * (絞り込みを経ていないオブジェクトを ZIP にすると、HTML の参照と中身がずれうる)
   */
  manifest: DownloadManifest;
};

/**
 * projection の任意指定
 */
export type ProjectionOptions = {
  /** manifest の生成日時 (既定は現在時刻)。テストで固定するために注入できる */
  readonly now?: Date;
};

/**
 * ダウンロード用のUtilityクラス
 */
export class DownloadUtils {
  /**
   * 音声拡張子
   */
  audioExtension = /\.(mp3|m4a|ogg)$/;

  /**
   * 画像拡張子
   */
  imageExtension = /\.(apng|avif|gif|jpg|jpeg|jfif|pjpeg|pjp|png|svg|webp)$/;

  /**
   * 映像拡張子
   */
  videoExtension = /\.(mp4|webm|ogv)$/;

  /**
   * 音声ファイル判定
   * @param fileName 判定対象ファイル名
   */
  isAudio(fileName: string): boolean {
    return fileName.match(this.audioExtension) != null;
  }

  /**
   * 画像ファイル判定
   * @param fileName 判定対象ファイル名
   */
  isImage(fileName: string): boolean {
    return fileName.match(this.imageExtension) != null;
  }

  /**
   * 映像ファイル判定
   * @param fileName 判定対象ファイル名
   */
  isVideo(fileName: string): boolean {
    return fileName.match(this.videoExtension) != null;
  }

  /**
   * HTTP GET
   * @param url
   */
  httpGetAs<T = unknown>(url: string): T {
    const request = new XMLHttpRequest();
    request.open('GET', url, false);
    request.withCredentials = true;
    request.send(null);
    if (request.status < 200 || request.status >= 300) {
      throw new Error(`HTTP ${request.status}: ${url}`);
    }
    try {
      return JSON.parse(request.responseText) as T;
    } catch {
      throw new Error(`JSON parse error: ${url}`);
    }
  }

  /**
   * 保存するファイル名のエンコード
   * 主にwindowsで使えないファイル名のエスケープ処理をする
   * @param name ファイル名
   */
  encodeFileName(name: string): string {
    return name
      .replace(/\//g, '／')
      .replace(/\\/g, '＼')
      .replace(/,/g, '，')
      .replace(/:/g, '：')
      .replace(/\*/g, '＊')
      .replace(/"/g, '“')
      .replace(/</g, '＜')
      .replace(/>/g, '＞')
      .replace(/\|/g, '｜')
      .trim();
  }

  /**
   * URIのエンコード
   * @param name ファイル名
   */
  encodeURI(name: string): string {
    return this.encodeFileName(name).replaceAll(/[;,/?:@&=+$#]/g, encodeURIComponent);
  }

  /**
   * 拡張子の分割
   * @param name ファイル名
   */
  splitExt(name: string): string[] {
    return name.split(/(?=\.[^.]+$)/);
  }

  /**
   * 同一名の設定
   * @param name 名
   * @param extension 拡張子(.を含む)
   * @param length インデックスの最大値
   * @param index インデックス
   * @param isAsc 昇順か
   */
  getFileName(name: string, extension: string, length: number, index: number, isAsc: boolean): string {
    if (length <= 1) return `${name}${extension}`;
    return isAsc ? `${name}_${index + 1}${extension}` : `${name}_${length - index}${extension}`;
  }

  /**
   * quote
   * @param value quote対象
   */
  toQuoted(value: string): string {
    return `'${value.replaceAll("'", "\\'")}'`;
  }

  /**
   * HTMLエスケープ
   * @param value エスケープ対象
   */
  escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * テキストから投稿情報ファイルを作成する
   * @param informationText 元となるテキスト
   * @return name ファイル名, content ファイル内容
   */
  createInformationFile(informationText: string): { name: string; content: BlobPart[] } {
    try {
      const json = JSON.stringify(JSON.parse(informationText), null, '\t');
      return { name: 'info.json', content: [json] };
    } catch {
      return { name: 'info.txt', content: [informationText] };
    }
  }

  /**
   * timeoutによる疑似スリーブ
   * @param ms ミリ秒
   */
  async sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * リトライ回数付きfetch
   * @param url
   * @param filename
   * @param limit 失敗時のリトライ回数
   */
  async fetchWithLimit({ url, name }: { url: string; name: string }, limit: number): Promise<Blob | null> {
    if (limit < 0) return null;
    try {
      const blob = await fetch(url)
        .catch((e) => {
          throw new Error(e);
        })
        .then((r) => (r.ok ? r.blob() : null));
      return blob ? blob : await this.fetchWithLimit({ url, name }, limit - 1);
    } catch (_) {
      console.error(`通信エラー: ${name}, ${url}`);
      await this.sleep(1000);
      return await this.fetchWithLimit({ url, name }, limit - 1);
    }
  }

  /**
   * DOMによる外部スクリプト読み込み (importじゃだめなとき用)
   * @param url
   */
  async embedScript(url: string, integrity?: string) {
    const scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      if (integrity) {
        script.integrity = integrity;
        script.crossOrigin = 'anonymous';
      }
      script.onload = () => resolve(script);
      script.onerror = (e) => reject(e);
      document.head.appendChild(script);
    });
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Script load timeout: ${url}`)), 30000),
    );
    return Promise.race([scriptPromise, timeout]);
  }
}

/**
 * 外部入力 (FANBOX API のレスポンス) 由来のキーで引く辞書オブジェクトを作る。
 *
 * 通常の `{}` だと、キーが "__proto__" のとき (Object.prototype の accessor と衝突する)
 * `obj[key] = value` が実際にはプロトタイプを差し替えるだけで own property を作らず、
 * "constructor" のような他の Object.prototype 由来のキーでも `obj[key] === undefined` が
 * false になって初期化の分岐がスキップされる。結果、直後の `obj[key].push(...)` が
 * 継承したメソッドを持たない値 (Object.prototype 自身や Object コンストラクタ関数) に
 * 対して呼ばれ例外になる。投稿名・添付ファイル名は FANBOX API のレスポンスに由来する
 * 外部入力であり、このキーを回避できないため、プロトタイプを持たないオブジェクトにして
 * 経路ごと塞ぐ。
 *
 * 同じ理由の対策が必要な箇所は投稿名・添付ファイル名に限らない (API のマップ型は
 * どれもキーが外部入力である) ため、fanbox-collector からも使えるように export する。
 */
export function createNameKeyedDictionary<T>(): Record<string, T> {
  return Object.create(null);
}
/**
 * allocator に渡す投稿の読み取り専用ビュー
 *
 * 「引数を変更しない」は実装者が守る契約だが、可変の `PostObj` をそのまま渡すと
 * `post.files.reverse()` のような書き換えが型検査を素通りする。allocator が決めてよいのは
 * 名前と並び順だけなので、入力側も型で閉じる。
 */
export type ReadonlyPostObj = {
  readonly postId: string;
  readonly name: string;
  readonly info: string;
  readonly files: readonly Readonly<BodyFileObj>[];
  readonly html: readonly HtmlFragment[];
  readonly tags: readonly string[];
  readonly cover?: Readonly<CoverFileObj>;
  readonly publishedDatetime?: string;
  readonly updatedDatetime?: string;
  readonly postType?: string;
};

/**
 * 1 投稿分の archive path 割り当て結果
 */
export type AllocatedAssetPaths = {
  /**
   * DownloadJsonObj の files に出す順序で並べた、アセットの鍵と割り当て名の組。
   *
   * `FileObj` そのものではなく鍵を返させる。allocator が決めてよいのは名前と並び順だけで、
   * URL や元ファイル名は投稿が持つ値をそのまま出す。`FileObj` を返せる形にすると、
   * 同じ鍵のまま中身を差し替えたオブジェクトを返して出力を書き換えられる
   */
  files: { key: BodyAssetKey; archiveName: string }[];
  /** カバー画像の割り当て名。カバーが無ければ undefined */
  coverArchiveName?: string;
};

/**
 * archive path (ZIP 内の名前) の割り当て器
 *
 * 採番規則を知っている場所をここ 1 つに集約する。HTML の生成も JSON の files も
 * この結果だけを参照するので、規則を差し替えても両者がずれない。
 *
 * `stringify()` (finalize) が検出して例外にする契約は、1 回の呼び出しの戻り値だけで判定できる
 * 次の構造的条件である。黙って通すと、ZIP に入っているのに HTML から参照されないファイルや、
 * 参照先が別のアセットになったリンクが出力に残る。
 *
 * - `allocatePostDirectoryNames` は `posts` と同じ長さの、すべて文字列の配列を返す
 * - `allocateAssetPaths` は `post.files` の各アセットの鍵をちょうど 1 回返す (取りこぼしも重複も、
 *   その投稿に属さない鍵の混入も許さない)。`archiveName` は文字列である
 * - `post.cover` があるときに限り `coverArchiveName` を返す。返すなら文字列である
 * - 返す名前 (投稿ディレクトリ名 / `archiveName` / `coverArchiveName`) はすべて正規化済みである
 *   (`encodeFileName(name) === name`)。JSON と ZIP は名前をそのまま使うのに対し HTML の参照は
 *   `encodeURI` を通るので、正規化されていないと参照と実体がずれる
 *
 * 次の 2 つは戻り値だけでは判定できないので検出しない。実装者が守る契約である。
 *
 * - **決定的であること。** 同じ入力に対して同じ結果を返し、呼び出し回数に依存する状態
 *   (連番カウンタなど) を持たない。`stringify()` は呼ばれるたびに allocator を再実行する
 * - 引数の `posts` / `post` を変更しない
 *
 * 初回の割り当てを `DownloadObject` 側で覚え込む方法は採らない。投稿やアセットを追加してから
 * もう一度 `stringify()` したときに、追加分を反映しない古い採番を返すことになるためで、
 * こちらのほうが壊れ方として悪い (出力が黙って実態とずれる)。決定性は allocator の契約とする。
 */
export interface ArchivePathAllocator {
  /**
   * 投稿ディレクトリ名を割り当てる
   * @param posts 収集順の投稿
   * @returns posts と同じ長さ・同じ順序のディレクトリ名
   */
  allocatePostDirectoryNames(posts: readonly ReadonlyPostObj[]): string[];
  /**
   * 1 投稿内のアセットの archive path を割り当てる
   * @param post 対象の投稿
   */
  allocateAssetPaths(post: ReadonlyPostObj): AllocatedAssetPaths;
}

/**
 * 従来の採番規則をそのまま実装した allocator
 *
 * 同名グループの件数に依存して `_1` / `_2` を付ける (投稿ディレクトリは降順、投稿内アセットは昇順)。
 * グループの列挙順は Object.keys のそれに従う。ここは出力される files の並び順を決めるので、
 * 従来と同じ辞書を組み立てて同じ順で列挙する (整数に見えるキーが先に来る挙動も含めて再現する)。
 *
 * カバーの割り当て名は encodeFileName を通した名前と拡張子から作る。従来は情報 JSON の
 * cover.name だけが未エンコードで、HTML 側の参照はエンコード済みだったため、
 * `/` を含む拡張子のような入力で両者がずれていた (ZIP の事前検証で落ちる)。
 * 割り当てを 1 箇所にまとめる以上どちらかに寄せる必要があり、参照先が実在する方に揃える。
 */
export function createLegacyArchivePathAllocator(utils: DownloadUtils): ArchivePathAllocator {
  return {
    allocatePostDirectoryNames(posts: readonly ReadonlyPostObj[]): string[] {
      // キーは投稿名 (外部入力) なので '__proto__' がありうる。通常の {} だとプロトタイプへの
      // 代入になり、そのグループが黙って消える
      const groups = createNameKeyedDictionary<number[]>();
      posts.forEach((post, index) => {
        const key = utils.encodeFileName(post.name);
        const group = groups[key];
        if (group === undefined) {
          groups[key] = [index];
        } else {
          group.push(index);
        }
      });
      const names = new Array<string>(posts.length);
      for (const [key, indexes] of Object.entries(groups)) {
        indexes.forEach((postIndex, indexInGroup) => {
          names[postIndex] = utils.getFileName(key, '', indexes.length, indexInGroup, false);
        });
      }
      return names;
    },
    allocateAssetPaths(post: ReadonlyPostObj): AllocatedAssetPaths {
      const groups = createNameKeyedDictionary<Readonly<BodyFileObj>[]>();
      for (const file of post.files) {
        const key = utils.encodeFileName(file.name);
        const group = groups[key];
        if (group === undefined) {
          groups[key] = [file];
        } else {
          group.push(file);
        }
      }
      const files: AllocatedAssetPaths['files'] = [];
      for (const [key, group] of Object.entries(groups)) {
        group.forEach((file, indexInGroup) => {
          const extension = file.extension ? utils.encodeFileName(file.extension) : '';
          files.push({
            key: file.key,
            archiveName: utils.getFileName(key, extension, group.length, indexInGroup, true),
          });
        });
      }
      const cover = post.cover;
      return {
        files,
        coverArchiveName: cover
          ? utils.getFileName(utils.encodeFileName(cover.name), utils.encodeFileName(cover.extension), 1, 0, true)
          : undefined,
      };
    },
  };
}

/**
 * allocator が返した投稿ディレクトリ名が投稿と 1 対 1 に対応していることを確かめる。
 * 足りない要素や穴があると encodedName の無い投稿が JSON に出て、ZIP のパスが壊れる
 * @param names 割り当て結果
 * @param postCount 投稿数
 * @internal
 */
function assertPostDirectoryNames(names: string[], postCount: number, utils: DownloadUtils): void {
  if (names.length !== postCount) {
    throw new Error(
      `allocator が返した投稿ディレクトリ名の数が投稿と一致しません (期待 ${postCount}, 実際 ${names.length})`,
    );
  }
  for (let index = 0; index < postCount; index++) {
    const name = names[index];
    if (typeof name !== 'string') {
      throw new Error(`allocator が返した投稿ディレクトリ名が文字列ではありません (index ${index})`);
    }
    assertNormalizedArchiveName(name, utils, `投稿ディレクトリ名 (index ${index})`);
  }
  // 重複はここでは見ない。legacy allocator 自身が衝突を作れる (投稿名 a, a, a_1 で a_1 が 2 つ) ため、
  // 例外にすると現実的な入力で stringify が落ちる。downloadZip の事前検証が
  // showSaveFilePicker より前に弾くので、早期失敗にもならない
}

/**
 * archive 名が正規化済み (encodeFileName を通した結果と同じ) であることを確かめる。
 *
 * JSON と ZIP のパスは archive 名をそのまま使うのに対し、HTML の参照は encodeURI を通る。
 * encodeURI は URI 予約文字の百分率符号化だけでなく encodeFileName (全角置換と trim) も行うため、
 * 正規化されていない名前を許すと両者がずれる (例: `' a '` は JSON では `' a '`、HTML では `a`)。
 * encodeFileName は冪等なので、正規化済みの名前なら encodeURI の置換部分は恒等になる。
 *
 * ただし `%` を含む名前は正規化済みでもずれる。encodeURI が `%` 自体を符号化しないため、
 * `%2F.png` というファイル名の参照は `./%2F.png` になり、ブラウザが `/.png` として解決する
 * (正しくは `./%252F.png`)。従来からある欠陥で、直すと出力が変わるためここでは扱わない。
 * @param name 検証対象の archive 名
 * @param utils 正規化に使うユーティリティ
 * @param context エラーメッセージに含める対象の説明
 * @internal
 */
function assertNormalizedArchiveName(name: string, utils: DownloadUtils, context: string): void {
  if (utils.encodeFileName(name) !== name) {
    throw new Error(
      `allocator が返した${context}が正規化されていません (encodeFileName を通した結果と異なります): ${JSON.stringify(name)}`,
    );
  }
}

/**
 * ダウンロード用のオブジェクトラッパークラス
 */
export class DownloadObject {
  private readonly downloadObj: DownloadObj;
  private readonly utils: DownloadUtils;
  private readonly allocator: ArchivePathAllocator;
  private readonly orderedPosts: PostObject[] = [];
  private url = '#main';
  private tags: string[] | undefined;

  /**
   * @param id クリエイターID
   * @param utils ダウンロード用ユーティリティ
   * @param allocator archive path の割り当て器 (省略時は従来の採番規則)
   */
  constructor(id: string, utils: DownloadUtils, allocator?: ArchivePathAllocator) {
    this.downloadObj = { posts: [], id };
    this.utils = utils;
    this.allocator = allocator ?? createLegacyArchivePathAllocator(utils);
  }

  /**
   * 全件を選択した `Selection` を返す。
   * 「絞り込まずに全部落とす」も projection を経た結果として表す (ZIP 入力の経路を 1 本にする)
   */
  selectAll(): Selection {
    const postIds = new Set<string>();
    const extensions = new Set<string>();
    for (const post of this.downloadObj.posts) {
      postIds.add(post.postId);
      for (const file of post.files) {
        extensions.add(normalizeExtension(file.extension));
      }
    }
    return { postIds, extensions, includeCover: true, includeBody: true };
  }

  /**
   * 収集済みの投稿を選択 UI 向けの読み取りビューとして返す。
   *
   * 収集順で、内部表現の複製を返す。`PostObj` / `FileObj` をそのまま返すと、`readonly` を外した
   * 参照から収集結果を書き換えられ、`project()` の出力が UI の提示と食い違いうる。
   *
   * 呼び出しごとに新しい配列とオブジェクトを作る。`project()` と違って allocator を通さないので
   * archive path は含まれない (選択の提示に archive path は要らず、含めると選択のたびに
   * 採番を走らせることになる)。
   */
  listPosts(): PostSummary[] {
    return this.downloadObj.posts.map((post) => ({
      postId: post.postId,
      name: post.name,
      tags: [...post.tags],
      files: post.files.map((file) => summarizeAsset(file)),
      ...(post.cover ? { cover: summarizeAsset(post.cover) } : {}),
      ...(post.publishedDatetime !== undefined ? { publishedDatetime: post.publishedDatetime } : {}),
      ...(post.updatedDatetime !== undefined ? { updatedDatetime: post.updatedDatetime } : {}),
      ...(post.postType !== undefined ? { postType: post.postType } : {}),
    }));
  }

  /**
   * 選択前の収集結果を、JSON 直列化できる独立した snapshot として返す。
   *
   * 返した値を変更してもこの DownloadObject は変わらない。URL を含むため、利用側は
   * FANBOX の投稿情報と同じ機密性を持つファイルとして扱う必要がある。
   */
  exportSnapshot(): DownloadObjectSnapshot {
    return {
      schemaVersion: 1,
      id: this.downloadObj.id,
      url: this.url,
      tags: this.tags === undefined ? null : [...this.tags],
      posts: this.downloadObj.posts.map((post) => ({
        postId: post.postId,
        name: post.name,
        info: post.info,
        files: post.files.map((file) => cloneBodyFile(file)),
        html: post.html.map((fragment) => cloneHtmlFragment(fragment)),
        tags: [...post.tags],
        ...(post.cover ? { cover: cloneCoverFile(post.cover) } : {}),
        ...(post.publishedDatetime !== undefined ? { publishedDatetime: post.publishedDatetime } : {}),
        ...(post.updatedDatetime !== undefined ? { updatedDatetime: post.updatedDatetime } : {}),
        ...(post.postType !== undefined ? { postType: post.postType } : {}),
      })),
    };
  }

  /**
   * `exportSnapshot()` の JSON 往復結果から、選択可能な DownloadObject を復元する。
   *
   * 外部ファイルを受け取る入口なので、型だけでなくアセット identity、HTML 内参照、metadata を
   * 検証する。archive path の規則は snapshot に含めず、現在の利用側が allocator を渡す。
   * @param value `JSON.parse` した snapshot
   * @param utils 復元後に使うユーティリティ
   * @param allocator 現在の archive path 割り当て器
   */
  static fromSnapshot(value: unknown, utils: DownloadUtils, allocator?: ArchivePathAllocator): DownloadObject {
    let snapshot: DownloadObjectSnapshot;
    try {
      snapshot = decodeDownloadObjectSnapshot(value);
    } catch (error) {
      throw new Error(
        `DownloadObject snapshot を復元できません: ${error instanceof Error ? error.message : String(error)}`,
        {
          cause: error,
        },
      );
    }
    const result = new DownloadObject(snapshot.id, utils, allocator);
    result.url = snapshot.url;
    result.tags = snapshot.tags === null ? undefined : [...snapshot.tags];
    for (const source of snapshot.posts) {
      const post: PostObj = {
        postId: source.postId,
        name: source.name,
        info: source.info,
        files: source.files.map((file) => cloneBodyFile(file)),
        html: source.html.map((fragment) => freezeFragment(fragment)),
        tags: [...source.tags],
        ...(source.cover ? { cover: cloneCoverFile(source.cover) } : {}),
        ...(source.publishedDatetime !== undefined ? { publishedDatetime: source.publishedDatetime } : {}),
        ...(source.updatedDatetime !== undefined ? { updatedDatetime: source.updatedDatetime } : {}),
        ...(source.postType !== undefined ? { postType: source.postType } : {}),
      };
      result.downloadObj.posts.push(post);
      result.orderedPosts.push(new PostObject(post, utils));
    }
    return result;
  }

  /**
   * 選択条件からダウンロード対象を導出する。
   *
   * 入力は変更しない。同じ入力と `Selection` に対して決定的である
   * (`options.now` を渡せば `generatedAt` も含めて決まる)。
   * archive path は選択前の全アセットから割り当てるので、間引いても残った対象の名前は変わらない
   * @param selection 選択条件
   * @param options 生成日時の注入
   */
  project(selection: Selection, options?: ProjectionOptions): DownloadJsonObj {
    // archive path はここ (finalize) で初めて確定する。投稿ディレクトリ名は投稿をまたぐ採番なので
    // 全投稿を渡して一度に割り当てる
    const directoryNames = this.allocator.allocatePostDirectoryNames(this.downloadObj.posts);
    assertPostDirectoryNames(directoryNames, this.downloadObj.posts.length, this.utils);
    const includeBody = selection.includeBody !== false;

    const posts: DownloadJsonObj['posts'] = [];
    const manifestPosts: ManifestPost[] = [];
    const excludedPosts: { postId: string }[] = [];
    const presentTags = new Set<string>();
    let fileCount = 0;

    this.downloadObj.posts.forEach((postObj, index) => {
      if (!selection.postIds.has(postObj.postId)) {
        // 出力には使わないが、finalize の契約 (allocator の割り当てと HTML の参照先) は
        // 選択の可否によらず確かめる。選択された投稿でだけ検査すると、壊れた入力が
        // 選択次第で素通りする
        this.orderedPosts[index].assertFinalizeContract(this.allocator);
        // 投稿ごと除外された場合、そのアセットは個別に載せない (投稿単位で除外と分かる)
        excludedPosts.push({ postId: postObj.postId });
        return;
      }
      const includedKeys = new Set<string>();
      for (const file of postObj.files) {
        // 拡張子の選択は post.files に対するものであり、カバーには適用しない
        if (selection.extensions.has(normalizeExtension(file.extension))) {
          includedKeys.add(assetKeyToString(file.key));
        }
      }
      if (postObj.cover && selection.includeCover) {
        includedKeys.add('cover');
      }

      const projected = this.orderedPosts[index].projectPost(
        directoryNames[index],
        this.allocator,
        includedKeys,
        includeBody,
      );
      posts.push(projected.json);
      for (const tag of postObj.tags) {
        presentTags.add(tag);
      }
      // fileCount は選択された post.files の数。カバーは含めない (従来の countFile と同じ意味論)
      fileCount += projected.json.files.length;

      const included: IncludedManifestAsset[] = [];
      const excluded: ManifestAsset[] = [];
      const assets: FileObj[] = postObj.cover ? [...postObj.files, postObj.cover] : [...postObj.files];
      for (const file of assets) {
        const key = assetKeyToString(file.key);
        const identity =
          file.key.kind === 'cover' ? ({ kind: 'cover' } as const) : { kind: file.key.kind, assetId: file.key.assetId };
        const describe: ManifestAsset = { ...identity, originalName: file.name, extension: file.extension };
        const archiveName = projected.archiveNames.get(key);
        if (includedKeys.has(key) && archiveName !== undefined) {
          included.push({ ...describe, archiveName });
        } else {
          excluded.push(describe);
        }
      }
      manifestPosts.push({ postId: postObj.postId, archiveDirectory: directoryNames[index], included, excluded });
    });
    const downloadJson: DownloadJsonObj = {
      posts,
      id: this.downloadObj.id,
      url: this.url,
      // 選択後の投稿に残っているタグだけを出す。setTags の並び (支援額タグを先頭に置く) は保つ
      tags: (this.tags ?? [...presentTags]).filter((tag) => presentTags.has(tag)),
      postCount: posts.length,
      fileCount,
      manifest: {
        schemaVersion: 1,
        creatorId: this.downloadObj.id,
        generatedAt: (options?.now ?? new Date()).toISOString(),
        selection: {
          postIds: [...selection.postIds].sort(),
          extensions: [...selection.extensions].sort(),
          includeCover: selection.includeCover,
          includeBody,
        },
        posts: manifestPosts,
        excludedPosts,
      },
    };
    return downloadJson;
  }

  /**
   * 全件を選択した projection の結果を JSON 文字列にする
   * @param options 生成日時の注入
   */
  stringify(options?: ProjectionOptions): string {
    return JSON.stringify(this.project(this.selectAll(), options));
  }

  setUrl(url: string) {
    this.url = url;
  }

  setTags(tags: string[]) {
    this.tags = tags;
  }

  addPost(postId: string, name: string): PostObject {
    const postObj: PostObj = { postId, name, info: '', files: [], html: [], tags: [] };
    this.downloadObj.posts.push(postObj);
    const postObject = new PostObject(postObj, this.utils);
    this.orderedPosts.push(postObject);
    return postObject;
  }
}

/**
 * 断片を凍結した複製にする。カードは中身も再帰的に凍結する
 * @param fragment 対象の断片
 */
function freezeFragment(fragment: HtmlFragment): HtmlFragment {
  if (typeof fragment === 'string') return fragment;
  const assetCard = fragment.assetCard;
  const cardKey = assetKeyToString(assetCard.key);
  const body = assetCard.body.map((it) => {
    if (typeof it === 'string') return it;
    // 別のアセットを指す参照は、カードごと差し替えても残ってしまう
    if (assetKeyToString(it.assetRef) !== cardKey) {
      throw new Error(
        `カードの中の参照が別のアセットを指しています: ${assetKeyToString(it.assetRef)} (card: ${cardKey})`,
      );
    }
    return Object.freeze({ assetRef: freezeAssetKey(it.assetRef) });
  });
  return Object.freeze({
    assetCard: Object.freeze({ key: freezeAssetKey(assetCard.key), body: Object.freeze(body) }),
  });
}

function cloneMetadata(metadata: AssetMetadata): AssetMetadata {
  return { ...metadata };
}

function cloneBodyFile(file: Readonly<BodyFileObj>): BodyFileObj {
  return {
    key: freezeAssetKey(file.key),
    name: file.name,
    extension: file.extension,
    url: file.url,
    metadata: cloneMetadata(file.metadata),
  };
}

function cloneCoverFile(file: Readonly<CoverFileObj>): CoverFileObj {
  return {
    key: freezeAssetKey(file.key),
    name: file.name,
    extension: file.extension,
    url: file.url,
    metadata: cloneMetadata(file.metadata),
  };
}

function cloneHtmlFragment(fragment: HtmlFragment): HtmlFragment {
  return freezeFragment(fragment);
}

function snapshotRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`DownloadObject snapshot の ${path} が object ではありません`);
  }
  return value as Record<string, unknown>;
}

function snapshotString(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new Error(`DownloadObject snapshot の ${path} が string ではありません`);
  return value;
}

/** ルート HTML の creator link に入る URL を実行可能な scheme にしない。 */
function snapshotRootUrl(value: unknown, path: string): string {
  const url = snapshotString(value, path);
  if (url === '#main') return url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return url;
  } catch {
    // 下の共通エラーへ畳む。
  }
  throw new Error(`DownloadObject snapshot の ${path} が安全な HTTP(S) URL または #main ではありません`);
}

function snapshotOptionalString(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : snapshotString(value, path);
}

function decodeSnapshotArray<T>(value: unknown, path: string, decode: (item: unknown, path: string) => T): T[] {
  if (!Array.isArray(value)) throw new Error(`DownloadObject snapshot の ${path} が array ではありません`);
  const result: T[] = [];
  for (let index = 0; index < value.length; index++) {
    if (!(index in value)) throw new Error(`DownloadObject snapshot の ${path}[${index}] が欠落しています`);
    result.push(decode(value[index], `${path}[${index}]`));
  }
  return result;
}

function snapshotStringArray(value: unknown, path: string): string[] {
  return decodeSnapshotArray(value, path, snapshotString);
}

function snapshotMetadata(value: unknown, path: string): AssetMetadata {
  const record = snapshotRecord(value, path);
  const result: { size?: number; width?: number; height?: number } = {};
  for (const key of ['size', 'width', 'height'] as const) {
    const item = record[key];
    if (item === undefined) continue;
    if (typeof item !== 'number' || !Number.isSafeInteger(item) || item < 0) {
      throw new Error(`DownloadObject snapshot の ${path}.${key} が非負の安全な整数ではありません`);
    }
    result[key] = item;
  }
  return result;
}

function snapshotBodyKey(value: unknown, path: string): BodyAssetKey {
  const record = snapshotRecord(value, path);
  if (record.kind !== 'image' && record.kind !== 'file') {
    throw new Error(`DownloadObject snapshot の ${path}.kind が image/file ではありません`);
  }
  const assetId = snapshotString(record.assetId, `${path}.assetId`);
  if (assetId === '') throw new Error(`DownloadObject snapshot の ${path}.assetId が空です`);
  return freezeAssetKey({ kind: record.kind, assetId });
}

function snapshotAssetKey(value: unknown, path: string): AssetKey {
  const record = snapshotRecord(value, path);
  return record.kind === 'cover' ? freezeAssetKey({ kind: 'cover' }) : snapshotBodyKey(record, path);
}

function snapshotBodyFile(value: unknown, path: string): BodyFileObj {
  const record = snapshotRecord(value, path);
  return {
    key: snapshotBodyKey(record.key, `${path}.key`),
    name: snapshotString(record.name, `${path}.name`),
    extension: snapshotString(record.extension, `${path}.extension`),
    url: snapshotString(record.url, `${path}.url`),
    metadata: snapshotMetadata(record.metadata, `${path}.metadata`),
  };
}

function snapshotCoverFile(value: unknown, path: string): CoverFileObj {
  const record = snapshotRecord(value, path);
  const key = snapshotRecord(record.key, `${path}.key`);
  if (key.kind !== 'cover') throw new Error(`DownloadObject snapshot の ${path}.key.kind が cover ではありません`);
  return {
    key: freezeAssetKey({ kind: 'cover' }),
    name: snapshotString(record.name, `${path}.name`),
    extension: snapshotString(record.extension, `${path}.extension`),
    url: snapshotString(record.url, `${path}.url`),
    metadata: snapshotMetadata(record.metadata, `${path}.metadata`),
  };
}

const SNAPSHOT_HTML_VOID_TAGS = new Set(['br', 'img', 'path']);
const SNAPSHOT_HTML_SELF_CLOSING_TAGS = new Set(['audio', 'br', 'img', 'path', 'video']);
const SNAPSHOT_HTML_CLASSES = new Map<string, ReadonlySet<string>>([
  ['a', new Set(['hl'])],
  ['div', new Set(['card-header', 'post card', 'post card text-center'])],
  ['p', new Set(['pt-2'])],
  ['img', new Set(['card-img-top'])],
  ['audio', new Set(['card-img-top'])],
  ['video', new Set(['card-img-top'])],
  ['svg', new Set(['bi bi-box-arrow-up-left', 'bi bi-download'])],
]);
const SNAPSHOT_HTML_ALLOWED_ATTRIBUTES = new Map<string, ReadonlySet<string>>([
  ['a', new Set(['class', 'download', 'href', 'rel', 'target'])],
  ['div', new Set(['class'])],
  ['p', new Set(['class'])],
  ['img', new Set(['alt', 'class', 'src'])],
  ['audio', new Set(['class', 'controls', 'src'])],
  ['video', new Set(['class', 'controls', 'src'])],
  ['svg', new Set(['class', 'fill', 'height', 'viewbox', 'width', 'xmlns'])],
  ['path', new Set(['d', 'fill-rule'])],
  ['span', new Set()],
  ['h2', new Set()],
  ['h5', new Set()],
  ['br', new Set()],
]);

/** import した HTML 属性を、collector と helper が生成する静的な部分集合に制限する。 */
function assertSafeSnapshotHtmlAttribute(tag: string, name: string, value: string | undefined, path: string): void {
  const allowed = SNAPSHOT_HTML_ALLOWED_ATTRIBUTES.get(tag);
  if (!allowed?.has(name)) {
    throw new Error(`DownloadObject snapshot の ${path} に許可されていない HTML 属性 ${name} があります`);
  }
  if (name === 'controls') {
    if (value !== undefined) {
      throw new Error(`DownloadObject snapshot の ${path} の controls 属性に値があります`);
    }
    return;
  }
  if (value === undefined) {
    throw new Error(`DownloadObject snapshot の ${path} の ${name} 属性に値がありません`);
  }
  switch (name) {
    case 'class':
      if (!SNAPSHOT_HTML_CLASSES.get(tag)?.has(value)) {
        throw new Error(`DownloadObject snapshot の ${path} に許可されていない class があります`);
      }
      break;
    case 'href':
    case 'src':
      if (!/^(?:https?:\/\/|\.\/|#)/i.test(value)) {
        throw new Error(`DownloadObject snapshot の ${path} に安全でない ${name} があります`);
      }
      break;
    case 'target':
      if (value !== '_blank') throw new Error(`DownloadObject snapshot の ${path} の target が _blank ではありません`);
      break;
    case 'rel':
      if (value !== 'noopener noreferrer') {
        throw new Error(`DownloadObject snapshot の ${path} の rel が noopener noreferrer ではありません`);
      }
      break;
    case 'xmlns':
      if (value !== 'http://www.w3.org/2000/svg') {
        throw new Error(`DownloadObject snapshot の ${path} の xmlns が SVG 名前空間ではありません`);
      }
      break;
    case 'width':
    case 'height':
      if (value !== '16') throw new Error(`DownloadObject snapshot の ${path} の ${name} が 16 ではありません`);
      break;
    case 'fill':
      if (value !== 'currentColor') {
        throw new Error(`DownloadObject snapshot の ${path} の fill が currentColor ではありません`);
      }
      break;
    case 'viewbox':
      if (value !== '0 0 16 16') {
        throw new Error(`DownloadObject snapshot の ${path} の viewBox が 0 0 16 16 ではありません`);
      }
      break;
    case 'fill-rule':
      if (value !== 'evenodd') {
        throw new Error(`DownloadObject snapshot の ${path} の fill-rule が evenodd ではありません`);
      }
      break;
    case 'd':
      if (!/^[A-Za-z0-9., +-]*$/.test(value)) {
        throw new Error(`DownloadObject snapshot の ${path} の SVG path data が不正です`);
      }
      break;
  }
}

/** import した HTML を構文走査し、実行可能な要素・属性を通さない。 */
function assertSafeSnapshotHtml(html: string, path: string): void {
  const stack: string[] = [];
  let cursor = 0;
  while (cursor < html.length) {
    const start = html.indexOf('<', cursor);
    if (start === -1) break;
    const end = html.indexOf('>', start + 1);
    if (end === -1) throw new Error(`DownloadObject snapshot の ${path} に閉じていない HTML タグがあります`);
    const token = html.slice(start, end + 1);
    const closing = token.match(/^<\/([A-Za-z][A-Za-z0-9]*)\s*>$/);
    if (closing) {
      const tag = closing[1].toLowerCase();
      if (!SNAPSHOT_HTML_ALLOWED_ATTRIBUTES.has(tag) || stack.pop() !== tag) {
        throw new Error(`DownloadObject snapshot の ${path} の HTML タグ対応が不正です`);
      }
      cursor = end + 1;
      continue;
    }
    const opening = token.match(/^<([A-Za-z][A-Za-z0-9]*)([\s\S]*?)(\/?)>$/);
    if (!opening) throw new Error(`DownloadObject snapshot の ${path} に不正な HTML タグがあります`);
    const tag = opening[1].toLowerCase();
    if (!SNAPSHOT_HTML_ALLOWED_ATTRIBUTES.has(tag)) {
      throw new Error(`DownloadObject snapshot の ${path} に許可されていない HTML タグ ${tag} があります`);
    }
    const attributes = opening[2];
    const seenAttributes = new Set<string>();
    const attributePattern = /\s+([A-Za-z_:][A-Za-z0-9_.:-]*)(?:="([^"]*)")?/gy;
    let attributeCursor = 0;
    while (attributeCursor < attributes.length) {
      if (/^\s*$/.test(attributes.slice(attributeCursor))) {
        attributeCursor = attributes.length;
        break;
      }
      attributePattern.lastIndex = attributeCursor;
      const attribute = attributePattern.exec(attributes);
      if (!attribute) throw new Error(`DownloadObject snapshot の ${path} に不正な HTML 属性があります`);
      const name = attribute[1].toLowerCase();
      if (seenAttributes.has(name)) {
        throw new Error(`DownloadObject snapshot の ${path} に重複した HTML 属性 ${name} があります`);
      }
      seenAttributes.add(name);
      assertSafeSnapshotHtmlAttribute(tag, name, attribute[2], path);
      attributeCursor = attributePattern.lastIndex;
    }
    const selfClosing = opening[3] === '/';
    if (selfClosing && !SNAPSHOT_HTML_SELF_CLOSING_TAGS.has(tag)) {
      throw new Error(`DownloadObject snapshot の ${path} の ${tag} は自己終了できません`);
    }
    if (!selfClosing && !SNAPSHOT_HTML_VOID_TAGS.has(tag)) stack.push(tag);
    cursor = end + 1;
  }
  if (stack.length > 0) throw new Error(`DownloadObject snapshot の ${path} に閉じていない HTML タグがあります`);
}

/** HTML を安全性とアセット参照の両面で、復元前にまとめて検証する。 */
function assertSnapshotHtmlContracts(
  html: readonly HtmlFragment[],
  assetKeys: ReadonlySet<string>,
  path: string,
): void {
  const rendered = html
    .flatMap((fragment) => {
      if (typeof fragment === 'string') return [fragment];
      const identity = assetKeyToString(fragment.assetCard.key);
      if (!assetKeys.has(identity)) {
        throw new Error(`DownloadObject snapshot の ${path} が投稿に存在しないアセット ${identity} を参照しています`);
      }
      return fragment.assetCard.body.map((part) => (typeof part === 'string' ? part : './snapshot-asset'));
    })
    .join('');
  assertSafeSnapshotHtml(rendered, path);
}

function snapshotHtmlFragment(value: unknown, path: string): HtmlFragment {
  if (typeof value === 'string') return value;
  const record = snapshotRecord(value, path);
  const card = snapshotRecord(record.assetCard, `${path}.assetCard`);
  const key = snapshotAssetKey(card.key, `${path}.assetCard.key`);
  const body = decodeSnapshotArray(card.body, `${path}.assetCard.body`, (item, itemPath): CardBodyFragment => {
    if (typeof item === 'string') return item;
    const ref = snapshotRecord(item, itemPath);
    return { assetRef: snapshotAssetKey(ref.assetRef, `${itemPath}.assetRef`) };
  });
  return freezeFragment({ assetCard: { key, body } });
}

/** 外部 JSON から snapshot を検証済みの素の値へ写す。 */
function decodeDownloadObjectSnapshot(value: unknown): DownloadObjectSnapshot {
  const root = snapshotRecord(value, 'root');
  if (root.schemaVersion !== 1) throw new Error('DownloadObject snapshot の schemaVersion が 1 ではありません');
  const tags = root.tags === null ? null : snapshotStringArray(root.tags, 'tags');
  const posts = decodeSnapshotArray(root.posts, 'posts', (item, path) => {
    const post = snapshotRecord(item, path);
    const files = decodeSnapshotArray(post.files, `${path}.files`, snapshotBodyFile);
    const seen = new Set<string>();
    for (const file of files) {
      const identity = assetKeyToString(file.key);
      if (seen.has(identity))
        throw new Error(`DownloadObject snapshot の ${path}.files に重複した ${identity} があります`);
      seen.add(identity);
    }
    const cover = post.cover === undefined ? undefined : snapshotCoverFile(post.cover, `${path}.cover`);
    if (cover !== undefined) seen.add(assetKeyToString(cover.key));
    const html = decodeSnapshotArray(post.html, `${path}.html`, snapshotHtmlFragment);
    assertSnapshotHtmlContracts(html, seen, `${path}.html`);
    const publishedDatetime = snapshotOptionalString(post.publishedDatetime, `${path}.publishedDatetime`);
    const updatedDatetime = snapshotOptionalString(post.updatedDatetime, `${path}.updatedDatetime`);
    const postType = snapshotOptionalString(post.postType, `${path}.postType`);
    return {
      postId: snapshotString(post.postId, `${path}.postId`),
      name: snapshotString(post.name, `${path}.name`),
      info: snapshotString(post.info, `${path}.info`),
      files,
      html,
      tags: snapshotStringArray(post.tags, `${path}.tags`),
      ...(cover === undefined ? {} : { cover }),
      ...(publishedDatetime === undefined ? {} : { publishedDatetime }),
      ...(updatedDatetime === undefined ? {} : { updatedDatetime }),
      ...(postType === undefined ? {} : { postType }),
    };
  });
  return {
    schemaVersion: 1,
    id: snapshotString(root.id, 'id'),
    url: snapshotRootUrl(root.url, 'url'),
    tags,
    posts,
  };
}

/**
 * 1 投稿分の projection 結果
 */
export type ProjectedPost = {
  readonly json: DownloadJsonObj['posts'][number];
  /** 投稿の全アセット (除外分を含む) の archive 名。manifest の組み立てに使う */
  readonly archiveNames: ReadonlyMap<string, string>;
};

/**
 * リンクタグの断片列をアセット 1 件のカードとして包む。
 * 選択条件で除外されたときに、カード全体をプレースホルダーへ差し替えられるようにする
 * @param fileObject 対象のアセット
 * @param body カードの中身
 */
function card(fileObject: FileObject, body: CardBodyFragment[]): HtmlFragment[] {
  return [{ assetCard: { key: fileObject.getKey(), body } }];
}

/**
 * 投稿情報オブジェクトラッパークラス
 */
export class PostObject {
  private readonly postObj: PostObj;
  private readonly utils: DownloadUtils;

  constructor(postObj: PostObj, utils: DownloadUtils) {
    this.postObj = postObj;
    this.utils = utils;
  }

  setInfo(info: string) {
    this.postObj.info = info;
  }

  /**
   * 投稿 HTML の断片列を設定する。
   *
   * 断片も AssetKey を運ぶので、配列ごと複製して参照を凍結する。呼び出し側が保持している
   * 鍵を後から書き換えられると、解決先が別のアセットに変わるか、解決できずに finalize が落ちる。
   * @param html 断片列
   */
  setHtml(html: HtmlFragment[]) {
    this.postObj.html = html.map((fragment) => freezeFragment(fragment));
  }

  setTags(tags: string[]) {
    this.postObj.tags = tags;
  }

  setPublishedDatetime(iso: string) {
    this.postObj.publishedDatetime = iso;
  }

  setUpdatedDatetime(iso: string) {
    this.postObj.updatedDatetime = iso;
  }

  /**
   * FANBOX の投稿タイプを保持する。この層では使わず、利用側の絞り込み条件のために持つ
   * @param type 投稿タイプ
   */
  setPostType(type: string) {
    this.postObj.postType = type;
  }

  setCover(name: string, extension: string, url: string): FileObject {
    const fileObj: CoverFileObj = {
      name,
      extension: extension ? `.${extension}` : '',
      url,
      key: freezeAssetKey({ kind: 'cover' }),
      metadata: {},
    };
    this.postObj.cover = fileObj;
    return new FileObject(fileObj, this.utils);
  }

  /**
   * 投稿内のアセットを追加する
   *
   * key は投稿内で一意でなければならない (重複すると HTML の参照が別のアセットへ解決しうる)。
   * 呼び出し側の decoder が事前に重複を弾く契約なので、ここでの検出は契約違反として例外にする。
   * @param asset 追加するアセット
   */
  addFile(asset: AssetInput): FileObject {
    // 型では弾いているが、JS からの呼び出しでは通るので実行時にも拒否する
    if ((asset.key as AssetKey).kind === 'cover') {
      throw new Error('addFile: cover の AssetKey は本文アセットに使えません (カバーは setCover が持つ)');
    }
    const duplicated = this.postObj.files.some((it) => assetKeyToString(it.key) === assetKeyToString(asset.key));
    if (duplicated) {
      throw new Error(`asset key is duplicated: ${assetKeyToString(asset.key)}`);
    }
    const fileObj: BodyFileObj = {
      name: asset.name,
      extension: asset.extension ? `.${asset.extension}` : '',
      url: asset.url,
      key: freezeAssetKey(asset.key),
      metadata: asset.metadata ?? {},
    };
    this.postObj.files.push(fileObj);
    return new FileObject(fileObj, this.utils);
  }

  getAutoAssignedLinkTag(fileObject: FileObject): HtmlFragment[] {
    const ext = fileObject.getEncodedExtension();
    switch (true) {
      case this.utils.isAudio(ext):
        return this.getAudioLinkTag(fileObject);
      case this.utils.isImage(ext):
        return this.getImageLinkTag(fileObject);
      case this.utils.isVideo(ext):
        return this.getVideoLinkTag(fileObject);
      default:
        return this.getFileLinkTag(fileObject);
    }
  }

  getAudioLinkTag(fileObject: FileObject): HtmlFragment[] {
    const ref: CardBodyFragment = { assetRef: fileObject.getKey() };
    const escapedDownload = this.utils.escapeHtml(fileObject.getEncodedName() + fileObject.getEncodedExtension());
    return card(fileObject, [
      `<a class="hl" href="`,
      ref,
      `" download="${escapedDownload}"><div class="post card">\n` +
        `<div class="card-header">${this.utils.escapeHtml(fileObject.getOriginalName())}</div>\n` +
        `<audio class="card-img-top" src="`,
      ref,
      `" controls/>\n</div></a>`,
    ]);
  }

  getLinkTag(url: string, title: string): HtmlFragment[] {
    return [
      `<a class="hl" href="${this.utils.escapeHtml(url)}"><div class="post card text-center"><p class="pt-2">\n` +
        `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-box-arrow-up-left" viewBox="0 0 16 16">\n` +
        `<path fill-rule="evenodd" d="M7.364 3.5a.5.5 0 0 1 .5-.5H14.5A1.5 1.5 0 0 1 16 4.5v10a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 3 14.5V7.864a.5.5 0 1 1 1 0V14.5a.5.5 0 0 0 .5.5h10a.5.5 0 0 0 .5-.5v-10a.5.5 0 0 0-.5-.5H7.864a.5.5 0 0 1-.5-.5z"/>\n` +
        `<path fill-rule="evenodd" d="M0 .5A.5.5 0 0 1 .5 0h5a.5.5 0 0 1 0 1H1.707l8.147 8.146a.5.5 0 0 1-.708.708L1 1.707V5.5a.5.5 0 0 1-1 0v-5z"/>\n` +
        `</svg> ${this.utils.escapeHtml(title)}</p></div></a>`,
    ];
  }

  getFileLinkTag(fileObject: FileObject): HtmlFragment[] {
    const ref: CardBodyFragment = { assetRef: fileObject.getKey() };
    const escapedDownload = this.utils.escapeHtml(fileObject.getEncodedName() + fileObject.getEncodedExtension());
    return card(fileObject, [
      `<a class="hl" href="`,
      ref,
      `" download="${escapedDownload}">` +
        `<div class="post card text-center"><p class="pt-2">\n` +
        `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-download" viewBox="0 0 16 16">\n` +
        `<path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>\n` +
        `<path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>\n` +
        `</svg> ${this.utils.escapeHtml(fileObject.getOriginalName() + fileObject.getOriginalExtension())}</p></div></a>`,
    ]);
  }

  getImageLinkTag(fileObject: FileObject): HtmlFragment[] {
    const ref: CardBodyFragment = { assetRef: fileObject.getKey() };
    const escapedDownload = this.utils.escapeHtml(fileObject.getEncodedName() + fileObject.getEncodedExtension());
    return card(fileObject, [
      `<a class="hl" href="`,
      ref,
      `" download="${escapedDownload}"><div class="post card">\n<img class="card-img-top" src="`,
      ref,
      `" alt="${this.utils.escapeHtml(fileObject.getOriginalName())}"/>\n</div></a>`,
    ]);
  }

  getVideoLinkTag(fileObject: FileObject): HtmlFragment[] {
    const ref: CardBodyFragment = { assetRef: fileObject.getKey() };
    const escapedDownload = this.utils.escapeHtml(fileObject.getEncodedName() + fileObject.getEncodedExtension());
    return card(fileObject, [
      `<a class="hl" href="`,
      ref,
      `" download="${escapedDownload}"><div class="post card">\n<video class="card-img-top" src="`,
      ref,
      `" controls/>\n</div></a>`,
    ]);
  }

  /**
   * 割り当て済みの archive path を使って JSON 出力用のオブジェクトにする
   * @param directoryName この投稿に割り当てられたディレクトリ名
   * @param allocator 投稿内アセットの割り当て器
   */
  /**
   * 割り当て済みの archive path を使って JSON 出力用のオブジェクトにする。
   *
   * archive path は投稿の全アセットから割り当てる。選択で間引いた後の件数で採番し直すと
   * HTML 内の参照と一致しなくなるため、`includedKeys` は出力に載せるかどうかだけに使う
   * @param directoryName この投稿に割り当てられたディレクトリ名
   * @param allocator 投稿内アセットの割り当て器
   * @param includedKeys 出力に含めるアセット (assetKeyToString)
   */
  projectPost(
    directoryName: string,
    allocator: ArchivePathAllocator,
    includedKeys: ReadonlySet<string>,
    includeBody: boolean,
  ): ProjectedPost {
    const { allocation, fileByKey, assetByKey } = this.allocateAssets(allocator);
    const pathByKey = new Map<string, string>();
    for (const { key, archiveName } of allocation.files) {
      pathByKey.set(assetKeyToString(key), archiveName);
    }
    if (this.postObj.cover) {
      pathByKey.set('cover', allocation.coverArchiveName as string);
    }
    const cover =
      this.postObj.cover && includedKeys.has('cover')
        ? { url: this.postObj.cover.url, name: allocation.coverArchiveName as string }
        : undefined;
    return {
      json: {
        postId: this.postObj.postId,
        originalName: this.postObj.name,
        encodedName: directoryName,
        informationText: this.postObj.info,
        htmlText: this.resolveHtml(pathByKey, includedKeys, assetByKey),
        bodyIncluded: includeBody,
        // URL と元ファイル名は投稿が持つ値から取る。allocator が決めるのは名前と並び順だけ
        files: allocation.files
          .filter(({ key }) => includedKeys.has(assetKeyToString(key)))
          .map(({ key, archiveName }) => {
            // biome-ignore lint/style/noNonNullAssertion: assertAllocationCoversAssets が存在を保証する
            const file = fileByKey.get(assetKeyToString(key))!;
            return { url: file.url, originalName: file.name, encodedName: archiveName };
          }),
        // 戻り値の変更が入力へ逆流しないよう複製する (projection は純粋変換として公開する)
        tags: [...this.postObj.tags],
        cover,
        publishedDatetime: this.postObj.publishedDatetime,
        updatedDatetime: this.postObj.updatedDatetime,
        postType: this.postObj.postType,
      },
      archiveNames: pathByKey,
    };
  }

  /**
   * allocator にこの投稿のアセットを割り当てさせ、契約を満たしていることを確かめる
   * @param allocator 投稿内アセットの割り当て器
   */
  private allocateAssets(allocator: ArchivePathAllocator): {
    allocation: AllocatedAssetPaths;
    fileByKey: Map<string, BodyFileObj>;
    assetByKey: Map<string, FileObj>;
  } {
    const allocation = allocator.allocateAssetPaths(this.postObj);
    const fileByKey = new Map(this.postObj.files.map((it) => [assetKeyToString(it.key), it] as const));
    this.assertAllocationCoversAssets(allocation, fileByKey);
    const assetByKey = new Map<string, FileObj>(fileByKey);
    if (this.postObj.cover) {
      assetByKey.set('cover', this.postObj.cover);
    }
    this.assertHtmlReferencesKnownAssets(assetByKey);
    return { allocation, fileByKey, assetByKey };
  }

  /**
   * 出力に使わない投稿についても finalize の契約を確かめる。
   *
   * 選択された投稿でだけ検査すると、入力の正当性が選択内容に依存してしまう
   * @param allocator 投稿内アセットの割り当て器
   */
  assertFinalizeContract(allocator: ArchivePathAllocator): void {
    this.allocateAssets(allocator);
  }

  /**
   * allocator の結果が投稿のアセットと 1 対 1 に対応していることを確かめる。
   *
   * 取りこぼしはファイルの欠落、重複や余分は参照先の取り違えになるが、どちらも出力を見ただけでは
   * 気付けない (ZIP は生成され、HTML も壊れて見えない)。finalize で止める。
   * @param allocation 割り当て結果
   * @param fileByKey 投稿が持つアセットを鍵で引ける形にしたもの
   */
  private assertAllocationCoversAssets(allocation: AllocatedAssetPaths, fileByKey: ReadonlyMap<string, FileObj>): void {
    const expected = new Set(fileByKey.keys());
    if (allocation.files.length !== this.postObj.files.length) {
      throw new Error(
        `allocator が返したアセット数が投稿と一致しません (期待 ${this.postObj.files.length}, 実際 ${allocation.files.length})`,
      );
    }
    for (const { key, archiveName } of allocation.files) {
      if (!expected.delete(assetKeyToString(key))) {
        throw new Error(
          `allocator が投稿に属さないアセット、または重複したアセットを返しました: ${assetKeyToString(key)}`,
        );
      }
      if (typeof archiveName !== 'string') {
        throw new Error(`allocator が返した archive 名が文字列ではありません: ${assetKeyToString(key)}`);
      }
      assertNormalizedArchiveName(archiveName, this.utils, `archive 名 (${assetKeyToString(key)})`);
    }
    if (allocation.coverArchiveName !== undefined) {
      if (typeof allocation.coverArchiveName !== 'string') {
        throw new Error('allocator が返したカバーの archive 名が文字列ではありません');
      }
      assertNormalizedArchiveName(allocation.coverArchiveName, this.utils, 'カバーの archive 名');
    }
    if ((this.postObj.cover !== undefined) !== (allocation.coverArchiveName !== undefined)) {
      throw new Error(
        this.postObj.cover === undefined
          ? 'allocator がカバーの無い投稿に coverArchiveName を返しました'
          : 'allocator がカバーのある投稿に coverArchiveName を返しませんでした',
      );
    }
  }

  /**
   * HTML のカードが、投稿が実際に持つアセットだけを参照していることを確かめる。
   *
   * 参照先が無いカードを除外扱いにしてプレースホルダーで描くと、「選択条件で外した」のか
   * 「アセットを登録し忘れた」のか区別できなくなる。後者は実装の誤りなので止める
   * @param assetByKey 投稿の全アセット (カバーを含む)
   */
  private assertHtmlReferencesKnownAssets(assetByKey: ReadonlyMap<string, FileObj>): void {
    for (const fragment of this.postObj.html) {
      if (typeof fragment === 'string') continue;
      const key = assetKeyToString(fragment.assetCard.key);
      if (!assetByKey.has(key)) {
        throw new Error(`HTML が投稿に存在しないアセットを参照しています: ${key}`);
      }
    }
  }

  /**
   * 断片列を HTML 文字列に解決する。
   *
   * 選択条件で除外されたアセットのカードはプレースホルダーに差し替える。カードごと消さないのは、
   * 後からアーカイブを見たときに元の投稿に何が含まれていたか分からなくなるため。
   * 参照先の archive path が割り当てられていない断片は、壊れたリンクを出力に残さないよう例外にする
   * @param pathByKey assetKeyToString をキーとする archive path (投稿の全アセット)
   * @param includedKeys 出力に含めるアセット
   */
  private resolveHtml(
    pathByKey: ReadonlyMap<string, string>,
    includedKeys: ReadonlySet<string>,
    assetByKey: ReadonlyMap<string, FileObj>,
  ): string {
    const renderBody = (fragments: readonly CardBodyFragment[]): string =>
      fragments
        .map((fragment) => {
          if (typeof fragment === 'string') return fragment;
          const archiveName = pathByKey.get(assetKeyToString(fragment.assetRef));
          if (archiveName === undefined) {
            throw new Error(`archive path is not allocated: ${assetKeyToString(fragment.assetRef)}`);
          }
          return this.utils.escapeHtml(`./${this.utils.encodeURI(archiveName)}`);
        })
        .join('');
    return this.postObj.html
      .map((fragment) => {
        if (typeof fragment === 'string') return fragment;
        const key = assetKeyToString(fragment.assetCard.key);
        if (includedKeys.has(key)) return renderBody(fragment.assetCard.body);
        const asset = assetByKey.get(key);
        if (asset === undefined) {
          throw new Error(`HTML が投稿に存在しないアセットを参照しています: ${key}`);
        }
        return this.renderExcludedAsset(asset);
      })
      .join('');
  }

  /**
   * 選択条件で除外されたアセットのプレースホルダーを描く。
   *
   * 「取得に失敗した」とは別の状態なので文言を分ける。URL は残さない。
   * 種別と名前は登録済みのアセットから取る。カードに持たせると、実在する key に偽の
   * メタデータを付けたカードで誤った表示ができてしまう
   * @param asset 除外されたアセット
   */
  private renderExcludedAsset(asset: FileObj): string {
    const label = asset.key.kind === 'cover' ? 'カバー画像' : asset.key.kind === 'image' ? '画像' : '添付ファイル';
    const name = this.utils.escapeHtml(asset.name + asset.extension);
    return (
      `<div class="post card text-center excluded-asset"><p class="pt-2">\n` +
      `選択条件により除外しました\n<br>\n${label}: ${name}\n</p></div>`
    );
  }
}

/**
 * ファイルオブジェクトラッパークラス
 */
export class FileObject {
  private readonly fileObj: FileObj;
  private readonly utils: DownloadUtils;

  constructor(fileObj: FileObj, utils: DownloadUtils) {
    this.fileObj = fileObj;
    this.utils = utils;
  }

  getKey(): AssetKey {
    return this.fileObj.key;
  }

  getMetadata(): AssetMetadata {
    return this.fileObj.metadata;
  }

  getEncodedName(): string {
    return this.utils.encodeFileName(this.fileObj.name);
  }

  getEncodedExtension(): string {
    return this.utils.encodeFileName(this.fileObj.extension);
  }

  getOriginalName(): string {
    return this.fileObj.name;
  }

  getOriginalExtension(): string {
    return this.fileObj.extension;
  }

  getUrl(): string {
    return this.fileObj.url;
  }
}

/**
 * CRC-32 ルックアップテーブル (IEEE 802.3 polynomial)
 * @internal
 */
export const crc32Table: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

/**
 * CRC-32 を計算する
 * @param data 対象データ
 * @internal
 */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = crc32Table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * BlobPart 配列を Uint8Array に変換する
 */
async function toUint8Array(parts: BlobPart[]): Promise<Uint8Array<ArrayBuffer>> {
  const blob = new Blob(parts);
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Date を ZIP の DOS time/date 表現可能範囲 (1980-01-01 00:00:00 〜 2107-12-31 23:59:58) にクランプする
 * - DOS time/date はローカル時刻で計算される慣例なので min/max もローカル時刻で構築する
 * - Issue #7 の Acceptance Criteria に従い、NTFS / Extended Timestamp にも clamp 後の同一 Date を使う
 *   (NTFS は 1601-9999、UT は 1901-2038 を扱えるが、3 種で値を整合させるため意図的に DOS 範囲で揃える)
 * @internal
 */
export function clampToZipRange(date: Date): Date {
  const min = new Date(1980, 0, 1, 0, 0, 0, 0);
  const max = new Date(2107, 11, 31, 23, 59, 58, 0);
  if (date.getTime() < min.getTime()) return min;
  if (date.getTime() > max.getTime()) return max;
  return date;
}

/**
 * Date を DOS time / DOS date (各 16 bit) に変換する
 * - DOS time: (h << 11) | (m << 5) | (s >> 1)
 * - DOS date: ((y - 1980) << 9) | ((mo + 1) << 5) | d
 * 入力はクランプ済みであることを前提とする
 * @internal
 */
export function toDosTimeDate(date: Date): { time: number; dosDate: number } {
  const h = date.getHours();
  const m = date.getMinutes();
  const s = date.getSeconds();
  const y = date.getFullYear();
  const mo = date.getMonth();
  const d = date.getDate();
  const time = (h << 11) | (m << 5) | (s >> 1);
  const dosDate = ((y - 1980) << 9) | ((mo + 1) << 5) | d;
  return { time, dosDate };
}

/**
 * NTFS Extra Field (0x000A) を構築する (36 バイト固定)
 * mtime / atime / ctime はすべて同一の date を FILETIME として書き込む
 * @internal
 */
export function buildNtfsExtra(date: Date): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(36);
  const view = new DataView(buf);
  view.setUint16(0, 0x000a, true); // Header ID: NTFS
  view.setUint16(2, 32, true); // Data Size
  view.setUint32(4, 0, true); // Reserved
  view.setUint16(8, 0x0001, true); // Attr Tag (Tag1)
  view.setUint16(10, 24, true); // Attr Size (Size1)
  // FILETIME = (unix_ms + epoch_diff_ms) * 10000 (100ns 単位、1601-01-01 起点 UTC)
  // 11644473600000 = (1970-01-01 - 1601-01-01) のミリ秒
  const filetime = (BigInt(date.getTime()) + 11644473600000n) * 10000n;
  view.setBigUint64(12, filetime, true); // Mtime
  view.setBigUint64(20, filetime, true); // Atime
  view.setBigUint64(28, filetime, true); // Ctime
  return new Uint8Array(buf);
}

/**
 * Extended Timestamp Extra Field (0x5455) を LFH 用に構築する (17 バイト)
 * Flags = 0x07 (mtime + atime + ctime)
 * 入力 unix time が signed int32 範囲に収まることを呼び出し側が保証する
 * @internal
 */
export function buildExtTimestampLfh(date: Date): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(17);
  const view = new DataView(buf);
  view.setUint16(0, 0x5455, true); // Header ID: extended timestamp
  view.setUint16(2, 13, true); // Data Size
  view.setUint8(4, 0x07); // Flags: mtime + atime + ctime
  const unix = Math.floor(date.getTime() / 1000);
  view.setInt32(5, unix, true); // Mtime
  view.setInt32(9, unix, true); // Atime
  view.setInt32(13, unix, true); // Ctime
  return new Uint8Array(buf);
}

/**
 * Extended Timestamp Extra Field (0x5455) を CD 用に構築する (9 バイト, mtime のみ)
 * - CD では mtime のみ格納するが、Flags は LFH と同一の 0x07 にする Info-ZIP 慣例
 *   (proginfo/extrafld.txt: "This bitmap is the same as that in the local-header field.")
 * - Flags は「LFH 側にどの timestamp が存在するか」を示すビットマップであり、CD payload の構成を表すものではない
 * @internal
 */
export function buildExtTimestampCd(date: Date): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(9);
  const view = new DataView(buf);
  view.setUint16(0, 0x5455, true); // Header ID: extended timestamp
  view.setUint16(2, 5, true); // Data Size (Flags 1 + Mtime 4)
  view.setUint8(4, 0x07); // Flags (LFH と同一値、Info-ZIP 慣例)
  const unix = Math.floor(date.getTime() / 1000);
  view.setInt32(5, unix, true); // Mtime
  return new Uint8Array(buf);
}

/**
 * 値が signed int32 範囲に収まるか
 * @internal
 */
function isInt32(n: number): boolean {
  return n >= -2147483648 && n <= 2147483647;
}

/**
 * addFile / addDirectory 共通の日時フィールド構築
 * date が未指定または Invalid Date の場合は DOS time/date = 0、extra field なし (従来挙動)
 * それ以外は clampToZipRange 後の Date から DOS time/date + NTFS Extra を組み立て、
 * clamp 後の Unix time が signed int32 範囲に収まる場合のみ Extended Timestamp も足す
 * @internal
 */
function buildDateFields(date?: Date): {
  dosTime: number;
  dosDate: number;
  extraLfh: Uint8Array<ArrayBuffer>;
  extraCd: Uint8Array<ArrayBuffer>;
} {
  let dosTime = 0;
  let dosDate = 0;
  let extraLfh = new Uint8Array(0);
  let extraCd = new Uint8Array(0);

  if (date !== undefined && Number.isFinite(date.getTime())) {
    const d = clampToZipRange(date);
    const dos = toDosTimeDate(d);
    dosTime = dos.time;
    dosDate = dos.dosDate;
    const ntfs = buildNtfsExtra(d);
    const unix = Math.floor(d.getTime() / 1000);
    if (isInt32(unix)) {
      extraLfh = concatBytes([ntfs, buildExtTimestampLfh(d)]);
      extraCd = concatBytes([ntfs, buildExtTimestampCd(d)]);
    } else {
      extraLfh = ntfs;
      extraCd = ntfs;
    }
  }

  return { dosTime, dosDate, extraLfh, extraCd };
}

/**
 * 複数の Uint8Array を連結する
 * @internal
 */
function concatBytes(parts: Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/**
 * ZIP エントリ数の上限 (Issue #15)。
 * `0xFFFF` (65535) は ZIP64 の central directory エントリ数の sentinel 値 (APPNOTE 4.4.1.4) であり、
 * 「真の値は ZIP64 EOCD レコードにある」ことを示す。ZipWriter は ZIP64 record を書かないため、
 * エントリ数がちょうど 65535 件になると、sentinel を厳密に扱うリーダー (例: Perl Archive::Zip) が
 * ZIP 全体を開けなくなる。65536 件以上では EOCD の uint16 フィールドが折り返り (65536 → 0)、
 * 件数でループするリーダーが central directory の途中で不整合を起こす。
 * どちらの壊れ方も避けるため、エントリ数は 65534 件までに制限する。
 * @internal
 */
export const MAX_ZIP_ENTRY_COUNT = 0xfffe;

/**
 * local file header の固定部のバイト数。
 * 1 エントリが占めるバイト数は これ + 名前長 + extra field 長 + 本体長 になる
 */
export const ZIP_LOCAL_HEADER_FIXED_BYTES = 30;

/**
 * central directory の 1 エントリの固定部のバイト数。
 * 1 エントリが占めるバイト数は これ + 名前長 + extra field 長 になる
 */
export const ZIP_CENTRAL_HEADER_FIXED_BYTES = 46;

/**
 * LFH / CD の size フィールドと CD / EOCD の offset フィールド (いずれも uint32) が
 * 取り得る値の上限 (Issue #15)。`0xFFFFFFFF` は APPNOTE 4.4.1.4 が定める ZIP64 の sentinel 値であり、
 * ZipWriter は ZIP64 Extended Information Extra Field を書かないため、この値以上になると
 * sentinel と誤認されるか、uint32 の折り返しでフィールドの値そのものが壊れる。
 * @internal
 */
export const MAX_ZIP_UINT32_FIELD_VALUE = 0xffffffff;

/**
 * ZIP エントリ数が上限に達していないか検証する。addFile / addDirectory の書き込み開始前
 * (ヘッダを書く前) に呼ぶことで、65535 件目 (sentinel 値) 以降のエントリを書き込む前に拒否する
 * (Issue #15)。65534 回 addFile を呼ぶ実行時間のテストを避けるため、カウント検査ロジックを
 * ZipWriter から独立させて直接ユニットテストできるようにしている。
 * @param currentEntryCount 追加しようとしている時点での既存エントリ数 (呼び出し側の entries.length)
 * @throws {Error} currentEntryCount が上限 (MAX_ZIP_ENTRY_COUNT) 以上の場合
 * @internal
 */
export function assertZipEntryCountWithinLimit(currentEntryCount: number, method: 'addFile' | 'addDirectory'): void {
  if (currentEntryCount >= MAX_ZIP_ENTRY_COUNT) {
    throw new Error(
      `ZipWriter.${method}: ZIP エントリ数が上限 (${MAX_ZIP_ENTRY_COUNT} 件) に達しています ` +
        '(ZIP64 非対応のため、これ以上追加すると EOCD のエントリ数フィールドが ZIP64 の sentinel 値と衝突するか uint16 で折り返します)',
    );
  }
}

/**
 * 単一エントリのデータサイズが上限を超えないか検証する。LFH / CD の compressed / uncompressed size は
 * uint32 で、かつ ZipWriter は圧縮を行わない (常に stored, Issue #15) ため、データの生バイト数が
 * そのままこのフィールドに書かれる。0xFFFFFFFF bytes のバッファ確保は現実的でないため、
 * サイズ比較のロジックのみを独立させて境界値を直接ユニットテストできるようにしている。
 * @param size エントリのデータバイト数
 * @throws {Error} size が上限 (MAX_ZIP_UINT32_FIELD_VALUE) 以上の場合
 * @internal
 */
export function assertZipEntrySizeWithinLimit(size: number, name: string, method: 'addFile'): void {
  if (size >= MAX_ZIP_UINT32_FIELD_VALUE) {
    throw new Error(
      `ZipWriter.${method}: エントリサイズが上限 (${MAX_ZIP_UINT32_FIELD_VALUE} bytes) 以上です (ZIP64 非対応): ` +
        `${JSON.stringify(name)} (${size} bytes)`,
    );
  }
}

/**
 * CD の local header offset、EOCD の cdOffset / cdSize など、uint32 フィールドに書き込む値が
 * 上限を超えないか検証する (Issue #15)。addFile / addDirectory では書き込み開始前の this.offset
 * (この後 CD に書く local header offset になる値) を、close() では cdOffset と central directory
 * 全体のサイズをそれぞれ書き込み前に検証する。呼び出しごとに書き込みの手前で呼ぶことで、
 * 上限超過を「壊れたバイト列を書いてから気付く」のではなく「書く前に検知する」設計にしている。
 * @param value 検証対象の値 (offset または size)
 * @param context エラーメッセージに含める説明 (どのフィールドの検証かを示す)
 * @throws {Error} value が上限 (MAX_ZIP_UINT32_FIELD_VALUE) 以上の場合
 * @internal
 */
export function assertZipUint32FieldWithinLimit(value: number, context: string): void {
  if (value >= MAX_ZIP_UINT32_FIELD_VALUE) {
    throw new Error(`ZipWriter: ${context} が上限 (${MAX_ZIP_UINT32_FIELD_VALUE} bytes) 以上になります (ZIP64 非対応)`);
  }
}

/**
 * ZIP ファイル書き込みクラス (stored / 非圧縮)
 * File System Access API の FileSystemWritableFileStream に直接書き込む
 *
 * 利用契約:
 * - **直列に await して使うこと。** addFile / addDirectory / close は呼び出しごとに await してから次を
 *   呼ぶ前提で、内部状態 (書き込みオフセットやエントリ一覧) を単一の呼び出し系列でのみ更新する。
 *   前の呼び出しを await せずに次を呼ぶ (並行呼び出し) は誤用であり、直列化して待たせるのではなく
 *   即座に例外にする (呼び出し順序の保証という新しい契約を暗黙に増やさないため)。
 * - **close() 成功後、または addFile / addDirectory / close のいずれかが失敗した後は再利用できない。**
 *   前者は File System Access API 上ストリームが既に確定しているため、後者は書き込み先ストリームを
 *   既に abort 済みのため。どちらも以後の呼び出しは冒頭で例外を投げる (terminal 状態)。
 * - **close() の実行中は公開 abort() で中断できない。** Streams 仕様上、in-flight の close は abort で
 *   中断されず close の完了が優先されるため、close 実行中に abort() が成功したように見えても実際には
 *   ファイルがコミットされてしまいうる (「破棄したはずが実はコミットされていた」という嘘になる)。
 *   そのため close 実行中の abort() は例外を投げて拒否し、呼び出し側に close 自身の結果 (成功/失敗) を
 *   await させる。
 * @internal
 */
export class ZipWriter {
  private writable: FileSystemWritableFileStream;
  private offset = 0;
  private entries: {
    name: Uint8Array<ArrayBuffer>;
    crc: number;
    size: number;
    offset: number;
    dosTime: number;
    dosDate: number;
    extraCd: Uint8Array<ArrayBuffer>;
    /** central directory の external file attributes。addFile は 0、addDirectory は 0x10 (FILE_ATTRIBUTE_DIRECTORY) */
    externalAttr: number;
  }[] = [];
  private encoder = new TextEncoder();
  /**
   * インスタンスの状態 (Issue #17 フォローアップ)。
   * - 'open': 通常状態。addFile / addDirectory / close を呼べる
   * - 'closed': close() が成功した後。File System Access API 上ストリームは既に確定しており、
   *   以後の書き込みはできない
   * - 'failed': addFile / addDirectory / close のいずれかで例外が発生し abort 済み (terminal)。
   *   abort() 自体が失敗した場合もこの状態のまま残るため、二重 abort の防止も兼ねる
   */
  private state: 'open' | 'closed' | 'failed' = 'open';
  /**
   * 現在実行中の操作。実行中でなければ false、実行中ならどのメソッドが実行中かを保持する。
   * このクラスは直列利用を契約とするため (クラス doc 参照)、実行中に別の呼び出しが来たら
   * プログラミングエラーとして即座に例外にする。async 関数本体は最初の await まで同期的に走るため、
   * beginOperation をメソッド先頭で呼べば、呼び出し元が返り値を await していなくても検出できる。
   * 操作種別を持たせているのは、公開 abort() が 'close' 実行中かどうかを区別する必要があるため
   * (close は abort で中断できない。クラス doc 参照)。
   */
  private inFlight: false | 'addFile' | 'addDirectory' | 'close' = false;

  constructor(writable: FileSystemWritableFileStream) {
    this.writable = writable;
  }

  /**
   * ファイルを ZIP に追加する
   * @param name ZIP 内のファイルパス (UTF-8)。末尾が `/` の名前は拒否する (ディレクトリと紛らわしいため。
   *   ディレクトリを追加したい場合は addDirectory を使う)
   * @param data ファイルデータ
   * @param date 任意。指定時は DOS time/date に加え NTFS / Extended Timestamp Extra Field を書き込む。
   *   省略または Invalid Date の場合は従来挙動 (DOS 0、extra field なし) でバイト列を維持する。
   *   1980-01-01 〜 2107-12-31 23:59:58 にクランプ。Extended Timestamp は clamp 後の Unix time が
   *   signed int32 範囲に収まる場合のみ書く。
   * @throws {Error} このインスタンスが使用不能な状態 (close 済み、以前の失敗、または他の呼び出しが
   *   実行中) の場合。name をセグメント (`/` 区切り) ごとに見たとき、空文字列 / "." / ".." / "\" ":" を
   *   含む場合、または末尾が `/` の場合 (downloadZip 側でも同じ検証を行うが、addFile を直接呼ぶ利用者を
   *   無防備にしないための多層防御として ZipWriter 自身にも検証を持たせている、Issue #17)。
   *   エンコード後の名前が 65535 bytes (UTF-8) を超える場合 (file name length フィールドが 16 bit のため)。
   *   このインスタンスの既存エントリ数が上限 (`MAX_ZIP_ENTRY_COUNT` = 65534 件) に達している場合、
   *   data のバイト数が上限 (`MAX_ZIP_UINT32_FIELD_VALUE` = 0xFFFFFFFF bytes) 以上の場合、または
   *   この書き込みで central directory の local header offset が同上限に達する場合
   *   (ZipWriter は ZIP64 を実装しておらず、classic ZIP の uint16 / uint32 フィールドの範囲を
   *   超えるとフィールド自体が壊れるため、書き込み前に検知して拒否する。Issue #15)
   */
  async addFile(name: string, data: Uint8Array, date?: Date): Promise<void> {
    this.beginOperation('addFile');
    try {
      assertValidZipEntryName(name, 'addFile');

      // 公開 API なので引数は Uint8Array のまま受ける。File System Access API の write は
      // ArrayBuffer backed しか受け付けないので、SharedArrayBuffer backed ならコピーして揃える。
      const bytes: Uint8Array<ArrayBuffer> =
        data.buffer instanceof ArrayBuffer ? (data as Uint8Array<ArrayBuffer>) : new Uint8Array(data);
      // TextEncoder.encode は常に新しい ArrayBuffer を確保する (TypeScript 5.7 未満では
      // 戻り値が ArrayBufferLike 扱いになるためアサーションで補う)
      const nameBytes = this.encoder.encode(name) as Uint8Array<ArrayBuffer>;
      assertValidZipEntryNameByteLength(nameBytes, name, 'addFile');
      assertZipEntryCountWithinLimit(this.entries.length, 'addFile');
      assertZipEntrySizeWithinLimit(bytes.length, name, 'addFile');
      const fileCrc = crc32(bytes);
      const localHeaderOffset = this.offset;
      // この後 CD に local header offset として書く値 (offset 42) が uint32 に収まるかを、
      // ヘッダを書く前に検証する (Issue #15)
      assertZipUint32FieldWithinLimit(localHeaderOffset, `addFile ("${name}") の local header offset`);

      const { dosTime, dosDate, extraLfh, extraCd } = buildDateFields(date);

      // Local File Header (30 bytes + name length + extra field length)
      const header = new ArrayBuffer(ZIP_LOCAL_HEADER_FIXED_BYTES);
      const view = new DataView(header);
      view.setUint32(0, 0x04034b50, true); // signature
      view.setUint16(4, 20, true); // version needed (2.0)
      view.setUint16(6, 0x0800, true); // general purpose bit flag (bit 11 = UTF-8)
      view.setUint16(8, 0, true); // compression method (stored)
      view.setUint16(10, dosTime, true); // mod time
      view.setUint16(12, dosDate, true); // mod date
      view.setUint32(14, fileCrc, true); // crc-32
      view.setUint32(18, bytes.length, true); // compressed size
      view.setUint32(22, bytes.length, true); // uncompressed size
      view.setUint16(26, nameBytes.length, true); // file name length
      view.setUint16(28, extraLfh.length, true); // extra field length

      await this.write(new Uint8Array(header));
      await this.write(nameBytes);
      if (extraLfh.length > 0) await this.write(extraLfh);
      await this.write(bytes);

      // 最後の write() が resolve してからこの行に来るまでの間 (await this.write(bytes) の継続が挟む
      // マイクロタスク境界) にも、公開 abort() が割り込む窓が残るため、entries.push() 直前で再確認する
      // (Issue #17 フォローアップ)
      this.assertStillOpen('addFile');

      this.entries.push({
        name: nameBytes,
        crc: fileCrc,
        size: bytes.length,
        offset: localHeaderOffset,
        dosTime,
        dosDate,
        extraCd,
        externalAttr: 0,
      });
    } catch (e) {
      await this.abortOnFailure(e);
      throw e;
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * ディレクトリエントリを ZIP に追加する
   * @param name ZIP 内のディレクトリパス (UTF-8)。末尾が `/` でなければ自動的に付与する
   * @param date 任意。addFile と同一の日時ロジック (DOS time/date + NTFS Extra + Extended Timestamp) を適用する。
   *   省略または Invalid Date の場合は DOS time/date = 0、extra field なし
   * @throws {Error} このインスタンスが使用不能な状態 (close 済み、以前の失敗、または他の呼び出しが
   *   実行中) の場合。正規化後の名前をセグメント (`/` 区切り) ごとに見たとき、空文字列 / "." / ".." /
   *   `\` `:` を含むセグメントがある場合 (name が空文字列、または先頭が `/` の場合を含む)。
   *   APPNOTE 4.4.17.1 が ZIP 内のパスを相対パスに限り、先頭 `/` を禁じるため。
   *   addFile と同じ検証をセグメント単位で適用するため、drive letter (`C:/dir`) や `\` 区切りも拒否する
   *   (Issue #14 時点では addFile と非対称にしないため未検証としていたが、Issue #17 で addFile 側にも
   *   検証を追加したため、この非対称は解消されている)。
   *   エンコード後の名前が 65535 bytes (UTF-8) を超える場合 (file name length フィールドが 16 bit のため)。
   *   このインスタンスの既存エントリ数が上限 (`MAX_ZIP_ENTRY_COUNT` = 65534 件) に達している場合、
   *   またはこの書き込みで central directory の local header offset が上限
   *   (`MAX_ZIP_UINT32_FIELD_VALUE` = 0xFFFFFFFF bytes) に達する場合 (addFile と同じ ZIP64 非対応の
   *   理由による書き込み前の検知。Issue #15)
   */
  async addDirectory(name: string, date?: Date): Promise<void> {
    this.beginOperation('addDirectory');
    try {
      const dirName = name.endsWith('/') ? name : `${name}/`;
      assertValidZipEntryName(dirName, 'addDirectory');

      const nameBytes = this.encoder.encode(dirName) as Uint8Array<ArrayBuffer>;
      assertValidZipEntryNameByteLength(nameBytes, dirName, 'addDirectory');
      assertZipEntryCountWithinLimit(this.entries.length, 'addDirectory');
      const localHeaderOffset = this.offset;
      // addFile と同様、CD に書く local header offset (offset 42) を書き込み前に検証する (Issue #15)。
      // ディレクトリエントリはデータ本体を持たずサイズは常に 0 のため、サイズ上限の検査は不要
      assertZipUint32FieldWithinLimit(localHeaderOffset, `addDirectory ("${dirName}") の local header offset`);

      const { dosTime, dosDate, extraLfh, extraCd } = buildDateFields(date);

      // Local File Header (30 bytes + name length + extra field length)。CRC / size は常に 0、データ本体は書かない
      const header = new ArrayBuffer(ZIP_LOCAL_HEADER_FIXED_BYTES);
      const view = new DataView(header);
      view.setUint32(0, 0x04034b50, true); // signature
      view.setUint16(4, 20, true); // version needed (2.0)
      view.setUint16(6, 0x0800, true); // general purpose bit flag (bit 11 = UTF-8)
      view.setUint16(8, 0, true); // compression method (stored)
      view.setUint16(10, dosTime, true); // mod time
      view.setUint16(12, dosDate, true); // mod date
      view.setUint32(14, 0, true); // crc-32
      view.setUint32(18, 0, true); // compressed size
      view.setUint32(22, 0, true); // uncompressed size
      view.setUint16(26, nameBytes.length, true); // file name length
      view.setUint16(28, extraLfh.length, true); // extra field length

      await this.write(new Uint8Array(header));
      await this.write(nameBytes);
      if (extraLfh.length > 0) await this.write(extraLfh);

      // addFile と同様、最後の write() の resolve から entries.push() までの窓を塞ぐ (Issue #17 フォローアップ)
      this.assertStillOpen('addDirectory');

      this.entries.push({
        name: nameBytes,
        crc: 0,
        size: 0,
        offset: localHeaderOffset,
        dosTime,
        dosDate,
        extraCd,
        externalAttr: 0x10, // FILE_ATTRIBUTE_DIRECTORY
      });
    } catch (e) {
      await this.abortOnFailure(e);
      throw e;
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * Central Directory と EOCD を書き込み、ストリームを閉じる
   *
   * 既知の制限 (ZIP64 未対応): EOCD のエントリ数 (下記 offset 8/10) と LFH/CD の compressed / uncompressed size
   * (addFile 内、offset 18/22 および 20/24)、CD の local header offset (offset 42)、EOCD の cdSize / cdOffset
   * (offset 12/16) はいずれも uint16 または uint32 に直接値を書いており、ZIP64 の拡張フィールドを持たない。
   * `0xFFFF` / `0xFFFFFFFF` は APPNOTE 4.4.1.4 が定める ZIP64 の sentinel 値のため、これらのフィールドが
   * それに達すると本来は壊れた ZIP になる。Issue #15 でこれを検知するようにしたため、実際には
   * エントリ数が上限 (`MAX_ZIP_ENTRY_COUNT` = 65534 件) に達している場合、または cdOffset / cdSize が
   * 上限 (`MAX_ZIP_UINT32_FIELD_VALUE` = 0xFFFFFFFF bytes) に達する場合は、CD / EOCD を書く前に例外を
   * 投げて拒否する (根本解決である ZIP64 の実装ではなく、上限超過の検知と失敗に留めている。ZIP64 の
   * 実装が必要になった場合は改めて判断する)。単一エントリのサイズ上限は addFile 側で検証済みのため、
   * ここでは entries.length と cdOffset / cdSize のみを検証すればよい。
   * ディレクトリエントリの追加でエントリ数が「投稿数 + 1」増える分、上限に到達しやすくなる点に留意する。
   * @throws {Error} このインスタンスが使用不能な状態 (close 済み、以前の失敗、または他の呼び出しが
   *   実行中) の場合 (Issue #17 フォローアップ)。central directory の offset または size が上限
   *   (`MAX_ZIP_UINT32_FIELD_VALUE` = 0xFFFFFFFF bytes) 以上になる場合 (Issue #15)
   */
  async close(): Promise<void> {
    this.beginOperation('close');
    try {
      const cdOffset = this.offset;
      // EOCD の cdOffset フィールド (offset 16, uint32) が収まるかを CD を書く前に検証する (Issue #15)
      assertZipUint32FieldWithinLimit(cdOffset, 'close の central directory offset (cdOffset)');

      // central directory 全体のサイズを、実際に書き込む前に事前計算して検証する (Issue #15)。
      // 各エントリの CD レコードは 46 bytes 固定 + 名前長 + extra field 長であり、この時点で
      // entries は確定済みなので、実際の書き込みと同じ計算を先取りしてよい
      let predictedCdSize = 0;
      for (const entry of this.entries) {
        predictedCdSize += ZIP_CENTRAL_HEADER_FIXED_BYTES + entry.name.length + entry.extraCd.length;
      }
      // EOCD の cdSize フィールド (offset 12, uint32) が収まるかを CD を書く前に検証する (Issue #15)
      assertZipUint32FieldWithinLimit(predictedCdSize, 'close の central directory size (cdSize)');

      for (const entry of this.entries) {
        const cdHeader = new ArrayBuffer(ZIP_CENTRAL_HEADER_FIXED_BYTES);
        const view = new DataView(cdHeader);
        view.setUint32(0, 0x02014b50, true); // signature
        view.setUint16(4, 20, true); // version made by
        view.setUint16(6, 20, true); // version needed
        view.setUint16(8, 0x0800, true); // general purpose bit flag (UTF-8)
        view.setUint16(10, 0, true); // compression method
        view.setUint16(12, entry.dosTime, true); // mod time
        view.setUint16(14, entry.dosDate, true); // mod date
        view.setUint32(16, entry.crc, true); // crc-32
        view.setUint32(20, entry.size, true); // compressed size
        view.setUint32(24, entry.size, true); // uncompressed size
        view.setUint16(28, entry.name.length, true); // file name length
        view.setUint16(30, entry.extraCd.length, true); // extra field length
        view.setUint16(32, 0, true); // file comment length
        view.setUint16(34, 0, true); // disk number start
        view.setUint16(36, 0, true); // internal file attributes
        view.setUint32(38, entry.externalAttr, true); // external file attributes
        view.setUint32(42, entry.offset, true); // local header offset

        await this.write(new Uint8Array(cdHeader));
        await this.write(entry.name);
        if (entry.extraCd.length > 0) await this.write(entry.extraCd);
      }

      const cdSize = this.offset - cdOffset;

      // End of Central Directory Record (22 bytes)
      const eocd = new ArrayBuffer(22);
      const eocdView = new DataView(eocd);
      eocdView.setUint32(0, 0x06054b50, true); // signature
      eocdView.setUint16(4, 0, true); // disk number
      eocdView.setUint16(6, 0, true); // CD disk number
      eocdView.setUint16(8, this.entries.length, true); // CD entries on this disk
      eocdView.setUint16(10, this.entries.length, true); // total CD entries
      eocdView.setUint32(12, cdSize, true); // CD size
      eocdView.setUint32(16, cdOffset, true); // CD offset
      eocdView.setUint16(20, 0, true); // comment length

      await this.write(new Uint8Array(eocd));
      await this.writable.close();
      // ここに到達した時点で state は必ず 'open' のままである: close 実行中は inFlight === 'close' であり、
      // 公開 abort() はその間例外を投げて拒否するため (state を書き換える経路を持たない)、close 自身の
      // catch (state = 'failed') 以外に state を動かす者がいない。したがってこの代入が 'failed' を
      // 上書きしてしまうことはない (Issue #17 フォローアップ)。
      this.state = 'closed';
    } catch (e) {
      await this.abortOnFailure(e);
      throw e;
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * 外部 (downloadZip など、ZipWriter の外側のコード) で発生した例外に対してストリームを破棄するための
   * public API (Issue #17 フォローアップ)。addFile / addDirectory / close はコールバックを持たず内部で
   * 完結するため abortOnFailure で自己完結できるが、downloadZip は fetchFile / log / progress /
   * remainTime という呼び出し側のコールバックを挟んでおり、これらが投げた例外は ZipWriter の外で
   * catch することになる。その catch から呼ぶための入口がこのメソッドである。
   *
   * close 実行中 (inFlight === 'close') は例外を投げて拒否する。Streams 仕様上、in-flight の close は
   * abort で中断されず close の完了が優先されるため、ここで abort を受理して成功したように見せると、
   * 実際には close が完走してファイルがコミットされているのに abort 側は「破棄できた」と誤認する
   * (state を無条件に 'closed' で上書きする経路にもなり、既に 'failed' にした状態を握りつぶしうる)。
   * 呼び出し側には close 自身の結果 (成功/失敗) を待たせるのが誠実なので、ここでは例外にして
   * 「今は中断できない、close の完了を待て」と伝える。
   *
   * close 実行中でなく、かつ既に 'open' でない (close 済み、または addFile/addDirectory/close 自身の
   * 失敗で既に abort 済み) 場合は no-op にする。ここでの判定はあくまで早期リターンの最適化であり、
   * 実際に二重 abort を防いでいるのは abortOnFailure 側の同じチェックである (in-flight な
   * addFile/addDirectory の I/O 待ち中に abort() が呼ばれるレースでは、ここでの判定時点では
   * まだ 'open' のままになりうるため。詳細は abortOnFailure のコメントを参照)。
   * @param reason 破棄理由 (writable.abort() に渡される)
   * @throws {Error} close が実行中の場合
   */
  async abort(reason?: unknown): Promise<void> {
    if (this.inFlight === 'close') {
      throw new Error('ZipWriter.abort: close 実行中のため abort できません。close の完了を待ってください');
    }
    if (this.state !== 'open') return;
    await this.abortOnFailure(reason);
  }

  /**
   * writable への実書き込み。addFile / addDirectory / close の各書き込み点から呼ばれる。
   *
   * Streams 仕様は abort() が保留中の write() を必ず reject することを保証しない。そのため、
   * addFile / addDirectory の I/O 待ち中に公開 abort() が呼ばれても、この write() 自体は正常に
   * resolve してしまいうる。それを検出しないと、addFile / addDirectory が abort 後も「書けた」まま
   * 成功として resolve してしまう (契約の嘘になる。ZIP の実コミットは close() 側で state を見て
   * 弾かれるため実際には起きないが、呼び出し元への戻り値としての嘘は起きる)。
   * そこで実書き込みが resolve した直後に state を再確認し、'open' でなくなっていれば例外を投げる。
   * close() は in-flight 中は公開 abort() 自体が拒否される (別項参照) ため、close 自身の CD / EOCD
   * 書き込みではこのチェックは通常発火しない。
   * @throws {Error} 書き込みが resolve した時点で state が 'open' でなくなっていた場合 (Issue #17 フォローアップ)
   */
  private async write(data: Uint8Array<ArrayBuffer>): Promise<void> {
    await this.writable.write(data);
    if (this.state !== 'open') {
      throw new Error('ZipWriter: 書き込み中に abort されました');
    }
    this.offset += data.length;
  }

  /**
   * state が 'open' のままであることを再確認する (Issue #17 フォローアップ)。
   * write() 内のチェックは、その write() 自身が resolve した時点の state しか見られない。
   * addFile / addDirectory では、最後の write() が resolve してから entries.push() に到達するまでの間にも
   * (呼び出し元での `await this.write(...)` の継続がマイクロタスク境界を挟むため) 公開 abort() が
   * 割り込む窓が残る。entries.push() 直前でこの確認を挟むことでその窓を塞ぐ。
   * @throws {Error} state が 'open' でない場合
   */
  private assertStillOpen(method: 'addFile' | 'addDirectory'): void {
    if (this.state !== 'open') {
      throw new Error(`ZipWriter.${method}: 書き込み中に abort されました`);
    }
  }

  /**
   * addFile / addDirectory / close の共通の入口処理 (Issue #17 フォローアップ)。
   * - close 済み、または以前の失敗で terminal 状態になっている場合は使用不可として例外を投げる
   * - 既に他の呼び出しが実行中 (inFlight) の場合も、並行呼び出しは誤用として即座に例外を投げる
   *   (「直列化して待たせる」のではなく「検出して拒否する」方針。暗黙の直列化はキュー順序の保証という
   *   新しい契約を増やすため採らない)
   * - 上記のいずれにも該当しなければ inFlight に method 自身を立てる (公開 abort() が 'close' 実行中かを
   *   区別できるようにするため、単なる boolean ではなく操作種別を保持する)。
   *   呼び出し元は必ず finally で inFlight を false に戻すこと
   * @throws {Error} 上記のいずれかに該当する場合
   */
  private beginOperation(method: 'addFile' | 'addDirectory' | 'close'): void {
    if (this.state === 'failed') {
      throw new Error(`ZipWriter.${method}: 以前の失敗により使用不可です`);
    }
    if (this.state === 'closed') {
      throw new Error(`ZipWriter.${method}: close 済みのため使用不可です`);
    }
    if (this.inFlight !== false) {
      throw new Error(
        `ZipWriter.${method}: 別の呼び出しが実行中です (ZipWriter は呼び出しごとに await してから次を呼ぶ直列利用が前提です)`,
      );
    }
    this.inFlight = method;
  }

  /**
   * 書き込み中に例外が発生した場合のストリーム cleanup (Issue #17)。
   * `createWritable()` で得たストリームは、close() を呼ばない限り書き込み先の実ファイルへ反映されない
   * (File System Access API の仕様上、変更は close() で初めてコミットされる)。
   * そのため、addFile / addDirectory / close の途中で例外が発生した場合は、
   * 中途半端な (Central Directory / EOCD を欠いた壊れた) ZIP を実ファイルとしてコミットしてしまわないよう、
   * close() ではなく abort() でストリームを破棄する。abort() 自体の失敗は元の例外を握りつぶさないよう無視する。
   *
   * 冒頭の `state !== 'open'` チェックが二重 abort 防止の実体である (Issue #17 フォローアップ)。
   * 公開 abort() は in-flight (addFile/addDirectory/close の I/O 待ち中) かどうかを考慮しないため、
   * 進行中の操作の write() 待ちの最中に外部から abort() が呼ばれるレースが起こりうる。
   * このとき abort() 経由の呼び出しが先に writable.abort() を発火させ、それによって進行中の write() が
   * reject されると、進行中メソッド自身の catch も abortOnFailure を呼ぶため、対策が無いと
   * writable.abort() が二重に実行されてしまう。
   * ここでの「state を確認してから 'failed' に遷移させ、その後で writable.abort() を await する」という
   * 順序が対策になっている。チェックと代入の間に await を挟まないため単一スレッドの JS 上では
   * 不可分に実行され、2 つの呼び出しが競合しても後着側は必ず `state !== 'open'` を見て no-op になる。
   * state は abort() の成否に関わらず 'failed' のまま維持し、以後のすべての呼び出しを
   * beginOperation で拒否することで、「失敗後もまだ生きているストリームへの書き込みが通ってしまう」
   * 問題も防ぐ。
   */
  private async abortOnFailure(reason: unknown): Promise<void> {
    if (this.state !== 'open') return;
    this.state = 'failed';
    try {
      await this.writable.abort(reason);
    } catch {
      // abort 自体の失敗は元の例外を握りつぶさないよう無視する
    }
  }
}

/**
 * 実際のダウンロードで使う ZIP64 対応 writer。
 *
 * 公開済みの `ZipWriter` はバイト列と失敗条件を固定したテスト互換のために残す。
 * ZIP 生成経路では、4 GiB を超えた時点で ZIP64 へ自動移行できる zip.js を使う。
 * archive path の検証と衝突検査は、この writer へ到達する前の `preflight` が引き続き担う。
 */
class Zip64StreamWriter {
  private readonly writer: ZipJsWriter<unknown>;

  constructor(private readonly writable: FileSystemWritableFileStream) {
    const stream = new WritableStream<Uint8Array>({
      write: (chunk) => writable.write(chunk as Uint8Array<ArrayBuffer>),
      close: () => writable.close(),
      abort: (reason) => writable.abort(reason),
    });
    this.writer = new ZipJsWriter(stream, {
      extendedTimestamp: true,
      level: 0,
      useWebWorkers: false,
    });
  }

  async addFile(name: string, data: Uint8Array, date?: Date): Promise<void> {
    const readable = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(data);
        controller.close();
      },
    });
    await this.writer.add(
      name,
      { readable, size: data.length },
      {
        level: 0,
        ...zipDateOptions(date),
      },
    );
  }

  async addDirectory(name: string, date?: Date): Promise<void> {
    const directoryName = name.endsWith('/') ? name : `${name}/`;
    await this.writer.add(directoryName, undefined, {
      directory: true,
      ...zipDateOptions(date),
    });
  }

  async close(): Promise<void> {
    await this.writer.close();
  }

  async abort(reason?: unknown): Promise<void> {
    await this.writable.abort(reason);
  }
}

function zipDateOptions(
  date: Date | undefined,
): { lastModDate: Date } | { rawLastModDate: 0; extendedTimestamp: false } {
  return date !== undefined && Number.isFinite(date.getTime())
    ? { lastModDate: date }
    : { rawLastModDate: 0, extendedTimestamp: false };
}

/**
 * ZIP の上限のうち、入力の構造と archive 名から超過が確定するものを検出する。
 *
 * `ZipWriter` はエントリ名の UTF-8 バイト長・エントリ数・central directory の offset / size を
 * 書き込み時に検査するが、そこまで進むと既に picker が対象ファイルを空にしている。
 * 入力から超過が確定するぶんだけを先に弾く。
 *
 * 数えるのは**中断せずに完走した場合に必ず書かれるエントリ**である。ルートの 3 件
 * (ディレクトリ / `index.html` / `download-manifest.json`) と、投稿ごとの 3 件
 * (ディレクトリ / `post.json` / 本文選択時の `index.html`)。カバーと添付は取得に失敗すれば書かれないので
 * 数えない。上限側で数えて弾くと、一部の取得が失敗すれば収まるダウンロードまで拒否することになる。
 *
 * offset と size は**名前と固定ヘッダだけで積んだ下限**で見る。extra field と本体のバイト数は
 * 加算方向にしか効かないので、それらを 0 として積んだ値が上限を超えるなら実際の書き込みでも必ず超える。
 * 逆に下限が収まっていても実際には超えうる。固定で書かれる本文と日時 extra は入力から確定するが、
 * 積まない (理由は `preflight` の JSDoc 参照)。
 * @param plan preflight が組み立てた書き込み計画
 * @internal
 */
function assertZipLimitsFromInput(plan: PreflightResult): void {
  const encoder = new TextEncoder();
  const byteLength = (value: string) => encoder.encode(value).length;
  // 完成形のパス文字列は組み立てない。病的な入力では 64 KiB 級の文字列がエントリ数ぶん必要になり、
  // 検査そのものがメモリを食い潰す。区切りの '/' を挟む連結なのでサロゲート対が分断されることはなく、
  // 部分ごとのバイト長を足した値は連結後のバイト長と一致する
  const idBytes = byteLength(plan.encodedId);
  const separator = 1;

  const assertNameLength = (nameBytes: number, describe: () => string) => {
    if (nameBytes > 0xffff) {
      throw new Error(
        `downloadZip: エントリ名が長すぎます (UTF-8 ${nameBytes} bytes, 上限 65535 bytes): ${JSON.stringify(describe())}`,
      );
    }
  };

  const account = (nameBytes: number, describe: () => string) => {
    assertNameLength(nameBytes, describe);
  };

  account(idBytes + separator, () => `${plan.encodedId}/`);
  account(idBytes + separator + byteLength('index.html'), () => `${plan.encodedId}/index.html`);
  account(idBytes + separator + byteLength('download-manifest.json'), () => `${plan.encodedId}/download-manifest.json`);
  for (const post of plan.posts) {
    const dirBytes = idBytes + separator + byteLength(post.directory);
    const dir = () => `${plan.encodedId}/${post.directory}`;
    account(dirBytes + separator, () => `${dir()}/`);
    account(dirBytes + separator + byteLength(post.metadataFileName), () => `${dir()}/${post.metadataFileName}`);
    if (post.bodyIncluded) {
      account(dirBytes + separator + byteLength('index.html'), () => `${dir()}/index.html`);
    }
    // カバーと添付は取得に失敗すれば書かれないので件数とバイト数には積まない。長さだけ検査する
    if (post.coverName !== undefined) {
      const coverName = post.coverName;
      assertNameLength(dirBytes + separator + byteLength(coverName), () => `${dir()}/${coverName}`);
    }
    for (const fileName of post.fileNames) {
      assertNameLength(dirBytes + separator + byteLength(fileName), () => `${dir()}/${fileName}`);
    }
  }
}

/**
 * 投稿 1 件分の書き込み計画
 *
 * `preflight` が検証した archive 名をそのまま持ち、`downloadZip` はここから読んで書き込む。
 * 名前を組み立て直さないので、`DownloadUtils` が呼び出しごとに違う値を返しても書き出しは変わらない。
 *
 * ただし `downloadZip` は `json` 本体 (投稿の並び・本文・URL) を picker の待機後にも読むので、
 * **待機中に呼び出し側が `json` を書き換えた場合まで守れるわけではない** (Issue #53)。
 */
export type PostWritePlan = {
  /** 投稿ディレクトリ名 (ZIP ルート直下) */
  readonly directory: string;
  /** 投稿メタデータの固定ファイル名 (`post.json`) */
  readonly metadataFileName: string;
  /** 投稿本文の index.html を書くか */
  readonly bodyIncluded: boolean;
  /** カバーの archive 名。カバーが無ければ undefined */
  readonly coverName?: string;
  /** 添付の archive 名。`json.posts[].files` と同じ並び */
  readonly fileNames: readonly string[];
};

/**
 * `preflight` の結果
 */
export type PreflightResult = {
  /** 検証を通った入力。渡したオブジェクトと同一で、型だけが確定している */
  readonly json: DownloadJsonObj;
  /** 検証を通った manifest の写し。書き出しにはこの写しだけを使う */
  readonly manifest: DownloadManifest;
  /** 検証を通った ZIP ルートのディレクトリ名 (`encodeFileName(json.id)`) */
  readonly encodedId: string;
  /** `json.posts` と同じ並びの書き込み計画 */
  readonly posts: readonly PostWritePlan[];
};

/**
 * downloadZip の挙動を差し替えるためのオプション
 */
export type DownloadZipOptions = {
  /** 指定時は showSaveFilePicker を呼ばずこのハンドルに書き込む */
  handle?: FileSystemFileHandle;
  /** 中断用。投稿ループ / ファイルループの先頭で aborted を確認する */
  signal?: AbortSignal;
  /**
   * ファイル取得処理の差し替え (未指定時は DownloadUtils.fetchWithLimit を使う)。
   * 第 3 引数の context.kind で、取得対象がカバー画像 (`cover`) か投稿内添付ファイル (`file`) かを
   * 呼び出し側に伝える (Issue #13)。ファイル名からの推測はカバー画像と同名の添付ファイルがあり得るため
   * 安定しないので、downloadZip 側から明示的に渡す。
   * 引数が 2 つの既存関数もそのまま代入できる (TypeScript では引数の少ない関数は代入可能なため後方互換)。
   */
  fetchFile?: (url: string, name: string, context: { kind: 'cover' | 'file' }) => Promise<Blob | null>;
};

/**
 * downloadZip の処理結果 (Issue #13)。
 * 各件数の定義:
 * - completedPostCount: 投稿ディレクトリ配下の処理 (HTML + カバー + 添付) をすべて終えた投稿数。
 *   中断で途中打ち切りになった投稿は含めない
 * - totalPostCount: downloadObj.posts の総数
 * - writtenFileCount: ZIP に書き込んだ「取得系ファイル」数 = カバー + 添付の成功数。
 *   HTML / info テキストなど生成ファイルは含めない (取得の成否という関心事に合わせる)
 * - failedFileCount: 取得を試みて最終的に失敗した数 = カバー + 添付の失敗数。
 *   中断によって取得しなかった/中止したものは含めない (fetchFile が null を返した直後に signal.aborted を
 *   確認し、中断由来の null はここに数えない)
 * - aborted: 実際に中断分岐 (投稿ループ / カバー取得後 / ファイルループの各 signal チェック) で
 *   打ち切ったかどうか。全データを書き終えたあと、zip.close() の実行中に signal.aborted になった場合は
 *   ここには反映されない (書けているものを誤って「中断」と報告しないため) ため false のままになる
 */
export type DownloadZipResult = {
  completedPostCount: number;
  totalPostCount: number;
  writtenFileCount: number;
  failedFileCount: number;
  aborted: boolean;
  /**
   * 選択されたアセット 1 件ごとの結果 (Issue #54)。
   *
   * 件数フィールドから導けない「どれを書けたか」を利用側が記録できるようにする。
   * 選択された全アセットに対して 1 件ずつ、`json.posts` の並び (投稿ごとにカバー → 添付) で入る。
   * 選択条件で除外された対象は `downloadZip` に渡っていないので現れない (manifest の `excluded` 側)。
   */
  assets: readonly AssetWriteResult[];
};

/**
 * アセット 1 件の書き込み結果
 *
 * - `written`: ZIP に書けた
 * - `failed`: 取得に失敗した (中断由来ではない。`failedFileCount` と同じ数え方)
 * - `skipped`: 中断のため書けなかった。
 *   取得の途中で中断されたものと、そこまで到達しなかったものを区別しない (どちらも保存できていない)
 */
export type AssetWriteOutcome = 'written' | 'failed' | 'skipped';

/**
 * アセット 1 件の書き込み結果 (Issue #54)
 *
 * **`AssetKey` ではなく archive path で指す。**
 * `downloadZip` は書き込み時に identity を持っていない。
 * `DownloadJsonObj` 側 (`encodedName`) と `DownloadManifest` 側 (`assetId`) を突き合わせる手段は `(encodedName, originalName)` の組による多重集合の対応しかなく、legacy allocator が投稿内で archive 名を衝突させうる以上、これは一意性が保証された写像ではない。
 * そこで実際に知っていること (どのパスに書けたか) だけを報告する。
 * `AssetKey` への対応付けは、allocator を決めた利用側が行う。
 */
export type AssetWriteResult = {
  /** `json.posts` での位置。`manifest.posts` も同じ並びなので postId はそこから引ける */
  readonly postIndex: number;
  readonly kind: 'cover' | 'file';
  /** 投稿ディレクトリからの相対名。`preflight` が検証した archive 名そのもの */
  readonly archiveName: string;
  readonly outcome: AssetWriteOutcome;
};

/**
 * ZIP パスの 1 セグメントとして安全か検証する。
 * 空文字列 / "/" "\" ":" を含むもの、制御文字 (U+0000-U+001F, U+007F) を含むものを拒否する。
 * downloadZip の事前検証 (encodedId / post.encodedName / post.cover.name / file.encodedName) と
 * ZipWriter.addFile / addDirectory 自体の入力検証 (assertValidZipEntryName 経由) の両方で共有する。
 * cover.name / file.encodedName はパス区切りを含まない 1 セグメント名である前提のため、
 * これらにも同じ検証をそのまま適用してよい (Issue #17)。
 * post.encodedName 等は isDownloadJsonObj で型 (string) すら検証されないため、value を unknown として受ける
 *
 * Win32 系の展開実装は、ファイル名末尾の空白とピリオドを取り除いてから解釈する。そのため "." / ".." の
 * 完全一致だけでなく、末尾の空白・ピリオドを取り除いた結果が空文字列 / "." / ".." になるセグメント
 * (".. ", "...", ". ." 等) も、展開先で親ディレクトリと同等に扱われうるため拒否する。
 * それ以外の末尾空白・ピリオド (例: "a. ") は Windows 上でのファイル名の互換性問題ではあるが
 * トラバーサルではないため拒否しない (Issue #17 フォローアップ)。
 * @internal
 */
function isValidPathSegment(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (/[/\\:]/.test(value)) return false;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 制御文字を意図的に拒否するための検証
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  const trimmedTrailing = value.replace(/[ .]+$/, '');
  return trimmedTrailing.length > 0 && trimmedTrailing !== '.' && trimmedTrailing !== '..';
}

/**
 * ZIP エントリ名 (`/` 区切りの複数セグメントパス) の各セグメントを isValidPathSegment で検証する。
 * ZipWriter.addFile / addDirectory 自体への入力検証用で、結合済みのエントリ名をまとめて検証する。
 * downloadZip の事前検証はフィールドごとに isValidPathSegment を個別に呼ぶため、
 * ロジックの実体 (isValidPathSegment) は共有しつつ、ここでは呼び出し形だけをまとめている (重複実装を避ける)。
 * 末尾 `/` の扱いは method によって非対称にする。addDirectory は呼び出し元 (このファイル内の addDirectory)
 * が必ず正規化後の "dir/" 形式で渡すため、末尾の `/` を 1 つだけ取り除いてから分割する。
 * addFile は取り除かない。取り除いてしまうと `addFile("dir/", data)` のような、名前上はディレクトリなのに
 * データ本体を持つ矛盾したエントリを許してしまうため、末尾 `/` は素通しでセグメント分割にかけ、
 * 分割で生じる空文字列セグメントとして isValidPathSegment に拒否させる (Issue #17 フォローアップ)。
 * @param name 検証対象のエントリ名
 * @param method エラーメッセージに含める呼び出し元メソッド名。addDirectory の場合のみ末尾 `/` を除去する
 * @throws {Error} いずれかのセグメントが isValidPathSegment を満たさない場合
 *   (空文字列 / "." / ".." / "/" "\" ":" を含む。空文字列は name が空、先頭・末尾が `/`、または `//` の埋め込みで発生する)
 * @internal
 */
function assertValidZipEntryName(name: string, method: 'addFile' | 'addDirectory'): void {
  const segmentsSource = method === 'addDirectory' && name.endsWith('/') ? name.slice(0, -1) : name;
  for (const segment of segmentsSource.split('/')) {
    if (!isValidPathSegment(segment)) {
      throw new Error(`ZipWriter.${method}: 不正な ZIP エントリ名です (${JSON.stringify(name)})`);
    }
  }
}

/**
 * ZIP エントリ名の UTF-8 バイト長を検証する。
 * LFH / CD の file name length フィールドは 16 bit (uint16) のため、65535 bytes を超える名前を
 * そのまま書くと setUint16 が値を切り詰め、直後に書く名前バイト列自体は全長書き込まれてしまい、
 * 後続のデータ (extra field やファイル本体) の位置がずれた壊れた ZIP になる。
 * 入力は非信頼という前提のため、約 64 KiB の名前は実際に発生しうる (Issue #17 フォローアップ)。
 * @param nameBytes エンコード後のエントリ名バイト列
 * @param name エラーメッセージ用の元の名前 (addDirectory の場合は正規化後の "dir/" 形式)
 * @param method エラーメッセージに含める呼び出し元メソッド名
 * @throws {Error} nameBytes.length が 65535 を超える場合
 * @internal
 */
function assertValidZipEntryNameByteLength(
  nameBytes: Uint8Array,
  name: string,
  method: 'addFile' | 'addDirectory',
): void {
  if (nameBytes.length > 0xffff) {
    throw new Error(
      `ZipWriter.${method}: エントリ名が長すぎます (UTF-8 ${nameBytes.length} bytes, 上限 65535 bytes): ${JSON.stringify(name)}`,
    );
  }
}

/**
 * `download-manifest.json` の形式を検証する。
 * projection が付ける印でもあるので、`downloadZip` はこれが無い入力を受け付けない
 * @param value 検証対象
 * @internal
 */
function isDownloadManifest(value: unknown, downloadObj: Record<string, unknown>): value is DownloadManifest {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Record<string, unknown>;
  if (m.schemaVersion !== 1) return false;
  // 永続化する schema なので、日時として読める文字列であることまで見る。
  // 各フィールドは 1 回だけ読む (読むたびに値を変える getter で検証と実値を食い違わせないため)
  const generatedAt = m.generatedAt;
  if (typeof generatedAt !== 'string' || !Number.isFinite(new Date(generatedAt).getTime())) return false;
  // creatorId は id と同じであることまで見る。別の収集結果の manifest を貼り付けた入力を通さない
  const creatorId = m.creatorId;
  if (typeof creatorId !== 'string' || creatorId !== downloadObj.id) return false;

  const selection = m.selection as Record<string, unknown> | undefined;
  if (
    typeof selection !== 'object' ||
    selection === null ||
    !isStringArray(selection.postIds) ||
    !isStringArray(selection.extensions) ||
    typeof selection.includeCover !== 'boolean' ||
    typeof selection.includeBody !== 'boolean'
  ) {
    return false;
  }

  if (!isDenseArray(m.posts) || !isDenseArray(m.excludedPosts)) return false;
  for (const it of m.excludedPosts) {
    if (!isRecordWithStringKeys(it, ['postId'])) return false;
  }

  // manifest が JSON の投稿・アセットと 1 対 1 で対応することまで見る。形だけ整った manifest を
  // 付けただけの入力を通すと、projection を経ていないオブジェクトが ZIP に流れる
  const jsonPosts = isDenseArray(downloadObj.posts) ? (downloadObj.posts as Record<string, unknown>[]) : [];
  if (m.posts.length !== jsonPosts.length) return false;
  // 件数は JSON 側の定義 (postCount = 投稿数、fileCount = 添付数。カバーを含めない) と一致する
  if (downloadObj.postCount !== jsonPosts.length) return false;
  let totalFiles = 0;
  for (const it of jsonPosts) {
    totalFiles += Array.isArray(it?.files) ? it.files.length : 0;
  }
  if (downloadObj.fileCount !== totalFiles) return false;

  const selectedPostIds = toSet(selection.postIds as string[]);
  const selectedExtensions = toSet(selection.extensions as string[]);
  const includeCover = selection.includeCover;
  // 除外された投稿が選択集合に入っていてはいけない (excludedPosts の網羅性は、projection 後の
  // JSON に元の投稿一覧が残らないので検証できない)
  for (const it of m.excludedPosts) {
    if (selectedPostIds.has((it as Record<string, unknown>).postId as string)) return false;
  }
  // manifest.posts は収集順と定義しているので、同じ index の投稿と突き合わせる
  for (let index = 0; index < m.posts.length; index++) {
    const post = m.posts[index];
    if (!isRecordWithStringKeys(post, ['postId', 'archiveDirectory'])) return false;
    const p = post as Record<string, unknown>;
    const jsonPost = jsonPosts[index];
    if (p.postId !== jsonPost?.postId) return false;
    if (p.archiveDirectory !== jsonPost?.encodedName) return false;
    if (jsonPost?.bodyIncluded !== selection.includeBody) return false;
    if (!isManifestAssetArray(p.included, true) || !isManifestAssetArray(p.excluded, false)) return false;
    // 出力に載っている投稿は選択されていなければならない
    if (!selectedPostIds.has(p.postId as string)) return false;
    if (!isManifestSelectionConsistent(p, selectedExtensions, includeCover)) return false;
    if (!isManifestPostConsistent(p, jsonPost)) return false;
  }
  return true;
}

/**
 * manifest の投稿 1 件が、記録された選択条件と矛盾していないか。
 *
 * 選択条件と含めた / 除外したアセットが食い違う manifest は、「どういう条件でこの ZIP を
 * 作ったか」の記録として成立しない
 * @param manifestPost manifest 側の投稿
 * @param selectedExtensions 選択された拡張子 (正規化済み)
 * @param includeCover カバーを含める指定か
 * @internal
 */
function isManifestSelectionConsistent(
  manifestPost: Record<string, unknown>,
  selectedExtensions: ReadonlySet<string>,
  includeCover: boolean,
): boolean {
  const included = manifestPost.included as Record<string, unknown>[];
  const excluded = manifestPost.excluded as Record<string, unknown>[];
  const matchesExtension = (asset: Record<string, unknown>) =>
    selectedExtensions.has(normalizeExtension(asset.extension as string));
  // カバーの扱いは includeCover ひとつで決まる。拡張子の選択はカバーには適用しない
  for (let index = 0; index < included.length; index++) {
    const asset = included[index];
    if (asset.kind === 'cover') {
      if (!includeCover) return false;
    } else if (!matchesExtension(asset)) {
      return false;
    }
  }
  for (let index = 0; index < excluded.length; index++) {
    const asset = excluded[index];
    if (asset.kind === 'cover') {
      if (includeCover) return false;
    } else if (matchesExtension(asset)) {
      return false;
    }
  }
  return true;
}

/**
 * manifest の投稿 1 件が、JSON の同じ投稿と 1 対 1 で対応しているか。
 *
 * 「含めた」と主張するアセットが実際に ZIP へ入る対象と一致しなければ、この記録は
 * 「この ZIP に何を入れたか」を表していない
 * @param manifestPost manifest 側の投稿
 * @param jsonPost JSON 側の投稿
 * @internal
 */
function isManifestPostConsistent(manifestPost: Record<string, unknown>, jsonPost: Record<string, unknown>): boolean {
  const included = manifestPost.included as Record<string, unknown>[];
  const excluded = manifestPost.excluded as Record<string, unknown>[];

  // 同じアセットを含めたと除外したの両方に載せない
  const identities = new Set<string>();
  let identityCount = 0;
  for (const assets of [included, excluded]) {
    for (let index = 0; index < assets.length; index++) {
      identities.add(`${assets[index].kind}:${assets[index].assetId ?? ''}`);
      identityCount++;
    }
  }
  if (identities.size !== identityCount) return false;

  const includedCovers: Record<string, unknown>[] = [];
  const includedFiles: Record<string, unknown>[] = [];
  for (let index = 0; index < included.length; index++) {
    (included[index].kind === 'cover' ? includedCovers : includedFiles).push(included[index]);
  }
  const cover = jsonPost.cover as Record<string, unknown> | undefined;
  if (cover === undefined) {
    if (includedCovers.length !== 0) return false;
  } else if (includedCovers.length !== 1 || includedCovers[0].archiveName !== cover.name) {
    return false;
  }

  if (!isDenseArray(jsonPost.files)) return false;
  const files: Record<string, unknown>[] = [];
  for (let index = 0; index < jsonPost.files.length; index++) {
    files.push((jsonPost.files as Record<string, unknown>[])[index]);
  }
  if (includedFiles.length !== files.length) return false;
  for (const entry of includedFiles) {
    const index = files.findIndex(
      (it) => it.encodedName === entry.archiveName && it.originalName === entry.originalName,
    );
    if (index < 0) return false;
    files.splice(index, 1);
  }
  return true;
}

/**
 * 配列を index で読んで Set にする。入力配列の iterator を呼ばない
 * @param source 検証済みの配列
 * @internal
 */
function toSet(source: readonly string[]): Set<string> {
  const set = new Set<string>();
  for (let index = 0; index < source.length; index++) {
    set.add(source[index]);
  }
  return set;
}

/**
 * hole の無い配列か。
 *
 * `every` / `some` / `reduce` は hole を飛ばすので、`new Array(3)` のような疎配列は
 * どんな述語でも通ってしまう。書き出すと `[null, null, null]` になるし、後段で要素を
 * 参照した時点で例外になる。要素検証の前に密であることを確かめる
 * @param value 検証対象
 * @internal
 */
function isDenseArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

/** 文字列だけの、hole の無い配列か */
function isStringArray(value: unknown): value is string[] {
  if (!isDenseArray(value)) return false;
  for (let index = 0; index < value.length; index++) {
    if (typeof value[index] !== 'string') return false;
  }
  return true;
}

/** 指定のキーがすべて文字列であるオブジェクトか */
function isRecordWithStringKeys(value: unknown, keys: string[]): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return keys.every((key) => typeof record[key] === 'string');
}

/**
 * ManifestAsset の配列か
 * @param value 検証対象
 * @param requireArchiveName 含めたアセットなら archiveName を必須にする (除外なら持たないことを求める)
 */
function isManifestAssetArray(value: unknown, requireArchiveName: boolean): boolean {
  if (!isDenseArray(value)) return false;
  const isValidAsset = (it: unknown) => {
    if (!isRecordWithStringKeys(it, ['originalName', 'extension'])) return false;
    const asset = it as Record<string, unknown>;
    if (asset.kind !== 'cover' && asset.kind !== 'image' && asset.kind !== 'file') return false;
    // カバーは id を持たない。それ以外は文字列の assetId を持つ
    if (asset.kind === 'cover' ? asset.assetId !== undefined : typeof asset.assetId !== 'string') return false;
    return requireArchiveName ? typeof asset.archiveName === 'string' : asset.archiveName === undefined;
  };
  for (let index = 0; index < value.length; index++) {
    if (!isValidAsset(value[index])) return false;
  }
  return true;
}

/**
 * ZIP ルート直下に必ず書かれるファイル名。投稿ディレクトリ名として使えない
 * @internal
 */
const RESERVED_ROOT_ENTRY_NAMES = ['index.html', 'download-manifest.json'];

/**
 * 投稿ディレクトリ直下に必ず書かれるファイル名。アセットの archive 名として使えない。
 *
 * `post.json` は投稿メタデータ、`index.html` は本文の固定名として予約する。
 * ライブラリが生成するファイルとの衝突であり、legacy allocator のアセット同士の衝突とは別の問題である。
 * @internal
 */
const POST_METADATA_FILE_NAME = 'post.json';
const RESERVED_POST_ENTRY_NAMES = ['index.html', POST_METADATA_FILE_NAME];

/**
 * 投稿ディレクトリ直下の固定ファイルと衝突する名前を弾く。
 *
 * 同じパスに 2 つのエントリが入り、展開実装によって投稿 HTML か投稿メタデータか
 * アセットのいずれかが失われる
 * @param name 検証対象の archive 名
 * @param field エラーメッセージに含めるフィールド名
 * @internal
 */
function assertNotReservedPostEntryName(name: string, field: string): void {
  if (RESERVED_POST_ENTRY_NAMES.includes(normalizeForReservedComparison(name))) {
    throw new Error(`downloadZip: ${field} が投稿ディレクトリの予約名と衝突しています (${name})`);
  }
}

/**
 * 予約名と比較するための正規化。
 *
 * Windows と既定の macOS は大文字小文字を区別せず、Windows は末尾の空白とピリオドを
 * 取り除いてから解釈する。完全一致だけで比べると `INDEX.HTML` や `index.html.` が
 * すり抜けて、それらの環境で展開できない ZIP になる
 * @param name 投稿ディレクトリ名
 * @internal
 */
function normalizeForReservedComparison(name: string): string {
  return name.replace(/[ .]+$/, '').toLowerCase();
}

/**
 * manifest を一度だけ読んで、素のオブジェクトと配列に写す。
 *
 * 値の妥当性はここでは見ない (写した結果を `isDownloadManifest` が検証する)。目的は
 * 「検証したものと書き出すものを同一にする」ことで、getter や `toJSON`、差し替えた配列
 * メソッドが検証の後にもう一度評価される余地を無くす。
 * 各フィールドは 1 回だけ読み、配列は index で読んで素の配列に写す
 * @param value 未検証の manifest
 * @internal
 */
function snapshotManifest(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const m = value as Record<string, unknown>;
  const selection = m.selection;
  const selectionRecord =
    typeof selection === 'object' && selection !== null ? (selection as Record<string, unknown>) : undefined;
  return {
    schemaVersion: m.schemaVersion,
    creatorId: m.creatorId,
    generatedAt: m.generatedAt,
    selection: selectionRecord
      ? {
          postIds: snapshotArray(selectionRecord.postIds, (it) => it),
          extensions: snapshotArray(selectionRecord.extensions, (it) => it),
          includeCover: selectionRecord.includeCover,
          includeBody: selectionRecord.includeBody,
        }
      : selection,
    posts: snapshotArray(m.posts, snapshotManifestPost),
    excludedPosts: snapshotArray(m.excludedPosts, (it) => snapshotFields(it, ['postId'])),
  };
}

/**
 * manifest の投稿 1 件を写す
 * @param value 未検証の投稿
 * @internal
 */
function snapshotManifestPost(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const p = value as Record<string, unknown>;
  const asset = (it: unknown) => snapshotFields(it, ['kind', 'assetId', 'originalName', 'extension', 'archiveName']);
  return {
    postId: p.postId,
    archiveDirectory: p.archiveDirectory,
    included: snapshotArray(p.included, asset),
    excluded: snapshotArray(p.excluded, asset),
  };
}

/**
 * 指定のキーだけを 1 回ずつ読んで素のオブジェクトに写す
 * @param value 未検証の値
 * @param keys 写すキー
 * @internal
 */
function snapshotFields(value: unknown, keys: string[]): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const record = value as Record<string, unknown>;
  const copied: Record<string, unknown> = {};
  for (const key of keys) {
    if (Object.hasOwn(record, key)) {
      copied[key] = record[key];
    }
  }
  return copied;
}

/**
 * 配列を index で読んで素の配列に写す。配列でなければそのまま返す (検証が弾く)。
 * hole は undefined として写る
 * @param value 未検証の値
 * @param project 要素の変換
 * @internal
 */
function snapshotArray(value: unknown, project: (item: unknown) => unknown): unknown {
  if (!Array.isArray(value)) return value;
  const copied: unknown[] = [];
  for (let index = 0; index < value.length; index++) {
    copied.push(project(value[index]));
  }
  return copied;
}

/**
 * 検証済みのフィールドだけから manifest を組み直す。
 *
 * 検証は必須フィールドの有無と型しか見ないので、未知のプロパティはそのまま残る。
 * 受け取った manifest をそのまま直列化すると、URL を持たせた入力がそのまま
 * `download-manifest.json` に書き出されてしまう (getter や toJSON も同じ経路で効く)。
 * schema が定めるフィールドだけを写して書く
 * @param manifest 検証済みの manifest
 * @internal
 */
function toCanonicalManifest(manifest: DownloadManifest): DownloadManifest {
  const identity = (asset: ManifestAsset) =>
    asset.kind === 'cover' ? ({ kind: 'cover' } as const) : { kind: asset.kind, assetId: asset.assetId };
  const asset = (it: ManifestAsset): ManifestAsset => ({
    ...identity(it),
    originalName: it.originalName,
    extension: it.extension,
  });
  return {
    schemaVersion: 1,
    creatorId: manifest.creatorId,
    generatedAt: manifest.generatedAt,
    selection: {
      postIds: copyArray(manifest.selection.postIds, (it) => it),
      extensions: copyArray(manifest.selection.extensions, (it) => it),
      includeCover: manifest.selection.includeCover,
      includeBody: manifest.selection.includeBody,
    },
    posts: copyArray(manifest.posts, (post) => ({
      postId: post.postId,
      archiveDirectory: post.archiveDirectory,
      included: copyArray(post.included, (it) => ({ ...asset(it), archiveName: it.archiveName })),
      excluded: copyArray(post.excluded, asset),
    })),
    excludedPosts: copyArray(manifest.excludedPosts, (it) => ({ postId: it.postId })),
  };
}

/** 投稿ディレクトリへ書く、保存物と対応したメタデータを作る。 */
function createPostMetadata(
  downloadObj: DownloadJsonObj,
  post: DownloadJsonObj['posts'][number],
  manifestPost: DownloadManifest['posts'][number],
): string {
  return JSON.stringify(
    {
      schemaVersion: 1,
      postId: post.postId,
      creatorId: downloadObj.id,
      title: post.originalName,
      url: `https://www.fanbox.cc/@${downloadObj.id}/posts/${post.postId}`,
      publishedDatetime: post.publishedDatetime ?? null,
      updatedDatetime: post.updatedDatetime ?? null,
      postType: post.postType ?? null,
      tags: [...post.tags],
      body: {
        included: post.bodyIncluded,
        storedFilename: post.bodyIncluded ? 'index.html' : null,
      },
      assets: manifestPost.included.map((asset) => ({
        kind: asset.kind,
        ...(asset.kind === 'cover' ? {} : { assetId: asset.assetId }),
        originalFilename: `${asset.originalName}${asset.extension}`,
        extension: asset.extension,
        storedFilename: asset.archiveName,
      })),
    },
    null,
    2,
  );
}

/**
 * 配列を index で読んで新しい素の配列に写す。
 *
 * 入力配列の `map` や iterator を呼ばない。Array の派生クラスで `map` を差し替えたり
 * `Symbol.species` を細工したりすると、写した先に `toJSON` や未知プロパティを混ぜ込めるため
 * @param source 写す元 (検証済みで hole が無いこと)
 * @param project 要素の変換
 * @internal
 */
function copyArray<T, R>(source: readonly T[], project: (item: T) => R): R[] {
  const copied: R[] = [];
  for (let index = 0; index < source.length; index++) {
    copied.push(project(source[index]));
  }
  return copied;
}

/**
 * 2桁ゼロ埋め
 * @internal
 */
function pad2(n: number): string {
  return `00${n}`.slice(-2);
}

/**
 * 残り秒数を "h:mm:ss" または "mm:ss" 形式にフォーマットする
 * @internal
 */
function formatRemain(seconds: number): string {
  if (seconds < 0 || !Number.isFinite(seconds)) return '-:--';
  const h = (seconds / 3600) | 0;
  const m = ((seconds - h * 3600) / 60) | 0;
  const s = seconds - h * 3600 - m * 60;
  if (h > 0) return `${h}:${pad2(m)}:${pad2(s)}`;
  return `${pad2(m)}:${pad2(s)}`;
}

/**
 * ダウンロード用のヘルパー
 */
export class DownloadHelper {
  private readonly utils: DownloadUtils;

  /**
   * @param utils ダウンロード用ユーティリティ。
   *   **`encodeFileName` が返す名前は決定的でなければならない**
   *   (同じ引数には同じ名前を返し、副作用を持たず、有効な入力で例外を投げない)。
   *   利用側が自分で picker を開く経路では `preflight` が 2 回走る (利用側の事前実行と `downloadZip`
   *   冒頭の実行)。呼び出しごとに違う名前を返す実装を渡すと 2 回の結果が食い違い、事前検証を通った
   *   のに保存先を確保した後で初めて失敗する。
   *   通信やスリープを行う他のメソッド (`httpGetAs` / `fetchWithLimit` / `sleep` / `embedScript`) は
   *   この要求の対象外である
   */
  constructor(utils: DownloadUtils) {
    this.utils = utils;
  }

  /**
   * bootstrapのCSS情報
   */
  bootCSS = {
    href: 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css',
    integrity: 'sha384-sRIl4kxILFvY47J16cr9ZwB07vP4J8+LH7qKQnuqkuIAvNWLzeN8tE5YBujZqJLB',
  };

  /**
   * bootstrapのjs情報
   */
  bootJS = {
    src: 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/js/bootstrap.bundle.min.js',
    integrity: 'sha384-FKyoEForCGlyvwx9Hj09JcYn3nv7wiPVlz7YYwJrWVcXK/BmnVDxM+D2scQbITxI',
  };

  /**
   * ダウンロード用のUIを作成する
   * @param title ダウンローダーの名前
   */
  async createDownloadUI(title: string) {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    document.getElementsByTagName('html')[0].style.height = '100%';
    document.body.style.height = '100%';
    document.body.style.margin = '0';
    document.title = title;

    const bootLink = document.createElement('link');
    bootLink.href = this.bootCSS.href;
    bootLink.rel = 'stylesheet';
    bootLink.integrity = this.bootCSS.integrity;
    bootLink.crossOrigin = 'anonymous';
    document.head.appendChild(bootLink);

    const bodyDiv = document.createElement('div');
    bodyDiv.style.display = 'flex';
    bodyDiv.style.alignItems = 'center';
    bodyDiv.style.justifyContent = 'center';
    bodyDiv.style.flexDirection = 'column';
    bodyDiv.style.height = '100%';
    const inputDiv = document.createElement('div');
    inputDiv.className = 'input-group mb-2';
    inputDiv.style.width = '400px';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-control';
    input.placeholder = 'ここにJSONを貼り付け';
    inputDiv.appendChild(input);
    const button = document.createElement('button');
    button.className = 'btn btn-outline-secondary btn-labeled';
    button.type = 'button';
    button.innerText = 'Download';
    inputDiv.appendChild(button);
    bodyDiv.appendChild(inputDiv);
    const progressDiv = document.createElement('div');
    progressDiv.className = 'progress mb-3';
    progressDiv.style.width = '400px';
    const progress = document.createElement('div');
    progress.className = 'progress-bar';
    progress.style.width = '0%';
    progress.innerText = '0%';
    progressDiv.setAttribute('role', 'progressbar');
    progressDiv.setAttribute('aria-valuemin', '0');
    progressDiv.setAttribute('aria-valuemax', '100');
    progressDiv.setAttribute('aria-valuenow', '0');
    const setProgress = (n: number) => {
      progressDiv.setAttribute('aria-valuenow', `${n}`);
      progress.style.width = `${n}%`;
      progress.innerText = `${n}%`;
    };
    progressDiv.appendChild(progress);
    bodyDiv.appendChild(progressDiv);
    const infoDiv = document.createElement('div');
    infoDiv.style.width = '350px';
    const checkBoxDiv = document.createElement('div');
    checkBoxDiv.className = 'form-check float-start';
    const checkBox = document.createElement('input');
    checkBox.className = 'form-check-input';
    checkBox.type = 'checkbox';
    checkBox.id = 'LogCheck';
    checkBox.checked = true;
    checkBoxDiv.appendChild(checkBox);
    const checkBoxLabel = document.createElement('label');
    checkBoxLabel.className = 'form-check-label';
    checkBoxLabel.setAttribute('for', 'LogCheck');
    checkBoxLabel.innerText = 'ログを自動スクロール';
    checkBoxDiv.appendChild(checkBoxLabel);
    infoDiv.appendChild(checkBoxDiv);
    const remainTimeDiv = document.createElement('div');
    remainTimeDiv.className = 'float-end';
    remainTimeDiv.innerText = '残りおよそ -:--';
    const setRemainTime = (r: string) => (remainTimeDiv.innerText = `残りおよそ ${r}`);
    infoDiv.appendChild(remainTimeDiv);
    bodyDiv.appendChild(infoDiv);
    const textarea = document.createElement('textarea');
    textarea.className = 'form-control';
    textarea.readOnly = true;
    textarea.style.resize = 'both';
    textarea.style.width = '500px';
    textarea.style.height = '80px';
    const textLog = (t: string) => {
      textarea.value += `${t}\n`;
      if (checkBox.checked) {
        textarea.scrollTop = textarea.scrollHeight;
      }
    };
    bodyDiv.appendChild(textarea);
    document.body.appendChild(bodyDiv);

    const bootScript = document.createElement('script');
    bootScript.src = this.bootJS.src;
    bootScript.integrity = this.bootJS.integrity;
    bootScript.crossOrigin = 'anonymous';
    document.body.appendChild(bootScript);
    const downloadFun = this.downloadZip.bind(this);

    button.onclick = async () => {
      button.disabled = true;
      const loadingFun = (event: BeforeUnloadEvent) => (event.returnValue = `downloading`);
      window.addEventListener('beforeunload', loadingFun);
      try {
        await downloadFun(JSON.parse(input.value), setProgress, textLog, setRemainTime);
      } catch (e) {
        textLog('エラー出た');
        console.error(e);
      } finally {
        window.removeEventListener('beforeunload', loadingFun);
      }
    };
  }

  /**
   * ZIPでダウンロード
   *
   * progress / log / remainTime は同期コールバック限定である。戻り値型が void のため async 関数も
   * 型上は渡せてしまうが、呼び出しを await しないので、返された Promise の rejection はこのメソッドの
   * catch (ストリームの abort) に到達せず、未処理 rejection のまま ZIP 生成が継続する。
   * 同期的に throw した場合は catch に入り、書き込み途中ならストリームを abort して再スローする。
   * @param input ダウンロード対象オブジェクト (`DownloadObject.project()` の出力)
   * @param progress 進捗率出力関数 (同期)
   * @param log ログ出力関数 (同期)
   * @param remainTime 終了予測出力関数 (同期)
   * @param options handle/signal/fetchFile を差し替えるためのオプション (省略時は従来どおりの挙動)
   * @returns 処理結果 (Issue #13)。各件数の定義は DownloadZipResult のコメントを参照
   */
  async downloadZip(
    input: unknown,
    progress: (n: number) => void,
    log: (s: string) => void,
    remainTime: (r: string) => void,
    options?: DownloadZipOptions,
  ): Promise<DownloadZipResult> {
    // 入力だけで判定できる失敗はすべてここで出す。picker より前に置くのは、
    // showSaveFilePicker が解決した時点で対象ファイルの中身が空になるため (preflight 参照)。
    // 型の確定した入力を preflight から受け取るのは、ここで検証をやり直すと getter を仕込んだ
    // 入力を 2 回読むことになり「検証した値と書き出す値が同じ」が崩れるため
    const { json: downloadObj, manifest, encodedId, posts: postPlans } = this.preflight(input);
    const utils = this.utils;

    const handle = options?.handle ?? (await showSaveFilePicker({ suggestedName: `${encodedId}.zip` }));
    const writable = await handle.createWritable();
    const zip = new Zip64StreamWriter(writable);

    // createWritable() 以降の ZIP 生成処理全体を try/catch で囲む。fetchFile / log / progress / remainTime は
    // 呼び出し側が渡すコールバックであり、これらが例外を投げても writable が未 close のまま残らないようにする
    // (toUint8Array 内の Blob.arrayBuffer も同様に投げうる)。zip.addFile 等が投げた場合は ZipWriter が内部で
    // 既に abort 済み (terminal) のため、ここでの zip.abort は no-op になる。
    try {
      // 既定 fetchFile も 3 引数の型に揃えておく (options?.fetchFile との ?? の結果が 3 引数の型で
      // 確定するようにするため。2 引数の関数リテラルのままだと fetchFile(url, name, context) の
      // 呼び出しで型検査上の引数過多になる)
      const fetchFile: NonNullable<DownloadZipOptions['fetchFile']> =
        options?.fetchFile ?? ((url: string, name: string) => utils.fetchWithLimit({ url, name }, 1));

      const enqueue = async (fileBits: BlobPart[], path: string, date?: Date) => {
        await zip.addFile(`${encodedId}/${path}`, await toUint8Array(fileBits), date);
      };

      const parsePublishedDate = (iso?: string): Date | undefined => {
        if (!iso) return undefined;
        const d = new Date(iso);
        return Number.isFinite(d.getTime()) ? d : undefined;
      };

      // 選択された全アセットぶんを先に skipped で並べ、書けた / 失敗したものだけ上書きする。
      // 到達しなかった対象も結果として残るので、利用側は「結果が無い」を件数から推測せずに済む
      const assetResults: {
        postIndex: number;
        kind: 'cover' | 'file';
        archiveName: string;
        outcome: AssetWriteOutcome;
      }[] = [];
      const assetResultIndex = new Map<string, number>();
      for (const [postIndex, plan] of postPlans.entries()) {
        if (plan.coverName !== undefined) {
          assetResultIndex.set(`${postIndex}:cover`, assetResults.length);
          assetResults.push({ postIndex, kind: 'cover', archiveName: plan.coverName, outcome: 'skipped' });
        }
        for (const [fileIndex, archiveName] of plan.fileNames.entries()) {
          assetResultIndex.set(`${postIndex}:file:${fileIndex}`, assetResults.length);
          assetResults.push({ postIndex, kind: 'file', archiveName, outcome: 'skipped' });
        }
      }
      const recordAsset = (key: string, outcome: AssetWriteOutcome) => {
        const index = assetResultIndex.get(key);
        if (index !== undefined) assetResults[index].outcome = outcome;
      };

      const startTime = Math.floor(Date.now() / 1000);
      let count = 0;
      let writtenFileCount = 0;
      let failedFileCount = 0;
      let completedPostCount = 0;
      let aborted = false;

      log(`@${downloadObj.id} 投稿:${downloadObj.postCount} ファイル:${downloadObj.fileCount}`);
      // ルートディレクトリ (日時は有効な publishedDatetime の最大値。有効な値が 1 件も無ければ date なし)
      const rootDate = downloadObj.posts.reduce<Date | undefined>((max, post) => {
        const d = parsePublishedDate(post.publishedDatetime);
        if (d === undefined) return max;
        return max === undefined || d.getTime() > max.getTime() ? d : max;
      }, undefined);
      await zip.addDirectory(`${encodedId}/`, rootDate);
      // ルートhtml もルートディレクトリと同じ rootDate を与える (date 省略時は DOS date 0 となり、
      // 展開時に 1980-01-01 より前の不正な日時になるため)
      await enqueue([this.createRootHtmlFromPosts(downloadObj)], 'index.html', rootDate);
      // 選択条件と、含めた / 除外した対象の記録。info JSON (FANBOX の投稿メタデータ) とは
      // 出所が違うので混ぜない
      await enqueue([JSON.stringify(toCanonicalManifest(manifest), null, 2)], 'download-manifest.json', rootDate);
      // 投稿処理
      let postCount = 0;
      postLoop: for (const [postIndex, post] of downloadObj.posts.entries()) {
        if (options?.signal?.aborted) {
          aborted = true;
          break;
        }
        // archive 名は preflight が検証したものをそのまま使う。ここで組み立て直すと、
        // 検証した名前と実際に書く名前が別々に決まる
        const plan = postPlans[postIndex];
        log(`${post.originalName} (${++postCount}/${downloadObj.postCount})`);
        const postDate = parsePublishedDate(post.publishedDatetime);
        // 投稿ディレクトリ (配下ファイルより前に書く)
        await zip.addDirectory(`${encodedId}/${plan.directory}/`, postDate);
        // 投稿メタデータは本文を選ばなかった場合も保存する。
        await enqueue(
          [createPostMetadata(downloadObj, post, manifest.posts[postIndex])],
          `${plan.directory}/${plan.metadataFileName}`,
          postDate,
        );
        if (post.bodyIncluded) {
          await enqueue(
            [this.createHtmlFromBody(post.originalName, post.htmlText)],
            `${plan.directory}/index.html`,
            postDate,
          );
        }
        // カバー画像
        if (post.cover && plan.coverName !== undefined) {
          const coverName = plan.coverName;
          log(`download ${coverName}`);
          const blob = await fetchFile(post.cover.url, coverName, { kind: 'cover' });
          if (blob) {
            await enqueue([blob], `${plan.directory}/${coverName}`, postDate);
            writtenFileCount++;
            recordAsset(`${postIndex}:cover`, 'written');
          } else if (options?.signal?.aborted) {
            // 中断による null は通信失敗ではないので failedFileCount に数えない。
            // この投稿はカバーを書き終えていないので completedPostCount にも含めない
            aborted = true;
            break;
          } else {
            failedFileCount++;
            recordAsset(`${postIndex}:cover`, 'failed');
            console.error(`${coverName}(${post.cover.url})のダウンロードに失敗、読み飛ばすよ`);
            log(`${coverName}のダウンロードに失敗`);
          }
        }
        // ファイル処理
        let fileCount = 0;
        for (const [fileIndex, file] of post.files.entries()) {
          if (options?.signal?.aborted) {
            aborted = true;
            break postLoop;
          }
          const fileName = plan.fileNames[fileIndex];
          log(`download ${fileName} (${++fileCount}/${post.files.length})`);
          const blob = await fetchFile(file.url, fileName, { kind: 'file' });
          if (blob) {
            await enqueue([blob], `${plan.directory}/${fileName}`, postDate);
            writtenFileCount++;
            recordAsset(`${postIndex}:file:${fileIndex}`, 'written');
          } else if (options?.signal?.aborted) {
            // 中断による null は通信失敗ではないので failedFileCount に数えない
            aborted = true;
            break postLoop;
          } else {
            failedFileCount++;
            recordAsset(`${postIndex}:file:${fileIndex}`, 'failed');
            console.error(`${fileName}(${file.url})のダウンロードに失敗、読み飛ばすよ`);
            log(`${fileName}のダウンロードに失敗`);
          }
          count++;
          const elapsedSec = Math.max(1, Math.floor(Date.now() / 1000) - startTime);
          const remain = Math.floor((elapsedSec * (downloadObj.fileCount - count)) / count);
          remainTime(formatRemain(remain));
          progress(((count * 100) / downloadObj.fileCount) | 0);
          await utils.sleep(100);
        }
        // HTML + カバー + 添付すべてを打ち切りなく処理し終えた投稿のみ完了として数える
        completedPostCount++;
      }
      if (!aborted) {
        if (failedFileCount > 0) {
          log(`完了 (${failedFileCount}件のダウンロードに失敗)`);
        } else {
          log('完了');
        }
      }
      await zip.close();
      return {
        completedPostCount,
        totalPostCount: downloadObj.posts.length,
        writtenFileCount,
        failedFileCount,
        aborted,
        assets: assetResults,
      };
    } catch (e) {
      await zip.abort(e);
      throw e;
    }
  }

  /**
   * ZIP 生成の前に、入力の構造と archive 名から判定できる失敗を洗い出す。
   *
   * **`showSaveFilePicker` は解決した時点で対象ファイルの中身を空にする。** 新規なら 0 バイトで
   * 作成し、既存ファイルを選べばその内容を消す (File System Access 仕様 3.4 の
   * "Set entry's binary data to an empty byte sequence")。保存先を確保してから入力の不備で
   * 落ちると、書くものが無いまま利用者のファイルだけが空になる。
   *
   * 見るのは、型・パスセグメント・予約名・衝突・エントリ名のバイト長・固定で書かれるエントリ数、
   * および名前と固定ヘッダだけを積んだ central directory の offset / size の下限である。
   * **生成物の本文サイズと日時 extra field は積まない** ので、名前は収まるのに本文の大きさで
   * ZIP32 の上限に達する入力は通ってしまう。積まないのは、本文まで見積もり始めると生成物を丸ごと
   * 保持する形 (Issue #53 の snapshot 化) へ踏み込むことになり、この API の役割を超えるためである。
   *
   * `downloadZip` は自分で picker を開く場合にそれより前でこれを実行するが、`options.handle` を
   * 渡す利用側は自分で picker を呼ぶので、その前に自分でこれを呼ぶ必要がある。
   * その経路では **`preflight` は 2 回走る** (利用側の事前実行と、`downloadZip` 冒頭の実行)。
   * 2 回の結果が一致することは、入力が素の値であることと、utils が返す名前が決定的であることに依る。
   *
   * 入力を変更しない。`downloadZip` の冒頭からも呼ぶので、利用側が呼び忘れても検証は抜けない。
   * 逆に、利用側が事前に通した結果を `downloadZip` へ渡して検証を省く口は用意しない。
   * 結果に発行元の印を付けても、`json` の中身が `preflight` の後に書き換えられていないことまでは
   * 確かめられない。省ける形にすると、検証を通っていない値をそのまま ZIP にする経路ができる。
   * 入力は `project()` の出力である契約 (素の値) なので、同じ入力に対する再実行は同じ結果になる。
   *
   * **picker の待機中に入力そのものが書き換えられた場合までは守れない** (Issue #53)。
   * `downloadZip` は待機の後にも投稿の並び・本文・URL を読む。
   * @param downloadObj `DownloadObject.project()` の出力
   * @returns 検証を通った入力と manifest の写し
   * @throws {Error} ZIP 入力として受け付けられない場合
   */
  preflight(downloadObj: unknown): PreflightResult {
    if (!this.isDownloadJsonObj(downloadObj)) throw new Error('ダウンロード対象オブジェクトの型が不正');
    const encodedId = this.utils.encodeFileName(downloadObj.id);
    if (!isValidPathSegment(encodedId)) {
      throw new Error(`downloadZip: id が不正な値です (encode 後: ${JSON.stringify(encodedId)})`);
    }
    // 写しを取ったら元の manifest は読み直さず、以降は写しだけを検証・書き出しに使う。
    // 検証と書き出しで別々に読むと、値を返す getter を仕込まれたときに「検証を通った値」と
    // 「書き出される値」が食い違う (isDownloadJsonObj が既に 1 回読んでいるので、
    // 「入力を通して 1 回しか読まない」ことまでは保証しない)
    const manifest = snapshotManifest(downloadObj.manifest);
    if (!isDownloadManifest(manifest, downloadObj as unknown as Record<string, unknown>)) {
      throw new Error('downloadZip: manifest が不正です (projection を経ていない可能性があります)');
    }

    const seenEncodedNames = new Set<string>();
    const posts: PostWritePlan[] = [];
    for (const post of downloadObj.posts) {
      if (!isValidPathSegment(post.encodedName)) {
        throw new Error(`downloadZip: post.encodedName が不正な値です (${JSON.stringify(post.encodedName)})`);
      }
      if (seenEncodedNames.has(post.encodedName)) {
        throw new Error(`downloadZip: post.encodedName が重複しています (${post.encodedName})`);
      }
      // ルート直下の固定ファイルと同名の投稿ディレクトリを作ると、同じパスがファイルと
      // ディレクトリの両方になり展開できない ZIP になる
      if (RESERVED_ROOT_ENTRY_NAMES.includes(normalizeForReservedComparison(post.encodedName))) {
        throw new Error(`downloadZip: post.encodedName がルートの予約名と衝突しています (${post.encodedName})`);
      }
      seenEncodedNames.add(post.encodedName);
      if (post.cover !== undefined && !isValidPathSegment(post.cover.name)) {
        throw new Error(`downloadZip: post.cover.name が不正な値です (${JSON.stringify(post.cover.name)})`);
      }
      for (const file of post.files) {
        if (!isValidPathSegment(file.encodedName)) {
          throw new Error(`downloadZip: file.encodedName が不正な値です (${JSON.stringify(file.encodedName)})`);
        }
        assertNotReservedPostEntryName(file.encodedName, 'file.encodedName');
      }
      if (post.cover !== undefined) {
        assertNotReservedPostEntryName(post.cover.name, 'post.cover.name');
      }
      const metadataFileName = POST_METADATA_FILE_NAME;
      if (!isValidPathSegment(metadataFileName)) {
        throw new Error(`downloadZip: 投稿メタデータ名が不正な値です (${JSON.stringify(metadataFileName)})`);
      }
      // 投稿ディレクトリ直下の他の名前と衝突すると、同じパスに 2 エントリ入ってどちらかが失われる。
      // アセット名が 'post.json' に寄る向きは assertNotReservedPostEntryName が既に塞いでいるので、
      // ここでは投稿メタデータ名が他へ寄る向きだけを見る。
      // アセット同士の衝突は legacy allocator が作りうるものとして許容しているのでここでは扱わない
      const normalizedMetadataFileName = normalizeForReservedComparison(metadataFileName);
      const siblingNames = [
        'index.html',
        ...(post.cover !== undefined ? [post.cover.name] : []),
        ...post.files.map((file) => file.encodedName),
      ];
      for (const sibling of siblingNames) {
        if (normalizeForReservedComparison(sibling) === normalizedMetadataFileName) {
          throw new Error(
            `downloadZip: 投稿メタデータ名が同じ投稿の ${sibling} と衝突しています (${metadataFileName})`,
          );
        }
      }
      // 検証した名前をそのまま計画に載せる。downloadZip 側で組み立て直すと、
      // 検証した名前と実際に書く名前が別々に決まることになる
      posts.push({
        directory: post.encodedName,
        metadataFileName,
        bodyIncluded: post.bodyIncluded,
        ...(post.cover !== undefined ? { coverName: post.cover.name } : {}),
        fileNames: post.files.map((file) => file.encodedName),
      });
    }

    const result: PreflightResult = { json: downloadObj, manifest, encodedId, posts };
    assertZipLimitsFromInput(result);
    return result;
  }

  /**
   * 型検証
   * @param target 検証対象
   */
  isDownloadJsonObj(target: unknown): target is DownloadJsonObj {
    if (typeof target !== 'object' || target === null) {
      console.error('ダウンロード用オブジェクトの型が不正(対象がobjectでない)', target);
      return false;
    }
    const t = target as Record<string, unknown>;
    switch (true) {
      case typeof t.postCount !== 'number':
        console.error('ダウンロード用オブジェクトの型が不正(postCountが数値でない)', t.postCount);
        return false;
      case typeof t.fileCount !== 'number':
        console.error('ダウンロード用オブジェクトの型が不正(fileCountが数値でない)', t.fileCount);
        return false;
      case typeof t.id !== 'string':
        console.error('ダウンロード用オブジェクトの型が不正(idが文字列でない)', t.id);
        return false;
      case typeof t.url !== 'string':
        console.error('ダウンロード用オブジェクトの型が不正(urlが文字列でない)', t.url);
        return false;
      case !Array.isArray(t.posts):
        console.error('ダウンロード用オブジェクトの型が不正(postsが配列でない)', t.posts);
        return false;
      case !isStringArray(t.tags):
        console.error('ダウンロード用オブジェクトの型が不正(tagsが文字列の配列でない)', t.tags);
        return false;
    }
    const postsInvalid = (t.posts as unknown[]).some((it: unknown) => {
      if (typeof it !== 'object' || it === null) {
        console.error('ダウンロード用オブジェクトの型が不正(postsの値にobjectでないものが含まれる)', it, t.posts);
        return true;
      }
      const p = it as Record<string, unknown>;
      switch (true) {
        case typeof p.postId !== 'string':
          console.error('ダウンロード用オブジェクトの型が不正(postsの値にpostIdが文字列でないものが含まれる)');
          return true;
        case typeof p.bodyIncluded !== 'boolean':
          console.error('ダウンロード用オブジェクトの型が不正(postsの値にbodyIncludedがbooleanでないものが含まれる)');
          return true;
        case typeof p.informationText !== 'string':
          console.error(
            'ダウンロード用オブジェクトの型が不正(postsの値にinformationTextが文字列でないものが含まれる)',
            p.informationText,
            t.posts,
          );
          return true;
        case typeof p.htmlText !== 'string':
          console.error(
            'ダウンロード用オブジェクトの型が不正(postsの値にhtmlTextが文字列でないものが含まれる)',
            p.htmlText,
            t.posts,
          );
          return true;
        case !Array.isArray(p.files):
          console.error(
            'ダウンロード用オブジェクトの型が不正(postsの値にfilesが配列でないものが含まれる)',
            p.files,
            t.posts,
          );
          return true;
        case !isStringArray(p.tags):
          console.error(
            'ダウンロード用オブジェクトの型が不正(postsの値にtagsが文字列の配列でないものが含まれる)',
            p.tags,
            t.posts,
          );
          return true;
        // originalName は escapeHtml / createHtmlFromBody に渡るので、文字列でないと ZIP 生成中に落ちる
        case typeof p.originalName !== 'string':
          console.error(
            'ダウンロード用オブジェクトの型が不正(postsの値にoriginalNameが文字列でないものが含まれる)',
            p.originalName,
            t.posts,
          );
          return true;
        case (p.files as unknown[]).some((f: unknown) => {
          if (typeof f !== 'object' || f === null) {
            console.error(
              'ダウンロード用オブジェクトの型が不正(postsのfilesの値にオブジェクトでないものが含まれる)',
              f,
              p.files,
            );
            return true;
          }
          const fo = f as Record<string, unknown>;
          switch (true) {
            case typeof fo.url !== 'string':
              console.error(
                'ダウンロード用オブジェクトの型が不正(postsのfilesの値にurlが文字列でないものが含まれる)',
                fo.url,
                p.files,
              );
              return true;
            case typeof fo.originalName !== 'string':
              console.error(
                'ダウンロード用オブジェクトの型が不正(postsのfilesの値にoriginalNameが文字列でないものが含まれる)',
                fo.originalName,
                p.files,
              );
              return true;
            case typeof fo.encodedName !== 'string':
              console.error(
                'ダウンロード用オブジェクトの型が不正(postsのfilesの値にencodedNameが文字列でないものが含まれる)',
                fo.encodedName,
                p.files,
              );
              return true;
            default:
              return false;
          }
        }):
          return true;
      }
      // publishedDatetime検証 (optional、文字列か undefined のみ許容)
      if (p.publishedDatetime !== undefined && typeof p.publishedDatetime !== 'string') {
        console.error(
          'ダウンロード用オブジェクトの型が不正(postsの値にpublishedDatetimeが文字列でないものが含まれる)',
          p.publishedDatetime,
          t.posts,
        );
        return true;
      }
      if (p.updatedDatetime !== undefined && typeof p.updatedDatetime !== 'string') return true;
      if (p.postType !== undefined && typeof p.postType !== 'string') return true;
      // cover検証 (filesとは独立して検証)
      const cover = p.cover as Record<string, unknown> | null | undefined;
      if (cover !== undefined) {
        if (typeof cover !== 'object' || cover === null) {
          console.error(
            'ダウンロード用オブジェクトの型が不正(postsの値にcoverがobjectでないものが含まれる)',
            cover,
            t.posts,
          );
          return true;
        }
        if (typeof cover.url !== 'string') {
          console.error(
            'ダウンロード用オブジェクトの型が不正(postsのcoverの値にurlが文字列でないものが含まれる)',
            cover.url,
            cover,
          );
          return true;
        }
        if (typeof cover.name !== 'string') {
          console.error(
            'ダウンロード用オブジェクトの型が不正(postsのcoverの値にnameが文字列でないものが含まれる)',
            cover.name,
            cover,
          );
          return true;
        }
      }
      return false;
    });
    if (postsInvalid) return false;
    // manifest の検証は投稿の型検証を通してから行う。先に行うと、壊れた posts / cover を
    // 参照して型ガードが例外を投げてしまう
    if (!isDownloadManifest(t.manifest, t)) {
      // projection を経ていないオブジェクトはここで弾く。絞り込みを経ずに ZIP にすると、
      // HTML の参照と実際に入るファイルがずれうる
      console.error('ダウンロード用オブジェクトの型が不正(manifestが無いか形式が違う)', t.manifest);
      return false;
    }
    return true;
  }

  /**
   * ルートのhtmlを作成する
   * @param downloadObj ルートObject
   */
  createRootHtmlFromPosts(downloadObj: DownloadJsonObj): string {
    const escapedId = this.utils.escapeHtml(downloadObj.id);
    const escapedUrl = this.utils.escapeHtml(downloadObj.url);
    const tagCheckboxes = downloadObj.tags
      .map((tag, i) => {
        const escaped = this.utils.escapeHtml(tag);
        return (
          `<li><div class="form-check mx-1">\n` +
          `<input class="form-check-input tag-filter" type="checkbox" value="${escaped}" id="box${i + 1}">\n` +
          `<label class="form-check-label" for="box${i + 1}">${escaped}</label>\n` +
          `</div></li>\n`
        );
      })
      .join('');
    const header =
      `<!DOCTYPE html>\n<html lang="ja">\n<head>\n<meta charset="utf-8" />\n<title>${escapedId}</title>\n` +
      `<link href="${this.bootCSS.href}" rel="stylesheet" integrity="${this.bootCSS.integrity}" crossOrigin="anonymous">\n` +
      '<style>div.main{width: 600px; float: none; margin: 65px auto 0}div.root{width: 400px}div.post{width: 600px}' +
      'a.hl,a.hl:hover{color: inherit;text-decoration: none;}div.card{float: none; margin: 0 auto;}' +
      'img.gray-card{height: 210px;background-color: gray;}' +
      'div.gray-carousel{height: 210px; width: 400px;background-color: gray;}' +
      'img.pd-carousel{height: 210px; padding: 15px;}</style>\n' +
      `</head>\n<body>\n<div class="main" id="main">\n`;
    const body =
      `<nav class="navbar navbar-expand-lg bg-dark fixed-top" data-bs-theme="dark"><div class="container-fluid">\n` +
      `<a class="navbar-brand" href="${escapedUrl}">${escapedId}</a>\n` +
      `<button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#dd" aria-controls="dd" aria-expanded="false" aria-label="Toggle navigation">\n` +
      `<span class="navbar-toggler-icon"></span>\n` +
      `</button>\n` +
      `<div class="collapse navbar-collapse" id="dd"><ul class="navbar-nav">\n` +
      `<li class="nav-item dropdown">\n` +
      `<a class="nav-link dropdown-toggle" href="#" id="navbarDarkDropdownMenuLink" role="button" data-bs-toggle="dropdown" aria-expanded="false">Tags</a>\n` +
      `<ul class="dropdown-menu dropdown-menu-dark" aria-labelledby="dd">\n` +
      tagCheckboxes +
      `</ul>\n</li>\n</ul></div>\n</div></nav>\n\n` +
      downloadObj.posts
        .filter((post) => post.bodyIncluded)
        .map(
          (post) =>
            `<div class="post-item" data-tags="${this.utils.escapeHtml(JSON.stringify(post.tags))}">\n` +
            `<a class="hl" href="./${this.utils.encodeURI(post.encodedName)}/index.html"><div class="root card">\n` +
            this.createCoverHtmlFromPost(post) +
            `<div class="card-body"><h5 class="card-title">${this.utils.escapeHtml(post.originalName)}</h5></div>\n</div></a><br>\n</div>\n`,
        )
        .join('\n');
    const footer =
      `\n</div>\n` +
      `<script>\n` +
      `document.addEventListener('DOMContentLoaded', function() {\n` +
      `  var checkboxes = document.querySelectorAll('.tag-filter');\n` +
      `  var posts = document.querySelectorAll('.post-item');\n` +
      `  function updateVisibility() {\n` +
      `    var selected = Array.from(checkboxes)\n` +
      `      .filter(function(cb) { return cb.checked; })\n` +
      `      .map(function(cb) { return cb.value; });\n` +
      `    posts.forEach(function(post) {\n` +
      `      var tags = JSON.parse(post.getAttribute('data-tags'));\n` +
      `      post.style.display = (!selected.length ||\n` +
      `        selected.every(function(s) { return tags.indexOf(s) !== -1; }))\n` +
      `        ? '' : 'none';\n` +
      `    });\n` +
      `  }\n` +
      `  checkboxes.forEach(function(cb) { cb.addEventListener('change', updateVisibility); });\n` +
      `});\n` +
      `</script>\n` +
      `<script src="${this.bootJS.src}" integrity="${this.bootJS.integrity}" crossOrigin="anonymous"></script>\n` +
      '</body></html>';
    return header + body + footer;
  }

  /**
   * cover画像htmlの生成
   * カバー画像が無い場合は投稿画像をスライドショーする
   * @param post 投稿情報オブジェクト
   */
  createCoverHtmlFromPost(post: DownloadJsonObj['posts'][number]): string {
    const postUri = `./${this.utils.encodeURI(post.encodedName)}/`;
    if (post.cover) {
      return `<img class="card-img-top gray-card" src="${postUri}${this.utils.encodeURI(post.cover.name)}" alt="カバー画像"/>\n`;
    }
    const images = post.files.filter((file) => this.utils.isImage(file.encodedName));
    if (images.length > 0) {
      return (
        '<div class="carousel slide" data-bs-ride="carousel" data-interval="1000"><div class="carousel-inner">' +
        '\n<div class="carousel-item active">' +
        images
          .map(
            (img) =>
              '<div class="d-flex justify-content-center gray-carousel">' +
              `<img src="${postUri}${this.utils.encodeURI(img.encodedName)}" class="d-block pd-carousel" height="180px"/></div>`,
          )
          .join('</div>\n<div class="carousel-item">') +
        '</div>\n</div></div>\n'
      );
    } else {
      return `<img class="card-img-top gray-card"/>\n`;
    }
  }

  /**
   * 投稿再現htmlの生成
   * @param title 投稿
   * @param body
   */
  createHtmlFromBody(title: string, body: string): string {
    return (
      `<!DOCTYPE html>\n<html lang="ja">\n<head>\n<meta charset="utf-8" />\n<title>${this.utils.escapeHtml(title)}</title>\n` +
      `<link href="${this.bootCSS.href}" rel="stylesheet" integrity="${this.bootCSS.integrity}" crossOrigin="anonymous">\n` +
      '<style>div.main{width: 600px; float: none; margin: 0 auto}div.root{width: 400px}div.post{width: 600px}' +
      'a.hl,a.hl:hover{color: inherit;text-decoration: none;}div.card{float: none; margin: 0 auto;}' +
      'img.gray-card{height: 210px;background-color: gray;}' +
      'div.gray-carousel{height: 210px; width: 400px;background-color: gray;}' +
      'img.pd-carousel{height: 210px; padding: 15px;}</style>\n' +
      `</head>\n<body>\n<div class="main">\n${body}\n</div>\n` +
      `<script src="${this.bootJS.src}" integrity="${this.bootJS.integrity}" crossOrigin="anonymous"></script>\n` +
      '</body></html>'
    );
  }
}

declare function showSaveFilePicker(options?: {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}): Promise<FileSystemFileHandle>;

export interface FileSystemFileHandle {
  createWritable(): Promise<FileSystemWritableFileStream>;
}

interface FileSystemWritableFileStream extends WritableStream {
  write(data: BufferSource | Blob | string): Promise<void>;
  close(): Promise<void>;
}
