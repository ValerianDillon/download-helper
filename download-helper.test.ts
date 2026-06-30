// DOS time/date は getHours() 等のローカル時刻で計算するため、テストの再現性確保のため UTC 固定
process.env.TZ = 'UTC';

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import {
  crc32,
  DownloadHelper,
  type DownloadJsonObj,
  DownloadUtils,
  type FileObj,
  FileObject,
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
});
