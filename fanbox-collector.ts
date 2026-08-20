/**
 * fanbox-downloader / fanbox-downloader-extension 共用の FANBOX 固有収集ロジック
 * pixiv FANBOX の API レスポンス型、DownloadManage (収集時の状態管理)、
 * postInfo → DownloadObject への変換処理をまとめる。
 */
import { DownloadObject, DownloadUtils } from './download-helper';

/**
 * プランAPIの型
 * @see https://api.fanbox.cc/plan.listCreator?creatorId=${creatorId}
 */
export type PlansResponse = {
  body?: {
    plans: PlanInfo[];
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
    featuredTags: TagInfo[];
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
    pageUrls: string[];
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
    posts: PostListItem[];
  };
};

/** @deprecated PostListResponse を使うこと */
export type PostList = PostListResponse;

/**
 * 投稿一覧と投稿詳細のどちらのレスポンスにも入る共通フィールド。
 * 片方だけ直すと乖離するため、両者はこれを共有する。
 */
export type PostBase = {
  id: string;
  title: string;
  feeRequired: number;
  creatorId: string;
  excerpt: string;
  isRestricted: boolean;
  tags: string[];
  // DateはJSON.parseで文字列扱い
  publishedDatetime: string;
  updatedDatetime: string;
  likeCount: number;
  commentCount: number;
};

/**
 * 一覧 (post.listCreator) では必ず返るフィールド。
 * 詳細 (post.info) のレスポンスにも 2026-07 の観測では入っていたが、それは存在の確認に
 * とどまり、全投稿タイプ・全状態で必ず返ることまでは示していない。そのため PostInfo 側は
 * これを Partial で持つ。
 */
export type PostAdditionalFields = {
  user: UserInfo;
  isLiked: boolean;
  isPinned: boolean;
  isCommentingRestricted: boolean;
  hasAdultContent: boolean;
};

/**
 * 投稿一覧の要素の型
 * 詳細 (PostInfo) と違って type / body を持たず、カバー画像も cover.url に入る。
 * 本文を得るには post.info を別途叩く必要がある。
 */
export type PostListItem = PostBase &
  PostAdditionalFields & {
    // 観測できた type は 'cover_image' のみだが、他の値がありうるので絞り込まない
    cover: { type: string; url: string } | null;
  };

export type UserInfo = {
  userId: string;
  name: string;
  iconUrl: string | null;
};

/**
 * 投稿詳細APIの型
 * @see https://api.fanbox.cc/post.info?postId=${postId}
 */
export type PostInfoResponse = {
  body?: {
    post: PostInfo;
  };
};

/**
 * 投稿詳細の型
 * 一覧 (post.listCreator) の要素はこの形状ではない。PostListItem を使うこと。
 *
 * 閲覧できない投稿でも post.info は 200 で投稿オブジェクトを返し、body はプロパティごと
 * 欠けるのではなく値が null になる (type / isRestricted / coverImageUrl は通常どおり入る)。
 * isRestricted を discriminant にして restricted variant を分ける案は採らない: 逆向きの
 * 「isRestricted: false なら body は非 null」まで型で保証することになるが、そちらは未観測で、
 * 保証できない相関を型に昇格させることになる。
 * @see https://api.fanbox.cc/post.info?postId=${postId}
 */
export type PostInfo = PostBase &
  Partial<PostAdditionalFields> & {
    coverImageUrl: string | null;
  } & (
    | {
        type: 'image';
        body: { text: string; images: ImageInfo[] } | null;
      }
    | {
        type: 'file';
        body: { text: string; files: FileInfo[] } | null;
      }
    | {
        type: 'article';
        body: {
          imageMap: Record<string, ImageInfo>;
          fileMap: Record<string, FileInfo>;
          embedMap: Record<string, EmbedInfo>; // TODO embedMapの対応
          urlEmbedMap: Record<string, UrlEmbedInfo>;
          blocks: Block[];
        } | null;
      }
    | {
        type: 'text';
        body: { text: string } | null;
      }
    | {
        type: 'unknown';
        body: unknown;
      }
  );

