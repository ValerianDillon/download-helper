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
type IssuedAt = { issuedAt?: number };

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
export type TransportFailure = IssuedAt & { kind: 'unobservable-failure'; cause?: unknown };

/**
 * 外部の制約により transport が I/O を発行しなかったことを表す。until までは発行できない。
 *
 * adapter の内側で待って再要求すると、セッションが実際の発行時刻を見失う。
 * 発行時刻はゲート直前に記録されるため、adapter が until まで待ってから実発行すると、
 * 次の要求はその古い記録を見て即座に発行してしまい、基準間隔と適応間隔が抜ける。
 * したがって「発行しなかった」ことをセッションへ返し、待機と再発行はセッションが行う。
 */
export type TransportDeferred = { kind: 'deferred'; until: number };

export type TransportResult = TransportResponse | TransportFailure | TransportDeferred;

/**
 * 発行時刻を決める。実際の発行は区間 [transport 呼び出し直前, 応答が返った時刻] の中で起きるので、
 * 報告値がその区間に収まっていればそれを採り、外れていれば区間の上端に倒す。
 *
 * 上端に倒すのは、区間内のどこで発行されたか分からない以上、真の発行時刻以降であることが
 * 確実な値がそれしかないため。下端 (呼び出し直前) に倒すと、配送が遅れていた場合に
 * 実発行より前の時刻を発行時刻として記録することになり、次のゲートが早く明けてしまう。
 *
 * 報告そのものが無い場合だけは下端を使う。同一プロセスで発行する transport は
 * 呼び出し直前と実発行がほぼ同時で、ずれを補正する余地がそもそもない (従来の挙動)。
 */
function resolveIssuedAt(calledAt: number, returnedAt: number, reported: number | undefined): number {
  if (reported === undefined) return calledAt;
  // 時計が巻き戻ると returnedAt < calledAt になりうるので、上端も下回らないようにする
  const upperBound = Math.max(calledAt, returnedAt);
  // NaN はどちらの比較も false になるのでここで上端に落ちる
  return reported >= calledAt && reported <= returnedAt ? reported : upperBound;
}

export type Transport = (url: string, signal?: AbortSignal) => Promise<TransportResult>;

/**
 * 応答は得られたが JSON として読めなかった。
 * 通信の問題ではないので再試行しない。利用側が仕様変更として扱えるよう型を分ける。
 */
export class ResponseParseError extends Error {
  readonly url: string;
  constructor(url: string) {
    super(`レスポンスを JSON として読めませんでした: ${url}`);
    this.name = 'ResponseParseError';
    this.url = url;
  }
}

/** 2xx 以外の応答。自動再試行の対象にしない */
export class HttpError extends Error {
  readonly status: number;
  constructor(url: string, status: number) {
    super(`HTTP ${status}: ${url}`);
    this.name = 'HttpError';
    this.status = status;
  }
}

/** 429 の再試行枠を使い切った */
export class RateLimitExhaustedError extends Error {
  constructor(url: string) {
    super(`レート制限の再試行上限に達しました: ${url}`);
    this.name = 'RateLimitExhaustedError';
  }
}

/** 応答を観測できない失敗の再試行枠を使い切った */
export class TransportExhaustedError extends Error {
  constructor(url: string) {
    super(`通信の再試行上限に達しました: ${url}`);
    this.name = 'TransportExhaustedError';
  }
}

/** exact 429 に対する待機。Retry-After が読めればそちらを優先する */
const RATE_LIMIT_BACKOFF_MS = [5_000, 15_000, 45_000];
/**
 * 観測できない失敗に対する待機。429 より短いのは、ここにオフラインや一時的な通信障害が
 * 多く含まれ、長く待つ根拠となる観測情報が無いため。1 回で見切らないのは、数百投稿を
 * 数分かけて収集する用途では一瞬の通信断に当たる確率が無視できないため。
 */
const TRANSPORT_BACKOFF_MS = [5_000, 15_000];
/**
 * 1 つの論理要求で許す deferred の回数。
 * 再試行枠とは別に数える (I/O を発行していないので再試行ではない)。
 * 期限が延び続ける状況で無限に待たないための安全弁。
 */
const MAX_DEFERRALS = 10;
const THROTTLE_FACTOR = 1.5;
const THROTTLE_DECAY_DIVISOR = 1.25;
const THROTTLE_CAP_FLOOR_MS = 3_000;
const DECAY_SUCCESS_STREAK = 20;
const DECAY_QUIET_MS = 60_000;

