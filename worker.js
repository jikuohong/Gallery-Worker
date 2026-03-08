/**
 * Gallery Worker — AI 图库管理
 *
 * Deploy: https://dash.cloudflare.com → Workers → Create → Paste this file
 *
 * Cloudflare KV 绑定（在 Worker Settings → Variables → KV Namespace Bindings 中配置）:
 *   绑定名称: GALLERY_KV
 *
 * 环境变量（在 Worker Settings → Variables 中配置）:
 *   PASSWORD  - 访问密码，与文生图 Worker 保持一致
 *
 * 需要替换的占位符（搜索以下字符串并替换）:
 *   YOUR_TEXT2IMG_URL   - 替换为你的文生图 Worker 地址
 *   YOUR_IMAGE_HOST_URL - 替换为你的图床地址
 *
 * API 路由:
 *   POST /gallery/ingest        接收图片+AI打标签+上传图床+存档（主流程）
 *   POST /gallery/save          保存一条图片记录（旧接口，保留兼容）
 *   GET  /gallery/search?q=xxx  搜索（按 prompt / 标签 / 模型）
 *   GET  /gallery/list?page=1   分页列表
 *   POST /gallery/import        手动导入（单张或批量）
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
<link href="https://fonts.googleapis.com/css2?family=Lora:wght@400;500;600&family=Source+Sans+3:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.2/css/all.min.css">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#f7f6f2;
  --surface:#faf9f6;
  --surface2:#f0ede6;
  --border:#e5e0d8;
  --border2:#d8d2c8;
  --text:#1c1a17;
  --text2:#403c35;
  --muted:#8c8780;
  --muted2:#b8b2aa;
  --accent:#c96a2c;
  --accent-h:#b35e26;
  --accent-bg:rgba(201,106,44,.09);
  --accent-ring:rgba(201,106,44,.22);
  --r:8px;
  --r-sm:5px;
  --sh:0 1px 2px rgba(0,0,0,.05),0 0 0 1px rgba(0,0,0,.04);
  --shl:0 4px 20px rgba(0,0,0,.09),0 1px 4px rgba(0,0,0,.06);
  --f:'Source Sans 3',-apple-system,'Helvetica Neue',sans-serif;
  --fh:'Lora',Georgia,serif;
  --t:.2s ease;
}
html.dark{
  --bg:#1c1a17;
  --surface:#242018;
  --surface2:#2c2820;
  --border:#38332a;
  --border2:#4a4338;
  --text:#f0ece4;
  --text2:#c8c0b4;
  --muted:#78726a;
  --muted2:#504840;
  --accent:#d9793a;
  --accent-h:#e88844;
  --accent-bg:rgba(217,121,58,.1);
  --accent-ring:rgba(217,121,58,.25);
  --sh:0 1px 3px rgba(0,0,0,.3),0 0 0 1px rgba(0,0,0,.2);
  --shl:0 4px 20px rgba(0,0,0,.4),0 1px 4px rgba(0,0,0,.3);
}
html{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
body{font-family:var(--f);background:var(--bg);color:var(--text);min-height:100vh;transition:background var(--t),color var(--t)}

/* ─── TOPBAR ─── */
.topbar{height:52px;background:var(--surface);border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 18px;gap:10px;position:sticky;top:0;z-index:30}
.tb-logo{display:flex;align-items:center;gap:8px;font-family:var(--fh);font-size:16px;font-weight:600;color:var(--text);letter-spacing:-.01em}
.tb-logo .logo-dot{width:22px;height:22px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;flex-shrink:0}
.tb-div{width:1px;height:18px;background:var(--border);margin:0 2px}
.back-link{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:500;color:var(--muted);text-decoration:none;padding:5px 9px;border-radius:var(--r-sm);border:1px solid var(--border);transition:all var(--t)}
.back-link:hover{color:var(--text);border-color:var(--border2);background:var(--surface2)}
.total-badge{font-size:12px;color:var(--muted);background:var(--surface2);border:1px solid var(--border);padding:3px 10px;border-radius:20px;font-weight:500}
.tb-right{display:flex;align-items:center;gap:8px;margin-left:auto}

/* ─── BATCH BAR ─── */
#batchBar{display:none;position:sticky;top:52px;z-index:29;background:var(--surface);border-bottom:1px solid var(--border);padding:8px 18px;align-items:center;gap:8px}
#batchBar.show{display:flex}
.batch-info{font-size:13px;font-weight:600;color:var(--accent);min-width:72px}
.batch-sep{width:1px;height:16px;background:var(--border);flex-shrink:0}
.bd{background:transparent;color:var(--muted);border:1px solid var(--border);font-size:12px;padding:4px 11px;border-radius:var(--r-sm);cursor:pointer;font-family:var(--f);font-weight:500;display:inline-flex;align-items:center;gap:5px;transition:all var(--t)}
.bd:hover{background:var(--surface2);color:var(--text);border-color:var(--border2)}
.bd.del:hover{background:#fef2ee;color:#a33010;border-color:#f0c4b0}
html.dark .bd.del:hover{background:rgba(163,48,16,.2);color:#f09070;border-color:rgba(163,48,16,.4)}

/* ─── CARD SELECT ─── */
.select-mode .gcard{position:relative}
.select-mode .gcard::after{content:'';position:absolute;inset:0;border-radius:var(--r);border:2px solid transparent;transition:all .15s;pointer-events:none}
.select-mode .gcard.selected::after{border-color:var(--accent);background:var(--accent-bg)}
.gcard .cb-wrap{display:none;position:absolute;top:7px;left:7px;z-index:5}
.select-mode .gcard .cb-wrap{display:flex}
.cb-wrap input[type=checkbox]{width:17px;height:17px;accent-color:var(--accent);cursor:pointer;border-radius:3px}

/* ─── SEARCH ─── */
.search-bar{max-width:880px;margin:22px auto 0;padding:0 18px;display:flex;gap:8px}
.search-wrap{flex:1;position:relative}
.search-wrap i{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--muted2);font-size:13px}
.search-wrap input{width:100%;padding:9px 12px 9px 35px;background:var(--surface);border:1px solid var(--border);border-radius:var(--r);font-size:13.5px;color:var(--text);font-family:var(--f);outline:none;transition:border-color var(--t),box-shadow var(--t);box-shadow:var(--sh)}
.search-wrap input::placeholder{color:var(--muted2)}
.search-wrap input:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-ring),var(--sh)}