// articleタイプのマップ型に対する値の型
export type ImageInfo = { originalUrl: string; extension: string };
export type FileInfo = { url: string; name: string; extension: string };
export type EmbedInfo = unknown; // FIXME
export type UrlEmbedInfo = { id: string } & (
  | { type: 'default'; url: string; host: string }
  | { type: 'html'; html: string }
  | { type: 'html.card'; html: string }
  | {
      type: 'fanbox.post';
      postInfo: { id: string; title: string; creatorId: string; coverImageUrl?: string };
    }
  | { type: 'unknown'; [key: string]: unknown }
); // 他の型がありそうなので入れてる

// articleタイプのBlock構成要素
export type ImageBlock = { type: 'image'; imageId: string };
export type FileBlock = { type: 'file'; fileId: string };
export type TextBlock = { type: 'p' | 'header'; text: string };
export type EmbedBlock = { type: 'embed'; embedId: string };
export type UrlEmbedBlock = { type: 'url_embed'; urlEmbedId: string };
export type UnknownBlock = { type: 'unknown' }; // 他の型がありそうなので入れてる default句で使ってるのでコンパイルすると型が消えて他のを除いた全部に対応する
export type Block = ImageBlock | FileBlock | TextBlock | EmbedBlock | UrlEmbedBlock | UnknownBlock;

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
  /** 既知の投稿タイプだが、本文の必要フィールドが揃っていない (構造的な不一致) */
  | { status: 'invalid'; postId: string; type: string; missing: string[] }
  /** 未知の投稿タイプ。本文を読めないので取り込めないが、収集全体は中断しない */
  | { status: 'unsupported'; postId: string; type: string };

/** postInfo.body の中で addByPostInfo が実際に処理できる投稿タイプ */
type KnownPostType = 'image' | 'file' | 'article' | 'text';

/** 配列ではないオブジェクトか (Record として扱ってよいか) を判定する。配列は isRecord ではない */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isImageInfo(value: unknown): value is ImageInfo {
  return (
    isRecord(value) &&
    typeof (value as { originalUrl?: unknown }).originalUrl === 'string' &&
    typeof (value as { extension?: unknown }).extension === 'string'
  );
}

function isFileInfo(value: unknown): value is FileInfo {
  return (
    isRecord(value) &&
    typeof (value as { url?: unknown }).url === 'string' &&
    typeof (value as { name?: unknown }).name === 'string' &&
    typeof (value as { extension?: unknown }).extension === 'string'
  );
}

/**
 * article の block を検証する。type だけが全 block 共通で参照されるフィールドで、
 * 'p' / 'header' はさらに text を DownloadUtils.escapeHtml に直接渡すため
 * (非文字列を渡すと String.prototype.replace が無く例外になる)、その 2 種のみ text も見る。
 * embed / url_embed / 未知の block type は該当データが無ければ JSON.stringify や
 * デフォルト分岐で吸収され例外にならないため、ここでは検証しない。
 */
function isValidBlock(value: unknown): boolean {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  if (value.type === 'p' || value.type === 'header') {
    return typeof (value as { text?: unknown }).text === 'string';
  }
  return true;
}

/**
 * urlEmbedMap の要素を検証する。
 *
 * embedMap の要素と違い、消費側 (addByPostInfo 内の 'url_embed' 分岐) は
 * `urlEmbedInfo.type` を直接読む。要素が null や配列などの非 record だとそこで即座に
 * 例外になるため、まず record であることを必須にする。
 * 既知の type ('default' / 'html' / 'html.card' / 'fanbox.post') はさらに、消費側が
 * 文字列メソッド (escapeHtml の String.prototype.replace、html.match) を直接呼ぶ
 * フィールドだけを検証する。未知の type は消費側が JSON.stringify + escapeHtml で
 * 吸収し例外にならないため、record であること以上は検証しない。
 */
function isValidUrlEmbedInfo(value: unknown): boolean {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case 'default':
      return (
        typeof (value as { url?: unknown }).url === 'string' && typeof (value as { host?: unknown }).host === 'string'
      );
    case 'html':
    case 'html.card':
      return typeof (value as { html?: unknown }).html === 'string';
    case 'fanbox.post': {
      const postInfo = (value as { postInfo?: unknown }).postInfo;
      // creatorId / id はテンプレートリテラルに埋め込まれるだけで未定義でも例外にならないが、
      // title は escapeHtml に渡るため文字列を必須にする
      return isRecord(postInfo) && typeof (postInfo as { title?: unknown }).title === 'string';
    }
    default:
      return true;
  }
}

