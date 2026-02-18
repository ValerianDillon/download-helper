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
});
