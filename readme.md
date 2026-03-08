# AI 图库 Gallery Worker

基于 Cloudflare Workers + D1 + KV 的 AI 图库管理系统。

## 项目结构

```
├── worker.js                          # Worker 主代码
├── schema.sql                         # D1 数据库建表语句
├── wrangler.toml                      # Cloudflare 部署配置
├── .dev.vars.example                  # 本地环境变量模板
├── .gitignore
└── .github/
    └── workflows/
        └── deploy.yml                 # GitHub Actions 自动部署
```

---

## 首次部署完整步骤

### 第一步：在 Cloudflare 创建资源

打开 [Cloudflare Dashboard](https://dash.cloudflare.com)，按以下顺序操作：

#### 1.1 创建 D1 数据库

进入 **Workers & Pages → D1 → Create database**

- 数据库名称填：`gallery-db`
- 创建后记录页面上的 **Database ID**（一串 UUID）

#### 1.2 创建 KV 命名空间

进入 **Workers & Pages → KV → Create a namespace**

- 名称填：`GALLERY_KV`
- 创建后记录页面上的 **Namespace ID**（一串 UUID）

#### 1.3 初始化数据库表

进入刚创建的 D1 数据库 → **Console** 标签页，将 `schema.sql` 的内容粘贴进去执行，或者使用：

```bash
# 如果本地安装了 wrangler：
wrangler d1 execute gallery-db --file=schema.sql --remote
```

---

### 第二步：修改 wrangler.toml

打开 `wrangler.toml`，替换以下两处占位符：

```toml
[[d1_databases]]
database_id = "替换为你的-d1-database-id"   # ← 改成第一步的 Database ID

[[kv_namespaces]]
id = "替换为你的-kv-namespace-id"           # ← 改成第一步的 Namespace ID
```

同时修改你的图床地址和文生图地址：

```toml
[vars]
IMAGE_HOST   = "https://你的图床地址"
TEXT2IMG_URL = "https://你的文生图Worker地址"
```

---

### 第三步：在 GitHub 配置 Secrets

> ⚠️ 密码等敏感变量**不要写进代码**，通过 GitHub Secrets 传给 Actions。

#### 3.1 获取 Cloudflare API Token

进入 [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens) → **Create Token**

选择模板：**Edit Cloudflare Workers**，点击 Use template → Continue → Create Token

复制生成的 Token（只显示一次）。

#### 3.2 获取 Account ID

在 Cloudflare Dashboard 右侧边栏或任意 Workers 页面可以找到 **Account ID**。

#### 3.3 在 GitHub 仓库添加 Secrets

进入你的 GitHub 仓库 → **Settings → Secrets and variables → Actions → New repository secret**

添加以下 3 个 Secret：

| Secret 名称 | 值 |
|------------|-----|
| `CF_API_TOKEN` | 上面复制的 Cloudflare API Token |
| `CF_ACCOUNT_ID` | 你的 Cloudflare Account ID |

#### 3.4 在 Cloudflare 设置加密环境变量（密码等）

进入 **Workers & Pages → gallery-worker → Settings → Variables**

添加以下加密变量（勾选 Encrypt）：

| 变量名 | 值 |
|--------|-----|
| `PASSWORD` | 你的访问密码（多个用逗号分隔） |
| `SESSION_SECRET` | 随机长字符串，建议 32 位以上，用于签名 Cookie |

> 💡 生成随机 SESSION_SECRET 的方法：在浏览器控制台运行
> `crypto.getRandomValues(new Uint8Array(32)).reduce((s,b)=>s+b.toString(16).padStart(2,'0'),'')`

---

### 第四步：推送代码触发部署

```bash
git add .
git commit -m "init gallery worker"
git push origin main
```

推送后进入 GitHub 仓库的 **Actions** 标签页，可以看到部署进度。

部署成功后，Worker 地址为：`https://gallery-worker.<你的子域>.workers.dev`

---

## 后续更新

以后只需修改代码并 push，GitHub Actions 自动重新部署：

```bash
git add worker.js
git commit -m "update worker"
git push
```

---

## 本地开发（可选）

```bash
# 安装 wrangler
npm install -g wrangler

# 登录 Cloudflare
wrangler login

# 复制本地环境变量文件
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars 填入真实密码

# 本地启动（访问 http://localhost:8787）
wrangler dev
```

---

## 常见问题

**Q：数据库初始化在哪里执行？**  
A：在 Cloudflare Dashboard → D1 → 你的数据库 → Console 标签页，粘贴 schema.sql 内容执行即可。

**Q：忘记密码怎么办？**  
A：在 Cloudflare Dashboard → Workers → gallery-worker → Settings → Variables 里修改 `PASSWORD` 变量。

**Q：KV 里的缓存什么时候更新？**  
A：每次新增、导入或删除图片时自动清除前 5 页缓存。也可以在 Dashboard → KV → 手动删除 `cache:` 前缀的 key。

**Q：如何从旧版本迁移数据？**  
A：旧版本数据存在 KV 中（`img:` 前缀的 key）。可以写一个迁移脚本读取 KV 中的旧数据，批量调用 `/gallery/import` 接口导入到新的 D1 中。
