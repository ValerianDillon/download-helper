function freezeAssetKey(key) {
  return Object.freeze(key.kind === "cover" ? { kind: "cover" } : { kind: key.kind, assetId: key.assetId });
}
export function assetKeyToString(key) {
  return key.kind === "cover" ? "cover" : `${key.kind}:${key.assetId}`;
}
export function joinHtmlFragments(parts, separator) {
  const joined = [];
  parts.forEach((part, index) => {
    if (index > 0)
      joined.push(separator);
    joined.push(...part);
  });
  return joined;
}

export class DownloadUtils {
  audioExtension = /\.(mp3|m4a|ogg)$/;
  imageExtension = /\.(apng|avif|gif|jpg|jpeg|jfif|pjpeg|pjp|png|svg|webp)$/;
  videoExtension = /\.(mp4|webm|ogv)$/;
  isAudio(fileName) {
    return fileName.match(this.audioExtension) != null;
  }
  isImage(fileName) {
    return fileName.match(this.imageExtension) != null;
  }
  isVideo(fileName) {
    return fileName.match(this.videoExtension) != null;
  }
  httpGetAs(url) {
    const request = new XMLHttpRequest;
    request.open("GET", url, false);
    request.withCredentials = true;
    request.send(null);
    if (request.status < 200 || request.status >= 300) {
      throw new Error(`HTTP ${request.status}: ${url}`);
    }
    try {
      return JSON.parse(request.responseText);
    } catch {
      throw new Error(`JSON parse error: ${url}`);
    }
  }
  encodeFileName(name) {
    return name.replace(/\//g, "／").replace(/\\/g, "＼").replace(/,/g, "，").replace(/:/g, "：").replace(/\*/g, "＊").replace(/"/g, "“").replace(/</g, "＜").replace(/>/g, "＞").replace(/\|/g, "｜").trim();
  }
  encodeURI(name) {
    return this.encodeFileName(name).replaceAll(/[;,/?:@&=+$#]/g, encodeURIComponent);
  }
  splitExt(name) {
    return name.split(/(?=\.[^.]+$)/);
  }
  getFileName(name, extension, length, index, isAsc) {
    if (length <= 1)
      return `${name}${extension}`;
    return isAsc ? `${name}_${index + 1}${extension}` : `${name}_${length - index}${extension}`;
  }
  toQuoted(value) {
    return `'${value.replaceAll("'", "\\'")}'`;
  }
  escapeHtml(value) {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  createInformationFile(informationText) {
    try {
      const json = JSON.stringify(JSON.parse(informationText), null, "\t");
      return { name: "info.json", content: [json] };
    } catch {
      return { name: "info.txt", content: [informationText] };
    }
  }
  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  async fetchWithLimit({ url, name }, limit) {
    if (limit < 0)
      return null;
    try {
      const blob = await fetch(url).catch((e) => {
        throw new Error(e);
      }).then((r) => r.ok ? r.blob() : null);
      return blob ? blob : await this.fetchWithLimit({ url, name }, limit - 1);
    } catch (_) {
      console.error(`通信エラー: ${name}, ${url}`);
      await this.sleep(1000);
      return await this.fetchWithLimit({ url, name }, limit - 1);
    }
  }
  async embedScript(url, integrity) {
    const scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = url;
      if (integrity) {
        script.integrity = integrity;
        script.crossOrigin = "anonymous";
      }
      script.onload = () => resolve(script);
      script.onerror = (e) => reject(e);
      document.head.appendChild(script);
    });
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error(`Script load timeout: ${url}`)), 30000));
    return Promise.race([scriptPromise, timeout]);
  }
}
export function createNameKeyedDictionary() {
  return Object.create(null);
}
export function createLegacyArchivePathAllocator(utils) {
  return {
    allocatePostDirectoryNames(posts) {
      const groups = createNameKeyedDictionary();
      posts.forEach((post, index) => {
        const key = utils.encodeFileName(post.name);
        const group = groups[key];
        if (group === undefined) {
          groups[key] = [index];
        } else {
          group.push(index);
        }
      });
      const names = new Array(posts.length);
      for (const [key, indexes] of Object.entries(groups)) {
        indexes.forEach((postIndex, indexInGroup) => {
          names[postIndex] = utils.getFileName(key, "", indexes.length, indexInGroup, false);
        });
      }
      return names;
    },
    allocateAssetPaths(post) {
      const groups = createNameKeyedDictionary();
      for (const file of post.files) {
        const key = utils.encodeFileName(file.name);
        const group = groups[key];
        if (group === undefined) {
          groups[key] = [file];
        } else {
          group.push(file);
        }
      }
      const files = [];
      for (const [key, group] of Object.entries(groups)) {
        group.forEach((file, indexInGroup) => {
          const extension = file.extension ? utils.encodeFileName(file.extension) : "";
          files.push({ file, archiveName: utils.getFileName(key, extension, group.length, indexInGroup, true) });
        });
      }
      const cover = post.cover;
      return {
        files,
        coverArchiveName: cover ? utils.getFileName(utils.encodeFileName(cover.name), utils.encodeFileName(cover.extension), 1, 0, true) : undefined
      };
    }
  };
}

export class DownloadObject {
  downloadObj;
  utils;
  allocator;
  orderedPosts = [];
  url = "#main";
  tags;
  constructor(id, utils, allocator) {
    this.downloadObj = { posts: [], id };
    this.utils = utils;
    this.allocator = allocator ?? createLegacyArchivePathAllocator(utils);
  }
  stringify() {
    const directoryNames = this.allocator.allocatePostDirectoryNames(this.downloadObj.posts);
    const downloadJson = {
      posts: this.orderedPosts.map((it, index) => it.toJsonObj(directoryNames[index], this.allocator)),
      id: this.downloadObj.id,
      url: this.url,
      tags: this.tags ?? this.collectTags(),
      postCount: this.countPost(),
      fileCount: this.countFile()
    };
    return JSON.stringify(downloadJson);
  }
  setUrl(url) {
    this.url = url;
  }
  setTags(tags) {
    this.tags = tags;
  }
  addPost(name) {
    const postObj = { name, info: "", files: [], html: [], tags: [] };
    this.downloadObj.posts.push(postObj);
    const postObject = new PostObject(postObj, this.utils);
    this.orderedPosts.push(postObject);
    return postObject;
  }
  countPost() {
    return this.downloadObj.posts.length;
  }
  countFile() {
    return this.downloadObj.posts.reduce((sum, post) => sum + post.files.length, 0);
  }
  collectTags() {
    const tags = new Set;
    for (const post of this.downloadObj.posts) {
      for (const tag of post.tags) {
        tags.add(tag);
      }
    }
    return [...tags];
  }
}

