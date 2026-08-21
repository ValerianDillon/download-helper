/**
 * fanbox-downloader / fanbox-downloader-extension 共用の FANBOX 固有収集ロジック
 * pixiv FANBOX の API レスポンス型、DownloadManage (収集時の状態管理)、
 * postInfo → DownloadObject への変換処理をまとめる。
 */
import { createNameKeyedDictionary, DownloadObject, DownloadUtils } from './download-helper';

/**
 * プランAPIの型
 * @see https://api.fanbox.cc/plan.listCreator?creatorId=${creatorId}
 */
export type PlansResponse = {
  body?: {
    plans?: unknown;
  };
};

/** @deprecated PlansResponse を使うこと */
export type Plans = PlansResponse;

export type PlanInfo = {
  id: string;
  title: string;
  fee: number;
  description: string;
  coverImageUrl: string | null;
};

/**
 * タグAPIの型
 * @see https://api.fanbox.cc/tag.getFeatured?creatorId=${creatorId}
 */
export type TagsResponse = {
  body?: {
    featuredTags?: unknown;
  };
};

/** @deprecated TagsResponse を使うこと */
export type Tags = TagsResponse;

export type TagInfo = {
  tag: string;
  count: number;
  coverImageUrl: string | null;
};

/**
 * 投稿一覧のページURL APIの型
 * @see https://api.fanbox.cc/post.paginateCreator?creatorId=${creatorId}
 */
export type PostPaginationResponse = {
  body?: {
    pageUrls?: unknown;
  };
};

/** @deprecated PostPaginationResponse を使うこと。返るのは投稿ではなくページ URL である */
export type PaginatedPosts = PostPaginationResponse;

/**
 * 投稿一覧APIの型
 * @see https://api.fanbox.cc/post.listCreator?creatorId=${creatorId}
 */
export type PostListResponse = {
  body?: {
    posts?: unknown;
  };
};

/** @deprecated PostListResponse を使うこと */
export type PostList = PostListResponse;

/**
 * 投稿一覧 (post.listCreator) の要素の未検証入力型。
 *
 * 一覧の要素として観測される形状すべてではなく、利用側が実際に検証し、収集の分岐に使う
 * 3 つだけを保証する。id は post.info の URL 組み立てに、isRestricted は投稿を飛ばすかの
 * 判断に、feeRequired は「無料を省く」指定の判断に使う。
 * 残りのフィールドは未検証なので型に出さない (index signature も付けない。付けると
 * 利用側の typo が unknown として通ってしまう)。
 */
export type PostListItemCandidate = {
  id: string;
  isRestricted: boolean;
  feeRequired: number;
};

/**
 * 投稿詳細APIの型
 * @see https://api.fanbox.cc/post.info?postId=${postId}
 */
export type PostInfoResponse = {
  body?: {
    post?: unknown;
  };
};

/**
 * 投稿詳細 (post.info) の投稿オブジェクトの未検証入力型。
 *
 * 利用側 (拡張版 fetchPostInfo / ブックマークレット版 getPostInfoById) が実際に検証している
 * 3 つだけを保証する。本文をはじめとする残りのフィールドは未検証なので型に出さない。
 * 検証は addByPostInfo の入口で行い、収集が読むフィールドだけを厳密に確かめる。
 *
 * 値は JSON.parse 由来であること (循環参照や BigInt を含まないこと) を契約とする。
 * 情報 JSON への書き出しや未知値の文字列化で JSON.stringify を使うため。
 */
export type PostInfoCandidate = {
  id: string;
  type: string;
  isRestricted: boolean;
};

/*
 * ここから下の本文まわりの型は、すべて decoder (decodeCollectablePost) が生成する検証済みの
 * 内部表現である。未検証の入力を表すのは PostInfoCandidate / PostListItemCandidate だけで、
 * 両者を同じ型で表すと「検証していない保証」を型で主張することになるため公開もしない。
 */

/** articleタイプのマップ型に対する値の型 */
type ImageInfo = { originalUrl: string; extension: string };
type FileInfo = { url: string; name: string; extension: string };

/**
 * embedMap の値。消費側は中身を解釈せず JSON 文字列として出すだけなので、
 * decode 時に文字列化まで済ませる (描画中に JSON.stringify が失敗すると、投稿を登録した後に
 * 本文生成で落ちて空の投稿が出力に残るため)。
 */
type EmbedValue = { rawJson: string };

