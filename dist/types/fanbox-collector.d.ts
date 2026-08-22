/**
 * fanbox-downloader / fanbox-downloader-extension 共用の FANBOX 固有収集ロジック
 * pixiv FANBOX の API レスポンス型、DownloadManage (収集時の状態管理)、
 * postInfo → DownloadObject への変換処理をまとめる。
 */
import { type ArchivePathAllocator, DownloadObject, DownloadUtils } from './download-helper';
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
    /**
     * @param userId クリエイターID
     * @param feeMap 支援額とプラン名の対応
     * @param allocator archive path の割り当て器 (省略時は従来の採番規則)
     */
    constructor(userId: string, feeMap: Map<number, string>, allocator?: ArchivePathAllocator);
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
/**
 * 既知の投稿タイプだが、収集に必要なフィールドが揃っていない (構造的な不一致)。
 * missing には欠落している、または期待した型と異なるフィールドのパスが入る
 * (本文だけでなく feeRequired / title / tags / coverImageUrl / 付随メタデータも対象)
 */
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
export declare function addByPostInfo(downloadManage: DownloadManage, postInfo: PostInfoCandidate | undefined): AddPostResult;
