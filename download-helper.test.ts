// DOS time/date は getHours() 等のローカル時刻で計算するため、テストの再現性確保のため UTC 固定
process.env.TZ = 'UTC';

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import {
  type ArchivePathAllocator,
  type AssetKey,
  assertZipEntryCountWithinLimit,
  assertZipEntrySizeWithinLimit,
  assertZipUint32FieldWithinLimit,
  assetKeyToString,
  clampToZipRange,
  crc32,
  DownloadHelper,
  type DownloadJsonObj,
  DownloadObject,
  DownloadUtils,
  type DownloadZipOptions,
  type DownloadZipResult,
  type FileObj,
  FileObject,
  joinHtmlFragments,
  MAX_ZIP_ENTRY_COUNT,
  MAX_ZIP_UINT32_FIELD_VALUE,
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

/** テスト用の AssetKey ショートハンド */
const imageKey = (assetId: string): AssetKey => ({ kind: 'image', assetId });

// ============================================================
// 2. FileObject tests
// ============================================================
describe('FileObject', () => {
  const utils = new DownloadUtils();

  const createFileObject = (
    name: string,
    url: string,
    extension = '.png',
    key: AssetKey = imageKey('a1'),
  ): FileObject => {
    const fileObj: FileObj = { name, url, extension, key, metadata: {} };
    return new FileObject(fileObj, utils);
  };

  describe('getKey / getMetadata', () => {
    test('登録時の AssetKey がそのまま返る', () => {
      const fo = createFileObject('img', 'https://example.com/img.png', '.png', imageKey('asset-1'));
      expect(fo.getKey()).toEqual({ kind: 'image', assetId: 'asset-1' });
    });

    test('メタデータがそのまま返る', () => {
      const fileObj: FileObj = {
        name: 'f',
        url: 'https://example.com/f.zip',
        extension: '.zip',
        key: { kind: 'file', assetId: 'asset-2' },
        metadata: { size: 42 },
      };
      expect(new FileObject(fileObj, utils).getMetadata()).toEqual({ size: 42 });
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
// 2-b. AssetKey / archive path allocator tests
// ============================================================
describe('assetKeyToString', () => {
  test('cover は sentinel を返す', () => {
    expect(assetKeyToString({ kind: 'cover' })).toBe('cover');
  });

  test('kind を前置するので image と file で同じ assetId でも衝突しない', () => {
    expect(assetKeyToString({ kind: 'image', assetId: 'x' })).toBe('image:x');
    expect(assetKeyToString({ kind: 'file', assetId: 'x' })).toBe('file:x');
  });
});

describe('joinHtmlFragments', () => {
  test('要素の間に区切りを入れる', () => {
    expect(joinHtmlFragments([['a'], ['b']], '-')).toEqual(['a', '-', 'b']);
  });

  test('空の断片列でも区切りは入る (何も描画しない block が区切りごと消えないこと)', () => {
    expect(joinHtmlFragments([['a'], [], ['b']], '-')).toEqual(['a', '-', '-', 'b']);
  });

  test('空配列は空になる', () => {
    expect(joinHtmlFragments([], '-')).toEqual([]);
  });
});

describe('DownloadObject / PostObject の archive path 割り当て', () => {
  const utils = new DownloadUtils();

  /** 投稿を 1 件追加して JSON を得る。allocator を省略すると legacy allocator を使う */
  const build = (
    setup: (downloadObject: DownloadObject) => void,
    allocator?: ArchivePathAllocator,
  ): DownloadJsonObj => {
    const downloadObject = new DownloadObject('creator', utils, allocator);
    setup(downloadObject);
    return JSON.parse(downloadObject.stringify()) as DownloadJsonObj;
  };

  describe('legacy allocator の採番規則', () => {
    test('同名ファイルが 1 件なら添字を付けない', () => {
      const json = build((d) => {
        const post = d.addPost('post');
        post.addFile({ key: imageKey('i1'), name: 'a', extension: 'png', url: 'u1' });
      });
      expect(json.posts[0].files.map((it) => it.encodedName)).toEqual(['a.png']);
    });

    test('同名ファイルが複数なら昇順に _1 / _2 を付ける', () => {
      const json = build((d) => {
        const post = d.addPost('post');
        post.addFile({ key: imageKey('i1'), name: 'a', extension: 'png', url: 'u1' });
        post.addFile({ key: imageKey('i2'), name: 'a', extension: 'png', url: 'u2' });
      });
      expect(json.posts[0].files.map((it) => it.encodedName)).toEqual(['a_1.png', 'a_2.png']);
    });

    test('同名投稿は降順に _2 / _1 を付ける', () => {
      const json = build((d) => {
        d.addPost('same');
        d.addPost('same');
      });
      expect(json.posts.map((it) => it.encodedName)).toEqual(['same_2', 'same_1']);
    });

    test('ファイル名は encodeFileName を通す', () => {
      const json = build((d) => {
        const post = d.addPost('po/st');
        post.addFile({ key: imageKey('i1'), name: 'a/b', extension: 'png', url: 'u1' });
      });
      expect(json.posts[0].encodedName).toBe('po／st');
      expect(json.posts[0].files[0].encodedName).toBe('a／b.png');
    });

    // 従来はカバーだけが情報 JSON では未エンコード、HTML 内の参照ではエンコード済みで、
    // 両者がずれうる入力があった。allocator に集約する際、参照先が実在する側に揃えた
    test('カバーの割り当て名も encodeFileName を通す', () => {
      const json = build((d) => {
        const post = d.addPost('post');
        post.setCover('co/ver', 'jp/g', 'https://example.com/c');
      });
      expect(json.posts[0].cover?.name).toBe('co／ver.jp／g');
    });
  });

  describe('finalize 後の archive path の不変性', () => {
    test('HTML 内の参照と files の encodedName が一致する', () => {
      const json = build((d) => {
        const post = d.addPost('post');
        const a = post.addFile({ key: imageKey('i1'), name: 'a', extension: 'png', url: 'u1' });
        const b = post.addFile({ key: imageKey('i2'), name: 'a', extension: 'png', url: 'u2' });
        post.setHtml([...post.getImageLinkTag(a), ...post.getImageLinkTag(b)]);
      });
      const names = json.posts[0].files.map((it) => it.encodedName);
      expect(names).toEqual(['a_1.png', 'a_2.png']);
      for (const name of names) {
        expect(json.posts[0].htmlText).toContain(`href="./${name}"`);
      }
    });

    test('カバーへの参照も割り当て名に解決する', () => {
      const json = build((d) => {
        const post = d.addPost('post');
        const cover = post.setCover('cover', 'png', 'https://example.com/c.png');
        post.setHtml(post.getImageLinkTag(cover));
      });
      expect(json.posts[0].cover?.name).toBe('cover.png');
      expect(json.posts[0].htmlText).toContain('href="./cover.png"');
    });

    test('stringify を繰り返しても同じ結果になる (割り当てが finalize のたびに変わらない)', () => {
      const downloadObject = new DownloadObject('creator', utils);
      const post = downloadObject.addPost('post');
      const a = post.addFile({ key: imageKey('i1'), name: 'a', extension: 'png', url: 'u1' });
      post.setHtml(post.getImageLinkTag(a));
      expect(downloadObject.stringify()).toBe(downloadObject.stringify());
    });

    test('allocator を差し替えると HTML 内の参照も追随する', () => {
      // 名前にも件数にも依存しない固定名を返す allocator。HTML が採番規則を知らないことの確認
      const positional: ArchivePathAllocator = {
        allocatePostDirectoryNames: (posts) => posts.map((_, index) => `posts${index}`),
        allocateAssetPaths: (post) => ({
          files: post.files.map((file, index) => ({ file, archiveName: `asset${index}.bin` })),
          coverArchiveName: post.cover ? 'coverAsset.bin' : undefined,
        }),
      };
      const json = build((d) => {
        const post = d.addPost('post');
        const a = post.addFile({ key: imageKey('i1'), name: 'a', extension: 'png', url: 'u1' });
        post.setHtml(post.getImageLinkTag(a));
      }, positional);
      expect(json.posts[0].encodedName).toBe('posts0');
      expect(json.posts[0].files[0].encodedName).toBe('asset0.bin');
      expect(json.posts[0].htmlText).toContain('href="./asset0.bin"');
    });

    test('割り当てられていない AssetKey を参照する断片は例外にする', () => {
      const downloadObject = new DownloadObject('creator', utils);
      const post = downloadObject.addPost('post');
      post.setHtml([{ assetRef: imageKey('missing') }]);
      expect(() => downloadObject.stringify()).toThrow('archive path is not allocated: image:missing');
    });
  });

  test('同じ AssetKey を 2 回追加すると例外になる', () => {
    const downloadObject = new DownloadObject('creator', utils);
    const post = downloadObject.addPost('post');
    post.addFile({ key: imageKey('i1'), name: 'a', extension: 'png', url: 'u1' });
    expect(() => post.addFile({ key: imageKey('i1'), name: 'b', extension: 'png', url: 'u2' })).toThrow(
      'asset key is duplicated: image:i1',
    );
  });

  test('postCount / fileCount は投稿とアセットの総数になる', () => {
    const json = build((d) => {
      const p1 = d.addPost('p1');
      p1.addFile({ key: imageKey('i1'), name: 'a', extension: 'png', url: 'u1' });
      p1.setCover('cover', 'png', 'https://example.com/c.png');
      d.addPost('p2');
    });
    expect(json.postCount).toBe(2);
    // fileCount はカバーを含めない (従来の countFile と同じ意味論)
    expect(json.fileCount).toBe(1);
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
    aborted = false;
    abortReason: unknown;

    async write(data: Uint8Array): Promise<void> {
      this.chunks.push(new Uint8Array(data));
    }

    async close(): Promise<void> {
      this.closed = true;
    }

    async abort(reason?: unknown): Promise<void> {
      this.aborted = true;
      this.abortReason = reason;
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

  // ----------------------------------------------------------
  // addFile / addDirectory 自体の入力検証 (Issue #17)
  // downloadZip を経由しない直接呼び出しに対する多層防御。isValidPathSegment を downloadZip 側と共有しているため、
  // 想定するトラバーサルのケースも downloadZip 側の入力検証テスト (下記 6.) と揃えている。
  // ----------------------------------------------------------
  describe('addFile / addDirectory の入力検証 (Issue #17)', () => {
    const maliciousNames: [string, string][] = [
      ['../../../outside.txt', '親ディレクトリへのトラバーサル (複数階層)'],
      ['..\\..\\outside.txt', 'backslash 区切りのトラバーサル'],
      ['C:/outside.txt', 'drive letter'],
      ['a/../b', 'セグメント内に埋め込まれた ".."'],
      ['./x', '先頭セグメントが "."'],
      ['', '空文字列'],
    ];

    for (const [name, description] of maliciousNames) {
      test(`addFile(${JSON.stringify(name)}) (${description}) が例外を投げ、ストリームが abort される`, async () => {
        const mock = new MockWritableStream();
        const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
        await expect(zip.addFile(name, encoder.encode('x'))).rejects.toThrow();
        expect(mock.aborted).toBe(true);
        expect(mock.closed).toBe(false);
      });

      test(`addDirectory(${JSON.stringify(name)}) (${description}) が例外を投げ、ストリームが abort される`, async () => {
        const mock = new MockWritableStream();
        const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
        await expect(zip.addDirectory(name)).rejects.toThrow();
        expect(mock.aborted).toBe(true);
        expect(mock.closed).toBe(false);
      });
    }

    test('addFile 経由の正当な呼び出し (downloadZip と同じ形の複数セグメント名) は引き続き成功する', async () => {
      const mock = new MockWritableStream();
      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      await zip.addFile('creator-id/post1/file.png', encoder.encode('x'));
      await zip.close();
      expect(mock.closed).toBe(true);
      expect(mock.aborted).toBe(false);
    });

    test('addDirectory 経由の正当な呼び出し (downloadZip と同じ形の複数セグメント名、末尾 "/" なし) は引き続き成功する', async () => {
      const mock = new MockWritableStream();
      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      await zip.addDirectory('creator-id/post1');
      await zip.close();
      expect(mock.closed).toBe(true);
      expect(mock.aborted).toBe(false);
    });
  });

  // ----------------------------------------------------------
  // 書き込み中の例外によるストリーム cleanup (Issue #17)
  // File System Access API は close() を呼ぶまで実ファイルへコミットされないため、
  // 途中失敗時は close() ではなく abort() でストリームを破棄する (詳細は ZipWriter.abortOnFailure のコメント参照)
  // ----------------------------------------------------------
  describe('書き込み中の例外によるストリーム cleanup (Issue #17)', () => {
    test('addFile の入力検証エラー (書き込み前) でも writable が abort され、close は呼ばれない', async () => {
      const mock = new MockWritableStream();
      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      await expect(zip.addFile('..', encoder.encode('x'))).rejects.toThrow();
      expect(mock.aborted).toBe(true);
      expect(mock.closed).toBe(false);
    });

    test('addFile 中に writable.write が例外を投げると、その例外で reject され writable が abort される', async () => {
      const mock = new MockWritableStream();
      const writeError = new Error('disk full');
      mock.write = async () => {
        throw writeError;
      };
      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      await expect(zip.addFile('test.txt', encoder.encode('x'))).rejects.toThrow(writeError);
      expect(mock.aborted).toBe(true);
      expect(mock.abortReason).toBe(writeError);
      expect(mock.closed).toBe(false);
    });

    test('close 中の Central Directory 書き込みが例外を投げると、writable が abort される', async () => {
      const mock = new MockWritableStream();
      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      await zip.addFile('test.txt', encoder.encode('x'));

      const writeError = new Error('disk full during close');
      mock.write = async () => {
        throw writeError;
      };
      await expect(zip.close()).rejects.toThrow(writeError);
      expect(mock.aborted).toBe(true);
      expect(mock.closed).toBe(false);
    });

    test('close 中の writable.close 自体が例外を投げても、writable が abort される', async () => {
      const mock = new MockWritableStream();
      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      await zip.addFile('test.txt', encoder.encode('x'));

      const closeError = new Error('close failed');
      mock.close = async () => {
        throw closeError;
      };
      await expect(zip.close()).rejects.toThrow(closeError);
      expect(mock.aborted).toBe(true);
    });

    test('abort 自体が失敗しても元の例外がそのまま伝播する (abort の失敗を握りつぶす)', async () => {
      const mock = new MockWritableStream();
      const writeError = new Error('write failed');
      mock.write = async () => {
        throw writeError;
      };
      mock.abort = async () => {
        throw new Error('abort also failed');
      };
      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      await expect(zip.addFile('test.txt', encoder.encode('x'))).rejects.toThrow(writeError);
    });

    test('失敗が連続しても abort は 1 回だけ呼ばれる (二重 abort しない、2 回目は terminal 状態で即拒否される)', async () => {
      const mock = new MockWritableStream();
      let abortCalls = 0;
      const originalAbort = mock.abort.bind(mock);
      mock.abort = async (reason?: unknown) => {
        abortCalls++;
        await originalAbort(reason);
      };
      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      await expect(zip.addFile('..', encoder.encode('x'))).rejects.toThrow();
      await expect(zip.addFile('.', encoder.encode('x'))).rejects.toThrow();
      expect(abortCalls).toBe(1);
    });
  });

  // ----------------------------------------------------------
  // エントリ名の UTF-8 バイト長検証 (Issue #17 フォローアップ)
  // LFH / CD の file name length フィールドは 16 bit (uint16) のため、65535 bytes を超える名前を
  // そのまま書くと setUint16 が値を切り詰め、後続データの位置がずれた壊れた ZIP になる。境界の両側を検証する。
  // ----------------------------------------------------------
  describe('エントリ名の UTF-8 バイト長検証 (Issue #17 フォローアップ)', () => {
    test('addFile: ちょうど 65535 bytes の名前は通る', async () => {
      const mock = new MockWritableStream();
      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      const name = 'a'.repeat(0xffff);
      await zip.addFile(name, encoder.encode('x'));
      await zip.close();
      expect(mock.closed).toBe(true);
    });

    test('addFile: 65535 + 1 bytes の名前は拒否され、ストリームが abort される', async () => {
      const mock = new MockWritableStream();
      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      const name = 'a'.repeat(0xffff + 1);
      await expect(zip.addFile(name, encoder.encode('x'))).rejects.toThrow();
      expect(mock.aborted).toBe(true);
      expect(mock.closed).toBe(false);
    });

    test('addDirectory: 付与される末尾 "/" を含めてちょうど 65535 bytes の名前は通る', async () => {
      const mock = new MockWritableStream();
      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      // addDirectory が末尾に "/" (1 byte) を付与するため、name 自体は 65534 bytes にする
      const name = 'a'.repeat(0xffff - 1);
      await zip.addDirectory(name);
      await zip.close();
      expect(mock.closed).toBe(true);
    });

    test('addDirectory: 付与される末尾 "/" を含めて 65535 + 1 bytes の名前は拒否され、ストリームが abort される', async () => {
      const mock = new MockWritableStream();
      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      // "/" (1 byte) を足すとちょうど 65536 bytes になる
      const name = 'a'.repeat(0xffff);
      await expect(zip.addDirectory(name)).rejects.toThrow();
      expect(mock.aborted).toBe(true);
      expect(mock.closed).toBe(false);
    });
  });

  // ----------------------------------------------------------
  // ZIP64 非対応の上限検知 (Issue #15)
  // ZipWriter は ZIP64 を実装しておらず、classic ZIP の固定長フィールド (uint16 のエントリ数、
  // uint32 のサイズ/オフセット) に直接値を書く。上限に達すると `0xFFFF` / `0xFFFFFFFF` の
  // ZIP64 sentinel 値と衝突するか、フィールド自体が折り返って壊れた ZIP になる
  // (ZIP64 の実装ではなく上限超過の検知と失敗という対処方針。Issue #15 の対処案 1)。
  //
  // エントリ数境界 (65534 件) を実際に addFile を 65534 回呼んで検証すると実行時間がかさむため、
  // 上限判定ロジック (assertZipEntryCountWithinLimit / assertZipEntrySizeWithinLimit /
  // assertZipUint32FieldWithinLimit) を ZipWriter から独立させ、まずプレーンな数値で境界の両側を
  // 直接ユニットテストする。加えて、ZipWriter の private フィールド (entries / offset) に
  // 直接値を注入したうえで実際の addFile / addDirectory / close を呼ぶ統合テストで、拒否時に
  // 既存の cleanup (abort、terminal 状態) が正しく働くこと、および書き込み前 (chunks が空のまま) に
  // 検知できていることを確認する。単一エントリのサイズ上限 (0xFFFFFFFF bytes) は実バッファ確保が
  // 非現実的なため、ユニットテストのみで境界を確認し、addFile 経由の統合テストは行わない。
  // ----------------------------------------------------------
  describe('ZIP64 非対応の上限検知 (Issue #15)', () => {
    describe('境界判定ロジックの直接ユニットテスト', () => {
      test('MAX_ZIP_ENTRY_COUNT は 65534', () => {
        expect(MAX_ZIP_ENTRY_COUNT).toBe(65534);
      });

      test('MAX_ZIP_UINT32_FIELD_VALUE は 0xFFFFFFFF', () => {
        expect(MAX_ZIP_UINT32_FIELD_VALUE).toBe(0xffffffff);
      });

      test('assertZipEntryCountWithinLimit: 上限未満 (65533 件) は通過する', () => {
        expect(() => assertZipEntryCountWithinLimit(MAX_ZIP_ENTRY_COUNT - 1, 'addFile')).not.toThrow();
      });

      test('assertZipEntryCountWithinLimit: 上限ちょうど (65534 件) は拒否される', () => {
        expect(() => assertZipEntryCountWithinLimit(MAX_ZIP_ENTRY_COUNT, 'addFile')).toThrow();
      });

      test('assertZipEntrySizeWithinLimit: 上限未満 (0xFFFFFFFE bytes) は通過する', () => {
        expect(() => assertZipEntrySizeWithinLimit(MAX_ZIP_UINT32_FIELD_VALUE - 1, 'big.bin', 'addFile')).not.toThrow();
      });

      test('assertZipEntrySizeWithinLimit: 上限ちょうど (0xFFFFFFFF bytes) は拒否される', () => {
        expect(() => assertZipEntrySizeWithinLimit(MAX_ZIP_UINT32_FIELD_VALUE, 'huge.bin', 'addFile')).toThrow();
      });

      test('assertZipUint32FieldWithinLimit: 上限未満 (0xFFFFFFFE) は通過する', () => {
        expect(() => assertZipUint32FieldWithinLimit(MAX_ZIP_UINT32_FIELD_VALUE - 1, 'test')).not.toThrow();
      });

      test('assertZipUint32FieldWithinLimit: 上限ちょうど (0xFFFFFFFF) は拒否される', () => {
        expect(() => assertZipUint32FieldWithinLimit(MAX_ZIP_UINT32_FIELD_VALUE, 'test')).toThrow();
      });
    });

    /**
     * ZipWriter の private フィールド (entries / offset) に直接値を注入するための最小限の型。
     * 65534 件の addFile 呼び出しや 4 GiB 近いオフセットを実際の書き込みで再現するのは実行時間・
     * メモリの両面で非現実的なため、境界直前の状態を直接作って「1 回の呼び出しで境界を跨ぐ」
     * ケースだけを検証する。
     */
    type ZipWriterLimitInternals = {
      entries: {
        name: Uint8Array;
        crc: number;
        size: number;
        offset: number;
        dosTime: number;
        dosDate: number;
        extraCd: Uint8Array;
        externalAttr: number;
      }[];
      offset: number;
    };

    describe('addFile / addDirectory: エントリ数の境界 (private entries への直接注入)', () => {
      test('addFile: entries が 65533 件のとき、65534 件目 (上限ちょうど) の追加は成功する', async () => {
        const mock = new MockWritableStream();
        const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
        const internals = zip as unknown as ZipWriterLimitInternals;
        for (let i = 0; i < MAX_ZIP_ENTRY_COUNT - 1; i++) {
          internals.entries.push({
            name: encoder.encode(`f${i}`),
            crc: 0,
            size: 0,
            offset: 0,
            dosTime: 0,
            dosDate: 0,
            extraCd: new Uint8Array(0),
            externalAttr: 0,
          });
        }
        expect(internals.entries.length).toBe(MAX_ZIP_ENTRY_COUNT - 1);

        await zip.addFile('ok.txt', encoder.encode('x'));

        expect(internals.entries.length).toBe(MAX_ZIP_ENTRY_COUNT);
        expect(mock.aborted).toBe(false);
      });

      test('addFile: entries が 65534 件に達している状態で 65535 件目を追加すると拒否され、書き込み前にストリームが abort される', async () => {
        const mock = new MockWritableStream();
        const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
        const internals = zip as unknown as ZipWriterLimitInternals;
        for (let i = 0; i < MAX_ZIP_ENTRY_COUNT; i++) {
          internals.entries.push({
            name: encoder.encode(`f${i}`),
            crc: 0,
            size: 0,
            offset: 0,
            dosTime: 0,
            dosDate: 0,
            extraCd: new Uint8Array(0),
            externalAttr: 0,
          });
        }

        await expect(zip.addFile('one-too-many.txt', encoder.encode('x'))).rejects.toThrow();
        expect(mock.aborted).toBe(true);
        expect(mock.closed).toBe(false);
        expect(mock.chunks.length).toBe(0);
      });

      test('addDirectory: entries が 65534 件に達している状態で 65535 件目を追加すると拒否され、書き込み前にストリームが abort される', async () => {
        const mock = new MockWritableStream();
        const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
        const internals = zip as unknown as ZipWriterLimitInternals;
        for (let i = 0; i < MAX_ZIP_ENTRY_COUNT; i++) {
          internals.entries.push({
            name: encoder.encode(`d${i}/`),
            crc: 0,
            size: 0,
            offset: 0,
            dosTime: 0,
            dosDate: 0,
            extraCd: new Uint8Array(0),
            externalAttr: 0x10,
          });
        }

        await expect(zip.addDirectory('one-too-many')).rejects.toThrow();
        expect(mock.aborted).toBe(true);
        expect(mock.closed).toBe(false);
        expect(mock.chunks.length).toBe(0);
      });
    });

    describe('addFile / addDirectory: local header offset の境界 (private offset への直接注入)', () => {
      test('addFile: this.offset が上限未満 (0xFFFFFFFE) なら成功する', async () => {
        const mock = new MockWritableStream();
        const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
        const internals = zip as unknown as ZipWriterLimitInternals;
        internals.offset = MAX_ZIP_UINT32_FIELD_VALUE - 1;

        await zip.addFile('ok.txt', encoder.encode('x'));

        expect(mock.aborted).toBe(false);
      });

      test('addFile: this.offset が上限ちょうど (0xFFFFFFFF) だと拒否され、書き込み前にストリームが abort される', async () => {
        const mock = new MockWritableStream();
        const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
        const internals = zip as unknown as ZipWriterLimitInternals;
        internals.offset = MAX_ZIP_UINT32_FIELD_VALUE;

        await expect(zip.addFile('too-far.txt', encoder.encode('x'))).rejects.toThrow();
        expect(mock.aborted).toBe(true);
        expect(mock.closed).toBe(false);
        expect(mock.chunks.length).toBe(0);
      });

      test('addDirectory: this.offset が上限ちょうど (0xFFFFFFFF) だと拒否され、書き込み前にストリームが abort される', async () => {
        const mock = new MockWritableStream();
        const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
        const internals = zip as unknown as ZipWriterLimitInternals;
        internals.offset = MAX_ZIP_UINT32_FIELD_VALUE;

        await expect(zip.addDirectory('too-far')).rejects.toThrow();
        expect(mock.aborted).toBe(true);
        expect(mock.closed).toBe(false);
        expect(mock.chunks.length).toBe(0);
      });
    });

    describe('close: central directory の offset / size の境界 (private entries / offset への直接注入)', () => {
      test('close: cdOffset (= this.offset) が上限未満 (0xFFFFFFFE) で、エントリなしなら正常に完了する', async () => {
        const mock = new MockWritableStream();
        const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
        const internals = zip as unknown as ZipWriterLimitInternals;
        internals.offset = MAX_ZIP_UINT32_FIELD_VALUE - 1;

        await zip.close();

        expect(mock.closed).toBe(true);
        expect(mock.aborted).toBe(false);
      });

      test('close: cdOffset (= this.offset) が上限ちょうど (0xFFFFFFFF) だと、CD を書く前に拒否されストリームが abort される', async () => {
        const mock = new MockWritableStream();
        const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
        const internals = zip as unknown as ZipWriterLimitInternals;
        internals.offset = MAX_ZIP_UINT32_FIELD_VALUE;

        await expect(zip.close()).rejects.toThrow();
        expect(mock.aborted).toBe(true);
        expect(mock.closed).toBe(false);
        // CD/EOCD どころか 1 バイトも書かれていない (書き込み前に検知している証拠)
        expect(mock.chunks.length).toBe(0);
      });

      test('close: cdSize (central directory 全体サイズ) が上限に達していると、CD を書く前に拒否される (実メモリは確保しない)', async () => {
        const mock = new MockWritableStream();
        const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
        const internals = zip as unknown as ZipWriterLimitInternals;
        // .length だけを持つダミーオブジェクトで、実際に 4 GiB 近いバッファを確保せず巨大な cdSize を模す
        internals.entries.push({
          name: { length: MAX_ZIP_UINT32_FIELD_VALUE } as unknown as Uint8Array,
          crc: 0,
          size: 0,
          offset: 0,
          dosTime: 0,
          dosDate: 0,
          extraCd: { length: 0 } as unknown as Uint8Array,
          externalAttr: 0,
        });

        await expect(zip.close()).rejects.toThrow();
        expect(mock.aborted).toBe(true);
        expect(mock.closed).toBe(false);
        // CD の書き込みループに入る前に拒否されている (entry.name の書き込みに進んでいたら壊れた挙動になる)
        expect(mock.chunks.length).toBe(0);
      });
    });
  });

  // ----------------------------------------------------------
  // addFile の末尾 "/" 拒否 (Issue #17 フォローアップ)
  // assertValidZipEntryName が末尾 "/" を無条件に取り除くと、addFile("dir/", data) のように
  // 名前上はディレクトリなのにデータ本体を持ち directory attribute を持たない矛盾したエントリができてしまう。
  // ----------------------------------------------------------
  describe('addFile の末尾 "/" 拒否 (Issue #17 フォローアップ)', () => {
    test('addFile("dir/") が例外を投げ、ストリームが abort される', async () => {
      const mock = new MockWritableStream();
      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      await expect(zip.addFile('dir/', encoder.encode('x'))).rejects.toThrow();
      expect(mock.aborted).toBe(true);
      expect(mock.closed).toBe(false);
    });

    test('addFile("a/b/") (複数セグメントの末尾 "/") も例外を投げる', async () => {
      const mock = new MockWritableStream();
      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      await expect(zip.addFile('a/b/', encoder.encode('x'))).rejects.toThrow();
    });
  });

  // ----------------------------------------------------------
  // 失敗後は使用不能になる (terminal 状態、Issue #17 フォローアップ)
  // aborted フラグが単に abort の重複防止にしか使われておらず、失敗後の addFile / addDirectory / close の
  // 呼び出しを禁止していなかった問題の修正。特に abort() 自体が失敗するケースで、
  // まだ生きているストリームへの書き込みや close() が通り部分的な ZIP がコミットされうる問題を防ぐ。
  // ----------------------------------------------------------
  describe('失敗後は使用不能になる (Issue #17 フォローアップ)', () => {
    test('addFile が失敗した後、addFile の再呼び出しが拒否される', async () => {
      const mock = new MockWritableStream();
      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      await expect(zip.addFile('..', encoder.encode('x'))).rejects.toThrow();
      await expect(zip.addFile('valid.txt', encoder.encode('x'))).rejects.toThrow();
    });

    test('addFile が失敗した後、addDirectory の呼び出しが拒否される', async () => {
      const mock = new MockWritableStream();
      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      await expect(zip.addFile('..', encoder.encode('x'))).rejects.toThrow();
      await expect(zip.addDirectory('valid')).rejects.toThrow();
    });

    test('addFile が失敗した後、close の呼び出しが拒否され、writable.close は呼ばれない', async () => {
      const mock = new MockWritableStream();
      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      await expect(zip.addFile('..', encoder.encode('x'))).rejects.toThrow();
      await expect(zip.close()).rejects.toThrow();
      expect(mock.closed).toBe(false);
    });

    test('abort() 自体が失敗した後でも、以後の addFile / close は拒否され続ける', async () => {
      const mock = new MockWritableStream();
      mock.abort = async () => {
        throw new Error('abort also failed');
      };
      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      await expect(zip.addFile('..', encoder.encode('x'))).rejects.toThrow();

      // abort() が失敗しても、その後の addFile / close がまだ生きているストリームに書き込んで
      // 成功してしまってはならない
      await expect(zip.addFile('valid.txt', encoder.encode('x'))).rejects.toThrow();
      await expect(zip.close()).rejects.toThrow();
      expect(mock.closed).toBe(false);
    });

    test('close が失敗した後、close の再呼び出しも拒否される', async () => {
      const mock = new MockWritableStream();
      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      await zip.addFile('test.txt', encoder.encode('x'));
      const closeError = new Error('close failed');
      mock.close = async () => {
        throw closeError;
      };
      await expect(zip.close()).rejects.toThrow(closeError);
      await expect(zip.close()).rejects.toThrow();
    });
  });

  // ----------------------------------------------------------
  // close 後は使用不能になる (terminal 状態、Issue #17 フォローアップ)
  // close() 成功後も writer が使用可能なままだと (addFile が通ってしまうと)、File System Access API 上
  // 既に確定したストリームに対する書き込みを試みることになる。close 成功後は 'closed' 状態にし、
  // 以後の呼び出しを拒否する。close 済みは「失敗」ではないため abort は呼ばない。
  // ----------------------------------------------------------
  describe('close 後は使用不能になる (Issue #17 フォローアップ)', () => {
    test('close 成功後、addFile の呼び出しが拒否される', async () => {
      const mock = new MockWritableStream();
      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      await zip.addFile('a.txt', encoder.encode('x'));
      await zip.close();
      await expect(zip.addFile('b.txt', encoder.encode('y'))).rejects.toThrow();
    });

    test('close 成功後、addDirectory の呼び出しが拒否される', async () => {
      const mock = new MockWritableStream();
      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      await zip.close();
      await expect(zip.addDirectory('dir')).rejects.toThrow();
    });

    test('close 成功後、close の再呼び出しが拒否される', async () => {
      const mock = new MockWritableStream();
      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      await zip.close();
      await expect(zip.close()).rejects.toThrow();
    });

    test('close 成功後に他の呼び出しが拒否されても、既に成功した close() の結果は変わらず abort もされない', async () => {
      const mock = new MockWritableStream();
      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      await zip.close();
      await expect(zip.addFile('b.txt', encoder.encode('y'))).rejects.toThrow();
      expect(mock.closed).toBe(true);
      expect(mock.aborted).toBe(false);
    });
  });

  // ----------------------------------------------------------
  // 公開 abort() (Issue #17 フォローアップ)
  // downloadZip 側など、ZipWriter の外側で発生した例外に対してストリームを破棄するための入口。
  // ----------------------------------------------------------
  describe('公開 abort() (Issue #17 フォローアップ)', () => {
    test('open 状態で abort() を呼ぶと writable が abort され、以後の呼び出しが拒否される', async () => {
      const mock = new MockWritableStream();
      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      const reason = new Error('外部エラー');
      await zip.abort(reason);
      expect(mock.aborted).toBe(true);
      expect(mock.abortReason).toBe(reason);
      await expect(zip.addFile('a.txt', encoder.encode('x'))).rejects.toThrow();
    });

    test('close 成功後に abort() を呼んでも no-op (writable.abort は呼ばれない)', async () => {
      const mock = new MockWritableStream();
      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      await zip.close();
      await zip.abort(new Error('後から呼ばれた abort'));
      expect(mock.aborted).toBe(false);
    });

    test('addFile 自体の失敗で既に abort 済み (failed) の場合、abort() を呼んでも二重に abort されない', async () => {
      const mock = new MockWritableStream();
      let abortCalls = 0;
      const originalAbort = mock.abort.bind(mock);
      mock.abort = async (reason?: unknown) => {
        abortCalls++;
        await originalAbort(reason);
      };
      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      await expect(zip.addFile('..', encoder.encode('x'))).rejects.toThrow();
      expect(abortCalls).toBe(1);

      // downloadZip の catch から呼ばれるのと同じ状況を模す: ZipWriter 内で既に abort 済みの例外が
      // 外側の catch に伝播し、そこから zip.abort(e) が呼ばれても二重 abort にならない
      await zip.abort(new Error('外側で catch された例外'));
      expect(abortCalls).toBe(1);
    });
  });

  // ----------------------------------------------------------
  // 公開 abort() と in-flight 操作の競合 (Issue #17 フォローアップ)
  // 公開 abort() は inFlight を考慮しないため、addFile / addDirectory / close の I/O 待ち中にも呼べる。
  // abort() 経由の writable.abort() が、進行中メソッドが待っている write() を reject させると、
  // 進行中メソッド自身の catch も abortOnFailure を呼ぶ。abortOnFailure が state を見ずに
  // writable.abort() を呼んでいると、この 2 系統から writable.abort() が二重に呼ばれてしまう。
  // ----------------------------------------------------------
  describe('公開 abort() と in-flight 操作の競合 (Issue #17 フォローアップ)', () => {
    test('addFile の write() 待ち中に abort() を呼んでも writable.abort() は 1 回しか呼ばれず、進行中の addFile は reject される', async () => {
      const mock = new MockWritableStream();
      let abortCalls = 0;
      let rejectPendingWrite: ((reason: unknown) => void) | undefined;
      const originalAbort = mock.abort.bind(mock);

      // 最初の write() を、mock.abort が呼ばれるまで pending にする。
      // 実ブラウザの FileSystemWritableFileStream は abort されると保留中の write() を reject するため、
      // それを模している。
      mock.write = () =>
        new Promise<void>((_resolve, reject) => {
          rejectPendingWrite = reject;
        });
      mock.abort = async (reason?: unknown) => {
        abortCalls++;
        await originalAbort(reason);
        rejectPendingWrite?.(reason ?? new Error('aborted'));
      };

      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      const addFilePromise = zip.addFile('a.txt', encoder.encode('x')); // await しない (write() で pending になる)

      const abortReason = new Error('外部からの abort');
      await zip.abort(abortReason);

      await expect(addFilePromise).rejects.toThrow();
      expect(abortCalls).toBe(1);
      expect(mock.aborted).toBe(true);

      // 以後の操作は拒否される
      await expect(zip.addFile('b.txt', encoder.encode('y'))).rejects.toThrow();
    });

    test('addDirectory の write() 待ち中に abort() を呼んでも writable.abort() は 1 回しか呼ばれない', async () => {
      const mock = new MockWritableStream();
      let abortCalls = 0;
      let rejectPendingWrite: ((reason: unknown) => void) | undefined;
      const originalAbort = mock.abort.bind(mock);

      mock.write = () =>
        new Promise<void>((_resolve, reject) => {
          rejectPendingWrite = reject;
        });
      mock.abort = async (reason?: unknown) => {
        abortCalls++;
        await originalAbort(reason);
        rejectPendingWrite?.(reason ?? new Error('aborted'));
      };

      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      const addDirectoryPromise = zip.addDirectory('dir');

      await zip.abort(new Error('外部からの abort'));

      await expect(addDirectoryPromise).rejects.toThrow();
      expect(abortCalls).toBe(1);
    });

    test('close() 実行中に abort() を呼ぶと拒否され、close は正常に完走して writable.abort() は呼ばれない', async () => {
      const mock = new MockWritableStream();
      let abortCalls = 0;
      let releaseClose: (() => void) | undefined;
      const closeGate = new Promise<void>((resolve) => {
        releaseClose = resolve;
      });
      const originalClose = mock.close.bind(mock);

      // writable.close() を、明示的に解放するまで pending にする。Streams 仕様上、in-flight の close は
      // abort で中断されないため、この間の abort() は拒否されなければならない。
      mock.close = async () => {
        await closeGate;
        await originalClose();
      };
      mock.abort = async () => {
        abortCalls++;
      };

      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      await zip.addFile('a.txt', encoder.encode('x'));

      const closePromise = zip.close(); // await しない (writable.close() が pending になる)

      // close 実行中 (inFlight === 'close') の abort() は拒否される。
      // ここで abort が「成功」してしまうと、close が後で完走してファイルがコミットされたときに
      // 「破棄できたはず」という嘘になる。
      await expect(zip.abort(new Error('外部からの abort'))).rejects.toThrow();

      releaseClose?.();
      await closePromise;

      expect(mock.closed).toBe(true);
      expect(abortCalls).toBe(0);

      // close 成功後は 'closed' として terminal 状態を維持する (state が 'failed' に化けていない)
      await expect(zip.addFile('b.txt', encoder.encode('y'))).rejects.toThrow();
    });

    // Streams 仕様は abort() が保留中の write() を必ず reject することを保証しない。
    // write() 自体が正常に resolve してしまうケースでも、addFile / addDirectory が abort 後に
    // 「書けた」まま成功として resolve してはならない。
    //
    // 以下の 2 テストは write() 内部の post-await state チェック (Issue #17 フォローアップ) を、
    // entries.push() 直前の assertStillOpen とは切り離して検証する。もし最後の write を pending にして
    // abort すると、write() 内チェックを外しても assertStillOpen (entries.push 直前) が同じ state 変化を
    // 検出してしまい reject 自体は起きるため、reject の有無だけでは write() 内チェックの有無を区別できない
    // (実際に確認済み: write() 内チェックだけを外しても、この作り方のテストは通ってしまう)。
    // そこで 1 回目の write (header) を pending にして abort し、write() 内チェックが機能していれば
    // 「1 回目の write が resolve した直後に例外が投げられ、2 回目以降の write() には一切進まない」ことを
    // writeCallCount で検証する。write() 内チェックが無ければ (assertStillOpen だけが残っていれば)、
    // abort 後も write #2 (・#3) まで進んでから reject される。
    //
    // abort() は「対象の write が実際に mock.write に到達し、pending になった後」まで待ってから呼ぶ必要が
    // ある。addFilePromise を await せずに zip.abort(...) を先に await してしまうと、addFile 側の
    // await チェーンがどこまで進んでいるかの保証がなく、対象の write にまだ到達していない状態で abort()
    // の完了を待つことになりうる。その場合 resolve 用コールバックはまだ未代入 (undefined) で
    // `resolve?.()` が no-op になり、対象の write が永遠に pending のまま addFilePromise が settle せず、
    // テストが hang する。そのため、mock.write が対象の呼び出しに到達したことを示す reached を待ってから
    // abort する。
    test('addFile: 1 回目の write() 実行中に abort() を呼び、write 自体は正常 resolve しても以降の write() には進まず reject される (write() 内チェック)', async () => {
      const mock = new MockWritableStream();
      let abortCalls = 0;
      let writeCallCount = 0;
      let resolveFirstWrite: (() => void) | undefined;
      let notifyFirstWriteReached: (() => void) | undefined;
      const firstWriteReached = new Promise<void>((resolve) => {
        notifyFirstWriteReached = resolve;
      });
      const originalWrite = mock.write.bind(mock);
      const originalAbort = mock.abort.bind(mock);

      mock.write = async (data: Uint8Array) => {
        writeCallCount++;
        if (writeCallCount === 1) {
          // 1 回目の write (Local File Header) に到達したことを知らせてから、明示的に解放するまで
          // pending にする
          notifyFirstWriteReached?.();
          await new Promise<void>((resolve) => {
            resolveFirstWrite = resolve;
          });
        }
        await originalWrite(data);
      };
      mock.abort = async (reason?: unknown) => {
        abortCalls++;
        await originalAbort(reason);
        // ここでは意図的に保留中の write() を reject させない (write が abort で必ず reject するとは
        // 限らないケースの再現)
      };

      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      const addFilePromise = zip.addFile('a.txt', encoder.encode('x')); // await しない (1 回目の write() で pending)

      // 1 回目の write が実際に pending になるまで待ってから abort する
      await firstWriteReached;
      await zip.abort(new Error('外部からの abort'));

      // write() 自体は (abort による reject ではなく) 正常に resolve させる。これにより write() 内部の
      // `await this.writable.write(data)` の直後にある state チェックが発火することを検証する。
      resolveFirstWrite?.();

      await expect(addFilePromise).rejects.toThrow();
      // write() 内チェックが機能していれば、1 回目の write の直後に例外が投げられ、
      // 2 回目以降 (name / data) の write() には一切進まない
      expect(writeCallCount).toBe(1);
      expect(abortCalls).toBe(1); // addFile 自身の catch が二重に abort していない
    });

    test('addDirectory: 1 回目の write() 実行中に abort() を呼び、write 自体は正常 resolve しても以降の write() には進まず reject される (write() 内チェック)', async () => {
      const mock = new MockWritableStream();
      let abortCalls = 0;
      let writeCallCount = 0;
      let resolveFirstWrite: (() => void) | undefined;
      let notifyFirstWriteReached: (() => void) | undefined;
      const firstWriteReached = new Promise<void>((resolve) => {
        notifyFirstWriteReached = resolve;
      });
      const originalWrite = mock.write.bind(mock);
      const originalAbort = mock.abort.bind(mock);

      mock.write = async (data: Uint8Array) => {
        writeCallCount++;
        if (writeCallCount === 1) {
          notifyFirstWriteReached?.();
          await new Promise<void>((resolve) => {
            resolveFirstWrite = resolve;
          });
        }
        await originalWrite(data);
      };
      mock.abort = async (reason?: unknown) => {
        abortCalls++;
        await originalAbort(reason);
      };

      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      const addDirectoryPromise = zip.addDirectory('dir'); // await しない (1 回目の write() で pending)

      await firstWriteReached;
      await zip.abort(new Error('外部からの abort'));

      resolveFirstWrite?.();

      await expect(addDirectoryPromise).rejects.toThrow();
      // 1 回目の write (header) の直後に例外が投げられ、2 回目 (name) の write() には進まない
      expect(writeCallCount).toBe(1);
      expect(abortCalls).toBe(1);
    });

    /**
     * ZipWriter.assertStillOpen (private) にアクセスするための最小限の型。
     * entries.push() 直前のガードは「最後の write() の resolve から push までの間に abort が割り込む」
     * という 1 tick 未満の窓を防ぐものであり、real timer / real promise だけでその窓に正確に abort を
     * 差し込む決定的なテストを組むのは非実用的 (write() 自身の post-await チェックが同じ state 変化を
     * 先に検出してしまい、この窓だけを独立に再現できない)。そのため、ガード自体の入出力をユニットレベルで
     * 直接検証する (state が 'open' でなければ確実に例外を投げること)。
     */
    type ZipWriterInternals = {
      state: 'open' | 'closed' | 'failed';
      assertStillOpen: (method: 'addFile' | 'addDirectory') => void;
    };

    test('assertStillOpen: state が "open" なら通過し、"open" でなければ例外を投げる (entries.push 直前ガードの単体検証)', () => {
      const mock = new MockWritableStream();
      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream) as unknown as ZipWriterInternals;

      // ガードが無いと通ってしまう入力: state が 'open' のときは通過する (誤検知しないことの確認)
      expect(() => zip.assertStillOpen('addFile')).not.toThrow();
      expect(() => zip.assertStillOpen('addDirectory')).not.toThrow();

      // ガードが無いと通ってしまう入力: state が abort によって 'failed' に遷移した後は拒否する
      zip.state = 'failed';
      expect(() => zip.assertStillOpen('addFile')).toThrow();
      expect(() => zip.assertStillOpen('addDirectory')).toThrow();
    });
  });

  // ----------------------------------------------------------
  // 並行呼び出しの検出 (Issue #17 フォローアップ)
  // このクラスは直列に await して使うことを契約とする。前の呼び出しの完了を待たずに次を呼ぶのは誤用であり、
  // 暗黙に直列化してキューイングするのではなく、即座に例外にして誤用を顕在化させる。
  // async 関数は最初の await まで同期的に実行されるため、beginOperation をメソッド先頭で呼べば、
  // 呼び出し元が返り値を await していなくても「実行中かどうか」を同期的に検出できる。
  // ----------------------------------------------------------
  describe('並行呼び出しの検出 (Issue #17 フォローアップ)', () => {
    /**
     * mock.write の 1 回目の呼び出しだけを、明示的に解放するまで pending にする。
     * 「addFile が実際に I/O 待ちをしている最中に別の呼び出しが来る」状況を作るためのヘルパー。
     */
    function gateFirstWrite(mock: MockWritableStream): () => void {
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let callCount = 0;
      const originalWrite = mock.write.bind(mock);
      mock.write = async (data: Uint8Array) => {
        callCount++;
        if (callCount === 1) await gate;
        await originalWrite(data);
      };
      // biome-ignore lint/style/noNonNullAssertion: Promise executor 内で必ず代入される
      return () => release!();
    }

    test('addFile の書き込み待ち中に別の addFile を呼ぶと即座に拒否され、最初の呼び出しは正常に完了する', async () => {
      const mock = new MockWritableStream();
      const releaseFirstWrite = gateFirstWrite(mock);
      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);

      const firstCall = zip.addFile('a.txt', encoder.encode('x')); // await しない

      // 最初の addFile の write がまだ pending のうちに 2 回目を呼ぶ
      await expect(zip.addFile('b.txt', encoder.encode('y'))).rejects.toThrow();

      releaseFirstWrite();
      await firstCall;
      expect(mock.aborted).toBe(false);
    });

    test('addFile の実行中に close を呼ぶと即座に拒否され、最初の addFile は正常に完了する', async () => {
      const mock = new MockWritableStream();
      const releaseFirstWrite = gateFirstWrite(mock);
      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);

      const firstCall = zip.addFile('a.txt', encoder.encode('x'));

      await expect(zip.close()).rejects.toThrow();

      releaseFirstWrite();
      await firstCall;
      expect(mock.aborted).toBe(false);
    });

    test('addFile の実行中に別の addDirectory を呼ぶと即座に拒否される', async () => {
      const mock = new MockWritableStream();
      const releaseFirstWrite = gateFirstWrite(mock);
      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);

      const firstCall = zip.addFile('a.txt', encoder.encode('x'));

      await expect(zip.addDirectory('dir')).rejects.toThrow();

      releaseFirstWrite();
      await firstCall;
    });
  });

  // ----------------------------------------------------------
  // Windows 互換の末尾空白・ピリオド正規化と制御文字の拒否 (Issue #17 フォローアップ)
  // Win32 系の展開実装はファイル名末尾の空白・ピリオドを取り除いてから解釈するため、
  // 取り除いた結果が空 / "." / ".." になるセグメントは、完全一致の "." / ".." チェックだけでは検出できない。
  // ----------------------------------------------------------
  describe('Windows 互換の末尾空白・ピリオド正規化と制御文字の拒否 (Issue #17 フォローアップ)', () => {
    const normalizesToTraversal: [string, string][] = [
      ['.. ', '末尾空白付き ".. " は Win32 展開実装で ".." と同等に扱われうる'],
      ['...', '全体がピリオドのみの "..." は末尾のピリオドを取り除くと空になる'],
      ['. .', '空白とピリオドが混在する ". ." も取り除くと空になる'],
      ['   ', '空白のみのセグメントも取り除くと空になる'],
    ];

    for (const [name, description] of normalizesToTraversal) {
      test(`addFile(${JSON.stringify(name)}) (${description}) が例外を投げる`, async () => {
        const mock = new MockWritableStream();
        const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
        await expect(zip.addFile(name, encoder.encode('x'))).rejects.toThrow();
      });
    }

    test('タブ (制御文字) を含むセグメントは拒否される', async () => {
      const mock = new MockWritableStream();
      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      const name = `..${String.fromCharCode(9)}`; // ".." + タブ
      await expect(zip.addFile(name, encoder.encode('x'))).rejects.toThrow();
    });

    test('NUL (制御文字) を含むセグメントは拒否される', async () => {
      const mock = new MockWritableStream();
      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      const name = `a${String.fromCharCode(0)}b`;
      await expect(zip.addFile(name, encoder.encode('x'))).rejects.toThrow();
    });

    test('DEL (0x7F, 制御文字) を含むセグメントは拒否される', async () => {
      const mock = new MockWritableStream();
      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      const name = `a${String.fromCharCode(127)}b`;
      await expect(zip.addFile(name, encoder.encode('x'))).rejects.toThrow();
    });

    test('末尾の空白・ピリオドはそれ単体では拒否しない (トラバーサルではなく互換性の問題のため。例: "a. ")', async () => {
      const mock = new MockWritableStream();
      const zip = new ZipWriter(mock as unknown as FileSystemWritableFileStream);
      await zip.addFile('a. ', encoder.encode('x'));
      await zip.close();
      expect(mock.closed).toBe(true);
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
    aborted = false;
    abortReason: unknown;

    async write(data: Uint8Array): Promise<void> {
      this.chunks.push(new Uint8Array(data));
    }

    async close(): Promise<void> {
      this.closed = true;
    }

    async abort(reason?: unknown): Promise<void> {
      this.aborted = true;
      this.abortReason = reason;
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

  type CdEntry = { name: string; externalAttr: number; dosTime: number; dosDate: number; localHeaderOffset: number };

  /**
   * central directory の走査結果。
   * entries は central directory に格納された順 (= addFile/addDirectory の呼び出し順) の実エントリ列で、
   * 同名エントリが複数あってもそのまま残る。byName はそこから作った名前引きの Map で、
   * 同名エントリがあれば後勝ちで 1 件に潰れる (存在確認・フィールド参照用の利便のため用意しているだけで、
   * 「エントリ数」や「重複がないこと」の検証には entries を使うこと)。
   */
  type ParsedCentralDirectory = { entries: CdEntry[]; byName: Map<string, CdEntry> };

  /**
   * central directory を先頭から走査し、エントリ列 (格納順) と名前引き Map を返す
   */
  function parseCentralDirectory(buf: Uint8Array): ParsedCentralDirectory {
    const eocdOffset = buf.length - 22;
    const cdOffset = readUint32(buf, eocdOffset + 16);
    const totalEntries = readUint16(buf, eocdOffset + 10);
    const entries: CdEntry[] = [];
    let pos = cdOffset;
    for (let i = 0; i < totalEntries; i++) {
      const nameLen = readUint16(buf, pos + 28);
      const extraLen = readUint16(buf, pos + 30);
      const commentLen = readUint16(buf, pos + 32);
      const name = new TextDecoder().decode(buf.slice(pos + 46, pos + 46 + nameLen));
      entries.push({
        name,
        externalAttr: readUint32(buf, pos + 38),
        dosTime: readUint16(buf, pos + 12),
        dosDate: readUint16(buf, pos + 14),
        localHeaderOffset: readUint32(buf, pos + 42),
      });
      pos += 46 + nameLen + extraLen + commentLen;
    }
    const byName = new Map<string, CdEntry>();
    for (const entry of entries) {
      byName.set(entry.name, entry);
    }
    return { entries, byName };
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

    // cover.name / file.encodedName にも encodedId / post.encodedName と同じセグメント検証を適用する (Issue #17)。
    // ファイル名は 1 セグメント前提のため "/" を含む名前 (パストラバーサル / drive letter / backslash 区切り) も拒否する。
    const traversalNames = ['../../../outside.txt', '..\\..\\outside.txt', 'C:/outside.txt', 'a/../b', './x'];

    test.each(traversalNames)('post.cover.name が %s → 例外', async (name) => {
      const obj = createValidObj();
      obj.posts[0].cover = { url: 'https://example.com/c.png', name };
      await expectValidationError(obj);
    });

    test.each(traversalNames)('file.encodedName が %s → 例外', async (name) => {
      const obj = createValidObj();
      obj.posts[0].files[0].encodedName = name;
      await expectValidationError(obj);
    });

    // Windows 互換の末尾空白・ピリオド正規化 (Issue #17 フォローアップ)。Win32 系の展開実装は末尾の空白・
    // ピリオドを取り除いてから解釈するため、取り除いた結果が空 / "." / ".." になるセグメントも
    // 完全一致の "." / ".." チェックだけでは検出できず、拒否が必要。
    const winNormalizedNames = ['.. ', '...', '. .', '   '];

    test.each(winNormalizedNames)('post.encodedName が %s (Win32 正規化で "." "..") → 例外', async (name) => {
      const obj = createValidObj();
      obj.posts[0].encodedName = name;
      await expectValidationError(obj);
    });

    test.each(winNormalizedNames)('post.cover.name が %s (Win32 正規化で "." "..") → 例外', async (name) => {
      const obj = createValidObj();
      obj.posts[0].cover = { url: 'https://example.com/c.png', name };
      await expectValidationError(obj);
    });

    test.each(winNormalizedNames)('file.encodedName が %s (Win32 正規化で "." "..") → 例外', async (name) => {
      const obj = createValidObj();
      obj.posts[0].files[0].encodedName = name;
      await expectValidationError(obj);
    });

    test('id が "..." (ピリオドのみ。encodeFileName の trim は空白しか取り除かない) → 例外', async () => {
      await expectValidationError(createValidObj({ id: '...' }));
    });

    test('post.encodedName に制御文字 (タブ) を含む → 例外', async () => {
      const obj = createValidObj();
      obj.posts[0].encodedName = `post${String.fromCharCode(9)}1`;
      await expectValidationError(obj);
    });

    test('file.encodedName に制御文字 (NUL) を含む → 例外', async () => {
      const obj = createValidObj();
      obj.posts[0].files[0].encodedName = `a${String.fromCharCode(0)}b.png`;
      await expectValidationError(obj);
    });
  });

  describe('構造 (ディレクトリエントリの配置と日時)', () => {
    test('投稿ごとにディレクトリエントリがちょうど 1 件書かれ、配下ファイルより前に配置される', async () => {
      const obj = createValidObj();
      const buf = await runDownloadZip(obj);
      const cd = parseCentralDirectory(buf);
      const names = cd.entries.map((e) => e.name);

      for (const post of obj.posts) {
        const dirName = `creator-id/${post.encodedName}/`;
        const dirIdx = names.indexOf(dirName);
        expect(dirIdx).toBeGreaterThanOrEqual(0);
        expect(names.filter((n) => n === dirName).length).toBe(1);

        const childIdx = names.findIndex((n) => n !== dirName && n.startsWith(dirName));
        expect(childIdx).toBeGreaterThan(dirIdx);
      }
    });

    test('ルートディレクトリのエントリがルート index.html より前に配置される', async () => {
      const buf = await runDownloadZip(createValidObj());
      const cd = parseCentralDirectory(buf);
      const names = cd.entries.map((e) => e.name);
      const rootDirIdx = names.indexOf('creator-id/');
      const rootHtmlIdx = names.indexOf('creator-id/index.html');
      expect(rootDirIdx).toBe(0);
      expect(rootHtmlIdx).toBeGreaterThan(rootDirIdx);
    });

    test('ルートディレクトリが書かれ、その日時が有効な publishedDatetime の最大値 (clamp 後) と一致する', async () => {
      const buf = await runDownloadZip(createValidObj());
      const cd = parseCentralDirectory(buf);
      const rootEntry = cd.byName.get('creator-id/');
      expect(rootEntry).toBeDefined();
      // posts の publishedDatetime は 2024-01-01 と 2024-06-15 → 最大値は 2024-06-15
      const expected = toDosTimeDate(clampToZipRange(new Date('2024-06-15T00:00:00Z')));
      expect(rootEntry?.dosTime).toBe(expected.time);
      expect(rootEntry?.dosDate).toBe(expected.dosDate);
    });

    test('ルート index.html の日時がルートディレクトリと同じ rootDate (有効な publishedDatetime の最大値) と一致する', async () => {
      const buf = await runDownloadZip(createValidObj());
      const cd = parseCentralDirectory(buf);
      const rootHtmlEntry = cd.byName.get('creator-id/index.html');
      expect(rootHtmlEntry).toBeDefined();
      // posts の publishedDatetime は 2024-01-01 と 2024-06-15 → 最大値は 2024-06-15
      const expected = toDosTimeDate(clampToZipRange(new Date('2024-06-15T00:00:00Z')));
      expect(rootHtmlEntry?.dosTime).toBe(expected.time);
      expect(rootHtmlEntry?.dosDate).toBe(expected.dosDate);
    });

    test('publishedDatetime が有効 / 未指定 / 不正値の 3 ケースで、投稿ディレクトリの日時が期待どおりになる', async () => {
      const obj = createValidObj();
      obj.posts[0].publishedDatetime = '2024-03-01T00:00:00Z';
      obj.posts[1].publishedDatetime = undefined;
      const buf = await runDownloadZip(obj);
      const cd = parseCentralDirectory(buf);

      const expected = toDosTimeDate(clampToZipRange(new Date('2024-03-01T00:00:00Z')));
      expect(cd.byName.get('creator-id/post1/')?.dosTime).toBe(expected.time);
      expect(cd.byName.get('creator-id/post1/')?.dosDate).toBe(expected.dosDate);
      // 未指定 → date なし (DOS 0)
      expect(cd.byName.get('creator-id/post2/')?.dosTime).toBe(0);
      expect(cd.byName.get('creator-id/post2/')?.dosDate).toBe(0);

      const objInvalid = createValidObj();
      objInvalid.posts[0].publishedDatetime = 'not-a-date';
      const buf2 = await runDownloadZip(objInvalid);
      const cd2 = parseCentralDirectory(buf2);
      // 不正値 → date なし (DOS 0)
      expect(cd2.byName.get('creator-id/post1/')?.dosTime).toBe(0);
      expect(cd2.byName.get('creator-id/post1/')?.dosDate).toBe(0);
    });

    test('全投稿の publishedDatetime が無効な場合、ルートディレクトリが date なしになる', async () => {
      const obj = createValidObj();
      obj.posts[0].publishedDatetime = undefined;
      obj.posts[1].publishedDatetime = 'not-a-date';
      const buf = await runDownloadZip(obj);
      const cd = parseCentralDirectory(buf);
      expect(cd.byName.get('creator-id/')?.dosTime).toBe(0);
      expect(cd.byName.get('creator-id/')?.dosDate).toBe(0);
    });

    test('全投稿の publishedDatetime が無効な場合、ルート index.html も date なしになる (rootDate が undefined)', async () => {
      const obj = createValidObj();
      obj.posts[0].publishedDatetime = undefined;
      obj.posts[1].publishedDatetime = 'not-a-date';
      const buf = await runDownloadZip(obj);
      const cd = parseCentralDirectory(buf);
      expect(cd.byName.get('creator-id/index.html')?.dosTime).toBe(0);
      expect(cd.byName.get('creator-id/index.html')?.dosDate).toBe(0);
    });

    test('EOCD のエントリ数が「実際に書かれた非ディレクトリエントリ数 + posts.length + 1」と一致する', async () => {
      const obj = createValidObj();
      const buf = await runDownloadZip(obj);
      const eocdOffset = buf.length - 22;
      const totalEntries = readUint16(buf, eocdOffset + 10);
      const cd = parseCentralDirectory(buf);
      const dirEntryCount = cd.entries.filter((v) => (v.externalAttr & 0x10) !== 0).length;
      const nonDirEntryCount = cd.entries.length - dirEntryCount;
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
      const dirEntryCount = cd.entries.filter((v) => (v.externalAttr & 0x10) !== 0).length;
      const nonDirEntryCount = cd.entries.length - dirEntryCount;
      expect(totalEntries).toBe(nonDirEntryCount + obj.posts.length + 1);
      // 失敗した post1 のファイルはエントリが作られない一方、post2 のファイルは作られる
      expect(cd.byName.has('creator-id/post1/a.png')).toBe(false);
      expect(cd.byName.has('creator-id/post2/b.png')).toBe(true);
    });
  });

  // ----------------------------------------------------------
  // 処理結果 (Issue #13)
  // 各件数の定義は DownloadZipResult の JSDoc を参照。ここでは加算タイミングをケースごとに確認する。
  // ----------------------------------------------------------
  describe('処理結果 (Issue #13)', () => {
    /**
     * 投稿 2 件、各投稿にカバー 1 件 + 添付 1 件を持つ DownloadJsonObj。
     * カバー / 添付それぞれの成功・失敗・中断を個別に制御しやすいよう、投稿 1 件あたりの
     * カバー・添付を 1 件ずつに絞っている (件数の数え間違いをテスト側で見落としにくくするため)。
     */
    function createObjWithCovers(): DownloadJsonObj {
      return {
        posts: [
          {
            originalName: 'post1',
            encodedName: 'post1',
            informationText: '{}',
            htmlText: '<p>1</p>',
            files: [{ url: 'https://example.com/p1-file.png', originalName: 'file.png', encodedName: 'file.png' }],
            tags: [],
            cover: { url: 'https://example.com/p1-cover.png', name: 'cover.png' },
          },
          {
            originalName: 'post2',
            encodedName: 'post2',
            informationText: '{}',
            htmlText: '<p>2</p>',
            files: [{ url: 'https://example.com/p2-file.png', originalName: 'file.png', encodedName: 'file.png' }],
            tags: [],
            cover: { url: 'https://example.com/p2-cover.png', name: 'cover.png' },
          },
        ],
        id: 'creator-id',
        url: 'https://example.com',
        tags: [],
        fileCount: 2,
        postCount: 2,
      };
    }

    /**
     * handle を注入して downloadZip を実行し、結果を返す (ZIP バイト列は使わないケース向け)
     */
    async function runForResult(
      obj: DownloadJsonObj,
      fetchFile: NonNullable<DownloadZipOptions['fetchFile']>,
      signal?: AbortSignal,
    ): Promise<DownloadZipResult> {
      const mock = new MockWritableStream();
      const handle = {
        async createWritable() {
          return mock as unknown as FileSystemWritableFileStream;
        },
      };
      return helper.downloadZip(
        obj,
        () => {},
        () => {},
        () => {},
        { handle: handle as unknown as FileSystemFileHandle, fetchFile, signal },
      );
    }

    test('全成功時: completedPostCount/totalPostCount が投稿数、writtenFileCount がカバー+添付の成功数、failedFileCount 0、aborted false', async () => {
      const obj = createObjWithCovers();
      const fetchFile = async () => new Blob([new Uint8Array([1])]);
      const result = await runForResult(obj, fetchFile);
      expect(result).toEqual({
        completedPostCount: 2,
        totalPostCount: 2,
        writtenFileCount: 4, // cover x2 + file x2
        failedFileCount: 0,
        aborted: false,
      });
    });

    test('添付ファイル失敗あり: 失敗した添付は writtenFileCount に含めず failedFileCount に数える。投稿自体は完了扱いになる', async () => {
      const obj = createObjWithCovers();
      const fetchFile = async (_url: string, _name: string, context: { kind: 'cover' | 'file' }) =>
        context.kind === 'file' && _url === 'https://example.com/p1-file.png' ? null : new Blob([new Uint8Array([1])]);
      const result = await runForResult(obj, fetchFile);
      expect(result.completedPostCount).toBe(2);
      expect(result.totalPostCount).toBe(2);
      expect(result.writtenFileCount).toBe(3); // cover x2 + file x1 (post2 のみ成功)
      expect(result.failedFileCount).toBe(1);
      expect(result.aborted).toBe(false);
    });

    test('カバー失敗あり: 失敗したカバーは writtenFileCount に含めず failedFileCount に数える。投稿自体は完了扱いになる (カバー画像の最終的な失敗を計上する、fanbox-downloader-extension#18 対応)', async () => {
      const obj = createObjWithCovers();
      const fetchFile = async (url: string) =>
        url === 'https://example.com/p1-cover.png' ? null : new Blob([new Uint8Array([1])]);
      const result = await runForResult(obj, fetchFile);
      expect(result.completedPostCount).toBe(2);
      expect(result.writtenFileCount).toBe(3); // cover x1 (post2) + file x2
      expect(result.failedFileCount).toBe(1);
      expect(result.aborted).toBe(false);
    });

    test('中断時: 打ち切られた投稿は completedPostCount に含めず、aborted は true になる', async () => {
      const obj = createObjWithCovers();
      const controller = new AbortController();
      const fetchFile = async (url: string) => {
        if (url === 'https://example.com/p1-file.png') {
          // post1 のファイル取得完了直後 (post1 完了直後、post2 開始前) に中断する
          controller.abort();
        }
        return new Blob([new Uint8Array([1])]);
      };
      const result = await runForResult(obj, fetchFile, controller.signal);
      expect(result.completedPostCount).toBe(1); // post1 のみ完了、post2 は未着手
      expect(result.totalPostCount).toBe(2);
      expect(result.writtenFileCount).toBe(2); // post1 の cover + file
      expect(result.failedFileCount).toBe(0);
      expect(result.aborted).toBe(true);
    });

    test('中断による fetchFile の null 応答は failedFileCount に数えない', async () => {
      const obj = createObjWithCovers();
      const controller = new AbortController();
      const fetchFile = async (url: string) => {
        if (url === 'https://example.com/p1-file.png') {
          // このファイル自体の取得中に中断される (top-of-loop の signal チェックをすり抜けた後に発生する中断)
          controller.abort();
          return null;
        }
        return new Blob([new Uint8Array([1])]);
      };
      const result = await runForResult(obj, fetchFile, controller.signal);
      expect(result.aborted).toBe(true);
      expect(result.failedFileCount).toBe(0); // 中断由来の null は失敗として数えない
      expect(result.completedPostCount).toBe(0); // post1 はカバーのみ完了、添付未完了のため未完了扱い
      expect(result.writtenFileCount).toBe(1); // post1 の cover のみ
    });

    test('ファイルループ先頭の中断チェックで打ち切られる場合、未着手のファイルは fetchFile が呼ばれない', async () => {
      // 投稿 1 件に添付を 2 件持たせ、1 件目取得後に signal を立てる。
      // 2 件目はループ先頭の signal チェック (fetchFile 呼び出し前) で打ち切られる分岐であり、
      // 「fetchFile が null を返した直後に signal.aborted を見る」分岐 (別テストでカバー済み) とは経路が異なる
      const obj: DownloadJsonObj = {
        posts: [
          {
            originalName: 'post1',
            encodedName: 'post1',
            informationText: '{}',
            htmlText: '<p>1</p>',
            files: [
              { url: 'https://example.com/p1-file1.png', originalName: 'file1.png', encodedName: 'file1.png' },
              { url: 'https://example.com/p1-file2.png', originalName: 'file2.png', encodedName: 'file2.png' },
            ],
            tags: [],
            cover: { url: 'https://example.com/p1-cover.png', name: 'cover.png' },
          },
        ],
        id: 'creator-id',
        url: 'https://example.com',
        tags: [],
        fileCount: 2,
        postCount: 1,
      };
      const controller = new AbortController();
      const calledUrls: string[] = [];
      const fetchFile = async (url: string) => {
        calledUrls.push(url);
        if (url === 'https://example.com/p1-file1.png') {
          // file1 の取得完了直後、file2 のループ先頭チェックより前に中断する
          controller.abort();
        }
        return new Blob([new Uint8Array([1])]);
      };
      const result = await runForResult(obj, fetchFile, controller.signal);
      expect(calledUrls).toEqual(['https://example.com/p1-cover.png', 'https://example.com/p1-file1.png']);
      expect(result.aborted).toBe(true);
      expect(result.completedPostCount).toBe(0); // file2 未着手のため投稿は未完了
      expect(result.totalPostCount).toBe(1);
      expect(result.writtenFileCount).toBe(2); // cover + file1
      expect(result.failedFileCount).toBe(0);
    });

    test('カバー取得が中断により null を返す場合、failedFileCount に数えず投稿は completedPostCount に含めない', async () => {
      const obj = createObjWithCovers();
      const controller = new AbortController();
      const fetchFile = async (url: string) => {
        if (url === 'https://example.com/p1-cover.png') {
          // カバー自体の取得中に中断される (post1 のカバー fetchFile 呼び出し中、top-of-loop チェックはまだ通過済み)
          controller.abort();
          return null;
        }
        return new Blob([new Uint8Array([1])]);
      };
      const result = await runForResult(obj, fetchFile, controller.signal);
      expect(result.aborted).toBe(true);
      expect(result.failedFileCount).toBe(0); // 中断由来の null は失敗として数えない
      expect(result.completedPostCount).toBe(0); // post1 はカバーすら書けていないため未完了
      expect(result.totalPostCount).toBe(2);
      expect(result.writtenFileCount).toBe(0);
    });

    test('全データを書き終えたあと (最終 zip.close() 実行中) に signal.aborted になった場合、aborted は false のまま', async () => {
      const obj = createObjWithCovers();
      const controller = new AbortController();
      // カバー x2 + 添付 x2 = 4 回の fetchFile 呼び出しのうち、最後 (post2 の添付) の直前で abort する。
      // それより前に abort すると、以後の投稿/ファイルループの先頭チェックで中断分岐に入ってしまい、
      // 検証したい「全部書き終わった後に signal が立った」状況を作れないため、最後の呼び出しに限定する
      let callCount = 0;
      const totalCalls = 4;
      const fetchFile = async () => {
        callCount++;
        if (callCount === totalCalls) {
          controller.abort();
        }
        return new Blob([new Uint8Array([1])]);
      };
      const result = await runForResult(obj, fetchFile, controller.signal);
      expect(result.aborted).toBe(false);
      expect(result.completedPostCount).toBe(2);
      expect(result.totalPostCount).toBe(2);
      expect(result.writtenFileCount).toBe(4);
      expect(result.failedFileCount).toBe(0);
    });

    test('fetchFile の第 3 引数 context.kind がカバー/添付それぞれ正しく渡る', async () => {
      const obj = createObjWithCovers();
      const calls: { url: string; kind: 'cover' | 'file' }[] = [];
      const fetchFile = async (url: string, _name: string, context: { kind: 'cover' | 'file' }) => {
        calls.push({ url, kind: context.kind });
        return new Blob([new Uint8Array([1])]);
      };
      await runForResult(obj, fetchFile);
      expect(calls).toEqual([
        { url: 'https://example.com/p1-cover.png', kind: 'cover' },
        { url: 'https://example.com/p1-file.png', kind: 'file' },
        { url: 'https://example.com/p2-cover.png', kind: 'cover' },
        { url: 'https://example.com/p2-file.png', kind: 'file' },
      ]);
    });
  });

  // ----------------------------------------------------------
  // createWritable() 後のコールバック例外に対する cleanup (Issue #17 フォローアップ)
  // fetchFile / log / progress / remainTime は呼び出し側が渡すコールバックであり、ZipWriter の外側で
  // 例外を投げうる。ZipWriter 自身の内部 cleanup (addFile/addDirectory/close の catch) だけではこの経路を
  // カバーできないため、downloadZip 自身が createWritable() 以降を try/catch し、catch で zip.abort() を
  // 呼んで writable を破棄することを確認する。
  // ----------------------------------------------------------
  describe('createWritable() 後のコールバック例外に対する cleanup (Issue #17 フォローアップ)', () => {
    function buildMockHandle(): { mock: MockWritableStream; handle: FileSystemFileHandle } {
      const mock = new MockWritableStream();
      const handle = {
        async createWritable() {
          return mock as unknown as FileSystemWritableFileStream;
        },
      };
      return { mock, handle: handle as unknown as FileSystemFileHandle };
    }

    test('fetchFile が例外を投げると、その例外が伝播し writable が abort され close は呼ばれない', async () => {
      const obj = createValidObj();
      const { mock, handle } = buildMockHandle();
      const fetchError = new Error('network error');
      const fetchFile = async () => {
        throw fetchError;
      };
      await expect(
        helper.downloadZip(
          obj,
          () => {},
          () => {},
          () => {},
          { handle, fetchFile },
        ),
      ).rejects.toThrow(fetchError);
      expect(mock.aborted).toBe(true);
      expect(mock.abortReason).toBe(fetchError);
      expect(mock.closed).toBe(false);
    });

    test('log コールバックが例外を投げると、その例外が伝播し writable が abort され close は呼ばれない', async () => {
      const obj = createValidObj();
      const { mock, handle } = buildMockHandle();
      const logError = new Error('log failed');
      const fetchFile = async () => new Blob([new Uint8Array([1])]);
      const log = () => {
        throw logError;
      };
      await expect(
        helper.downloadZip(
          obj,
          () => {},
          log,
          () => {},
          { handle, fetchFile },
        ),
      ).rejects.toThrow(logError);
      expect(mock.aborted).toBe(true);
      expect(mock.abortReason).toBe(logError);
      expect(mock.closed).toBe(false);
    });

    test('progress コールバックが例外を投げると、その例外が伝播し writable が abort され close は呼ばれない', async () => {
      const obj = createValidObj();
      const { mock, handle } = buildMockHandle();
      const progressError = new Error('progress failed');
      const fetchFile = async () => new Blob([new Uint8Array([1])]);
      const progress = () => {
        throw progressError;
      };
      await expect(
        helper.downloadZip(
          obj,
          progress,
          () => {},
          () => {},
          { handle, fetchFile },
        ),
      ).rejects.toThrow(progressError);
      expect(mock.aborted).toBe(true);
      expect(mock.abortReason).toBe(progressError);
      expect(mock.closed).toBe(false);
    });

    test('remainTime コールバックが例外を投げると、その例外が伝播し writable が abort され close は呼ばれない', async () => {
      const obj = createValidObj();
      const { mock, handle } = buildMockHandle();
      const remainTimeError = new Error('remainTime failed');
      const fetchFile = async () => new Blob([new Uint8Array([1])]);
      const remainTime = () => {
        throw remainTimeError;
      };
      await expect(
        helper.downloadZip(
          obj,
          () => {},
          () => {},
          remainTime,
          { handle, fetchFile },
        ),
      ).rejects.toThrow(remainTimeError);
      expect(mock.aborted).toBe(true);
      expect(mock.closed).toBe(false);
    });
  });
});