/**
 * urlEmbedMap の値。未知の type は捨てずに sentinel へ正規化する。
 *
 * リテラル 'unknown' の variant だけでは実際に返る未知の値 (例: 'video') を表現できず、
 * かといって union に `{ type: string }` を混ぜると既知 case の絞り込みが壊れる。
 * そこで decoder が未知値を sentinel に畳み、元の type 名を originalType に、
 * 描画に使う JSON 文字列を rawJson に持たせる。
 */
type UrlEmbedInfo =
  | { type: 'default'; url: string; host: string }
  | { type: 'html'; html: string }
  | { type: 'html.card'; html: string }
  | {
      type: 'fanbox.post';
      // title は escapeHtml に渡る。id / creatorId はリンク URL を組み立てる材料で、
      // 欠けるとリンク先が壊れる (この variant の取り込み内容そのものがリンクである) ため必須
      postInfo: { title: string; id: string; creatorId: string };
    }
  | { type: 'unknown'; originalType: string; rawJson: string };

/** articleタイプのBlock構成要素。*Id は decode 時に文字列を必須にしている */
type ImageBlock = { type: 'image'; imageId: string };
type FileBlock = { type: 'file'; fileId: string };
type TextBlock = { type: 'p' | 'header'; text: string };
type EmbedBlock = { type: 'embed'; embedId: string };
type UrlEmbedBlock = { type: 'url_embed'; urlEmbedId: string };
/**
 * 未知の block type。UrlEmbedInfo と同じ理由で sentinel に正規化する。
 * 消費側は現行どおり HTML に何も出さず、ログに originalType を使う
 * (正規化でログが 'unknown' に劣化しないようにするため)。
 */
type UnknownBlock = { type: 'unknown'; originalType: string };
type Block = ImageBlock | FileBlock | TextBlock | EmbedBlock | UrlEmbedBlock | UnknownBlock;

/** blocks の *Id は該当マップの並べ替えに使う。描画は並べ替えた結果を block の位置で消費する */
type ArticleBody = {
  imageMap: Record<string, ImageInfo>;
  fileMap: Record<string, FileInfo>;
  embedMap: Record<string, EmbedValue>;
  urlEmbedMap: Record<string, UrlEmbedInfo>;
  blocks: Block[];
};

/**
 * 情報 JSON にそのまま書き出す付随メタデータ。
 *
 * 型は検証しない。これらは収集結果の成立に関与せず、型が変わっても取り込む内容は欠けないため、
 * 中断 (invalid) の理由にしない。decode 時にシリアライズ可能なことだけ確認する。
 * publishedDatetime だけは「文字列かつ非空なら ZIP の mtime に使う」ので、読む側で型を見る。
 */
type PostMetadata = {
  creatorId?: unknown;
  publishedDatetime?: unknown;
  updatedDatetime?: unknown;
  likeCount?: unknown;
  commentCount?: unknown;
};

/**
 * decoder の出力。addByPostInfo が実際に読むフィールドだけを保証する検証済み型であり、
 * post.info が返す投稿オブジェクト全体の schema ではない。
 *
 * 検証範囲を「収集が読むフィールド」に限るのは、検証に落ちた投稿が invalid として
 * 収集全体を止めるためである。読まないフィールドの型変化で全件中断させるのは、
 * fail-closed の適用先を誤ることになる。
 *
 * body は非 null (null / undefined は decode より前に missing-body として分類済み)。
 */
type CollectablePostInfo = {
  id: string;
  title: string;
  tags: string[];
  feeRequired: number;
  coverImageUrl: string | null | undefined;
  metadata: PostMetadata;
} & (
  | { type: 'image'; body: { text: string; images: ImageInfo[] } }
  | { type: 'file'; body: { text: string; files: FileInfo[] } }
  | { type: 'article'; body: ArticleBody }
  | { type: 'text'; body: { text: string } }
);

/**
 * ダウンローダーの管理クラス
 */
export class DownloadManage {
  /** ダウンロード用ユーティリティ 何かあれば適当にオーバライドする */
  public static readonly utils = new DownloadUtils();

  /** 投稿情報の出力をJSONにする（基本true, txtにする場合はfalseに変える）*/
  public static readonly isExportJson = true;

  public readonly downloadObject: DownloadObject;

  public isIgnoreFree = false;

  private fees = new Set<number>();

  private tags = new Set<string>();

  private isLimitAvailable = false;

  private limit = 0;

  constructor(
    public readonly userId: string,
    public readonly feeMap: Map<number, string>,
  ) {
    this.downloadObject = new DownloadObject(userId, DownloadManage.utils);
  }

