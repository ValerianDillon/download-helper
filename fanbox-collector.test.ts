import { describe, expect, spyOn, test } from 'bun:test';
import type { ArchivePathAllocator, PostObj } from './download-helper';
import {
  addByPostInfo,
  DownloadManage,
  type PaginatedPosts,
  type Plans,
  type PlansResponse,
  type PostInfoCandidate,
  type PostInfoResponse,
  type PostList,
  type PostListItemCandidate,
  type PostListResponse,
  type PostPaginationResponse,
  type Tags,
  type TagsResponse,
} from './fanbox-collector';

const createManage = () => new DownloadManage('testUser', new Map<number, string>());

/**
 * 未検証入力 (post.info の投稿オブジェクト) を組み立てる。
 *
 * PostInfoCandidate が保証するのは id / type / isRestricted の 3 つだけなので、
 * それ以外のフィールドは「API から来たかもしれない任意の値」として渡す。
 * addByPostInfo はこの入口で decode するため、壊れた値もここから渡して検証できる。
 */
const candidate = (override: Record<string, unknown> = {}): PostInfoCandidate =>
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
  }) as unknown as PostInfoCandidate;

const parsed = (m: DownloadManage) => JSON.parse(m.downloadObject.stringify());
const firstPost = (m: DownloadManage) => parsed(m).posts[0];
const postCount = (m: DownloadManage) => parsed(m).posts.length;

/** article 本文を組み立てる。省略したマップは空になる */
const articleBody = (override: Record<string, unknown> = {}) => ({
  blocks: [],
  imageMap: {},
  fileMap: {},
  embedMap: {},
  urlEmbedMap: {},
  ...override,
});

describe('addByPostInfo - 分類の順序', () => {
  test('取り込めたら { status: "added" } を返す', () => {
    const m = createManage();
    expect(addByPostInfo(m, candidate())).toEqual({ status: 'added' });
    expect(postCount(m)).toBe(1);
  });

  test('postInfo が無ければ unavailable / missing-body を返す (isRestricted が分からないため)', () => {
    const m = createManage();
    expect(addByPostInfo(m, undefined)).toEqual({ status: 'unavailable', reason: 'missing-body' });
    expect(postCount(m)).toBe(0);
  });

  test('feeRequired が number でなければ invalid を返す (無料除外の判断と支援額タグが壊れるため)', () => {
    const m = createManage();
    const result = addByPostInfo(m, candidate({ feeRequired: '0' }));
    expect(result).toEqual({ status: 'invalid', postId: 'post-1', type: 'text', missing: ['feeRequired'] });
    expect(postCount(m)).toBe(0);
  });

  test('isIgnoreFree による無料投稿の除外は { status: "ignored" } を返す', () => {
    const m = createManage();
    m.isIgnoreFree = true;
    expect(addByPostInfo(m, candidate({ feeRequired: 0 }))).toEqual({ status: 'ignored' });
    expect(postCount(m)).toBe(0);
  });

  test('無料除外は本文の decode より先に効く (除外対象の破損で収集全体を止めない)', () => {
    // invalid は収集全体を中断させるので、利用者が除外を指定した投稿の破損で全体を止めない
    const m = createManage();
    m.isIgnoreFree = true;
    expect(addByPostInfo(m, candidate({ feeRequired: 0, body: {} }))).toEqual({ status: 'ignored' });
  });

  test('無料除外は未知タイプ・閲覧不可より先に効く', () => {
    const m = createManage();
    m.isIgnoreFree = true;
    expect(addByPostInfo(m, candidate({ feeRequired: 0, type: 'image-v2' }))).toEqual({ status: 'ignored' });
    expect(addByPostInfo(m, candidate({ feeRequired: 0, isRestricted: true }))).toEqual({ status: 'ignored' });
  });

  test('閲覧できない投稿は unavailable / restricted を返す (本文があっても isRestricted を優先する)', () => {
    const m = createManage();
    const result = addByPostInfo(m, candidate({ isRestricted: true }));
    expect(result).toEqual({ status: 'unavailable', reason: 'restricted' });
    expect(postCount(m)).toBe(0);
  });

  test('isRestricted かつ本文が null の場合も restricted を返す (missing-body に落ちない)', () => {
    const m = createManage();
    const result = addByPostInfo(m, candidate({ isRestricted: true, body: null }));
    expect(result).toEqual({ status: 'unavailable', reason: 'restricted' });
  });

  test('未知タイプは unsupported を返し、本文を触らず登録もしない', () => {
    const m = createManage();
    const result = addByPostInfo(m, candidate({ type: 'image-v2', body: { whatever: true } }));
    expect(result).toEqual({ status: 'unsupported', postId: 'post-1', type: 'image-v2' });
    expect(postCount(m)).toBe(0);
  });

  test('未知タイプは本文欠落より先に分類する (型名の情報を失わないため)', () => {
    // 後に判定すると missing-body に丸められ、「未知のタイプだった」ことが報告に残らない
    const m = createManage();
    const result = addByPostInfo(m, candidate({ type: 'image-v2', body: null }));
    expect(result).toEqual({ status: 'unsupported', postId: 'post-1', type: 'image-v2' });
  });

  test('本文が null なら unavailable / missing-body を返す', () => {
    const m = createManage();
    expect(addByPostInfo(m, candidate({ body: null }))).toEqual({ status: 'unavailable', reason: 'missing-body' });
    expect(postCount(m)).toBe(0);
  });

  test('本文が undefined なら unavailable / missing-body を返す', () => {
    const m = createManage();
    expect(addByPostInfo(m, candidate({ body: undefined }))).toEqual({
      status: 'unavailable',
      reason: 'missing-body',
    });
  });

  test('本文が空文字なら invalid を返す (欠落ではなく形式の不一致)', () => {
    const m = createManage();
    const result = addByPostInfo(m, candidate({ body: '' }));
    expect(result).toMatchObject({ status: 'invalid', postId: 'post-1', type: 'text' });
  });

  test('複数の分類条件が重なっても順序どおりに分類する', () => {
    const m = createManage();
    // feeRequired の検査が最優先 (無料除外の判断そのものが成り立たないため)
    expect(addByPostInfo(m, candidate({ feeRequired: '0', isRestricted: true, type: 'image-v2', body: null }))).toEqual(
      { status: 'invalid', postId: 'post-1', type: 'image-v2', missing: ['feeRequired'] },
    );
    // restricted は未知タイプより先 (本文が無いことの正常系の説明を優先する)
    expect(addByPostInfo(m, candidate({ isRestricted: true, type: 'image-v2' }))).toEqual({
      status: 'unavailable',
      reason: 'restricted',
    });
  });

  test('未知タイプは取得件数上限を消費しない', () => {
    const m = createManage();
    m.setLimitAvailable(true);
    m.setLimit(1);
    addByPostInfo(m, candidate({ type: 'image-v2', body: { whatever: true } }));
    expect(m.isLimitValid()).toBe(true);
  });
});

