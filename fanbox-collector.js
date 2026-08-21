import { createNameKeyedDictionary, DownloadObject, DownloadUtils } from "./download-helper";

export class DownloadManage {
  userId;
  feeMap;
  static utils = new DownloadUtils;
  static isExportJson = true;
  downloadObject;
  isIgnoreFree = false;
  fees = new Set;
  tags = new Set;
  isLimitAvailable = false;
  limit = 0;
  constructor(userId, feeMap) {
    this.userId = userId;
    this.feeMap = feeMap;
    this.downloadObject = new DownloadObject(userId, DownloadManage.utils);
  }
  addFee(fee) {
    this.fees.add(fee);
  }
  addTags(...tags) {
    for (const tag of tags) {
      this.tags.add(tag);
    }
  }
  applyTags() {
    const fees = [...this.fees].sort((a, b) => a - b).map((fee) => this.getTagByFee(fee));
    const tags = [...this.tags].filter((tag) => !fees.includes(tag));
    this.downloadObject.setTags([...fees, ...tags]);
  }
  getTagByFee(fee) {
    return this.feeMap.get(fee) ?? `${fee > 0 ? `${fee}円` : "無料"}プラン`;
  }
  setLimitAvailable(isLimitAvailable) {
    this.isLimitAvailable = isLimitAvailable;
  }
  isLimitValid() {
    if (!this.isLimitAvailable)
      return true;
    return this.limit > 0;
  }
  decrementLimit() {
    if (this.isLimitAvailable) {
      this.limit--;
    }
  }
  setLimit(limit) {
    if (this.isLimitAvailable) {
      this.limit = limit;
    }
  }
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function serialize(value) {
  try {
    const json = JSON.stringify(value);
    return typeof json === "string" ? json : undefined;
  } catch {
    return;
  }
}
function decodeImageInfo(value) {
  if (!isRecord(value) || typeof value.originalUrl !== "string" || typeof value.extension !== "string")
    return;
  return { originalUrl: value.originalUrl, extension: value.extension };
}
function decodeFileInfo(value) {
  if (!isRecord(value) || typeof value.url !== "string" || typeof value.name !== "string" || typeof value.extension !== "string") {
    return;
  }
  return { url: value.url, name: value.name, extension: value.extension };
}
function decodeEmbedValue(value) {
  const rawJson = serialize(value);
  return rawJson === undefined ? undefined : { rawJson };
}
function decodeBlock(value) {
  if (!isRecord(value) || typeof value.type !== "string")
    return;
  const id = (key) => typeof value[key] === "string" ? value[key] : undefined;
  switch (value.type) {
    case "p":
    case "header":
      return typeof value.text === "string" ? { type: value.type, text: value.text } : undefined;
    case "image": {
      const imageId = id("imageId");
      return imageId === undefined ? undefined : { type: "image", imageId };
    }
    case "file": {
      const fileId = id("fileId");
      return fileId === undefined ? undefined : { type: "file", fileId };
    }
    case "embed": {
      const embedId = id("embedId");
      return embedId === undefined ? undefined : { type: "embed", embedId };
    }
    case "url_embed": {
      const urlEmbedId = id("urlEmbedId");
      return urlEmbedId === undefined ? undefined : { type: "url_embed", urlEmbedId };
    }
    default:
      return { type: "unknown", originalType: value.type };
  }
}
function decodeUrlEmbedInfo(value) {
  if (!isRecord(value) || typeof value.type !== "string")
    return;
  switch (value.type) {
    case "default":
      return typeof value.url === "string" && typeof value.host === "string" ? { type: "default", url: value.url, host: value.host } : undefined;
    case "html":
    case "html.card":
      return typeof value.html === "string" ? { type: value.type, html: value.html } : undefined;
    case "fanbox.post": {
      const postInfo = value.postInfo;
      if (!isRecord(postInfo) || typeof postInfo.title !== "string" || typeof postInfo.id !== "string" || typeof postInfo.creatorId !== "string") {
        return;
      }
      return {
        type: "fanbox.post",
        postInfo: { title: postInfo.title, id: postInfo.id, creatorId: postInfo.creatorId }
      };
    }
    default: {
      const rawJson = serialize(value);
      return rawJson === undefined ? undefined : { type: "unknown", originalType: value.type, rawJson };
    }
  }
}
function decodeRecordOf(value, decodeValue) {
  if (!isRecord(value))
    return;
  const decoded = createNameKeyedDictionary();
  for (const [key, item] of Object.entries(value)) {
    const result = decodeValue(item);
    if (result === undefined)
      return;
    decoded[key] = result;
  }
  return decoded;
}
function decodeArrayOf(value, decodeValue) {
  if (!Array.isArray(value))
    return;
  const decoded = [];
  for (const item of value) {
    const result = decodeValue(item);
    if (result === undefined)
      return;
    decoded.push(result);
  }
  return decoded;
}
function decodeBody(type, body, missing) {
  const text = typeof body.text === "string" ? body.text : undefined;
  switch (type) {
    case "image": {
      const images = decodeArrayOf(body.images, decodeImageInfo);
      if (!images)
        missing.push("body.images");
      if (text === undefined)
        missing.push("body.text");
      return images && text !== undefined ? { type: "image", body: { text, images } } : undefined;
    }
    case "file": {
      const files = decodeArrayOf(body.files, decodeFileInfo);
      if (!files)
        missing.push("body.files");
      if (text === undefined)
        missing.push("body.text");
      return files && text !== undefined ? { type: "file", body: { text, files } } : undefined;
    }
    case "text": {
      if (text === undefined)
        missing.push("body.text");
      return text === undefined ? undefined : { type: "text", body: { text } };
    }
    case "article": {
      const blocks = decodeArrayOf(body.blocks, decodeBlock);
      if (!blocks)
        missing.push("body.blocks");
      const imageMap = decodeRecordOf(body.imageMap, decodeImageInfo);
      if (!imageMap)
        missing.push("body.imageMap");
      const fileMap = decodeRecordOf(body.fileMap, decodeFileInfo);
      if (!fileMap)
        missing.push("body.fileMap");
      const embedMap = decodeRecordOf(body.embedMap, decodeEmbedValue);
      if (!embedMap)
        missing.push("body.embedMap");
      const urlEmbedMap = decodeRecordOf(body.urlEmbedMap, decodeUrlEmbedInfo);
      if (!urlEmbedMap)
        missing.push("body.urlEmbedMap");
      return blocks && imageMap && fileMap && embedMap && urlEmbedMap ? { type: "article", body: { blocks, imageMap, fileMap, embedMap, urlEmbedMap } } : undefined;
    }
  }
}
function decodeCollectablePost(candidate, raw, body) {
  const missing = [];
  const title = typeof raw.title === "string" ? raw.title : undefined;
  if (title === undefined)
    missing.push("title");
  const tags = Array.isArray(raw.tags) && raw.tags.every((tag) => typeof tag === "string") ? raw.tags : undefined;
  if (!tags)
    missing.push("tags");
  const cover = raw.coverImageUrl;
  const coverImageUrl = cover === null || cover === undefined || typeof cover === "string" ? cover : undefined;
  if (coverImageUrl === undefined && cover !== undefined)
    missing.push("coverImageUrl");
  const feeRequired = typeof raw.feeRequired === "number" ? raw.feeRequired : undefined;
  const metadata = {
    creatorId: raw.creatorId,
    publishedDatetime: raw.publishedDatetime,
    updatedDatetime: raw.updatedDatetime,
    likeCount: raw.likeCount,
    commentCount: raw.commentCount
  };
  if (serialize(metadata) === undefined)
    missing.push("metadata");
  const decodedBody = isRecord(body) ? decodeBody(candidate.type, body, missing) : undefined;
  if (!isRecord(body))
    missing.push("body");
  if (missing.length > 0 || title === undefined || !tags || feeRequired === undefined || !decodedBody) {
    return { ok: false, missing: missing.length > 0 ? missing : ["body"] };
  }
  const base = { id: candidate.id, title, tags, feeRequired, coverImageUrl, metadata };
  switch (decodedBody.type) {
    case "image":
      return { ok: true, post: { ...base, type: "image", body: decodedBody.body } };
    case "file":
      return { ok: true, post: { ...base, type: "file", body: decodedBody.body } };
    case "article":
      return { ok: true, post: { ...base, type: "article", body: decodedBody.body } };
    case "text":
      return { ok: true, post: { ...base, type: "text", body: decodedBody.body } };
  }
}
function isKnownPostType(type) {
  return type === "image" || type === "file" || type === "article" || type === "text";
}
export function addByPostInfo(downloadManage, postInfo) {
  if (!postInfo) {
    return { status: "unavailable", reason: "missing-body" };
  }
  const raw = postInfo;
  const feeRequired = raw.feeRequired;
  if (typeof feeRequired !== "number") {
    console.error(`支援額が読めないため取り込みませんでした
${postInfo.type}@${postInfo.id}`);
    return { status: "invalid", postId: postInfo.id, type: postInfo.type, missing: ["feeRequired"] };
  }
  if (downloadManage.isIgnoreFree && feeRequired === 0) {
    return { status: "ignored" };
  }
  if (postInfo.isRestricted) {
    console.log(`取得できませんでした(支援がたりない？)
feeRequired: ${feeRequired}@${postInfo.id}`);
    return { status: "unavailable", reason: "restricted" };
  }
  const postType = postInfo.type;
  if (!isKnownPostType(postType)) {
    console.error(`未知の投稿タイプのため取り込みませんでした
${postType}@${postInfo.id}`);
    return { status: "unsupported", postId: postInfo.id, type: postType };
  }
  const body = raw.body;
  if (body === null || body === undefined) {
    console.log(`本文がありませんでした
feeRequired: ${feeRequired}@${postInfo.id}`);
    return { status: "unavailable", reason: "missing-body" };
  }
  const decoded = decodeCollectablePost({ ...postInfo, type: postType }, raw, body);
  if (!decoded.ok) {
    console.error(`投稿データの形式が想定と違うため取り込みませんでした
${postType}@${postInfo.id} missing: ${decoded.missing.join(", ")}`);
    return { status: "invalid", postId: postInfo.id, type: postType, missing: decoded.missing };
  }
  const post = decoded.post;
  const postName = post.title;
  const postObject = downloadManage.downloadObject.addPost(postName);
  const publishedDatetime = post.metadata.publishedDatetime;
  if (typeof publishedDatetime === "string" && publishedDatetime.length > 0) {
    postObject.setPublishedDatetime(publishedDatetime);
  }
  postObject.setTags([downloadManage.getTagByFee(post.feeRequired), ...post.tags]);
  downloadManage.addFee(post.feeRequired);
  downloadManage.addTags(...post.tags);
  const header = ((url) => {
    if (url) {
      const ext = url.split(".").pop() ?? "";
      return `${postObject.getImageLinkTag(postObject.setCover("cover", ext, url))}<h5>${DownloadManage.utils.escapeHtml(postName)}</h5>
`;
    }
    return `<h5>${DownloadManage.utils.escapeHtml(postName)}</h5>
<br>
`;
  })(post.coverImageUrl);
  let parsedText;
  switch (post.type) {
    case "image": {
      const images = post.body.images.map((it) => postObject.addFile(postName, it.extension, it.originalUrl));
      const imageTags = images.map((it) => postObject.getImageLinkTag(it)).join(`<br>
`);
      const text = post.body.text.split(`
`).map((it) => `<span>${DownloadManage.utils.escapeHtml(it)}</span>`).join(`<br>
`);
      postObject.setHtml(`${header + imageTags}<br>
${text}`);
      parsedText = `${post.body.text}
`;
      break;
    }
    case "file": {
      const files = post.body.files.map((it) => postObject.addFile(it.name, it.extension, it.url));
      const fileTags = files.map((it) => postObject.getAutoAssignedLinkTag(it)).join(`<br>
`);
      const text = post.body.text.split(`
`).map((it) => `<span>${DownloadManage.utils.escapeHtml(it)}</span>`).join(`<br>
`);
      postObject.setHtml(`${header + fileTags}<br>
${text}`);
      parsedText = `${post.body.text}
`;
      break;
    }
    case "article": {
      const images = convertImageMap(post.body.imageMap, post.body.blocks).map((it) => postObject.addFile(postName, it.extension, it.originalUrl));
      const files = convertFileMap(post.body.fileMap, post.body.blocks).map((it) => postObject.addFile(it.name, it.extension, it.url));
      const embeds = convertEmbedMap(post.body.embedMap, post.body.blocks);
      const urlEmbeds = convertUrlEmbedMap(post.body.urlEmbedMap, post.body.blocks);
      let cntImg = 0, cntFile = 0, cntEmbed = 0, cntUrlEmbed = 0;
      const body = post.body.blocks.map((it) => {
        switch (it.type) {
          case "p":
            return `<span>${DownloadManage.utils.escapeHtml(it.text)}</span>`;
          case "header":
            return `<h2><span>${DownloadManage.utils.escapeHtml(it.text)}</span></h2>`;
          case "file": {
            if (cntFile >= files.length)
              return "";
            return postObject.getAutoAssignedLinkTag(files[cntFile++]);
          }
          case "image": {
            if (cntImg >= images.length)
              return "";
            return postObject.getImageLinkTag(images[cntImg++]);
          }
          case "embed": {
            if (cntEmbed >= embeds.length)
              return "";
            return `<span>${DownloadManage.utils.escapeHtml(embeds[cntEmbed++].rawJson)}</span>`;
          }
          case "url_embed": {
            if (cntUrlEmbed >= urlEmbeds.length)
              return "";
            const urlEmbedInfo = urlEmbeds[cntUrlEmbed++];
            switch (urlEmbedInfo.type) {
              case "default":
                return postObject.getLinkTag(urlEmbedInfo.url, urlEmbedInfo.host);
              case "html":
              case "html.card": {
                const iframeUrl = urlEmbedInfo.html.match(/<iframe.*src="(http.*)"/)?.[1];
                return iframeUrl ? postObject.getLinkTag(iframeUrl, "iframe link") : `
${DownloadManage.utils.escapeHtml(urlEmbedInfo.html)}

`;
              }
              case "fanbox.post": {
                const url = `https://www.fanbox.cc/@${urlEmbedInfo.postInfo.creatorId}/posts/${urlEmbedInfo.postInfo.id}`;
                return postObject.getLinkTag(url, urlEmbedInfo.postInfo.title);
              }
              case "unknown":
                return `<span>${DownloadManage.utils.escapeHtml(urlEmbedInfo.rawJson)}</span>`;
              default: {
                const exhaustive = urlEmbedInfo;
                return `${exhaustive}`;
              }
            }
          }
          case "unknown":
            return console.error(`unknown block type: ${it.originalType}`);
          default: {
            const exhaustive = it;
            return `${exhaustive}`;
          }
        }
      }).join(`<br>
`);
      postObject.setHtml(header + body);
      parsedText = `${post.body.blocks.filter((it) => it.type === "p" || it.type === "header").map((it) => it.text).join(`
`)}
`;
      break;
    }
    case "text": {
      const body = post.body.text.split(`
`).map((it) => `<span>${DownloadManage.utils.escapeHtml(it)}</span>`).join(`<br>
`);
      parsedText = post.body.text;
      postObject.setHtml(header + body);
      break;
    }
  }
  const informationObject = {
    postId: post.id,
    title: post.title,
    creatorId: post.metadata.creatorId,
    fee: post.feeRequired,
    publishedDatetime: post.metadata.publishedDatetime,
    updatedDatetime: post.metadata.updatedDatetime,
    tags: post.tags,
    likeCount: post.metadata.likeCount,
    commentCount: post.metadata.commentCount
  };
  if (DownloadManage.isExportJson) {
    postObject.setInfo(JSON.stringify({ ...informationObject, parsedText }));
  } else {
    const exportInfoText = Object.keys(informationObject).map((key) => `${key}:${JSON.stringify(informationObject[key])}`).join(`
`);
    postObject.setInfo(`${exportInfoText}
parsedText:
${parsedText}`);
  }
  downloadManage.decrementLimit();
  return { status: "added" };
}
function convertImageMap(imageMap, blocks) {
  const imageOrder = blocks.filter((it) => it.type === "image").map((it) => it.imageId);
  const imageKeyOrder = (s) => {
    const idx = imageOrder.indexOf(s);
    return idx === -1 ? imageOrder.length : idx;
  };
  return Object.keys(imageMap).sort((a, b) => imageKeyOrder(a) - imageKeyOrder(b)).map((it) => imageMap[it]);
}
function convertFileMap(fileMap, blocks) {
  const fileOrder = blocks.filter((it) => it.type === "file").map((it) => it.fileId);
  const fileKeyOrder = (s) => {
    const idx = fileOrder.indexOf(s);
    return idx === -1 ? fileOrder.length : idx;
  };
  return Object.keys(fileMap).sort((a, b) => fileKeyOrder(a) - fileKeyOrder(b)).map((it) => fileMap[it]);
}
function convertEmbedMap(embedMap, blocks) {
  const embedOrder = blocks.filter((it) => it.type === "embed").map((it) => it.embedId);
  const embedKeyOrder = (s) => {
    const idx = embedOrder.indexOf(s);
    return idx === -1 ? embedOrder.length : idx;
  };
  return Object.keys(embedMap).sort((a, b) => embedKeyOrder(a) - embedKeyOrder(b)).map((it) => embedMap[it]);
}
function convertUrlEmbedMap(urlEmbedMap, blocks) {
  const urlEmbedOrder = blocks.filter((it) => it.type === "url_embed").map((it) => it.urlEmbedId);
  const urlEmbedKeyOrder = (s) => {
    const idx = urlEmbedOrder.indexOf(s);
    return idx === -1 ? urlEmbedOrder.length : idx;
  };
  return Object.keys(urlEmbedMap).sort((a, b) => urlEmbedKeyOrder(a) - urlEmbedKeyOrder(b)).map((it) => urlEmbedMap[it]);
}
