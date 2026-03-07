/**
 * Gallery Worker — AI 图库管理
 *
 * Cloudflare KV 绑定（在 Worker Settings 中配置）:
 *   KV namespace 绑定名称: GALLERY_KV
 *
 * 环境变量:
 *   PASSWORD  - 与主 Worker 相同的访问密码
 *
 * API 路由:
 *   POST /gallery/ingest        接收图片+AI打标签+上传图床+存档（主流程）
 *   POST /gallery/save          保存一条图片记录（旧接口，保留兼容）
 *   GET  /gallery/search?q=xxx  搜索（按 prompt / 标签 / 模型）
 *   GET  /gallery/list?page=1   分页列表
 *   POST /gallery/import          手动导入（单张或批量）
 *   DELETE /gallery/delete?id=xxx 删除一条记录
 *   GET  /                      返回管理页面 HTML
 */

const HTML = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI 图库</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=Sora:wght@600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.2/css/all.min.css">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#f0f2f5;--surface:#fff;--border:#e4e8ef;--text:#1a1d27;--muted:#7a8197;
  --a1:#1d9bf0;--a2:#0bc5a4;
  --grad:linear-gradient(135deg,#1d9bf0,#0bc5a4);
  --gsoft:linear-gradient(135deg,rgba(29,155,240,.1),rgba(11,197,164,.1));
  --r:12px;--sh:0 2px 12px rgba(0,0,0,.06);--shl:0 8px 32px rgba(0,0,0,.1);
  --f:'DM Sans',-apple-system,sans-serif;--fh:'Sora',sans-serif;
}
html.dark{--bg:#10131c;--surface:#181c27;--border:#252a3a;--text:#e8eaf0;--muted:#606880;--sh:0 2px 12px rgba(0,0,0,.3)}
body{font-family:var(--f);background:var(--bg);color:var(--text);min-height:100vh;transition:background .3s,color .3s}

.topbar{height:56px;background:var(--surface);border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 24px;gap:12px;position:sticky;top:0;z-index:30;box-shadow:var(--sh)}
.tb-logo{font-family:var(--fh);font-size:16px;font-weight:700;background:var(--grad);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.tb-right{display:flex;align-items:center;gap:10px;margin-left:auto}
.total-badge{font-size:12px;color:var(--muted);background:var(--bg);border:1px solid var(--border);padding:3px 10px;border-radius:20px}

/* ── 批量操作工具栏 ── */
#batchBar{display:none;position:sticky;top:56px;z-index:29;background:var(--surface);border-bottom:1px solid var(--border);padding:8px 24px;align-items:center;gap:10px;box-shadow:var(--sh)}
#batchBar.show{display:flex}
.batch-info{font-size:13px;font-weight:600;color:var(--a1);min-width:80px}
.batch-sep{width:1px;height:20px;background:var(--border)}
.bd{background:none;color:var(--muted);border:1px solid var(--border);font-size:12px;padding:5px 12px;border-radius:7px;cursor:pointer;font-family:var(--f);font-weight:600;display:inline-flex;align-items:center;gap:5px;transition:all .2s}
.bd:hover{background:var(--bg);color:var(--text)}
.bd.del:hover{background:#fee2e2;color:#991b1b;border-color:#fecaca}

/* ── 卡片选择状态 ── */
.select-mode .gcard{position:relative}
.select-mode .gcard::after{content:'';position:absolute;inset:0;border-radius:var(--r);border:2px solid transparent;transition:all .15s;pointer-events:none}
.select-mode .gcard.selected::after{border-color:var(--a1);background:rgba(29,155,240,.08)}
.gcard .cb-wrap{display:none;position:absolute;top:7px;left:7px;z-index:5}
.select-mode .gcard .cb-wrap{display:flex}
.cb-wrap input[type=checkbox]{width:18px;height:18px;accent-color:var(--a1);cursor:pointer;border-radius:4px}

.search-bar{max-width:900px;margin:24px auto 0;padding:0 20px;display:flex;gap:10px}
.search-wrap{flex:1;position:relative}
.search-wrap i{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--muted);font-size:14px}
.search-wrap input{width:100%;padding:10px 12px 10px 36px;background:var(--surface);border:1px solid var(--border);border-radius:10px;font-size:14px;color:var(--text);font-family:var(--f);outline:none;transition:border-color .2s,box-shadow .2s;box-shadow:var(--sh)}
.search-wrap input:focus{border-color:var(--a1);box-shadow:0 0 0 3px rgba(29,155,240,.12)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:8px 16px;border-radius:9px;font-size:13px;font-weight:600;cursor:pointer;transition:all .2s;border:none;font-family:var(--f)}
.bp{background:var(--grad);color:#fff;box-shadow:0 3px 10px rgba(29,155,240,.3)}
.bp:hover{filter:brightness(1.08);transform:translateY(-1px)}
.bg{background:none;color:var(--muted);border:1px solid var(--border)}
.bg:hover{background:var(--bg);color:var(--text)}
.ib{width:34px;height:34px;border-radius:8px;background:none;border:1px solid var(--border);color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:13px;transition:all .2s}
.ib:hover{background:var(--bg);color:var(--text)}

.grid-wrap{max-width:1200px;margin:20px auto 40px;padding:0 20px}

/* ── 模式切换按钮 ── */
.view-toggle{display:flex;gap:4px;background:var(--bg);border:1px solid var(--border);border-radius:9px;padding:3px}
.vt-btn{width:30px;height:28px;border:none;border-radius:6px;background:none;color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:12px;transition:all .2s}
.vt-btn.active{background:var(--surface);color:var(--a1);box-shadow:0 1px 4px rgba(0,0,0,.1)}
.vt-btn:hover:not(.active){color:var(--text)}

/* ── 瀑布流模式（默认） ── */
.gallery-grid{columns:4;column-gap:12px}
@media(max-width:900px){.gallery-grid{columns:3}}
@media(max-width:560px){.gallery-grid{columns:2}}
.gallery-grid .gcard{break-inside:avoid;margin-bottom:12px}

/* ── 大图模式 ── */
.gallery-grid.mode-large{columns:2;column-gap:16px}
@media(max-width:600px){.gallery-grid.mode-large{columns:1}}

/* ── 列表模式 ── */
.gallery-grid.mode-list{columns:unset;display:flex;flex-direction:column;gap:12px}
.gallery-grid.mode-list .gcard{display:flex;flex-direction:row;break-inside:unset;margin-bottom:0}
.gallery-grid.mode-list .gcard img{width:120px;height:120px;object-fit:cover;flex-shrink:0}
.gallery-grid.mode-list .gcard-body{flex:1;padding:12px 14px;display:flex;flex-direction:column;justify-content:space-between}
.gallery-grid.mode-list .gcard-prompt{-webkit-line-clamp:3}

/* ── 时间轴模式 ── */
.timeline-group{margin-bottom:28px}
.tl-date{font-family:var(--fh);font-size:13px;font-weight:700;color:var(--muted);padding:4px 0 10px;border-bottom:1px solid var(--border);margin-bottom:12px;display:flex;align-items:center;gap:8px}
.tl-date::before{content:'';width:8px;height:8px;border-radius:50%;background:var(--grad);display:inline-block}
.tl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}
.tl-grid .gcard{margin-bottom:0;break-inside:unset}

/* ── 通用卡片样式 ── */
.gcard{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);overflow:hidden;box-shadow:var(--sh);transition:transform .2s,box-shadow .2s;cursor:pointer}
.gcard:hover{transform:translateY(-2px);box-shadow:var(--shl)}
.gcard img{width:100%;display:block;background:var(--bg)}
.gcard-body{padding:8px 10px 10px}
.gcard-prompt{font-size:11.5px;color:var(--text);line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:6px}
.gcard-tags{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px}
.tag{font-size:10px;font-weight:600;padding:2px 7px;border-radius:20px;background:var(--gsoft);color:var(--a1);border:1px solid rgba(29,155,240,.15)}
.tag.ai{background:rgba(11,197,164,.1);color:var(--a2);border-color:rgba(11,197,164,.2)}
.gcard-meta{font-size:10.5px;color:var(--muted);display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.gcard-meta i{font-size:9px}

/* ── Empty / loading ── */
.state-box{text-align:center;padding:60px 20px;color:var(--muted)}
.state-box i{font-size:40px;margin-bottom:12px;display:block;opacity:.35}
.state-box p{font-size:14px}

/* ── Pagination ── */
.pagination{display:flex;justify-content:center;gap:8px;margin-top:24px}
.pg-btn{min-width:36px;height:36px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s;font-family:var(--f);font-weight:500}
.pg-btn:hover{border-color:var(--a1);color:var(--a1)}
.pg-btn.active{background:var(--grad);color:#fff;border-color:transparent;box-shadow:0 3px 10px rgba(29,155,240,.3)}
.pg-btn:disabled{opacity:.4;cursor:not-allowed}

/* ── Lightbox ── */
#lb{position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.92);backdrop-filter:blur(10px);display:none;align-items:flex-start;justify-content:center;padding:30px 16px;overflow-y:auto}
#lb.show{display:flex}
.lb-inner{background:var(--surface);border-radius:16px;max-width:760px;width:100%;box-shadow:var(--shl);overflow:hidden;position:relative;margin:auto}
.lb-img{width:100%;display:block;background:var(--bg)}
.lb-info{padding:16px 20px}
.lb-prompt{font-size:14px;line-height:1.6;margin-bottom:12px;font-weight:500}
.lb-tags{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:12px}
.lb-meta-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:6px;margin-bottom:14px}
.lm{background:var(--bg);border:1px solid var(--border);border-radius:7px;padding:5px 9px;font-size:11.5px}
.lm .lk{color:var(--muted);font-size:10px;display:block;text-transform:uppercase;letter-spacing:.04em}
.lm .lv{font-weight:600;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lb-actions{display:flex;gap:8px;flex-wrap:wrap}
.lb-close{position:absolute;top:12px;right:12px;width:32px;height:32px;border-radius:8px;background:rgba(0,0,0,.5);border:none;color:#fff;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:10;transition:background .2s}
.lb-close:hover{background:rgba(0,0,0,.75)}

/* ── Login overlay ── */
#loginOv{position:fixed;inset:0;z-index:100;background:rgba(16,19,28,.78);backdrop-filter:blur(14px);display:flex;align-items:center;justify-content:center}
#loginOv.hidden{display:none}
.lc{background:var(--surface);border:1px solid var(--border);border-radius:18px;padding:36px;width:100%;max-width:360px;text-align:center}
.lc-ic{width:56px;height:56px;border-radius:14px;background:var(--grad);display:flex;align-items:center;justify-content:center;font-size:24px;color:#fff;margin:0 auto 18px}
.lc-title{font-family:var(--fh);font-size:20px;font-weight:700;margin-bottom:6px}
.lc-sub{font-size:13px;color:var(--muted);margin-bottom:24px}
.lerr{display:none;background:#fee2e2;color:#991b1b;border:1px solid #fecaca;border-radius:8px;padding:7px 12px;font-size:13px;margin-bottom:12px;text-align:left}
html.dark .lerr{background:#7f1d1d;color:#fca5a5;border-color:#991b1b}
.lerr.show{display:block}
input[type=password],input[type=text],input[type=search]{width:100%;background:var(--bg);border:1px solid var(--border);border-radius:9px;padding:9px 12px;font-size:13.5px;color:var(--text);font-family:var(--f);outline:none;transition:border-color .2s,box-shadow .2s}
input:focus{border-color:var(--a1);box-shadow:0 0 0 3px rgba(29,155,240,.12)}

/* ── Toast ── */
#toast{position:fixed;bottom:20px;right:20px;padding:10px 16px;border-radius:10px;font-size:13px;font-weight:500;display:flex;align-items:center;gap:8px;box-shadow:var(--shl);transform:translateY(20px);opacity:0;transition:all .3s;z-index:999;pointer-events:none}
#toast.show{transform:translateY(0);opacity:1}
#toast.ok{background:#dcfce7;color:#166534;border:1px solid #bbf7d0}
#toast.err{background:#fee2e2;color:#991b1b;border:1px solid #fecaca}
#toast.inf{background:#dbeafe;color:#1e40af;border:1px solid #bfdbfe}
html.dark #toast.ok{background:#14532d;color:#86efac;border-color:#166534}
html.dark #toast.err{background:#7f1d1d;color:#fca5a5;border-color:#991b1b}
html.dark #toast.inf{background:#1e3a8a;color:#93c5fd;border-color:#1d4ed8}

/* ── Import panel ── */
#importPanel{display:none;position:fixed;inset:0;z-index:150;background:rgba(16,19,28,.75);backdrop-filter:blur(12px);align-items:center;justify-content:center;padding:20px}
#importPanel.show{display:flex}
.ip-card{background:var(--surface);border:1px solid var(--border);border-radius:16px;box-shadow:var(--shl);padding:28px;width:100%;max-width:520px;max-height:90vh;overflow-y:auto}
.ip-title{font-family:var(--fh);font-size:17px;font-weight:700;margin-bottom:4px;display:flex;align-items:center;gap:8px}
.ip-sub{font-size:12.5px;color:var(--muted);margin-bottom:18px}
.ip-textarea{width:100%;background:var(--bg);border:1px solid var(--border);border-radius:9px;padding:10px 12px;font-size:12.5px;color:var(--text);font-family:var(--f);resize:vertical;min-height:120px;outline:none;line-height:1.6;transition:border-color .2s,box-shadow .2s}
.ip-textarea:focus{border-color:var(--a1);box-shadow:0 0 0 3px rgba(29,155,240,.12)}
.ip-actions{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
.ip-progress{margin-top:14px;display:none}
.ip-progress.show{display:block}
.ip-bar-wrap{background:var(--bg);border-radius:20px;height:8px;overflow:hidden;margin-top:6px}
.ip-bar{height:100%;background:var(--grad);border-radius:20px;transition:width .3s}
.ip-log{margin-top:10px;max-height:160px;overflow-y:auto;font-size:11.5px;line-height:1.8}
.ip-log-item{display:flex;align-items:flex-start;gap:6px;padding:2px 0;border-bottom:1px solid var(--border)}
.ip-log-item:last-child{border:none}
.ip-log-item .st{flex-shrink:0;font-weight:600}
.st-ok{color:var(--a2)}.st-skip{color:var(--muted)}.st-err{color:#ef4444}
.ip-log-item .url{color:var(--muted);word-break:break-all;font-size:10.5px}
.ip-summary{margin-top:10px;font-size:13px;font-weight:600;padding:8px 12px;background:var(--gsoft);border-radius:8px;display:none}
.ip-summary.show{display:block}
.hidden{display:none!important}
</style>
</head>
<body>

<!-- LOGIN -->
<div id="loginOv">
  <div class="lc">
    <div class="lc-ic"><i class="fa-solid fa-images"></i></div>
    <div class="lc-title">AI 图库</div>
    <div class="lc-sub">请输入访问密码</div>
    <div id="lerr" class="lerr"><i class="fa-solid fa-triangle-exclamation"></i> 密码错误</div>
    <div style="margin-bottom:12px;text-align:left">
      <input type="password" id="lp" placeholder="请输入密码…">
    </div>
    <button class="btn bp" id="lbtn" style="width:100%;height:40px">
      <i class="fa-solid fa-right-to-bracket"></i> 进入
    </button>
  </div>
</div>

<!-- LIGHTBOX -->
<div id="lb">
  <div class="lb-inner" id="lbInner">
    <button class="lb-close" id="lbClose"><i class="fa-solid fa-xmark"></i></button>
    <img id="lbImg" class="lb-img" src="" alt="">
    <div class="lb-info">
      <div class="lb-prompt" id="lbPrompt"></div>
      <div class="lb-tags" id="lbTags"></div>
      <div class="lb-meta-grid" id="lbMeta"></div>
      <div class="lb-actions">
        <a id="lbDl" class="btn bp" href="#" download style="text-decoration:none"><i class="fa-solid fa-download"></i> 下载</a>
        <a id="lbOpen" class="btn bg" href="#" target="_blank" style="text-decoration:none"><i class="fa-solid fa-arrow-up-right-from-square"></i> 原图</a>
        <button id="lbCopyUrl" class="btn bg"><i class="fa-solid fa-link"></i> 复制链接</button>
        <button id="lbDel" class="btn" style="background:rgba(239,68,68,.1);color:#dc2626;border:1px solid rgba(239,68,68,.2)"><i class="fa-solid fa-trash"></i> 删除</button>
      </div>
    </div>
  </div>
</div>

<!-- TOPBAR -->
<div class="topbar">
  <a href="https://your-text2img.workers.dev" target="_blank" style="display:flex;align-items:center;gap:7px;font-size:13px;font-weight:600;color:var(--muted);text-decoration:none;padding:5px 10px;border-radius:8px;border:1px solid var(--border);transition:all .2s" onmouseover="this.style.color='var(--a1)';this.style.borderColor='var(--a1)'" onmouseout="this.style.color='var(--muted)';this.style.borderColor='var(--border)'">
    <i class="fa-solid fa-wand-magic-sparkles"></i> 文生图
  </a>
  <span class="tb-logo" style="margin-left:12px"><i class="fa-solid fa-images" style="margin-right:7px"></i>AI 图库</span>
  <div class="tb-right">
    <span class="total-badge" id="totalBadge">共 0 张</span>
    <div class="view-toggle" title="切换浏览模式">
      <button class="vt-btn" id="vt-waterfall" title="瀑布流"><i class="fa-solid fa-grip"></i></button>
      <button class="vt-btn" id="vt-large"     title="大图"><i class="fa-solid fa-expand"></i></button>
      <button class="vt-btn" id="vt-list"      title="列表"><i class="fa-solid fa-list"></i></button>
      <button class="vt-btn" id="vt-timeline"  title="时间轴"><i class="fa-solid fa-clock-rotate-left"></i></button>
    </div>
    <button class="btn bg" id="selectModeBtn" style="gap:6px;font-size:13px"><i class="fa-regular fa-square-check"></i> 选择</button>
    <button class="btn bg" id="importBtn" style="gap:6px;font-size:13px"><i class="fa-solid fa-file-import"></i> 导入图片</button>
    <button class="ib" id="themeToggle"><i class="fa-solid fa-moon" id="themeIcon"></i></button>
  </div>
</div>

<!-- 批量操作工具栏 -->
<div id="batchBar">
  <span class="batch-info" id="batchInfo">已选 0 张</span>
  <div class="batch-sep"></div>
  <button class="bd" id="batchSelAll"><i class="fa-solid fa-check-double"></i> 全选</button>
  <button class="bd" id="batchDesel"><i class="fa-solid fa-xmark"></i> 取消全选</button>
  <div class="batch-sep"></div>
  <button class="bd" id="batchCopyLinks"><i class="fa-solid fa-link"></i> 复制链接</button>
  <button class="bd" id="batchDownload"><i class="fa-solid fa-download"></i> 批量下载</button>
  <button class="bd" id="batchExport"><i class="fa-solid fa-file-export"></i> 导出 JSON</button>
  <button class="bd del" id="batchDelete"><i class="fa-solid fa-trash"></i> 删除</button>
  <div style="margin-left:auto">
    <button class="btn bg" id="batchExitBtn" style="font-size:12px;padding:5px 12px"><i class="fa-solid fa-arrow-left"></i> 退出选择</button>
  </div>
</div>

<!-- SEARCH -->
<div class="search-bar">
  <div class="search-wrap">
    <i class="fa-solid fa-magnifying-glass" id="searchIcon"></i>
    <input type="search" id="searchInput" placeholder="        搜索提示词、标签、模型名称…">
  </div>
  <button class="btn bp" id="searchBtn"><i class="fa-solid fa-search"></i> 搜索</button>
</div>

<!-- GRID -->
<div class="grid-wrap">
  <div class="gallery-grid" id="grid"></div>
  <div id="timelineWrap" style="display:none"></div>
  <div id="stateBox" class="state-box hidden">
    <i class="fa-regular fa-images"></i>
    <p id="stateMsg">暂无图片</p>
  </div>
  <div class="pagination" id="pagination"></div>
</div>


<!-- IMPORT PANEL -->
<div id="importPanel">
  <div class="ip-card">
    <div class="ip-title"><i class="fa-solid fa-file-import" style="color:var(--a1)"></i> 导入图片到图库</div>

    <!-- Tab 切换 -->
    <div style="display:flex;gap:0;margin-bottom:16px;border:1px solid var(--border);border-radius:8px;overflow:hidden">
      <button class="ip-tab active" id="tabUrl" style="flex:1;padding:7px;font-size:12.5px;font-weight:600;border:none;cursor:pointer;background:var(--grad);color:#fff;transition:all .2s">🔗 URL 导入</button>
      <button class="ip-tab" id="tabLocal" style="flex:1;padding:7px;font-size:12.5px;font-weight:600;border:none;cursor:pointer;background:none;color:var(--muted);transition:all .2s">📁 本地上传</button>
    </div>

    <!-- URL 导入面板 -->
    <div id="ipUrlPane">
      <div class="ip-sub">粘贴图床直链，每行一个 URL，支持批量导入（每次最多 20 张）</div>
      <textarea class="ip-textarea" id="importUrls" placeholder="https://your-image-host.com/file/abc123.jpg&#10;https://your-image-host.com/file/def456.png&#10;..."></textarea>
      <div class="ip-actions">
        <button class="btn bp" id="importStartBtn"><i class="fa-solid fa-wand-magic-sparkles"></i> 开始导入 &amp; AI 分析</button>
        <button class="btn bg" id="importCloseBtn"><i class="fa-solid fa-xmark"></i> 关闭</button>
      </div>
    </div>

    <!-- 本地上传面板 -->
    <div id="ipLocalPane" style="display:none">
      <div class="ip-sub">从本地选择图片，自动上传到图床并 AI 分析打标签（每次最多 10 张）</div>
      <!-- 拖拽区 -->
      <div id="dropZone" style="border:2px dashed var(--border);border-radius:10px;padding:32px 20px;text-align:center;cursor:pointer;transition:all .2s;margin-bottom:12px">
        <i class="fa-solid fa-cloud-arrow-up" style="font-size:28px;color:var(--muted);display:block;margin-bottom:8px"></i>
        <div style="font-size:13px;font-weight:600;margin-bottom:4px">拖拽图片到这里，或点击选择</div>
        <div style="font-size:11.5px;color:var(--muted)">支持 JPG、PNG、WebP、GIF，单张最大 10MB</div>
        <input type="file" id="localFileInput" accept="image/*" multiple style="display:none">
      </div>
      <!-- 预览区 -->
      <div id="localPreview" style="display:none;margin-bottom:12px">
        <div style="font-size:12px;color:var(--muted);margin-bottom:8px">已选择 <span id="localFileCount">0</span> 张图片</div>
        <div id="localThumbsWrap" style="display:flex;flex-wrap:wrap;gap:8px"></div>
      </div>
      <div class="ip-actions">
        <button class="btn bp" id="localUploadBtn" disabled><i class="fa-solid fa-wand-magic-sparkles"></i> 上传 &amp; AI 分析</button>
        <button class="btn bg" id="localClearBtn"><i class="fa-solid fa-xmark"></i> 清空</button>
        <button class="btn bg" id="importCloseBtn2"><i class="fa-solid fa-door-open"></i> 关闭</button>
      </div>
    </div>

    <!-- 进度（两个面板共用） -->
    <div class="ip-progress" id="ipProgress">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:12.5px;color:var(--muted)" id="ipProgressText">准备中…</span>
        <span style="font-size:12px;font-weight:600;color:var(--a1)" id="ipProgressPct">0%</span>
      </div>
      <div class="ip-bar-wrap"><div class="ip-bar" id="ipBar" style="width:0%"></div></div>
      <div class="ip-log" id="ipLog"></div>
    </div>
    <div class="ip-summary" id="ipSummary"></div>
  </div>
</div>

<div id="toast"></div>

<script>
(function(){
'use strict';

// ── Config ──────────────────────────────────────────────────────────────────
// Gallery Worker 地址，默认同域；如果独立部署请改为完整 URL
var API_BASE = '';
var PAGE_SIZE = 24;

var pwd = '', curPage = 1, curQ = '', totalCount = 0, curItem = null;

// ── Theme ───────────────────────────────────────────────────────────────────
var html = document.documentElement;
var thIcon = document.getElementById('themeIcon');
var saved = localStorage.getItem('gallery_theme');
if (saved === 'dark' || (!saved && matchMedia('(prefers-color-scheme:dark)').matches)) {
  html.classList.add('dark'); thIcon.className = 'fa-solid fa-sun';
}
document.getElementById('themeToggle').addEventListener('click', function() {
  var d = html.classList.toggle('dark');
  localStorage.setItem('gallery_theme', d ? 'dark' : 'light');
  thIcon.className = d ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
});

// ── Toast ────────────────────────────────────────────────────────────────────
var toastT;
function toast(msg, type) {
  type = type || 'inf';
  var t = document.getElementById('toast');
  clearTimeout(toastT);
  var icons = { ok: 'fa-circle-check', err: 'fa-circle-exclamation', inf: 'fa-circle-info' };
  t.innerHTML = '<i class="fa-solid ' + (icons[type] || icons.inf) + '"></i> ' + msg;
  t.className = 'show ' + type;
  toastT = setTimeout(function() { t.classList.remove('show'); }, 4000);
}

// ── Login ────────────────────────────────────────────────────────────────────
var loginOv = document.getElementById('loginOv');
var lerr    = document.getElementById('lerr');
var lpEl    = document.getElementById('lp');

var stored = sessionStorage.getItem('gallery_pwd');
if (stored !== null) { pwd = stored; loginOv.classList.add('hidden'); loadPage(1); }

async function doLogin() {
  var p = lpEl.value.trim();
  lerr.classList.remove('show');
  var res = await apiFetch('/gallery/search?q=&page=1', 'GET', p);
  if (res.status === 401) { lerr.classList.add('show'); lpEl.focus(); return; }
  pwd = p;
  sessionStorage.setItem('gallery_pwd', pwd);
  loginOv.classList.add('hidden');
  loadPage(1);
}
document.getElementById('lbtn').addEventListener('click', doLogin);
lpEl.addEventListener('keydown', function(e) { if (e.key === 'Enter') doLogin(); });

// ── API helper ───────────────────────────────────────────────────────────────
async function apiFetch(path, method, password, body) {
  var opts = {
    method: method || 'GET',
    headers: { 'X-Password': password !== undefined ? password : pwd },
  };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  return fetch(API_BASE + path, opts);
}

// ── Load / render ─────────────────────────────────────────────────────────────
async function loadPage(page, q) {
  if (q !== undefined) curQ = q;
  curPage = page;

  var qs = '?page=' + page + (curQ ? '&q=' + encodeURIComponent(curQ) : '');
  var path = curQ ? '/gallery/search' + qs : '/gallery/list' + qs;
  // fallback: use search endpoint for both
  path = '/gallery/search' + qs;

  var res = await apiFetch(path);
  if (!res.ok) { toast('加载失败', 'err'); return; }
  var data = await res.json();

  totalCount = data.total || 0;
  document.getElementById('totalBadge').textContent = '共 ' + totalCount + ' 张';

  renderGrid(data.items || []);
  renderPagination(data.total || 0, page);
}

// ── 批量操作 ──────────────────────────────────────────────────────────────────
var selectMode = false;
var selectedIds = new Set();

function enterSelectMode() {
  selectMode = true;
  selectedIds.clear();
  document.getElementById('grid').classList.add('select-mode');
  document.getElementById('timelineWrap').classList.add('select-mode');
  document.getElementById('batchBar').classList.add('show');
  document.getElementById('selectModeBtn').style.display = 'none';
  updateBatchInfo();
}

function exitSelectMode() {
  selectMode = false;
  selectedIds.clear();
  document.getElementById('grid').classList.remove('select-mode');
  document.getElementById('timelineWrap').classList.remove('select-mode');
  document.getElementById('batchBar').classList.remove('show');
  document.getElementById('selectModeBtn').style.display = '';
  // 取消所有选中状态
  document.querySelectorAll('.gcard.selected').forEach(function(c) { c.classList.remove('selected'); });
  document.querySelectorAll('.gcard .cb-wrap input').forEach(function(cb) { cb.checked = false; });
}

function updateBatchInfo() {
  document.getElementById('batchInfo').textContent = '已选 ' + selectedIds.size + ' 张';
}

function toggleCardSelect(card, item) {
  if (selectedIds.has(item.id)) {
    selectedIds.delete(item.id);
    card.classList.remove('selected');
    card.querySelector('.cb-wrap input').checked = false;
  } else {
    selectedIds.add(item.id);
    card.classList.add('selected');
    card.querySelector('.cb-wrap input').checked = true;
  }
  updateBatchInfo();
}

document.getElementById('selectModeBtn').addEventListener('click', enterSelectMode);
document.getElementById('batchExitBtn').addEventListener('click', exitSelectMode);

document.getElementById('batchSelAll').addEventListener('click', function() {
  document.querySelectorAll('.gcard').forEach(function(card) {
    var id = card.dataset.id;
    if (id) {
      selectedIds.add(id);
      card.classList.add('selected');
      card.querySelector('.cb-wrap input').checked = true;
    }
  });
  updateBatchInfo();
});

document.getElementById('batchDesel').addEventListener('click', function() {
  selectedIds.clear();
  document.querySelectorAll('.gcard').forEach(function(card) {
    card.classList.remove('selected');
    var cb = card.querySelector('.cb-wrap input');
    if (cb) cb.checked = false;
  });
  updateBatchInfo();
});

document.getElementById('batchCopyLinks').addEventListener('click', function() {
  if (!selectedIds.size) { toast('请先选择图片', 'err'); return; }
  var links = allItems.filter(function(i) { return selectedIds.has(i.id); }).map(function(i) { return i.imageUrl; });
  navigator.clipboard.writeText(links.join('\\n')).then(function() {
    toast('已复制 ' + links.length + ' 条链接', 'ok');
  });
});

document.getElementById('batchDownload').addEventListener('click', function() {
  if (!selectedIds.size) { toast('请先选择图片', 'err'); return; }
  var items = allItems.filter(function(i) { return selectedIds.has(i.id); });
  toast('开始下载 ' + items.length + ' 张，请允许多个下载…', 'inf');
  items.forEach(function(item, idx) {
    setTimeout(function() {
      var a = document.createElement('a');
      a.href = item.imageUrl;
      a.download = 'image-' + (item.id || idx) + '.png';
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }, idx * 300);
  });
});

document.getElementById('batchExport').addEventListener('click', function() {
  if (!selectedIds.size) { toast('请先选择图片', 'err'); return; }
  var items = allItems.filter(function(i) { return selectedIds.has(i.id); });
  var json = JSON.stringify(items, null, 2);
  var blob = new Blob([json], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'gallery-export-' + Date.now() + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('已导出 ' + items.length + ' 条记录', 'ok');
});

document.getElementById('batchDelete').addEventListener('click', async function() {
  if (!selectedIds.size) { toast('请先选择图片', 'err'); return; }
  if (!confirm('确认删除选中的 ' + selectedIds.size + ' 张图片记录？（图床原图不受影响）')) return;
  var ids = Array.from(selectedIds);
  var ok = 0, fail = 0;
  for (var i = 0; i < ids.length; i++) {
    var res = await apiFetch('/gallery/delete?id=' + ids[i], 'DELETE');
    if (res.ok) ok++; else fail++;
  }
  toast('已删除 ' + ok + ' 张' + (fail ? '，失败 ' + fail + ' 张' : ''), ok > 0 ? 'ok' : 'err');
  exitSelectMode();
  loadPage(curPage, curQ);
});

// ── View mode ─────────────────────────────────────────────────────────────────
var viewMode = localStorage.getItem('galleryViewMode') || 'waterfall';
var allItems = [];

function setViewMode(mode) {
  viewMode = mode;
  localStorage.setItem('galleryViewMode', mode);
  ['waterfall','large','list','timeline'].forEach(function(m) {
    document.getElementById('vt-' + m).classList.toggle('active', m === mode);
  });
  renderGrid(allItems);
}

document.getElementById('vt-waterfall').addEventListener('click', function() { setViewMode('waterfall'); });
document.getElementById('vt-large').addEventListener('click',     function() { setViewMode('large'); });
document.getElementById('vt-list').addEventListener('click',      function() { setViewMode('list'); });
document.getElementById('vt-timeline').addEventListener('click',  function() { setViewMode('timeline'); });

function makeCard(item) {
  var card = document.createElement('div');
  card.className = 'gcard';
  card.dataset.id = item.id;

  // checkbox（选择模式下显示）
  var cbWrap = document.createElement('div');
  cbWrap.className = 'cb-wrap';
  var cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.addEventListener('click', function(e) { e.stopPropagation(); toggleCardSelect(card, item); });
  cbWrap.appendChild(cb);
  card.appendChild(cbWrap);

  var img = document.createElement('img');
  img.src = item.imageUrl;
  img.alt = item.prompt || '';
  img.loading = 'lazy';
  if (viewMode !== 'list') {
    img.style.aspectRatio = (item.width && item.height) ? item.width + '/' + item.height : 'auto';
  }

  var body = document.createElement('div');
  body.className = 'gcard-body';

  var promptEl = document.createElement('div');
  promptEl.className = 'gcard-prompt';
  promptEl.textContent = item.originalPrompt || item.prompt || '';

  var tagsEl = document.createElement('div');
  tagsEl.className = 'gcard-tags';
  var allTags = [];
  (item.aiTags || []).slice(0, 4).forEach(function(t) { allTags.push({ text: t, ai: true }); });
  (item.promptTags || []).slice(0, 3).forEach(function(t) {
    if (!allTags.find(function(x) { return x.text === t; })) allTags.push({ text: t, ai: false });
  });
  allTags.slice(0, 6).forEach(function(t) {
    var s = document.createElement('span');
    s.className = 'tag' + (t.ai ? ' ai' : '');
    s.textContent = t.text;
    s.addEventListener('click', function(e) {
      e.stopPropagation();
      document.getElementById('searchInput').value = t.text;
      loadPage(1, t.text);
    });
    tagsEl.appendChild(s);
  });

  var meta = document.createElement('div');
  meta.className = 'gcard-meta';
  var ts = new Date(item.ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  var extra = viewMode === 'list'
    ? '<i class="fa-solid fa-microchip"></i>' + (item.model || '-')
      + ' &nbsp;<i class="fa-solid fa-ruler-combined"></i>' + (item.width || '?') + '×' + (item.height || '?')
      + ' &nbsp;<i class="fa-regular fa-calendar"></i>' + ts
    : '<i class="fa-solid fa-microchip"></i>' + (item.model || '-')
      + ' &nbsp;<i class="fa-regular fa-calendar"></i>' + ts;
  meta.innerHTML = extra;

  body.appendChild(promptEl);
  body.appendChild(tagsEl);
  body.appendChild(meta);
  card.appendChild(img);
  card.appendChild(body);
  card.addEventListener('click', function() {
    if (selectMode) { toggleCardSelect(card, item); }
    else { openLightbox(item); }
  });
  return card;
}

function renderGrid(items) {
  allItems = items;
  var grid    = document.getElementById('grid');
  var tlWrap  = document.getElementById('timelineWrap');
  var box     = document.getElementById('stateBox');
  var msg     = document.getElementById('stateMsg');
  grid.innerHTML = '';
  tlWrap.innerHTML = '';

  if (!items.length) {
    box.classList.remove('hidden');
    grid.style.display = 'none';
    tlWrap.style.display = 'none';
    msg.textContent = curQ ? '没有找到匹配结果' : '暂无图片，快去生成第一张吧！';
    return;
  }
  box.classList.add('hidden');

  if (viewMode === 'timeline') {
    grid.style.display = 'none';
    tlWrap.style.display = 'block';

    // 按日期分组
    var groups = {};
    items.forEach(function(item) {
      var d = new Date(item.ts).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
      if (!groups[d]) groups[d] = [];
      groups[d].push(item);
    });

    Object.keys(groups).forEach(function(date) {
      var section = document.createElement('div');
      section.className = 'timeline-group';

      var label = document.createElement('div');
      label.className = 'tl-date';
      label.textContent = date + '  (' + groups[date].length + ' 张)';

      var tlGrid = document.createElement('div');
      tlGrid.className = 'tl-grid';
      groups[date].forEach(function(item) { tlGrid.appendChild(makeCard(item)); });

      section.appendChild(label);
      section.appendChild(tlGrid);
      tlWrap.appendChild(section);
    });

  } else {
    tlWrap.style.display = 'none';
    grid.style.display = '';
    grid.className = 'gallery-grid'
      + (viewMode === 'large'    ? ' mode-large' : '')
      + (viewMode === 'list'     ? ' mode-list'  : '');
    items.forEach(function(item) { grid.appendChild(makeCard(item)); });
  }

  // 初始化按钮激活状态
  ['waterfall','large','list','timeline'].forEach(function(m) {
    document.getElementById('vt-' + m).classList.toggle('active', m === viewMode);
  });
}

function renderPagination(total, cur) {
  var pag  = document.getElementById('pagination');
  pag.innerHTML = '';
  var pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return;

  function btn(label, page, active, disabled) {
    var b = document.createElement('button');
    b.className = 'pg-btn' + (active ? ' active' : '');
    b.disabled  = !!disabled;
    b.innerHTML = label;
    b.addEventListener('click', function() { loadPage(page, curQ); window.scrollTo(0, 0); });
    pag.appendChild(b);
  }

  btn('<i class="fa-solid fa-chevron-left"></i>', cur - 1, false, cur === 1);
  var start = Math.max(1, cur - 2), end = Math.min(pages, cur + 2);
  if (start > 1) { btn('1', 1, false, false); if (start > 2) { var d = document.createElement('span'); d.textContent = '…'; d.style.cssText='display:flex;align-items:center;color:var(--muted);font-size:13px'; pag.appendChild(d); } }
  for (var i = start; i <= end; i++) btn(i, i, i === cur, false);
  if (end < pages) { if (end < pages - 1) { var d2 = document.createElement('span'); d2.textContent = '…'; d2.style.cssText='display:flex;align-items:center;color:var(--muted);font-size:13px'; pag.appendChild(d2); } btn(pages, pages, false, false); }
  btn('<i class="fa-solid fa-chevron-right"></i>', cur + 1, false, cur === pages);
}

// ── Lightbox ──────────────────────────────────────────────────────────────────
var lb = document.getElementById('lb');
function openLightbox(item) {
  curItem = item;
  document.getElementById('lbImg').src   = item.imageUrl;
  document.getElementById('lbPrompt').textContent = item.prompt || '';
  document.getElementById('lbDl').href   = item.imageUrl;
  document.getElementById('lbOpen').href = item.imageUrl;
  document.getElementById('lbCopyUrl').onclick = function() {
    navigator.clipboard.writeText(item.imageUrl).then(function() { toast('链接已复制', 'ok'); });
  };

  // Tags
  var tagsEl = document.getElementById('lbTags');
  tagsEl.innerHTML = '';
  (item.aiTags || []).forEach(function(t) {
    var s = document.createElement('span'); s.className = 'tag ai'; s.textContent = t; tagsEl.appendChild(s);
  });
  (item.promptTags || []).forEach(function(t) {
    var s = document.createElement('span'); s.className = 'tag'; s.textContent = t; tagsEl.appendChild(s);
  });

  // Meta
  var metaEl = document.getElementById('lbMeta');
  metaEl.innerHTML = '';
  var fields = [
    { k: '模型', v: item.model || '-' },
    { k: '尺寸', v: item.width && item.height ? item.width + '×' + item.height : '-' },
    { k: '步数', v: item.num_steps || '-' },
    { k: '种子', v: item.seed || '-' },
    { k: '增强', v: item.enhance ? '已开启' : '未开启' },
    { k: '时间', v: new Date(item.ts).toLocaleString('zh-CN') },
  ];
  fields.forEach(function(f) {
    var d = document.createElement('div'); d.className = 'lm';
    d.innerHTML = '<span class="lk">' + f.k + '</span><span class="lv" title="' + f.v + '">' + f.v + '</span>';
    metaEl.appendChild(d);
  });

  if (item.aiDesc) {
    var desc = document.createElement('p');
    desc.style.cssText = 'font-size:12px;color:var(--muted);margin-bottom:12px;line-height:1.5';
    desc.textContent = '🤖 ' + item.aiDesc;
    metaEl.parentNode.insertBefore(desc, metaEl.nextSibling);
  }

  lb.classList.add('show');
}

document.getElementById('lbClose').addEventListener('click', function() { lb.classList.remove('show'); });
lb.addEventListener('click', function(e) { if (e.target === lb) lb.classList.remove('show'); });
document.addEventListener('keydown', function(e) { if (e.key === 'Escape') lb.classList.remove('show'); });

document.getElementById('lbDel').addEventListener('click', async function() {
  if (!curItem) return;
  if (!confirm('确认删除这张图片的记录？（图床原图不受影响）')) return;
  var res = await apiFetch('/gallery/delete?id=' + curItem.id, 'DELETE');
  if (res.ok) {
    lb.classList.remove('show');
    toast('已删除', 'ok');
    loadPage(curPage, curQ);
  } else {
    toast('删除失败', 'err');
  }
});

// ── Search ────────────────────────────────────────────────────────────────────
document.getElementById('searchBtn').addEventListener('click', function() {
  loadPage(1, document.getElementById('searchInput').value.trim());
});
document.getElementById('searchInput').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') loadPage(1, this.value.trim());
});
// Clear search on empty
document.getElementById('searchInput').addEventListener('input', function() {
  document.getElementById('searchIcon').style.display = this.value ? 'none' : '';
  if (!this.value) loadPage(1, '');
});


// ── Import panel ─────────────────────────────────────────────────────────────
var importPanel = document.getElementById('importPanel');

function resetImportPanel() {
  document.getElementById('importUrls').value = '';
  document.getElementById('ipProgress').classList.remove('show');
  document.getElementById('ipLog').innerHTML = '';
  document.getElementById('ipSummary').classList.remove('show');
  document.getElementById('ipSummary').textContent = '';
  clearLocalFiles();
}

document.getElementById('importBtn').addEventListener('click', function() {
  resetImportPanel();
  importPanel.classList.add('show');
});

function closeImport() { importPanel.classList.remove('show'); }
document.getElementById('importCloseBtn').addEventListener('click', closeImport);
document.getElementById('importCloseBtn2').addEventListener('click', closeImport);
importPanel.addEventListener('click', function(e) { if (e.target === importPanel) closeImport(); });

// Tab 切换
document.getElementById('tabUrl').addEventListener('click', function() {
  document.getElementById('ipUrlPane').style.display = '';
  document.getElementById('ipLocalPane').style.display = 'none';
  this.style.cssText = 'flex:1;padding:7px;font-size:12.5px;font-weight:600;border:none;cursor:pointer;background:var(--grad);color:#fff;transition:all .2s';
  document.getElementById('tabLocal').style.cssText = 'flex:1;padding:7px;font-size:12.5px;font-weight:600;border:none;cursor:pointer;background:none;color:var(--muted);transition:all .2s';
  document.getElementById('ipProgress').classList.remove('show');
  document.getElementById('ipSummary').classList.remove('show');
});
document.getElementById('tabLocal').addEventListener('click', function() {
  document.getElementById('ipLocalPane').style.display = '';
  document.getElementById('ipUrlPane').style.display = 'none';
  this.style.cssText = 'flex:1;padding:7px;font-size:12.5px;font-weight:600;border:none;cursor:pointer;background:var(--grad);color:#fff;transition:all .2s';
  document.getElementById('tabUrl').style.cssText = 'flex:1;padding:7px;font-size:12.5px;font-weight:600;border:none;cursor:pointer;background:none;color:var(--muted);transition:all .2s';
  document.getElementById('ipProgress').classList.remove('show');
  document.getElementById('ipSummary').classList.remove('show');
});

// ── 本地上传逻辑 ──────────────────────────────────────────────────────────────
var selectedFiles = [];
var dropZone = document.getElementById('dropZone');
var fileInput = document.getElementById('localFileInput');

dropZone.addEventListener('click', function() { fileInput.click(); });
dropZone.addEventListener('dragover', function(e) {
  e.preventDefault();
  dropZone.style.borderColor = 'var(--a1)';
  dropZone.style.background = 'rgba(29,155,240,.05)';
});
dropZone.addEventListener('dragleave', function() {
  dropZone.style.borderColor = 'var(--border)';
  dropZone.style.background = '';
});
dropZone.addEventListener('drop', function(e) {
  e.preventDefault();
  dropZone.style.borderColor = 'var(--border)';
  dropZone.style.background = '';
  addFiles(Array.from(e.dataTransfer.files));
});
fileInput.addEventListener('change', function() {
  addFiles(Array.from(this.files));
  this.value = '';
});

function addFiles(files) {
  var imgFiles = files.filter(function(f) { return f.type.startsWith('image/') && f.size <= 10 * 1024 * 1024; });
  if (files.length !== imgFiles.length) toast('部分文件已过滤（非图片或超过 10MB）', 'inf');
  imgFiles.forEach(function(f) {
    if (selectedFiles.length >= 10) { toast('每次最多上传 10 张', 'err'); return; }
    if (!selectedFiles.find(function(x) { return x.name === f.name && x.size === f.size; })) {
      selectedFiles.push(f);
    }
  });
  renderThumbs();
}

function renderThumbs() {
  var wrap = document.getElementById('localThumbsWrap');
  var preview = document.getElementById('localPreview');
  var countEl = document.getElementById('localFileCount');
  var uploadBtn = document.getElementById('localUploadBtn');
  wrap.innerHTML = '';
  if (!selectedFiles.length) { preview.style.display = 'none'; uploadBtn.disabled = true; return; }
  preview.style.display = '';
  countEl.textContent = selectedFiles.length;
  uploadBtn.disabled = false;

  selectedFiles.forEach(function(f, idx) {
    var thumb = document.createElement('div');
    thumb.style.cssText = 'position:relative;width:70px;height:70px;border-radius:8px;overflow:hidden;border:1px solid var(--border)';
    var img = document.createElement('img');
    img.style.cssText = 'width:100%;height:100%;object-fit:cover';
    img.src = URL.createObjectURL(f);
    var del = document.createElement('button');
    del.style.cssText = 'position:absolute;top:2px;right:2px;width:18px;height:18px;border-radius:50%;border:none;background:rgba(0,0,0,.6);color:#fff;font-size:9px;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1';
    del.innerHTML = '✕';
    del.addEventListener('click', function() { selectedFiles.splice(idx, 1); renderThumbs(); });
    thumb.appendChild(img);
    thumb.appendChild(del);
    wrap.appendChild(thumb);
  });
}

function clearLocalFiles() {
  selectedFiles = [];
  renderThumbs();
}

document.getElementById('localClearBtn').addEventListener('click', clearLocalFiles);

document.getElementById('localUploadBtn').addEventListener('click', async function() {
  if (!selectedFiles.length) return;
  var btn      = this;
  var progress = document.getElementById('ipProgress');
  var log      = document.getElementById('ipLog');
  var bar      = document.getElementById('ipBar');
  var pct      = document.getElementById('ipProgressPct');
  var ptxt     = document.getElementById('ipProgressText');
  var summary  = document.getElementById('ipSummary');

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 上传中…';
  log.innerHTML = '';
  progress.classList.add('show');
  summary.classList.remove('show');
  bar.style.width = '0%';

  var total = selectedFiles.length, done = 0, okCount = 0, errCount = 0;

  for (var i = 0; i < selectedFiles.length; i++) {
    var f = selectedFiles[i];
    ptxt.textContent = '正在上传第 ' + (i + 1) + ' / ' + total + ' 张：' + f.name;
    try {
      var form = new FormData();
      form.append('file', f, f.name);
      form.append('prompt', '');
      form.append('imageHost', 'https://your-image-host.com');

      var res = await fetch(API_BASE + '/gallery/ingest', {
        method: 'POST',
        headers: { 'X-Password': pwd },
        body: form,
      });
      var data = await res.json();
      done++;
      if (res.ok && data.imageUrl) {
        okCount++;
        var li = document.createElement('div'); li.className = 'ip-log-item';
        var tagStr = data.aiTags && data.aiTags.length ? ' <span style="color:var(--a2);font-size:10px">[' + data.aiTags.slice(0,4).join(', ') + ']</span>' : '';
        li.innerHTML = '<span class="st st-ok">✓ 已上传</span><span class="url">' + f.name + tagStr + '</span>';
        log.appendChild(li);
      } else {
        errCount++;
        var li2 = document.createElement('div'); li2.className = 'ip-log-item';
        li2.innerHTML = '<span class="st st-err">✗ 失败</span><span class="url">' + f.name + '：' + (data.error || '未知错误') + '</span>';
        log.appendChild(li2);
      }
    } catch (e) {
      done++; errCount++;
      var li3 = document.createElement('div'); li3.className = 'ip-log-item';
      li3.innerHTML = '<span class="st st-err">✗ 失败</span><span class="url">' + f.name + '</span>';
      log.appendChild(li3);
    }
    log.scrollTop = log.scrollHeight;
    bar.style.width = Math.round(done / total * 100) + '%';
    pct.textContent = Math.round(done / total * 100) + '%';
  }

  btn.disabled = false;
  btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> 上传 &amp; AI 分析';
  bar.style.width = '100%'; pct.textContent = '100%';
  ptxt.textContent = '上传完成';
  summary.textContent = '完成：成功 ' + okCount + ' 张，失败 ' + errCount + ' 张';
  summary.classList.add('show');
  toast('上传完成，成功 ' + okCount + ' 张', okCount > 0 ? 'ok' : 'inf');
  if (okCount > 0) { clearLocalFiles(); loadPage(1, ''); }
});

document.getElementById('importStartBtn').addEventListener('click', async function() {
  var raw = document.getElementById('importUrls').value.trim();
  if (!raw) { toast('请先粘贴图片 URL', 'err'); return; }

  var urls = raw.split('\\n').map(function(u) { return u.trim(); }).filter(Boolean);
  if (!urls.length) { toast('没有有效的 URL', 'err'); return; }

  var btn       = document.getElementById('importStartBtn');
  var progress  = document.getElementById('ipProgress');
  var log       = document.getElementById('ipLog');
  var bar       = document.getElementById('ipBar');
  var pct       = document.getElementById('ipProgressPct');
  var ptxt      = document.getElementById('ipProgressText');
  var summary   = document.getElementById('ipSummary');

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 分析中…';
  log.innerHTML = '';
  progress.classList.add('show');
  summary.classList.remove('show');
  bar.style.width = '0%';

  var total = urls.length, done = 0, okCount = 0, skipCount = 0, errCount = 0;

  // 每批 5 个发送（避免 Worker 超时）
  var BATCH = 5;
  for (var i = 0; i < urls.length; i += BATCH) {
    var batch = urls.slice(i, i + BATCH);
    ptxt.textContent = '正在处理第 ' + (i + 1) + '–' + Math.min(i + BATCH, total) + ' 张，共 ' + total + ' 张…';

    try {
      var res = await apiFetch('/gallery/import', 'POST', undefined, { urls: batch });
      var data = await res.json();

      if (data.results) {
        data.results.forEach(function(r) {
          done++;
          var stClass, stText;
          if (r.status === 'ok')      { okCount++;   stClass = 'st-ok';   stText = '✓ 已导入'; }
          else if (r.status === 'skipped') { skipCount++; stClass = 'st-skip'; stText = '— 已存在'; }
          else                        { errCount++;  stClass = 'st-err';  stText = '✗ 失败'; }

          var li = document.createElement('div');
          li.className = 'ip-log-item';
          var tagStr = r.aiTags && r.aiTags.length ? ' <span style="color:var(--a2);font-size:10px">[' + r.aiTags.slice(0,4).join(', ') + ']</span>' : '';
          li.innerHTML = '<span class="st ' + stClass + '">' + stText + '</span>'
            + '<span class="url">' + r.imageUrl + tagStr + '</span>';
          log.appendChild(li);
          log.scrollTop = log.scrollHeight;

          var p = Math.round(done / total * 100);
          bar.style.width = p + '%';
          pct.textContent = p + '%';
        });
      }
    } catch (e) {
      batch.forEach(function(u) {
        done++; errCount++;
        var li = document.createElement('div'); li.className = 'ip-log-item';
        li.innerHTML = '<span class="st st-err">✗ 失败</span><span class="url">' + u + '</span>';
        log.appendChild(li);
      });
    }
  }

  // 完成
  btn.disabled = false;
  btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> 开始导入 &amp; AI 分析';
  bar.style.width = '100%'; pct.textContent = '100%';
  ptxt.textContent = '导入完成';

  summary.textContent = '完成：成功导入 ' + okCount + ' 张，跳过 ' + skipCount + ' 张（已存在），失败 ' + errCount + ' 张';
  summary.classList.add('show');
  toast('导入完成，成功 ' + okCount + ' 张', okCount > 0 ? 'ok' : 'inf');

  if (okCount > 0) loadPage(1, '');
});

})();
</script>
</body>
</html>
`;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Password',
};

const PAGE_SIZE = 24;

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url  = new URL(request.url);
    const path = url.pathname;

    // ── Auth helper ───────────────────────────────────────────────────────────
    function authed(req) {
      const PASSWORDS = env.PASSWORD
        ? env.PASSWORD.split(',').map(p => p.trim()).filter(Boolean)
        : [];
      if (!PASSWORDS.length) return true;
      const pwd = req.headers.get('x-password') || '';
      return PASSWORDS.includes(pwd);
    }

    function unauth() {
      return new Response(JSON.stringify({ error: '未授权' }), {
        status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    function json(data, status = 200) {
      return new Response(JSON.stringify(data), {
        status, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    try {

      // ── POST /gallery/ingest — 接收图片，AI打标签，上传图床，存档 ───────────
      if (path === '/gallery/ingest' && request.method === 'POST') {
        if (!authed(request)) return unauth();

        // 接收 multipart/form-data
        const form      = await request.formData();
        const file      = form.get('file');
        const prompt    = form.get('prompt')         || '';
        const origPrompt= form.get('originalPrompt') || prompt;
        const model     = form.get('model')          || '';
        const width     = parseInt(form.get('width'))  || 0;
        const height    = parseInt(form.get('height')) || 0;
        const seed      = parseInt(form.get('seed'))   || 0;
        const enhance   = form.get('enhance') === 'true';
        const imageHost = form.get('imageHost')      || '';

        if (!file) return json({ error: '缺少图片文件' }, 400);

        const imgBytes   = await file.arrayBuffer();
        const imgArr     = [...new Uint8Array(imgBytes)];
        const contentType= file.type || 'image/png';

        // ① AI 视觉打标签：LLaVA 英文分析 → Llama 翻译为中文
        let aiTags = [], aiDesc = '';
        try {
          if (env.AI) {
            // Step 1: LLaVA 看图输出英文
            const vision = await env.AI.run('@cf/llava-hf/llava-1.5-7b-hf', {
              image: imgArr,
              prompt: 'Describe this image briefly. List 6-10 tags for subject, style, colors, mood. Format: DESCRIPTION: <text> | TAGS: tag1, tag2, tag3',
              max_tokens: 200,
            });
            const raw = (vision && vision.description) ? vision.description : '';
            const dm = raw.match(/DESCRIPTION:\s*(.+?)\s*\|/);
            const tm = raw.match(/TAGS:\s*(.+)/);
            const engDesc = dm ? dm[1].trim() : raw.slice(0, 120);
            const engTags = tm ? tm[1].split(',').map(function(t){ return t.trim(); }).filter(Boolean).slice(0, 10) : [];
            console.log('[ingest] LLaVA raw:', raw.slice(0, 80));

            // Step 2: Llama 翻译为中文
            const translateInput = 'DESC: ' + engDesc + '\nTAGS: ' + engTags.join(', ');
            const llama = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
              messages: [
                { role: 'system', content: '将以下英文翻译成中文，只输出翻译结果，格式为两行：\n描述：xxx\n标签：标签1，标签2，标签3' },
                { role: 'user', content: translateInput },
              ],
              max_tokens: 200,
            });
            const tr = (llama && llama.response) ? llama.response.trim() : '';
            const tdm = tr.match(/描述[：:]\s*(.+)/);
            const ttm = tr.match(/标签[：:]\s*(.+)/);
            aiDesc = tdm ? tdm[1].trim() : engDesc;
            const tagStr = ttm ? ttm[1] : engTags.join('，');
            aiTags = tagStr.split(/[,，]/).map(function(t){ return t.trim(); }).filter(Boolean).slice(0, 10);
            console.log('[ingest] AI tags (CN):', aiTags.join(', '));
          }
        } catch (e) {
          console.error('[ingest] AI vision failed:', e.message);
        }

        // ② 上传到图床
        let imageUrl = '';
        if (imageHost) {
          try {
            const uploadForm = new FormData();
            uploadForm.append('file', new Blob([imgBytes], { type: contentType }), 'image.png');
            const upRes = await fetch(imageHost + '/upload', { method: 'POST', body: uploadForm });
            if (upRes.ok) {
              const upJson = await upRes.json();
              const src = Array.isArray(upJson) ? upJson[0]?.src : upJson?.src;
              if (src) imageUrl = src.startsWith('http') ? src : imageHost + src;
              console.log('[ingest] uploaded to imageHost:', imageUrl);
            } else {
              console.error('[ingest] imageHost upload failed:', upRes.status);
            }
          } catch (e) {
            console.error('[ingest] imageHost upload error:', e.message);
          }
        }

        if (!imageUrl) return json({ error: '图床上传失败' }, 502);

        // ③ 从 prompt 提取关键词
        const promptTags = prompt
          .toLowerCase()
          .replace(/[,，。.!！?？]/g, ' ')
          .split(/\s+/)
          .filter(w => w.length > 2 && w.length < 20)
          .slice(0, 8);

        // ④ 存入 KV
        const record = {
          id:             crypto.randomUUID(),
          imageUrl,
          prompt,
          originalPrompt: origPrompt,
          model, width, height, seed, enhance,
          aiDesc, aiTags, promptTags,
          searchText: [prompt, origPrompt, model, ...aiTags, ...promptTags].join(' ').toLowerCase(),
          ts: Date.now(),
          source: 'generated',
        };
        const kvKey = `img:${String(Date.now()).padStart(16, '0')}:${record.id.slice(0, 8)}`;
        await env.GALLERY_KV.put(kvKey, JSON.stringify(record));
        console.log('[ingest] saved to KV:', kvKey);

        return json({ ok: true, imageUrl, aiTags, aiDesc, id: record.id });
      }

      // ── POST /gallery/save ─────────────────────────────────────────────────
      if (path === '/gallery/save' && request.method === 'POST') {
        if (!authed(request)) return unauth();

        const body = await request.json();
        const { imageUrl, prompt, model, width, height, seed, enhance, originalPrompt } = body;

        if (!imageUrl || !prompt) {
          return json({ error: '缺少 imageUrl 或 prompt' }, 400);
        }

        // 用 AI 视觉模型分析图片，生成标签（非阻塞，失败不影响保存）
        let aiTags = [];
        let aiDesc = '';
        try {
          if (env.AI) {
            const imgRes = await fetch(imageUrl);
            if (imgRes.ok) {
              const imgBlob = await imgRes.arrayBuffer();
              const imgArr  = [...new Uint8Array(imgBlob)];
              const vision  = await env.AI.run('@cf/llava-hf/llava-1.5-7b-hf', {
                image: imgArr,
                prompt: '用中文描述这张图片。然后列出6-10个简洁的中文标签，描述主体、风格、色彩和氛围。格式：描述：<内容> | 标签：标签1，标签2，标签3，...',
                max_tokens: 256,
              });
              const raw = vision?.description || '';
              const descMatch = raw.match(/描述[：:]\s*(.+?)\s*\|/s) || raw.match(/DESCRIPTION:\s*(.+?)\s*\|/s);
              const tagsMatch = raw.match(/标签[：:]\s*(.+)/s) || raw.match(/TAGS:\s*(.+)/s);
              if (descMatch) aiDesc = descMatch[1].trim();
              if (tagsMatch) aiTags = tagsMatch[1].split(/[,，]/).map(t => t.trim()).filter(Boolean).slice(0, 10);
            }
          }
        } catch (e) {
          console.error('AI vision failed:', e);
        }

        // 从 prompt 里额外提取关键词作为备用标签
        const promptTags = prompt
          .toLowerCase()
          .replace(/[,，。.!！?？]/g, ' ')
          .split(/\s+/)
          .filter(w => w.length > 2 && w.length < 20)
          .slice(0, 8);

        const record = {
          id:             crypto.randomUUID(),
          imageUrl,
          prompt,
          originalPrompt: originalPrompt || prompt,
          model:          model  || '',
          width:          width  || 0,
          height:         height || 0,
          seed:           seed   || 0,
          enhance:        !!enhance,
          aiDesc,
          aiTags,
          promptTags,
          // 合并所有标签，用于全文搜索
          searchText: [prompt, originalPrompt, model, ...aiTags, ...promptTags]
            .join(' ').toLowerCase(),
          ts: Date.now(),
        };

        // 写入 KV，key = "img:{timestamp}:{uuid前8位}"，保证时间倒序
        const kvKey = `img:${String(Date.now()).padStart(16, '0')}:${record.id.slice(0, 8)}`;
        await env.GALLERY_KV.put(kvKey, JSON.stringify(record));

        return json({ ok: true, id: record.id, aiTags, aiDesc });
      }

      // ── GET /gallery/search ────────────────────────────────────────────────
      if (path === '/gallery/search' && request.method === 'GET') {
        if (!authed(request)) return unauth();

        const q    = (url.searchParams.get('q') || '').toLowerCase().trim();
        const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));

        // 拉取所有 key（KV list 按字典序，key 前缀带时间戳所以是时间倒序）
        const listed = await env.GALLERY_KV.list({ prefix: 'img:' });
        const keys   = listed.keys.reverse(); // 最新在前

        // 过滤
        let filtered = keys;
        if (q) {
          const matches = [];
          for (const k of keys) {
            const raw = await env.GALLERY_KV.get(k.name);
            if (!raw) continue;
            const rec = JSON.parse(raw);
            if (rec.searchText && rec.searchText.includes(q)) matches.push(rec);
          }
          const start  = (page - 1) * PAGE_SIZE;
          return json({ total: matches.length, page, items: matches.slice(start, start + PAGE_SIZE) });
        }

        // 无搜索词 → 分页返回
        const pageKeys = keys.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
        const items = [];
        for (const k of pageKeys) {
          const raw = await env.GALLERY_KV.get(k.name);
          if (raw) items.push(JSON.parse(raw));
        }
        return json({ total: keys.length, page, items });
      }


      // ── POST /gallery/import — 手动导入单张或批量图片 ──────────────────────
      if (path === '/gallery/import' && request.method === 'POST') {
        if (!authed(request)) return unauth();

        const body = await request.json();
        // 支持单条 { imageUrl } 或批量 { urls: [...] }
        const urlList = body.urls
          ? body.urls
          : (body.imageUrl ? [body.imageUrl] : []);

        if (!urlList.length) return json({ error: '缺少 imageUrl 或 urls' }, 400);

        const results = [];
        for (const imageUrl of urlList.slice(0, 20)) { // 单次最多 20 张防超时
          const trimmed = imageUrl.trim();
          if (!trimmed) continue;

          // 检查是否已存在（按 imageUrl 去重）
          const listed = await env.GALLERY_KV.list({ prefix: 'img:' });
          let exists = false;
          for (const k of listed.keys) {
            const raw = await env.GALLERY_KV.get(k.name);
            if (!raw) continue;
            if (JSON.parse(raw).imageUrl === trimmed) { exists = true; break; }
          }
          if (exists) { results.push({ imageUrl: trimmed, status: 'skipped', reason: '已存在' }); continue; }

          // AI 视觉分析
          let aiTags = [], aiDesc = '';
          try {
            if (env.AI) {
              const imgRes = await fetch(trimmed);
              if (imgRes.ok) {
                const imgArr = [...new Uint8Array(await imgRes.arrayBuffer())];
                const vision = await env.AI.run('@cf/llava-hf/llava-1.5-7b-hf', {
                  image: imgArr,
                  prompt: '用中文描述这张图片。然后列出6-10个简洁的中文标签，描述主体、风格、色彩和氛围。格式：描述：<内容> | 标签：标签1，标签2，标签3，...',
                  max_tokens: 256,
                });
                const raw = vision?.description || '';
                const dm = raw.match(/DESCRIPTION:\s*(.+?)\s*\|/s);
                const tm = raw.match(/TAGS:\s*(.+)/s);
                if (dm) aiDesc = dm[1].trim();
                if (tm) aiTags = tm[1].split(',').map(t => t.trim()).filter(Boolean).slice(0, 10);
              }
            }
          } catch (e) { console.error('Vision failed for', trimmed, e); }

          const record = {
            id:            crypto.randomUUID(),
            imageUrl:      trimmed,
            prompt:        aiDesc || '手动导入',
            originalPrompt:'手动导入',
            model:         'manual',
            width: 0, height: 0, seed: 0, enhance: false,
            aiDesc, aiTags,
            promptTags:    aiTags.slice(0, 5),
            searchText:    [aiDesc, ...aiTags].join(' ').toLowerCase(),
            ts:            Date.now(),
            source:        'manual',
          };

          const kvKey = `img:${String(Date.now()).padStart(16, '0')}:${record.id.slice(0, 8)}`;
          await env.GALLERY_KV.put(kvKey, JSON.stringify(record));
          results.push({ imageUrl: trimmed, status: 'ok', id: record.id, aiTags, aiDesc });

          // 避免请求过快
          if (urlList.length > 1) await new Promise(r => setTimeout(r, 300));
        }

        const okCount   = results.filter(r => r.status === 'ok').length;
        const skipCount = results.filter(r => r.status === 'skipped').length;
        return json({ ok: true, total: results.length, imported: okCount, skipped: skipCount, results });
      }

      // ── DELETE /gallery/delete ─────────────────────────────────────────────
      if (path === '/gallery/delete' && request.method === 'DELETE') {
        if (!authed(request)) return unauth();

        const id = url.searchParams.get('id');
        if (!id) return json({ error: '缺少 id' }, 400);

        // 搜索并删除匹配的 key
        const listed = await env.GALLERY_KV.list({ prefix: 'img:' });
        for (const k of listed.keys) {
          const raw = await env.GALLERY_KV.get(k.name);
          if (!raw) continue;
          const rec = JSON.parse(raw);
          if (rec.id === id) {
            await env.GALLERY_KV.delete(k.name);
            return json({ ok: true });
          }
        }
        return json({ error: '记录不存在' }, 404);
      }

      // ── GET / → 管理页面 ───────────────────────────────────────────────────
      if (request.method === 'GET' && (path === '/' || path === '/gallery')) {
        return new Response(HTML, {
          status: 200,
          headers: { ...CORS, 'content-type': 'text/html; charset=utf-8' },
        });
      }

      return new Response('Not Found', { status: 404 });
    } catch (err) {
      console.error('Gallery worker error:', err);
      return json({ error: '服务器内部错误', details: err.message }, 500);
    }
  },
};
