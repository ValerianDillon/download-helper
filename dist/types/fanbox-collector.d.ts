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
export type Plans = {
    body?: {
        plans: PlanInfo[];
    };
};
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
export type Tags = {
    body?: {
        featuredTags: TagInfo[];
    };
};
export type TagInfo = {
    tag: string;
    count: number;
    coverImageUrl: string | null;
};
/**
 * 投稿一覧のページURL APIの型
 * @see https://api.fanbox.cc/post.paginateCreator?creatorId=${creatorId}
 */
export type PaginatedPosts = {
    body?: {
        pageUrls: string[];
    };
};
/**
 * 投稿一覧APIの型
 * @see https://api.fanbox.cc/post.listCreator?creatorId=${creatorId}
 */
export type PostList = {
    body?: {
        posts: PostListItem[];
    };
};
/**
 * 投稿一覧の要素の型
 * 詳細 (PostInfo) と違って type / body を持たず、カバー画像も cover.url に入る。
 * 本文を得るには post.info を別途叩く必要がある。
 */
export type PostListItem = {
    id: string;
    title: string;
    feeRequired: number;
    creatorId: string;
    user: UserInfo;
    excerpt: string;
    isRestricted: boolean;
    isLiked: boolean;
    isPinned: boolean;
    isCommentingRestricted: boolean;
    hasAdultContent: boolean;
    tags: string[];
    publishedDatetime: string;
    updatedDatetime: string;
    likeCount: number;
    commentCount: number;
    cover: {
        type: string;
        url: string;
    } | null;
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
export type PostInfo = {
    title: string;
    feeRequired: number;
    id: string;
    creatorId: string;
    coverImageUrl: string | null;
    excerpt: string;
    isRestricted: boolean;
    tags: string[];
    publishedDatetime: string;
    updatedDatetime: string;
    likeCount: number;
    commentCount: number;
} & ({
    type: 'image';
    body: {
        text: string;
        images: ImageInfo[];
    } | null;
} | {
    type: 'file';
    body: {
        text: string;
        files: FileInfo[];
    } | null;
} | {
    type: 'article';
    body: {
        imageMap: Record<string, ImageInfo>;
        fileMap: Record<string, FileInfo>;
        embedMap: Record<string, EmbedInfo>;
        urlEmbedMap: Record<string, UrlEmbedInfo>;
        blocks: Block[];
    } | null;
} | {
    type: 'text';
    body: {
        text: string;
    } | null;
} | {
    type: 'unknown';
    body: unknown;
});
export type ImageInfo = {
    originalUrl: string;
    extension: string;
};
export type FileInfo = {
    url: string;
    name: string;
    extension: string;
};
export type EmbedInfo = unknown;
export type UrlEmbedInfo = {
    id: string;
} & ({
    type: 'default';
    url: string;
    host: string;
} | {
    type: 'html';
    html: string;
} | {
    type: 'html.card';
    html: string;
} | {
    type: 'fanbox.post';
    postInfo: {
        id: string;
        title: string;
        creatorId: string;
        coverImageUrl?: string;
    };
} | {
    type: 'unknown';
    [key: string]: unknown;
});
export type ImageBlock = {
    type: 'image';
    imageId: string;
};
export type FileBlock = {
    type: 'file';
    fileId: string;
};
export type TextBlock = {
    type: 'p' | 'header';
    text: string;
};
export type EmbedBlock = {
    type: 'embed';
    embedId: string;
};
export type UrlEmbedBlock = {
    type: 'url_embed';
    urlEmbedId: string;
};
export type UnknownBlock = {
    type: 'unknown';
};
export type Block = ImageBlock | FileBlock | TextBlock | EmbedBlock | UrlEmbedBlock | UnknownBlock;
/**
 * ダウンローダーの管理クラス
 */
export declare class DownloadManage {
    readonly userId: string;
    readonly feeMap: Map<number, string>;
    /** ダウンロード用ユーティリティ 何かあれば適当にオーバライドする */
    static readonly utils: DownloadUtils;
    /** 投稿情報の出力をJSONにする（基本true, txtにする場合はfalseに変える）*/
    static readonly isExportJson = true;
    readonly downloadObject: DownloadObject;
    isIgnoreFree: boolean;
    private fees;
    private tags;
    private isLimitAvailable;
    private limit;
    constructor(userId: string, feeMap: Map<number, string>);
    addFee(fee: number): void;
    addTags(...tags: string[]): void;
    applyTags(): void;
    getTagByFee(fee: number): string;
    setLimitAvailable(isLimitAvailable: boolean): void;
    isLimitValid(): boolean;
    decrementLimit(): void;
    setLimit(limit: number): void;
}
/**
 * addByPostInfo の処理結果
 * 呼び出し側が「意図した除外」と「取れなかった投稿」、および取れなかった理由を
 * 区別できるようにするための判別可能な戻り値。文字列 1 個への集約だと、呼び出し側が
 * 理由ごとに別対応 (継続 / 中断 / 表示の出し分け) をしたくても情報が足りない。
 */
export type AddPostResult = 
/** 取り込んだ */
{
    status: 'added';
}
/** isIgnoreFree の設定により意図的に除外した */
 | {
    status: 'ignored';
}
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
 | {
    status: 'invalid';
    postId: string;
    type: string;
    missing: string[];
}
/** 未知の投稿タイプ。本文を読めないので取り込めないが、収集全体は中断しない */
 | {
    status: 'unsupported';
    postId: string;
    type: string;
};
/**
 * postInfoオブジェクトからURLリストに追加する
 * @param downloadManage ダウンロード設定
 * @param postInfo 投稿情報オブジェクト
 * @returns 取り込んだか、取り込まなかった場合はその理由
 */
export declare function addByPostInfo(downloadManage: DownloadManage, postInfo: PostInfo | undefined): AddPostResult;
export declare function convertImageMap(imageMap: Record<string, ImageInfo>, blocks: Block[]): ImageInfo[];
export declare function convertFileMap(fileMap: Record<string, FileInfo>, blocks: Block[]): FileInfo[];
export declare function convertEmbedMap(embedMap: Record<string, EmbedInfo>, blocks: Block[]): EmbedInfo[];
export declare function convertUrlEmbedMap(urlEmbedMap: Record<string, UrlEmbedInfo>, blocks: Block[]): UrlEmbedInfo[];
