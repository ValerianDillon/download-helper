import { DownloadObject, DownloadUtils } from "./download-helper";

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
export function addByPostInfo(downloadManage, postInfo) {
  if (!postInfo || downloadManage.isIgnoreFree && postInfo.feeRequired === 0) {
    return;
  }
  if (!postInfo.body || postInfo.isRestricted) {
    console.log(`取得できませんでした(支援がたりない？)
feeRequired: ${postInfo.feeRequired}@${postInfo.id}`);
    return;
  }
  const postName = postInfo.title;
  const postObject = downloadManage.downloadObject.addPost(postName);
  const publishedDatetime = postInfo.publishedDatetime;
  if (typeof publishedDatetime === "string" && publishedDatetime.length > 0) {
    postObject.setPublishedDatetime(publishedDatetime);
  }
  postObject.setTags([downloadManage.getTagByFee(postInfo.feeRequired), ...postInfo.tags]);
  downloadManage.addFee(postInfo.feeRequired);
  downloadManage.addTags(...postInfo.tags);
  const header = ((url) => {
    if (url) {
      const ext = url.split(".").pop() ?? "";
      return `${postObject.getImageLinkTag(postObject.setCover("cover", ext, url))}<h5>${DownloadManage.utils.escapeHtml(postName)}</h5>
`;
    }
    return `<h5>${DownloadManage.utils.escapeHtml(postName)}</h5>
<br>
`;
  })(postInfo.coverImageUrl);
  let parsedText;
  switch (postInfo.type) {
    case "image": {
      const images = postInfo.body.images.map((it) => postObject.addFile(postName, it.extension, it.originalUrl));
      const imageTags = images.map((it) => postObject.getImageLinkTag(it)).join(`<br>
`);
      const text = postInfo.body.text.split(`
`).map((it) => `<span>${DownloadManage.utils.escapeHtml(it)}</span>`).join(`<br>
`);
      postObject.setHtml(`${header + imageTags}<br>
${text}`);
      parsedText = `${postInfo.body.text}
`;
      break;
    }
    case "file": {
      const files = postInfo.body.files.map((it) => postObject.addFile(it.name, it.extension, it.url));
      const fileTags = files.map((it) => postObject.getAutoAssignedLinkTag(it)).join(`<br>
`);
      const text = postInfo.body.text.split(`
`).map((it) => `<span>${DownloadManage.utils.escapeHtml(it)}</span>`).join(`<br>
`);
      postObject.setHtml(`${header + fileTags}<br>
${text}`);
      parsedText = `${postInfo.body.text}
`;
      break;
    }
    case "article": {
      const images = convertImageMap(postInfo.body.imageMap, postInfo.body.blocks).map((it) => postObject.addFile(postName, it.extension, it.originalUrl));
      const files = convertFileMap(postInfo.body.fileMap, postInfo.body.blocks).map((it) => postObject.addFile(it.name, it.extension, it.url));
      const embeds = convertEmbedMap(postInfo.body.embedMap, postInfo.body.blocks);
      const urlEmbeds = convertUrlEmbedMap(postInfo.body.urlEmbedMap, postInfo.body.blocks);
      let cntImg = 0, cntFile = 0, cntEmbed = 0, cntUrlEmbed = 0;
      const body = postInfo.body.blocks.map((it) => {
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
            return `<span>${DownloadManage.utils.escapeHtml(JSON.stringify(embeds[cntEmbed++]))}</span>`;
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
              default:
                return `<span>${DownloadManage.utils.escapeHtml(JSON.stringify(urlEmbedInfo))}</span>`;
            }
          }
          default:
            return console.error(`unknown block type: ${it.type}`);
        }
      }).join(`<br>
`);
      postObject.setHtml(header + body);
      parsedText = `${postInfo.body.blocks.filter((it) => it.type === "p" || it.type === "header").map((it) => it.text).join(`
`)}
`;
      break;
    }
    case "text": {
      const body = postInfo.body.text.split(`
`).map((it) => `<span>${DownloadManage.utils.escapeHtml(it)}</span>`).join(`<br>
`);
      parsedText = postInfo.body.text;
      postObject.setHtml(header + body);
      break;
    }
    default:
      parsedText = `不明なタイプ
${postInfo.type}@${postInfo.id}
`;
      console.log(`不明なタイプ
${postInfo.type}@${postInfo.id}`);
      break;
  }
  const informationObject = {
    postId: postInfo.id,
    title: postInfo.title,
    creatorId: postInfo.creatorId,
    fee: postInfo.feeRequired,
    publishedDatetime: postInfo.publishedDatetime,
    updatedDatetime: postInfo.updatedDatetime,
    tags: postInfo.tags,
    likeCount: postInfo.likeCount,
    commentCount: postInfo.commentCount
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
}
export function convertImageMap(imageMap, blocks) {
  const imageOrder = blocks.filter((it) => it.type === "image").map((it) => it.imageId);
  const imageKeyOrder = (s) => {
    const idx = imageOrder.indexOf(s);
    return idx === -1 ? imageOrder.length : idx;
  };
  return Object.keys(imageMap).sort((a, b) => imageKeyOrder(a) - imageKeyOrder(b)).map((it) => imageMap[it]);
}
export function convertFileMap(fileMap, blocks) {
  const fileOrder = blocks.filter((it) => it.type === "file").map((it) => it.fileId);
  const fileKeyOrder = (s) => {
    const idx = fileOrder.indexOf(s);
    return idx === -1 ? fileOrder.length : idx;
  };
  return Object.keys(fileMap).sort((a, b) => fileKeyOrder(a) - fileKeyOrder(b)).map((it) => fileMap[it]);
}
export function convertEmbedMap(embedMap, blocks) {
  const embedOrder = blocks.filter((it) => it.type === "embed").map((it) => it.embedId);
  const embedKeyOrder = (s) => {
    const idx = embedOrder.indexOf(s);
    return idx === -1 ? embedOrder.length : idx;
  };
  return Object.keys(embedMap).sort((a, b) => embedKeyOrder(a) - embedKeyOrder(b)).map((it) => embedMap[it]);
}
export function convertUrlEmbedMap(urlEmbedMap, blocks) {
  const urlEmbedOrder = blocks.filter((it) => it.type === "url_embed").map((it) => it.urlEmbedId);
  const urlEmbedKeyOrder = (s) => {
    const idx = urlEmbedOrder.indexOf(s);
    return idx === -1 ? urlEmbedOrder.length : idx;
  };
  return Object.keys(urlEmbedMap).sort((a, b) => urlEmbedKeyOrder(a) - urlEmbedKeyOrder(b)).map((it) => urlEmbedMap[it]);
}