describe('addByPostInfo - 本文の検証', () => {
  test('本文の形式が想定と違えば invalid を返し、壊れた投稿を残さない', () => {
    const m = createManage();
    const result = addByPostInfo(m, candidate({ type: 'image', body: { text: 'hello' } }));
    expect(result).toMatchObject({ status: 'invalid', postId: 'post-1', type: 'image' });
    expect((result as { missing: string[] }).missing).toContain('body.images');
    expect(postCount(m)).toBe(0);
  });

  test('invalid の missing は欠けているフィールドを列挙する (text も無い場合)', () => {
    const m = createManage();
    const result = addByPostInfo(m, candidate({ type: 'image', body: {} }));
    expect((result as { missing: string[] }).missing.sort()).toEqual(['body.images', 'body.text']);
  });

  test('images の要素に originalUrl / extension が無ければ invalid を返す', () => {
    const m = createManage();
    const result = addByPostInfo(
      m,
      candidate({
        type: 'image',
        body: { text: 'hello', images: [{ id: 'i1', originalUrl: 'https://example.com/a' }] },
      }),
    );
    expect((result as { missing: string[] }).missing).toContain('body.images');
    expect(postCount(m)).toBe(0);
  });

  test('tags が配列でなければ invalid を返す (スプレッドで例外になるため)', () => {
    const m = createManage();
    const result = addByPostInfo(m, candidate({ tags: undefined }));
    expect((result as { missing: string[] }).missing).toContain('tags');
    expect(postCount(m)).toBe(0);
  });

  test('tags の要素が文字列でなければ invalid を返す (タグ名として描画されるため)', () => {
    const m = createManage();
    const result = addByPostInfo(m, candidate({ tags: ['ok', 123] }));
    expect((result as { missing: string[] }).missing).toContain('tags');
  });

  test('coverImageUrl が truthy な非文字列なら invalid を返す (.split で例外になるため)', () => {
    const m = createManage();
    const result = addByPostInfo(m, candidate({ coverImageUrl: 12345 }));
    expect((result as { missing: string[] }).missing).toContain('coverImageUrl');
    expect(postCount(m)).toBe(0);
  });

  test('coverImageUrl が null / undefined なら許容する (falsy 分岐で split を呼ばないため)', () => {
    const m = createManage();
    expect(addByPostInfo(m, candidate({ coverImageUrl: null }))).toEqual({ status: 'added' });
    expect(addByPostInfo(createManage(), candidate({ coverImageUrl: undefined }))).toEqual({ status: 'added' });
  });

  test('title が非文字列なら invalid を返す (encodeFileName / escapeHtml で例外になるため)', () => {
    const m = createManage();
    const result = addByPostInfo(m, candidate({ title: 123 }));
    expect((result as { missing: string[] }).missing).toContain('title');
    expect(postCount(m)).toBe(0);
  });

  test('article タイプは blocks / imageMap / fileMap / embedMap / urlEmbedMap を個別に検査する', () => {
    const m = createManage();
    const result = addByPostInfo(m, candidate({ type: 'article', body: {} }));
    expect((result as { missing: string[] }).missing.sort()).toEqual([
      'body.blocks',
      'body.embedMap',
      'body.fileMap',
      'body.imageMap',
      'body.urlEmbedMap',
    ]);
  });

  test('article の p ブロックに text が無ければ invalid を返す (escapeHtml が非文字列で例外になるため)', () => {
    const m = createManage();
    const result = addByPostInfo(m, candidate({ type: 'article', body: articleBody({ blocks: [{ type: 'p' }] }) }));
    expect((result as { missing: string[] }).missing).toContain('body.blocks');
  });

  test('urlEmbedMap の要素が null なら invalid を返す (type を読めないため)', () => {
    const m = createManage();
    const result = addByPostInfo(m, candidate({ type: 'article', body: articleBody({ urlEmbedMap: { ue1: null } }) }));
    expect((result as { missing: string[] }).missing).toContain('body.urlEmbedMap');
  });

  test('urlEmbedMap の html 要素で html が null なら invalid を返す (String.prototype.match が無く例外になるため)', () => {
    const m = createManage();
    const result = addByPostInfo(
      m,
      candidate({
        type: 'article',
        body: articleBody({ urlEmbedMap: { ue1: { id: 'ue1', type: 'html', html: null } } }),
      }),
    );
    expect((result as { missing: string[] }).missing).toContain('body.urlEmbedMap');
  });

  test('urlEmbedMap が正常な既知 type (default) のみなら取り込める', () => {
    const m = createManage();
    const result = addByPostInfo(
      m,
      candidate({
        type: 'article',
        body: articleBody({
          blocks: [{ type: 'url_embed', urlEmbedId: 'ue1' }],
          urlEmbedMap: { ue1: { id: 'ue1', type: 'default', url: 'https://example.com', host: 'example.com' } },
        }),
      }),
    );
    expect(result).toEqual({ status: 'added' });
  });

  test('本文が壊れていても取得件数上限を消費しない', () => {
    const m = createManage();
    m.setLimitAvailable(true);
    m.setLimit(1);
    addByPostInfo(m, candidate({ type: 'file', body: { text: 'hello' } }));
    expect(m.isLimitValid()).toBe(true);
  });

  test('本文外フィールドが壊れていても取得件数上限を消費しない', () => {
    const m = createManage();
    m.setLimitAvailable(true);
    m.setLimit(1);
    addByPostInfo(m, candidate({ tags: undefined }));
    expect(m.isLimitValid()).toBe(true);
  });
});

