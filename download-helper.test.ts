// DOS time/date は getHours() 等のローカル時刻で計算するため、テストの再現性確保のため UTC 固定
process.env.TZ = 'UTC';

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import {
  clampToZipRange,
  crc32,
  DownloadHelper,
  type DownloadJsonObj,
  DownloadUtils,
  type DownloadZipOptions,
  type FileObj,
  FileObject,
  toDosTimeDate,
  ZipWriter,
} from './download-helper';

// ============================================================
// 1. DownloadUtils tests
// ============================================================
describe('DownloadUtils', () => {
  const utils = new DownloadUtils();

  // ----------------------------------------------------------
  // encodeFileName
  // ----------------------------------------------------------
  describe('encodeFileName', () => {
    test('/ を全角に変換', () => {
      expect(utils.encodeFileName('a/b')).toBe('a／b');
    });

    test('\\ を全角に変換', () => {
      expect(utils.encodeFileName('a\\b')).toBe('a＼b');
    });

    test(': を全角に変換', () => {
      expect(utils.encodeFileName('a:b')).toBe('a：b');
    });

    test('* を全角に変換', () => {
      expect(utils.encodeFileName('a*b')).toBe('a＊b');
    });

    test('" を全角に変換', () => {
      expect(utils.encodeFileName('a"b')).toBe('a\u201Cb');
    });

    test('< を全角に変換', () => {
      expect(utils.encodeFileName('a<b')).toBe('a＜b');
    });

    test('> を全角に変換', () => {
      expect(utils.encodeFileName('a>b')).toBe('a＞b');
    });

    test('| を全角に変換', () => {
      expect(utils.encodeFileName('a|b')).toBe('a｜b');
    });

    test(', を全角に変換', () => {
      expect(utils.encodeFileName('a,b')).toBe('a，b');
    });

    test('前後の空白をtrim', () => {
      expect(utils.encodeFileName('  hello  ')).toBe('hello');
    });

    test('変換対象外の文字はそのまま', () => {
      expect(utils.encodeFileName('abc123')).toBe('abc123');
    });

    test('空文字列', () => {
      expect(utils.encodeFileName('')).toBe('');
    });

    test('日本語ファイル名', () => {
      expect(utils.encodeFileName('テスト画像')).toBe('テスト画像');
    });
  });

  // ----------------------------------------------------------
  // encodeURI
  // ----------------------------------------------------------
  describe('encodeURI', () => {
    test('URI予約文字 ; をエンコード', () => {
      expect(utils.encodeURI('a;b')).toBe('a%3Bb');
    });

    test('URI予約文字 ? をエンコード', () => {
      expect(utils.encodeURI('a?b')).toBe('a%3Fb');
    });

    test('URI予約文字 @ をエンコード', () => {
      expect(utils.encodeURI('a@b')).toBe('a%40b');
    });

    test('URI予約文字 & をエンコード', () => {
      expect(utils.encodeURI('a&b')).toBe('a%26b');
    });

    test('URI予約文字 = をエンコード', () => {
      expect(utils.encodeURI('a=b')).toBe('a%3Db');
    });

    test('URI予約文字 + をエンコード', () => {
      expect(utils.encodeURI('a+b')).toBe('a%2Bb');
    });

    test('URI予約文字 $ をエンコード', () => {
      expect(utils.encodeURI('a$b')).toBe('a%24b');
    });

    test('URI予約文字 # をエンコード', () => {
      expect(utils.encodeURI('a#b')).toBe('a%23b');
    });

    test('encodeFileName と組み合わせた結果 (/ はまず全角変換されるためURIエンコードされない)', () => {
      // / → ／ (full-width), then ／ is not a URI reserved char so stays as-is
      expect(utils.encodeURI('a/b')).toBe('a／b');
    });

    test(', は encodeFileName で全角変換されるためURIエンコード対象外', () => {
      // , → ，(full-width), then ， is not a URI reserved char so stays as-is
      expect(utils.encodeURI('a,b')).toBe('a，b');
    });

    test(': は encodeFileName で全角変換されるためURIエンコード対象外', () => {
      // : → ：(full-width)
      expect(utils.encodeURI('a:b')).toBe('a：b');
    });
  });

  // ----------------------------------------------------------
  // escapeHtml
  // ----------------------------------------------------------
  describe('escapeHtml', () => {
    test('& をエスケープ', () => {
      expect(utils.escapeHtml('a&b')).toBe('a&amp;b');
    });

    test('< をエスケープ', () => {
      expect(utils.escapeHtml('a<b')).toBe('a&lt;b');
    });

    test('> をエスケープ', () => {
      expect(utils.escapeHtml('a>b')).toBe('a&gt;b');
    });

    test('" をエスケープ', () => {
      expect(utils.escapeHtml('a"b')).toBe('a&quot;b');
    });

    test("' をエスケープ", () => {
      expect(utils.escapeHtml("a'b")).toBe('a&#39;b');
    });

    test('HTMLメタ文字を含まない文字列はそのまま', () => {
      expect(utils.escapeHtml('hello world')).toBe('hello world');
    });

    test('複数のメタ文字を含む文字列', () => {
      expect(utils.escapeHtml('<div class="a">&</div>')).toBe('&lt;div class=&quot;a&quot;&gt;&amp;&lt;/div&gt;');
    });
  });

  // ----------------------------------------------------------
  // getFileName
  // ----------------------------------------------------------
  describe('getFileName', () => {
    test('単一ファイル (length=1) → インデックスなし', () => {
      expect(utils.getFileName('photo', '.png', 1, 0, true)).toBe('photo.png');
    });

    test('複数ファイル昇順 → _1, _2, ...', () => {
      expect(utils.getFileName('photo', '.png', 3, 0, true)).toBe('photo_1.png');
      expect(utils.getFileName('photo', '.png', 3, 1, true)).toBe('photo_2.png');
      expect(utils.getFileName('photo', '.png', 3, 2, true)).toBe('photo_3.png');
    });

    test('複数ファイル降順 → _N, _N-1, ...', () => {
      expect(utils.getFileName('photo', '.png', 3, 0, false)).toBe('photo_3.png');
      expect(utils.getFileName('photo', '.png', 3, 1, false)).toBe('photo_2.png');
      expect(utils.getFileName('photo', '.png', 3, 2, false)).toBe('photo_1.png');
    });
  });

  // ----------------------------------------------------------
  // splitExt
  // ----------------------------------------------------------
  describe('splitExt', () => {
    test('通常: "file.txt" → ["file", ".txt"]', () => {
      expect(utils.splitExt('file.txt')).toEqual(['file', '.txt']);
    });

    test('複数ドット: "file.tar.gz" → ["file.tar", ".gz"]', () => {
      expect(utils.splitExt('file.tar.gz')).toEqual(['file.tar', '.gz']);
    });

    test('拡張子なし: "file" → ["file"]', () => {
      expect(utils.splitExt('file')).toEqual(['file']);
    });
  });

  // ----------------------------------------------------------
  // createInformationFile
  // ----------------------------------------------------------
  describe('createInformationFile', () => {
    test('有効なJSON → info.json (整形済み)', () => {
      const result = utils.createInformationFile('{"key":"value"}');
      expect(result.name).toBe('info.json');
      expect(result.content).toEqual([JSON.stringify({ key: 'value' }, null, '\t')]);
    });

    test('無効なJSON → info.txt (そのまま)', () => {
      const result = utils.createInformationFile('not json');
      expect(result.name).toBe('info.txt');
      expect(result.content).toEqual(['not json']);
    });
  });

  // ----------------------------------------------------------
  // isAudio / isImage / isVideo
  // ----------------------------------------------------------
  describe('isAudio', () => {
    test.each(['file.mp3', 'file.m4a', 'file.ogg'])('%s → true', (name) => {
      expect(utils.isAudio(name)).toBe(true);
    });

    test('非音声ファイル → false', () => {
      expect(utils.isAudio('file.png')).toBe(false);
    });
  });

  describe('isImage', () => {
    test.each([
      'file.apng',
      'file.avif',
      'file.gif',
      'file.jpg',
      'file.jpeg',
      'file.png',
      'file.svg',
      'file.webp',
    ])('%s → true', (name) => {
      expect(utils.isImage(name)).toBe(true);
    });

    test('非画像ファイル → false', () => {
      expect(utils.isImage('file.mp4')).toBe(false);
    });
  });

  describe('isVideo', () => {
    test.each(['file.mp4', 'file.webm', 'file.ogv'])('%s → true', (name) => {
      expect(utils.isVideo(name)).toBe(true);
    });

    test('非映像ファイル → false', () => {
      expect(utils.isVideo('file.txt')).toBe(false);
    });
  });
});

