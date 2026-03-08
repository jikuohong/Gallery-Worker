# Gallery Worker · AI 图库

基于 Cloudflare Workers + KV 的 AI 图片管理系统，配合文生图 Worker 使用，支持自动 AI 打标签、图床转存、搜索和多种浏览模式。

---

## 功能一览

- **自动入库**：文生图 Worker 生成图片后自动推送，无需手动操作
- **AI 打标签**：调用 LLaVA 视觉模型分析图片，生成中文描述和标签
- **图床转存**：图片统一上传至 Telegraph Image 图床，稳定持久
- **URL 导入**：粘贴外链批量导入，自动下载并转存到图床
- **本地上传**：直接上传本地图片，自动上传图床并 AI 分析
- **全文搜索**：按提示词、AI 标签、模型名搜索
- **多种浏览模式**：瀑布流 / 大图 / 列表 / 时间轴
- **图片查看器**：放大、缩小、旋转、拖拽平移、滚轮缩放、移动端捏合
- **批量操作**：多选、批量删除、批量复制链接、批量下载、导出 JSON

---

## 部署依赖

| 服务 | 说明 |
|------|------|
| Cloudflare Workers | 运行本 Worker |
| Cloudflare KV | 存储图片记录（元数据）|
| Cloudflare Workers AI | AI 打标签（LLaVA + Llama）|
| Telegraph Image 图床 | 实际存储图片文件 |

---

## 部署步骤

### 1. 创建 KV 命名空间

在 Cloudflare 控制台 → **Workers & Pages → KV** 中新建命名空间，记下名称（建议命名为 `GALLERY_KV`）。

### 2. 部署 Worker

进入 **Workers & Pages → Create → Worker**，将 `gallery-worker.js` 的内容粘贴进去，保存并部署。

### 3. 绑定 KV

在 Worker 的 **Settings → Variables → KV Namespace Bindings** 中添加：

| 绑定名称 | KV 命名空间 |
|----------|------------|
| `GALLERY_KV` | 第 1 步创建的命名空间 |

### 4. 配置环境变量

在 **Settings → Variables → Environment Variables** 中添加：

| 变量名 | 说明 |
|--------|------|
| `PASSWORD` | 访问密码，多个密码用英文逗号分隔 |

### 5. 开启 Workers AI

在 **Settings → Variables → AI Bindings** 中添加绑定，变量名填 `AI`。未绑定时图片可以正常入库，但不会生成 AI 标签和描述。

---

## 与文生图 Worker 联动

文生图 Worker 需要配置以下两个环境变量，生成图片后才会自动推送到图库：

| 变量名 | 值 |
|--------|-----|
| `GALLERY_URL` | 本 Worker 的访问地址，如 `https://gallery.kont.us.ci` |
| `IMAGE_HOST` | 图床地址，如 `https://image.kont.us.ci` |

配置后的完整流程：

```
文生图 Worker 生成图片
    ↓
POST /gallery/ingest（携带图片文件 + 提示词 + 参数）
    ↓
Gallery Worker 调用 AI 打标签
    ↓
图片上传至图床，获取稳定直链
    ↓
记录写入 KV，图片出现在图库
```

---

## API 路由

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/gallery/ingest` | 接收图片文件，AI 打标签 + 上传图床 + 存档（文生图主流程）|
| `POST` | `/gallery/save` | 保存一条图片记录（仅 URL，兼容旧接口）|
| `GET` | `/gallery/search?q=&page=1` | 按关键词搜索，支持分页 |
| `GET` | `/gallery/list?page=1` | 分页列表 |
| `POST` | `/gallery/import` | 批量 URL 导入，自动下载并转存图床 |
| `DELETE` | `/gallery/delete?id=xxx` | 删除一条记录 |
| `GET` | `/` | 返回管理页面 |

所有接口均需在请求头中携带 `X-Password: 你的密码` 进行鉴权（未设置 `PASSWORD` 变量时不鉴权）。

---

## 导入图片

### URL 导入

在图库页面点击右上角「导入」→「URL 导入」，每行粘贴一个图片直链，支持批量（每次最多 20 张）。

导入流程：
1. 检测是否已存在（按 URL 去重）
2. 从原始链接下载图片
3. 转存到图床，获取稳定地址
4. AI 分析内容，生成标签
5. 写入图库 KV

### 本地上传

点击「导入」→「本地上传」，支持拖拽，每次最多 10 张，单张限 10MB。

---

## 图片查看器操作

| 操作 | 方式 |
|------|------|
| 放大 / 缩小 | 工具栏按钮，或鼠标**滚轮** |
| 向左 / 向右旋转 | 工具栏按钮，每次 90° |
| 拖拽平移 | 图片区域**鼠标按住拖动** |
| 捏合缩放 | 手机**双指捏合** |
| 重置 | 工具栏 ⤢ 按钮 |
| 关闭 | 点击遮罩或 ESC 键 |

---

## 数据说明

- **图片文件**不存在 KV 里，实际由图床（Telegraph Image / Telegram）存储
- KV 里只保存每张图片的元数据，包括：图床直链、提示词、模型、尺寸、seed、AI 标签、AI 描述、时间戳
- 删除图库记录不会删除图床原图

---

## 相关项目

- [文生图 Worker](https://text2img.kont.us.ci) — 配套的 AI 文生图工具
- [Telegraph Image 图床](https://image.kont.us.ci) — 图片文件实际存储
