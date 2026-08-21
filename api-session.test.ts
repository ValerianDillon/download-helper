import { describe, expect, test } from 'bun:test';
import {
  ApiSession,
  HttpError,
  parseRetryAfterMs,
  RateLimitExhaustedError,
  ResponseParseError,
  TransportExhaustedError,
  type TransportFailure,
  type TransportResponse,
  type TransportResult,
} from './api-session';

describe('parseRetryAfterMs', () => {
  const NOW = Date.parse('2026-08-21T00:00:00Z');

  test.each([
    ['秒数', '30', 30_000],
    ['秒数の 0', '0', 0],
    ['前後の空白を無視する', '  7  ', 7_000],
  ])('%s を待機ミリ秒に変換する', (_name, value, expected) => {
    expect(parseRetryAfterMs(value as string, NOW)).toBe(expected as number);
  });

  test('HTTP-date は現在時刻との差になる', () => {
    expect(parseRetryAfterMs('Fri, 21 Aug 2026 00:00:20 GMT', NOW)).toBe(20_000);
  });

  test('過去の HTTP-date は 0 に切り上げる', () => {
    expect(parseRetryAfterMs('Thu, 20 Aug 2026 00:00:00 GMT', NOW)).toBe(0);
  });

  test.each([
    ['null', null],
    ['空文字', ''],
    ['空白のみ', '   '],
    ['解釈できない文字列', 'soon'],
    ['負の秒数', '-5'],
    ['HTTP-date ではない日付表記', '1 Jan 2027'],
    ['英語の日付表記', 'August 21, 2026'],
    ['指数表記', '1e-3'],
    ['16 進表記', '0x10'],
    ['存在しない日付', 'Thu, 31 Sep 2026 00:00:00 GMT'],
    ['曜日が食い違う日付', 'Mon, 21 Aug 2026 00:00:00 GMT'],
    ['24 時表記', 'Fri, 21 Aug 2026 24:00:00 GMT'],
  ])('%s は undefined になる (固定バックオフへ落とす)', (_name, value) => {
    expect(parseRetryAfterMs(value as string | null, NOW)).toBeUndefined();
  });
});