// ============================================================
// 2. FileObject tests
// ============================================================
describe('FileObject', () => {
  const utils = new DownloadUtils();

  const createFileObject = (name: string, url: string, extension = '.png'): FileObject => {
    const fileObj: FileObj = { name, url, extension };
    return new FileObject(fileObj, utils);
  };

  describe('equals', () => {
    test('同一 name + url → true', () => {
      const fo = createFileObject('img', 'https://example.com/img.png');
      expect(fo.equals({ name: 'img', url: 'https://example.com/img.png' })).toBe(true);
    });

    test('name 不一致 → false', () => {
      const fo = createFileObject('img', 'https://example.com/img.png');
      expect(fo.equals({ name: 'other', url: 'https://example.com/img.png' })).toBe(false);
    });

    test('url 不一致 → false', () => {
      const fo = createFileObject('img', 'https://example.com/img.png');
      expect(fo.equals({ name: 'img', url: 'https://example.com/other.png' })).toBe(false);
    });

    test('null 入力 → false', () => {
      const fo = createFileObject('img', 'https://example.com/img.png');
      expect(fo.equals(null)).toBe(false);
    });

    test('プリミティブ入力 → false', () => {
      const fo = createFileObject('img', 'https://example.com/img.png');
      expect(fo.equals('string')).toBe(false);
      expect(fo.equals(42)).toBe(false);
    });

    test('配列入力 → false', () => {
      const fo = createFileObject('img', 'https://example.com/img.png');
      expect(fo.equals([1, 2, 3])).toBe(false);
    });
  });

  describe('getEncodedName / getEncodedExtension', () => {
    test('encodeFileName を通した名前が返る', () => {
      const fo = createFileObject('file/name', 'https://example.com/f.png', '.png');
      expect(fo.getEncodedName()).toBe('file／name');
    });

    test('encodeFileName を通した拡張子が返る', () => {
      const fo = createFileObject('file', 'https://example.com/f.png', '.png');
      expect(fo.getEncodedExtension()).toBe('.png');
    });
  });
});

// ============================================================
// 3. DownloadHelper.isDownloadJsonObj tests
// ============================================================
describe('isDownloadJsonObj', () => {
  const utils = new DownloadUtils();
  const helper = new DownloadHelper(utils);

  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  /**
   * 有効な最小 DownloadJsonObj を生成するヘルパー
   */
  const createValidObj = (): DownloadJsonObj => ({
    posts: [
      {
        originalName: 'post1',
        encodedName: 'post1',
        informationText: '{}',
        htmlText: '<p>hello</p>',
        files: [
          {
            url: 'https://example.com/file.png',
            originalName: 'file.png',
            encodedName: 'file.png',
          },
        ],
        tags: ['tag1'],
      },
    ],
    id: 'creator-id',
    url: 'https://example.com',
    tags: ['tag1'],
    fileCount: 1,
    postCount: 1,
  });

  test('有効な最小オブジェクト → true', () => {
    expect(helper.isDownloadJsonObj(createValidObj())).toBe(true);
  });

  test('postCount が数値でない → false', () => {
    const obj = { ...createValidObj(), postCount: '1' };
    expect(helper.isDownloadJsonObj(obj)).toBe(false);
  });

  test('fileCount が数値でない → false', () => {
    const obj = { ...createValidObj(), fileCount: '1' };
    expect(helper.isDownloadJsonObj(obj)).toBe(false);
  });

  test('id が文字列でない → false', () => {
    const obj = { ...createValidObj(), id: 123 };
    expect(helper.isDownloadJsonObj(obj)).toBe(false);
  });

  test('url が文字列でない → false', () => {
    const obj = { ...createValidObj(), url: 123 };
    expect(helper.isDownloadJsonObj(obj)).toBe(false);
  });

  test('posts が配列でない → false', () => {
    const obj = { ...createValidObj(), posts: 'not-array' };
    expect(helper.isDownloadJsonObj(obj)).toBe(false);
  });

  test('tags が配列でない → false', () => {
    const obj = { ...createValidObj(), tags: 'not-array' };
    expect(helper.isDownloadJsonObj(obj)).toBe(false);
  });

  test('posts 内の要素が object でない → false', () => {
    const obj = { ...createValidObj(), posts: ['not-object'] };
    expect(helper.isDownloadJsonObj(obj)).toBe(false);
  });

  test('files 内に url 不足 → false', () => {
    const obj = createValidObj();
    (obj.posts[0].files[0] as Record<string, unknown>).url = 123;
    expect(helper.isDownloadJsonObj(obj)).toBe(false);
  });

  test('files 内に originalName 不足 → false', () => {
    const obj = createValidObj();
    (obj.posts[0].files[0] as Record<string, unknown>).originalName = 123;
    expect(helper.isDownloadJsonObj(obj)).toBe(false);
  });

  test('files 内に encodedName 不足 → false', () => {
    const obj = createValidObj();
    (obj.posts[0].files[0] as Record<string, unknown>).encodedName = 123;
    expect(helper.isDownloadJsonObj(obj)).toBe(false);
  });

  test('cover が undefined → true (省略可)', () => {
    const obj = createValidObj();
    obj.posts[0].cover = undefined;
    expect(helper.isDownloadJsonObj(obj)).toBe(true);
  });

  test('publishedDatetime に文字列 → true', () => {
    const obj = createValidObj();
    obj.posts[0].publishedDatetime = '2024-01-01T00:00:00Z';
    expect(helper.isDownloadJsonObj(obj)).toBe(true);
  });

  test('publishedDatetime が undefined → true (省略可)', () => {
    const obj = createValidObj();
    obj.posts[0].publishedDatetime = undefined;
    expect(helper.isDownloadJsonObj(obj)).toBe(true);
  });

  test('publishedDatetime が文字列でない → false', () => {
    const obj = createValidObj();
    (obj.posts[0] as Record<string, unknown>).publishedDatetime = 12345;
    expect(helper.isDownloadJsonObj(obj)).toBe(false);
  });

  test('cover が不正な型 (文字列) → false', () => {
    const obj = createValidObj();
    (obj.posts[0] as Record<string, unknown>).cover = 'not-object';
    expect(helper.isDownloadJsonObj(obj)).toBe(false);
  });

  test('null 入力 → false', () => {
    expect(helper.isDownloadJsonObj(null)).toBe(false);
  });

  test('空オブジェクト → false', () => {
    expect(helper.isDownloadJsonObj({})).toBe(false);
  });
});

