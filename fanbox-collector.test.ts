import { describe, expect, test } from 'bun:test';
import {
  addByPostInfo,
  type Block,
  convertEmbedMap,
  convertFileMap,
  convertImageMap,
  convertUrlEmbedMap,
  DownloadManage,
  type EmbedInfo,
  type FileInfo,
  type ImageInfo,
  type PostInfo,
  type UrlEmbedInfo,
} from './fanbox-collector';

describe('convertImageMap', () => {
  test('blocks 順にソートされる', () => {
    const imageMap: Record<string, ImageInfo> = {
      img1: { originalUrl: 'url1', extension: 'jpg' },
      img2: { originalUrl: 'url2', extension: 'png' },
      img3: { originalUrl: 'url3', extension: 'gif' },
    };
    const blocks: Block[] = [
      { type: 'image', imageId: 'img3' },
      { type: 'image', imageId: 'img1' },
      { type: 'image', imageId: 'img2' },
    ];
    const result = convertImageMap(imageMap, blocks);
    expect(result).toEqual([
      { originalUrl: 'url3', extension: 'gif' },
      { originalUrl: 'url1', extension: 'jpg' },
      { originalUrl: 'url2', extension: 'png' },
    ]);
  });

  test('blocks に存在しないキーは末尾に配置される (H-1 回帰テスト)', () => {
    const imageMap: Record<string, ImageInfo> = {
      img1: { originalUrl: 'url1', extension: 'jpg' },
      imgX: { originalUrl: 'urlX', extension: 'webp' },
      img2: { originalUrl: 'url2', extension: 'png' },
    };
    const blocks: Block[] = [
      { type: 'image', imageId: 'img2' },
      { type: 'image', imageId: 'img1' },
    ];
    const result = convertImageMap(imageMap, blocks);
    expect(result[0]).toEqual({ originalUrl: 'url2', extension: 'png' });
    expect(result[1]).toEqual({ originalUrl: 'url1', extension: 'jpg' });
    expect(result[2]).toEqual({ originalUrl: 'urlX', extension: 'webp' });
  });

  test('空の imageMap → 空配列', () => {
    const result = convertImageMap({}, [{ type: 'image', imageId: 'img1' }]);
    expect(result).toEqual([]);
  });

  test('空の blocks → imageMap のキー順 (全て末尾扱い)', () => {
    const imageMap: Record<string, ImageInfo> = {
      img1: { originalUrl: 'url1', extension: 'jpg' },
      img2: { originalUrl: 'url2', extension: 'png' },
    };
    const result = convertImageMap(imageMap, []);
    expect(result).toHaveLength(2);
  });

  test('blocks に image 以外のブロックが混在 → 無視される', () => {
    const imageMap: Record<string, ImageInfo> = {
      img1: { originalUrl: 'url1', extension: 'jpg' },
    };
    const blocks: Block[] = [
      { type: 'p', text: 'text' },
      { type: 'image', imageId: 'img1' },
      { type: 'file', fileId: 'file1' },
    ];
    const result = convertImageMap(imageMap, blocks);
    expect(result).toEqual([{ originalUrl: 'url1', extension: 'jpg' }]);
  });
});

describe('convertFileMap', () => {
  test('blocks 順にソートされる', () => {
    const fileMap: Record<string, FileInfo> = {
      f1: { url: 'url1', name: 'a', extension: 'txt' },
      f2: { url: 'url2', name: 'b', extension: 'pdf' },
    };
    const blocks: Block[] = [
      { type: 'file', fileId: 'f2' },
      { type: 'file', fileId: 'f1' },
    ];
    const result = convertFileMap(fileMap, blocks);
    expect(result[0].name).toBe('b');
    expect(result[1].name).toBe('a');
  });

  test('blocks に存在しないキーは末尾に配置される (H-1 回帰テスト)', () => {
    const fileMap: Record<string, FileInfo> = {
      f1: { url: 'url1', name: 'a', extension: 'txt' },
      fX: { url: 'urlX', name: 'x', extension: 'bin' },
    };
    const blocks: Block[] = [{ type: 'file', fileId: 'f1' }];
    const result = convertFileMap(fileMap, blocks);
    expect(result[0].name).toBe('a');
    expect(result[1].name).toBe('x');
  });
});

describe('convertEmbedMap', () => {
  test('blocks 順にソートされる', () => {
    const embedMap: Record<string, EmbedInfo> = {
      e1: { id: '1' },
      e2: { id: '2' },
    };
    const blocks: Block[] = [
      { type: 'embed', embedId: 'e2' },
      { type: 'embed', embedId: 'e1' },
    ];
    const result = convertEmbedMap(embedMap, blocks);
    expect(result[0]).toEqual({ id: '2' });
    expect(result[1]).toEqual({ id: '1' });
  });

  test('blocks に存在しないキーは末尾に配置される', () => {
    const embedMap: Record<string, EmbedInfo> = {
      e1: { id: '1' },
      eX: { id: 'X' },
    };
    const blocks: Block[] = [{ type: 'embed', embedId: 'e1' }];
    const result = convertEmbedMap(embedMap, blocks);
    expect(result[0]).toEqual({ id: '1' });
    expect(result[1]).toEqual({ id: 'X' });
  });
});

