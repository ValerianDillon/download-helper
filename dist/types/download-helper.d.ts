/**
 * ダウンロード用のObject
 */
export type DownloadObj = {
    posts: Record<string, PostObj[]>;
    id: string;
};
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
export type FileObj = {
    url: string;
    name: string;
    extension: string;
};
/**
 * ダウンロード用JSON元オブジェクト
 */
export type DownloadJsonObj = {
    posts: {
        originalName: string;
        encodedName: string;
        informationText: string;
        htmlText: string;
        files: {
            url: string;
            originalName: string;
            encodedName: string;
        }[];
        tags: string[];
        cover?: {
            url: string;
            name: string;
        };
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
export declare class DownloadUtils {
    /**
     * 音声拡張子
     */
    audioExtension: RegExp;
    /**
     * 画像拡張子
     */
    imageExtension: RegExp;
    /**
     * 映像拡張子
     */
    videoExtension: RegExp;
    /**
     * 音声ファイル判定
     * @param fileName 判定対象ファイル名
     */
    isAudio(fileName: string): boolean;
    /**
     * 画像ファイル判定
     * @param fileName 判定対象ファイル名
     */
    isImage(fileName: string): boolean;
    /**
     * 映像ファイル判定
     * @param fileName 判定対象ファイル名
     */
    isVideo(fileName: string): boolean;
    /**
     * HTTP GET
     * @param url
     */
    httpGetAs<T = unknown>(url: string): T;
    /**
     * 保存するファイル名のエンコード
     * 主にwindowsで使えないファイル名のエスケープ処理をする
     * @param name ファイル名
     */
    encodeFileName(name: string): string;
    /**
     * URIのエンコード
     * @param name ファイル名
     */
    encodeURI(name: string): string;
    /**
     * 拡張子の分割
     * @param name ファイル名
     */
    splitExt(name: string): string[];
    /**
     * 同一名の設定
     * @param name 名
     * @param extension 拡張子(.を含む)
     * @param length インデックスの最大値
     * @param index インデックス
     * @param isAsc 昇順か
     */
    getFileName(name: string, extension: string, length: number, index: number, isAsc: boolean): string;
    /**
     * quote
     * @param value quote対象
     */
    toQuoted(value: string): string;
    /**
     * HTMLエスケープ
     * @param value エスケープ対象
     */
    escapeHtml(value: string): string;
    /**
     * テキストから投稿情報ファイルを作成する
     * @param informationText 元となるテキスト
     * @return name ファイル名, content ファイル内容
     */
    createInformationFile(informationText: string): {
        name: string;
        content: BlobPart[];
    };
    /**
     * timeoutによる疑似スリーブ
     * @param ms ミリ秒
     */
    sleep(ms: number): Promise<unknown>;
    /**
     * リトライ回数付きfetch
     * @param url
     * @param filename
     * @param limit 失敗時のリトライ回数
     */
    fetchWithLimit({ url, name }: {
        url: string;
        name: string;
    }, limit: number): Promise<Blob | null>;
    /**
     * DOMによる外部スクリプト読み込み (importじゃだめなとき用)
     * @param url
     */
    embedScript(url: string, integrity?: string): Promise<unknown>;
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
export declare function createNameKeyedDictionary<T>(): Record<string, T>;
/**
 * ダウンロード用のオブジェクトラッパークラス
 */
export declare class DownloadObject {
    private readonly downloadObj;
    private readonly utils;
    private readonly orderedPosts;
    private url;
    private tags;
    constructor(id: string, utils: DownloadUtils);
    stringify(): string;
    setUrl(url: string): void;
    setTags(tags: string[]): void;
    addPost(name: string): PostObject;
    private countPost;
    private countFile;
    private collectTags;
}
/**
 * 投稿情報オブジェクトラッパークラス
 */
export declare class PostObject {
    private readonly postObj;
    private readonly utils;
    constructor(postObj: PostObj, utils: DownloadUtils);
    setInfo(info: string): void;
    setHtml(html: string): void;
    setTags(tags: string[]): void;
    setPublishedDatetime(iso: string): void;
    setCover(name: string, extension: string, url: string): FileObject;
    addFile(name: string, extension: string, url: string): FileObject;
    getAutoAssignedLinkTag(fileObject: FileObject): string;
    getAudioLinkTag(fileObject: FileObject): string;
    getLinkTag(url: string, title: string): string;
    getFileLinkTag(fileObject: FileObject): string;
    getImageLinkTag(fileObject: FileObject): string;
    getVideoLinkTag(fileObject: FileObject): string;
    private getCurrentFilePath;
    toJsonObjBy(posts: Record<string, PostObj[]>): DownloadJsonObj['posts'][number];
    private collectFiles;
}
/**
 * ファイルオブジェクトラッパークラス
 */
export declare class FileObject {
    private readonly fileObj;
    private readonly utils;
    constructor(fileObj: FileObj, utils: DownloadUtils);
    getEncodedName(): string;
    getEncodedExtension(): string;
    getOriginalName(): string;
    getOriginalExtension(): string;
    getUrl(): string;
    equals(obj: unknown): boolean;
}
/**
 * CRC-32 ルックアップテーブル (IEEE 802.3 polynomial)
 * @internal
 */
export declare const crc32Table: Uint32Array;
/**
 * CRC-32 を計算する
 * @param data 対象データ
 * @internal
 */
export declare function crc32(data: Uint8Array): number;
/**
 * Date を ZIP の DOS time/date 表現可能範囲 (1980-01-01 00:00:00 〜 2107-12-31 23:59:58) にクランプする
 * - DOS time/date はローカル時刻で計算される慣例なので min/max もローカル時刻で構築する
 * - Issue #7 の Acceptance Criteria に従い、NTFS / Extended Timestamp にも clamp 後の同一 Date を使う
 *   (NTFS は 1601-9999、UT は 1901-2038 を扱えるが、3 種で値を整合させるため意図的に DOS 範囲で揃える)
 * @internal
 */
export declare function clampToZipRange(date: Date): Date;
/**
 * Date を DOS time / DOS date (各 16 bit) に変換する
 * - DOS time: (h << 11) | (m << 5) | (s >> 1)
 * - DOS date: ((y - 1980) << 9) | ((mo + 1) << 5) | d
 * 入力はクランプ済みであることを前提とする
 * @internal
 */
export declare function toDosTimeDate(date: Date): {
    time: number;
    dosDate: number;
};
/**
 * NTFS Extra Field (0x000A) を構築する (36 バイト固定)
 * mtime / atime / ctime はすべて同一の date を FILETIME として書き込む
 * @internal
 */
export declare function buildNtfsExtra(date: Date): Uint8Array<ArrayBuffer>;
/**
 * Extended Timestamp Extra Field (0x5455) を LFH 用に構築する (17 バイト)
 * Flags = 0x07 (mtime + atime + ctime)
 * 入力 unix time が signed int32 範囲に収まることを呼び出し側が保証する
 * @internal
 */
export declare function buildExtTimestampLfh(date: Date): Uint8Array<ArrayBuffer>;
/**
 * Extended Timestamp Extra Field (0x5455) を CD 用に構築する (9 バイト, mtime のみ)
 * - CD では mtime のみ格納するが、Flags は LFH と同一の 0x07 にする Info-ZIP 慣例
 *   (proginfo/extrafld.txt: "This bitmap is the same as that in the local-header field.")
 * - Flags は「LFH 側にどの timestamp が存在するか」を示すビットマップであり、CD payload の構成を表すものではない
 * @internal
 */
export declare function buildExtTimestampCd(date: Date): Uint8Array<ArrayBuffer>;
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
export declare const MAX_ZIP_ENTRY_COUNT = 65534;
/**
 * LFH / CD の size フィールドと CD / EOCD の offset フィールド (いずれも uint32) が
 * 取り得る値の上限 (Issue #15)。`0xFFFFFFFF` は APPNOTE 4.4.1.4 が定める ZIP64 の sentinel 値であり、
 * ZipWriter は ZIP64 Extended Information Extra Field を書かないため、この値以上になると
 * sentinel と誤認されるか、uint32 の折り返しでフィールドの値そのものが壊れる。
 * @internal
 */
export declare const MAX_ZIP_UINT32_FIELD_VALUE = 4294967295;
/**
 * ZIP エントリ数が上限に達していないか検証する。addFile / addDirectory の書き込み開始前
 * (ヘッダを書く前) に呼ぶことで、65535 件目 (sentinel 値) 以降のエントリを書き込む前に拒否する
 * (Issue #15)。65534 回 addFile を呼ぶ実行時間のテストを避けるため、カウント検査ロジックを
 * ZipWriter から独立させて直接ユニットテストできるようにしている。
 * @param currentEntryCount 追加しようとしている時点での既存エントリ数 (呼び出し側の entries.length)
 * @throws {Error} currentEntryCount が上限 (MAX_ZIP_ENTRY_COUNT) 以上の場合
 * @internal
 */
export declare function assertZipEntryCountWithinLimit(currentEntryCount: number, method: 'addFile' | 'addDirectory'): void;
/**
 * 単一エントリのデータサイズが上限を超えないか検証する。LFH / CD の compressed / uncompressed size は
 * uint32 で、かつ ZipWriter は圧縮を行わない (常に stored, Issue #15) ため、データの生バイト数が
 * そのままこのフィールドに書かれる。0xFFFFFFFF bytes のバッファ確保は現実的でないため、
 * サイズ比較のロジックのみを独立させて境界値を直接ユニットテストできるようにしている。
 * @param size エントリのデータバイト数
 * @throws {Error} size が上限 (MAX_ZIP_UINT32_FIELD_VALUE) 以上の場合
 * @internal
 */
export declare function assertZipEntrySizeWithinLimit(size: number, name: string, method: 'addFile'): void;
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
export declare function assertZipUint32FieldWithinLimit(value: number, context: string): void;
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
export declare class ZipWriter {
    private writable;
    private offset;
    private entries;
    private encoder;
    /**
     * インスタンスの状態 (Issue #17 フォローアップ)。
     * - 'open': 通常状態。addFile / addDirectory / close を呼べる
     * - 'closed': close() が成功した後。File System Access API 上ストリームは既に確定しており、
     *   以後の書き込みはできない
     * - 'failed': addFile / addDirectory / close のいずれかで例外が発生し abort 済み (terminal)。
     *   abort() 自体が失敗した場合もこの状態のまま残るため、二重 abort の防止も兼ねる
     */
    private state;
    /**
     * 現在実行中の操作。実行中でなければ false、実行中ならどのメソッドが実行中かを保持する。
     * このクラスは直列利用を契約とするため (クラス doc 参照)、実行中に別の呼び出しが来たら
     * プログラミングエラーとして即座に例外にする。async 関数本体は最初の await まで同期的に走るため、
     * beginOperation をメソッド先頭で呼べば、呼び出し元が返り値を await していなくても検出できる。
     * 操作種別を持たせているのは、公開 abort() が 'close' 実行中かどうかを区別する必要があるため
     * (close は abort で中断できない。クラス doc 参照)。
     */
    private inFlight;
    constructor(writable: FileSystemWritableFileStream);
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
    addFile(name: string, data: Uint8Array, date?: Date): Promise<void>;
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
    addDirectory(name: string, date?: Date): Promise<void>;
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
    close(): Promise<void>;
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
    abort(reason?: unknown): Promise<void>;
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
    private write;
    /**
     * state が 'open' のままであることを再確認する (Issue #17 フォローアップ)。
     * write() 内のチェックは、その write() 自身が resolve した時点の state しか見られない。
     * addFile / addDirectory では、最後の write() が resolve してから entries.push() に到達するまでの間にも
     * (呼び出し元での `await this.write(...)` の継続がマイクロタスク境界を挟むため) 公開 abort() が
     * 割り込む窓が残る。entries.push() 直前でこの確認を挟むことでその窓を塞ぐ。
     * @throws {Error} state が 'open' でない場合
     */
    private assertStillOpen;
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
    private beginOperation;
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
    private abortOnFailure;
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
    fetchFile?: (url: string, name: string, context: {
        kind: 'cover' | 'file';
    }) => Promise<Blob | null>;
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
 * ダウンロード用のヘルパー
 */
export declare class DownloadHelper {
    private readonly utils;
    constructor(utils: DownloadUtils);
    /**
     * bootstrapのCSS情報
     */
    bootCSS: {
        href: string;
        integrity: string;
    };
    /**
     * bootstrapのjs情報
     */
    bootJS: {
        src: string;
        integrity: string;
    };
    /**
     * ダウンロード用のUIを作成する
     * @param title ダウンローダーの名前
     */
    createDownloadUI(title: string): Promise<void>;
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
    downloadZip(downloadObj: unknown, progress: (n: number) => void, log: (s: string) => void, remainTime: (r: string) => void, options?: DownloadZipOptions): Promise<DownloadZipResult>;
    /**
     * 型検証
     * @param target 検証対象
     */
    isDownloadJsonObj(target: unknown): target is DownloadJsonObj;
    /**
     * ルートのhtmlを作成する
     * @param downloadObj ルートObject
     */
    createRootHtmlFromPosts(downloadObj: DownloadJsonObj): string;
    /**
     * cover画像htmlの生成
     * カバー画像が無い場合は投稿画像をスライドショーする
     * @param post 投稿情報オブジェクト
     */
    createCoverHtmlFromPost(post: DownloadJsonObj['posts'][number]): string;
    /**
     * 投稿再現htmlの生成
     * @param title 投稿
     * @param body
     */
    createHtmlFromBody(title: string, body: string): string;
}
export interface FileSystemFileHandle {
    createWritable(): Promise<FileSystemWritableFileStream>;
}
interface FileSystemWritableFileStream extends WritableStream {
    write(data: BufferSource | Blob | string): Promise<void>;
    close(): Promise<void>;
}
export {};
