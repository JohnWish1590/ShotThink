# ShotThink

Capture, annotate, and send a browser screenshot into your own ChatGPT conversation.

## 中文说明

ShotThink 是一个纯 Chrome 插件：点击扩展图标（或按 `Ctrl+Shift+S`）框选网页内容，标注后自动发送到你自己的 ChatGPT 账号，按日期每天一个对话。

不安装任何桌面程序，不需要 API Key，翻译也直接由已连接的 ChatGPT 账号完成。

它是 [ClipThink](https://github.com/JohnWish1590/clipthink) 的姊妹产品：ClipThink 思考你复制的内容，ShotThink 思考你看到的内容。

## 当前状态

**骨架阶段。** 目前只有清单文件、项目结构和设计文档。截图遮罩层、标注层和长截图尚未实现。

- 设计方案：[docs/DESIGN.md](docs/DESIGN.md)
- 范围边界：[docs/SCOPE.md](docs/SCOPE.md)

## 与 Mouse4 的关系

发送链路（上传、写规则、按日期归档、失败保护）直接复用 Mouse4 的 Chrome 插件代码；被替换掉的只有"截图"这一步和整个 Native Messaging 桥。

Mouse4 覆盖整个桌面，ShotThink 只覆盖浏览器内容。两者不是替代关系。