describe('addByPostInfo - 未知値の正規化', () => {
  test('未知の block type は HTML に何も出さず、元の type 名をログに残す', () => {
    // sentinel へ畳んだせいでログが 'unknown' に劣化しないことまで見る
    const m = createManage();
    const errors: unknown[] = [];
    const spy = spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.join(' '));
    });
    try {
      const result = addByPostInfo(
        m,
        candidate({
          type: 'article',
          body: articleBody({
            blocks: [
              { type: 'video', videoId: 'v1' },
              { type: 'p', text: 'あと' },
            ],
          }),
        }),
      );
      expect(result).toEqual({ status: 'added' });
      expect(errors.some((e) => String(e).includes('video'))).toBe(true);
    } finally {
      spy.mockRestore();
    }
    expect(firstPost(m).htmlText).toContain('あと');
    expect(firstPost(m).htmlText).not.toContain('videoId');
  });

  test('未知の url_embed type は JSON 文字列として描画する (現行出力の維持)', () => {
    const m = createManage();
    const result = addByPostInfo(
      m,
      candidate({
        type: 'article',
        body: articleBody({
          blocks: [{ type: 'url_embed', urlEmbedId: 'ue1' }],
          urlEmbedMap: { ue1: { id: 'ue1', type: 'video', videoId: 'abc' } },
        }),
      }),
    );
    expect(result).toEqual({ status: 'added' });
    // sentinel 全体ではなく元の値だけを JSON 化していることまで固定する
    const expected = DownloadManage.utils.escapeHtml(JSON.stringify({ id: 'ue1', type: 'video', videoId: 'abc' }));
    expect(firstPost(m).htmlText).toContain(`<span>${expected}</span>`);
    expect(firstPost(m).htmlText).not.toContain('originalType');
    expect(firstPost(m).htmlText).not.toContain('rawJson');
  });

  test('シリアライズできない未知 url_embed は登録前に invalid にする', () => {
    // 描画中に JSON.stringify が落ちると、投稿を登録した後で本文生成に失敗し空の投稿が残る
    const circular: Record<string, unknown> = { id: 'ue1', type: 'video' };
    circular.self = circular;
    const m = createManage();
    const result = addByPostInfo(
      m,
      candidate({ type: 'article', body: articleBody({ urlEmbedMap: { ue1: circular } }) }),
    );
    expect((result as { missing: string[] }).missing).toContain('body.urlEmbedMap');
    expect(postCount(m)).toBe(0);
  });

  test('embedMap の値は型を問わず JSON 文字列として描画する', () => {
    const m = createManage();
    const result = addByPostInfo(
      m,
      candidate({
        type: 'article',
        body: articleBody({
          blocks: [{ type: 'embed', embedId: 'e1' }],
          embedMap: { e1: { serviceProvider: 'twitter', contentId: '123' } },
        }),
      }),
    );
    expect(result).toEqual({ status: 'added' });
    const expected = DownloadManage.utils.escapeHtml(JSON.stringify({ serviceProvider: 'twitter', contentId: '123' }));
    expect(firstPost(m).htmlText).toContain(`<span>${expected}</span>`);
    expect(firstPost(m).htmlText).not.toContain('rawJson');
  });

  test('block の *Id が文字列でなければ invalid (以降の block が別の要素を描画してしまうため)', () => {
    // 描画は block の並びで数えた位置でマップの並べ替え結果を消費するので、id が 1 つ読めないと
    // 欠落ではなく取り違えになる (下の 2 件目の block は img2 を指しているのに img1 が出る)
    const m = createManage();
    const result = addByPostInfo(
      m,
      candidate({
        type: 'article',
        body: articleBody({
          blocks: [
            { type: 'image', imageId: 123 },
            { type: 'image', imageId: 'img2' },
          ],
          imageMap: {
            img1: { id: 'img1', originalUrl: 'https://example.com/1', extension: 'jpg' },
            img2: { id: 'img2', originalUrl: 'https://example.com/2', extension: 'jpg' },
          },
        }),
      }),
    );
    expect((result as { missing: string[] }).missing).toContain('body.blocks');
    expect(postCount(m)).toBe(0);
  });

  test('fanbox.post は id / creatorId も必須 (欠けるとリンク先が壊れる)', () => {
    const m = createManage();
    const result = addByPostInfo(
      m,
      candidate({
        type: 'article',
        body: articleBody({
          urlEmbedMap: { ue1: { id: 'ue1', type: 'fanbox.post', postInfo: { title: '別の投稿' } } },
        }),
      }),
    );
    expect((result as { missing: string[] }).missing).toContain('body.urlEmbedMap');
  });

  test('fanbox.post が揃っていれば投稿 URL のリンクを描画する', () => {
    const m = createManage();
    const result = addByPostInfo(
      m,
      candidate({
        type: 'article',
        body: articleBody({
          blocks: [{ type: 'url_embed', urlEmbedId: 'ue1' }],
          urlEmbedMap: {
            ue1: { id: 'ue1', type: 'fanbox.post', postInfo: { title: '別の投稿', id: 'p9', creatorId: 'creator9' } },
          },
        }),
      }),
    );
    expect(result).toEqual({ status: 'added' });
    expect(firstPost(m).htmlText).toContain('https://www.fanbox.cc/@creator9/posts/p9');
  });

  test('マップのキーが "__proto__" でも要素を失わない', () => {
    // 通常の {} に代入するとプロトタイプへの代入になり、own property が作られず要素が消える
    const m = createManage();
    const result = addByPostInfo(
      m,
      candidate({
        type: 'article',
        body: articleBody({
          blocks: [{ type: 'image', imageId: '__proto__' }],
          // オブジェクトリテラルの __proto__ はプロトタイプ指定になり own property にならないので、
          // 実際の入力経路と同じく JSON.parse で作る
          imageMap: JSON.parse(
            '{"__proto__": {"id": "__proto__", "originalUrl": "https://example.com/proto.jpg", "extension": "jpg"}}',
          ),
        }),
      }),
    );
    expect(result).toEqual({ status: 'added' });
    expect(firstPost(m).files.map((f: { url: string }) => f.url)).toEqual(['https://example.com/proto.jpg']);
  });

  test('fanbox.post の title が文字列でなければ invalid (escapeHtml で例外になるため)', () => {
    const m = createManage();
    const result = addByPostInfo(
      m,
      candidate({
        type: 'article',
        body: articleBody({
          urlEmbedMap: { ue1: { id: 'ue1', type: 'fanbox.post', postInfo: { title: 123 } } },
        }),
      }),
    );
    expect((result as { missing: string[] }).missing).toContain('body.urlEmbedMap');
  });
});

