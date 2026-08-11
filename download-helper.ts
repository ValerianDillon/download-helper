/**
 * ダウンロード用のObject
 */
export type DownloadObj = { posts: Record<string, PostObj[]>; id: string };

/**
 * 投稿情報のObject
 */
export type PostObj = {
  name: string;
  info: string;
  files: Record<string, FileObj[]>;
  html: string;
  tags: string[];
  cover?: FileObj;
  publishedDatetime?: string;
};

/**
 * ファイル用のObject
 */
export type FileObj = { url: string; name: string; extension: string };

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
 * ダウンロード用のオブジェクトラッパークラス
 */
export class DownloadObject {
  private readonly downloadObj: DownloadObj;
  private readonly utils: DownloadUtils;
  private readonly orderedPosts: PostObject[] = [];
  private url = '#main';
  private tags: string[] | undefined;

  constructor(id: string, utils: DownloadUtils) {
    this.downloadObj = { posts: {}, id };
    this.utils = utils;
  }

  stringify(): string {
    const downloadJson: DownloadJsonObj = {
      posts: this.orderedPosts.map((it) => it.toJsonObjBy(this.downloadObj.posts)),
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
    const encodedName = this.utils.encodeFileName(name);
    if (this.downloadObj.posts[encodedName] === undefined) {
      this.downloadObj.posts[encodedName] = [];
    }
    const postObj: PostObj = { name, info: '', files: {}, html: '', tags: [] };
    this.downloadObj.posts[encodedName].push(postObj);
    const postObject = new PostObject(postObj, this.utils);
    this.orderedPosts.push(postObject);
    return postObject;
  }

  private countPost(): number {
    return Object.values(this.downloadObj.posts).reduce((s, posts) => s + posts.length, 0);
  }

  private countFile(): number {
    return Object.values(this.downloadObj.posts).reduce(
      (allFileSize, posts) =>
        allFileSize +
        posts.reduce(
          (postFileSize, post) => postFileSize + Object.values(post.files).reduce((s, files) => s + files.length, 0),
          0,
        ),
      0,
    );
  }

  private collectTags(): string[] {
    const tags = new Set<string>();
    for (const posts of Object.values(this.downloadObj.posts)) {
      for (const post of posts) {
        for (const tag of post.tags) {
          tags.add(tag);
        }
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

  setHtml(html: string) {
    this.postObj.html = html;
  }

  setTags(tags: string[]) {
    this.postObj.tags = tags;
  }

  setPublishedDatetime(iso: string) {
    this.postObj.publishedDatetime = iso;
  }

  setCover(name: string, extension: string, url: string): FileObject {
    const fileObj: FileObj = { name, extension: extension ? `.${extension}` : '', url };
    this.postObj.cover = fileObj;
    return new FileObject(fileObj, this.utils);
  }

  addFile(name: string, extension: string, url: string): FileObject {
    const encodedName = this.utils.encodeFileName(name);
    if (this.postObj.files[encodedName] === undefined) {
      this.postObj.files[encodedName] = [];
    }
    const fileObj: FileObj = { name, extension: extension ? `.${extension}` : '', url };
    this.postObj.files[encodedName].push(fileObj);
    return new FileObject(fileObj, this.utils);
  }

  getAutoAssignedLinkTag(fileObject: FileObject): string {
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

  getAudioLinkTag(fileObject: FileObject): string {
    const escapedPath = this.utils.escapeHtml(this.getCurrentFilePath(fileObject));
    const escapedDownload = this.utils.escapeHtml(fileObject.getEncodedName() + fileObject.getEncodedExtension());
    return (
      `<a class="hl" href="${escapedPath}" download="${escapedDownload}"><div class="post card">\n` +
      `<div class="card-header">${this.utils.escapeHtml(fileObject.getOriginalName())}</div>\n` +
      `<audio class="card-img-top" src="${escapedPath}" controls/>\n</div></a>`
    );
  }

  getLinkTag(url: string, title: string): string {
    return (
      `<a class="hl" href="${this.utils.escapeHtml(url)}"><div class="post card text-center"><p class="pt-2">\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-box-arrow-up-left" viewBox="0 0 16 16">\n` +
      `<path fill-rule="evenodd" d="M7.364 3.5a.5.5 0 0 1 .5-.5H14.5A1.5 1.5 0 0 1 16 4.5v10a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 3 14.5V7.864a.5.5 0 1 1 1 0V14.5a.5.5 0 0 0 .5.5h10a.5.5 0 0 0 .5-.5v-10a.5.5 0 0 0-.5-.5H7.864a.5.5 0 0 1-.5-.5z"/>\n` +
      `<path fill-rule="evenodd" d="M0 .5A.5.5 0 0 1 .5 0h5a.5.5 0 0 1 0 1H1.707l8.147 8.146a.5.5 0 0 1-.708.708L1 1.707V5.5a.5.5 0 0 1-1 0v-5z"/>\n` +
      `</svg> ${this.utils.escapeHtml(title)}</p></div></a>`
    );
  }

  getFileLinkTag(fileObject: FileObject): string {
    const escapedPath = this.utils.escapeHtml(this.getCurrentFilePath(fileObject));
    const escapedDownload = this.utils.escapeHtml(fileObject.getEncodedName() + fileObject.getEncodedExtension());
    return (
      `<a class="hl" href="${escapedPath}" download="${escapedDownload}">` +
      `<div class="post card text-center"><p class="pt-2">\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-download" viewBox="0 0 16 16">\n` +
      `<path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>\n` +
      `<path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>\n` +
      `</svg> ${this.utils.escapeHtml(fileObject.getOriginalName() + fileObject.getOriginalExtension())}</p></div></a>`
    );
  }

  getImageLinkTag(fileObject: FileObject): string {
    const escapedPath = this.utils.escapeHtml(this.getCurrentFilePath(fileObject));
    const escapedDownload = this.utils.escapeHtml(fileObject.getEncodedName() + fileObject.getEncodedExtension());
    return (
      `<a class="hl" href="${escapedPath}" download="${escapedDownload}"><div class="post card">\n` +
      `<img class="card-img-top" src="${escapedPath}" alt="${this.utils.escapeHtml(fileObject.getOriginalName())}"/>\n</div></a>`
    );
  }

  getVideoLinkTag(fileObject: FileObject): string {
    const escapedPath = this.utils.escapeHtml(this.getCurrentFilePath(fileObject));
    const escapedDownload = this.utils.escapeHtml(fileObject.getEncodedName() + fileObject.getEncodedExtension());
    return (
      `<a class="hl" href="${escapedPath}" download="${escapedDownload}"><div class="post card">\n` +
      `<video class="card-img-top" src="${escapedPath}" controls/>\n</div></a>`
    );
  }

  private getCurrentFilePath(fileObject: FileObject): string {
    const encodedName = fileObject.getEncodedName();
    if (fileObject.equals(this.postObj.cover)) {
      const fileName = this.utils.getFileName(encodedName, fileObject.getEncodedExtension(), 1, 0, true);
      return `./${this.utils.encodeURI(fileName)}`;
    }
    if (this.postObj.files[encodedName] === undefined) {
      throw new Error(`file object is undefined: ${fileObject.getOriginalName()}`);
    }
    const index = this.postObj.files[encodedName].findIndex((it) => fileObject.equals(it));
    if (index < 0) {
      throw new Error(`file object is not found: ${fileObject.getOriginalName()}`);
    }
    const fileName = this.utils.getFileName(
      encodedName,
      fileObject.getEncodedExtension(),
      this.postObj.files[encodedName].length,
      index,
      true,
    );
    return `./${this.utils.encodeURI(fileName)}`;
  }

  toJsonObjBy(posts: Record<string, PostObj[]>): DownloadJsonObj['posts'][number] {
    const key = this.utils.encodeFileName(this.postObj.name);
    const postIndex = posts[key]?.indexOf(this.postObj);
    if (postIndex === undefined || postIndex < 0) {
      throw new Error(`post object is not found: ${this.postObj.name}`);
    }
    const encodedName = this.utils.getFileName(key, '', posts[key].length, postIndex, false);
    const cover = this.postObj.cover
      ? {
          url: this.postObj.cover.url,
          name: this.utils.getFileName(this.postObj.cover.name, this.postObj.cover.extension, 1, 0, true),
        }
      : undefined;
    return {
      originalName: this.postObj.name,
      encodedName,
      informationText: this.postObj.info,
      htmlText: this.postObj.html,
      files: this.collectFiles(),
      tags: this.postObj.tags,
      cover,
      publishedDatetime: this.postObj.publishedDatetime,
    };
  }

  private collectFiles(): DownloadJsonObj['posts'][number]['files'] {
    // 順序自由
    const ret: DownloadJsonObj['posts'][number]['files'] = [];
    for (const [key, fileObjArray] of Object.entries(this.postObj.files)) {
      let fileIndex = 0;
      for (const fileObj of fileObjArray) {
        const extension = fileObj.extension ? this.utils.encodeFileName(fileObj.extension) : '';
        const encodedName = this.utils.getFileName(key, extension, fileObjArray.length, fileIndex++, true);
        ret.push({
          url: fileObj.url,
          originalName: fileObj.name,
          encodedName,
        });
      }
    }
    return ret;
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

  equals(obj: unknown): boolean {
    if (typeof obj !== 'object' || obj === null) {
      return false;
    }
    const candidate = obj as { name?: string; url?: string };
    return candidate.name === this.fileObj.name && candidate.url === this.fileObj.url;
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
 * ZIP ファイル書き込みクラス (stored / 非圧縮)
 * File System Access API の FileSystemWritableFileStream に直接書き込む
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
   * このインスタンスが使用不能になっているかどうか。
   * addFile / addDirectory / close のいずれかで例外が発生し abortOnFailure に入った時点で true になり、
   * 以後すべての公開メソッドを拒否する terminal な状態を表す (Issue #17 フォローアップ)。
   * abort() 自体が失敗した場合もこのフラグは true のまま残るため、二重 abort の防止も兼ねる。
   */
  private failed = false;

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
   * @throws {Error} このインスタンスが以前の失敗により使用不能になっている場合。
   *   name をセグメント (`/` 区切り) ごとに見たとき、空文字列 / "." / ".." / "\" ":" を含む場合、
   *   または末尾が `/` の場合 (downloadZip 側でも同じ検証を行うが、addFile を直接呼ぶ利用者を
   *   無防備にしないための多層防御として ZipWriter 自身にも検証を持たせている、Issue #17)。
   *   エンコード後の名前が 65535 bytes (UTF-8) を超える場合 (file name length フィールドが 16 bit のため)
   */
  async addFile(name: string, data: Uint8Array, date?: Date): Promise<void> {
    this.assertNotFailed('addFile');
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
      const fileCrc = crc32(bytes);
      const localHeaderOffset = this.offset;

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
    }
  }

  /**
   * ディレクトリエントリを ZIP に追加する
   * @param name ZIP 内のディレクトリパス (UTF-8)。末尾が `/` でなければ自動的に付与する
   * @param date 任意。addFile と同一の日時ロジック (DOS time/date + NTFS Extra + Extended Timestamp) を適用する。
   *   省略または Invalid Date の場合は DOS time/date = 0、extra field なし
   * @throws {Error} このインスタンスが以前の失敗により使用不能になっている場合。
   *   正規化後の名前をセグメント (`/` 区切り) ごとに見たとき、空文字列 / "." / ".." / "\" ":" を
   *   含むセグメントがある場合 (name が空文字列、または先頭が `/` の場合を含む)。
   *   APPNOTE 4.4.17.1 が ZIP 内のパスを相対パスに限り、先頭 `/` を禁じるため。
   *   addFile と同じ検証をセグメント単位で適用するため、drive letter (`C:/dir`) や `\` 区切りも拒否する
   *   (Issue #14 時点では addFile と非対称にしないため未検証としていたが、Issue #17 で addFile 側にも
   *   検証を追加したため、この非対称は解消されている)。
   *   エンコード後の名前が 65535 bytes (UTF-8) を超える場合 (file name length フィールドが 16 bit のため)
   */
  async addDirectory(name: string, date?: Date): Promise<void> {
    this.assertNotFailed('addDirectory');
    try {
      const dirName = name.endsWith('/') ? name : `${name}/`;
      assertValidZipEntryName(dirName, 'addDirectory');

      const nameBytes = this.encoder.encode(dirName) as Uint8Array<ArrayBuffer>;
      assertValidZipEntryNameByteLength(nameBytes, dirName, 'addDirectory');
      const localHeaderOffset = this.offset;

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
    }
  }

  /**
   * Central Directory と EOCD を書き込み、ストリームを閉じる
   *
   * 既知の制限 (ZIP64 未対応): EOCD のエントリ数 (下記 offset 8/10) と LFH/CD の compressed / uncompressed size
   * (addFile 内、offset 18/22 および 20/24)、CD の local header offset (offset 42)、EOCD の cdSize / cdOffset
   * (offset 12/16) はいずれも uint16 または uint32 に直接値を書いており、ZIP64 の拡張フィールドを持たない。
   * `0xFFFF` / `0xFFFFFFFF` は APPNOTE 4.4.1.4 が定める ZIP64 の sentinel 値のため、
   * エントリ数が 65,535 件以上、またはサイズ/オフセットが `0xFFFFFFFF` bytes 以上になると壊れた ZIP を出力する。
   * ディレクトリエントリの追加でエントリ数が「投稿数 + 1」増える分、上限に到達しやすくなる点に留意する。
   * @throws {Error} このインスタンスが以前の失敗により使用不能になっている場合 (Issue #17 フォローアップ)
   */
  async close(): Promise<void> {
    this.assertNotFailed('close');
    try {
      const cdOffset = this.offset;

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
    } catch (e) {
      await this.abortOnFailure(e);
      throw e;
    }
  }

  private async write(data: Uint8Array<ArrayBuffer>): Promise<void> {
    await this.writable.write(data);
    this.offset += data.length;
  }

  /**
   * このインスタンスが失敗後の terminal 状態でないことを確認する (Issue #17 フォローアップ)。
   * failed フラグは abortOnFailure が一度でも実行されると true になり、abort() 自体が失敗しても戻らない。
   * これが無いと、abort() 失敗後に呼ばれた addFile / addDirectory / close がまだ生きているストリームに
   * 書き込みを続けてしまい、Central Directory / EOCD を欠いた壊れた ZIP や、無関係な内容の ZIP を
   * そのままコミットしうる。
   * @throws {Error} 既に failed 状態の場合
   */
  private assertNotFailed(method: 'addFile' | 'addDirectory' | 'close'): void {
    if (this.failed) {
      throw new Error(`ZipWriter.${method}: 以前の失敗により使用不可です`);
    }
  }

  /**
   * 書き込み中に例外が発生した場合のストリーム cleanup (Issue #17)。
   * `createWritable()` で得たストリームは、close() を呼ばない限り書き込み先の実ファイルへ反映されない
   * (File System Access API の仕様上、変更は close() で初めてコミットされる)。
   * そのため、addFile / addDirectory / close の途中で例外が発生した場合は、
   * 中途半端な (Central Directory / EOCD を欠いた壊れた) ZIP を実ファイルとしてコミットしてしまわないよう、
   * close() ではなく abort() でストリームを破棄する。abort() 自体の失敗は元の例外を握りつぶさないよう無視する。
   * failed フラグは abort() の成否に関わらず true のまま維持し、以後のすべての呼び出しを
   * assertNotFailed で拒否することで、二重 abort と「失敗後もまだ生きているストリームへの書き込みが
   * 通ってしまう」問題の両方を防ぐ (assertNotFailed が入口で弾くため、このメソッドが同一インスタンスに対して
   * 複数回呼ばれることは実際には無い)。
   */
  private async abortOnFailure(reason: unknown): Promise<void> {
    this.failed = true;
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
  /** ファイル取得処理の差し替え (未指定時は DownloadUtils.fetchWithLimit を使う) */
  fetchFile?: (url: string, name: string) => Promise<Blob | null>;
};

/**
 * ZIP パスの 1 セグメントとして安全か検証する。
 * 空文字列 / "." / ".." / "/" "\" ":" を含むものを拒否する。
 * downloadZip の事前検証 (encodedId / post.encodedName / post.cover.name / file.encodedName) と
 * ZipWriter.addFile / addDirectory 自体の入力検証 (assertValidZipEntryName 経由) の両方で共有する。
 * cover.name / file.encodedName はパス区切りを含まない 1 セグメント名である前提のため、
 * これらにも同じ検証をそのまま適用してよい (Issue #17)。
 * post.encodedName 等は isDownloadJsonObj で型 (string) すら検証されないため、value を unknown として受ける
 * @internal
 */
function isValidPathSegment(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value !== '.' && value !== '..' && !/[/\\:]/.test(value);
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
   * @param downloadObj ダウンロード対象オブジェクト
   * @param progress 進捗率出力関数
   * @param log ログ出力関数
   * @param remainTime 終了予測出力関数
   * @param options handle/signal/fetchFile を差し替えるためのオプション (省略時は従来どおりの挙動)
   */
  async downloadZip(
    downloadObj: unknown,
    progress: (n: number) => void,
    log: (s: string) => void,
    remainTime: (r: string) => void,
    options?: DownloadZipOptions,
  ) {
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
    const fetchFile = options?.fetchFile ?? ((url: string, name: string) => utils.fetchWithLimit({ url, name }, 1));

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
    let failedCount = 0;

    log(`@${downloadObj.id} 投稿:${downloadObj.postCount} ファイル:${downloadObj.fileCount}`);
    // ルートディレクトリ (日時は有効な publishedDatetime の最大値。有効な値が 1 件も無ければ date なし)
    const rootDate = downloadObj.posts.reduce<Date | undefined>((max, post) => {
      const d = parsePublishedDate(post.publishedDatetime);
      if (d === undefined) return max;
      return max === undefined || d.getTime() > max.getTime() ? d : max;
    }, undefined);
    await zip.addDirectory(`${encodedId}/`, rootDate);
    // ルートhtml (post に紐づかないので date は付与しない)
    await enqueue([this.createRootHtmlFromPosts(downloadObj)], 'index.html');
    // 投稿処理
    let postCount = 0;
    for (const post of downloadObj.posts) {
      if (options?.signal?.aborted) {
        await zip.close();
        return;
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
        const blob = await fetchFile(post.cover.url, post.cover.name);
        if (blob) {
          await enqueue([blob], `${post.encodedName}/${post.cover.name}`, postDate);
        }
      }
      // ファイル処理
      let fileCount = 0;
      for (const file of post.files) {
        if (options?.signal?.aborted) {
          await zip.close();
          return;
        }
        log(`download ${file.encodedName} (${++fileCount}/${post.files.length})`);
        const blob = await fetchFile(file.url, file.encodedName);
        if (blob) {
          await enqueue([blob], `${post.encodedName}/${file.encodedName}`, postDate);
        } else {
          failedCount++;
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
    }
    if (failedCount > 0) {
      log(`完了 (${failedCount}件のダウンロードに失敗)`);
    } else {
      log('完了');
    }
    await zip.close();
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