/* ─── BUTTONS ─── */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:8px 14px;border-radius:var(--r-sm);font-size:13px;font-weight:500;cursor:pointer;transition:all var(--t);border:none;font-family:var(--f);white-space:nowrap}
.bp{background:var(--accent);color:#fff;box-shadow:0 1px 3px rgba(0,0,0,.12)}
.bp:hover{background:var(--accent-h);transform:translateY(-1px);box-shadow:0 3px 8px rgba(0,0,0,.15)}
.bp:active{transform:translateY(0)}
.bg{background:var(--surface);color:var(--text2);border:1px solid var(--border);box-shadow:var(--sh)}
.bg:hover{background:var(--surface2);border-color:var(--border2)}
.ib{width:33px;height:33px;border-radius:var(--r-sm);background:var(--surface);border:1px solid var(--border);color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;line-height:1;transition:all var(--t);box-shadow:var(--sh)}
.ib i{font-size:14px;line-height:1;display:block}
.ib:hover{background:var(--surface2);color:var(--text);border-color:var(--border2)}

/* ─── GRID WRAP ─── */
.grid-wrap{max-width:1180px;margin:18px auto 40px;padding:0 18px}
.view-toggle{display:flex;gap:2px;background:var(--surface2);border:1px solid var(--border);border-radius:var(--r-sm);padding:2px}
.vt-btn{width:29px;height:27px;border:none;border-radius:3px;background:transparent;color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:11.5px;transition:all var(--t)}
.vt-btn.active{background:var(--surface);color:var(--accent);box-shadow:var(--sh)}
.vt-btn:hover:not(.active){color:var(--text2)}

/* ─── WATERFALL ─── */
.gallery-grid{columns:4;column-gap:10px}
@media(max-width:960px){.gallery-grid{columns:3}}
@media(max-width:580px){.gallery-grid{columns:2}}
.gallery-grid .gcard{break-inside:avoid;margin-bottom:10px}

/* ─── LARGE ─── */
.gallery-grid.mode-large{columns:2;column-gap:14px}
@media(max-width:600px){.gallery-grid.mode-large{columns:1}}

/* ─── LIST ─── */
.gallery-grid.mode-list{columns:unset;display:flex;flex-direction:column;gap:8px}
.gallery-grid.mode-list .gcard{display:flex;flex-direction:row;break-inside:unset;margin-bottom:0}
.gallery-grid.mode-list .gcard img{width:110px;height:110px;object-fit:cover;flex-shrink:0}
.gallery-grid.mode-list .gcard-body{flex:1;padding:10px 14px;display:flex;flex-direction:column;justify-content:space-between}
.gallery-grid.mode-list .gcard-prompt{-webkit-line-clamp:3}

/* ─── TIMELINE ─── */
.timeline-group{margin-bottom:26px}
.tl-date{font-family:var(--fh);font-size:11.5px;font-weight:600;color:var(--muted);padding:3px 0 10px;border-bottom:1px solid var(--border);margin-bottom:10px;display:flex;align-items:center;gap:8px;letter-spacing:.05em;text-transform:uppercase}
.tl-date::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--accent);display:inline-block;flex-shrink:0}
.tl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(175px,1fr));gap:10px}
.tl-grid .gcard{margin-bottom:0;break-inside:unset}

/* ─── CARD ─── */
.gcard{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);overflow:hidden;box-shadow:var(--sh);transition:transform var(--t),box-shadow var(--t),border-color var(--t);cursor:pointer}
.gcard:hover{transform:translateY(-2px);box-shadow:var(--shl);border-color:var(--border2)}
.gcard img{width:100%;display:block;background:var(--surface2)}
.gcard-body{padding:8px 10px 10px}
.gcard-prompt{font-size:11.5px;color:var(--text2);line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:6px}
.gcard-tags{display:flex;flex-wrap:wrap;gap:3px;margin-bottom:6px}
.tag{font-size:10px;font-weight:500;padding:2px 7px;border-radius:20px;background:var(--surface2);color:var(--muted);border:1px solid var(--border);transition:all var(--t);cursor:pointer}
.tag:hover{background:var(--accent-bg);color:var(--accent);border-color:var(--accent-ring)}
.tag.ai{background:var(--accent-bg);color:var(--accent);border-color:var(--accent-ring)}
.gcard-meta{font-size:10.5px;color:var(--muted2);display:flex;align-items:center;gap:5px;flex-wrap:wrap}
.gcard-meta i{font-size:9px}

/* ─── STATE ─── */
.state-box{text-align:center;padding:64px 20px;color:var(--muted)}
.state-box i{font-size:36px;margin-bottom:14px;display:block;opacity:.3}
.state-box p{font-size:14px;font-weight:500}