  addFee(fee: number) {
    this.fees.add(fee);
  }

  addTags(...tags: string[]) {
    for (const tag of tags) {
      this.tags.add(tag);
    }
  }

  applyTags() {
    const fees = [...this.fees].sort((a, b) => a - b).map((fee) => this.getTagByFee(fee));
    const tags = [...this.tags].filter((tag) => !fees.includes(tag));
    this.downloadObject.setTags([...fees, ...tags]);
  }

  getTagByFee(fee: number): string {
    return this.feeMap.get(fee) ?? `${fee > 0 ? `${fee}円` : '無料'}プラン`;
  }

  setLimitAvailable(isLimitAvailable: boolean) {
    this.isLimitAvailable = isLimitAvailable;
  }

  isLimitValid(): boolean {
    if (!this.isLimitAvailable) return true;
    return this.limit > 0;
  }

  decrementLimit() {
    if (this.isLimitAvailable) {
      this.limit--;
    }
  }

  setLimit(limit: number) {
    if (this.isLimitAvailable) {
      this.limit = limit;
    }
  }
}

/**
 * addByPostInfo の処理結果
 * 呼び出し側が「意図した除外」と「取れなかった投稿」、および取れなかった理由を
 * 区別できるようにするための判別可能な戻り値。文字列 1 個への集約だと、呼び出し側が
 * 理由ごとに別対応 (継続 / 中断 / 表示の出し分け) をしたくても情報が足りない。
 */
export type AddPostResult =
  /** 取り込んだ */
  | { status: 'added' }
  /** isIgnoreFree の設定により意図的に除外した */
  | { status: 'ignored' }
  /** 本文を取り込めなかった。reason で理由を区別する */
  | {
      status: 'unavailable';
      /**
       * 'restricted': 一覧時点で isRestricted だった (支援額不足など、正常系でも起こりうる)
       * 'missing-body': isRestricted ではないのに本文が無い、または postInfo 自体が取得できなかった。
       *   一覧で unrestricted だった投稿の本文欠落は構造的な不一致の疑いがあるが、
       *   ここでは isRestricted の有無以上の判別材料を持たないため 'missing-body' に丸める
       */
      reason: 'restricted' | 'missing-body';
    }
  /**
   * 既知の投稿タイプだが、収集に必要なフィールドが揃っていない (構造的な不一致)。
   * missing には欠落している、または期待した型と異なるフィールドのパスが入る
   * (本文だけでなく feeRequired / title / tags / coverImageUrl / 付随メタデータも対象)
   */
  | { status: 'invalid'; postId: string; type: string; missing: string[] }
  /** 未知の投稿タイプ。本文を読めないので取り込めないが、収集全体は中断しない */
  | { status: 'unsupported'; postId: string; type: string };

/** postInfo.body の中で addByPostInfo が実際に処理できる投稿タイプ */
type KnownPostType = 'image' | 'file' | 'article' | 'text';

/** 配列ではないオブジェクトか (Record として扱ってよいか) を判定する。配列は isRecord ではない */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * JSON 文字列にする。できなければ undefined を返す。
 *
 * candidate は JSON.parse 由来である契約なので通常は失敗しないが、契約に反する値
 * (循環参照、BigInt、例外を投げる toJSON) を渡されたときに、描画中ではなく decode 時に
 * 弾けるようにする。描画中に落ちると、投稿を登録した後で本文生成に失敗し、
 * 空の投稿が出力に残る。
 */
function serialize(value: unknown): string | undefined {
  try {
    const json = JSON.stringify(value);
    return typeof json === 'string' ? json : undefined;
  } catch {
    return undefined;
  }
}

function decodeImageInfo(value: unknown): ImageInfo | undefined {
  if (!isRecord(value) || typeof value.originalUrl !== 'string' || typeof value.extension !== 'string')
    return undefined;
  return { originalUrl: value.originalUrl, extension: value.extension };
}

function decodeFileInfo(value: unknown): FileInfo | undefined {
  if (
    !isRecord(value) ||
    typeof value.url !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.extension !== 'string'
  ) {
    return undefined;
  }
  return { url: value.url, name: value.name, extension: value.extension };
}

/** embedMap の値。消費側は中身を解釈せず JSON 文字列にするだけなので、ここで文字列化まで済ませる */
function decodeEmbedValue(value: unknown): EmbedValue | undefined {
  const rawJson = serialize(value);
  return rawJson === undefined ? undefined : { rawJson };
}

