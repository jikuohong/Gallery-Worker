# AI 图库 Gallery Worker

基于 Cloudflare Workers 的 AI 图库管理系统，支持自动 AI 打标签、全文搜索、多种浏览模式和批量操作。

---

## 部署

### 1. 准备工作

在 Cloudflare Dashboard 中：

1. 创建一个新的 Worker，命名为 `gallery`（或任意名称）
2. 创建一个 **KV 命名空间**，命名为 `gallery_kv`

### 2. 绑定配置

进入 Worker → **绑定** → 添加以下绑定：

| 类型 | 变量名 | 值 |
|------|--------|----|
| KV 命名空间 | `GALLERY_KV` | 选择刚创建的 `gallery_kv` |
| Workers AI | `AI` | Workers AI 目录 |

### 3. 环境变量

进入 Worker → **设置** → **变量和机密**：

| 变量名 | 说明 |
|--------|------|
| `PASSWORD` | 访问密码，多个密码用英文逗号分隔，留空则不验证 |

### 4. 部署代码

将 `gallery-worker-single.js` 的全部内容粘贴到 Worker 编辑器中，点击 **Save and Deploy**。

---

## 与文生图 Worker 联动

文生图 Worker 需配置以下环境变量，生成的图片才会自动入库：

| 变量名 | 示例值 | 说明 |
|--------|--------|------|
| `GALLERY_URL` | `https://gallery.kont.us.ci` | Gallery Worker 地址，末尾不要加 `/` |
| `IMAGE_HOST` | `https://image.kont.us.ci` | 图床地址，末尾不要加 `/` |

配置完成后，每次文生图成功，图片会自动：
1. 发送给 Gallery Worker 进行 AI 视觉分析
2. 上传到图床，获取永久直链
3. 存入 KV 图库，附带 AI 标签和描述

---

## 功能说明

### 浏览模式

顶栏右侧四个图标可切换，选择会记住到下次：

| 图标 | 模式 | 说明 |
|------|------|------|
| ⊞ | 瀑布流 | 默认 4 列，不等高自适应 |
| ⛶ | 大图 | 2 列，图片更大更清晰 |
| ☰ | 列表 | 横排单行，显示完整尺寸信息 |
| 🕐 | 时间轴 | 按日期分组，每天一个区块 |

### 搜索

支持按以下内容搜索：
- 提示词（原始 prompt）
- AI 自动生成的中文标签
- 模型名称

点击图片上的标签也会自动触发搜索。

### 导入图片

点击顶栏「导入图片」按钮，支持两种方式：

**URL 导入**：粘贴图床直链，每行一个，批量导入并自动 AI 分析打标签，每次最多 20 张。

**本地上传**：从本地选择图片文件，支持拖拽，上传到图床后自动 AI 分析，每次最多 10 张，单张限制 10MB。

### 批量操作

点击顶栏「选择」按钮进入选择模式：

- 点击图片或左上角勾选框切换选中状态
- **全选 / 取消全选**
- **复制链接**：将所有选中图片的直链复制到剪贴板，每行一条
- **批量下载**：逐张触发下载（浏览器会请求允许多个文件下载）
- **导出 JSON**：将选中图片的完整记录（含标签、提示词、参数）保存为 `.json` 文件
- **删除**：批量删除图库记录（图床原图不受影响）

点击「退出选择」或完成操作后自动恢复正常浏览。

### 灯箱查看

点击任意图片进入灯箱，可查看：
- 原始提示词
- AI 中文描述
- AI 标签 / Prompt 关键词标签
- 模型、尺寸、步数、种子、时间等参数
- 下载、打开原图、复制链接、删除

---

## API 接口

所有接口需要在请求头中携带 `X-Password`（若配置了密码）。

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/` | 返回图库管理页面 |
| `POST` | `/gallery/ingest` | 接收图片文件，AI 分析 + 上传图床 + 存档 |
| `POST` | `/gallery/save` | 直接保存一条记录（兼容旧接口） |
| `GET` | `/gallery/search?q=xxx&page=1` | 全文搜索 |
| `GET` | `/gallery/list?page=1` | 分页列表 |
| `POST` | `/gallery/import` | 批量导入 URL |
| `DELETE` | `/gallery/delete?id=xxx` | 删除一条记录 |

### `/gallery/ingest` 参数（multipart/form-data）

| 字段 | 类型 | 说明 |
|------|------|------|
| `file` | File | 图片文件（必填） |
| `prompt` | string | 生成提示词 |
| `originalPrompt` | string | 原始提示词（未增强） |
| `model` | string | 模型 ID |
| `width` / `height` | number | 图片尺寸 |
| `seed` | number | 随机种子 |
| `enhance` | boolean | 是否开启了提示词增强 |
| `imageHost` | string | 图床地址，如 `https://image.kont.us.ci` |

---

## KV 数据结构

每条记录的 key 格式：`img:{timestamp_padded}:{uuid前8位}`

value 为 JSON，包含以下字段：

```json
{
  "id": "uuid",
  "imageUrl": "https://image.kont.us.ci/file/xxx.png",
  "prompt": "增强后的提示词",
  "originalPrompt": "原始提示词",
  "model": "cf-flux-schnell",
  "width": 1024,
  "height": 1024,
  "seed": 123456,
  "enhance": false,
  "aiDesc": "AI 生成的中文图片描述",
  "aiTags": ["猫", "赛博朋克", "夜晚"],
  "promptTags": ["cyberpunk", "cat"],
  "searchText": "用于全文搜索的合并文本",
  "ts": 1741234567890,
  "source": "generated"
}
```

---

## AI 标签生成原理

采用两步流程：

1. **LLaVA 视觉分析**（`@cf/llava-hf/llava-1.5-7b-hf`）：分析图片内容，用英文输出描述和标签
2. **Llama 翻译**（`@cf/meta/llama-3.1-8b-instruct`）：将英文结果翻译为中文

每张图自动生成 6–10 个中文标签和一段中文描述。