describe('ApiSession - transport 契約と再試行ポリシー', () => {
  const URL = 'https://api.fanbox.cc/post.info?postId=1';

  /** 決定的に検証するため sleep と now を注入する。sleep は待機時間を記録するだけ */
  const createHarness = (results: TransportResult[], baseInterval = 500) => {
    const waits: number[] = [];
    const requested: string[] = [];
    let clock = 1_000_000;
    const queue = [...results];
    const transport = async (url: string): Promise<TransportResult> => {
      requested.push(url);
      const next = queue.shift();
      if (!next) throw new Error('transport の応答が足りない');
      return next;
    };
    const session = new ApiSession(baseInterval, transport, {
      sleep: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
      now: () => clock,
    });
    return {
      session,
      waits,
      requested,
      advance: (ms: number) => {
        clock += ms;
      },
    };
  };

  const ok = (body: string): TransportResult => ({ kind: 'response', status: 200, body, retryAfter: null });
  const tooMany = (retryAfter: string | null = null): TransportResult => ({
    kind: 'response',
    status: 429,
    body: '',
    retryAfter,
  });
  const failure = (): TransportResult => ({ kind: 'unobservable-failure' });

  test('200 なら JSON を返し、待機は発行間隔のみ', async () => {
    const h = createHarness([ok('{"a":1}')]);
    expect(await h.session.fetchJson<{ a: number }, { a: number }>(URL, (j) => j)).toEqual({ a: 1 });
    expect(h.requested).toHaveLength(1);
    expect(h.waits).toEqual([]);
  });

  test('429 は 5 / 15 / 45 秒で 3 回再試行し、枯渇したら RateLimitExhaustedError', async () => {
    const h = createHarness([tooMany(), tooMany(), tooMany(), tooMany()]);
    await expect(h.session.fetchJson<unknown, unknown>(URL, (j) => j)).rejects.toBeInstanceOf(RateLimitExhaustedError);
    expect(h.requested).toHaveLength(4);
    expect(h.waits.filter((w) => w >= 5_000)).toEqual([5_000, 15_000, 45_000]);
  });

  test('読める Retry-After は固定バックオフより優先する', async () => {
    const h = createHarness([tooMany('30'), ok('{}')]);
    await h.session.fetchJson<unknown, unknown>(URL, (j) => j);
    expect(h.waits).toContain(30_000);
    expect(h.waits).not.toContain(5_000);
  });

  test('Retry-After が不正なら固定バックオフへ落とす', async () => {
    const h = createHarness([tooMany('soon'), ok('{}')]);
    await h.session.fetchJson<unknown, unknown>(URL, (j) => j);
    expect(h.waits).toContain(5_000);
  });

  test('観測できない失敗は 5 / 15 秒の 2 回だけ再試行し、枯渇したら TransportExhaustedError', async () => {
    const h = createHarness([failure(), failure(), failure()]);
    await expect(h.session.fetchJson<unknown, unknown>(URL, (j) => j)).rejects.toBeInstanceOf(TransportExhaustedError);
    // 429 と違い 45 秒は待たない
    expect(h.requested).toHaveLength(3);
    expect(h.waits.filter((w) => w >= 5_000)).toEqual([5_000, 15_000]);
  });

  test('観測できない失敗から復帰できる', async () => {
    const h = createHarness([failure(), ok('{"ok":true}')]);
    expect(await h.session.fetchJson<{ ok: boolean }, { ok: boolean }>(URL, (j) => j)).toEqual({ ok: true });
    expect(h.requested).toHaveLength(2);
  });

  test('2xx 以外は再試行せず HttpError になる', async () => {
    const h = createHarness([{ kind: 'response', status: 404, body: '', retryAfter: null }]);
    await expect(h.session.fetchJson<unknown, unknown>(URL, (j) => j)).rejects.toBeInstanceOf(HttpError);
    expect(h.requested).toHaveLength(1);
  });

  test('JSON として読めない本文は形状の問題として扱い、再試行しない', async () => {
    const h = createHarness([ok('<html>')]);
    await expect(h.session.fetchJson<unknown, unknown>(URL, (j) => j)).rejects.toBeInstanceOf(ResponseParseError);
    expect(h.requested).toHaveLength(1);
  });

  test('exact 429 でだけ発行間隔が上がる', async () => {
    const h = createHarness([tooMany(), ok('{}')]);
    expect(h.session.intervalMs).toBe(500);
    await h.session.fetchJson<unknown, unknown>(URL, (j) => j);
    expect(h.session.intervalMs).toBe(750);
  });

  test('観測できない失敗では発行間隔を上げない (通信障害をレート制限として学習しない)', async () => {
    const h = createHarness([failure(), failure(), ok('{}')]);
    await h.session.fetchJson<unknown, unknown>(URL, (j) => j);
    expect(h.session.intervalMs).toBe(500);
  });

  test('発行間隔の引き上げには上限がある', async () => {
    const h = createHarness([tooMany(), tooMany(), tooMany(), ok('{}')], 2_000);
    await h.session.fetchJson<unknown, unknown>(URL, (j) => j);
    // cap は max(baseInterval, 3000)
    expect(h.session.intervalMs).toBe(3_000);
  });

  test('同時に呼んでも直列化される', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const transport = async (): Promise<TransportResult> => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      return { kind: 'response', status: 200, body: '{}', retryAfter: null };
    };
    const session = new ApiSession(0, transport, { sleep: async () => {}, now: () => 0 });
    await Promise.all([
      session.fetchJson<unknown, unknown>(URL, (j) => j),
      session.fetchJson<unknown, unknown>(URL, (j) => j),
      session.fetchJson<unknown, unknown>(URL, (j) => j),
    ]);
    expect(maxInFlight).toBe(1);
  });

  test('直列化は失敗した呼び出しの後も続く', async () => {
    const h = createHarness([{ kind: 'response', status: 404, body: '', retryAfter: null }, ok('{"n":2}')]);
    await expect(h.session.fetchJson<unknown, unknown>(URL, (j) => j)).rejects.toBeInstanceOf(HttpError);
    expect(await h.session.fetchJson<{ n: number }, { n: number }>(URL, (j) => j)).toEqual({ n: 2 });
  });

  test('連続する成功要求の間に発行間隔ぶんの待機が入る', async () => {
    const h = createHarness([ok('{}'), ok('{}')], 500);
    await h.session.fetchJson<unknown, unknown>(URL, (j) => j);
    await h.session.fetchJson<unknown, unknown>(URL, (j) => j);
    // gate() の待機を外すとこの期待が落ちる
    expect(h.waits).toEqual([500]);
  });

  test('失敗を挟むと連続成功が切れ、減衰しない', async () => {
    // 429 で 750ms に上がったあと、成功 19 回 → HTTP 500 → 成功 1 回。
    // 「20 回継続」ではないので減衰させない
    const results: TransportResult[] = [tooMany(), ...Array(19).fill(ok('{}'))];
    results.push({ kind: 'response', status: 500, body: '', retryAfter: null });
    results.push(ok('{}'));
    const h = createHarness(results, 500);
    // 1 回目の呼び出しが 429 と再試行の成功で 2 件消費するので、成功 19 回ぶんは 19 呼び出し
    for (let i = 0; i < 19; i++) await h.session.fetchJson<unknown, unknown>(URL, (j) => j);
    expect(h.session.intervalMs).toBe(750);
    await expect(h.session.fetchJson<unknown, unknown>(URL, (j) => j)).rejects.toBeInstanceOf(HttpError);
    h.advance(120_000);
    await h.session.fetchJson<unknown, unknown>(URL, (j) => j);
    expect(h.session.intervalMs).toBe(750);
  });

  test('レート制限なしで成功が継続し静穏期間が過ぎたら減衰する', async () => {
    const h = createHarness([tooMany(), ...Array(20).fill(ok('{}'))], 500);
    // 1 回目の呼び出しで 429 → 再試行成功。以降 19 回成功して合計 20 回
    for (let i = 0; i < 20; i++) {
      h.advance(120_000);
      await h.session.fetchJson<unknown, unknown>(URL, (j) => j);
    }
    expect(h.session.intervalMs).toBe(600);
  });

  test('読めない本文は成功として数えない', async () => {
    const h = createHarness([tooMany(), ...Array(19).fill(ok('{}')), ok('<html>'), ok('{}')], 500);
    for (let i = 0; i < 19; i++) await h.session.fetchJson<unknown, unknown>(URL, (j) => j);
    await expect(h.session.fetchJson<unknown, unknown>(URL, (j) => j)).rejects.toBeInstanceOf(ResponseParseError);
    h.advance(120_000);
    await h.session.fetchJson<unknown, unknown>(URL, (j) => j);
    expect(h.session.intervalMs).toBe(750);
  });

  test('待機の途中で中断できる', async () => {
    // 待機に入ったことを確認してから中断する。同期的に abort すると直列化タスクが
    // 始まる前に止まり、waitAbortable を外しても通ってしまう
    let enteredSleep!: () => void;
    const inSleep = new Promise<void>((resolve) => {
      enteredSleep = resolve;
    });
    let sleepCalls = 0;
    const controller = new AbortController();
    const session = new ApiSession(0, async (): Promise<TransportResult> => ({ kind: 'unobservable-failure' }), {
      sleep: () => {
        sleepCalls++;
        enteredSleep();
        // 解決しない。abort でのみ抜けられることを確かめる
        return new Promise<void>(() => {});
      },
      now: () => 0,
    });
    const pending = session.fetchJson<unknown, unknown>(URL, (j) => j, controller.signal);
    await inSleep;
    controller.abort();
    await expect(pending).rejects.toBeDefined();
    expect(sleepCalls).toBe(1);
  });

  test('発行中に中断したら、応答が返っても成功として扱わない', async () => {
    let enteredTransport!: () => void;
    const inTransport = new Promise<void>((resolve) => {
      enteredTransport = resolve;
    });
    let release!: (result: TransportResult) => void;
    let calls = 0;
    const controller = new AbortController();
    const session = new ApiSession(
      0,
      () => {
        calls++;
        enteredTransport();
        return new Promise<TransportResult>((resolve) => {
          release = resolve;
        });
      },
      { sleep: async () => {}, now: () => 0 },
    );
    let validated = 0;
    const pending = session.fetchJson<unknown, unknown>(
      URL,
      (j) => {
        validated++;
        return j;
      },
      controller.signal,
    );
    await inTransport;
    controller.abort();
    release({ kind: 'response', status: 200, body: '{}', retryAfter: null });
    await expect(pending).rejects.toBeDefined();
    // 中断後に追加の要求を出さない
    expect(calls).toBe(1);
    // 返却 Promise の reject だけでなく、応答の処理自体が行われないこと。
    // ここを見ないと発行後の中断検査を外しても通ってしまう
    await Promise.resolve();
    expect(validated).toBe(0);
  });

  test('キュー待ちのまま中断できる (先行要求が止まっていても伝わる)', async () => {
    let releaseFirst!: (result: TransportResult) => void;
    let calls = 0;
    const session = new ApiSession(
      0,
      () => {
        calls++;
        // 1 件目は解決しない。2 件目はキューで待つことになる
        return new Promise<TransportResult>((resolve) => {
          releaseFirst = resolve;
        });
      },
      { sleep: async () => {}, now: () => 0 },
    );
    const first = session.fetchJson<unknown, unknown>(URL, (j) => j);
    const controller = new AbortController();
    const queued = session.fetchJson<unknown, unknown>(URL, (j) => j, controller.signal);
    // 1 件目が transport に入るまで待つ
    await Promise.resolve();
    controller.abort();
    await expect(queued).rejects.toBeDefined();
    // 中断しても順序は崩さない: 2 件目は発行されていない
    expect(calls).toBe(1);
    releaseFirst({ kind: 'response', status: 200, body: '{}', retryAfter: null });
    await first;
  });

  test('成功が 20 回続いても静穏期間が満たなければ減衰しない', async () => {
    const h = createHarness([tooMany(), ...Array(20).fill(ok('{}'))], 500);
    for (let i = 0; i < 20; i++) await h.session.fetchJson<unknown, unknown>(URL, (j) => j);
    // 時計は待機ぶんしか進んでおらず、最後のレート制限から 60 秒経っていない
    expect(h.session.intervalMs).toBe(750);
  });

  test('形状検証に失敗した応答は成功として数えない', async () => {
    const h = createHarness([tooMany(), ...Array(19).fill(ok('{}')), ok('{}'), ok('{}')], 500);
    for (let i = 0; i < 19; i++) await h.session.fetchJson<unknown, unknown>(URL, (j) => j);
    await expect(
      h.session.fetchJson<unknown, unknown>(URL, () => {
        throw new Error('形状が想定外');
      }),
    ).rejects.toThrow('形状が想定外');
    h.advance(120_000);
    await h.session.fetchJson<unknown, unknown>(URL, (j) => j);
    expect(h.session.intervalMs).toBe(750);
  });

  test('中断済みの signal では要求を出さない', async () => {
    const h = createHarness([ok('{}')]);
    const controller = new AbortController();
    controller.abort();
    await expect(h.session.fetchJson<unknown, unknown>(URL, (j) => j, controller.signal)).rejects.toBeDefined();
    expect(h.requested).toHaveLength(0);
  });
});

