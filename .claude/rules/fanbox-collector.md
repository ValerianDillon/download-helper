---
paths:
  - 'fanbox-collector.ts'
  - 'fanbox-collector.test.ts'
---

# fanbox-collector の検証境界

`addByPostInfo` の入口が検証境界。収集が実際に読むフィールドだけを厳密に確かめ、情報 JSON に写すだけの付随メタデータは型を見ない (`invalid` は収集全体の中断を意味するため、読まないフィールドの型変化で全件止めない)。

- asset の `id` は必須。`imageMap` / `fileMap` はマップのキーと値の `id` が一致することも確かめる。identity として使う以上、不一致のまま通すと別のアセットを同一視しうる
- `body.images` / `body.files` 内で `id` が重複していれば `invalid`
- `size` / `width` / `height` は非負の安全な整数でなければ欠落として扱う
- `PostObj.postId` の一意性は検証しない。一覧ページの重複などで同じ投稿が 2 回来ても収集を止めないことを優先する。同じ postId の投稿が 2 件あれば選択は両方に同時に効く

`addByPostInfo` の戻り値 `AddPostResult` は、呼び出し側が「投稿単位の欠落として続行してよい失敗」と「API 仕様への追随が必要な失敗」を区別できるように判別可能な形にしてある。各 variant の意味は型の JSDoc が SoT。