/** RFC 9110 の IMF-fixdate。例: Sun, 06 Nov 1994 08:49:37 GMT */
const IMF_FIXDATE =
  /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/** Retry-After を待機ミリ秒へ変換する。秒数形式と IMF-fixdate を受け、それ以外は undefined */
export function parseRetryAfterMs(value: string | null, nowMs: number): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  // delay-seconds は 1*DIGIT。Number() に任せると 1e-3 や 0x10 まで受理し、
  // 本来なら固定バックオフへ落ちるべき値がごく短い待機になってしまう
  if (/^\d+$/.test(trimmed)) {
    const ms = Number(trimmed) * 1000;
    return Number.isFinite(ms) ? ms : undefined;
  }
  // RFC 9110 が送信側に要求する IMF-fixdate だけを受ける。Date.parse に緩く渡すと
  // '1 Jan 2027' のような HTTP-date ではない値まで待機時間になってしまう。
  // obsolete 形式は固定バックオフへ落とす (待機時間の推定を誤るより安全側)
  if (!IMF_FIXDATE.test(trimmed)) return undefined;
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  // 字面の検証だけでは '31 Sep' のような存在しない日付や、曜日の食い違い、24:00:00 を弾けない。
  // Date.parse はそれらを正規化してしまうので、正規化結果が元の表記と一致するか確かめる
  if (new Date(at).toUTCString() !== trimmed) return undefined;
  return Math.max(0, at - nowMs);
}

/**
 * abort 可能な待機。sleep 自体は signal を受け取らないので、abort との競争にする。
 * 45 秒のバックオフや長い Retry-After の途中で中断できないと「即時伝播」の契約を満たせない。
 */
