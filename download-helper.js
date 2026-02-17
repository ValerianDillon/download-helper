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
    return JSON.parse(request.responseText);
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
  async embedScript(url) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = url;
      script.onload = () => resolve(script);
      script.onerror = (e) => reject(e);
      document.head.appendChild(script);
    });
  }
}

export class DownloadObject {
  downloadObj;
  utils;
  orderedPosts = [];
  url = "#main";
  tags;
  constructor(id, utils) {
    this.downloadObj = { posts: {}, id };
    this.utils = utils;
  }
  stringify() {
    const downloadJson = {
      posts: this.orderedPosts.map((it) => it.toJsonObjBy(this.downloadObj.posts)),
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
    const encodedName = this.utils.encodeFileName(name);
    if (this.downloadObj.posts[encodedName] === undefined) {
      this.downloadObj.posts[encodedName] = [];
    }
    const postObj = { name, info: "", files: {}, html: "", tags: [] };
    this.downloadObj.posts[encodedName].push(postObj);
    const postObject = new PostObject(postObj, this.utils);
    this.orderedPosts.push(postObject);
    return postObject;
  }
  countPost() {
    return Object.values(this.downloadObj.posts).reduce((s, posts) => s + posts.length, 0);
  }
  countFile() {
    return Object.values(this.downloadObj.posts).reduce((allFileSize, posts) => allFileSize + posts.reduce((postFileSize, post) => postFileSize + Object.values(post.files).reduce((s, files) => s + files.length, 0), 0), 0);
  }
  collectTags() {
    const tags = new Set;
    for (const posts of Object.values(this.downloadObj.posts)) {
      for (const post of posts) {
        for (const tag of post.tags) {
          tags.add(tag);
        }
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
    this.postObj.html = html;
  }
  setTags(tags) {
    this.postObj.tags = tags;
  }
  setCover(name, extension, url) {
    const fileObj = { name, extension: extension ? `.${extension}` : "", url };
    this.postObj.cover = fileObj;
    return new FileObject(fileObj, this.utils);
  }
  addFile(name, extension, url) {
    const encodedName = this.utils.encodeFileName(name);
    if (this.postObj.files[encodedName] === undefined) {
      this.postObj.files[encodedName] = [];
    }
    const fileObj = { name, extension: extension ? `.${extension}` : "", url };
    this.postObj.files[encodedName].push(fileObj);
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
    const filePath = this.getCurrentFilePath(fileObject);
    return `<a class="hl" href="${filePath}" download="${fileObject.getEncodedName() + fileObject.getEncodedExtension()}"><div class="post card">
` + `<div class="card-header">${fileObject.getOriginalName()}</div>
` + `<audio class="card-img-top" src="${filePath}" controls/>
</div></a>`;
  }
  getLinkTag(url, title) {
    return `<a class="hl" href="${url}"><div class="post card text-center"><p class="pt-2">
` + `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-box-arrow-up-left" viewBox="0 0 16 16">
` + `<path fill-rule="evenodd" d="M7.364 3.5a.5.5 0 0 1 .5-.5H14.5A1.5 1.5 0 0 1 16 4.5v10a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 3 14.5V7.864a.5.5 0 1 1 1 0V14.5a.5.5 0 0 0 .5.5h10a.5.5 0 0 0 .5-.5v-10a.5.5 0 0 0-.5-.5H7.864a.5.5 0 0 1-.5-.5z"/>
` + `<path fill-rule="evenodd" d="M0 .5A.5.5 0 0 1 .5 0h5a.5.5 0 0 1 0 1H1.707l8.147 8.146a.5.5 0 0 1-.708.708L1 1.707V5.5a.5.5 0 0 1-1 0v-5z"/>
` + `</svg> ${title}</p></div></a>`;
  }
  getFileLinkTag(fileObject) {
    const filePath = this.getCurrentFilePath(fileObject);
    return `<a class="hl" href="${filePath}" download="${fileObject.getEncodedName() + fileObject.getEncodedExtension()}">` + `<div class="post card text-center"><p class="pt-2">
` + `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-download" viewBox="0 0 16 16">
` + `<path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
` + `<path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>
` + `</svg> ${fileObject.getOriginalName() + fileObject.getOriginalExtension()}</p></div></a>`;
  }
  getImageLinkTag(fileObject) {
    const filePath = this.getCurrentFilePath(fileObject);
    return `<a class="hl" href="${filePath}" download="${fileObject.getEncodedName() + fileObject.getEncodedExtension()}"><div class="post card">
` + `<img class="card-img-top" src="${filePath}" alt="${fileObject.getOriginalName()}"/>
</div></a>`;
  }
  getVideoLinkTag(fileObject) {
    const filePath = this.getCurrentFilePath(fileObject);
    return `<a class="hl" href="${filePath}" download="${fileObject.getEncodedName() + fileObject.getEncodedExtension()}"><div class="post card">
` + `<video class="card-img-top" src="${filePath}" controls/>
</div></a>`;
  }
  getCurrentFilePath(fileObject) {
    const encodedName = fileObject.getEncodedName();
    if (fileObject.equals(this.postObj.cover)) {
      const fileName = this.utils.getFileName(encodedName, fileObject.getEncodedExtension(), 1, 0, true);
      return `./${this.utils.encodeURI(fileName)}`;
    }
    if (this.postObj.files[encodedName] === undefined) {
      throw new Error(`file object is undefined: ${fileObject.getOriginalName()}`);
    }
    const index = this.postObj.files[encodedName].findIndex((it) => fileObject.equals(it));
    if (index < 0) {
      throw new Error(`file object is not found: ${fileObject.getOriginalName()}`);
    }
    const fileName = this.utils.getFileName(encodedName, fileObject.getEncodedExtension(), this.postObj.files[encodedName].length, index, true);
    return `./${this.utils.encodeURI(fileName)}`;
  }
  toJsonObjBy(posts) {
    const key = this.utils.encodeFileName(this.postObj.name);
    const postIndex = posts[key]?.indexOf(this.postObj);
    if (postIndex === undefined || postIndex < 0) {
      throw new Error(`post object is not found: ${this.postObj.name}`);
    }
    const encodedName = this.utils.getFileName(key, "", posts[key].length, postIndex, false);
    const cover = this.postObj.cover ? {
      url: this.postObj.cover.url,
      name: this.utils.getFileName(this.postObj.cover.name, this.postObj.cover.extension, 1, 0, true)
    } : undefined;
    return {
      originalName: this.postObj.name,
      encodedName,
      informationText: this.postObj.info,
      htmlText: this.postObj.html,
      files: this.collectFiles(),
      tags: this.postObj.tags,
      cover
    };
  }
  collectFiles() {
    const ret = [];
    for (const [key, fileObjArray] of Object.entries(this.postObj.files)) {
      let fileIndex = 0;
      for (const fileObj of fileObjArray) {
        const extension = fileObj.extension ? this.utils.encodeFileName(fileObj.extension) : "";
        const encodedName = this.utils.getFileName(key, extension, fileObjArray.length, fileIndex++, true);
        ret.push({
          url: fileObj.url,
          originalName: fileObj.name,
          encodedName
        });
      }
    }
    return ret;
  }
}

export class FileObject {
  fileObj;
  utils;
  constructor(fileObj, utils) {
    this.fileObj = fileObj;
    this.utils = utils;
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
  equals(obj) {
    if (typeof obj !== "object" || obj === null) {
      return false;
    }
    const candidate = obj;
    return candidate.name === this.fileObj.name && candidate.url === this.fileObj.url;
  }
}

export class DownloadHelper {
  utils;
  constructor(utils) {
    this.utils = utils;
  }
  bootCSS = {
    href: "https://cdn.jsdelivr.net/npm/bootstrap@5.0.0-beta1/dist/css/bootstrap.min.css",
    integrity: "sha384-giJF6kkoqNQ00vy+HMDP7azOuL0xtbfIcaT9wjKHr8RbDVddVHyTfAAsrekwKmP1"
  };
  bootJS = {
    src: "https://cdn.jsdelivr.net/npm/bootstrap@5.0.0-beta1/dist/js/bootstrap.bundle.min.js",
    integrity: "sha384-ygbV9kiqUc6oa4msXn9868pTtWMgiQaeYH7/t7LECLbyPA2x65Kgf80OJFdroafW"
  };
  vueJS = {
    src: "https://unpkg.com/vue@3.2.28/dist/vue.global.js"
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
    const buttonDiv = document.createElement("div");
    buttonDiv.className = "input-group-append";
    const button = document.createElement("button");
    button.className = "btn btn-outline-secondary btn-labeled";
    button.type = "button";
    button.innerText = "Download";
    buttonDiv.appendChild(button);
    inputDiv.appendChild(buttonDiv);
    bodyDiv.appendChild(inputDiv);
    const progressDiv = document.createElement("div");
    progressDiv.className = "progress mb-3";
    progressDiv.style.width = "400px";
    const progress = document.createElement("div");
    progress.className = "progress-bar";
    progress["role"] = "progressbar";
    progress["aria-valuemin"] = "0";
    progress["aria-valuemax"] = "100";
    progress["aria-valuenow"] = "0";
    progress.style.width = "0%";
    progress.innerText = "0%";
    const setProgress = (n) => {
      progress["aria-valuenow"] = `${n}`;
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
    checkBoxLabel["for"] = "LogCheck";
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
  async downloadZip(downloadObj, progress, log, remainTime) {
    if (!this.isDownloadJsonObj(downloadObj))
      throw new Error("ダウンロード対象オブジェクトの型が不正");
    const ui = this;
    const utils = this.utils;
    await utils.embedScript("https://cdn.jsdelivr.net/npm/web-streams-polyfill@2.0.2/dist/ponyfill.min.js");
    await utils.embedScript("https://cdn.jsdelivr.net/npm/streamsaver@2.0.6/StreamSaver.js");
    await utils.embedScript("https://cdn.jsdelivr.net/npm/streamsaver@2.0.6/examples/zip-stream.js");
    const encodedId = utils.encodeFileName(downloadObj.id);
    const fileStream = streamSaver.createWriteStream(`${encodedId}.zip`);
    const readableZipStream = new createWriter({
      async pull(ctrl) {
        const startTime = Math.floor(Date.now() / 1000);
        let count = 0;
        const enqueue = (fileBits, path) => ctrl.enqueue(new File(fileBits, `${encodedId}/${path}`));
        log(`@${downloadObj.id} 投稿:${downloadObj.postCount} ファイル:${downloadObj.fileCount}`);
        enqueue([ui.createRootHtmlFromPosts(downloadObj)], "index.html");
        let postCount = 0;
        for (const post of downloadObj.posts) {
          log(`${post.originalName} (${++postCount}/${downloadObj.postCount})`);
          const informationFile = utils.createInformationFile(post.informationText);
          enqueue(informationFile.content, `${post.encodedName}/${utils.encodeFileName(informationFile.name)}`);
          enqueue([ui.createHtmlFromBody(post.originalName, post.htmlText)], `${post.encodedName}/index.html`);
          if (post.cover) {
            log(`download ${post.cover.name}`);
            const blob = await utils.fetchWithLimit(post.cover, 1);
            if (blob) {
              enqueue([blob], `${post.encodedName}/${post.cover.name}`);
            }
          }
          let fileCount = 0;
          for (const file of post.files) {
            log(`download ${file.encodedName} (${++fileCount}/${post.files.length})`);
            const blob = await utils.fetchWithLimit({ url: file.url, name: file.encodedName }, 1);
            if (blob) {
              enqueue([blob], `${post.encodedName}/${file.encodedName}`);
            } else {
              console.error(`${file.encodedName}(${file.url})のダウンロードに失敗、読み飛ばすよ`);
              log(`${file.encodedName}のダウンロードに失敗`);
            }
            count++;
            setTimeout(() => {
              const remain = Math.floor(Math.abs(Math.floor(Date.now() / 1000) - startTime) * (downloadObj.fileCount - count) / count);
              const h = remain / (60 * 60) | 0;
              const m = Math.ceil((remain - 60 * 60 * h) / 60);
              remainTime(`${h}:${("00" + m).slice(-2)}`);
              progress(count * 100 / downloadObj.fileCount | 0);
            }, 0);
            await utils.sleep(100);
          }
        }
        ctrl.close();
      }
    });
    if (window.WritableStream && readableZipStream.pipeTo) {
      return readableZipStream.pipeTo(fileStream).then(() => console.log("done writing"));
    }
    const writer = fileStream.getWriter();
    const reader = readableZipStream.getReader();
    const pump = () => reader.read().then((res) => res.done ? writer.close() : writer.write(res.value).then(pump));
    await pump();
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
          const cover = p.cover;
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
            case cover === undefined:
              return false;
            case typeof cover !== "object":
              console.error("ダウンロード用オブジェクトの型が不正(postsの値にcoverがobjectでないものが含まれる)", cover, t.posts);
              return true;
            case typeof cover?.url !== "string":
              console.error("ダウンロード用オブジェクトの型が不正(postsのcoverの値にurlが文字列でないものが含まれる)", cover?.url, cover);
              return true;
            case typeof cover?.name !== "string":
              console.error("ダウンロード用オブジェクトの型が不正(postsのcoverの値にnameが文字列でないものが含まれる)", cover?.name, cover);
              return true;
            default:
              return false;
          }
        }):
          return true;
        default:
          return false;
      }
    });
  }
  createRootHtmlFromPosts(downloadObj) {
    const header = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>${downloadObj.id}</title>
` + `<link href="${this.bootCSS.href}" rel="stylesheet" integrity="${this.bootCSS.integrity}" crossOrigin="anonymous">
` + "<style>div.main{width: 600px; float: none; margin: 65px auto 0}div.root{width: 400px}div.post{width: 600px}" + "a.hl,a.hl:hover{color: inherit;text-decoration: none;}div.card{float: none; margin: 0 auto;}" + "img.gray-card{height: 210px;background-color: gray;}" + "div.gray-carousel{height: 210px; width: 400px;background-color: gray;}" + `img.pd-carousel{height: 210px; padding: 15px;}</style>
` + `</head>
<body>
<div class="main" id="main">
`;
    const body = `<nav class="navbar navbar-expand-lg navbar-dark bg-dark fixed-top"><div class="container-fluid">
` + `<a class="navbar-brand" href="${downloadObj.url}">${downloadObj.id}</a>
` + `<button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#dd" aria-controls="dd" aria-expanded="false" aria-label="Toggle navigation">
` + `<span class="navbar-toggler-icon"></span>
` + `</button>
` + `<div class="collapse navbar-collapse" id="dd"><ul class="navbar-nav">
` + `<li class="nav-item dropdown">
` + `<a class="nav-link dropdown-toggle" href="#" id="navbarDarkDropdownMenuLink" role="button" data-bs-toggle="dropdown" aria-expanded="false">Tags</a>
` + `<ul class="dropdown-menu dropdown-menu-dark" aria-labelledby="dd">
` + `<li v-for="(tag,i) in [${downloadObj.tags.map((tag) => this.utils.toQuoted(tag)).join(",")}]">
` + ` <div class="form-check mx-1">
` + `<input class="form-check-input" type="checkbox" v-model="selected" :value="tag" :id="'box'+(i+1)">
` + `<label class="form-check-label" :for="'box'+(i+1)">{{tag}}</label>
` + `</div>
</li>
` + `</ul>
</li>
</ul></div>
</div></nav>

` + downloadObj.posts.map((post) => `<div v-show="isVisible([${post.tags.map((tag) => this.utils.toQuoted(tag)).join(", ")}], selected)">
` + `<a class="hl" href="./${this.utils.encodeURI(post.encodedName)}/index.html"><div class="root card">
` + this.createCoverHtmlFromPost(post) + `<div class="card-body"><h5 class="card-title">${post.originalName}</h5></div>
</div></a><br>
</div>
`).join(`
`);
    const footer = `
</div>
` + `<script src="${this.vueJS.src}"></script>
` + `<script>
Vue.createApp({
data() {return { selected: [] }},` + `methods: {
 isVisible(tags, selected) {
  if (!selected.length) return true
  return selected.every(it => tags.includes(it))
 }
}
` + `}).mount('#main')
</script>
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
<title>${title}</title>
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
