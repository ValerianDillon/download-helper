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
  name: string;
  info: string;
  files: FileObj[];
  html: HtmlFragment[];
  tags: string[];
  cover?: FileObj;
  publishedDatetime?: string;
  /** FANBOX の投稿タイプ。収集結果の絞り込み条件として利用側が読む (この層では使わない) */
  postType?: string;
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

/** 投稿内でアセットを一意に指す鍵。カバーは投稿に高々 1 つなので sentinel で表す */
export type AssetKey = { readonly kind: 'cover' } | BodyAssetKey;

/**
 * AssetKey を凍結した複製にする。
 *
 * identity は登録後に変わってはならない。呼び出し側から渡された参照をそのまま持つと、
 * 追加後に書き換えられて、重複検査を通り抜けた 2 つのアセットが同じ archive path へ
 * 解決しうる。型の readonly は実行時には効かないので複製して凍結する。
 */
function freezeAssetKey(key: AssetKey): AssetKey {
  return Object.freeze(key.kind === 'cover' ? { kind: 'cover' as const } : { kind: key.kind, assetId: key.assetId });
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
  size?: number;
  /** 画像の幅 (image 系のみ) */
  width?: number;
  /** 画像の高さ (image 系のみ) */
  height?: number;
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
 * 投稿 HTML の断片
 *
 * 文字列はそのまま出力する。{ assetRef } はアセットへの参照で、finalize 時に
 * allocator が割り当てた archive path へ解決する。
 */
export type HtmlFragment = string | { readonly assetRef: AssetKey };

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
 */
export type DownloadJsonObj = {
  posts: {
    originalName: string;
    encodedName: string;
    informationText: string;
    htmlText: string;
    files: { url: string; originalName: string; encodedName: string }[];
    tags: string[];
    cover?: { url: string; name: string };
    publishedDatetime?: string;
  }[];
  id: string;
  url: string;
  tags: string[];
  fileCount: number;
  postCount: number;
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
 * 1 投稿分の archive path 割り当て結果
 */
export type AllocatedAssetPaths = {
  /** DownloadJsonObj の files に出す順序で並べた、添付ファイルと割り当て名の組 */
  files: { file: FileObj; archiveName: string }[];
  /** カバー画像の割り当て名。カバーが無ければ undefined */
  coverArchiveName?: string;
};

/**
 * archive path (ZIP 内の名前) の割り当て器
 *
 * 採番規則を知っている場所をここ 1 つに集約する。HTML の生成も JSON の files も
 * この結果だけを参照するので、規則を差し替えても両者がずれない。
 *
 * 実装が満たすべき契約は次のとおりで、`stringify()` (finalize) が破りを検出して例外にする。
 * 黙って通すと、ZIP に入っているのに HTML から参照されないファイルや、参照先が別のアセットに
 * なったリンクが出力に残る。
 *
 * - **決定的であること。** 同じ入力に対して同じ結果を返し、呼び出し回数に依存する状態
 *   (連番カウンタなど) を持たない。`stringify()` は呼ばれるたびに allocator を再実行する
 * - `allocatePostDirectoryNames` は `posts` と同じ長さ・同じ順序の配列を返す
 * - `allocateAssetPaths` は `post.files` の各アセットをちょうど 1 回返す (取りこぼしも重複も、
 *   その投稿に属さない `FileObj` の混入も許さない)
 * - `post.cover` があるときに限り `coverArchiveName` を返す
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
  allocatePostDirectoryNames(posts: readonly PostObj[]): string[];
  /**
   * 1 投稿内のアセットの archive path を割り当てる
   * @param post 対象の投稿
   */
  allocateAssetPaths(post: PostObj): AllocatedAssetPaths;
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
    allocatePostDirectoryNames(posts: readonly PostObj[]): string[] {
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
    allocateAssetPaths(post: PostObj): AllocatedAssetPaths {
      const groups = createNameKeyedDictionary<FileObj[]>();
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
          files.push({ file, archiveName: utils.getFileName(key, extension, group.length, indexInGroup, true) });
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

  stringify(): string {
    // archive path はここ (finalize) で初めて確定する。投稿ディレクトリ名は投稿をまたぐ採番なので
    // 全投稿を渡して一度に割り当てる
    const directoryNames = this.allocator.allocatePostDirectoryNames(this.downloadObj.posts);
    const downloadJson: DownloadJsonObj = {
      posts: this.orderedPosts.map((it, index) => it.toJsonObj(directoryNames[index], this.allocator)),
      id: this.downloadObj.id,
      url: this.url,
      tags: this.tags ?? this.collectTags(),
      postCount: this.countPost(),
      fileCount: this.countFile(),
    };
    return JSON.stringify(downloadJson);
  }

  setUrl(url: string) {
    this.url = url;
  }

  setTags(tags: string[]) {
    this.tags = tags;
  }

  addPost(name: string): PostObject {
    const postObj: PostObj = { name, info: '', files: [], html: [], tags: [] };
    this.downloadObj.posts.push(postObj);
    const postObject = new PostObject(postObj, this.utils);
    this.orderedPosts.push(postObject);
    return postObject;
  }

  private countPost(): number {
    return this.downloadObj.posts.length;
  }

  private countFile(): number {
    return this.downloadObj.posts.reduce((sum, post) => sum + post.files.length, 0);
  }

  private collectTags(): string[] {
    const tags = new Set<string>();
    for (const post of this.downloadObj.posts) {
      for (const tag of post.tags) {
        tags.add(tag);
      }
    }
    return [...tags];
  }
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
    this.postObj.html = html.map((fragment) =>
      typeof fragment === 'string' ? fragment : Object.freeze({ assetRef: freezeAssetKey(fragment.assetRef) }),
    );
  }

  setTags(tags: string[]) {
    this.postObj.tags = tags;
  }

  setPublishedDatetime(iso: string) {
    this.postObj.publishedDatetime = iso;
  }

  /**
   * FANBOX の投稿タイプを保持する。この層では使わず、利用側の絞り込み条件のために持つ
   * @param type 投稿タイプ
   */
  setPostType(type: string) {
    this.postObj.postType = type;
  }

  setCover(name: string, extension: string, url: string): FileObject {
    const fileObj: FileObj = {
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
    const fileObj: FileObj = {
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
    const ref: HtmlFragment = { assetRef: fileObject.getKey() };
    const escapedDownload = this.utils.escapeHtml(fileObject.getEncodedName() + fileObject.getEncodedExtension());
    return [
      `<a class="hl" href="`,
      ref,
      `" download="${escapedDownload}"><div class="post card">\n` +
        `<div class="card-header">${this.utils.escapeHtml(fileObject.getOriginalName())}</div>\n` +
        `<audio class="card-img-top" src="`,
      ref,
      `" controls/>\n</div></a>`,
    ];
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
    const ref: HtmlFragment = { assetRef: fileObject.getKey() };
    const escapedDownload = this.utils.escapeHtml(fileObject.getEncodedName() + fileObject.getEncodedExtension());
    return [
      `<a class="hl" href="`,
      ref,
      `" download="${escapedDownload}">` +
        `<div class="post card text-center"><p class="pt-2">\n` +
        `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-download" viewBox="0 0 16 16">\n` +
        `<path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>\n` +
        `<path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>\n` +
        `</svg> ${this.utils.escapeHtml(fileObject.getOriginalName() + fileObject.getOriginalExtension())}</p></div></a>`,
    ];
  }

  getImageLinkTag(fileObject: FileObject): HtmlFragment[] {
    const ref: HtmlFragment = { assetRef: fileObject.getKey() };
    const escapedDownload = this.utils.escapeHtml(fileObject.getEncodedName() + fileObject.getEncodedExtension());
    return [
      `<a class="hl" href="`,
      ref,
      `" download="${escapedDownload}"><div class="post card">\n<img class="card-img-top" src="`,
      ref,
      `" alt="${this.utils.escapeHtml(fileObject.getOriginalName())}"/>\n</div></a>`,
    ];
  }

  getVideoLinkTag(fileObject: FileObject): HtmlFragment[] {
    const ref: HtmlFragment = { assetRef: fileObject.getKey() };
    const escapedDownload = this.utils.escapeHtml(fileObject.getEncodedName() + fileObject.getEncodedExtension());
    return [
      `<a class="hl" href="`,
      ref,
      `" download="${escapedDownload}"><div class="post card">\n<video class="card-img-top" src="`,
      ref,
      `" controls/>\n</div></a>`,
    ];
  }

  /**
   * 割り当て済みの archive path を使って JSON 出力用のオブジェクトにする
   * @param directoryName この投稿に割り当てられたディレクトリ名
   * @param allocator 投稿内アセットの割り当て器
   */
  toJsonObj(directoryName: string, allocator: ArchivePathAllocator): DownloadJsonObj['posts'][number] {
    const allocation = allocator.allocateAssetPaths(this.postObj);
    this.assertAllocationCoversAssets(allocation);
    const pathByKey = new Map<string, string>();
    for (const { file, archiveName } of allocation.files) {
      pathByKey.set(assetKeyToString(file.key), archiveName);
    }
    const cover = this.postObj.cover
      ? { url: this.postObj.cover.url, name: allocation.coverArchiveName as string }
      : undefined;
    if (cover) {
      pathByKey.set('cover', cover.name);
    }
    return {
      originalName: this.postObj.name,
      encodedName: directoryName,
      informationText: this.postObj.info,
      htmlText: this.resolveHtml(pathByKey),
      files: allocation.files.map(({ file, archiveName }) => ({
        url: file.url,
        originalName: file.name,
        encodedName: archiveName,
      })),
      tags: this.postObj.tags,
      cover,
      publishedDatetime: this.postObj.publishedDatetime,
    };
  }

  /**
   * allocator の結果が投稿のアセットと 1 対 1 に対応していることを確かめる。
   *
   * 取りこぼしはファイルの欠落、重複や余分は参照先の取り違えになるが、どちらも出力を見ただけでは
   * 気付けない (ZIP は生成され、HTML も壊れて見えない)。finalize で止める。
   * @param allocation 割り当て結果
   */
  private assertAllocationCoversAssets(allocation: AllocatedAssetPaths): void {
    const expected = new Set(this.postObj.files.map((it) => assetKeyToString(it.key)));
    if (allocation.files.length !== this.postObj.files.length) {
      throw new Error(
        `allocator が返したアセット数が投稿と一致しません (期待 ${this.postObj.files.length}, 実際 ${allocation.files.length})`,
      );
    }
    for (const { file } of allocation.files) {
      const key = assetKeyToString(file.key);
      if (!expected.delete(key)) {
        throw new Error(`allocator が投稿に属さないアセット、または重複したアセットを返しました: ${key}`);
      }
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
   * 断片列を HTML 文字列に解決する。
   * 参照先の archive path が割り当てられていない断片は、壊れたリンクを出力に残さないよう例外にする
   * @param pathByKey assetKeyToString をキーとする archive path
   */
  private resolveHtml(pathByKey: Map<string, string>): string {
    return this.postObj.html
      .map((fragment) => {
        if (typeof fragment === 'string') return fragment;
        const archiveName = pathByKey.get(assetKeyToString(fragment.assetRef));
        if (archiveName === undefined) {
          throw new Error(`archive path is not allocated: ${assetKeyToString(fragment.assetRef)}`);
        }
        return this.utils.escapeHtml(`./${this.utils.encodeURI(archiveName)}`);
      })
      .join('');
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
      const header = new ArrayBuffer(30);
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
      const header = new ArrayBuffer(30);
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
        predictedCdSize += 46 + entry.name.length + entry.extraCd.length;
      }
      // EOCD の cdSize フィールド (offset 12, uint32) が収まるかを CD を書く前に検証する (Issue #15)
      assertZipUint32FieldWithinLimit(predictedCdSize, 'close の central directory size (cdSize)');

      for (const entry of this.entries) {
        const cdHeader = new ArrayBuffer(46);
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
   * @param downloadObj ダウンロード対象オブジェクト
   * @param progress 進捗率出力関数 (同期)
   * @param log ログ出力関数 (同期)
   * @param remainTime 終了予測出力関数 (同期)
   * @param options handle/signal/fetchFile を差し替えるためのオプション (省略時は従来どおりの挙動)
   * @returns 処理結果 (Issue #13)。各件数の定義は DownloadZipResult のコメントを参照
   */
  async downloadZip(
    downloadObj: unknown,
    progress: (n: number) => void,
    log: (s: string) => void,
    remainTime: (r: string) => void,
    options?: DownloadZipOptions,
  ): Promise<DownloadZipResult> {
    if (!this.isDownloadJsonObj(downloadObj)) throw new Error('ダウンロード対象オブジェクトの型が不正');
    const utils = this.utils;
    const encodedId = utils.encodeFileName(downloadObj.id);

    // handle (showSaveFilePicker) 取得より前に入力を検証する。
    // ファイル選択 UI を表示してから失敗させることになるため、handle 取得前に置く。
    if (!isValidPathSegment(encodedId)) {
      throw new Error(`downloadZip: id が不正な値です (encode 後: ${JSON.stringify(encodedId)})`);
    }
    const seenEncodedNames = new Set<string>();
    for (const post of downloadObj.posts) {
      if (!isValidPathSegment(post.encodedName)) {
        throw new Error(`downloadZip: post.encodedName が不正な値です (${JSON.stringify(post.encodedName)})`);
      }
      if (seenEncodedNames.has(post.encodedName)) {
        throw new Error(`downloadZip: post.encodedName が重複しています (${post.encodedName})`);
      }
      seenEncodedNames.add(post.encodedName);
      if (post.cover !== undefined && !isValidPathSegment(post.cover.name)) {
        throw new Error(`downloadZip: post.cover.name が不正な値です (${JSON.stringify(post.cover.name)})`);
      }
      for (const file of post.files) {
        if (!isValidPathSegment(file.encodedName)) {
          throw new Error(`downloadZip: file.encodedName が不正な値です (${JSON.stringify(file.encodedName)})`);
        }
      }
    }

    const handle = options?.handle ?? (await showSaveFilePicker({ suggestedName: `${encodedId}.zip` }));
    const writable = await handle.createWritable();
    const zip = new ZipWriter(writable);

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
      // 投稿処理
      let postCount = 0;
      postLoop: for (const post of downloadObj.posts) {
        if (options?.signal?.aborted) {
          aborted = true;
          break;
        }
        log(`${post.originalName} (${++postCount}/${downloadObj.postCount})`);
        const postDate = parsePublishedDate(post.publishedDatetime);
        // 投稿ディレクトリ (配下ファイルより前に書く)
        await zip.addDirectory(`${encodedId}/${post.encodedName}/`, postDate);
        // 投稿情報+html
        const informationFile = utils.createInformationFile(post.informationText);
        await enqueue(
          informationFile.content,
          `${post.encodedName}/${utils.encodeFileName(informationFile.name)}`,
          postDate,
        );
        await enqueue(
          [this.createHtmlFromBody(post.originalName, post.htmlText)],
          `${post.encodedName}/index.html`,
          postDate,
        );
        // カバー画像
        if (post.cover) {
          log(`download ${post.cover.name}`);
          const blob = await fetchFile(post.cover.url, post.cover.name, { kind: 'cover' });
          if (blob) {
            await enqueue([blob], `${post.encodedName}/${post.cover.name}`, postDate);
            writtenFileCount++;
          } else if (options?.signal?.aborted) {
            // 中断による null は通信失敗ではないので failedFileCount に数えない。
            // この投稿はカバーを書き終えていないので completedPostCount にも含めない
            aborted = true;
            break;
          } else {
            failedFileCount++;
            console.error(`${post.cover.name}(${post.cover.url})のダウンロードに失敗、読み飛ばすよ`);
            log(`${post.cover.name}のダウンロードに失敗`);
          }
        }
        // ファイル処理
        let fileCount = 0;
        for (const file of post.files) {
          if (options?.signal?.aborted) {
            aborted = true;
            break postLoop;
          }
          log(`download ${file.encodedName} (${++fileCount}/${post.files.length})`);
          const blob = await fetchFile(file.url, file.encodedName, { kind: 'file' });
          if (blob) {
            await enqueue([blob], `${post.encodedName}/${file.encodedName}`, postDate);
            writtenFileCount++;
          } else if (options?.signal?.aborted) {
            // 中断による null は通信失敗ではないので failedFileCount に数えない
            aborted = true;
            break postLoop;
          } else {
            failedFileCount++;
            console.error(`${file.encodedName}(${file.url})のダウンロードに失敗、読み飛ばすよ`);
            log(`${file.encodedName}のダウンロードに失敗`);
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
      };
    } catch (e) {
      await zip.abort(e);
      throw e;
    }
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
      case !Array.isArray(t.tags):
        console.error('ダウンロード用オブジェクトの型が不正(tagsが配列でない)', t.tags);
        return false;
    }
    return !(t.posts as unknown[]).some((it: unknown) => {
      if (typeof it !== 'object' || it === null) {
        console.error('ダウンロード用オブジェクトの型が不正(postsの値にobjectでないものが含まれる)', it, t.posts);
        return true;
      }
      const p = it as Record<string, unknown>;
      switch (true) {
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
        case !Array.isArray(p.tags):
          console.error(
            'ダウンロード用オブジェクトの型が不正(postsの値にtagsが配列でないものが含まれる)',
            p.tags,
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