describe('addByPostInfo - article の並び順', () => {
  const articlePost = (body: Record<string, unknown>) => candidate({ type: 'article', body: articleBody(body) });

  test('imageMap は blocks の順に並ぶ', () => {
    const m = createManage();
    addByPostInfo(
      m,
      articlePost({
        blocks: [
          { type: 'image', imageId: 'img3' },
          { type: 'image', imageId: 'img1' },
          { type: 'image', imageId: 'img2' },
        ],
        imageMap: {
          img1: { id: 'img1', originalUrl: 'url1', extension: 'jpg' },
          img2: { id: 'img2', originalUrl: 'url2', extension: 'png' },
          img3: { id: 'img3', originalUrl: 'url3', extension: 'gif' },
        },
      }),
    );
    expect(firstPost(m).files.map((f: { url: string }) => f.url)).toEqual(['url3', 'url1', 'url2']);
  });

  test('blocks に存在しない imageMap のキーは末尾に置く', () => {
    const m = createManage();
    addByPostInfo(
      m,
      articlePost({
        blocks: [
          { type: 'image', imageId: 'img2' },
          { type: 'image', imageId: 'img1' },
        ],
        imageMap: {
          img1: { id: 'img1', originalUrl: 'url1', extension: 'jpg' },
          imgX: { id: 'imgX', originalUrl: 'urlX', extension: 'webp' },
          img2: { id: 'img2', originalUrl: 'url2', extension: 'png' },
        },
      }),
    );
    expect(firstPost(m).files.map((f: { url: string }) => f.url)).toEqual(['url2', 'url1', 'urlX']);
  });

  test('image 以外の block は imageMap の並び順に影響しない', () => {
    const m = createManage();
    addByPostInfo(
      m,
      articlePost({
        blocks: [
          { type: 'p', text: 'text' },
          { type: 'image', imageId: 'img1' },
          { type: 'file', fileId: 'file1' },
        ],
        imageMap: { img1: { id: 'img1', originalUrl: 'url1', extension: 'jpg' } },
      }),
    );
    expect(firstPost(m).files.map((f: { url: string }) => f.url)).toEqual(['url1']);
  });

  test('fileMap は blocks の順に並び、存在しないキーは末尾に置く', () => {
    const m = createManage();
    addByPostInfo(
      m,
      articlePost({
        blocks: [
          { type: 'file', fileId: 'f2' },
          { type: 'file', fileId: 'f1' },
        ],
        fileMap: {
          f1: { id: 'f1', url: 'url1', name: 'a', extension: 'txt' },
          fX: { id: 'fX', url: 'urlX', name: 'x', extension: 'bin' },
          f2: { id: 'f2', url: 'url2', name: 'b', extension: 'pdf' },
        },
      }),
    );
    expect(firstPost(m).files.map((f: { originalName: string }) => f.originalName)).toEqual(['b', 'a', 'x']);
  });

  test('embedMap は blocks の順に描画される', () => {
    const m = createManage();
    addByPostInfo(
      m,
      articlePost({
        blocks: [
          { type: 'embed', embedId: 'e2' },
          { type: 'embed', embedId: 'e1' },
        ],
        embedMap: { e1: { id: 'first' }, e2: { id: 'second' } },
      }),
    );
    const html: string = firstPost(m).htmlText;
    expect(html.indexOf('second')).toBeLessThan(html.indexOf('first'));
  });

  test('urlEmbedMap は blocks の順に描画される', () => {
    const m = createManage();
    addByPostInfo(
      m,
      articlePost({
        blocks: [
          { type: 'url_embed', urlEmbedId: 'ue2' },
          { type: 'url_embed', urlEmbedId: 'ue1' },
        ],
        urlEmbedMap: {
          ue1: { id: 'ue1', type: 'default', url: 'https://first.example', host: 'first' },
          ue2: { id: 'ue2', type: 'default', url: 'https://second.example', host: 'second' },
        },
      }),
    );
    const html: string = firstPost(m).htmlText;
    expect(html.indexOf('second')).toBeLessThan(html.indexOf('first'));
  });
});

