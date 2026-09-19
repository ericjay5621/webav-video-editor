# WebAV Video Editor · 浏览器视频编辑器

[在线体验](https://ericjay5621.github.io/webav-video-editor/) · [English](README.md) · [参与贡献](CONTRIBUTING.md) · [MIT 许可证](LICENSE)

基于 React、TypeScript、WebAV 和 WebCodecs 的本地视频编辑 Demo。可以在浏览器里导入素材、编辑时间轴、添加字幕和转场，最后导出 MP4。当前实现不需要上传媒体，也不依赖服务端渲染或 API Key。

这是功能验证工程和集成参考。界面为中文，保留 React 16 / Webpack 4 技术栈，方便研究如何接入旧版前端工程。接入生产前需要进一步验证兼容性、性能和依赖安全。

## 可以做什么

| 功能 | 使用方式 |
| --- | --- |
| 素材导入与预览 | 点击“导入素材”；点击卡片预览；点击“加入”才放入时间轴，同一素材可重复加入 |
| 基础剪辑 | 选中时间轴片段后移动、裁剪、分割、复制或删除；使用“撤销 / 重做”恢复操作 |
| 中间插入内容 | 选中片段，点击“在此前插入 / 在此后插入”，选择视频、图片、音频或新建文字；后续内容顺延，跨越插入点的片段自动分割 |
| 视频原声 | 默认跟随视频编辑；在音频面板“分离音频”后，可单独编辑音频片段 |
| 轨道控制 | 点击轨道的锁定、隐藏或静音按钮；支持全部音频的控制 |
| 文字 | 在“文本”中设置内容、字号、颜色等样式并添加；时长可在右侧修改，拖动片段边缘可裁剪 |
| 字幕 | 在“字幕”中导入 SRT/VTT 或输入字幕，生成后可继续编辑并同步到时间轴 |
| 画面调节 | 右侧面板调整位置、尺寸、旋转、透明度、速度、亮度、对比度、饱和度和蒙版；支持基础关键帧 |
| 转场 | 选择后一段视频或图片，在“转场”中选择叠化、黑场、左推、右推或缩放，设置时长后应用 |
| 场景分析 | 在智能工具中分析画面变化，预览候选切点后决定是否分割 |
| 草稿与导出 | 草稿保存到当前浏览器；点击“导出”按时间轴合成 MP4 |

导入只增加素材库条目。只有时间轴中的内容参与最终导出。删除素材库条目前会提示受影响的片段数量；电脑上的原文件保留。

## 启动

无需安装即可打开[在线演示](https://ericjay5621.github.io/webav-video-editor/)。使用桌面 Chrome / Edge，导入自己的短测试文件开始体验。素材在当前浏览器中处理；线上草稿与 localhost 的草稿相互独立。下文列出的实验性边界同样适用于线上版本。

需要 Node.js 22、npm，以及支持 WebCodecs 的桌面 Chrome / Edge。建议先用短时 H.264/AAC MP4 测试。

```sh
git clone https://github.com/ericjay5621/webav-video-editor.git
cd webav-video-editor
npm ci
```

macOS / Linux：

```sh
NODE_OPTIONS=--openssl-legacy-provider npm run dev
```

Windows PowerShell：

```powershell
$env:NODE_OPTIONS="--openssl-legacy-provider"
npm run dev
```

打开 **http://localhost:8092/**。Webpack 4 在较新的 Node 中需要上述 OpenSSL 兼容参数。网页需要通过 localhost 或 HTTPS 访问，不支持双击打开 HTML 文件。

## 技术路线

- React 16.12.0：界面与交互。
- TypeScript 4.4.4、Webpack 4.44.2：类型检查与构建。
- `@webav/av-canvas` 1.2.8：画布预览和画面交互。
- `@webav/av-cliper` 1.2.8：媒体解码、片段、合成和 MP4 输出，底层使用 WebCodecs。
- `src/editor/WebAVRuntime.ts`：编辑操作、媒体生命周期、撤销重做与导出。
- `src/editor/draftStore.ts`：浏览器 IndexedDB 草稿存储。

应用没有依赖企业内部组件库、MobX 或 ffmpeg.wasm。FFmpeg 只用于可选测试素材生成，不会进入浏览器运行包。

## 验证与构建

```sh
npm run type-check
npm test
NODE_OPTIONS=--openssl-legacy-provider npm run build
```

PowerShell 先按上文设置环境变量，再运行 `npm run build`。输出目录为 `dist/`。部署时使用 HTTPS，并将文件放在站点根路径。开发服务器只用于本地调试。

部署到子路径时，可设置 `PUBLIC_PATH=/webav-video-editor/`。仓库的 [Pages 工作流](.github/workflows/deploy-pages.yml) 会读取站点路径，在 `main` 的源码变更后检查、构建并发布 `dist/`。本地开发仍使用根路径和 `8092` 端口。部署与回滚说明见 [DEPLOYMENT.md](DEPLOYMENT.md)。

`npm test` 包含四组逻辑回归检查，部分媒体对象使用模拟实现，不能替代真实浏览器的解码、播放和导出测试。

需要真实浏览器回归时，安装 FFmpeg 后运行：

```sh
npm run test:fixtures
NODE_OPTIONS=--openssl-legacy-provider node scripts/serve-trim-history-test.cjs
```

打开终端打印的地址，点击“开始测试”。命令最后加上 `insertion-browser.ts` 或 `transition-browser.ts`，可切换插入、转场测试。测试使用独立页面和合成素材，不读取编辑器草稿。

## 当前边界

- 发布前真实浏览器测试有两项未通过：分割后重做的选中状态恢复，以及动态 MP4 右推转场的预览与导出像素比对。验证范围见 [VALIDATION.md](VALIDATION.md)。
- 自动语音识别、云端协作、素材商城未实现；部分导航保留接入位置。
- 英文界面尚未实现；也没有承诺完整复刻剪映。
- 长时间轴缩放到全局时，短片段有最小显示宽度，视觉宽度可能与精确时间比例不同；大文件和导出还需进一步测试资源占用。
- 草稿只保存在当前浏览器和站点。清理浏览器存储会影响恢复，没有云端备份。
- 编解码支持取决于浏览器、系统及硬件；未保证任意格式、手机浏览器、Safari 和 Firefox 可用。
- React 16 / Webpack 4 构建依赖较旧，发布生产服务前需要审计。当前版本按实验性 Demo 提供。

## 参与与许可

欢迎提交可复现的问题、英文界面、兼容性结果和回归测试。请使用合成素材或有权公开的文件，勿上传私人录屏。觉得有帮助可以 Star；需要修改可 Fork 后提交改进。

感谢 [WebAV](https://github.com/WebAV-Tech/WebAV) 等开源项目。本工程独立开发，与 WebAV 官方、剪映或 CapCut 无隶属关系。

本工程代码采用 [MIT](LICENSE) 许可证，第三方依赖保留各自许可证。