// ============================================================
// 4. crc32 tests
// ============================================================
describe('crc32', () => {
  const encoder = new TextEncoder();

  test('空入力 → 0x00000000', () => {
    expect(crc32(new Uint8Array(0))).toBe(0x00000000);
  });

  test('"123456789" → 0xCBF43926 (RFC 3720 テストベクタ)', () => {
    expect(crc32(encoder.encode('123456789'))).toBe(0xcbf43926);
  });

  test('単一バイト入力', () => {
    expect(crc32(new Uint8Array([0x00]))).toBe(0xd202ef8d);
  });

  test('日本語文字列の CRC-32', () => {
    const data = encoder.encode('テスト');
    const result = crc32(data);
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThan(0);
  });
});

// ============================================================
// 5. ZipWriter tests
// ============================================================
describe('ZipWriter', () => {
  const encoder = new TextEncoder();

  /**
   * FileSystemWritableFileStream のモック
   */
  class MockWritableStream {
    chunks: Uint8Array[] = [];
    closed = false;

    async write(data: Uint8Array): Promise<void> {
      this.chunks.push(new Uint8Array(data));
    }

    async close(): Promise<void> {
      this.closed = true;
    }

    toBuffer(): Uint8Array {
      const totalLength = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of this.chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      return result;
    }
  }

  /**
   * バッファから指定オフセットの 4 バイトを little-endian uint32 として読む
   */
  function readUint32(buf: Uint8Array, offset: number): number {
    return new DataView(buf.buffer, buf.byteOffset).getUint32(offset, true);
  }

  /**
   * バッファから指定オフセットの 2 バイトを little-endian uint16 として読む
   */
  function readUint16(buf: Uint8Array, offset: number): number {
    return new DataView(buf.buffer, buf.byteOffset).getUint16(offset, true);
  }

  /**
   * extra field 全体から指定 Header ID のブロックを線形検索する
   */
  function findExtraField(extra: Uint8Array, headerId: number): { offset: number; size: number } | null {
    let offset = 0;
    while (offset + 4 <= extra.length) {
      const id = extra[offset] | (extra[offset + 1] << 8);
      const size = extra[offset + 2] | (extra[offset + 3] << 8);
      if (id === headerId) return { offset, size };
      offset += 4 + size;
    }
    return null;
  }

  function readBigUint64LE(buf: Uint8Array, offset: number): bigint {
    return new DataView(buf.buffer, buf.byteOffset).getBigUint64(offset, true);
  }

  function readInt32LE(buf: Uint8Array, offset: number): number {
    return new DataView(buf.buffer, buf.byteOffset).getInt32(offset, true);
  }

  test('1 ファイルの ZIP を正しく生成', async () => {
    const mock = new MockWritableStream();
    const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);

    const data = encoder.encode('hello');
    await zip.addFile('test.txt', data);
    await zip.close();

    const buf = mock.toBuffer();

    // Local File Header signature
    expect(readUint32(buf, 0)).toBe(0x04034b50);
    // version needed
    expect(readUint16(buf, 4)).toBe(20);
    // general purpose bit flag (UTF-8)
    expect(readUint16(buf, 6)).toBe(0x0800);
    // compression method (stored)
    expect(readUint16(buf, 8)).toBe(0);
    // file name length
    const nameLen = readUint16(buf, 26);
    expect(nameLen).toBe(encoder.encode('test.txt').length);
    // uncompressed size
    expect(readUint32(buf, 22)).toBe(data.length);

    // ファイルデータがヘッダ直後に存在
    const fileDataOffset = 30 + nameLen;
    const fileData = buf.slice(fileDataOffset, fileDataOffset + data.length);
    expect(fileData).toEqual(data);

    // Central Directory signature を探す
    const cdOffset = fileDataOffset + data.length;
    expect(readUint32(buf, cdOffset)).toBe(0x02014b50);

    // EOCD signature を探す (末尾 22 バイト)
    const eocdOffset = buf.length - 22;
    expect(readUint32(buf, eocdOffset)).toBe(0x06054b50);
    // EOCD エントリ数
    expect(readUint16(buf, eocdOffset + 8)).toBe(1);
    expect(readUint16(buf, eocdOffset + 10)).toBe(1);

    expect(mock.closed).toBe(true);
  });

  test('複数ファイルの ZIP: エントリ数が正しい', async () => {
    const mock = new MockWritableStream();
    const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);

    await zip.addFile('a.txt', encoder.encode('aaa'));
    await zip.addFile('b.txt', encoder.encode('bbb'));
    await zip.addFile('c.txt', encoder.encode('ccc'));
    await zip.close();

    const buf = mock.toBuffer();
    const eocdOffset = buf.length - 22;

    expect(readUint32(buf, eocdOffset)).toBe(0x06054b50);
    expect(readUint16(buf, eocdOffset + 8)).toBe(3);
    expect(readUint16(buf, eocdOffset + 10)).toBe(3);
  });

  test('日本語ファイル名が UTF-8 で正しくエンコード', async () => {
    const mock = new MockWritableStream();
    const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);

    const fileName = 'テスト/画像.png';
    const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG header bytes
    await zip.addFile(fileName, data);
    await zip.close();

    const buf = mock.toBuffer();
    const nameLen = readUint16(buf, 26);
    const expectedNameBytes = encoder.encode(fileName);
    expect(nameLen).toBe(expectedNameBytes.length);

    // ファイル名バイト列を比較
    const nameBytes = buf.slice(30, 30 + nameLen);
    expect(nameBytes).toEqual(expectedNameBytes);
  });

  test('CRC-32 が Local File Header に正しく記録', async () => {
    const mock = new MockWritableStream();
    const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);

    const data = encoder.encode('test data for crc');
    const expectedCrc = crc32(data);
    await zip.addFile('file.bin', data);
    await zip.close();

    const buf = mock.toBuffer();
    // CRC-32 は Local File Header の offset 14
    expect(readUint32(buf, 14)).toBe(expectedCrc);
  });

  // ----------------------------------------------------------
  // addFile に date 引数を渡した場合 (Issue #7)
  // ----------------------------------------------------------
  describe('addFile (date 引数)', () => {
    /**
     * 単一 ZIP を生成して buffer を返すヘルパ
     */
    async function buildZip(name: string, data: Uint8Array, date?: Date): Promise<Uint8Array> {
      const mock = new MockWritableStream();
      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      await zip.addFile(name, data, date);
      await zip.close();
      return mock.toBuffer();
    }

    test('引数2形式: DOS time/date=0、extra field length=0 (後方互換)', async () => {
      const buf = await buildZip('test.txt', encoder.encode('hello'));
      expect(readUint16(buf, 10)).toBe(0);
      expect(readUint16(buf, 12)).toBe(0);
      expect(readUint16(buf, 28)).toBe(0);

      const nameLen = readUint16(buf, 26);
      const cdOffset = 30 + nameLen + 5; // 'hello' = 5 バイト、extra なし
      expect(readUint32(buf, cdOffset)).toBe(0x02014b50);
      expect(readUint16(buf, cdOffset + 12)).toBe(0);
      expect(readUint16(buf, cdOffset + 14)).toBe(0);
      expect(readUint16(buf, cdOffset + 30)).toBe(0);
    });

    test('引数2形式と Invalid Date は完全一致のバイト列', async () => {
      const a = await buildZip('a.txt', encoder.encode('a'));
      const b = await buildZip('a.txt', encoder.encode('a'), new Date('not-a-date'));
      expect(b).toEqual(a);
    });

    test('一般ケース (2024-05-01T12:34:56Z): DOS / NTFS / UT が LFH/CD に整合して書かれる', async () => {
      const date = new Date('2024-05-01T12:34:56Z');
      const data = encoder.encode('hello');
      const buf = await buildZip('test.txt', data, date);

      // 期待 DOS time = (12<<11)|(34<<5)|(56>>1) = 25692
      // 期待 DOS date = ((2024-1980)<<9)|(5<<5)|1 = 22689
      const expectedDosTime = 25692;
      const expectedDosDate = 22689;
      const expectedFiletime = (BigInt(date.getTime()) + 11644473600000n) * 10000n;
      const expectedUnix = Math.floor(date.getTime() / 1000);

      // --- LFH ---
      expect(readUint16(buf, 10)).toBe(expectedDosTime);
      expect(readUint16(buf, 12)).toBe(expectedDosDate);
      const nameLen = readUint16(buf, 26);
      const extraLen = readUint16(buf, 28);
      expect(nameLen).toBe(8);
      expect(extraLen).toBe(53); // NTFS 36 + UT 17

      const lfhExtra = buf.slice(30 + nameLen, 30 + nameLen + extraLen);
      const ntfs = findExtraField(lfhExtra, 0x000a);
      const ut = findExtraField(lfhExtra, 0x5455);
      expect(ntfs).not.toBeNull();
      expect(ut).not.toBeNull();
      const ntfsBlk = lfhExtra.slice(ntfs?.offset ?? 0, (ntfs?.offset ?? 0) + 4 + (ntfs?.size ?? 0));
      expect(readUint16(ntfsBlk, 2)).toBe(32); // Data Size
      expect(readUint16(ntfsBlk, 8)).toBe(0x0001); // Attr Tag
      expect(readUint16(ntfsBlk, 10)).toBe(24); // Attr Size
      expect(readBigUint64LE(ntfsBlk, 12)).toBe(expectedFiletime); // Mtime
      expect(readBigUint64LE(ntfsBlk, 20)).toBe(expectedFiletime); // Atime
      expect(readBigUint64LE(ntfsBlk, 28)).toBe(expectedFiletime); // Ctime
      const utBlk = lfhExtra.slice(ut?.offset ?? 0, (ut?.offset ?? 0) + 4 + (ut?.size ?? 0));
      expect(readUint16(utBlk, 2)).toBe(13); // Data Size
      expect(utBlk[4]).toBe(0x07); // Flags
      expect(readInt32LE(utBlk, 5)).toBe(expectedUnix); // Mtime
      expect(readInt32LE(utBlk, 9)).toBe(expectedUnix); // Atime
      expect(readInt32LE(utBlk, 13)).toBe(expectedUnix); // Ctime

      // --- file data ---
      const fileDataOffset = 30 + nameLen + extraLen;
      expect(buf.slice(fileDataOffset, fileDataOffset + data.length)).toEqual(data);

      // --- CD ---
      const cdOffset = fileDataOffset + data.length;
      expect(readUint32(buf, cdOffset)).toBe(0x02014b50);
      expect(readUint16(buf, cdOffset + 12)).toBe(expectedDosTime);
      expect(readUint16(buf, cdOffset + 14)).toBe(expectedDosDate);
      const cdNameLen = readUint16(buf, cdOffset + 28);
      const cdExtraLen = readUint16(buf, cdOffset + 30);
      expect(cdExtraLen).toBe(45); // NTFS 36 + UT 9
      const cdExtra = buf.slice(cdOffset + 46 + cdNameLen, cdOffset + 46 + cdNameLen + cdExtraLen);
      const cdNtfs = findExtraField(cdExtra, 0x000a);
      const cdUt = findExtraField(cdExtra, 0x5455);
      expect(cdNtfs).not.toBeNull();
      expect(cdUt).not.toBeNull();
      const cdNtfsBlk = cdExtra.slice(cdNtfs?.offset ?? 0, (cdNtfs?.offset ?? 0) + 4 + (cdNtfs?.size ?? 0));
      expect(readBigUint64LE(cdNtfsBlk, 12)).toBe(expectedFiletime);
      const cdUtBlk = cdExtra.slice(cdUt?.offset ?? 0, (cdUt?.offset ?? 0) + 4 + (cdUt?.size ?? 0));
      expect(readUint16(cdUtBlk, 2)).toBe(5); // mtime のみ
      expect(cdUtBlk[4]).toBe(0x07);
      expect(readInt32LE(cdUtBlk, 5)).toBe(expectedUnix);

      // --- EOCD cdOffset / cdSize 整合 ---
      const eocdOffset = buf.length - 22;
      expect(readUint32(buf, eocdOffset + 16)).toBe(cdOffset);
      expect(readUint32(buf, eocdOffset + 12)).toBe(eocdOffset - cdOffset);
    });

    test('1980-01-01T00:00:00Z: DOS time=0、DOS date=0x0021、UT 書かれる', async () => {
      const buf = await buildZip('a.txt', encoder.encode('a'), new Date('1980-01-01T00:00:00Z'));
      expect(readUint16(buf, 10)).toBe(0);
      expect(readUint16(buf, 12)).toBe(0x0021);
      expect(readUint16(buf, 28)).toBe(53);
    });

    test('1980 未満の Date は clamp されて 1980-01-01 と同等のバイト列', async () => {
      const a = await buildZip('a.txt', encoder.encode('a'), new Date('1979-06-15T00:00:00Z'));
      const b = await buildZip('a.txt', encoder.encode('a'), new Date('1980-01-01T00:00:00Z'));
      expect(a).toEqual(b);
    });

    test('2107-12-31T23:59:58Z: DOS 最大値、UT は省略 (extra=36)', async () => {
      const buf = await buildZip('a.txt', encoder.encode('a'), new Date('2107-12-31T23:59:58Z'));
      // (23<<11)|(59<<5)|(58>>1) = 49021 = 0xBF7D
      expect(readUint16(buf, 10)).toBe(0xbf7d);
      // ((2107-1980)<<9)|(12<<5)|31 = 65439 = 0xFF9F
      expect(readUint16(buf, 12)).toBe(0xff9f);
      expect(readUint16(buf, 28)).toBe(36); // NTFS のみ

      const nameLen = readUint16(buf, 26);
      const cdOffset = 30 + nameLen + 36 + 1; // extra 36 + data 1 byte
      expect(readUint32(buf, cdOffset)).toBe(0x02014b50);
      expect(readUint16(buf, cdOffset + 30)).toBe(36);
    });

    test('2107 超過の Date は clamp されて 2107-12-31 23:59:58 と同等のバイト列', async () => {
      const a = await buildZip('a.txt', encoder.encode('a'), new Date('2200-01-01T00:00:00Z'));
      const b = await buildZip('a.txt', encoder.encode('a'), new Date('2107-12-31T23:59:58Z'));
      expect(a).toEqual(b);
    });
  });

  // ----------------------------------------------------------
  // addFile の後方互換 (Issue #14)
  // 既存テストは CD の signature しか見ていなかったため、externalAttr 追加により
  // LFH / CD / EOCD の他の固定フィールドが意図せず変わっていないことを保証する
  // ----------------------------------------------------------
  describe('addFile の後方互換 (全固定フィールド)', () => {
    async function buildSingleFileZip(date?: Date): Promise<{ buf: Uint8Array; crc: number; nameLen: number }> {
      const mock = new MockWritableStream();
      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      const data = encoder.encode('hello');
      const crc = crc32(data);
      await zip.addFile('test.txt', data, date);
      await zip.close();
      return { buf: mock.toBuffer(), crc, nameLen: encoder.encode('test.txt').length };
    }

    test('date なし: LFH の全固定フィールドが従来と同じ値', async () => {
      const { buf, crc, nameLen } = await buildSingleFileZip();
      expect(readUint32(buf, 0)).toBe(0x04034b50); // signature
      expect(readUint16(buf, 4)).toBe(20); // version needed
      expect(readUint16(buf, 6)).toBe(0x0800); // flags
      expect(readUint16(buf, 8)).toBe(0); // method
      expect(readUint16(buf, 10)).toBe(0); // mod time
      expect(readUint16(buf, 12)).toBe(0); // mod date
      expect(readUint32(buf, 14)).toBe(crc); // crc-32
      expect(readUint32(buf, 18)).toBe(5); // compressed size
      expect(readUint32(buf, 22)).toBe(5); // uncompressed size
      expect(readUint16(buf, 26)).toBe(nameLen); // file name length
      expect(readUint16(buf, 28)).toBe(0); // extra field length
    });

    test('date なし: CD の全固定フィールドが従来と同じ値 (external file attributes = 0 を含む)', async () => {
      const { buf, crc, nameLen } = await buildSingleFileZip();
      const cdOffset = 30 + nameLen + 5; // LFH + name + data ('hello')
      expect(readUint32(buf, cdOffset)).toBe(0x02014b50); // signature
      expect(readUint16(buf, cdOffset + 4)).toBe(20); // version made by
      expect(readUint16(buf, cdOffset + 6)).toBe(20); // version needed
      expect(readUint16(buf, cdOffset + 8)).toBe(0x0800); // flags
      expect(readUint16(buf, cdOffset + 10)).toBe(0); // method
      expect(readUint16(buf, cdOffset + 12)).toBe(0); // mod time
      expect(readUint16(buf, cdOffset + 14)).toBe(0); // mod date
      expect(readUint32(buf, cdOffset + 16)).toBe(crc); // crc-32
      expect(readUint32(buf, cdOffset + 20)).toBe(5); // compressed size
      expect(readUint32(buf, cdOffset + 24)).toBe(5); // uncompressed size
      expect(readUint16(buf, cdOffset + 28)).toBe(nameLen); // file name length
      expect(readUint16(buf, cdOffset + 30)).toBe(0); // extra field length
      expect(readUint16(buf, cdOffset + 32)).toBe(0); // file comment length
      expect(readUint16(buf, cdOffset + 34)).toBe(0); // disk number start
      expect(readUint16(buf, cdOffset + 36)).toBe(0); // internal file attributes
      expect(readUint32(buf, cdOffset + 38)).toBe(0x00000000); // external file attributes
      expect(readUint32(buf, cdOffset + 42)).toBe(0); // local header offset
    });

    test('date なし: EOCD の全固定フィールドが従来と同じ値', async () => {
      const { buf, nameLen } = await buildSingleFileZip();
      const cdOffset = 30 + nameLen + 5;
      const cdSize = 46 + nameLen; // extra field なし
      const eocdOffset = cdOffset + cdSize;
      expect(eocdOffset).toBe(buf.length - 22);
      expect(readUint32(buf, eocdOffset)).toBe(0x06054b50); // signature
      expect(readUint16(buf, eocdOffset + 4)).toBe(0); // disk number
      expect(readUint16(buf, eocdOffset + 6)).toBe(0); // CD disk number
      expect(readUint16(buf, eocdOffset + 8)).toBe(1); // CD entries on this disk
      expect(readUint16(buf, eocdOffset + 10)).toBe(1); // total CD entries
      expect(readUint32(buf, eocdOffset + 12)).toBe(cdSize); // CD size
      expect(readUint32(buf, eocdOffset + 16)).toBe(cdOffset); // CD offset
      expect(readUint16(buf, eocdOffset + 20)).toBe(0); // comment length
    });

    test('date あり (UT を含む, 2024-05-01T12:34:56Z): LFH / CD / EOCD の全固定フィールドが従来と同じ値', async () => {
      const date = new Date('2024-05-01T12:34:56Z');
      const { buf, crc, nameLen } = await buildSingleFileZip(date);
      const extraLen = 53; // NTFS 36 + UT 17
      const cdExtraLen = 45; // NTFS 36 + UT 9

      // --- LFH ---
      expect(readUint32(buf, 0)).toBe(0x04034b50);
      expect(readUint16(buf, 4)).toBe(20);
      expect(readUint16(buf, 6)).toBe(0x0800);
      expect(readUint16(buf, 8)).toBe(0);
      expect(readUint32(buf, 14)).toBe(crc);
      expect(readUint32(buf, 18)).toBe(5);
      expect(readUint32(buf, 22)).toBe(5);
      expect(readUint16(buf, 26)).toBe(nameLen);
      expect(readUint16(buf, 28)).toBe(extraLen);

      // --- CD ---
      const cdOffset = 30 + nameLen + extraLen + 5;
      expect(readUint32(buf, cdOffset)).toBe(0x02014b50);
      expect(readUint16(buf, cdOffset + 4)).toBe(20); // version made by
      expect(readUint16(buf, cdOffset + 6)).toBe(20); // version needed
      expect(readUint16(buf, cdOffset + 8)).toBe(0x0800);
      expect(readUint16(buf, cdOffset + 10)).toBe(0);
      expect(readUint32(buf, cdOffset + 16)).toBe(crc);
      expect(readUint32(buf, cdOffset + 20)).toBe(5);
      expect(readUint32(buf, cdOffset + 24)).toBe(5);
      expect(readUint16(buf, cdOffset + 28)).toBe(nameLen);
      expect(readUint16(buf, cdOffset + 30)).toBe(cdExtraLen);
      expect(readUint16(buf, cdOffset + 32)).toBe(0); // file comment length
      expect(readUint16(buf, cdOffset + 34)).toBe(0); // disk number start
      expect(readUint16(buf, cdOffset + 36)).toBe(0); // internal file attributes
      expect(readUint32(buf, cdOffset + 38)).toBe(0x00000000); // external file attributes
      expect(readUint32(buf, cdOffset + 42)).toBe(0); // local header offset

      // --- EOCD ---
      const cdSize = 46 + nameLen + cdExtraLen;
      const eocdOffset = cdOffset + cdSize;
      expect(eocdOffset).toBe(buf.length - 22);
      expect(readUint32(buf, eocdOffset)).toBe(0x06054b50);
      expect(readUint16(buf, eocdOffset + 4)).toBe(0);
      expect(readUint16(buf, eocdOffset + 6)).toBe(0);
      expect(readUint16(buf, eocdOffset + 8)).toBe(1);
      expect(readUint16(buf, eocdOffset + 10)).toBe(1);
      expect(readUint32(buf, eocdOffset + 12)).toBe(cdSize);
      expect(readUint32(buf, eocdOffset + 16)).toBe(cdOffset);
      expect(readUint16(buf, eocdOffset + 20)).toBe(0);
    });
  });

  // ----------------------------------------------------------
  // addDirectory (Issue #14)
  // ----------------------------------------------------------
  describe('addDirectory', () => {
    async function buildDirZip(name: string, date?: Date): Promise<Uint8Array> {
      const mock = new MockWritableStream();
      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      await zip.addDirectory(name, date);
      await zip.close();
      return mock.toBuffer();
    }

    test('date 省略: LFH / CD の DOS time/date が 0、extra field length が 0', async () => {
      const buf = await buildDirZip('dir');
      const nameLen = readUint16(buf, 26);
      expect(readUint16(buf, 10)).toBe(0); // LFH mod time
      expect(readUint16(buf, 12)).toBe(0); // LFH mod date
      expect(readUint16(buf, 28)).toBe(0); // LFH extra field length
      const cdOffset = 30 + nameLen; // データ本体なし
      expect(readUint16(buf, cdOffset + 12)).toBe(0); // CD mod time
      expect(readUint16(buf, cdOffset + 14)).toBe(0); // CD mod date
      expect(readUint16(buf, cdOffset + 30)).toBe(0); // CD extra field length
    });

    test('Invalid Date は date 省略と同じ扱い', async () => {
      const a = await buildDirZip('dir');
      const b = await buildDirZip('dir', new Date('not-a-date'));
      expect(a).toEqual(b);
    });

    test('CRC-32 = 0、compressed size = 0、uncompressed size = 0 (LFH / CD 両方)', async () => {
      const buf = await buildDirZip('dir');
      expect(readUint32(buf, 14)).toBe(0); // LFH crc-32
      expect(readUint32(buf, 18)).toBe(0); // LFH compressed size
      expect(readUint32(buf, 22)).toBe(0); // LFH uncompressed size
      const nameLen = readUint16(buf, 26);
      const cdOffset = 30 + nameLen;
      expect(readUint32(buf, cdOffset + 16)).toBe(0); // CD crc-32
      expect(readUint32(buf, cdOffset + 20)).toBe(0); // CD compressed size
      expect(readUint32(buf, cdOffset + 24)).toBe(0); // CD uncompressed size
    });

    test('CD の external file attributes が 0x00000010、version made by が 0x0014', async () => {
      const buf = await buildDirZip('dir');
      const nameLen = readUint16(buf, 26);
      const cdOffset = 30 + nameLen;
      expect(readUint32(buf, cdOffset + 38)).toBe(0x00000010);
      expect(readUint16(buf, cdOffset + 4)).toBe(0x0014);
    });

    test('LFH / CD の general purpose bit flag が 0x0800、version needed to extract = 20、compression method = 0', async () => {
      const buf = await buildDirZip('dir');
      expect(readUint16(buf, 4)).toBe(20); // LFH version needed
      expect(readUint16(buf, 6)).toBe(0x0800); // LFH flags
      expect(readUint16(buf, 8)).toBe(0); // LFH method
      const nameLen = readUint16(buf, 26);
      const cdOffset = 30 + nameLen;
      expect(readUint16(buf, cdOffset + 6)).toBe(20); // CD version needed
      expect(readUint16(buf, cdOffset + 8)).toBe(0x0800); // CD flags
      expect(readUint16(buf, cdOffset + 10)).toBe(0); // CD method
    });

    test('LFH / CD でエントリ名が一致し、末尾が "/"', async () => {
      const buf = await buildDirZip('dir');
      const nameLen = readUint16(buf, 26);
      const lfhName = buf.slice(30, 30 + nameLen);
      const cdOffset = 30 + nameLen;
      const cdNameLen = readUint16(buf, cdOffset + 28);
      const cdName = buf.slice(cdOffset + 46, cdOffset + 46 + cdNameLen);
      expect(new TextDecoder().decode(lfhName)).toBe('dir/');
      expect(lfhName).toEqual(cdName);
    });

    test('addDirectory("dir") と addDirectory("dir/") が同じエントリ名を生成する', async () => {
      const a = await buildDirZip('dir');
      const b = await buildDirZip('dir/');
      expect(a).toEqual(b);
    });

    test('addDirectory("") が例外を投げる', async () => {
      const mock = new MockWritableStream();
      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      await expect(zip.addDirectory('')).rejects.toThrow();
    });

    test('addDirectory("/dir") が例外を投げる', async () => {
      const mock = new MockWritableStream();
      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      await expect(zip.addDirectory('/dir')).rejects.toThrow();
    });

    describe('date 指定', () => {
      test('UT が書ける範囲 (2024-05-01T12:34:56Z): extra field length が LFH=53 / CD=45、NTFS Mtime/Atime/Ctime と UT ModTime/AcTime/CrTime が指定値と一致する', async () => {
        const date = new Date('2024-05-01T12:34:56Z');
        const buf = await buildDirZip('dir', date);
        const expectedFiletime = (BigInt(date.getTime()) + 11644473600000n) * 10000n;
        const expectedUnix = Math.floor(date.getTime() / 1000);

        const nameLen = readUint16(buf, 26);
        const extraLen = readUint16(buf, 28);
        expect(extraLen).toBe(53); // NTFS 36 + UT 17

        const lfhExtra = buf.slice(30 + nameLen, 30 + nameLen + extraLen);
        const ntfs = findExtraField(lfhExtra, 0x000a);
        const ut = findExtraField(lfhExtra, 0x5455);
        expect(ntfs).not.toBeNull();
        expect(ut).not.toBeNull();
        const ntfsBlk = lfhExtra.slice(ntfs?.offset ?? 0, (ntfs?.offset ?? 0) + 4 + (ntfs?.size ?? 0));
        expect(readBigUint64LE(ntfsBlk, 12)).toBe(expectedFiletime); // Mtime
        expect(readBigUint64LE(ntfsBlk, 20)).toBe(expectedFiletime); // Atime
        expect(readBigUint64LE(ntfsBlk, 28)).toBe(expectedFiletime); // Ctime
        const utBlk = lfhExtra.slice(ut?.offset ?? 0, (ut?.offset ?? 0) + 4 + (ut?.size ?? 0));
        expect(readUint16(utBlk, 2)).toBe(13); // Data Size
        expect(utBlk[4]).toBe(0x07); // Flags
        expect(readInt32LE(utBlk, 5)).toBe(expectedUnix); // ModTime
        expect(readInt32LE(utBlk, 9)).toBe(expectedUnix); // AcTime
        expect(readInt32LE(utBlk, 13)).toBe(expectedUnix); // CrTime

        const cdOffset = 30 + nameLen + extraLen;
        const cdExtraLen = readUint16(buf, cdOffset + 30);
        expect(cdExtraLen).toBe(45); // NTFS 36 + UT 9
        const cdNameLen = readUint16(buf, cdOffset + 28);
        const cdExtra = buf.slice(cdOffset + 46 + cdNameLen, cdOffset + 46 + cdNameLen + cdExtraLen);
        const cdUt = findExtraField(cdExtra, 0x5455);
        expect(cdUt).not.toBeNull();
        const cdUtBlk = cdExtra.slice(cdUt?.offset ?? 0, (cdUt?.offset ?? 0) + 4 + (cdUt?.size ?? 0));
        expect(readUint16(cdUtBlk, 2)).toBe(5); // Data Size (mtime のみ)
        expect(cdUtBlk[4]).toBe(0x07); // Flags (LFH と同一値、Info-ZIP 慣例)
        expect(readInt32LE(cdUtBlk, 5)).toBe(expectedUnix); // Mtime
      });

      test('clamp 後の Unix time が signed int32 範囲外 (2107-12-31): LFH / CD とも extra field length = 36 (NTFS のみ)', async () => {
        const buf = await buildDirZip('dir', new Date('2107-12-31T23:59:58Z'));
        const nameLen = readUint16(buf, 26);
        expect(readUint16(buf, 28)).toBe(36); // LFH extra field length
        const cdOffset = 30 + nameLen + 36;
        expect(readUint16(buf, cdOffset + 30)).toBe(36); // CD extra field length
      });
    });

    test('ディレクトリエントリの直後に配下ファイルの LFH が続き、EOCD の cdOffset / cdSize / エントリ数が整合する', async () => {
      const mock = new MockWritableStream();
      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      await zip.addDirectory('dir');
      const dirNameLen = encoder.encode('dir/').length;
      await zip.addFile('dir/file.txt', encoder.encode('x'));
      await zip.close();
      const buf = mock.toBuffer();

      // ディレクトリエントリ (30 bytes + name のみ、extra/data なし) の直後にファイルの LFH signature が続く
      const fileLfhOffset = 30 + dirNameLen;
      expect(readUint32(buf, fileLfhOffset)).toBe(0x04034b50);

      const eocdOffset = buf.length - 22;
      expect(readUint16(buf, eocdOffset + 8)).toBe(2); // CD entries on this disk
      expect(readUint16(buf, eocdOffset + 10)).toBe(2); // total CD entries
      const cdOffset = readUint32(buf, eocdOffset + 16);
      const cdSize = readUint32(buf, eocdOffset + 12);
      expect(cdOffset + cdSize).toBe(eocdOffset);
      expect(readUint32(buf, cdOffset)).toBe(0x02014b50); // 1 件目の CD (dir)
    });
  });
});