describe('ApiSession - deferred (transport が I/O を発行しなかった場合)', () => {
  const URL = 'https://example.invalid/x';

  const createHarness = (results: TransportResult[], baseInterval = 500) => {
    const waits: number[] = [];
    let clock = 1_000_000;
    const issuedAt: number[] = [];
    const queue = [...results];
    const transport = async (): Promise<TransportResult> => {
      issuedAt.push(clock);
      const next = queue.shift();
      if (!next) throw new Error('transport の応答が足りない');
      return next;
    };
    const session = new ApiSession(baseInterval, transport, {
      sleep: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
      now: () => clock,
    });
    return { session, waits, issuedAt, now: () => clock };
  };

  const ok = (): TransportResult => ({ kind: 'response', status: 200, body: '{}', retryAfter: null });
  const deferred = (until: number): TransportResult => ({ kind: 'deferred', until });

  test('until まで待ってから再要求する', async () => {
    const h = createHarness([deferred(1_000_000 + 8_000), ok()], 500);
    await h.session.fetchJson<unknown, unknown>(URL, (j) => j);
    expect(h.waits).toContain(8_000);
    expect(h.issuedAt).toHaveLength(2);
  });

  test('発行時刻を進めないので、実発行からの間隔が保たれる', async () => {
    // 1 回目: deferred → 待機 → 実発行。2 回目: 実発行からの間隔ぶん待つ
    const h = createHarness([deferred(1_000_000 + 8_000), ok(), ok()], 500);
    await h.session.fetchJson<unknown, unknown>(URL, (j) => j);
    const firstIssue = h.issuedAt[1];
    await h.session.fetchJson<unknown, unknown>(URL, (j) => j);
    const secondIssue = h.issuedAt[2];
    // deferred を返した時刻ではなく、実際に発行した時刻からの間隔になる
    expect(secondIssue - firstIssue).toBe(500);
  });

  test('再試行枠を消費しない', async () => {
    // deferred を挟んでも 429 の 3 回再試行はそのまま使える
    const tooMany = (): TransportResult => ({ kind: 'response', status: 429, body: '', retryAfter: null });
    const h = createHarness([deferred(1_000_000 + 1_000), tooMany(), tooMany(), tooMany(), ok()], 500);
    await h.session.fetchJson<unknown, unknown>(URL, (j) => j);
    expect(h.issuedAt).toHaveLength(5);
  });

  test('発行間隔を変えない (レート制限の観測ではない)', async () => {
    const h = createHarness([deferred(1_000_000 + 1_000), ok()], 500);
    await h.session.fetchJson<unknown, unknown>(URL, (j) => j);
    expect(h.session.intervalMs).toBe(500);
  });

  test('繰り返し deferred が続いたら打ち切る', async () => {
    const h = createHarness(
      Array.from({ length: 20 }, (_, i) => deferred(1_000_000 + (i + 1) * 100)),
      500,
    );
    await expect(h.session.fetchJson<unknown, unknown>(URL, (j) => j)).rejects.toBeInstanceOf(RateLimitExhaustedError);
    // 初回 + MAX_DEFERRALS 回
    expect(h.issuedAt).toHaveLength(11);
  });

  test('過去の until なら待たずに再要求する', async () => {
    const h = createHarness([deferred(0), ok()], 500);
    await h.session.fetchJson<unknown, unknown>(URL, (j) => j);
    expect(h.waits.filter((w) => w > 0)).toHaveLength(0);
  });
});

