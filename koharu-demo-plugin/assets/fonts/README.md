# 公開ページの同梱フォント

確認日 2026年11月6日

公開ホームとサポートページにだけ使用します。MCP Appの書体とHTMLは変更しません。ビルド時にフォントをCSSへ埋め込み、表示時に外部のフォント配信先へ通信しない構成です。

## 出所と利用条件

| 項目 | 内容 |
|---|---|
| 原本 | Google Fontsの公式METADATA.pbが示す、MPLUS_FONTSの固定コミットから取得した可変TTF |
| 著作権表示 | Copyright 2021 The M+ FONTS Project Authors |
| 原本の書体名 | M PLUS 2、M PLUS 1 Code |
| 原本の版 | 両書体とも1.100。既存フロントエンドのWOFF2のnameテーブルでも1.100を確認 |
| 参照元 | https://github.com/coz-m/MPLUS_FONTS/tree/4bf69824e45a175b9121b248c46abff103569051 |
| 利用条件 | SIL Open Font License 1.1。原本のnameテーブルにライセンス名とURLを確認 |
| ライセンス本文 | Google Fontsが配布する両書体のOFL.txtが一致することを確認して同梱 |
| 加工 | 公開ページの現行テキスト、ASCII、円記号に必要な351文字へ絞り込み。M PLUS 2は太さ400と700、M PLUS 1 Codeは400を固定 |

[M PLUS 2のライセンス](https://raw.githubusercontent.com/google/fonts/main/ofl/mplus2/OFL.txt)と[M PLUS 1 Codeのライセンス](https://raw.githubusercontent.com/google/fonts/main/ofl/mplus1code/OFL.txt)を確認しています。いずれも著作権表示にReserved Font Nameの指定はありません。OFL本文は同梱ファイルと公開ページのCSSコメントに保持します。

原本の指定は[M PLUS 2の公式情報](https://raw.githubusercontent.com/google/fonts/main/ofl/mplus2/METADATA.pb)と[M PLUS 1 Codeの公式情報](https://raw.githubusercontent.com/google/fonts/main/ofl/mplus1code/METADATA.pb)で確認しました。元TTFのSHA-256はM PLUS 2が`0d9d9dd6e218900be7f1390ff6aae73686877f77c70a7e97466d94dfad3ddf59`、M PLUS 1 Codeが`ff68678c5bd7e9d9d6ab6d57e4355aabe30f6b8f8bff9bd59baf6a7807dcfd36`です。

## 同梱物

| ファイル | 太さ | バイト数 | SHA-256 |
|---|---:|---:|---|
| mplus2-regular-public.ttf | 400 | 78940 | 0831284fff1f4c1424271e4e30c385fd5abd01c3002964cbe1d6dbeae1ed6f1d |
| mplus2-bold-public.ttf | 700 | 81184 | 5ae33be639b52eaad4cd652cf000f4de464b5562d2a46e1d440ad4df83236717 |
| mplus1code-public.ttf | 400 | 60204 | c9a5e67f12826989801b8c898138ffba525bbde7e67a31bacfbecefbd5f904f1 |

3ファイルの合計は220328バイトです。FontToolsで加工後のcmapを読み直し、対象の351文字がすべて存在することを確認しました。公開ページの文言に新しい文字を追加する場合は、フォントにその文字が収録されているか確認し、必要に応じて再生成します。

原本の字体デザインは保持しています。フロントエンドが使う可変WOFF2の全238分割ファイルは複製していません。