describe('convertUrlEmbedMap', () => {
  test('blocks 順にソートされる', () => {
    const urlEmbedMap: Record<string, UrlEmbedInfo> = {
      ue1: { id: 'ue1', type: 'default', url: 'http://a', host: 'a.com' },
      ue2: { id: 'ue2', type: 'default', url: 'http://b', host: 'b.com' },
    };
    const blocks: Block[] = [
      { type: 'url_embed', urlEmbedId: 'ue2' },
      { type: 'url_embed', urlEmbedId: 'ue1' },
    ];
    const result = convertUrlEmbedMap(urlEmbedMap, blocks);
    expect(result[0].id).toBe('ue2');
    expect(result[1].id).toBe('ue1');
  });

  test('blocks に存在しないキーは末尾に配置される', () => {
    const urlEmbedMap: Record<string, UrlEmbedInfo> = {
      ue1: { id: 'ue1', type: 'default', url: 'http://a', host: 'a.com' },
      ueX: { id: 'ueX', type: 'default', url: 'http://x', host: 'x.com' },
    };
    const blocks: Block[] = [{ type: 'url_embed', urlEmbedId: 'ue1' }];
    const result = convertUrlEmbedMap(urlEmbedMap, blocks);
    expect(result[0].id).toBe('ue1');
    expect(result[1].id).toBe('ueX');
  });
});

describe('addByPostInfo - publishedDatetime', () => {
  const createManage = () => new DownloadManage('testUser', new Map<number, string>());

  // text タイプは addFile を呼ばず、coverImageUrl: null で header の画像分岐も回避できる最小構成
  const baseTextPost = (publishedDatetime: string): PostInfo => ({
    title: 'タイトル',
    feeRequired: 0,
    id: 'post-1',
    creatorId: 'creator',
    coverImageUrl: null,
    excerpt: '',
    isRestricted: false,
    tags: [],
    publishedDatetime,
    updatedDatetime: '2024-05-02T00:00:00Z',
    likeCount: 0,
    commentCount: 0,
    type: 'text',
    body: { text: 'hello' },
  });

  const firstPost = (m: DownloadManage) => JSON.parse(m.downloadObject.stringify()).posts[0];

  test('publishedDatetime が posts に含まれる', () => {
    const m = createManage();
    addByPostInfo(m, baseTextPost('2024-05-01T12:34:56Z'));
    expect(firstPost(m).publishedDatetime).toBe('2024-05-01T12:34:56Z');
  });

  test('空文字 publishedDatetime → setPublishedDatetime を呼ばず例外なし', () => {
    const m = createManage();
    expect(() => addByPostInfo(m, baseTextPost(''))).not.toThrow();
    expect(firstPost(m).publishedDatetime).toBeUndefined();
  });

  test('未定義 publishedDatetime でも例外なし', () => {
    const m = createManage();
    const bad = { ...baseTextPost('x'), publishedDatetime: undefined } as unknown as PostInfo;
    expect(() => addByPostInfo(m, bad)).not.toThrow();
    expect(firstPost(m).publishedDatetime).toBeUndefined();
  });

  test('非文字列 publishedDatetime でも例外なし', () => {
    const m = createManage();
    const bad = { ...baseTextPost('x'), publishedDatetime: 12345 } as unknown as PostInfo;
    expect(() => addByPostInfo(m, bad)).not.toThrow();
    expect(firstPost(m).publishedDatetime).toBeUndefined();
  });
});