describe('addByPostInfo - 付随メタデータ', () => {
  test('publishedDatetime が posts に含まれる', () => {
    const m = createManage();
    addByPostInfo(m, candidate({ publishedDatetime: '2024-05-01T12:34:56Z' }));
    expect(firstPost(m).publishedDatetime).toBe('2024-05-01T12:34:56Z');
  });

  test('空文字 publishedDatetime → setPublishedDatetime を呼ばず例外なし', () => {
    const m = createManage();
    expect(() => addByPostInfo(m, candidate({ publishedDatetime: '' }))).not.toThrow();
    expect(firstPost(m).publishedDatetime).toBeUndefined();
  });

  test('未定義 publishedDatetime でも例外なし', () => {
    const m = createManage();
    expect(() => addByPostInfo(m, candidate({ publishedDatetime: undefined }))).not.toThrow();
    expect(firstPost(m).publishedDatetime).toBeUndefined();
  });

  test('非文字列 publishedDatetime でも例外なし', () => {
    const m = createManage();
    expect(() => addByPostInfo(m, candidate({ publishedDatetime: 12345 }))).not.toThrow();
    expect(firstPost(m).publishedDatetime).toBeUndefined();
  });

  test('型が想定と違う付随メタデータは中断理由にせず、情報 JSON にそのまま残す', () => {
    // 収集結果の成立に関与しないフィールドの型変化で収集全体を止めない (invalid は中断を意味する)
    const m = createManage();
    const result = addByPostInfo(m, candidate({ likeCount: '10', creatorId: 42, commentCount: null }));
    expect(result).toEqual({ status: 'added' });
    const info = JSON.parse(firstPost(m).informationText);
    expect(info.likeCount).toBe('10');
    expect(info.creatorId).toBe(42);
    expect(info.commentCount).toBeNull();
  });

  test('シリアライズできない付随メタデータは登録前に invalid にする', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const m = createManage();
    const result = addByPostInfo(m, candidate({ creatorId: circular }));
    expect((result as { missing: string[] }).missing).toContain('metadata');
    expect(postCount(m)).toBe(0);
  });
});