export class PostObject {
  postObj;
  utils;
  constructor(postObj, utils) {
    this.postObj = postObj;
    this.utils = utils;
  }
  setInfo(info) {
    this.postObj.info = info;
  }
  setHtml(html) {
    this.postObj.html = html.map((fragment) => typeof fragment === "string" ? fragment : Object.freeze({ assetRef: freezeAssetKey(fragment.assetRef) }));
  }
  setTags(tags) {
    this.postObj.tags = tags;
  }
  setPublishedDatetime(iso) {
    this.postObj.publishedDatetime = iso;
  }
  setPostType(type) {
    this.postObj.postType = type;
  }
  setCover(name, extension, url) {
    const fileObj = {
      name,
      extension: extension ? `.${extension}` : "",
      url,
      key: freezeAssetKey({ kind: "cover" }),
      metadata: {}
    };
    this.postObj.cover = fileObj;
    return new FileObject(fileObj, this.utils);
  }
  addFile(asset) {
    const duplicated = this.postObj.files.some((it) => assetKeyToString(it.key) === assetKeyToString(asset.key));
    if (duplicated) {
      throw new Error(`asset key is duplicated: ${assetKeyToString(asset.key)}`);
    }
    const fileObj = {
      name: asset.name,
      extension: asset.extension ? `.${asset.extension}` : "",
      url: asset.url,
      key: freezeAssetKey(asset.key),
      metadata: asset.metadata ?? {}
    };
    this.postObj.files.push(fileObj);
    return new FileObject(fileObj, this.utils);
  }
  getAutoAssignedLinkTag(fileObject) {
    const ext = fileObject.getEncodedExtension();
    switch (true) {
      case this.utils.isAudio(ext):
        return this.getAudioLinkTag(fileObject);
      case this.utils.isImage(ext):
        return this.getImageLinkTag(fileObject);
      case this.utils.isVideo(ext):
        return this.getVideoLinkTag(fileObject);
      default:
        return this.getFileLinkTag(fileObject);
    }
  }
  getAudioLinkTag(fileObject) {
    const ref = { assetRef: fileObject.getKey() };
    const escapedDownload = this.utils.escapeHtml(fileObject.getEncodedName() + fileObject.getEncodedExtension());
    return [
      `<a class="hl" href="`,
      ref,
      `" download="${escapedDownload}"><div class="post card">
` + `<div class="card-header">${this.utils.escapeHtml(fileObject.getOriginalName())}</div>
` + `<audio class="card-img-top" src="`,
      ref,
      `" controls/>
</div></a>`
    ];
  }
  getLinkTag(url, title) {
    return [
      `<a class="hl" href="${this.utils.escapeHtml(url)}"><div class="post card text-center"><p class="pt-2">
` + `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-box-arrow-up-left" viewBox="0 0 16 16">
` + `<path fill-rule="evenodd" d="M7.364 3.5a.5.5 0 0 1 .5-.5H14.5A1.5 1.5 0 0 1 16 4.5v10a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 3 14.5V7.864a.5.5 0 1 1 1 0V14.5a.5.5 0 0 0 .5.5h10a.5.5 0 0 0 .5-.5v-10a.5.5 0 0 0-.5-.5H7.864a.5.5 0 0 1-.5-.5z"/>
` + `<path fill-rule="evenodd" d="M0 .5A.5.5 0 0 1 .5 0h5a.5.5 0 0 1 0 1H1.707l8.147 8.146a.5.5 0 0 1-.708.708L1 1.707V5.5a.5.5 0 0 1-1 0v-5z"/>
` + `</svg> ${this.utils.escapeHtml(title)}</p></div></a>`
    ];
  }
  getFileLinkTag(fileObject) {
    const ref = { assetRef: fileObject.getKey() };
    const escapedDownload = this.utils.escapeHtml(fileObject.getEncodedName() + fileObject.getEncodedExtension());
    return [
      `<a class="hl" href="`,
      ref,
      `" download="${escapedDownload}">` + `<div class="post card text-center"><p class="pt-2">
` + `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-download" viewBox="0 0 16 16">
` + `<path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
` + `<path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>
` + `</svg> ${this.utils.escapeHtml(fileObject.getOriginalName() + fileObject.getOriginalExtension())}</p></div></a>`
    ];
  }
  getImageLinkTag(fileObject) {
    const ref = { assetRef: fileObject.getKey() };
    const escapedDownload = this.utils.escapeHtml(fileObject.getEncodedName() + fileObject.getEncodedExtension());
    return [
      `<a class="hl" href="`,
      ref,
      `" download="${escapedDownload}"><div class="post card">
<img class="card-img-top" src="`,
      ref,
      `" alt="${this.utils.escapeHtml(fileObject.getOriginalName())}"/>
</div></a>`
    ];
  }
  getVideoLinkTag(fileObject) {
    const ref = { assetRef: fileObject.getKey() };
    const escapedDownload = this.utils.escapeHtml(fileObject.getEncodedName() + fileObject.getEncodedExtension());
    return [
      `<a class="hl" href="`,
      ref,
      `" download="${escapedDownload}"><div class="post card">
<video class="card-img-top" src="`,
      ref,
      `" controls/>
</div></a>`
    ];
  }
  toJsonObj(directoryName, allocator) {
    const allocation = allocator.allocateAssetPaths(this.postObj);
    const pathByKey = new Map;
    for (const { file, archiveName } of allocation.files) {
      pathByKey.set(assetKeyToString(file.key), archiveName);
    }
    const cover = this.postObj.cover && allocation.coverArchiveName !== undefined ? { url: this.postObj.cover.url, name: allocation.coverArchiveName } : undefined;
    if (cover) {
      pathByKey.set("cover", cover.name);
    }
    return {
      originalName: this.postObj.name,
      encodedName: directoryName,
      informationText: this.postObj.info,
      htmlText: this.resolveHtml(pathByKey),
      files: allocation.files.map(({ file, archiveName }) => ({
        url: file.url,
        originalName: file.name,
        encodedName: archiveName
      })),
      tags: this.postObj.tags,
      cover,
      publishedDatetime: this.postObj.publishedDatetime
    };
  }
  resolveHtml(pathByKey) {
    return this.postObj.html.map((fragment) => {
      if (typeof fragment === "string")
        return fragment;
      const archiveName = pathByKey.get(assetKeyToString(fragment.assetRef));
      if (archiveName === undefined) {
        throw new Error(`archive path is not allocated: ${assetKeyToString(fragment.assetRef)}`);
      }
      return this.utils.escapeHtml(`./${this.utils.encodeURI(archiveName)}`);
    }).join("");
  }
}

