# download-helper

ダウンローダーで使うパッケージ

## 対応ブラウザ

Chrome / Edge (File System Access API を使用)

## 使い方

```bash
npm install --save github:ValerianDillon/download-helper#v4.3.0
```

## 既知の制限

`ZipWriter` は ZIP64 を実装しておらず、classic ZIP の固定長フィールド (uint16 / uint32) に値を直接書き込む。

- エントリ数が 65,535 件以上になると壊れた ZIP を出力する (EOCD のエントリ数は uint16)
- 各エントリの圧縮後 / 展開後サイズ、および Central Directory のサイズとオフセットが `0xFFFFFFFF` bytes 以上になると壊れた ZIP を出力する (uint32)
- エントリ名の長さが 65,535 bytes (UTF-8) を超えると、長さフィールド (uint16) だけが桁あふれし、名前のバイト列自体は全長書き込まれるため、境界のずれた壊れた ZIP を出力する。この上限は ZIP64 でも拡張されない

EOCD のエントリ数、および ZIP64 で拡張されるサイズ・オフセットの各フィールドでは、`0xFFFF` / `0xFFFFFFFF` は APPNOTE 4.4.1.4 が定める ZIP64 の sentinel 値であり、通常のフィールド値として書くことはできない (エントリ名長のように ZIP64 で拡張されないフィールドには当てはまらない)。上限超過の検出とエラー化、または ZIP64 対応は別途行う。