/**
 * article の block を decode する。
 *
 * 既知 type の *Id は文字列を必須にする。描画は「block の並びで数えた位置」で該当マップの
 * 並べ替え結果を消費するため、1 つでも id が読めないと以降の block が別の要素を描画してしまう
 * (欠落ではなく取り違えになる)。'p' / 'header' の text も escapeHtml に直接渡るので必須。
 * 未知の type は sentinel へ畳み、元の type 名を残す。
 */
function decodeBlock(value: unknown): Block | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') return undefined;
  const id = (key: string): string | undefined => (typeof value[key] === 'string' ? (value[key] as string) : undefined);
  switch (value.type) {
    case 'p':
    case 'header':
      return typeof value.text === 'string' ? { type: value.type, text: value.text } : undefined;
    case 'image': {
      const imageId = id('imageId');
      return imageId === undefined ? undefined : { type: 'image', imageId };
    }
    case 'file': {
      const fileId = id('fileId');
      return fileId === undefined ? undefined : { type: 'file', fileId };
    }
    case 'embed': {
      const embedId = id('embedId');
      return embedId === undefined ? undefined : { type: 'embed', embedId };
    }
    case 'url_embed': {
      const urlEmbedId = id('urlEmbedId');
      return urlEmbedId === undefined ? undefined : { type: 'url_embed', urlEmbedId };
    }
    default:
      return { type: 'unknown', originalType: value.type };
  }
}

/**
 * urlEmbedMap の値を decode する。
 *
 * 既知 type は、その variant の取り込み内容を成立させるフィールドを必須にする
 * (default の url / host、html の html、fanbox.post の title / id / creatorId)。
 * 未知 type は sentinel へ畳み、描画に使う JSON 文字列を持たせる。
 */
function decodeUrlEmbedInfo(value: unknown): UrlEmbedInfo | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') return undefined;
  switch (value.type) {
    case 'default':
      return typeof value.url === 'string' && typeof value.host === 'string'
        ? { type: 'default', url: value.url, host: value.host }
        : undefined;
    case 'html':
    case 'html.card':
      return typeof value.html === 'string' ? { type: value.type, html: value.html } : undefined;
    case 'fanbox.post': {
      const postInfo = value.postInfo;
      if (
        !isRecord(postInfo) ||
        typeof postInfo.title !== 'string' ||
        typeof postInfo.id !== 'string' ||
        typeof postInfo.creatorId !== 'string'
      ) {
        return undefined;
      }
      return {
        type: 'fanbox.post',
        postInfo: { title: postInfo.title, id: postInfo.id, creatorId: postInfo.creatorId },
      };
    }
    default: {
      const rawJson = serialize(value);
      return rawJson === undefined ? undefined : { type: 'unknown', originalType: value.type, rawJson };
    }
  }
}

/** Record の各値を decode する。1 つでも decode できなければ undefined (= その投稿は invalid) */
function decodeRecordOf<T>(
  value: unknown,
  decodeValue: (item: unknown) => T | undefined,
): Record<string, T> | undefined {
  if (!isRecord(value)) return undefined;
  // キーは外部入力なので '__proto__' がありうる。通常の {} だとプロトタイプへの代入になり、
  // own property が作られずその要素が黙って消える (JSON.parse は own property として作る)
  const decoded = createNameKeyedDictionary<T>();
  for (const [key, item] of Object.entries(value)) {
    const result = decodeValue(item);
    if (result === undefined) return undefined;
    decoded[key] = result;
  }
  return decoded;
}