function waitAbortable(sleep: (ms: number) => Promise<void>, ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return sleep(ms);
  throwIfAborted(signal);
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    sleep(ms).then(
      () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

/**
 * abort されたら即座に reject する。元の Promise は破棄せず、未処理の rejection に
 * ならないよう握っておく (順序を保つため chain 側では引き続き使われる)。
 */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  promise.catch(() => undefined);
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

function abortError(signal: AbortSignal): unknown {
  if (signal.reason !== undefined) return signal.reason;
  const error = new Error('取得を中断しました');
  error.name = 'AbortError';
  return error;
}

/** abort されていれば理由をそのまま投げる。再試行枠は消費しない */
function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw abortError(signal);
}

type SessionDeps = { sleep: (ms: number) => Promise<void>; now: () => number };

/**
 * FANBOX API 呼び出しのレート制御セッション。
 * 全エンドポイントをここに通し、待機だけでなく発行から応答処理までを直列化する。
 * ゲートだけ排他化すると、待機を終えた複数の呼び出しが同時に発行されうる。
 *
 * 収集ごとに作る。前回の収集で引き上がった間隔を次へ持ち越さないため。
 */
export class ApiSession {
  private chain: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;
  private interval: number;
  private successStreak = 0;
  private lastRateLimitAt = 0;
  private readonly cap: number;

  constructor(
    private readonly baseInterval: number,
    // 実行環境ごとに違うので既定値は持たない。ページ origin の同期 XHR、拡張の
    // service worker プロキシなど、利用側が自分の adapter を渡す
    private readonly transport: Transport,
    private readonly deps: SessionDeps = {
      sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
    },
  ) {
    this.interval = baseInterval;
    this.cap = Math.max(baseInterval, THROTTLE_CAP_FLOOR_MS);
  }

  /** 現在の発行間隔。適応スロットルの検証用に公開する */
  get intervalMs(): number {
    return this.interval;
  }

  /**
   * 取得して JSON として読み、validate に通す。
   * 検証まで通ったものだけを成功として数える。エンドポイント固有の形状検証をセッションの外に
   * 置くと、握りつぶされた不正応答が連続成功数に残り、減衰の条件が「有効な成功が継続」で
   * なくなる。
   */
  async fetchJson<T, R>(url: string, validate: (parsed: T) => R, signal?: AbortSignal): Promise<R> {
    return this.serialize(async () => {
      const body = await this.request(url, signal);
      let parsed: T;
      try {
        parsed = JSON.parse(body) as T;
      } catch {
        // 形状の問題は通信の問題ではないので再試行しない
        this.onFailure();
        throw new ResponseParseError(url);
      }
      let validated: R;
      try {
        validated = validate(parsed);
      } catch (e) {
        this.onFailure();
        throw e;
      }
      this.onSuccess();
      return validated;
    }, signal);
  }

  /**
   * 直列化する。順序を保つため chain は必ず先行タスクの完了に繋ぐが、呼び出し側へ返すのは
   * abort と競争するほうにする。キュー待ちのまま中断できないと、先行タスクが止まったときに
   * 中断が永久に伝わらない。
   */
  private serialize<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const run = this.chain.then(() => {
      // 順番が回ってきた時点で中断済みなら実行しない
      throwIfAborted(signal);
      return task();
    });
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return signal ? raceAbort(run, signal) : run;
  }

  private async request(url: string, signal?: AbortSignal): Promise<string> {
    let rateLimitAttempt = 0;
    let transportAttempt = 0;
    let deferrals = 0;
    for (;;) {
      // abort は再試行枠を消費せず即座に伝播する。中断後に追加の要求を出さないため、
      // 待機の前後と発行の直前で見る
      throwIfAborted(signal);
      await this.gate(signal);
      throwIfAborted(signal);
      const calledAt = this.deps.now();
      const result = await this.transport(url, signal);
      const returnedAt = this.deps.now();
      // 発行中に中断された場合、応答が返っていても成功として数えない
      throwIfAborted(signal);
      if (result.kind === 'deferred') {
        // I/O を発行していないので、発行時刻を進めない。再試行枠も成功数も適応間隔も動かさない
        if (deferrals >= MAX_DEFERRALS) throw new RateLimitExhaustedError(url);
        deferrals++;
        await waitAbortable(this.deps.sleep, Math.max(0, result.until - this.deps.now()), signal);
        continue;
      }
      // ここまで来たら実際に発行されている
      this.lastRequestAt = resolveIssuedAt(calledAt, returnedAt, result.issuedAt);
      if (result.kind === 'unobservable-failure') {
        // 観測できない失敗では間隔を上げない。通信障害をレート制限として学習しないため
        this.onFailure();
        if (transportAttempt >= TRANSPORT_BACKOFF_MS.length) throw new TransportExhaustedError(url);
        await waitAbortable(this.deps.sleep, TRANSPORT_BACKOFF_MS[transportAttempt], signal);
        transportAttempt++;
        continue;
      }
      if (result.status === 429) {
        this.onRateLimited();
        if (rateLimitAttempt >= RATE_LIMIT_BACKOFF_MS.length) throw new RateLimitExhaustedError(url);
        const wait = parseRetryAfterMs(result.retryAfter, this.deps.now()) ?? RATE_LIMIT_BACKOFF_MS[rateLimitAttempt];
        await waitAbortable(this.deps.sleep, wait, signal);
        rateLimitAttempt++;
        continue;
      }
      if (result.status < 200 || result.status >= 300) {
        this.onFailure();
        throw new HttpError(url, result.status);
      }
      // 成功として数えるのは本文を読めたときだけなので、ここでは数えない
      return result.body;
    }
  }

  /** 前回の発行から発行間隔ぶん空ける。発行時刻の記録は実際に発行できたときに行う */
  private async gate(signal?: AbortSignal): Promise<void> {
    if (this.lastRequestAt === 0) return;
    const wait = this.interval - (this.deps.now() - this.lastRequestAt);
    if (wait > 0) await waitAbortable(this.deps.sleep, wait, signal);
  }

  /** 引き上げは exact 429 の観測だけを根拠にする */
  private onRateLimited(): void {
    this.interval = Math.min(this.cap, Math.floor(this.interval * THROTTLE_FACTOR));
    this.successStreak = 0;
    this.lastRateLimitAt = this.deps.now();
  }

  /** 成功以外はすべて連続成功を切る。減衰の条件は「継続」であり、間に失敗を挟めば継続ではない */
  private onFailure(): void {
    this.successStreak = 0;
  }

  private onSuccess(): void {
    this.successStreak++;
    if (this.successStreak < DECAY_SUCCESS_STREAK) return;
    if (this.lastRateLimitAt !== 0 && this.deps.now() - this.lastRateLimitAt < DECAY_QUIET_MS) return;
    this.interval = Math.max(this.baseInterval, Math.floor(this.interval / THROTTLE_DECAY_DIVISOR));
    this.successStreak = 0;
  }
}