/* ─── PAGINATION ─── */
.pagination{display:flex;justify-content:center;gap:5px;margin-top:22px}
.pg-btn{min-width:34px;height:34px;border-radius:var(--r-sm);border:1px solid var(--border);background:var(--surface);color:var(--text2);font-size:12.5px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all var(--t);font-family:var(--f);font-weight:500;box-shadow:var(--sh)}
.pg-btn:hover{border-color:var(--accent);color:var(--accent);background:var(--accent-bg)}
.pg-btn.active{background:var(--accent);color:#fff;border-color:var(--accent);box-shadow:0 2px 8px rgba(201,106,44,.3)}
.pg-btn:disabled{opacity:.35;cursor:not-allowed;pointer-events:none}

/* ─── LIGHTBOX ─── */
#lb{position:fixed;inset:0;z-index:200;background:rgba(20,18,15,.85);backdrop-filter:blur(12px);display:none;align-items:flex-start;justify-content:center;padding:28px 16px;overflow-y:auto}
#lb.show{display:flex}
.lb-inner{background:var(--surface);border:1px solid var(--border);border-radius:12px;max-width:740px;width:100%;box-shadow:var(--shl);overflow:hidden;position:relative;margin:auto}
.lb-img{width:100%;display:block;background:var(--surface2)}
.lb-info{padding:16px 18px}
.lb-prompt{font-size:13.5px;line-height:1.6;margin-bottom:12px;font-weight:500;color:var(--text)}
.lb-tags{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:12px}
.lb-meta-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(135px,1fr));gap:6px;margin-bottom:14px}
.lm{background:var(--surface2);border:1px solid var(--border);border-radius:var(--r-sm);padding:6px 9px;font-size:11.5px}
.lm .lk{color:var(--muted);font-size:10px;display:block;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px;font-weight:500}
.lm .lv{font-weight:600;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text2)}
.lb-actions{display:flex;gap:7px;flex-wrap:wrap}
.lb-close{position:absolute;top:11px;right:11px;width:30px;height:30px;border-radius:var(--r-sm);background:rgba(0,0,0,.45);border:none;color:#fff;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:10;transition:background var(--t)}
.lb-close:hover{background:rgba(0,0,0,.65)}

/* ─── LOGIN ─── */
#loginOv{position:fixed;inset:0;z-index:100;background:rgba(20,18,15,.7);backdrop-filter:blur(16px);display:flex;align-items:center;justify-content:center}
#loginOv.hidden{display:none}
.lc{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:36px;width:100%;max-width:340px;text-align:center;box-shadow:var(--shl)}
.lc-ic{width:50px;height:50px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:20px;color:#fff;margin:0 auto 16px;box-shadow:0 3px 10px rgba(201,106,44,.3)}
.lc-title{font-family:var(--fh);font-size:20px;font-weight:600;margin-bottom:5px;color:var(--text)}
.lc-sub{font-size:13px;color:var(--muted);margin-bottom:22px}
.lerr{display:none;background:#fef3ee;color:#9a3412;border:1px solid #fcd4bb;border-radius:var(--r-sm);padding:7px 11px;font-size:12.5px;margin-bottom:11px;text-align:left}
html.dark .lerr{background:rgba(154,52,18,.2);color:#fca882;border-color:rgba(154,52,18,.35)}
.lerr.show{display:block}
input[type=password],input[type=text],input[type=search]{width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:var(--r-sm);padding:9px 12px;font-size:13.5px;color:var(--text);font-family:var(--f);outline:none;transition:border-color var(--t),box-shadow var(--t)}
input::placeholder{color:var(--muted2)}
input:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-ring)}

/* ─── TOAST ─── */
#toast{position:fixed;bottom:18px;right:18px;padding:9px 14px;border-radius:var(--r);font-size:13px;font-weight:500;display:flex;align-items:center;gap:7px;box-shadow:var(--shl);transform:translateY(14px);opacity:0;transition:all .25s cubic-bezier(.34,1.4,.64,1);z-index:999;pointer-events:none}
#toast.show{transform:translateY(0);opacity:1}
#toast.ok{background:#f0faf3;color:#166534;border:1px solid #bbf0cc}
#toast.err{background:#fef3ee;color:#9a3412;border:1px solid #fcd4bb}
#toast.inf{background:var(--surface);color:var(--text2);border:1px solid var(--border)}
html.dark #toast.ok{background:#0d3320;color:#6ee79a;border-color:#1a5c38}
html.dark #toast.err{background:#3d1408;color:#fca882;border-color:#7a2a14}

/* ─── IMPORT PANEL ─── */
#importPanel{display:none;position:fixed;inset:0;z-index:150;background:rgba(20,18,15,.7);backdrop-filter:blur(12px);align-items:center;justify-content:center;padding:20px}
#importPanel.show{display:flex}
.ip-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shl);padding:26px;width:100%;max-width:510px;max-height:90vh;overflow-y:auto}
.ip-title{font-family:var(--fh);font-size:17px;font-weight:600;margin-bottom:3px;display:flex;align-items:center;gap:8px;color:var(--text)}
.ip-title .title-icon{color:var(--accent)}
.ip-sub{font-size:12px;color:var(--muted);margin-bottom:16px;line-height:1.5}
.ip-tabs{display:flex;margin-bottom:14px;border:1px solid var(--border);border-radius:var(--r-sm);overflow:hidden}
.ip-tab{flex:1;padding:7px;font-size:12.5px;font-weight:500;border:none;cursor:pointer;background:transparent;color:var(--muted);transition:all var(--t);font-family:var(--f)}
.ip-tab.active{background:var(--accent);color:#fff}
.ip-tab:not(.active):hover{background:var(--surface2);color:var(--text2)}
.ip-textarea{width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:var(--r-sm);padding:10px 12px;font-size:12.5px;color:var(--text);font-family:var(--f);resize:vertical;min-height:115px;outline:none;line-height:1.6;transition:border-color var(--t),box-shadow var(--t)}
.ip-textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-ring)}
.ip-actions{display:flex;gap:7px;margin-top:11px;flex-wrap:wrap}
.ip-progress{margin-top:14px;display:none}
.ip-progress.show{display:block}
.ip-bar-wrap{background:var(--surface2);border:1px solid var(--border);border-radius:20px;height:6px;overflow:hidden;margin-top:6px}
.ip-bar{height:100%;background:var(--accent);border-radius:20px;transition:width .3s ease}
.ip-log{margin-top:10px;max-height:150px;overflow-y:auto;font-size:11.5px;line-height:1.8}
.ip-log-item{display:flex;align-items:flex-start;gap:6px;padding:2px 0;border-bottom:1px solid var(--border)}
.ip-log-item:last-child{border:none}
.ip-log-item .st{flex-shrink:0;font-weight:600}
.st-ok{color:#1a7a40}.st-skip{color:var(--muted)}.st-err{color:#b83010}
html.dark .st-ok{color:#5dde82}
html.dark .st-err{color:#f07050}
.ip-log-item .url{color:var(--muted);word-break:break-all;font-size:10.5px}
.ip-summary{margin-top:10px;font-size:13px;font-weight:500;padding:8px 12px;background:var(--accent-bg);border:1px solid var(--accent-ring);border-radius:var(--r-sm);display:none;color:var(--accent)}
.ip-summary.show{display:block}
.drop-zone{border:2px dashed var(--border2);border-radius:var(--r);padding:28px 20px;text-align:center;cursor:pointer;transition:all var(--t);margin-bottom:12px;background:var(--surface2)}
.drop-zone:hover,.drop-zone.over{border-color:var(--accent);background:var(--accent-bg)}
.drop-zone .dz-icon{font-size:26px;color:var(--muted2);display:block;margin-bottom:8px}
.drop-zone .dz-title{font-size:13px;font-weight:600;margin-bottom:3px;color:var(--text2)}
.drop-zone .dz-sub{font-size:11.5px;color:var(--muted2)}
.thumb-grid{display:flex;flex-wrap:wrap;gap:7px}
.thumb-item{position:relative;width:68px;height:68px;border-radius:var(--r-sm);overflow:hidden;border:1px solid var(--border)}
.thumb-item img{width:100%;height:100%;object-fit:cover}
.thumb-del{position:absolute;top:2px;right:2px;width:17px;height:17px;border-radius:50%;border:none;background:rgba(0,0,0,.6);color:#fff;font-size:9px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background var(--t)}
.thumb-del:hover{background:rgba(0,0,0,.85)}
.hidden{display:none!important}
</style>
</head>
<body>

<!-- LOGIN -->
<div id="loginOv">
  <div class="lc">
    <div class="lc-ic"><i class="fa-solid fa-images"></i></div>
    <div class="lc-title">AI 图库</div>
    <div class="lc-sub">请输入访问密码继续</div>
    <div id="lerr" class="lerr"><i class="fa-solid fa-triangle-exclamation"></i> 密码错误，请重试</div>
    <div style="margin-bottom:11px;text-align:left">
      <input type="password" id="lp" placeholder="输入密码…">
    </div>
    <button class="btn bp" id="lbtn" style="width:100%;height:38px">
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
        <button id="lbDel" class="btn bg" style="color:#9a3412;border-color:#fcd4bb"><i class="fa-solid fa-trash"></i> 删除</button>
      </div>
    </div>
  </div>
</div>

<!-- TOPBAR -->
<div class="topbar">
  <a href="YOUR_TEXT2IMG_URL" target="_blank" class="back-link">
    <i class="fa-solid fa-wand-magic-sparkles"></i> 文生图
  </a>
  <div class="tb-div"></div>
  <span class="tb-logo">
    <span class="logo-dot"><i class="fa-solid fa-images" style="font-size:9px"></i></span>
    AI 图库
  </span>
  <div class="tb-right">
    <span class="total-badge" id="totalBadge">共 0 张</span>
    <div class="view-toggle" title="切换浏览模式">
      <button class="vt-btn" id="vt-waterfall" title="瀑布流"><i class="fa-solid fa-grip"></i></button>
      <button class="vt-btn" id="vt-large"     title="大图"  ><i class="fa-solid fa-expand"></i></button>
      <button class="vt-btn" id="vt-list"      title="列表"  ><i class="fa-solid fa-list"></i></button>
      <button class="vt-btn" id="vt-timeline"  title="时间轴"><i class="fa-solid fa-clock-rotate-left"></i></button>
    </div>
    <button class="btn bg" id="selectModeBtn" style="font-size:13px"><i class="fa-regular fa-square-check"></i> 选择</button>
    <button class="btn bg" id="importBtn" style="font-size:13px"><i class="fa-solid fa-file-import"></i> 导入</button>
    <button class="ib" id="themeToggle"><i class="fa-solid fa-moon" id="themeIcon"></i></button>
  </div>
</div>

<!-- BATCH BAR -->
<div id="batchBar">
  <span class="batch-info" id="batchInfo">已选 0 张</span>
  <div class="batch-sep"></div>
  <button class="bd" id="batchSelAll"><i class="fa-solid fa-check-double"></i> 全选</button>
  <button class="bd" id="batchDesel"><i class="fa-solid fa-xmark"></i> 取消</button>
  <div class="batch-sep"></div>
  <button class="bd" id="batchCopyLinks"><i class="fa-solid fa-link"></i> 复制链接</button>
  <button class="bd" id="batchDownload"><i class="fa-solid fa-download"></i> 下载</button>
  <button class="bd" id="batchExport"><i class="fa-solid fa-file-export"></i> 导出 JSON</button>
  <button class="bd del" id="batchDelete"><i class="fa-solid fa-trash"></i> 删除</button>
  <div style="margin-left:auto">
    <button class="btn bg" id="batchExitBtn" style="font-size:12px;padding:5px 11px"><i class="fa-solid fa-arrow-left"></i> 退出选择</button>
  </div>
</div>

<!-- SEARCH -->
<div class="search-bar">
  <div class="search-wrap">
    <i class="fa-solid fa-magnifying-glass" id="searchIcon"></i>
    <input type="search" id="searchInput" placeholder="搜索提示词、标签、模型…">
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
    <div class="ip-title"><i class="fa-solid fa-file-import title-icon"></i> 导入图片到图库</div>
    <div class="ip-tabs">
      <button class="ip-tab active" id="tabUrl">🔗 URL 导入</button>
      <button class="ip-tab" id="tabLocal">📁 本地上传</button>
    </div>

    <!-- URL 导入 -->
    <div id="ipUrlPane">
      <div class="ip-sub">粘贴图床直链，每行一个 URL，支持批量导入（每次最多 20 张）</div>
      <textarea class="ip-textarea" id="importUrls" placeholder="YOUR_IMAGE_HOST_URL/file/abc123.jpg&#10;YOUR_IMAGE_HOST_URL/file/def456.png&#10;..."></textarea>
      <div class="ip-actions">
        <button class="btn bp" id="importStartBtn"><i class="fa-solid fa-wand-magic-sparkles"></i> 开始导入 &amp; AI 分析</button>
        <button class="btn bg" id="importCloseBtn"><i class="fa-solid fa-xmark"></i> 关闭</button>
      </div>
    </div>

    <!-- 本地上传 -->
    <div id="ipLocalPane" style="display:none">
      <div class="ip-sub">从本地选择图片，自动上传图床并 AI 打标签（每次最多 10 张）</div>
      <div id="dropZone" class="drop-zone">
        <i class="fa-solid fa-cloud-arrow-up dz-icon"></i>
        <div class="dz-title">拖拽图片到这里，或点击选择</div>
        <div class="dz-sub">支持 JPG、PNG、WebP、GIF，单张最大 10MB</div>
        <input type="file" id="localFileInput" accept="image/*" multiple style="display:none">
      </div>
      <div id="localPreview" style="display:none;margin-bottom:12px">
        <div style="font-size:12px;color:var(--muted);margin-bottom:8px">
          已选择 <span id="localFileCount" style="font-weight:600;color:var(--accent)">0</span> 张图片
        </div>
        <div id="localThumbsWrap" class="thumb-grid"></div>
      </div>
      <div class="ip-actions">
        <button class="btn bp" id="localUploadBtn" disabled><i class="fa-solid fa-wand-magic-sparkles"></i> 上传 &amp; AI 分析</button>
        <button class="btn bg" id="localClearBtn"><i class="fa-solid fa-xmark"></i> 清空</button>
        <button class="btn bg" id="importCloseBtn2"><i class="fa-solid fa-door-open"></i> 关闭</button>
      </div>
    </div>

    <!-- 进度（共用） -->
    <div class="ip-progress" id="ipProgress">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:12px;color:var(--muted)" id="ipProgressText">准备中…</span>
        <span style="font-size:12px;font-weight:600;color:var(--accent)" id="ipProgressPct">0%</span>
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

var API_BASE = '';
var PAGE_SIZE = 24;
var pwd = '', curPage = 1, curQ = '', totalCount = 0, curItem = null;

// ── Theme ──────────────────────────────────────────────────────────────────
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

// ── Toast ──────────────────────────────────────────────────────────────────
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

// ── Login ──────────────────────────────────────────────────────────────────
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

// ── API helper ─────────────────────────────────────────────────────────────
async function apiFetch(path, method, password, body) {
  var opts = {
    method: method || 'GET',
    headers: { 'X-Password': password !== undefined ? password : pwd },
  };
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  return fetch(API_BASE + path, opts);
}

// ── Load ───────────────────────────────────────────────────────────────────
async function loadPage(page, q) {
  if (q !== undefined) curQ = q;
  curPage = page;
  var qs = '?page=' + page + (curQ ? '&q=' + encodeURIComponent(curQ) : '');
  var res = await apiFetch('/gallery/search' + qs);
  if (!res.ok) { toast('加载失败', 'err'); return; }
  var data = await res.json();
  totalCount = data.total || 0;
  document.getElementById('totalBadge').textContent = '共 ' + totalCount + ' 张';
  renderGrid(data.items || []);
  renderPagination(data.total || 0, page);
}

// ── Batch ──────────────────────────────────────────────────────────────────
var selectMode = false;
var selectedIds = new Set();

function enterSelectMode() {
  selectMode = true; selectedIds.clear();
  document.getElementById('grid').classList.add('select-mode');
  document.getElementById('timelineWrap').classList.add('select-mode');
  document.getElementById('batchBar').classList.add('show');
  document.getElementById('selectModeBtn').style.display = 'none';
  updateBatchInfo();
}
function exitSelectMode() {
  selectMode = false; selectedIds.clear();
  document.getElementById('grid').classList.remove('select-mode');
  document.getElementById('timelineWrap').classList.remove('select-mode');
  document.getElementById('batchBar').classList.remove('show');
  document.getElementById('selectModeBtn').style.display = '';
  document.querySelectorAll('.gcard.selected').forEach(function(c) { c.classList.remove('selected'); });
  document.querySelectorAll('.gcard .cb-wrap input').forEach(function(cb) { cb.checked = false; });
}
function updateBatchInfo() { document.getElementById('batchInfo').textContent = '已选 ' + selectedIds.size + ' 张'; }
function toggleCardSelect(card, item) {
  if (selectedIds.has(item.id)) {
    selectedIds.delete(item.id); card.classList.remove('selected'); card.querySelector('.cb-wrap input').checked = false;
  } else {
    selectedIds.add(item.id); card.classList.add('selected'); card.querySelector('.cb-wrap input').checked = true;
  }
  updateBatchInfo();
}
document.getElementById('selectModeBtn').addEventListener('click', enterSelectMode);
document.getElementById('batchExitBtn').addEventListener('click', exitSelectMode);
document.getElementById('batchSelAll').addEventListener('click', function() {
  document.querySelectorAll('.gcard').forEach(function(card) {
    var id = card.dataset.id;
    if (id) { selectedIds.add(id); card.classList.add('selected'); card.querySelector('.cb-wrap input').checked = true; }
  }); updateBatchInfo();
});
document.getElementById('batchDesel').addEventListener('click', function() {
  selectedIds.clear();
  document.querySelectorAll('.gcard').forEach(function(card) { card.classList.remove('selected'); var cb = card.querySelector('.cb-wrap input'); if (cb) cb.checked = false; });
  updateBatchInfo();
});
document.getElementById('batchCopyLinks').addEventListener('click', function() {
  if (!selectedIds.size) { toast('请先选择图片', 'err'); return; }
  var links = allItems.filter(function(i) { return selectedIds.has(i.id); }).map(function(i) { return i.imageUrl; });
  navigator.clipboard.writeText(links.join('\\n')).then(function() { toast('已复制 ' + links.length + ' 条链接', 'ok'); });
});
document.getElementById('batchDownload').addEventListener('click', function() {
  if (!selectedIds.size) { toast('请先选择图片', 'err'); return; }
  var items = allItems.filter(function(i) { return selectedIds.has(i.id); });
  toast('开始下载 ' + items.length + ' 张，请允许多个下载…', 'inf');
  items.forEach(function(item, idx) {
    setTimeout(function() {
      var a = document.createElement('a'); a.href = item.imageUrl; a.download = 'image-' + (item.id || idx) + '.png'; a.target = '_blank';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }, idx * 300);
  });
});
document.getElementById('batchExport').addEventListener('click', function() {
  if (!selectedIds.size) { toast('请先选择图片', 'err'); return; }
  var items = allItems.filter(function(i) { return selectedIds.has(i.id); });
  var blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a'); a.href = url; a.download = 'gallery-export-' + Date.now() + '.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  toast('已导出 ' + items.length + ' 条记录', 'ok');
});
document.getElementById('batchDelete').addEventListener('click', async function() {
  if (!selectedIds.size) { toast('请先选择图片', 'err'); return; }
  if (!confirm('确认删除选中的 ' + selectedIds.size + ' 张图片记录？')) return;
  var ids = Array.from(selectedIds), ok = 0, fail = 0;
  for (var i = 0; i < ids.length; i++) { var r = await apiFetch('/gallery/delete?id=' + ids[i], 'DELETE'); if (r.ok) ok++; else fail++; }
  toast('已删除 ' + ok + ' 张' + (fail ? '，失败 ' + fail + ' 张' : ''), ok > 0 ? 'ok' : 'err');
  exitSelectMode(); loadPage(curPage, curQ);
});

// ── View mode ──────────────────────────────────────────────────────────────
var viewMode = localStorage.getItem('galleryViewMode') || 'waterfall';
var allItems = [];

function setViewMode(mode) {
  viewMode = mode; localStorage.setItem('galleryViewMode', mode);
  ['waterfall','large','list','timeline'].forEach(function(m) { document.getElementById('vt-' + m).classList.toggle('active', m === mode); });
  renderGrid(allItems);
}
document.getElementById('vt-waterfall').addEventListener('click', function() { setViewMode('waterfall'); });
document.getElementById('vt-large').addEventListener('click',     function() { setViewMode('large'); });
document.getElementById('vt-list').addEventListener('click',      function() { setViewMode('list'); });
document.getElementById('vt-timeline').addEventListener('click',  function() { setViewMode('timeline'); });

function makeCard(item) {
  var card = document.createElement('div'); card.className = 'gcard'; card.dataset.id = item.id;
  var cbWrap = document.createElement('div'); cbWrap.className = 'cb-wrap';
  var cb = document.createElement('input'); cb.type = 'checkbox';
  cb.addEventListener('click', function(e) { e.stopPropagation(); toggleCardSelect(card, item); });
  cbWrap.appendChild(cb); card.appendChild(cbWrap);
  var img = document.createElement('img');
  img.src = item.imageUrl; img.alt = item.prompt || ''; img.loading = 'lazy';
  if (viewMode !== 'list') img.style.aspectRatio = (item.width && item.height) ? item.width + '/' + item.height : 'auto';
  var body = document.createElement('div'); body.className = 'gcard-body';
  var promptEl = document.createElement('div'); promptEl.className = 'gcard-prompt';
  promptEl.textContent = item.originalPrompt || item.prompt || '';
  var tagsEl = document.createElement('div'); tagsEl.className = 'gcard-tags';
  var allTags = [];
  (item.aiTags || []).slice(0, 4).forEach(function(t) { allTags.push({ text: t, ai: true }); });
  (item.promptTags || []).slice(0, 3).forEach(function(t) { if (!allTags.find(function(x) { return x.text === t; })) allTags.push({ text: t, ai: false }); });
  allTags.slice(0, 6).forEach(function(t) {
    var s = document.createElement('span'); s.className = 'tag' + (t.ai ? ' ai' : ''); s.textContent = t.text;
    s.addEventListener('click', function(e) { e.stopPropagation(); document.getElementById('searchInput').value = t.text; loadPage(1, t.text); });
    tagsEl.appendChild(s);
  });
  var meta = document.createElement('div'); meta.className = 'gcard-meta';
  var ts = new Date(item.ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  meta.innerHTML = viewMode === 'list'
    ? '<i class="fa-solid fa-microchip"></i>' + (item.model || '-') + ' &nbsp;<i class="fa-solid fa-ruler-combined"></i>' + (item.width || '?') + '×' + (item.height || '?') + ' &nbsp;<i class="fa-regular fa-calendar"></i>' + ts
    : '<i class="fa-solid fa-microchip"></i>' + (item.model || '-') + ' &nbsp;<i class="fa-regular fa-calendar"></i>' + ts;
  body.appendChild(promptEl); body.appendChild(tagsEl); body.appendChild(meta);
  card.appendChild(img); card.appendChild(body);
  card.addEventListener('click', function() { if (selectMode) toggleCardSelect(card, item); else openLightbox(item); });
  return card;
}

function renderGrid(items) {
  allItems = items;
  var grid = document.getElementById('grid'), tlWrap = document.getElementById('timelineWrap');
  var box = document.getElementById('stateBox'), msg = document.getElementById('stateMsg');
  grid.innerHTML = ''; tlWrap.innerHTML = '';
  if (!items.length) {
    box.classList.remove('hidden'); grid.style.display = 'none'; tlWrap.style.display = 'none';
    msg.textContent = curQ ? '没有找到匹配结果' : '暂无图片，快去生成第一张吧！'; return;
  }
  box.classList.add('hidden');
  if (viewMode === 'timeline') {
    grid.style.display = 'none'; tlWrap.style.display = 'block';
    var groups = {};
    items.forEach(function(item) {
      var d = new Date(item.ts).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
      if (!groups[d]) groups[d] = []; groups[d].push(item);
    });
    Object.keys(groups).forEach(function(date) {
      var section = document.createElement('div'); section.className = 'timeline-group';
      var label = document.createElement('div'); label.className = 'tl-date';
      label.textContent = date + '  ·  ' + groups[date].length + ' 张';
      var tlGrid = document.createElement('div'); tlGrid.className = 'tl-grid';
      groups[date].forEach(function(item) { tlGrid.appendChild(makeCard(item)); });
      section.appendChild(label); section.appendChild(tlGrid); tlWrap.appendChild(section);
    });
  } else {
    tlWrap.style.display = 'none'; grid.style.display = '';
    grid.className = 'gallery-grid' + (viewMode === 'large' ? ' mode-large' : '') + (viewMode === 'list' ? ' mode-list' : '');
    items.forEach(function(item) { grid.appendChild(makeCard(item)); });
  }
  ['waterfall','large','list','timeline'].forEach(function(m) { document.getElementById('vt-' + m).classList.toggle('active', m === viewMode); });
}

function renderPagination(total, cur) {
  var pag = document.getElementById('pagination'); pag.innerHTML = '';
  var pages = Math.ceil(total / PAGE_SIZE); if (pages <= 1) return;
  function btn(label, page, active, disabled) {
    var b = document.createElement('button');
    b.className = 'pg-btn' + (active ? ' active' : ''); b.disabled = !!disabled; b.innerHTML = label;
    b.addEventListener('click', function() { loadPage(page, curQ); window.scrollTo(0, 0); }); pag.appendChild(b);
  }
  btn('<i class="fa-solid fa-chevron-left"></i>', cur - 1, false, cur === 1);
  var start = Math.max(1, cur - 2), end = Math.min(pages, cur + 2);
  if (start > 1) { btn('1', 1, false, false); if (start > 2) { var d = document.createElement('span'); d.textContent = '…'; d.style.cssText = 'display:flex;align-items:center;color:var(--muted2);font-size:13px'; pag.appendChild(d); } }
  for (var i = start; i <= end; i++) btn(i, i, i === cur, false);
  if (end < pages) { if (end < pages - 1) { var d2 = document.createElement('span'); d2.textContent = '…'; d2.style.cssText = 'display:flex;align-items:center;color:var(--muted2);font-size:13px'; pag.appendChild(d2); } btn(pages, pages, false, false); }
  btn('<i class="fa-solid fa-chevron-right"></i>', cur + 1, false, cur === pages);
}

// ── Lightbox ───────────────────────────────────────────────────────────────
var lb = document.getElementById('lb');
function openLightbox(item) {
  curItem = item;
  document.getElementById('lbImg').src = item.imageUrl;
  document.getElementById('lbPrompt').textContent = item.prompt || '';
  document.getElementById('lbDl').href = item.imageUrl;
  document.getElementById('lbOpen').href = item.imageUrl;
  document.getElementById('lbCopyUrl').onclick = function() {
    navigator.clipboard.writeText(item.imageUrl).then(function() { toast('链接已复制', 'ok'); });
  };
  var tagsEl = document.getElementById('lbTags'); tagsEl.innerHTML = '';
  (item.aiTags || []).forEach(function(t) { var s = document.createElement('span'); s.className = 'tag ai'; s.textContent = t; tagsEl.appendChild(s); });
  (item.promptTags || []).forEach(function(t) { var s = document.createElement('span'); s.className = 'tag'; s.textContent = t; tagsEl.appendChild(s); });
  var metaEl = document.getElementById('lbMeta'); metaEl.innerHTML = '';
  var fields = [
    { k: '模型', v: item.model || '-' }, { k: '尺寸', v: item.width && item.height ? item.width + '×' + item.height : '-' },
    { k: '步数', v: item.num_steps || '-' }, { k: '种子', v: item.seed || '-' },
    { k: '增强', v: item.enhance ? '已开启' : '未开启' }, { k: '时间', v: new Date(item.ts).toLocaleString('zh-CN') },
  ];
  fields.forEach(function(f) {
    var d = document.createElement('div'); d.className = 'lm';
    d.innerHTML = '<span class="lk">' + f.k + '</span><span class="lv" title="' + f.v + '">' + f.v + '</span>';
    metaEl.appendChild(d);
  });
  if (item.aiDesc) {
    var desc = document.createElement('p');
    desc.style.cssText = 'font-size:12px;color:var(--muted);margin-bottom:12px;line-height:1.5;padding:8px 10px;background:var(--surface2);border-radius:var(--r-sm);border:1px solid var(--border)';
    desc.textContent = '✦ ' + item.aiDesc;
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
  if (res.ok) { lb.classList.remove('show'); toast('已删除', 'ok'); loadPage(curPage, curQ); }
  else toast('删除失败', 'err');
});

// ── Search ─────────────────────────────────────────────────────────────────
document.getElementById('searchBtn').addEventListener('click', function() { loadPage(1, document.getElementById('searchInput').value.trim()); });
document.getElementById('searchInput').addEventListener('keydown', function(e) { if (e.key === 'Enter') loadPage(1, this.value.trim()); });
document.getElementById('searchInput').addEventListener('input', function() {
  document.getElementById('searchIcon').style.display = this.value ? 'none' : '';
  if (!this.value) loadPage(1, '');
});

// ── Import ─────────────────────────────────────────────────────────────────
var importPanel = document.getElementById('importPanel');
function resetImportPanel() {
  document.getElementById('importUrls').value = '';
  document.getElementById('ipProgress').classList.remove('show');
  document.getElementById('ipLog').innerHTML = '';
  document.getElementById('ipSummary').classList.remove('show');
  document.getElementById('ipSummary').textContent = '';
  clearLocalFiles();
}
document.getElementById('importBtn').addEventListener('click', function() { resetImportPanel(); importPanel.classList.add('show'); });
function closeImport() { importPanel.classList.remove('show'); }
document.getElementById('importCloseBtn').addEventListener('click', closeImport);
document.getElementById('importCloseBtn2').addEventListener('click', closeImport);
importPanel.addEventListener('click', function(e) { if (e.target === importPanel) closeImport(); });

document.getElementById('tabUrl').addEventListener('click', function() {
  document.getElementById('ipUrlPane').style.display = '';
  document.getElementById('ipLocalPane').style.display = 'none';
  document.getElementById('tabUrl').classList.add('active');
  document.getElementById('tabLocal').classList.remove('active');
  document.getElementById('ipProgress').classList.remove('show');
  document.getElementById('ipSummary').classList.remove('show');
});
document.getElementById('tabLocal').addEventListener('click', function() {
  document.getElementById('ipLocalPane').style.display = '';
  document.getElementById('ipUrlPane').style.display = 'none';
  document.getElementById('tabLocal').classList.add('active');
  document.getElementById('tabUrl').classList.remove('active');
  document.getElementById('ipProgress').classList.remove('show');
  document.getElementById('ipSummary').classList.remove('show');
});

// ── Local upload ───────────────────────────────────────────────────────────
var selectedFiles = [];
var dropZone = document.getElementById('dropZone');
var fileInput = document.getElementById('localFileInput');
dropZone.addEventListener('click', function() { fileInput.click(); });
dropZone.addEventListener('dragover', function(e) { e.preventDefault(); dropZone.classList.add('over'); });
dropZone.addEventListener('dragleave', function() { dropZone.classList.remove('over'); });
dropZone.addEventListener('drop', function(e) { e.preventDefault(); dropZone.classList.remove('over'); addFiles(Array.from(e.dataTransfer.files)); });
fileInput.addEventListener('change', function() { addFiles(Array.from(this.files)); this.value = ''; });
function addFiles(files) {
  var imgFiles = files.filter(function(f) { return f.type.startsWith('image/') && f.size <= 10 * 1024 * 1024; });
  if (files.length !== imgFiles.length) toast('部分文件已过滤（非图片或超过 10MB）', 'inf');
  imgFiles.forEach(function(f) {
    if (selectedFiles.length >= 10) { toast('每次最多上传 10 张', 'err'); return; }
    if (!selectedFiles.find(function(x) { return x.name === f.name && x.size === f.size; })) selectedFiles.push(f);
  });
  renderThumbs();
}
function renderThumbs() {
  var wrap = document.getElementById('localThumbsWrap');
  var preview = document.getElementById('localPreview');
  var uploadBtn = document.getElementById('localUploadBtn');
  wrap.innerHTML = '';
  if (!selectedFiles.length) { preview.style.display = 'none'; uploadBtn.disabled = true; return; }
  preview.style.display = ''; document.getElementById('localFileCount').textContent = selectedFiles.length; uploadBtn.disabled = false;
  selectedFiles.forEach(function(f, idx) {
    var thumb = document.createElement('div'); thumb.className = 'thumb-item';
    var img = document.createElement('img'); img.src = URL.createObjectURL(f);
    var del = document.createElement('button'); del.className = 'thumb-del'; del.innerHTML = '✕';
    del.addEventListener('click', function() { selectedFiles.splice(idx, 1); renderThumbs(); });
    thumb.appendChild(img); thumb.appendChild(del); wrap.appendChild(thumb);
  });
}
function clearLocalFiles() { selectedFiles = []; renderThumbs(); }
document.getElementById('localClearBtn').addEventListener('click', clearLocalFiles);

document.getElementById('localUploadBtn').addEventListener('click', async function() {
  if (!selectedFiles.length) return;
  var btn = this;
  var progress = document.getElementById('ipProgress'), log = document.getElementById('ipLog');
  var bar = document.getElementById('ipBar'), pct = document.getElementById('ipProgressPct');
  var ptxt = document.getElementById('ipProgressText'), summary = document.getElementById('ipSummary');
  btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 上传中…';
  log.innerHTML = ''; progress.classList.add('show'); summary.classList.remove('show'); bar.style.width = '0%';
  var total = selectedFiles.length, done = 0, okCount = 0, errCount = 0;
  for (var i = 0; i < selectedFiles.length; i++) {
    var f = selectedFiles[i];
    ptxt.textContent = '正在上传第 ' + (i + 1) + ' / ' + total + ' 张：' + f.name;
    try {
      var form = new FormData();
      form.append('file', f, f.name); form.append('prompt', ''); form.append('imageHost', 'YOUR_IMAGE_HOST_URL');
      var res = await fetch(API_BASE + '/gallery/ingest', { method: 'POST', headers: { 'X-Password': pwd }, body: form });
      var data = await res.json(); done++;
      if (res.ok && data.imageUrl) {
        okCount++;
        var li = document.createElement('div'); li.className = 'ip-log-item';
        var tagStr = data.aiTags && data.aiTags.length ? ' <span style="color:var(--accent);font-size:10px">[' + data.aiTags.slice(0,4).join(', ') + ']</span>' : '';
        li.innerHTML = '<span class="st st-ok">✓ 已上传</span><span class="url">' + f.name + tagStr + '</span>';
        log.appendChild(li);
      } else {
        errCount++;
        var li2 = document.createElement('div'); li2.className = 'ip-log-item';
        li2.innerHTML = '<span class="st st-err">✗ 失败</span><span class="url">' + f.name + '：' + (data.error || '未知错误') + '</span>';
        log.appendChild(li2);
      }
    } catch(e) { done++; errCount++; var li3 = document.createElement('div'); li3.className = 'ip-log-item'; li3.innerHTML = '<span class="st st-err">✗ 失败</span><span class="url">' + f.name + '</span>'; log.appendChild(li3); }
    log.scrollTop = log.scrollHeight;
    bar.style.width = Math.round(done / total * 100) + '%'; pct.textContent = Math.round(done / total * 100) + '%';
  }
  btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> 上传 &amp; AI 分析';
  bar.style.width = '100%'; pct.textContent = '100%'; ptxt.textContent = '上传完成';
  summary.textContent = '完成：成功 ' + okCount + ' 张，失败 ' + errCount + ' 张'; summary.classList.add('show');
  toast('上传完成，成功 ' + okCount + ' 张', okCount > 0 ? 'ok' : 'inf');
  if (okCount > 0) { clearLocalFiles(); loadPage(1, ''); }
});

document.getElementById('importStartBtn').addEventListener('click', async function() {
  var raw = document.getElementById('importUrls').value.trim();
  if (!raw) { toast('请先粘贴图片 URL', 'err'); return; }
  var urls = raw.split('\\n').map(function(u) { return u.trim(); }).filter(Boolean);
  if (!urls.length) { toast('没有有效的 URL', 'err'); return; }
  var btn = document.getElementById('importStartBtn');
  var progress = document.getElementById('ipProgress'), log = document.getElementById('ipLog');
  var bar = document.getElementById('ipBar'), pct = document.getElementById('ipProgressPct');
  var ptxt = document.getElementById('ipProgressText'), summary = document.getElementById('ipSummary');
  btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 分析中…';
  log.innerHTML = ''; progress.classList.add('show'); summary.classList.remove('show'); bar.style.width = '0%';
  var total = urls.length, done = 0, okCount = 0, skipCount = 0, errCount = 0;
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
          if (r.status === 'ok') { okCount++; stClass = 'st-ok'; stText = '✓ 已导入'; }
          else if (r.status === 'skipped') { skipCount++; stClass = 'st-skip'; stText = '— 已存在'; }
          else { errCount++; stClass = 'st-err'; stText = '✗ 失败'; }
          var li = document.createElement('div'); li.className = 'ip-log-item';
          var tagStr = r.aiTags && r.aiTags.length ? ' <span style="color:var(--accent);font-size:10px">[' + r.aiTags.slice(0,4).join(', ') + ']</span>' : '';
          li.innerHTML = '<span class="st ' + stClass + '">' + stText + '</span><span class="url">' + r.imageUrl + tagStr + '</span>';
          log.appendChild(li); log.scrollTop = log.scrollHeight;
          var p = Math.round(done / total * 100); bar.style.width = p + '%'; pct.textContent = p + '%';
        });
      }
    } catch(e) {
      batch.forEach(function(u) { done++; errCount++; var li = document.createElement('div'); li.className = 'ip-log-item'; li.innerHTML = '<span class="st st-err">✗ 失败</span><span class="url">' + u + '</span>'; log.appendChild(li); });
    }
  }
  btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> 开始导入 &amp; AI 分析';
  bar.style.width = '100%'; pct.textContent = '100%'; ptxt.textContent = '导入完成';
  summary.textContent = '完成：成功导入 ' + okCount + ' 张，跳过 ' + skipCount + ' 张（已存在），失败 ' + errCount + ' 张'; summary.classList.add('show');
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

      // ── POST /gallery/ingest ───────────────────────────────────────────────
      if (path === '/gallery/ingest' && request.method === 'POST') {
        if (!authed(request)) return unauth();

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

        let aiTags = [], aiDesc = '';
        try {
          if (env.AI) {
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
          }
        } catch (e) { console.error('[ingest] AI vision failed:', e.message); }

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
            }
          } catch (e) { console.error('[ingest] imageHost upload error:', e.message); }
        }

        if (!imageUrl) return json({ error: '图床上传失败' }, 502);

        const promptTags = prompt.toLowerCase().replace(/[,，。.!！?？]/g, ' ').split(/\s+/)
          .filter(w => w.length > 2 && w.length < 20).slice(0, 8);

        const record = {
          id: crypto.randomUUID(), imageUrl, prompt, originalPrompt: origPrompt,
          model, width, height, seed, enhance, aiDesc, aiTags, promptTags,
          searchText: [prompt, origPrompt, model, ...aiTags, ...promptTags].join(' ').toLowerCase(),
          ts: Date.now(), source: 'generated',
        };
        const kvKey = `img:${String(Date.now()).padStart(16, '0')}:${record.id.slice(0, 8)}`;
        await env.GALLERY_KV.put(kvKey, JSON.stringify(record));
        return json({ ok: true, imageUrl, aiTags, aiDesc, id: record.id });
      }

      // ── POST /gallery/save ─────────────────────────────────────────────────
      if (path === '/gallery/save' && request.method === 'POST') {
        if (!authed(request)) return unauth();
        const body = await request.json();
        const { imageUrl, prompt, model, width, height, seed, enhance, originalPrompt } = body;
        if (!imageUrl || !prompt) return json({ error: '缺少 imageUrl 或 prompt' }, 400);

        let aiTags = [], aiDesc = '';
        try {
          if (env.AI) {
            const imgRes = await fetch(imageUrl);
            if (imgRes.ok) {
              const imgArr = [...new Uint8Array(await imgRes.arrayBuffer())];
              const vision = await env.AI.run('@cf/llava-hf/llava-1.5-7b-hf', {
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
        } catch (e) { console.error('AI vision failed:', e); }

        const promptTags = prompt.toLowerCase().replace(/[,，。.!！?？]/g, ' ').split(/\s+/)
          .filter(w => w.length > 2 && w.length < 20).slice(0, 8);

        const record = {
          id: crypto.randomUUID(), imageUrl, prompt,
          originalPrompt: originalPrompt || prompt,
          model: model || '', width: width || 0, height: height || 0,
          seed: seed || 0, enhance: !!enhance, aiDesc, aiTags, promptTags,
          searchText: [prompt, originalPrompt, model, ...aiTags, ...promptTags].join(' ').toLowerCase(),
          ts: Date.now(),
        };
        const kvKey = `img:${String(Date.now()).padStart(16, '0')}:${record.id.slice(0, 8)}`;
        await env.GALLERY_KV.put(kvKey, JSON.stringify(record));
        return json({ ok: true, id: record.id, aiTags, aiDesc });
      }

      // ── GET /gallery/search ────────────────────────────────────────────────
      if (path === '/gallery/search' && request.method === 'GET') {
        if (!authed(request)) return unauth();
        const q    = (url.searchParams.get('q') || '').toLowerCase().trim();
        const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
        const listed = await env.GALLERY_KV.list({ prefix: 'img:' });
        const keys   = listed.keys.reverse();
        if (q) {
          const matches = [];
          for (const k of keys) {
            const raw = await env.GALLERY_KV.get(k.name);
            if (!raw) continue;
            const rec = JSON.parse(raw);
            if (rec.searchText && rec.searchText.includes(q)) matches.push(rec);
          }
          const start = (page - 1) * PAGE_SIZE;
          return json({ total: matches.length, page, items: matches.slice(start, start + PAGE_SIZE) });
        }
        const pageKeys = keys.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
        const items = [];
        for (const k of pageKeys) { const raw = await env.GALLERY_KV.get(k.name); if (raw) items.push(JSON.parse(raw)); }
        return json({ total: keys.length, page, items });
      }

      // ── POST /gallery/import ───────────────────────────────────────────────
      if (path === '/gallery/import' && request.method === 'POST') {
        if (!authed(request)) return unauth();
        const body = await request.json();
        const urlList = body.urls ? body.urls : (body.imageUrl ? [body.imageUrl] : []);
        if (!urlList.length) return json({ error: '缺少 imageUrl 或 urls' }, 400);

        const results = [];
        for (const imageUrl of urlList.slice(0, 20)) {
          const trimmed = imageUrl.trim();
          if (!trimmed) continue;
          const listed = await env.GALLERY_KV.list({ prefix: 'img:' });
          let exists = false;
          for (const k of listed.keys) {
            const raw = await env.GALLERY_KV.get(k.name);
            if (!raw) continue;
            if (JSON.parse(raw).imageUrl === trimmed) { exists = true; break; }
          }
          if (exists) { results.push({ imageUrl: trimmed, status: 'skipped', reason: '已存在' }); continue; }

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
            id: crypto.randomUUID(), imageUrl: trimmed,
            prompt: aiDesc || '手动导入', originalPrompt: '手动导入',
            model: 'manual', width: 0, height: 0, seed: 0, enhance: false,
            aiDesc, aiTags, promptTags: aiTags.slice(0, 5),
            searchText: [aiDesc, ...aiTags].join(' ').toLowerCase(),
            ts: Date.now(), source: 'manual',
          };
          const kvKey = `img:${String(Date.now()).padStart(16, '0')}:${record.id.slice(0, 8)}`;
          await env.GALLERY_KV.put(kvKey, JSON.stringify(record));
          results.push({ imageUrl: trimmed, status: 'ok', id: record.id, aiTags, aiDesc });
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
        const listed = await env.GALLERY_KV.list({ prefix: 'img:' });
        for (const k of listed.keys) {
          const raw = await env.GALLERY_KV.get(k.name);
          if (!raw) continue;
          const rec = JSON.parse(raw);
          if (rec.id === id) { await env.GALLERY_KV.delete(k.name); return json({ ok: true }); }
        }
        return json({ error: '记录不存在' }, 404);
      }

      // ── GET / ──────────────────────────────────────────────────────────────
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
