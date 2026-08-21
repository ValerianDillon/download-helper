function resolveIssuedAt(calledAt, returnedAt, reported) {
  if (reported === undefined) return calledAt;
  const upperBound = Math.max(calledAt, returnedAt);
  return reported >= calledAt && reported <= returnedAt ? reported : upperBound;
}

export class ResponseParseError extends Error {
  url;
  constructor(url) {
    super(`レスポンスを JSON として読めませんでした: ${url}`);
    this.name = 'ResponseParseError';
    this.url = url;
  }
}

export class HttpError extends Error {
  status;
  constructor(url, status) {
    super(`HTTP ${status}: ${url}`);
    this.name = 'HttpError';
    this.status = status;
  }
}

export class RateLimitExhaustedError extends Error {
  constructor(url) {
    super(`レート制限の再試行上限に達しました: ${url}`);
    this.name = 'RateLimitExhaustedError';
  }
}

export class TransportExhaustedError extends Error {
  constructor(url) {
    super(`通信の再試行上限に達しました: ${url}`);
    this.name = 'TransportExhaustedError';
  }
}
const RATE_LIMIT_BACKOFF_MS = [5000, 15000, 45000];
const TRANSPORT_BACKOFF_MS = [5000, 15000];
const MAX_DEFERRALS = 10;
const THROTTLE_FACTOR = 1.5;
const THROTTLE_DECAY_DIVISOR = 1.25;
const THROTTLE_CAP_FLOOR_MS = 3000;
const DECAY_SUCCESS_STREAK = 20;
const DECAY_QUIET_MS = 60000;
const IMF_FIXDATE =
  /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;
export function parseRetryAfterMs(value, nowMs) {
  if (!value) return;
  const trimmed = value.trim();
  if (trimmed === '') return;
  if (/^\d+$/.test(trimmed)) {
    const ms = Number(trimmed) * 1000;
    return Number.isFinite(ms) ? ms : undefined;
  }
  if (!IMF_FIXDATE.test(trimmed)) return;
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return;
  if (new Date(at).toUTCString() !== trimmed) return;
  return Math.max(0, at - nowMs);
}
function waitAbortable(sleep, ms, signal) {
  if (!signal) return sleep(ms);
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
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
function raceAbort(promise, signal) {
  promise.catch(() => {
    return;
  });
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
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
function abortError(signal) {
  if (signal.reason !== undefined) return signal.reason;
  const error = new Error('取得を中断しました');
  error.name = 'AbortError';
  return error;
}
function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw abortError(signal);
}

export class ApiSession {
  baseInterval;
  transport;
  deps;
  chain = Promise.resolve();
  lastRequestAt = 0;
  interval;
  successStreak = 0;
  lastRateLimitAt = 0;
  cap;
  constructor(
    baseInterval,
    transport,
    deps = {
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
    },
  ) {
    this.baseInterval = baseInterval;
    this.transport = transport;
    this.deps = deps;
    this.interval = baseInterval;
    this.cap = Math.max(baseInterval, THROTTLE_CAP_FLOOR_MS);
  }
  get intervalMs() {
    return this.interval;
  }
  async fetchJson(url, validate, signal) {
    return this.serialize(async () => {
      const body = await this.request(url, signal);
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        this.onFailure();
        throw new ResponseParseError(url);
      }
      let validated;
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
  serialize(task, signal) {
    const run = this.chain.then(() => {
      throwIfAborted(signal);
      return task();
    });
    this.chain = run.then(
      () => {
        return;
      },
      () => {
        return;
      },
    );
    return signal ? raceAbort(run, signal) : run;
  }
  async request(url, signal) {
    let rateLimitAttempt = 0;
    let transportAttempt = 0;
    let deferrals = 0;
    for (;;) {
      throwIfAborted(signal);
      await this.gate(signal);
      throwIfAborted(signal);
      const calledAt = this.deps.now();
      const result = await this.transport(url, signal);
      const returnedAt = this.deps.now();
      throwIfAborted(signal);
      if (result.kind === 'deferred') {
        if (deferrals >= MAX_DEFERRALS) throw new RateLimitExhaustedError(url);
        deferrals++;
        await waitAbortable(this.deps.sleep, Math.max(0, result.until - this.deps.now()), signal);
        continue;
      }
      this.lastRequestAt = resolveIssuedAt(calledAt, returnedAt, result.issuedAt);
      if (result.kind === 'unobservable-failure') {
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
      return result.body;
    }
  }
  async gate(signal) {
    if (this.lastRequestAt === 0) return;
    const wait = this.interval - (this.deps.now() - this.lastRequestAt);
    if (wait > 0) await waitAbortable(this.deps.sleep, wait, signal);
  }
  onRateLimited() {
    this.interval = Math.min(this.cap, Math.floor(this.interval * THROTTLE_FACTOR));
    this.successStreak = 0;
    this.lastRateLimitAt = this.deps.now();
  }
  onFailure() {
    this.successStreak = 0;
  }
  onSuccess() {
    this.successStreak++;
    if (this.successStreak < DECAY_SUCCESS_STREAK) return;
    if (this.lastRateLimitAt !== 0 && this.deps.now() - this.lastRateLimitAt < DECAY_QUIET_MS) return;
    this.interval = Math.max(this.baseInterval, Math.floor(this.interval / THROTTLE_DECAY_DIVISOR));
    this.successStreak = 0;
  }
}
