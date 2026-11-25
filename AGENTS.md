# download-helper

ブックマークレットとブラウザ拡張が共用する、FANBOX 収集ロジックと ZIP 生成の共有ライブラリ。
[furubarug/download-helper](https://github.com/furubarug/download-helper) から fork した。

利用側は 2 つある。ValerianDillon/fanbox-downloader (ブックマークレット) と ValerianDillon/fanbox-downloader-extension (Chrome 拡張)。
npm ではなく `github:ValerianDillon/download-helper#vX.X.X` (git tag) で参照される。

## コマンド

- `bun run build` — `build:js` (トランスパイル) と `build:types` (`.d.ts` 生成) をまとめて実行
- `bun run lint` — Biome による静的解析・フォーマット修正
- `bun run typecheck` — `tsc --noEmit`
- `bun test` — ユニットテスト

## ビルド成果物の扱い

- `download-helper.js` / `fanbox-collector.js` / `api-session.js` / `dist/types/*.d.ts` は git 管理対象。ビルド後に差分があればコミットする
- `.d.ts` を `.ts` と同じディレクトリではなく `dist/types/` に置くのは、宣言間の相対 import が `exports` を通らず `.ts` を再び選びうるため (Issue #12)。`dist/types/` 内で相対 import が閉じるようにしている
- `.ts` は `files` / `exports` に含めない。ただし `github:` 参照では `files` がフィルタとして機能しない (Bun は無視する) ので、リポジトリ自体には残る

## 環境の制約

- ZIP 書き込みは File System Access API による自前実装。Chrome / Edge でしか動かない
- Bootstrap 5.3 は CDN から動的に読み込む。runtime の依存パッケージは持たない

## 設計の背景をどこに書くか

「なぜその形にしたか」は共有ruleである `.claude/rules/` に置き、ここには重複させない。
Claude Codeは対象ファイルを読むとpath-scoped ruleを自動読込する。
Codexはファイルを編集する前に、各ruleのYAML frontmatterにある `paths` を照合し、該当するruleをすべて読んで従う。

| ルール | 対象 |
| --- | --- |
| `download-helper.md` | アセットの identity と archive path、選択条件からの導出、picker より前の検証、対象単位の書き込み結果、ZIP のパス衝突 |
| `fanbox-collector.md` | `addByPostInfo` の検証境界 |

各 API の契約は型の JSDoc が SoT。ルールと重複させない。

## コーディング規約

- Biome (recommended ルールセット) で強制。設定は `biome.json` が SoT
- JSDoc は日本語で書く
- **交差型の `}` と `& (` の間にコメントを置かない。** Biome が実行のたびに行順を並べ替えるため `bun run lint` が冪等でなくなり、CI の「lint / build 後に作業ツリーが汚れていないこと」の検査が必ず落ちる。型の説明は宣言の上の JSDoc に書く

## Git 運用

- コミットの author/committer は ValerianDillon であること
- `gh` の既定リポジトリは `gh repo set-default ValerianDillon/download-helper` で固定してある (設定が無いと fork 元 furubarug/download-helper へ解決される)。クローンし直したら再設定する。`gh pr create` には `--base main` を指定する

## リリース手順

main に push されるたびに、tagpr (`.github/workflows/tagpr.yml`、設定は `.tagpr`) が未リリースの変更をまとめた release の PR (題は `Release for vX.Y.Z`) を作るか更新する。
release の PR は `package.json` の `version` だけを変える。CHANGELOG と GitHub Release は作らない。

1. release の PR の version を決める。既定は patch で、release の PR に `tagpr:minor` か `tagpr:major` のラベルを付けると上がる。破壊的変更を含むなら `tagpr:major` にする。release の PR の `package.json` を直接直した値はラベルより優先される
2. release の PR を merge すると、tagpr が merge の後の main に `vX.Y.Z` のタグを打つ
3. 利用側 2 リポジトリの `package.json` の tag 参照を更新する

release の PR は `GITHUB_TOKEN` で作られるので、その PR の CI は書き込み権限のある人が承認するまで走らない。