/**
 * 投稿タイプによらず addByPostInfo が本文外 (postInfo 直下) で参照するフィールドを検査する。
 *
 * - title: addPost(postName) の内部で DownloadUtils.encodeFileName が String.prototype.replace を
 *   直接呼ぶほか、header 生成でも escapeHtml(postName) に渡る。いずれも非文字列だと例外になる
 * - tags: `[...postInfo.tags]` で 2 箇所 (setTags 呼び出し、addTags 呼び出し) スプレッドしており、
 *   配列 (正確には iterable) でないとその場で例外になる。要素自体は Set への格納や
 *   JSON.stringify にしか使われず文字列メソッドを直接呼ばれないため、要素の型までは検証しない
 * - coverImageUrl: truthy なら header 生成で `.split('.')` を直接呼ぶため、文字列でない truthy 値
 *   だと例外になる。null / undefined は falsy 分岐に流れるだけなので許容する
 */
function checkCommonFields(postInfo: PostInfo): string[] {
  const missing: string[] = [];
  if (typeof postInfo.title !== 'string') missing.push('title');
  if (!Array.isArray(postInfo.tags)) missing.push('tags');
  if (
    postInfo.coverImageUrl !== null &&
    postInfo.coverImageUrl !== undefined &&
    typeof postInfo.coverImageUrl !== 'string'
  ) {
    missing.push('coverImageUrl');
  }
  return missing;
}

/**
 * 投稿タイプごとに、本文の取り込みで実際に触るフィールドを検査し、欠けているものを返す。
 *
 * addByPostInfo は投稿を downloadObject に登録してから本文を触るため、途中で例外になると
 * 空の投稿が出力に残り、取得件数上限の減算も飛ばされる。登録前にここで弾いて
 * その状態を作らせない。呼び出し側は addByPostInfo が既知タイプと確認した後にのみ呼ぶため、
 * 未知タイプはここに来ない。本文外の共通フィールドは checkCommonFields が別途検査する。
 */
function checkBody(postInfo: PostInfo & { type: KnownPostType }): string[] {
  const body = postInfo.body as Record<string, unknown>;
  const missing: string[] = [];
  switch (postInfo.type) {
    case 'image':
      if (!Array.isArray(body.images) || !body.images.every(isImageInfo)) missing.push('body.images');
      if (typeof body.text !== 'string') missing.push('body.text');
      break;
    case 'file':
      if (!Array.isArray(body.files) || !body.files.every(isFileInfo)) missing.push('body.files');
      if (typeof body.text !== 'string') missing.push('body.text');
      break;
    case 'article':
      if (!Array.isArray(body.blocks) || !body.blocks.every(isValidBlock)) missing.push('body.blocks');
      if (!isRecord(body.imageMap) || !Object.values(body.imageMap).every(isImageInfo)) missing.push('body.imageMap');
      if (!isRecord(body.fileMap) || !Object.values(body.fileMap).every(isFileInfo)) missing.push('body.fileMap');
      // embedMap の要素は消費側で JSON.stringify に渡すだけ (JSON.parse 由来の値である限り
      // null を含め常に文字列化できる) なので、コンテナが record であること以上は検証しない
      if (!isRecord(body.embedMap)) missing.push('body.embedMap');
      if (!isRecord(body.urlEmbedMap) || !Object.values(body.urlEmbedMap).every(isValidUrlEmbedInfo))
        missing.push('body.urlEmbedMap');
      break;
    case 'text':
      if (typeof body.text !== 'string') missing.push('body.text');
      break;
  }
  return missing;
}

/**
 * postInfoオブジェクトからURLリストに追加する
 * @param downloadManage ダウンロード設定
 * @param postInfo 投稿情報オブジェクト
 * @returns 取り込んだか、取り込まなかった場合はその理由
 */