export class FileObject {
  fileObj;
  utils;
  constructor(fileObj, utils) {
    this.fileObj = fileObj;
    this.utils = utils;
  }
  getKey() {
    return this.fileObj.key;
  }
  getMetadata() {
    return this.fileObj.metadata;
  }
  getEncodedName() {
    return this.utils.encodeFileName(this.fileObj.name);
  }
  getEncodedExtension() {
    return this.utils.encodeFileName(this.fileObj.extension);
  }
  getOriginalName() {
    return this.fileObj.name;
  }
  getOriginalExtension() {
    return this.fileObj.extension;
  }
  getUrl() {
    return this.fileObj.url;
  }
}
export const crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let i = 0;i < 256; i++) {
    let c = i;
    for (let j = 0;j < 8; j++) {
      c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();
export function crc32(data) {
  let crc = 4294967295;
  for (let i = 0;i < data.length; i++) {
    crc = crc32Table[(crc ^ data[i]) & 255] ^ crc >>> 8;
  }
  return (crc ^ 4294967295) >>> 0;
}
async function toUint8Array(parts) {
  const blob = new Blob(parts);
  return new Uint8Array(await blob.arrayBuffer());
}
export function clampToZipRange(date) {
  const min = new Date(1980, 0, 1, 0, 0, 0, 0);
  const max = new Date(2107, 11, 31, 23, 59, 58, 0);
  if (date.getTime() < min.getTime())
    return min;
  if (date.getTime() > max.getTime())
    return max;
  return date;
}
export function toDosTimeDate(date) {
  const h = date.getHours();
  const m = date.getMinutes();
  const s = date.getSeconds();
  const y = date.getFullYear();
  const mo = date.getMonth();
  const d = date.getDate();
  const time = h << 11 | m << 5 | s >> 1;
  const dosDate = y - 1980 << 9 | mo + 1 << 5 | d;
  return { time, dosDate };
}
export function buildNtfsExtra(date) {
  const buf = new ArrayBuffer(36);
  const view = new DataView(buf);
  view.setUint16(0, 10, true);
  view.setUint16(2, 32, true);
  view.setUint32(4, 0, true);
  view.setUint16(8, 1, true);
  view.setUint16(10, 24, true);
  const filetime = (BigInt(date.getTime()) + 11644473600000n) * 10000n;
  view.setBigUint64(12, filetime, true);
  view.setBigUint64(20, filetime, true);
  view.setBigUint64(28, filetime, true);
  return new Uint8Array(buf);
}
export function buildExtTimestampLfh(date) {
  const buf = new ArrayBuffer(17);
  const view = new DataView(buf);
  view.setUint16(0, 21589, true);
  view.setUint16(2, 13, true);
  view.setUint8(4, 7);
  const unix = Math.floor(date.getTime() / 1000);
  view.setInt32(5, unix, true);
  view.setInt32(9, unix, true);
  view.setInt32(13, unix, true);
  return new Uint8Array(buf);
}
export function buildExtTimestampCd(date) {
  const buf = new ArrayBuffer(9);
  const view = new DataView(buf);
  view.setUint16(0, 21589, true);
  view.setUint16(2, 5, true);
  view.setUint8(4, 7);
  const unix = Math.floor(date.getTime() / 1000);
  view.setInt32(5, unix, true);
  return new Uint8Array(buf);
}
function isInt32(n) {
  return n >= -2147483648 && n <= 2147483647;
}
function buildDateFields(date) {
  let dosTime = 0;
  let dosDate = 0;
  let extraLfh = new Uint8Array(0);
  let extraCd = new Uint8Array(0);
  if (date !== undefined && Number.isFinite(date.getTime())) {
    const d = clampToZipRange(date);
    const dos = toDosTimeDate(d);
    dosTime = dos.time;
    dosDate = dos.dosDate;
    const ntfs = buildNtfsExtra(d);
    const unix = Math.floor(d.getTime() / 1000);
    if (isInt32(unix)) {
      extraLfh = concatBytes([ntfs, buildExtTimestampLfh(d)]);
      extraCd = concatBytes([ntfs, buildExtTimestampCd(d)]);
    } else {
      extraLfh = ntfs;
      extraCd = ntfs;
    }
  }
  return { dosTime, dosDate, extraLfh, extraCd };
}
function concatBytes(parts) {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
export const MAX_ZIP_ENTRY_COUNT = 65534;
export const MAX_ZIP_UINT32_FIELD_VALUE = 4294967295;
export function assertZipEntryCountWithinLimit(currentEntryCount, method) {
  if (currentEntryCount >= MAX_ZIP_ENTRY_COUNT) {
    throw new Error(`ZipWriter.${method}: ZIP エントリ数が上限 (${MAX_ZIP_ENTRY_COUNT} 件) に達しています ` + "(ZIP64 非対応のため、これ以上追加すると EOCD のエントリ数フィールドが ZIP64 の sentinel 値と衝突するか uint16 で折り返します)");
  }
}
export function assertZipEntrySizeWithinLimit(size, name, method) {
  if (size >= MAX_ZIP_UINT32_FIELD_VALUE) {
    throw new Error(`ZipWriter.${method}: エントリサイズが上限 (${MAX_ZIP_UINT32_FIELD_VALUE} bytes) 以上です (ZIP64 非対応): ` + `${JSON.stringify(name)} (${size} bytes)`);
  }
}
export function assertZipUint32FieldWithinLimit(value, context) {
  if (value >= MAX_ZIP_UINT32_FIELD_VALUE) {
    throw new Error(`ZipWriter: ${context} が上限 (${MAX_ZIP_UINT32_FIELD_VALUE} bytes) 以上になります (ZIP64 非対応)`);
  }
}

export class ZipWriter {
  writable;
  offset = 0;
  entries = [];
  encoder = new TextEncoder;
  state = "open";
  inFlight = false;
  constructor(writable) {
    this.writable = writable;
  }
  async addFile(name, data, date) {
    this.beginOperation("addFile");
    try {
      assertValidZipEntryName(name, "addFile");
      const bytes = data.buffer instanceof ArrayBuffer ? data : new Uint8Array(data);
      const nameBytes = this.encoder.encode(name);
      assertValidZipEntryNameByteLength(nameBytes, name, "addFile");
      assertZipEntryCountWithinLimit(this.entries.length, "addFile");
      assertZipEntrySizeWithinLimit(bytes.length, name, "addFile");
      const fileCrc = crc32(bytes);
      const localHeaderOffset = this.offset;
      assertZipUint32FieldWithinLimit(localHeaderOffset, `addFile ("${name}") の local header offset`);
      const { dosTime, dosDate, extraLfh, extraCd } = buildDateFields(date);
      const header = new ArrayBuffer(30);
      const view = new DataView(header);
      view.setUint32(0, 67324752, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 2048, true);
      view.setUint16(8, 0, true);
      view.setUint16(10, dosTime, true);
      view.setUint16(12, dosDate, true);
      view.setUint32(14, fileCrc, true);
      view.setUint32(18, bytes.length, true);
      view.setUint32(22, bytes.length, true);
      view.setUint16(26, nameBytes.length, true);
      view.setUint16(28, extraLfh.length, true);
      await this.write(new Uint8Array(header));
      await this.write(nameBytes);
      if (extraLfh.length > 0)
        await this.write(extraLfh);
      await this.write(bytes);
      this.assertStillOpen("addFile");
      this.entries.push({
        name: nameBytes,
        crc: fileCrc,
        size: bytes.length,
        offset: localHeaderOffset,
        dosTime,
        dosDate,
        extraCd,
        externalAttr: 0
      });
    } catch (e) {
      await this.abortOnFailure(e);
      throw e;
    } finally {
      this.inFlight = false;
    }
  }
  async addDirectory(name, date) {
    this.beginOperation("addDirectory");
    try {
      const dirName = name.endsWith("/") ? name : `${name}/`;
      assertValidZipEntryName(dirName, "addDirectory");
      const nameBytes = this.encoder.encode(dirName);
      assertValidZipEntryNameByteLength(nameBytes, dirName, "addDirectory");
      assertZipEntryCountWithinLimit(this.entries.length, "addDirectory");
      const localHeaderOffset = this.offset;
      assertZipUint32FieldWithinLimit(localHeaderOffset, `addDirectory ("${dirName}") の local header offset`);
      const { dosTime, dosDate, extraLfh, extraCd } = buildDateFields(date);
      const header = new ArrayBuffer(30);
      const view = new DataView(header);
      view.setUint32(0, 67324752, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 2048, true);
      view.setUint16(8, 0, true);
      view.setUint16(10, dosTime, true);
      view.setUint16(12, dosDate, true);
      view.setUint32(14, 0, true);
      view.setUint32(18, 0, true);
      view.setUint32(22, 0, true);
      view.setUint16(26, nameBytes.length, true);
      view.setUint16(28, extraLfh.length, true);
      await this.write(new Uint8Array(header));
      await this.write(nameBytes);
      if (extraLfh.length > 0)
        await this.write(extraLfh);
      this.assertStillOpen("addDirectory");
      this.entries.push({
        name: nameBytes,
        crc: 0,
        size: 0,
        offset: localHeaderOffset,
        dosTime,
        dosDate,
        extraCd,
        externalAttr: 16
      });
    } catch (e) {
      await this.abortOnFailure(e);
      throw e;
    } finally {
      this.inFlight = false;
    }
  }
  async close() {
    this.beginOperation("close");
    try {
      const cdOffset = this.offset;
      assertZipUint32FieldWithinLimit(cdOffset, "close の central directory offset (cdOffset)");
      let predictedCdSize = 0;
      for (const entry of this.entries) {
        predictedCdSize += 46 + entry.name.length + entry.extraCd.length;
      }
      assertZipUint32FieldWithinLimit(predictedCdSize, "close の central directory size (cdSize)");
      for (const entry of this.entries) {
        const cdHeader = new ArrayBuffer(46);
        const view = new DataView(cdHeader);
        view.setUint32(0, 33639248, true);
        view.setUint16(4, 20, true);
        view.setUint16(6, 20, true);
        view.setUint16(8, 2048, true);
        view.setUint16(10, 0, true);
        view.setUint16(12, entry.dosTime, true);
        view.setUint16(14, entry.dosDate, true);
        view.setUint32(16, entry.crc, true);
        view.setUint32(20, entry.size, true);
        view.setUint32(24, entry.size, true);
        view.setUint16(28, entry.name.length, true);
        view.setUint16(30, entry.extraCd.length, true);
        view.setUint16(32, 0, true);
        view.setUint16(34, 0, true);
        view.setUint16(36, 0, true);
        view.setUint32(38, entry.externalAttr, true);
        view.setUint32(42, entry.offset, true);
        await this.write(new Uint8Array(cdHeader));
        await this.write(entry.name);
        if (entry.extraCd.length > 0)
          await this.write(entry.extraCd);
      }
      const cdSize = this.offset - cdOffset;
      const eocd = new ArrayBuffer(22);
      const eocdView = new DataView(eocd);
      eocdView.setUint32(0, 101010256, true);
      eocdView.setUint16(4, 0, true);
      eocdView.setUint16(6, 0, true);
      eocdView.setUint16(8, this.entries.length, true);
      eocdView.setUint16(10, this.entries.length, true);
      eocdView.setUint32(12, cdSize, true);
      eocdView.setUint32(16, cdOffset, true);
      eocdView.setUint16(20, 0, true);
      await this.write(new Uint8Array(eocd));
      await this.writable.close();
      this.state = "closed";
    } catch (e) {
      await this.abortOnFailure(e);
      throw e;
    } finally {
      this.inFlight = false;
    }
  }
  async abort(reason) {
    if (this.inFlight === "close") {
      throw new Error("ZipWriter.abort: close 実行中のため abort できません。close の完了を待ってください");
    }
    if (this.state !== "open")
      return;
    await this.abortOnFailure(reason);
  }
  async write(data) {
    await this.writable.write(data);
    if (this.state !== "open") {
      throw new Error("ZipWriter: 書き込み中に abort されました");
    }
    this.offset += data.length;
  }
  assertStillOpen(method) {
    if (this.state !== "open") {
      throw new Error(`ZipWriter.${method}: 書き込み中に abort されました`);
    }
  }
  beginOperation(method) {
    if (this.state === "failed") {
      throw new Error(`ZipWriter.${method}: 以前の失敗により使用不可です`);
    }
    if (this.state === "closed") {
      throw new Error(`ZipWriter.${method}: close 済みのため使用不可です`);
    }
    if (this.inFlight !== false) {
      throw new Error(`ZipWriter.${method}: 別の呼び出しが実行中です (ZipWriter は呼び出しごとに await してから次を呼ぶ直列利用が前提です)`);
    }
    this.inFlight = method;
  }
  async abortOnFailure(reason) {
    if (this.state !== "open")
      return;
    this.state = "failed";
    try {
      await this.writable.abort(reason);
    } catch {}
  }
}
function isValidPathSegment(value) {
  if (typeof value !== "string" || value.length === 0)
    return false;
  if (/[/\\:]/.test(value))
    return false;
  if (/[\u0000-\u001f\u007f]/.test(value))
    return false;
  const trimmedTrailing = value.replace(/[ .]+$/, "");
  return trimmedTrailing.length > 0 && trimmedTrailing !== "." && trimmedTrailing !== "..";
}
function assertValidZipEntryName(name, method) {
  const segmentsSource = method === "addDirectory" && name.endsWith("/") ? name.slice(0, -1) : name;
  for (const segment of segmentsSource.split("/")) {
    if (!isValidPathSegment(segment)) {
      throw new Error(`ZipWriter.${method}: 不正な ZIP エントリ名です (${JSON.stringify(name)})`);
    }
  }
}
function assertValidZipEntryNameByteLength(nameBytes, name, method) {
  if (nameBytes.length > 65535) {
    throw new Error(`ZipWriter.${method}: エントリ名が長すぎます (UTF-8 ${nameBytes.length} bytes, 上限 65535 bytes): ${JSON.stringify(name)}`);
  }
}
function pad2(n) {
  return `00${n}`.slice(-2);
}
function formatRemain(seconds) {
  if (seconds < 0 || !Number.isFinite(seconds))
    return "-:--";
  const h = seconds / 3600 | 0;
  const m = (seconds - h * 3600) / 60 | 0;
  const s = seconds - h * 3600 - m * 60;
  if (h > 0)
    return `${h}:${pad2(m)}:${pad2(s)}`;
  return `${pad2(m)}:${pad2(s)}`;
}

export class DownloadHelper {
  utils;
  constructor(utils) {
    this.utils = utils;
  }
  bootCSS = {
    href: "https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css",
    integrity: "sha384-sRIl4kxILFvY47J16cr9ZwB07vP4J8+LH7qKQnuqkuIAvNWLzeN8tE5YBujZqJLB"
  };
  bootJS = {
    src: "https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/js/bootstrap.bundle.min.js",
    integrity: "sha384-FKyoEForCGlyvwx9Hj09JcYn3nv7wiPVlz7YYwJrWVcXK/BmnVDxM+D2scQbITxI"
  };
  async createDownloadUI(title) {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    document.getElementsByTagName("html")[0].style.height = "100%";
    document.body.style.height = "100%";
    document.body.style.margin = "0";
    document.title = title;
    const bootLink = document.createElement("link");
    bootLink.href = this.bootCSS.href;
    bootLink.rel = "stylesheet";
    bootLink.integrity = this.bootCSS.integrity;
    bootLink.crossOrigin = "anonymous";
    document.head.appendChild(bootLink);
    const bodyDiv = document.createElement("div");
    bodyDiv.style.display = "flex";
    bodyDiv.style.alignItems = "center";
    bodyDiv.style.justifyContent = "center";
    bodyDiv.style.flexDirection = "column";
    bodyDiv.style.height = "100%";
    const inputDiv = document.createElement("div");
    inputDiv.className = "input-group mb-2";
    inputDiv.style.width = "400px";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "form-control";
    input.placeholder = "ここにJSONを貼り付け";
    inputDiv.appendChild(input);
    const button = document.createElement("button");
    button.className = "btn btn-outline-secondary btn-labeled";
    button.type = "button";
    button.innerText = "Download";
    inputDiv.appendChild(button);
    bodyDiv.appendChild(inputDiv);
    const progressDiv = document.createElement("div");
    progressDiv.className = "progress mb-3";
    progressDiv.style.width = "400px";
    const progress = document.createElement("div");
    progress.className = "progress-bar";
    progress.style.width = "0%";
    progress.innerText = "0%";
    progressDiv.setAttribute("role", "progressbar");
    progressDiv.setAttribute("aria-valuemin", "0");
    progressDiv.setAttribute("aria-valuemax", "100");
    progressDiv.setAttribute("aria-valuenow", "0");
    const setProgress = (n) => {
      progressDiv.setAttribute("aria-valuenow", `${n}`);
      progress.style.width = `${n}%`;
      progress.innerText = `${n}%`;
    };
    progressDiv.appendChild(progress);
    bodyDiv.appendChild(progressDiv);
    const infoDiv = document.createElement("div");
    infoDiv.style.width = "350px";
    const checkBoxDiv = document.createElement("div");
    checkBoxDiv.className = "form-check float-start";
    const checkBox = document.createElement("input");
    checkBox.className = "form-check-input";
    checkBox.type = "checkbox";
    checkBox.id = "LogCheck";
    checkBox.checked = true;
    checkBoxDiv.appendChild(checkBox);
    const checkBoxLabel = document.createElement("label");
    checkBoxLabel.className = "form-check-label";
    checkBoxLabel.setAttribute("for", "LogCheck");
    checkBoxLabel.innerText = "ログを自動スクロール";
    checkBoxDiv.appendChild(checkBoxLabel);
    infoDiv.appendChild(checkBoxDiv);
    const remainTimeDiv = document.createElement("div");
    remainTimeDiv.className = "float-end";
    remainTimeDiv.innerText = "残りおよそ -:--";
    const setRemainTime = (r) => remainTimeDiv.innerText = `残りおよそ ${r}`;
    infoDiv.appendChild(remainTimeDiv);
    bodyDiv.appendChild(infoDiv);
    const textarea = document.createElement("textarea");
    textarea.className = "form-control";
    textarea.readOnly = true;
    textarea.style.resize = "both";
    textarea.style.width = "500px";
    textarea.style.height = "80px";
    const textLog = (t) => {
      textarea.value += `${t}
`;
      if (checkBox.checked) {
        textarea.scrollTop = textarea.scrollHeight;
      }
    };
    bodyDiv.appendChild(textarea);
    document.body.appendChild(bodyDiv);
    const bootScript = document.createElement("script");
    bootScript.src = this.bootJS.src;
    bootScript.integrity = this.bootJS.integrity;
    bootScript.crossOrigin = "anonymous";
    document.body.appendChild(bootScript);
    const downloadFun = this.downloadZip.bind(this);
    button.onclick = async () => {
      button.disabled = true;
      const loadingFun = (event) => event.returnValue = `downloading`;
      window.addEventListener("beforeunload", loadingFun);
      try {
        await downloadFun(JSON.parse(input.value), setProgress, textLog, setRemainTime);
      } catch (e) {
        textLog("エラー出た");
        console.error(e);
      } finally {
        window.removeEventListener("beforeunload", loadingFun);
      }
    };
  }
  async downloadZip(downloadObj, progress, log, remainTime, options) {
    if (!this.isDownloadJsonObj(downloadObj))
      throw new Error("ダウンロード対象オブジェクトの型が不正");
    const utils = this.utils;
    const encodedId = utils.encodeFileName(downloadObj.id);
    if (!isValidPathSegment(encodedId)) {
      throw new Error(`downloadZip: id が不正な値です (encode 後: ${JSON.stringify(encodedId)})`);
    }
    const seenEncodedNames = new Set;
    for (const post of downloadObj.posts) {
      if (!isValidPathSegment(post.encodedName)) {
        throw new Error(`downloadZip: post.encodedName が不正な値です (${JSON.stringify(post.encodedName)})`);
      }
      if (seenEncodedNames.has(post.encodedName)) {
        throw new Error(`downloadZip: post.encodedName が重複しています (${post.encodedName})`);
      }
      seenEncodedNames.add(post.encodedName);
      if (post.cover !== undefined && !isValidPathSegment(post.cover.name)) {
        throw new Error(`downloadZip: post.cover.name が不正な値です (${JSON.stringify(post.cover.name)})`);
      }
      for (const file of post.files) {
        if (!isValidPathSegment(file.encodedName)) {
          throw new Error(`downloadZip: file.encodedName が不正な値です (${JSON.stringify(file.encodedName)})`);
        }
      }
    }
    const handle = options?.handle ?? await showSaveFilePicker({ suggestedName: `${encodedId}.zip` });
    const writable = await handle.createWritable();
    const zip = new ZipWriter(writable);
    try {
      const fetchFile = options?.fetchFile ?? ((url, name) => utils.fetchWithLimit({ url, name }, 1));
      const enqueue = async (fileBits, path, date) => {
        await zip.addFile(`${encodedId}/${path}`, await toUint8Array(fileBits), date);
      };
      const parsePublishedDate = (iso) => {
        if (!iso)
          return;
        const d = new Date(iso);
        return Number.isFinite(d.getTime()) ? d : undefined;
      };
      const startTime = Math.floor(Date.now() / 1000);
      let count = 0;
      let writtenFileCount = 0;
      let failedFileCount = 0;
      let completedPostCount = 0;
      let aborted = false;
      log(`@${downloadObj.id} 投稿:${downloadObj.postCount} ファイル:${downloadObj.fileCount}`);
      const rootDate = downloadObj.posts.reduce((max, post) => {
        const d = parsePublishedDate(post.publishedDatetime);
        if (d === undefined)
          return max;
        return max === undefined || d.getTime() > max.getTime() ? d : max;
      }, undefined);
      await zip.addDirectory(`${encodedId}/`, rootDate);
      await enqueue([this.createRootHtmlFromPosts(downloadObj)], "index.html", rootDate);
      let postCount = 0;
      postLoop:
        for (const post of downloadObj.posts) {
          if (options?.signal?.aborted) {
            aborted = true;
            break;
          }
          log(`${post.originalName} (${++postCount}/${downloadObj.postCount})`);
          const postDate = parsePublishedDate(post.publishedDatetime);
          await zip.addDirectory(`${encodedId}/${post.encodedName}/`, postDate);
          const informationFile = utils.createInformationFile(post.informationText);
          await enqueue(informationFile.content, `${post.encodedName}/${utils.encodeFileName(informationFile.name)}`, postDate);
          await enqueue([this.createHtmlFromBody(post.originalName, post.htmlText)], `${post.encodedName}/index.html`, postDate);
          if (post.cover) {
            log(`download ${post.cover.name}`);
            const blob = await fetchFile(post.cover.url, post.cover.name, { kind: "cover" });
            if (blob) {
              await enqueue([blob], `${post.encodedName}/${post.cover.name}`, postDate);
              writtenFileCount++;
            } else if (options?.signal?.aborted) {
              aborted = true;
              break;
            } else {
              failedFileCount++;
              console.error(`${post.cover.name}(${post.cover.url})のダウンロードに失敗、読み飛ばすよ`);
              log(`${post.cover.name}のダウンロードに失敗`);
            }
          }
          let fileCount = 0;
          for (const file of post.files) {
            if (options?.signal?.aborted) {
              aborted = true;
              break postLoop;
            }
            log(`download ${file.encodedName} (${++fileCount}/${post.files.length})`);
            const blob = await fetchFile(file.url, file.encodedName, { kind: "file" });
            if (blob) {
              await enqueue([blob], `${post.encodedName}/${file.encodedName}`, postDate);
              writtenFileCount++;
            } else if (options?.signal?.aborted) {
              aborted = true;
              break postLoop;
            } else {
              failedFileCount++;
              console.error(`${file.encodedName}(${file.url})のダウンロードに失敗、読み飛ばすよ`);
              log(`${file.encodedName}のダウンロードに失敗`);
            }
            count++;
            const elapsedSec = Math.max(1, Math.floor(Date.now() / 1000) - startTime);
            const remain = Math.floor(elapsedSec * (downloadObj.fileCount - count) / count);
            remainTime(formatRemain(remain));
            progress(count * 100 / downloadObj.fileCount | 0);
            await utils.sleep(100);
          }
          completedPostCount++;
        }
      if (!aborted) {
        if (failedFileCount > 0) {
          log(`完了 (${failedFileCount}件のダウンロードに失敗)`);
        } else {
          log("完了");
        }
      }
      await zip.close();
      return {
        completedPostCount,
        totalPostCount: downloadObj.posts.length,
        writtenFileCount,
        failedFileCount,
        aborted
      };
    } catch (e) {
      await zip.abort(e);
      throw e;
    }
  }
  isDownloadJsonObj(target) {
    if (typeof target !== "object" || target === null) {
      console.error("ダウンロード用オブジェクトの型が不正(対象がobjectでない)", target);
      return false;
    }
    const t = target;
    switch (true) {
      case typeof t.postCount !== "number":
        console.error("ダウンロード用オブジェクトの型が不正(postCountが数値でない)", t.postCount);
        return false;
      case typeof t.fileCount !== "number":
        console.error("ダウンロード用オブジェクトの型が不正(fileCountが数値でない)", t.fileCount);
        return false;
      case typeof t.id !== "string":
        console.error("ダウンロード用オブジェクトの型が不正(idが文字列でない)", t.id);
        return false;
      case typeof t.url !== "string":
        console.error("ダウンロード用オブジェクトの型が不正(urlが文字列でない)", t.url);
        return false;
      case !Array.isArray(t.posts):
        console.error("ダウンロード用オブジェクトの型が不正(postsが配列でない)", t.posts);
        return false;
      case !Array.isArray(t.tags):
        console.error("ダウンロード用オブジェクトの型が不正(tagsが配列でない)", t.tags);
        return false;
    }
    return !t.posts.some((it) => {
      if (typeof it !== "object" || it === null) {
        console.error("ダウンロード用オブジェクトの型が不正(postsの値にobjectでないものが含まれる)", it, t.posts);
        return true;
      }
      const p = it;
      switch (true) {
        case typeof p.informationText !== "string":
          console.error("ダウンロード用オブジェクトの型が不正(postsの値にinformationTextが文字列でないものが含まれる)", p.informationText, t.posts);
          return true;
        case typeof p.htmlText !== "string":
          console.error("ダウンロード用オブジェクトの型が不正(postsの値にhtmlTextが文字列でないものが含まれる)", p.htmlText, t.posts);
          return true;
        case !Array.isArray(p.files):
          console.error("ダウンロード用オブジェクトの型が不正(postsの値にfilesが配列でないものが含まれる)", p.files, t.posts);
          return true;
        case !Array.isArray(p.tags):
          console.error("ダウンロード用オブジェクトの型が不正(postsの値にtagsが配列でないものが含まれる)", p.tags, t.posts);
          return true;
        case p.files.some((f) => {
          if (typeof f !== "object" || f === null) {
            console.error("ダウンロード用オブジェクトの型が不正(postsのfilesの値にオブジェクトでないものが含まれる)", f, p.files);
            return true;
          }
          const fo = f;
          switch (true) {
            case typeof fo.url !== "string":
              console.error("ダウンロード用オブジェクトの型が不正(postsのfilesの値にurlが文字列でないものが含まれる)", fo.url, p.files);
              return true;
            case typeof fo.originalName !== "string":
              console.error("ダウンロード用オブジェクトの型が不正(postsのfilesの値にoriginalNameが文字列でないものが含まれる)", fo.originalName, p.files);
              return true;
            case typeof fo.encodedName !== "string":
              console.error("ダウンロード用オブジェクトの型が不正(postsのfilesの値にencodedNameが文字列でないものが含まれる)", fo.encodedName, p.files);
              return true;
            default:
              return false;
          }
        }):
          return true;
      }
      if (p.publishedDatetime !== undefined && typeof p.publishedDatetime !== "string") {
        console.error("ダウンロード用オブジェクトの型が不正(postsの値にpublishedDatetimeが文字列でないものが含まれる)", p.publishedDatetime, t.posts);
        return true;
      }
      const cover = p.cover;
      if (cover !== undefined) {
        if (typeof cover !== "object" || cover === null) {
          console.error("ダウンロード用オブジェクトの型が不正(postsの値にcoverがobjectでないものが含まれる)", cover, t.posts);
          return true;
        }
        if (typeof cover.url !== "string") {
          console.error("ダウンロード用オブジェクトの型が不正(postsのcoverの値にurlが文字列でないものが含まれる)", cover.url, cover);
          return true;
        }
        if (typeof cover.name !== "string") {
          console.error("ダウンロード用オブジェクトの型が不正(postsのcoverの値にnameが文字列でないものが含まれる)", cover.name, cover);
          return true;
        }
      }
      return false;
    });
  }
  createRootHtmlFromPosts(downloadObj) {
    const escapedId = this.utils.escapeHtml(downloadObj.id);
    const escapedUrl = this.utils.escapeHtml(downloadObj.url);
    const tagCheckboxes = downloadObj.tags.map((tag, i) => {
      const escaped = this.utils.escapeHtml(tag);
      return `<li><div class="form-check mx-1">
` + `<input class="form-check-input tag-filter" type="checkbox" value="${escaped}" id="box${i + 1}">
` + `<label class="form-check-label" for="box${i + 1}">${escaped}</label>
` + `</div></li>
`;
    }).join("");
    const header = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>${escapedId}</title>
` + `<link href="${this.bootCSS.href}" rel="stylesheet" integrity="${this.bootCSS.integrity}" crossOrigin="anonymous">
` + "<style>div.main{width: 600px; float: none; margin: 65px auto 0}div.root{width: 400px}div.post{width: 600px}" + "a.hl,a.hl:hover{color: inherit;text-decoration: none;}div.card{float: none; margin: 0 auto;}" + "img.gray-card{height: 210px;background-color: gray;}" + "div.gray-carousel{height: 210px; width: 400px;background-color: gray;}" + `img.pd-carousel{height: 210px; padding: 15px;}</style>
` + `</head>
<body>
<div class="main" id="main">
`;
    const body = `<nav class="navbar navbar-expand-lg bg-dark fixed-top" data-bs-theme="dark"><div class="container-fluid">
` + `<a class="navbar-brand" href="${escapedUrl}">${escapedId}</a>
` + `<button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#dd" aria-controls="dd" aria-expanded="false" aria-label="Toggle navigation">
` + `<span class="navbar-toggler-icon"></span>
` + `</button>
` + `<div class="collapse navbar-collapse" id="dd"><ul class="navbar-nav">
` + `<li class="nav-item dropdown">
` + `<a class="nav-link dropdown-toggle" href="#" id="navbarDarkDropdownMenuLink" role="button" data-bs-toggle="dropdown" aria-expanded="false">Tags</a>
` + `<ul class="dropdown-menu dropdown-menu-dark" aria-labelledby="dd">
` + tagCheckboxes + `</ul>
</li>
</ul></div>
</div></nav>

` + downloadObj.posts.map((post) => `<div class="post-item" data-tags="${this.utils.escapeHtml(JSON.stringify(post.tags))}">
` + `<a class="hl" href="./${this.utils.encodeURI(post.encodedName)}/index.html"><div class="root card">
` + this.createCoverHtmlFromPost(post) + `<div class="card-body"><h5 class="card-title">${this.utils.escapeHtml(post.originalName)}</h5></div>
</div></a><br>
</div>
`).join(`
`);
    const footer = `
</div>
` + `<script>
` + `document.addEventListener('DOMContentLoaded', function() {
` + `  var checkboxes = document.querySelectorAll('.tag-filter');
` + `  var posts = document.querySelectorAll('.post-item');
` + `  function updateVisibility() {
` + `    var selected = Array.from(checkboxes)
` + `      .filter(function(cb) { return cb.checked; })
` + `      .map(function(cb) { return cb.value; });
` + `    posts.forEach(function(post) {
` + `      var tags = JSON.parse(post.getAttribute('data-tags'));
` + `      post.style.display = (!selected.length ||
` + `        selected.every(function(s) { return tags.indexOf(s) !== -1; }))
` + `        ? '' : 'none';
` + `    });
` + `  }
` + `  checkboxes.forEach(function(cb) { cb.addEventListener('change', updateVisibility); });
` + `});
` + `</script>
` + `<script src="${this.bootJS.src}" integrity="${this.bootJS.integrity}" crossOrigin="anonymous"></script>
` + "</body></html>";
    return header + body + footer;
  }
  createCoverHtmlFromPost(post) {
    const postUri = `./${this.utils.encodeURI(post.encodedName)}/`;
    if (post.cover) {
      return `<img class="card-img-top gray-card" src="${postUri}${this.utils.encodeURI(post.cover.name)}" alt="カバー画像"/>
`;
    }
    const images = post.files.filter((file) => this.utils.isImage(file.encodedName));
    if (images.length > 0) {
      return '<div class="carousel slide" data-bs-ride="carousel" data-interval="1000"><div class="carousel-inner">' + `
<div class="carousel-item active">` + images.map((img) => '<div class="d-flex justify-content-center gray-carousel">' + `<img src="${postUri}${this.utils.encodeURI(img.encodedName)}" class="d-block pd-carousel" height="180px"/></div>`).join(`</div>
<div class="carousel-item">`) + `</div>
</div></div>
`;
    } else {
      return `<img class="card-img-top gray-card"/>
`;
    }
  }
  createHtmlFromBody(title, body) {
    return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>${this.utils.escapeHtml(title)}</title>
` + `<link href="${this.bootCSS.href}" rel="stylesheet" integrity="${this.bootCSS.integrity}" crossOrigin="anonymous">
` + "<style>div.main{width: 600px; float: none; margin: 0 auto}div.root{width: 400px}div.post{width: 600px}" + "a.hl,a.hl:hover{color: inherit;text-decoration: none;}div.card{float: none; margin: 0 auto;}" + "img.gray-card{height: 210px;background-color: gray;}" + "div.gray-carousel{height: 210px; width: 400px;background-color: gray;}" + `img.pd-carousel{height: 210px; padding: 15px;}</style>
` + `</head>
<body>
<div class="main">
${body}
</div>
` + `<script src="${this.bootJS.src}" integrity="${this.bootJS.integrity}" crossOrigin="anonymous"></script>
` + "</body></html>";
  }
}