describe('addByPostInfo - 名前が Object.prototype と衝突する入力', () => {
  // DownloadObject.posts / PostObject.files は encodeFileName(name) をキーにした辞書に
  // name/extension を登録する。通常の {} だとキーが "__proto__" / "constructor" のとき
  // 初期化チェック (obj[key] === undefined) が Object.prototype 由来の値を拾って false になり、
  // 直後の obj[key].push(...) が例外になっていた (download-helper.ts の createNameKeyedDictionary で修正済み)。
  // 投稿タイトル・添付ファイル名は FANBOX API のレスポンスに由来する外部入力なのでここを回避できない。
  test('投稿タイトルが "__proto__" でも例外にならず登録できる', () => {
    const m = createManage();
    expect(addByPostInfo(m, candidate({ title: '__proto__' }))).toEqual({ status: 'added' });
    expect(firstPost(m).originalName).toBe('__proto__');
  });

  test('投稿タイトルが "constructor" でも例外にならず登録できる', () => {
    const m = createManage();
    expect(addByPostInfo(m, candidate({ title: 'constructor' }))).toEqual({ status: 'added' });
    expect(firstPost(m).originalName).toBe('constructor');
  });

  test('添付ファイル名が "__proto__" でも例外にならず格納される', () => {
    const m = createManage();
    const post = candidate({
      type: 'file',
      body: {
        text: 'hello',
        files: [{ id: 'f1', name: '__proto__', extension: 'txt', url: 'https://example.com/proto.txt' }],
      },
    });
    expect(addByPostInfo(m, post)).toEqual({ status: 'added' });
    expect(firstPost(m).files).toHaveLength(1);
    expect(firstPost(m).files[0].originalName).toBe('__proto__');
    expect(firstPost(m).files[0].url).toBe('https://example.com/proto.txt');
  });

  test('添付ファイル名が "constructor" でも例外にならず格納される', () => {
    const m = createManage();
    const post = candidate({
      type: 'file',
      body: {
        text: 'hello',
        files: [{ id: 'f1', name: 'constructor', extension: 'txt', url: 'https://example.com/ctor.txt' }],
      },
    });
    expect(addByPostInfo(m, post)).toEqual({ status: 'added' });
    expect(firstPost(m).files[0].originalName).toBe('constructor');
  });

  test('同一投稿内に "__proto__" という名前の添付が複数あっても全件蓄積される', () => {
    const m = createManage();
    const post = candidate({
      type: 'file',
      body: {
        text: 'hello',
        files: [
          { id: 'f1', name: '__proto__', extension: 'txt', url: 'https://example.com/1' },
          { id: 'f2', name: '__proto__', extension: 'txt', url: 'https://example.com/2' },
        ],
      },
    });
    expect(addByPostInfo(m, post)).toEqual({ status: 'added' });
    expect(firstPost(m).files).toHaveLength(2);
  });
});

describe('addByPostInfo - アセットの id 検証', () => {
  test('images の要素に id が無ければ invalid (id を identity に使うため)', () => {
    const m = createManage();
    const result = addByPostInfo(
      m,
      candidate({
        type: 'image',
        body: { text: 'hello', images: [{ originalUrl: 'https://example.com/a', extension: 'jpg' }] },
      }),
    );
    expect((result as { missing: string[] }).missing).toContain('body.images');
    expect(postCount(m)).toBe(0);
  });

  test('files の要素に id が無ければ invalid', () => {
    const m = createManage();
    const result = addByPostInfo(
      m,
      candidate({
        type: 'file',
        body: { text: 'hello', files: [{ name: 'a', extension: 'txt', url: 'https://example.com/a' }] },
      }),
    );
    expect((result as { missing: string[] }).missing).toContain('body.files');
    expect(postCount(m)).toBe(0);
  });

  test('imageMap のキーと値の id が一致しなければ invalid (別のアセットを同一視しうるため)', () => {
    const m = createManage();
    const result = addByPostInfo(
      m,
      candidate({
        type: 'article',
        body: articleBody({ imageMap: { img1: { id: 'img2', originalUrl: 'url1', extension: 'jpg' } } }),
      }),
    );
    expect((result as { missing: string[] }).missing).toContain('body.imageMap');
    expect(postCount(m)).toBe(0);
  });

  test('fileMap のキーと値の id が一致しなければ invalid', () => {
    const m = createManage();
    const result = addByPostInfo(
      m,
      candidate({
        type: 'article',
        body: articleBody({ fileMap: { f1: { id: 'f2', url: 'url1', name: 'a', extension: 'txt' } } }),
      }),
    );
    expect((result as { missing: string[] }).missing).toContain('body.fileMap');
    expect(postCount(m)).toBe(0);
  });

  test('images 内で id が重複していれば invalid (AssetKey が投稿内で一意でなくなるため)', () => {
    const m = createManage();
    const result = addByPostInfo(
      m,
      candidate({
        type: 'image',
        body: {
          text: 'hello',
          images: [
            { id: 'i1', originalUrl: 'url1', extension: 'jpg' },
            { id: 'i1', originalUrl: 'url2', extension: 'jpg' },
          ],
        },
      }),
    );
    expect((result as { missing: string[] }).missing).toContain('body.images[1].id');
    expect(postCount(m)).toBe(0);
  });

  test('files 内で id が重複していれば invalid', () => {
    const m = createManage();
    const result = addByPostInfo(
      m,
      candidate({
        type: 'file',
        body: {
          text: 'hello',
          files: [
            { id: 'f1', name: 'a', extension: 'txt', url: 'url1' },
            { id: 'f1', name: 'b', extension: 'txt', url: 'url2' },
          ],
        },
      }),
    );
    expect((result as { missing: string[] }).missing).toContain('body.files[1].id');
    expect(postCount(m)).toBe(0);
  });
});

