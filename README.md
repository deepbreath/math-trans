# Math Academy Bilingual Translator

一个用于 `https://www.mathacademy.com/` 的 Chrome Manifest V3 扩展。扩展会在页面中扫描可见英文内容，并把中文翻译以双语形式插入到原文下方或原文后方。

## 使用方式

1. 打开 Chrome，进入 `chrome://extensions/`。
2. 开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本仓库目录：`math-trans`。
5. 打开 `https://www.mathacademy.com/`，点击扩展图标配置翻译服务。

## 翻译服务

扩展支持三种翻译服务：

1. `Google 免费`：按 Pot Desktop 的 Google 翻译实现方式，使用 Google Translate 网页端接口，不需要 API Key。
2. `Gemini API`：使用 Google Gemini API，需要 Gemini API Key。
3. `OpenAI API`：使用 OpenAI Responses API，需要 OpenAI API Key。

默认使用 `Google 免费`，调用：

```http
GET https://translate.google.com/translate_a/single?client=gtx
```

主要参数包含 `client=gtx`、`sl`、`tl`、`hl`、`ie=UTF-8`、`oe=UTF-8` 和 `q`。这和 `pot-app/pot-desktop` 中 `src/services/translate/google/index.jsx` 的思路一致。

Gemini API 调用：

```http
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
```

OpenAI API 调用：

```http
POST https://api.openai.com/v1/responses
```

Gemini 和 OpenAI 会批量发送一组待翻译文本，并要求模型只返回同顺序、同长度的 JSON 字符串数组。

## 文件结构

- `manifest.json`：Chrome 扩展声明。
- `src/background.js`：设置读取、翻译请求和缓存。
- `src/content.js`：Math Academy 页面内容扫描与双语渲染。
- `src/content.css`：页面内翻译样式。
- `src/popup.html` / `src/popup.js`：扩展弹窗。
- `src/options.html` / `src/options.js`：完整设置页。

## 注意

- 扩展会跳过公式、代码、输入框、纯数字和过短文本，尽量避免破坏课程页面布局。
- Math Academy 是动态页面，扩展使用 `MutationObserver` 自动处理后续加载的内容。
- 这个接口不是 Google Cloud 官方付费 API，不保证长期稳定，可能被限流或变更返回格式。
- 如果默认 Google 域名不可用，可以在扩展弹窗里配置其他可访问的 Google Translate 地址。
- Gemini/OpenAI 的 API Key 会保存在 Chrome 扩展同步存储中。本地自用可以接受；如果要发布扩展，建议改成后端代理，避免密钥暴露在浏览器端。