describe('addByPostInfo - 取り込み結果', () => {
  const createManage = () => new DownloadManage('testUser', new Map<number, string>());

  const basePost = (override: Partial<PostInfo> = {}): PostInfo =>
    ({
      title: 'タイトル',
      feeRequired: 0,
      id: 'post-1',
      creatorId: 'creator',
      coverImageUrl: null,
      excerpt: '',
      isRestricted: false,
      tags: [],
      publishedDatetime: '2024-05-01T12:34:56Z',
      updatedDatetime: '2024-05-02T00:00:00Z',
      likeCount: 0,
      commentCount: 0,
      type: 'text',
      body: { text: 'hello' },
      ...override,
    }) as PostInfo;

  const postCount = (m: DownloadManage) => JSON.parse(m.downloadObject.stringify()).posts.length;

  test('取り込めたら added を返す', () => {
    const m = createManage();
    expect(addByPostInfo(m, basePost())).toBe('added');
    expect(postCount(m)).toBe(1);
  });

  test('isIgnoreFree による無料投稿の除外は ignored を返す', () => {
    const m = createManage();
    m.isIgnoreFree = true;
    expect(addByPostInfo(m, basePost({ feeRequired: 0 }))).toBe('ignored');
    expect(postCount(m)).toBe(0);
  });

  test('本文が無ければ unavailable を返す', () => {
    const m = createManage();
    expect(addByPostInfo(m, basePost({ body: undefined } as Partial<PostInfo>))).toBe('unavailable');
    expect(postCount(m)).toBe(0);
  });

  test('閲覧できない投稿は unavailable を返す', () => {
    const m = createManage();
    expect(addByPostInfo(m, basePost({ isRestricted: true }))).toBe('unavailable');
    expect(postCount(m)).toBe(0);
  });

  test('本文の形式が想定と違えば invalid を返し、壊れた投稿を残さない', () => {
    const m = createManage();
    // image タイプなのに images が無い: 従来は登録後に TypeError となり空の投稿が残っていた
    const broken = basePost({ type: 'image', body: { text: 'hello' } } as Partial<PostInfo>);
    expect(addByPostInfo(m, broken)).toBe('invalid');
    expect(postCount(m)).toBe(0);
  });

  test('本文が壊れていても取得件数上限を消費しない', () => {
    const m = createManage();
    m.setLimitAvailable(true);
    m.setLimit(1);
    addByPostInfo(m, basePost({ type: 'file', body: { text: 'hello' } } as Partial<PostInfo>));
    expect(m.isLimitValid()).toBe(true);
  });

  test('未知タイプは本文を触らないので取り込む', () => {
    const m = createManage();
    const unknown = basePost({ type: 'image-v2', body: { whatever: true } } as unknown as Partial<PostInfo>);
    expect(addByPostInfo(m, unknown)).toBe('added');
    expect(postCount(m)).toBe(1);
  });
});

describe('DownloadManage', () => {
  const createManage = () => new DownloadManage('testUser', new Map([[100, '100円プラン']]));

  describe('addFee', () => {
    test('重複排除', () => {
      const m = createManage();
      m.addFee(100);
      m.addFee(100);
      m.addFee(200);
      m.applyTags();
    });

    test('複数の fee を追加', () => {
      const m = createManage();
      m.addFee(0);
      m.addFee(500);
      expect(m.getTagByFee(0)).toBe('無料プラン');
      expect(m.getTagByFee(500)).toBe('500円プラン');
    });
  });

  describe('addTags', () => {
    test('重複排除', () => {
      const m = createManage();
      m.addTags('tag1', 'tag2');
      m.addTags('tag2', 'tag3');
      m.applyTags();
    });

    test('複数タグを一度に追加', () => {
      const m = createManage();
      m.addTags('a', 'b', 'c');
      m.applyTags();
    });
  });

  describe('getTagByFee', () => {
    test('feeMap に存在する fee → マップの値', () => {
      const m = createManage();
      expect(m.getTagByFee(100)).toBe('100円プラン');
    });

    test('feeMap に存在しない正の fee → "N円プラン"', () => {
      const m = createManage();
      expect(m.getTagByFee(500)).toBe('500円プラン');
    });

    test('fee が 0 → "無料プラン"', () => {
      const m = createManage();
      expect(m.getTagByFee(0)).toBe('無料プラン');
    });
  });

  describe('limit', () => {
    test('isLimitAvailable=false → isLimitValid は常に true', () => {
      const m = createManage();
      expect(m.isLimitValid()).toBe(true);
    });

    test('isLimitAvailable=true, limit>0 → isLimitValid は true', () => {
      const m = createManage();
      m.setLimitAvailable(true);
      m.setLimit(3);
      expect(m.isLimitValid()).toBe(true);
    });

    test('decrementLimit → limit 減少', () => {
      const m = createManage();
      m.setLimitAvailable(true);
      m.setLimit(2);
      expect(m.isLimitValid()).toBe(true);
      m.decrementLimit();
      expect(m.isLimitValid()).toBe(true);
      m.decrementLimit();
      expect(m.isLimitValid()).toBe(false);
    });

    test('limit が 0 になったら isLimitValid は false', () => {
      const m = createManage();
      m.setLimitAvailable(true);
      m.setLimit(1);
      m.decrementLimit();
      expect(m.isLimitValid()).toBe(false);
    });
  });

  describe('applyTags', () => {
    test('fees をソートして feeMap のタグ名に変換、残りのタグを追加', () => {
      const m = new DownloadManage(
        'testUser',
        new Map([
          [100, 'ファン'],
          [500, 'サポーター'],
        ]),
      );
      m.addFee(500);
      m.addFee(100);
      m.addTags('タグA', 'タグB');
      m.applyTags();
      const json = JSON.parse(m.downloadObject.stringify());
      // fees は昇順ソート (100, 500) → ["ファン", "サポーター"] + 残りのタグ
      expect(json.tags).toEqual(['ファン', 'サポーター', 'タグA', 'タグB']);
    });
  });
});