/** 配列の各要素を decode する。1 つでも decode できなければ undefined */
function decodeArrayOf<T>(value: unknown, decodeValue: (item: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const decoded: T[] = [];
  for (const item of value) {
    const result = decodeValue(item);
    if (result === undefined) return undefined;
    decoded.push(result);
  }
  return decoded;
}

/** decode 済みの本文。type と body を組にして返し、CollectablePostInfo の union をそのまま満たす */
type DecodedBody =
  | { type: 'image'; body: { text: string; images: ImageInfo[] } }
  | { type: 'file'; body: { text: string; files: FileInfo[] } }
  | { type: 'article'; body: ArticleBody }
  | { type: 'text'; body: { text: string } };

/**
 * 投稿タイプごとに、本文の取り込みで実際に触るフィールドを decode する。
 * 欠けている、または期待した型と異なるフィールドのパスを missing に積む。
 */
function decodeBody(type: KnownPostType, body: Record<string, unknown>, missing: string[]): DecodedBody | undefined {
  const text = typeof body.text === 'string' ? body.text : undefined;
  switch (type) {
    case 'image': {
      const images = decodeArrayOf(body.images, decodeImageInfo);
      if (!images) missing.push('body.images');
      if (text === undefined) missing.push('body.text');
      return images && text !== undefined ? { type: 'image', body: { text, images } } : undefined;
    }
    case 'file': {
      const files = decodeArrayOf(body.files, decodeFileInfo);
      if (!files) missing.push('body.files');
      if (text === undefined) missing.push('body.text');
      return files && text !== undefined ? { type: 'file', body: { text, files } } : undefined;
    }
    case 'text': {
      if (text === undefined) missing.push('body.text');
      return text === undefined ? undefined : { type: 'text', body: { text } };
    }
    case 'article': {
      const blocks = decodeArrayOf(body.blocks, decodeBlock);
      if (!blocks) missing.push('body.blocks');
      const imageMap = decodeRecordOf(body.imageMap, decodeImageInfo);
      if (!imageMap) missing.push('body.imageMap');
      const fileMap = decodeRecordOf(body.fileMap, decodeFileInfo);
      if (!fileMap) missing.push('body.fileMap');
      const embedMap = decodeRecordOf(body.embedMap, decodeEmbedValue);
      if (!embedMap) missing.push('body.embedMap');
      const urlEmbedMap = decodeRecordOf(body.urlEmbedMap, decodeUrlEmbedInfo);
      if (!urlEmbedMap) missing.push('body.urlEmbedMap');
      return blocks && imageMap && fileMap && embedMap && urlEmbedMap
        ? { type: 'article', body: { blocks, imageMap, fileMap, embedMap, urlEmbedMap } }
        : undefined;
    }
  }
}

type DecodeResult = { ok: true; post: CollectablePostInfo } | { ok: false; missing: string[] };

/**
 * candidate を検証済みの CollectablePostInfo にする。
 *
 * 検証するのは addByPostInfo が実際に読むフィールドだけで、情報 JSON に写すだけの
 * 付随メタデータは型を見ない (型が変わっても取り込む内容は欠けないため、収集を止める
 * 理由にしない)。ただしシリアライズできることは確認する。
 *
 * @param candidate 既知タイプであることまで判定済みの投稿
 * @param raw candidate と同じオブジェクト。未検証のフィールドを読むために Record として扱う
 * @param body null / undefined ではないことを判定済みの本文
 */
function decodeCollectablePost(
  candidate: PostInfoCandidate & { type: KnownPostType },
  raw: Record<string, unknown>,
  body: unknown,
): DecodeResult {
  const missing: string[] = [];
  const title = typeof raw.title === 'string' ? raw.title : undefined;
  if (title === undefined) missing.push('title');
  const tags =
    Array.isArray(raw.tags) && raw.tags.every((tag) => typeof tag === 'string') ? (raw.tags as string[]) : undefined;
  if (!tags) missing.push('tags');
  const cover = raw.coverImageUrl;
  const coverImageUrl = cover === null || cover === undefined || typeof cover === 'string' ? cover : undefined;
  if (coverImageUrl === undefined && cover !== undefined) missing.push('coverImageUrl');
  const feeRequired = typeof raw.feeRequired === 'number' ? raw.feeRequired : undefined;
  // feeRequired は addByPostInfo が手前で検証済み (無料除外の判断に使うため)。ここに来た時点で number
  const metadata: PostMetadata = {
    creatorId: raw.creatorId,
    publishedDatetime: raw.publishedDatetime,
    updatedDatetime: raw.updatedDatetime,
    likeCount: raw.likeCount,
    commentCount: raw.commentCount,
  };
  if (serialize(metadata) === undefined) missing.push('metadata');
  const decodedBody = isRecord(body) ? decodeBody(candidate.type, body, missing) : undefined;
  if (!isRecord(body)) missing.push('body');

  if (missing.length > 0 || title === undefined || !tags || feeRequired === undefined || !decodedBody) {
    return { ok: false, missing: missing.length > 0 ? missing : ['body'] };
  }
  const base = { id: candidate.id, title, tags, feeRequired, coverImageUrl, metadata };
  switch (decodedBody.type) {
    case 'image':
      return { ok: true, post: { ...base, type: 'image', body: decodedBody.body } };
    case 'file':
      return { ok: true, post: { ...base, type: 'file', body: decodedBody.body } };
    case 'article':
      return { ok: true, post: { ...base, type: 'article', body: decodedBody.body } };
    case 'text':
      return { ok: true, post: { ...base, type: 'text', body: decodedBody.body } };
  }
}

function isKnownPostType(type: string): type is KnownPostType {
  return type === 'image' || type === 'file' || type === 'article' || type === 'text';
}

/**
 * 未検証の投稿オブジェクトを検証して URL リストに追加する
 *
 * 分類の順序には理由がある。
 * 1. postInfo が無い → 本文の有無以前に何も分からないので missing-body に丸める
 * 2. feeRequired が number でない → 無料除外の判断と支援額タグの両方が壊れるので invalid
 * 3. 無料除外の指定に該当 → 以降を見ずに ignored。invalid は収集全体を止めるので、
 *    利用者が除外を指定した投稿の本文が壊れていることを理由に全体を止めない
 *    (結果として、無料かつ未知タイプ / 無料かつ閲覧不可の投稿も ignored になる)
 * 4. isRestricted → 本文が無いことの正常系の説明なので、本文の有無より先に判定する
 * 5. 未知タイプ → 本文の有無より先に判定する。後にすると未知タイプかつ body が null の投稿が
 *    missing-body に丸められ、「未知のタイプだった」情報が失われる
 * 6. body が null / undefined → missing-body。'' や 0 はここでは弾かず、decode で invalid になる
 * 7. decode 失敗 → invalid
 *
 * @param downloadManage ダウンロード設定
 * @param postInfo 未検証の投稿オブジェクト (JSON.parse 由来であること)
 * @returns 取り込んだか、取り込まなかった場合はその理由
 */
export function addByPostInfo(downloadManage: DownloadManage, postInfo: PostInfoCandidate | undefined): AddPostResult {
  if (!postInfo) {
    // postInfo 自体が無い場合は isRestricted も分からないため missing-body に丸める
    return { status: 'unavailable', reason: 'missing-body' };
  }
  // candidate が保証するのは id / type / isRestricted だけなので、残りは未検証の値として読む
  const raw = postInfo as unknown as Record<string, unknown>;
  const feeRequired = raw.feeRequired;
  if (typeof feeRequired !== 'number') {
    console.error(`支援額が読めないため取り込みませんでした\n${postInfo.type}@${postInfo.id}`);
    return { status: 'invalid', postId: postInfo.id, type: postInfo.type, missing: ['feeRequired'] };
  }
  if (downloadManage.isIgnoreFree && feeRequired === 0) {
    return { status: 'ignored' };
  }
  if (postInfo.isRestricted) {
    // isRestricted は一覧/詳細どちらの API も返す既知のフィールドなので、reason として確定できる
    console.log(`取得できませんでした(支援がたりない？)\nfeeRequired: ${feeRequired}@${postInfo.id}`);
    return { status: 'unavailable', reason: 'restricted' };
  }
  const postType = postInfo.type;
  if (!isKnownPostType(postType)) {
    console.error(`未知の投稿タイプのため取り込みませんでした\n${postType}@${postInfo.id}`);
    return { status: 'unsupported', postId: postInfo.id, type: postType };
  }
  const body = raw.body;
  if (body === null || body === undefined) {
    console.log(`本文がありませんでした\nfeeRequired: ${feeRequired}@${postInfo.id}`);
    return { status: 'unavailable', reason: 'missing-body' };
  }
  // 登録より前に decode を終える。addByPostInfo は投稿を downloadObject に登録してから本文を
  // 触るため、途中で例外になると空の投稿が出力に残り、取得件数上限の減算も飛ばされる
  const decoded = decodeCollectablePost({ ...postInfo, type: postType }, raw, body);
  if (!decoded.ok) {
    console.error(
      `投稿データの形式が想定と違うため取り込みませんでした\n${postType}@${postInfo.id} missing: ${decoded.missing.join(', ')}`,
    );
    return { status: 'invalid', postId: postInfo.id, type: postType, missing: decoded.missing };
  }
  const post = decoded.post;
  const postName = post.title;
  const postObject = downloadManage.downloadObject.addPost(postName);
  const publishedDatetime = post.metadata.publishedDatetime;
  if (typeof publishedDatetime === 'string' && publishedDatetime.length > 0) {
    postObject.setPublishedDatetime(publishedDatetime);
  }
  postObject.setTags([downloadManage.getTagByFee(post.feeRequired), ...post.tags]);
  downloadManage.addFee(post.feeRequired);
  downloadManage.addTags(...post.tags);
  const header: string = ((url: string | null | undefined) => {
    if (url) {
      const ext = url.split('.').pop() ?? '';
      return `${postObject.getImageLinkTag(postObject.setCover('cover', ext, url))}<h5>${DownloadManage.utils.escapeHtml(postName)}</h5>\n`;
    }
    return `<h5>${DownloadManage.utils.escapeHtml(postName)}</h5>\n<br>\n`;
  })(post.coverImageUrl);

  let parsedText: string;
  switch (post.type) {
    case 'image': {
      const images = post.body.images.map((it) => postObject.addFile(postName, it.extension, it.originalUrl));
      const imageTags = images.map((it) => postObject.getImageLinkTag(it)).join('<br>\n');
      const text = post.body.text
        .split('\n')
        .map((it) => `<span>${DownloadManage.utils.escapeHtml(it)}</span>`)
        .join('<br>\n');
      postObject.setHtml(`${header + imageTags}<br>\n${text}`);
      parsedText = `${post.body.text}\n`;
      break;
    }
    case 'file': {
      const files = post.body.files.map((it) => postObject.addFile(it.name, it.extension, it.url));
      const fileTags = files.map((it) => postObject.getAutoAssignedLinkTag(it)).join('<br>\n');
      const text = post.body.text
        .split('\n')
        .map((it) => `<span>${DownloadManage.utils.escapeHtml(it)}</span>`)
        .join('<br>\n');
      postObject.setHtml(`${header + fileTags}<br>\n${text}`);
      parsedText = `${post.body.text}\n`;
      break;
    }
    case 'article': {
      const images = convertImageMap(post.body.imageMap, post.body.blocks).map((it) =>
        postObject.addFile(postName, it.extension, it.originalUrl),
      );
      const files = convertFileMap(post.body.fileMap, post.body.blocks).map((it) =>
        postObject.addFile(it.name, it.extension, it.url),
      );
      const embeds = convertEmbedMap(post.body.embedMap, post.body.blocks);
      const urlEmbeds = convertUrlEmbedMap(post.body.urlEmbedMap, post.body.blocks);
      let cntImg = 0,
        cntFile = 0,
        cntEmbed = 0,
        cntUrlEmbed = 0;
      const body = post.body.blocks
        .map((it) => {
          switch (it.type) {
            case 'p':
              return `<span>${DownloadManage.utils.escapeHtml(it.text)}</span>`;
            case 'header':
              return `<h2><span>${DownloadManage.utils.escapeHtml(it.text)}</span></h2>`;
            case 'file': {
              if (cntFile >= files.length) return '';
              return postObject.getAutoAssignedLinkTag(files[cntFile++]);
            }
            case 'image': {
              if (cntImg >= images.length) return '';
              return postObject.getImageLinkTag(images[cntImg++]);
            }
            case 'embed': {
              if (cntEmbed >= embeds.length) return '';
              // 中身の型が分からないので JSON 文字列のまま出す (decode 時に文字列化済み)
              return `<span>${DownloadManage.utils.escapeHtml(embeds[cntEmbed++].rawJson)}</span>`;
            }
            case 'url_embed': {
              if (cntUrlEmbed >= urlEmbeds.length) return '';
              const urlEmbedInfo = urlEmbeds[cntUrlEmbed++];
              switch (urlEmbedInfo.type) {
                case 'default':
                  return postObject.getLinkTag(urlEmbedInfo.url, urlEmbedInfo.host);
                case 'html':
                case 'html.card': {
                  const iframeUrl = urlEmbedInfo.html.match(/<iframe.*src="(http.*)"/)?.[1];
                  return iframeUrl
                    ? postObject.getLinkTag(iframeUrl, 'iframe link')
                    : `\n${DownloadManage.utils.escapeHtml(urlEmbedInfo.html)}\n\n`;
                }
                case 'fanbox.post': {
                  const url = `https://www.fanbox.cc/@${urlEmbedInfo.postInfo.creatorId}/posts/${urlEmbedInfo.postInfo.id}`;
                  return postObject.getLinkTag(url, urlEmbedInfo.postInfo.title);
                }
                case 'unknown':
                  // 中身の型が分からないので JSON 文字列のまま出す (decode 時に文字列化済み)
                  return `<span>${DownloadManage.utils.escapeHtml(urlEmbedInfo.rawJson)}</span>`;
                default: {
                  // 既知 variant を追加したときの処理漏れをコンパイル時に検出する
                  const exhaustive: never = urlEmbedInfo;
                  return `${exhaustive}`;
                }
              }
            }
            case 'unknown':
              // 正規化前の type 名でログを出す (sentinel に畳んだせいで診断が劣化しないように)
              return console.error(`unknown block type: ${it.originalType}`);
            default: {
              const exhaustive: never = it;
              return `${exhaustive}`;
            }
          }
        })
        .join('<br>\n');
      postObject.setHtml(header + body);
      parsedText = `${post.body.blocks
        .filter((it): it is TextBlock => it.type === 'p' || it.type === 'header')
        .map((it) => it.text)
        .join('\n')}\n`;
      break;
    }
    case 'text': {
      const body = post.body.text
        .split('\n')
        .map((it) => `<span>${DownloadManage.utils.escapeHtml(it)}</span>`)
        .join('<br>\n');
      parsedText = post.body.text;
      postObject.setHtml(header + body);
      break;
    }
  }

  const informationObject = {
    postId: post.id,
    title: post.title,
    creatorId: post.metadata.creatorId,
    fee: post.feeRequired,
    publishedDatetime: post.metadata.publishedDatetime,
    updatedDatetime: post.metadata.updatedDatetime,
    tags: post.tags,
    likeCount: post.metadata.likeCount,
    commentCount: post.metadata.commentCount,
  };
  if (DownloadManage.isExportJson) {
    postObject.setInfo(JSON.stringify({ ...informationObject, parsedText }));
  } else {
    const exportInfoText = (Object.keys(informationObject) as (keyof typeof informationObject)[])
      .map((key) => `${key}:${JSON.stringify(informationObject[key])}`)
      .join('\n');
    postObject.setInfo(`${exportInfoText}\nparsedText:\n${parsedText}`);
  }
  downloadManage.decrementLimit();
  return { status: 'added' };
}

/*
 * 以下の convert*Map は decode 済みの内部表現を並べ替えるだけの実装詳細なので公開しない。
 * 公開すると「raw を受けるのか正規化済みを受けるのか」「呼び出し側にも decoder が要るのか」
 * という新しい契約が生じる。並び順の検証は addByPostInfo 経由の結合テストで行う。
 */

function convertImageMap(imageMap: Record<string, ImageInfo>, blocks: Block[]): ImageInfo[] {
  const imageOrder = blocks.filter((it): it is ImageBlock => it.type === 'image').map((it) => it.imageId);
  const imageKeyOrder = (s: string) => {
    const idx = imageOrder.indexOf(s);
    return idx === -1 ? imageOrder.length : idx;
  };
  return Object.keys(imageMap)
    .sort((a, b) => imageKeyOrder(a) - imageKeyOrder(b))
    .map((it) => imageMap[it]);
}

function convertFileMap(fileMap: Record<string, FileInfo>, blocks: Block[]): FileInfo[] {
  const fileOrder = blocks.filter((it): it is FileBlock => it.type === 'file').map((it) => it.fileId);
  const fileKeyOrder = (s: string) => {
    const idx = fileOrder.indexOf(s);
    return idx === -1 ? fileOrder.length : idx;
  };
  return Object.keys(fileMap)
    .sort((a, b) => fileKeyOrder(a) - fileKeyOrder(b))
    .map((it) => fileMap[it]);
}

function convertEmbedMap(embedMap: Record<string, EmbedValue>, blocks: Block[]): EmbedValue[] {
  const embedOrder = blocks.filter((it): it is EmbedBlock => it.type === 'embed').map((it) => it.embedId);
  const embedKeyOrder = (s: string) => {
    const idx = embedOrder.indexOf(s);
    return idx === -1 ? embedOrder.length : idx;
  };
  return Object.keys(embedMap)
    .sort((a, b) => embedKeyOrder(a) - embedKeyOrder(b))
    .map((it) => embedMap[it]);
}

function convertUrlEmbedMap(urlEmbedMap: Record<string, UrlEmbedInfo>, blocks: Block[]): UrlEmbedInfo[] {
  const urlEmbedOrder = blocks.filter((it): it is UrlEmbedBlock => it.type === 'url_embed').map((it) => it.urlEmbedId);
  const urlEmbedKeyOrder = (s: string) => {
    const idx = urlEmbedOrder.indexOf(s);
    return idx === -1 ? urlEmbedOrder.length : idx;
  };
  return Object.keys(urlEmbedMap)
    .sort((a, b) => urlEmbedKeyOrder(a) - urlEmbedKeyOrder(b))
    .map((it) => urlEmbedMap[it]);
}