describe('addByPostInfo - 内部表現に保持する情報', () => {
  /**
   * allocator は PostObj をそのまま受け取るので、割り当ての過程で内部表現を観測できる。
   * metadata / postType は DownloadJsonObj に出さない (出力を変えない) ため、ここで確認する
   */
  const captureManage = () => {
    const captured: PostObj[] = [];
    const allocator: ArchivePathAllocator = {
      allocatePostDirectoryNames: (posts) => posts.map((_, index) => `post${index}`),
      allocateAssetPaths: (post) => {
        captured.push(post);
        return {
          files: post.files.map((file, index) => ({ file, archiveName: `asset${index}.bin` })),
          coverArchiveName: post.cover ? 'cover.bin' : undefined,
        };
      },
    };
    const m = new DownloadManage('testUser', new Map<number, string>(), allocator);
    return {
      m,
      posts: () => {
        // 割り当ては stringify (finalize) のときに行われる
        m.downloadObject.stringify();
        return captured;
      },
    };
  };

  test('AssetKey は kind と asset の id からできる', () => {
    const { m, posts } = captureManage();
    addByPostInfo(
      m,
      candidate({
        type: 'article',
        coverImageUrl: 'https://example.com/cover.jpg',
        body: articleBody({
          imageMap: { img1: { id: 'img1', originalUrl: 'url1', extension: 'jpg' } },
          fileMap: { f1: { id: 'f1', url: 'url2', name: 'a', extension: 'txt' } },
        }),
      }),
    );
    const post = posts()[0];
    expect(post.files.map((it) => it.key)).toEqual([
      { kind: 'image', assetId: 'img1' },
      { kind: 'file', assetId: 'f1' },
    ]);
    expect(post.cover?.key).toEqual({ kind: 'cover' });
  });

  test('投稿タイプを保持する', () => {
    const { m, posts } = captureManage();
    addByPostInfo(m, candidate({ type: 'text', body: { text: 'hello' } }));
    expect(posts()[0].postType).toBe('text');
  });

  test('画像は width / height を、添付は size を保持する', () => {
    const { m, posts } = captureManage();
    addByPostInfo(
      m,
      candidate({
        type: 'article',
        body: articleBody({
          imageMap: { img1: { id: 'img1', originalUrl: 'url1', extension: 'jpg', width: 100, height: 200 } },
          fileMap: { f1: { id: 'f1', url: 'url2', name: 'a', extension: 'txt', size: 4096 } },
        }),
      }),
    );
    expect(posts()[0].files.map((it) => it.metadata)).toEqual([{ width: 100, height: 200 }, { size: 4096 }]);
  });

  test.each([
    ['欠落', undefined],
    ['文字列', '4096'],
    ['負数', -1],
    ['小数', 1.5],
    ['安全な整数の範囲外', Number.MAX_SAFE_INTEGER + 2],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('size が %s なら欠落として扱い、投稿は取り込む', (_label, size) => {
    const { m, posts } = captureManage();
    const result = addByPostInfo(
      m,
      candidate({
        type: 'file',
        body: { text: 'hello', files: [{ id: 'f1', name: 'a', extension: 'txt', url: 'url1', size }] },
      }),
    );
    // 収集が読まない付随メタデータなので、型が違っても invalid にはしない
    expect(result).toEqual({ status: 'added' });
    expect(posts()[0].files[0].metadata).toEqual({ size: undefined });
  });

  test.each([
    ['0', 0],
    ['安全な整数の上限', Number.MAX_SAFE_INTEGER],
  ])('size が %s なら有効な値として保持する (境界)', (_label, size) => {
    const { m, posts } = captureManage();
    addByPostInfo(
      m,
      candidate({
        type: 'file',
        body: { text: 'hello', files: [{ id: 'f1', name: 'a', extension: 'txt', url: 'url1', size }] },
      }),
    );
    expect(posts()[0].files[0].metadata).toEqual({ size });
  });

  test('width / height も size と同じ規則で落とす', () => {
    const { m, posts } = captureManage();
    addByPostInfo(
      m,
      candidate({
        type: 'image',
        body: { text: '', images: [{ id: 'i1', originalUrl: 'url1', extension: 'jpg', width: -1, height: '2' }] },
      }),
    );
    expect(posts()[0].files[0].metadata).toEqual({ width: undefined, height: undefined });
  });
});

describe('addByPostInfo - HTML とファイルパスの整合', () => {
  /** htmlText 内の href="./..." を列挙する */
  const hrefsOf = (htmlText: string): string[] => [...htmlText.matchAll(/href="\.\/([^"]*)"/g)].map((it) => it[1]);

  test('同名アセットが複数あっても HTML の参照は割り当て名と一致する', () => {
    const m = createManage();
    addByPostInfo(
      m,
      candidate({
        title: 'post',
        type: 'image',
        coverImageUrl: 'https://example.com/cover.png',
        body: {
          text: '',
          images: [
            { id: 'i1', originalUrl: 'url1', extension: 'png' },
            { id: 'i2', originalUrl: 'url2', extension: 'png' },
          ],
        },
      }),
    );
    const post = firstPost(m);
    expect(post.files.map((f: { encodedName: string }) => f.encodedName)).toEqual(['post_1.png', 'post_2.png']);
    expect(post.cover.name).toBe('cover.png');
    expect(hrefsOf(post.htmlText)).toEqual(['cover.png', 'post_1.png', 'post_2.png']);
  });

  // 従来の出力をそのまま固定する (legacy allocator の互換テスト)
  test('cover + 同名画像 2 件の htmlText が従来と同じである', () => {
    const m = createManage();
    addByPostInfo(
      m,
      candidate({
        title: 'post',
        type: 'image',
        coverImageUrl: 'https://example.com/cover.png',
        body: {
          text: 'body',
          images: [
            { id: 'i1', originalUrl: 'url1', extension: 'png' },
            { id: 'i2', originalUrl: 'url2', extension: 'png' },
          ],
        },
      }),
    );
    expect(firstPost(m).htmlText).toBe(
      '<a class="hl" href="./cover.png" download="cover.png"><div class="post card">\n' +
        '<img class="card-img-top" src="./cover.png" alt="cover"/>\n</div></a><h5>post</h5>\n' +
        '<a class="hl" href="./post_1.png" download="post.png"><div class="post card">\n' +
        '<img class="card-img-top" src="./post_1.png" alt="post"/>\n</div></a><br>\n' +
        '<a class="hl" href="./post_2.png" download="post.png"><div class="post card">\n' +
        '<img class="card-img-top" src="./post_2.png" alt="post"/>\n</div></a><br>\n<span>body</span>',
    );
  });

  test('描画しない block があっても区切りの数は変わらない (文字列連結時代と同じ)', () => {
    const m = createManage();
    addByPostInfo(
      m,
      candidate({
        type: 'article',
        body: articleBody({
          blocks: [
            { type: 'p', text: 'a' },
            { type: 'brand-new' },
            { type: 'image', imageId: 'missing' },
            { type: 'p', text: 'b' },
          ],
        }),
      }),
    );
    expect(firstPost(m).htmlText).toBe('<h5>タイトル</h5>\n<br>\n<span>a</span><br>\n<br>\n<br>\n<span>b</span>');
  });
});

describe('DownloadManage', () => {
  const createFeeManage = () => new DownloadManage('testUser', new Map([[100, '100円プラン']]));

  describe('addFee', () => {
    test('重複排除', () => {
      const m = createFeeManage();
      m.addFee(100);
      m.addFee(100);
      m.addFee(200);
      m.applyTags();
    });

    test('複数の fee を追加', () => {
      const m = createFeeManage();
      m.addFee(0);
      m.addFee(500);
      expect(m.getTagByFee(0)).toBe('無料プラン');
      expect(m.getTagByFee(500)).toBe('500円プラン');
    });
  });

  describe('addTags', () => {
    test('重複排除', () => {
      const m = createFeeManage();
      m.addTags('tag1', 'tag2');
      m.addTags('tag2', 'tag3');
      m.applyTags();
    });

    test('複数タグを一度に追加', () => {
      const m = createFeeManage();
      m.addTags('a', 'b', 'c');
      m.applyTags();
    });
  });

  describe('getTagByFee', () => {
    test('feeMap に存在する fee → マップの値', () => {
      expect(createFeeManage().getTagByFee(100)).toBe('100円プラン');
    });

    test('feeMap に存在しない正の fee → "N円プラン"', () => {
      expect(createFeeManage().getTagByFee(500)).toBe('500円プラン');
    });

    test('fee が 0 → "無料プラン"', () => {
      expect(createFeeManage().getTagByFee(0)).toBe('無料プラン');
    });
  });

  describe('limit', () => {
    test('isLimitAvailable=false → isLimitValid は常に true', () => {
      expect(createFeeManage().isLimitValid()).toBe(true);
    });

    test('isLimitAvailable=true, limit>0 → isLimitValid は true', () => {
      const m = createFeeManage();
      m.setLimitAvailable(true);
      m.setLimit(3);
      expect(m.isLimitValid()).toBe(true);
    });

    test('decrementLimit → limit 減少', () => {
      const m = createFeeManage();
      m.setLimitAvailable(true);
      m.setLimit(2);
      expect(m.isLimitValid()).toBe(true);
      m.decrementLimit();
      expect(m.isLimitValid()).toBe(true);
      m.decrementLimit();
      expect(m.isLimitValid()).toBe(false);
    });

    test('limit が 0 になったら isLimitValid は false', () => {
      const m = createFeeManage();
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

describe('API レスポンス型と未検証入力型', () => {
  test('旧名は新名の別名のままで、相互に代入できる (非破壊のリネーム)', () => {
    const plans: Plans = { body: { plans: [] } };
    const plansResponse: PlansResponse = plans;
    const tags: Tags = { body: { featuredTags: [] } };
    const tagsResponse: TagsResponse = tags;
    const paginated: PaginatedPosts = { body: { pageUrls: ['https://example.invalid/1'] } };
    const pagination: PostPaginationResponse = paginated;
    const list: PostList = { body: { posts: [] } };
    const listResponse: PostListResponse = list;

    expect(plansResponse).toBe(plans);
    expect(tagsResponse).toBe(tags);
    expect(pagination).toBe(paginated);
    expect(listResponse).toBe(list);
  });

  test('レスポンスの payload は未検証なので、任意の値を代入できる', () => {
    // 利用側は unwrapArray などの validator を通してから使う。型で検証済みを装わない
    const list: PostListResponse = { body: { posts: 'not an array' } };
    const info: PostInfoResponse = { body: { post: 42 } };
    expect(list.body?.posts).toBe('not an array');
    expect(info.body?.post).toBe(42);
  });

  test('candidate は利用側が検証した最小限だけを保証する', () => {
    const post: PostInfoCandidate = { id: 'p1', type: 'text', isRestricted: false };
    const item: PostListItemCandidate = { id: 'p1', isRestricted: false, feeRequired: 0 };
    expect(post.type).toBe('text');
    expect(item.feeRequired).toBe(0);
  });
});