export function addByPostInfo(downloadManage: DownloadManage, postInfo: PostInfo | undefined): AddPostResult {
  if (!postInfo) {
    // postInfo 自体が無い場合は isRestricted も分からないため missing-body に丸める
    return { status: 'unavailable', reason: 'missing-body' };
  }
  if (downloadManage.isIgnoreFree && postInfo.feeRequired === 0) {
    return { status: 'ignored' };
  }
  if (postInfo.isRestricted) {
    // isRestricted は一覧/詳細どちらの API も返す既知のフィールドなので、reason として確定できる
    console.log(`取得できませんでした(支援がたりない？)\nfeeRequired: ${postInfo.feeRequired}@${postInfo.id}`);
    return { status: 'unavailable', reason: 'restricted' };
  }
  if (!postInfo.body) {
    console.log(`本文がありませんでした\nfeeRequired: ${postInfo.feeRequired}@${postInfo.id}`);
    return { status: 'unavailable', reason: 'missing-body' };
  }
  // switch の discriminant として type を直接比較することで、以降のコードで
  // postInfo.type が KnownPostType (image/file/article/text) に絞り込まれた状態を
  // TypeScript に伝える (ヘルパー関数越しの判定では絞り込みが postInfo 全体に伝播しない)
  switch (postInfo.type) {
    case 'image':
    case 'file':
    case 'article':
    case 'text':
      break;
    default:
      console.error(`未知の投稿タイプのため取り込みませんでした\n${postInfo.type}@${postInfo.id}`);
      return { status: 'unsupported', postId: postInfo.id, type: postInfo.type };
  }
  const missing = [...checkCommonFields(postInfo), ...checkBody(postInfo)];
  if (missing.length > 0) {
    console.error(
      `投稿データの形式が想定と違うため取り込みませんでした\n${postInfo.type}@${postInfo.id} missing: ${missing.join(', ')}`,
    );
    return { status: 'invalid', postId: postInfo.id, type: postInfo.type, missing };
  }
  const postName = postInfo.title;
  const postObject = downloadManage.downloadObject.addPost(postName);
  const publishedDatetime = (postInfo as { publishedDatetime?: unknown }).publishedDatetime;
  if (typeof publishedDatetime === 'string' && publishedDatetime.length > 0) {
    postObject.setPublishedDatetime(publishedDatetime);
  }
  postObject.setTags([downloadManage.getTagByFee(postInfo.feeRequired), ...postInfo.tags]);
  downloadManage.addFee(postInfo.feeRequired);
  downloadManage.addTags(...postInfo.tags);
  const header: string = ((url: string | null) => {
    if (url) {
      const ext = url.split('.').pop() ?? '';
      return `${postObject.getImageLinkTag(postObject.setCover('cover', ext, url))}<h5>${DownloadManage.utils.escapeHtml(postName)}</h5>\n`;
    }
    return `<h5>${DownloadManage.utils.escapeHtml(postName)}</h5>\n<br>\n`;
  })(postInfo.coverImageUrl);

  let parsedText: string;
  switch (postInfo.type) {
    case 'image': {
      const images = postInfo.body.images.map((it) => postObject.addFile(postName, it.extension, it.originalUrl));
      const imageTags = images.map((it) => postObject.getImageLinkTag(it)).join('<br>\n');
      const text = postInfo.body.text
        .split('\n')
        .map((it) => `<span>${DownloadManage.utils.escapeHtml(it)}</span>`)
        .join('<br>\n');
      postObject.setHtml(`${header + imageTags}<br>\n${text}`);
      parsedText = `${postInfo.body.text}\n`;
      break;
    }
    case 'file': {
      const files = postInfo.body.files.map((it) => postObject.addFile(it.name, it.extension, it.url));
      const fileTags = files.map((it) => postObject.getAutoAssignedLinkTag(it)).join('<br>\n');
      const text = postInfo.body.text
        .split('\n')
        .map((it) => `<span>${DownloadManage.utils.escapeHtml(it)}</span>`)
        .join('<br>\n');
      postObject.setHtml(`${header + fileTags}<br>\n${text}`);
      parsedText = `${postInfo.body.text}\n`;
      break;
    }
    case 'article': {
      const images = convertImageMap(postInfo.body.imageMap, postInfo.body.blocks).map((it) =>
        postObject.addFile(postName, it.extension, it.originalUrl),
      );
      const files = convertFileMap(postInfo.body.fileMap, postInfo.body.blocks).map((it) =>
        postObject.addFile(it.name, it.extension, it.url),
      );
      const embeds = convertEmbedMap(postInfo.body.embedMap, postInfo.body.blocks);
      const urlEmbeds = convertUrlEmbedMap(postInfo.body.urlEmbedMap, postInfo.body.blocks);
      let cntImg = 0,
        cntFile = 0,
        cntEmbed = 0,
        cntUrlEmbed = 0;
      const body = postInfo.body.blocks
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
              // FIXME 型が分からないのでJSON化して中身だけ出す
              return `<span>${DownloadManage.utils.escapeHtml(JSON.stringify(embeds[cntEmbed++]))}</span>`;
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
                default:
                  // FIXME 型が分からないのでJSON化して中身だけ出す
                  return `<span>${DownloadManage.utils.escapeHtml(JSON.stringify(urlEmbedInfo))}</span>`;
              }
            }
            default:
              return console.error(`unknown block type: ${it.type}`);
          }
        })
        .join('<br>\n');
      postObject.setHtml(header + body);
      parsedText = `${postInfo.body.blocks
        .filter((it): it is TextBlock => it.type === 'p' || it.type === 'header')
        .map((it) => it.text)
        .join('\n')}\n`;
      break;
    }
    case 'text': {
      const body = postInfo.body.text
        .split('\n')
        .map((it) => `<span>${DownloadManage.utils.escapeHtml(it)}</span>`)
        .join('<br>\n');
      parsedText = postInfo.body.text;
      postObject.setHtml(header + body);
      break;
    }
    // 未知タイプは手前の switch で既に unsupported として返しているため、
    // ここに来た時点で postInfo.type は KnownPostType の 4 種のいずれかに絞り込まれている
  }

  const informationObject = {
    postId: postInfo.id,
    title: postInfo.title,
    creatorId: postInfo.creatorId,
    fee: postInfo.feeRequired,
    publishedDatetime: postInfo.publishedDatetime,
    updatedDatetime: postInfo.updatedDatetime,
    tags: postInfo.tags,
    likeCount: postInfo.likeCount,
    commentCount: postInfo.commentCount,
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

export function convertImageMap(imageMap: Record<string, ImageInfo>, blocks: Block[]): ImageInfo[] {
  const imageOrder = blocks.filter((it): it is ImageBlock => it.type === 'image').map((it) => it.imageId);
  const imageKeyOrder = (s: string) => {
    const idx = imageOrder.indexOf(s);
    return idx === -1 ? imageOrder.length : idx;
  };
  return Object.keys(imageMap)
    .sort((a, b) => imageKeyOrder(a) - imageKeyOrder(b))
    .map((it) => imageMap[it]);
}

export function convertFileMap(fileMap: Record<string, FileInfo>, blocks: Block[]): FileInfo[] {
  const fileOrder = blocks.filter((it): it is FileBlock => it.type === 'file').map((it) => it.fileId);
  const fileKeyOrder = (s: string) => {
    const idx = fileOrder.indexOf(s);
    return idx === -1 ? fileOrder.length : idx;
  };
  return Object.keys(fileMap)
    .sort((a, b) => fileKeyOrder(a) - fileKeyOrder(b))
    .map((it) => fileMap[it]);
}

export function convertEmbedMap(embedMap: Record<string, EmbedInfo>, blocks: Block[]): EmbedInfo[] {
  const embedOrder = blocks.filter((it): it is EmbedBlock => it.type === 'embed').map((it) => it.embedId);
  const embedKeyOrder = (s: string) => {
    const idx = embedOrder.indexOf(s);
    return idx === -1 ? embedOrder.length : idx;
  };
  return Object.keys(embedMap)
    .sort((a, b) => embedKeyOrder(a) - embedKeyOrder(b))
    .map((it) => embedMap[it]);
}

export function convertUrlEmbedMap(urlEmbedMap: Record<string, UrlEmbedInfo>, blocks: Block[]): UrlEmbedInfo[] {
  const urlEmbedOrder = blocks.filter((it): it is UrlEmbedBlock => it.type === 'url_embed').map((it) => it.urlEmbedId);
  const urlEmbedKeyOrder = (s: string) => {
    const idx = urlEmbedOrder.indexOf(s);
    return idx === -1 ? urlEmbedOrder.length : idx;
  };
  return Object.keys(urlEmbedMap)
    .sort((a, b) => urlEmbedKeyOrder(a) - urlEmbedKeyOrder(b))
    .map((it) => urlEmbedMap[it]);
}
