/**
 * API 呼び出しのレート制御セッション。
 *
 * 全エンドポイントをここに通し、待機だけでなく発行から応答処理までを直列化する。
 * FANBOX に限らない汎用のレート制御なので、URL の組み立てやレスポンス検証は持たない
 * (それらは利用側の validator と transport が担う)。
 *
 * 実際の I/O は Transport が行う。ページ origin からの同期 XHR、拡張の service worker
 * プロキシなど、実行環境ごとの差は Transport 側に閉じる。
 */
/**
 * 実際に I/O を発行した時刻 (epoch ms)。プロセスをまたぐ transport だけが報告する。
 *
 * セッションは transport を呼ぶ直前の時刻を発行時刻として記録するが、拡張の service worker
 * プロキシのように実 I/O が別プロセスで起きる transport では、配送の遅れぶん記録と実発行が
 * ずれる。ずれた記録を基準にすると次のゲートがその遅延ぶん早く明け、実 I/O の間隔が
 * 発行間隔を下回りうる (ValerianDillon/fanbox-downloader-extension#46)。
 * 報告があればセッションはそちらを発行時刻として採る。
 *
 * 同一プロセスで発行する transport は報告しなくてよい (省略時は呼び出し直前の時刻を使う)。
 */
type IssuedAt = {
    issuedAt?: number;
};
/**
 * 取得できた応答。status が読めたという事実だけを表す。
 */
export type TransportResponse = IssuedAt & {
    kind: 'response';
    status: number;
    body: string;
    retryAfter: string | null;
};
/**
 * 応答を得られなかった失敗。CORS・DNS・オフライン・TLS などが該当する。
 * status を推測しない: 非可視の 429 かもしれないが、それは観測ではなく推測である。
 *
 * I/O を発行した後の失敗なら issuedAt を報告できる (発行そのものは起きているため、
 * 次の発行はその時刻から間隔を空ける)。発行前に失敗したなら報告しない。
 */
export type TransportFailure = IssuedAt & {
    kind: 'unobservable-failure';
    cause?: unknown;
};
/**
 * 外部の制約により transport が I/O を発行しなかったことを表す。until までは発行できない。
 *
 * adapter の内側で待って再要求すると、セッションが実際の発行時刻を見失う。
 * 発行時刻はゲート直前に記録されるため、adapter が until まで待ってから実発行すると、
 * 次の要求はその古い記録を見て即座に発行してしまい、基準間隔と適応間隔が抜ける。
 * したがって「発行しなかった」ことをセッションへ返し、待機と再発行はセッションが行う。
 */
export type TransportDeferred = {
    kind: 'deferred';
    until: number;
};
export type TransportResult = TransportResponse | TransportFailure | TransportDeferred;
export type Transport = (url: string, signal?: AbortSignal) => Promise<TransportResult>;
/**
 * 応答は得られたが JSON として読めなかった。
 * 通信の問題ではないので再試行しない。利用側が仕様変更として扱えるよう型を分ける。
 */
export declare class ResponseParseError extends Error {
    readonly url: string;
    constructor(url: string);
}
/** 2xx 以外の応答。自動再試行の対象にしない */
export declare class HttpError extends Error {
    readonly status: number;
    constructor(url: string, status: number);
}
/** 429 の再試行枠を使い切った */
export declare class RateLimitExhaustedError extends Error {
    constructor(url: string);
}
/** 応答を観測できない失敗の再試行枠を使い切った */
export declare class TransportExhaustedError extends Error {
    constructor(url: string);
}
/** Retry-After を待機ミリ秒へ変換する。秒数形式と IMF-fixdate を受け、それ以外は undefined */
export declare function parseRetryAfterMs(value: string | null, nowMs: number): number | undefined;
type SessionDeps = {
    sleep: (ms: number) => Promise<void>;
    now: () => number;
};
/**
 * FANBOX API 呼び出しのレート制御セッション。
 * 全エンドポイントをここに通し、待機だけでなく発行から応答処理までを直列化する。
 * ゲートだけ排他化すると、待機を終えた複数の呼び出しが同時に発行されうる。
 *
 * 収集ごとに作る。前回の収集で引き上がった間隔を次へ持ち越さないため。
 */
export declare class ApiSession {
    private readonly baseInterval;
    private readonly transport;
    private readonly deps;
    private chain;
    private lastRequestAt;
    private interval;
    private successStreak;
    private lastRateLimitAt;
    private readonly cap;
    constructor(baseInterval: number, transport: Transport, deps?: SessionDeps);
    /** 現在の発行間隔。適応スロットルの検証用に公開する */
    get intervalMs(): number;
    /**
     * 取得して JSON として読み、validate に通す。
     * 検証まで通ったものだけを成功として数える。エンドポイント固有の形状検証をセッションの外に
     * 置くと、握りつぶされた不正応答が連続成功数に残り、減衰の条件が「有効な成功が継続」で
     * なくなる。
     */
    fetchJson<T, R>(url: string, validate: (parsed: T) => R, signal?: AbortSignal): Promise<R>;
    /**
     * 直列化する。順序を保つため chain は必ず先行タスクの完了に繋ぐが、呼び出し側へ返すのは
     * abort と競争するほうにする。キュー待ちのまま中断できないと、先行タスクが止まったときに
     * 中断が永久に伝わらない。
     */
    private serialize;
    private request;
    /** 前回の発行から発行間隔ぶん空ける。発行時刻の記録は実際に発行できたときに行う */
    private gate;
    /** 引き上げは exact 429 の観測だけを根拠にする */
    private onRateLimited;
    /** 成功以外はすべて連続成功を切る。減衰の条件は「継続」であり、間に失敗を挟めば継続ではない */
    private onFailure;
    private onSuccess;
}
export {};
