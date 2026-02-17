import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { DownloadHelper, type DownloadJsonObj, DownloadUtils, type FileObj, FileObject } from './download-helper';

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