// ============================================================
// 6. DownloadHelper.downloadZip tests (Issue #14, 構造レベル)
// ============================================================
describe('DownloadHelper.downloadZip', () => {
  const utils = new DownloadUtils();
  const helper = new DownloadHelper(utils);

  /**
   * FileSystemWritableFileStream のモック (ZipWriter テストと同じ実装)
   */
  class MockWritableStream {
    chunks: Uint8Array[] = [];
    closed = false;

    async write(data: Uint8Array): Promise<void> {
      this.chunks.push(new Uint8Array(data));
    }

    async close(): Promise<void> {
      this.closed = true;
    }

    toBuffer(): Uint8Array {
      const totalLength = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of this.chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      return result;
    }
  }

  function readUint32(buf: Uint8Array, offset: number): number {
    return new DataView(buf.buffer, buf.byteOffset).getUint32(offset, true);
  }

  function readUint16(buf: Uint8Array, offset: number): number {
    return new DataView(buf.buffer, buf.byteOffset).getUint16(offset, true);
  }

  type CdEntry = { externalAttr: number; dosTime: number; dosDate: number; localHeaderOffset: number };

  /**
   * central directory を先頭から走査し、名前 → 主要フィールドを返す
   * Map の挿入順は central directory の格納順 (= addFile/addDirectory の呼び出し順) と一致する
   */
  function parseCentralDirectory(buf: Uint8Array): Map<string, CdEntry> {
    const eocdOffset = buf.length - 22;
    const cdOffset = readUint32(buf, eocdOffset + 16);
    const totalEntries = readUint16(buf, eocdOffset + 10);
    const result = new Map<string, CdEntry>();
    let pos = cdOffset;
    for (let i = 0; i < totalEntries; i++) {
      const nameLen = readUint16(buf, pos + 28);
      const extraLen = readUint16(buf, pos + 30);
      const commentLen = readUint16(buf, pos + 32);
      const name = new TextDecoder().decode(buf.slice(pos + 46, pos + 46 + nameLen));
      result.set(name, {
        externalAttr: readUint32(buf, pos + 38),
        dosTime: readUint16(buf, pos + 12),
        dosDate: readUint16(buf, pos + 14),
        localHeaderOffset: readUint32(buf, pos + 42),
      });
      pos += 46 + nameLen + extraLen + commentLen;
    }
    return result;
  }

  /**
   * 有効な最小 DownloadJsonObj (投稿 2 件) を生成するヘルパー
   */
  function createValidObj(overrides?: Partial<DownloadJsonObj>): DownloadJsonObj {
    return {
      posts: [
        {
          originalName: 'post1',
          encodedName: 'post1',
          informationText: '{}',
          htmlText: '<p>hello</p>',
          files: [{ url: 'https://example.com/a.png', originalName: 'a.png', encodedName: 'a.png' }],
          tags: [],
          publishedDatetime: '2024-01-01T00:00:00Z',
        },
        {
          originalName: 'post2',
          encodedName: 'post2',
          informationText: '{}',
          htmlText: '<p>world</p>',
          files: [{ url: 'https://example.com/b.png', originalName: 'b.png', encodedName: 'b.png' }],
          tags: [],
          publishedDatetime: '2024-06-15T00:00:00Z',
        },
      ],
      id: 'creator-id',
      url: 'https://example.com',
      tags: [],
      fileCount: 2,
      postCount: 2,
      ...overrides,
    };
  }

  /**
   * handle / fetchFile を注入して downloadZip を実行し、書き込まれた ZIP のバイト列を返す
   * fetchFile 省略時は常にダミー Blob を返す (全ファイル取得成功)
   */
  async function runDownloadZip(
    downloadObj: unknown,
    optionsOverride?: Partial<DownloadZipOptions>,
  ): Promise<Uint8Array> {
    const mock = new MockWritableStream();
    const handle = {
      async createWritable() {
        return mock as unknown as FileSystemWritableFileStream;
      },
    };
    const fetchFile = async () => new Blob([new Uint8Array([1, 2, 3])]);
    await helper.downloadZip(
      downloadObj,
      () => {},
      () => {},
      () => {},
      {
        handle: handle as unknown as FileSystemFileHandle,
        fetchFile,
        ...optionsOverride,
      },
    );
    return mock.toBuffer();
  }

  describe('入力検証 (handle 取得前に例外)', () => {
    let originalPicker: unknown;
    let pickerCalled: boolean;
    let createWritableCalled: boolean;

    beforeEach(() => {
      pickerCalled = false;
      createWritableCalled = false;
      originalPicker = (globalThis as Record<string, unknown>).showSaveFilePicker;
      (globalThis as Record<string, unknown>).showSaveFilePicker = async () => {
        pickerCalled = true;
        return {
          async createWritable() {
            createWritableCalled = true;
            return new MockWritableStream() as unknown as FileSystemWritableFileStream;
          },
        };
      };
    });

    afterEach(() => {
      (globalThis as Record<string, unknown>).showSaveFilePicker = originalPicker;
    });

    /**
     * options.handle を渡さずに実行し、例外が投げられ、
     * showSaveFilePicker / createWritable のどちらも呼ばれていないことを検証する
     */
    async function expectValidationError(downloadObj: unknown): Promise<void> {
      await expect(
        helper.downloadZip(
          downloadObj,
          () => {},
          () => {},
          () => {},
        ),
      ).rejects.toThrow();
      expect(pickerCalled).toBe(false);
      expect(createWritableCalled).toBe(false);
    }

    test('id が空文字列 → 例外', async () => {
      await expectValidationError(createValidObj({ id: '' }));
    });

    test('id が空白のみ (encode 後に空になる) → 例外', async () => {
      await expectValidationError(createValidObj({ id: '   ' }));
    });

    test('id が "." → 例外', async () => {
      await expectValidationError(createValidObj({ id: '.' }));
    });

    test('id が ".." → 例外', async () => {
      await expectValidationError(createValidObj({ id: '..' }));
    });

    test('post.encodedName が未定義 → 例外', async () => {
      const obj = createValidObj();
      (obj.posts[0] as Record<string, unknown>).encodedName = undefined;
      await expectValidationError(obj);
    });

    test('post.encodedName が非文字列 → 例外', async () => {
      const obj = createValidObj();
      (obj.posts[0] as Record<string, unknown>).encodedName = 123;
      await expectValidationError(obj);
    });

    test('post.encodedName が空文字列 → 例外', async () => {
      const obj = createValidObj();
      obj.posts[0].encodedName = '';
      await expectValidationError(obj);
    });

    test('post.encodedName が "/" を含む → 例外', async () => {
      const obj = createValidObj();
      obj.posts[0].encodedName = 'a/b';
      await expectValidationError(obj);
    });

    test('post.encodedName が "\\" を含む → 例外', async () => {
      const obj = createValidObj();
      obj.posts[0].encodedName = 'a\\b';
      await expectValidationError(obj);
    });

    test('post.encodedName が ":" を含む → 例外', async () => {
      const obj = createValidObj();
      obj.posts[0].encodedName = 'a:b';
      await expectValidationError(obj);
    });

    test('post.encodedName が "." → 例外', async () => {
      const obj = createValidObj();
      obj.posts[0].encodedName = '.';
      await expectValidationError(obj);
    });

    test('post.encodedName が ".." → 例外', async () => {
      const obj = createValidObj();
      obj.posts[0].encodedName = '..';
      await expectValidationError(obj);
    });

    test('post.encodedName が重複 → 例外', async () => {
      const obj = createValidObj();
      obj.posts[1].encodedName = obj.posts[0].encodedName;
      await expectValidationError(obj);
    });

    test('post.cover.name が空文字列 → 例外', async () => {
      const obj = createValidObj();
      obj.posts[0].cover = { url: 'https://example.com/c.png', name: '' };
      await expectValidationError(obj);
    });

    test('post.cover.name が "." → 例外', async () => {
      const obj = createValidObj();
      obj.posts[0].cover = { url: 'https://example.com/c.png', name: '.' };
      await expectValidationError(obj);
    });

    test('post.cover.name が ".." → 例外', async () => {
      const obj = createValidObj();
      obj.posts[0].cover = { url: 'https://example.com/c.png', name: '..' };
      await expectValidationError(obj);
    });

    test('file.encodedName が空文字列 → 例外', async () => {
      const obj = createValidObj();
      obj.posts[0].files[0].encodedName = '';
      await expectValidationError(obj);
    });

    test('file.encodedName が "." → 例外', async () => {
      const obj = createValidObj();
      obj.posts[0].files[0].encodedName = '.';
      await expectValidationError(obj);
    });

    test('file.encodedName が ".." → 例外', async () => {
      const obj = createValidObj();
      obj.posts[0].files[0].encodedName = '..';
      await expectValidationError(obj);
    });
  });

  describe('構造 (ディレクトリエントリの配置と日時)', () => {
    test('投稿ごとにディレクトリエントリがちょうど 1 件書かれ、配下ファイルより前に配置される', async () => {
      const buf = await runDownloadZip(createValidObj());
      const cd = parseCentralDirectory(buf);
      const names = Array.from(cd.keys());

      const post1DirIdx = names.indexOf('creator-id/post1/');
      expect(post1DirIdx).toBeGreaterThanOrEqual(0);
      expect(names.filter((n) => n === 'creator-id/post1/').length).toBe(1);

      const post1ChildIdx = names.findIndex((n) => n !== 'creator-id/post1/' && n.startsWith('creator-id/post1/'));
      expect(post1ChildIdx).toBeGreaterThan(post1DirIdx);
    });

    test('ルートディレクトリのエントリがルート index.html より前に配置される', async () => {
      const buf = await runDownloadZip(createValidObj());
      const cd = parseCentralDirectory(buf);
      const names = Array.from(cd.keys());
      const rootDirIdx = names.indexOf('creator-id/');
      const rootHtmlIdx = names.indexOf('creator-id/index.html');
      expect(rootDirIdx).toBe(0);
      expect(rootHtmlIdx).toBeGreaterThan(rootDirIdx);
    });

    test('ルートディレクトリが書かれ、その日時が有効な publishedDatetime の最大値 (clamp 後) と一致する', async () => {
      const buf = await runDownloadZip(createValidObj());
      const cd = parseCentralDirectory(buf);
      const rootEntry = cd.get('creator-id/');
      expect(rootEntry).toBeDefined();
      // posts の publishedDatetime は 2024-01-01 と 2024-06-15 → 最大値は 2024-06-15
      const expected = toDosTimeDate(clampToZipRange(new Date('2024-06-15T00:00:00Z')));
      expect(rootEntry?.dosTime).toBe(expected.time);
      expect(rootEntry?.dosDate).toBe(expected.dosDate);
    });

    test('publishedDatetime が有効 / 未指定 / 不正値の 3 ケースで、投稿ディレクトリの日時が期待どおりになる', async () => {
      const obj = createValidObj();
      obj.posts[0].publishedDatetime = '2024-03-01T00:00:00Z';
      obj.posts[1].publishedDatetime = undefined;
      const buf = await runDownloadZip(obj);
      const cd = parseCentralDirectory(buf);

      const expected = toDosTimeDate(clampToZipRange(new Date('2024-03-01T00:00:00Z')));
      expect(cd.get('creator-id/post1/')?.dosTime).toBe(expected.time);
      expect(cd.get('creator-id/post1/')?.dosDate).toBe(expected.dosDate);
      // 未指定 → date なし (DOS 0)
      expect(cd.get('creator-id/post2/')?.dosTime).toBe(0);
      expect(cd.get('creator-id/post2/')?.dosDate).toBe(0);

      const objInvalid = createValidObj();
      objInvalid.posts[0].publishedDatetime = 'not-a-date';
      const buf2 = await runDownloadZip(objInvalid);
      const cd2 = parseCentralDirectory(buf2);
      // 不正値 → date なし (DOS 0)
      expect(cd2.get('creator-id/post1/')?.dosTime).toBe(0);
      expect(cd2.get('creator-id/post1/')?.dosDate).toBe(0);
    });

    test('全投稿の publishedDatetime が無効な場合、ルートディレクトリが date なしになる', async () => {
      const obj = createValidObj();
      obj.posts[0].publishedDatetime = undefined;
      obj.posts[1].publishedDatetime = 'not-a-date';
      const buf = await runDownloadZip(obj);
      const cd = parseCentralDirectory(buf);
      expect(cd.get('creator-id/')?.dosTime).toBe(0);
      expect(cd.get('creator-id/')?.dosDate).toBe(0);
    });

    test('EOCD のエントリ数が「実際に書かれた非ディレクトリエントリ数 + posts.length + 1」と一致する', async () => {
      const obj = createValidObj();
      const buf = await runDownloadZip(obj);
      const eocdOffset = buf.length - 22;
      const totalEntries = readUint16(buf, eocdOffset + 10);
      const cd = parseCentralDirectory(buf);
      const dirEntryCount = Array.from(cd.values()).filter((v) => (v.externalAttr & 0x10) !== 0).length;
      const nonDirEntryCount = cd.size - dirEntryCount;
      expect(totalEntries).toBe(nonDirEntryCount + obj.posts.length + 1);
    });

    test('ファイル取得に失敗しても fileCount を基準にせず、実際に書かれたエントリ数でエントリ数の整合式が成り立つ', async () => {
      const obj = createValidObj();
      const mock = new MockWritableStream();
      const handle = {
        async createWritable() {
          return mock as unknown as FileSystemWritableFileStream;
        },
      };
      let call = 0;
      const fetchFile = async () => {
        call++;
        // post1 の唯一のファイル (1 回目の呼び出し) だけ失敗させる
        return call === 1 ? null : new Blob([new Uint8Array([1])]);
      };
      await helper.downloadZip(
        obj,
        () => {},
        () => {},
        () => {},
        {
          handle: handle as unknown as FileSystemFileHandle,
          fetchFile,
        },
      );
      const buf = mock.toBuffer();
      const eocdOffset = buf.length - 22;
      const totalEntries = readUint16(buf, eocdOffset + 10);
      const cd = parseCentralDirectory(buf);
      const dirEntryCount = Array.from(cd.values()).filter((v) => (v.externalAttr & 0x10) !== 0).length;
      const nonDirEntryCount = cd.size - dirEntryCount;
      expect(totalEntries).toBe(nonDirEntryCount + obj.posts.length + 1);
      // 失敗した post1 のファイルはエントリが作られない一方、post2 のファイルは作られる
      expect(cd.has('creator-id/post1/a.png')).toBe(false);
      expect(cd.has('creator-id/post2/b.png')).toBe(true);
    });
  });
});