describe('ApiSession - 実発行時刻の報告 (プロセスをまたぐ transport)', () => {
  const URL = 'https://example.invalid/x';
  const START = 1_000_000;

  type Step = {
    result: TransportResponse | TransportFailure;
    /** transport が呼ばれてから実 I/O が始まるまで (配送遅延) */
    deliveryMs?: number;
    /** 実 I/O の開始から応答が返るまで */
    roundTripMs?: number;
    /** 報告する実発行時刻を実際の値からどれだけずらすか。null なら報告しない */
    reportOffsetMs?: number | null;
  };

  /**
   * 実 I/O が別プロセスで起きる transport を模す。
   * transport が呼ばれた時刻ではなく、実 I/O を発行した時刻を issues に記録するので、
   * 保ちたい不変条件 (実発行の間隔が発行間隔以上) をそのまま検査できる。
   */
  const createHarness = (steps: Step[], baseInterval = 500) => {
    let clock = START;
    const waits: number[] = [];
    /** 実 I/O を発行した時刻 */
    const issues: number[] = [];
    const queue = [...steps];
    const transport = async (): Promise<TransportResult> => {
      const step = queue.shift();
      if (!step) throw new Error('transport の応答が足りない');
      clock += step.deliveryMs ?? 0;
      const issuedAt = clock;
      issues.push(issuedAt);
      clock += step.roundTripMs ?? 0;
      if (step.reportOffsetMs === null) return step.result;
      return { ...step.result, issuedAt: issuedAt + (step.reportOffsetMs ?? 0) };
    };
    const session = new ApiSession(baseInterval, transport, {
      sleep: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
      now: () => clock,
    });
    return { session, waits, issues };
  };

  const ok = (): TransportResponse => ({ kind: 'response', status: 200, body: '{}', retryAfter: null });
  const failure = (): TransportFailure => ({ kind: 'unobservable-failure' });

  test('配送が遅れても、実発行の間隔は発行間隔を下回らない', async () => {
    // 1 件目だけ配送が 800ms 遅れる。報告が無いと 2 件目の実発行は 50ms 後になる
    const h = createHarness([{ result: ok(), deliveryMs: 800, roundTripMs: 50 }, { result: ok() }], 500);
    await h.session.fetchJson<unknown, unknown>(URL, (j) => j);
    await h.session.fetchJson<unknown, unknown>(URL, (j) => j);
    expect(h.issues[1] - h.issues[0]).toBe(500);
  });

  test('報告が無ければ呼び出し直前の時刻を発行時刻にする (同一プロセスの transport)', async () => {
    const h = createHarness(
      [
        { result: ok(), deliveryMs: 800, roundTripMs: 50, reportOffsetMs: null },
        { result: ok(), reportOffsetMs: null },
      ],
      500,
    );
    await h.session.fetchJson<unknown, unknown>(URL, (j) => j);
    await h.session.fetchJson<unknown, unknown>(URL, (j) => j);
    // 呼び出し直前 (START) から 500ms 後にはもう到達しているので待たない
    expect(h.issues[1] - h.issues[0]).toBe(50);
  });

  test('呼び出し直前より早い報告は応答が返った時刻へ倒す', async () => {
    // 配送が遅れているときに呼び出し直前へ倒すと、実発行より前の時刻を記録してしまい
    // 2 件目のゲートが早く明ける (実発行の間隔が 50ms になる)
    const h = createHarness(
      [{ result: ok(), deliveryMs: 800, roundTripMs: 50, reportOffsetMs: -5_000 }, { result: ok() }],
      500,
    );
    await h.session.fetchJson<unknown, unknown>(URL, (j) => j);
    await h.session.fetchJson<unknown, unknown>(URL, (j) => j);
    // 実発行 (+800) の 50ms 後に応答が返り、そこから 500ms 空ける
    expect(h.issues[1] - h.issues[0]).toBe(550);
  });

  test('応答が返った時刻より遅い報告は応答が返った時刻へ丸める', async () => {
    const h = createHarness([{ result: ok(), roundTripMs: 100, reportOffsetMs: 10_000 }, { result: ok() }], 500);
    await h.session.fetchJson<unknown, unknown>(URL, (j) => j);
    await h.session.fetchJson<unknown, unknown>(URL, (j) => j);
    // 丸めないと 10 秒後を発行時刻とみなし、次の発行が不要に遅れる
    expect(h.issues[1] - h.issues[0]).toBe(600);
    expect(h.waits).toEqual([500]);
  });

  test('数でない報告も応答が返った時刻へ倒す', async () => {
    const h = createHarness(
      [
        { result: { ...ok(), issuedAt: Number.NaN }, deliveryMs: 800, roundTripMs: 50, reportOffsetMs: null },
        { result: ok(), reportOffsetMs: null },
      ],
      500,
    );
    await h.session.fetchJson<unknown, unknown>(URL, (j) => j);
    await h.session.fetchJson<unknown, unknown>(URL, (j) => j);
    // NaN をそのまま発行時刻にすると gate の比較が NaN になり、以後すべての待機が消える。
    // 呼び出し直前へ倒すのも配送遅延ぶん早く明けるので、ここでも上端に倒す
    expect(h.issues[1] - h.issues[0]).toBe(550);
  });

  test('観測できない失敗の報告も発行時刻に採る', async () => {
    // 再試行の待機 (5 秒) より発行間隔を長くして、ゲートの効き方の差を見る
    const h = createHarness([{ result: failure(), deliveryMs: 800, roundTripMs: 50 }, { result: ok() }], 20_000);
    await h.session.fetchJson<unknown, unknown>(URL, (j) => j);
    expect(h.issues[1] - h.issues[0]).toBe(20_000);
  });
});
