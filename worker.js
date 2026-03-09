/**
 * Gallery Worker — AI 图库管理（改造版）
 *
 * ── Cloudflare 资源绑定（Worker Settings → Variables）──────────────────────
 *
 *  【D1 数据库绑定】 名称: GALLERY_DB
 *  【KV 命名空间绑定】名称: GALLERY_KV  （双重用途：备份 + 缓存）
 *  【AI 绑定】       名称: AI
 *
 * ── 环境变量 ────────────────────────────────────────────────────────────────
 *
 *   PASSWORD        - 访问密码（多个用逗号分隔）
 *   SESSION_SECRET  - Cookie 签名密钥（随机字符串，务必保密）
 *   IMAGE_HOST      - 图床地址，如 https://image.example.com
 *   TEXT2IMG_URL    - 文生图 Worker 地址
 *   CACHE_TTL       - 列表缓存秒数，默认 60
 *
 * ── 首次部署步骤 ─────────────────────────────────────────────────────────────
 *
 *  1. wrangler d1 create gallery-db
 *  2. 将 wrangler.toml 中的 database_id 替换为上一步输出的 ID
 *  3. wrangler d1 execute gallery-db --file=schema.sql
 *  4. wrangler deploy
 *
 * ── API 路由 ─────────────────────────────────────────────────────────────────
 *   POST   /gallery/login          登录，获取 Session Cookie
 *   POST   /gallery/logout         退出登录
 *   POST   /gallery/ingest         接收图片+AI打标签+上传图床+存档
 *   POST   /gallery/save           保存图片记录（兼容旧接口）
 *   GET    /gallery/search?q=xxx   搜索（SQL LIKE，极快）
 *   GET    /gallery/list?page=1    分页列表（KV 缓存）
 *   POST   /gallery/import         批量导入
 *   POST   /gallery/retag?id=xxx   对指定图片重新 AI 打标签
 *   DELETE /gallery/delete?id=xxx  删除记录
 *   GET    /                       管理页面 HTML
 */

// ═══════════════════════════════════════════════════════════════════════════
//  前端 HTML（保留原有 UI，仅修改登录和 API 调用逻辑）
// ═══════════════════════════════════════════════════════════════════════════

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
#lb{position:fixed;inset:0;z-index:200;background:rgba(20,18,15,.85);backdrop-filter:blur(12px);display:none;align-items:flex-start;justify-content:center;padding:28px 16px;overflow:auto}
#lb.show{display:flex}
.lb-inner{background:var(--surface);border:1px solid var(--border);border-radius:12px;max-width:740px;width:100%;box-shadow:var(--shl);overflow:visible;position:relative;margin:auto}
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
.lb-nav{position:fixed;top:50%;transform:translateY(-50%);width:40px;height:64px;background:rgba(0,0,0,.45);border:none;color:#fff;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:210;transition:background var(--t);border-radius:var(--r-sm)}
.lb-nav:hover{background:rgba(0,0,0,.7)}
.lb-nav:disabled{opacity:.2;cursor:not-allowed}
#lbPrev{left:12px}
#lbNext{right:12px}
.lb-counter{position:absolute;bottom:10px;left:50%;transform:translateX(-50%);font-size:11.5px;color:rgba(255,255,255,.7);background:rgba(0,0,0,.4);padding:3px 10px;border-radius:20px;pointer-events:none}
.lb-img-wrap{position:relative;background:var(--surface2);overflow:visible;min-height:120px;cursor:grab;user-select:none}
.lb-img-wrap.dragging{cursor:grabbing}
.lb-img-wrap img{display:block;width:100%;transform-origin:center center;transition:transform .05s linear;will-change:transform;pointer-events:none}
.lb-viewer-bar{display:flex;align-items:center;justify-content:center;gap:4px;padding:7px 10px;background:var(--surface2);border-bottom:1px solid var(--border)}
.vb-btn{width:30px;height:30px;border-radius:var(--r-sm);border:1px solid var(--border);background:var(--surface);color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:12px;transition:all var(--t);flex-shrink:0}
.vb-btn:hover{background:var(--accent);color:#fff;border-color:var(--accent)}
.vb-sep{width:1px;height:18px;background:var(--border);margin:0 2px}
.vb-scale{font-size:11.5px;color:var(--muted);min-width:38px;text-align:center;font-weight:600}

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
    <div id="lerr" class="lerr"><i class="fa-solid fa-triangle-exclamation"></i> <span id="lerrMsg">密码错误，请重试</span></div>
    <div style="margin-bottom:11px;text-align:left">
      <input type="password" id="lp" placeholder="输入密码…" autocomplete="current-password">
    </div>
    <button class="btn bp" id="lbtn" style="width:100%;height:38px">
      <i class="fa-solid fa-right-to-bracket"></i> 进入
    </button>
  </div>
</div>

<!-- LIGHTBOX -->
<div id="lb">
  <button class="lb-nav" id="lbPrev" title="上一张（←）"><i class="fa-solid fa-chevron-left"></i></button>
  <button class="lb-nav" id="lbNext" title="下一张（→）"><i class="fa-solid fa-chevron-right"></i></button>
  <div class="lb-counter" id="lbCounter"></div>
  <div class="lb-inner" id="lbInner">
    <button class="lb-close" id="lbClose"><i class="fa-solid fa-xmark"></i></button>
    <div class="lb-viewer-bar">
      <button class="vb-btn" id="vbZoomIn"  title="放大"><i class="fa-solid fa-magnifying-glass-plus"></i></button>
      <button class="vb-btn" id="vbZoomOut" title="缩小"><i class="fa-solid fa-magnifying-glass-minus"></i></button>
      <button class="vb-btn" id="vbReset"   title="重置"><i class="fa-solid fa-expand"></i></button>
      <div class="vb-sep"></div>
      <span class="vb-scale" id="vbScale">100%</span>
      <div class="vb-sep"></div>
      <button class="vb-btn" id="vbRotateL" title="向左旋转"><i class="fa-solid fa-rotate-left"></i></button>
      <button class="vb-btn" id="vbRotateR" title="向右旋转"><i class="fa-solid fa-rotate-right"></i></button>
    </div>
    <div class="lb-img-wrap" id="lbImgWrap">
      <img id="lbImg" class="lb-img" src="" alt="">
    </div>
    <div class="lb-info">
      <div class="lb-prompt" id="lbPrompt"></div>
      <div class="lb-tags" id="lbTags"></div>
      <div class="lb-meta-grid" id="lbMeta"></div>
      <div class="lb-actions">
        <a id="lbDl" class="btn bp" href="#" download style="text-decoration:none"><i class="fa-solid fa-download"></i> 下载</a>
        <a id="lbOpen" class="btn bg" href="#" target="_blank" style="text-decoration:none"><i class="fa-solid fa-arrow-up-right-from-square"></i> 原图</a>
        <button id="lbCopyUrl" class="btn bg"><i class="fa-solid fa-link"></i> 复制链接</button>
        <button id="lbRetag" class="btn bg"><i class="fa-solid fa-wand-magic-sparkles"></i> AI 打标签</button>
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
    <button class="ib" id="logoutBtn" title="退出登录"><i class="fa-solid fa-right-from-bracket"></i></button>
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
      <textarea class="ip-textarea" id="importUrls" placeholder="https://example.com/image1.jpg&#10;https://example.com/image2.png&#10;..."></textarea>
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
        <div class="thumb-grid" id="localThumbsWrap"></div>
      </div>
      <div class="ip-actions">
        <button class="btn bp" id="localUploadBtn" disabled><i class="fa-solid fa-wand-magic-sparkles"></i> 上传 &amp; AI 分析</button>
        <button class="btn bg" id="localClearBtn"><i class="fa-solid fa-trash"></i> 清空</button>
        <button class="btn bg" id="importCloseBtn2"><i class="fa-solid fa-xmark"></i> 关闭</button>
      </div>
    </div>

    <div id="ipProgress" class="ip-progress">
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-bottom:3px">
        <span id="ipProgressText">处理中…</span>
        <span id="ipProgressPct">0%</span>
      </div>
      <div class="ip-bar-wrap"><div class="ip-bar" id="ipBar" style="width:0%"></div></div>
      <div class="ip-log" id="ipLog"></div>
    </div>
    <div class="ip-summary" id="ipSummary"></div>
  </div>
</div>

<div id="toast"></div>

<script>
(function() {
'use strict';

var NL = String.fromCharCode(10); // 换行符（避免模板字符串转义问题）
var API_BASE = '';
var PAGE_SIZE = 24;
var curPage = 1, curQ = '', curItem = null, totalCount = 0;

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

// ── Login（Cookie Session 版）─────────────────────────────────────────────
// 不再在前端存储密码，登录后由服务端设置 HttpOnly Cookie
// 所有 API 请求自动携带 Cookie，无需手动传密码

var loginOv = document.getElementById('loginOv');
var lerr    = document.getElementById('lerr');
var lerrMsg = document.getElementById('lerrMsg');
var lpEl    = document.getElementById('lp');

// 页面加载时先尝试访问 API，如果返回 401 再显示登录框
(async function checkSession() {
  try {
    var res = await fetch(API_BASE + '/gallery/list?page=1', { credentials: 'include' });
    if (res.ok) {
      loginOv.classList.add('hidden');
      var data = await res.json();
      totalCount = data.total || 0;
      document.getElementById('totalBadge').textContent = '共 ' + totalCount + ' 张';
      renderGrid(data.items || []);
      renderPagination(data.total || 0, 1);
    }
    // 如果 401，登录框保持显示
  } catch(e) { /* 保持登录框 */ }
})();

async function doLogin() {
  var p = lpEl.value.trim();
  if (!p) return;
  lerr.classList.remove('show');
  var btn = document.getElementById('lbtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 验证中…';
  try {
    var res = await fetch(API_BASE + '/gallery/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: p }),
    });
    var data = await res.json();
    if (res.ok && data.ok) {
      loginOv.classList.add('hidden');
      lpEl.value = '';
      loadPage(1);
    } else {
      lerrMsg.textContent = data.error || '密码错误，请重试';
      lerr.classList.add('show');
      lpEl.select();
    }
  } catch(e) {
    lerrMsg.textContent = '网络错误，请稍后重试';
    lerr.classList.add('show');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> 进入';
  }
}
document.getElementById('lbtn').addEventListener('click', doLogin);
lpEl.addEventListener('keydown', function(e) { if (e.key === 'Enter') doLogin(); });

// ── Logout ─────────────────────────────────────────────────────────────────
document.getElementById('logoutBtn').addEventListener('click', async function() {
  await fetch(API_BASE + '/gallery/logout', { method: 'POST', credentials: 'include' });
  loginOv.classList.remove('hidden');
  lpEl.value = '';
  toast('已退出登录', 'inf');
});

// ── API helper（自动携带 Cookie，无需手动传密码）─────────────────────────
async function apiFetch(path, method, body) {
  var opts = {
    method: method || 'GET',
    credentials: 'include',
  };
  if (body) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
  var res = await fetch(API_BASE + path, opts);
  if (res.status === 401) {
    loginOv.classList.remove('hidden');
    throw new Error('未授权');
  }
  return res;
}

// ── Load ───────────────────────────────────────────────────────────────────
async function loadPage(page, q) {
  if (q !== undefined) curQ = q;
  curPage = page;
  var endpoint = curQ
    ? '/gallery/search?q=' + encodeURIComponent(curQ) + '&page=' + page
    : '/gallery/list?page=' + page;
  try {
    var res = await apiFetch(endpoint);
    if (!res.ok) { toast('加载失败', 'err'); return; }
    var data = await res.json();
    totalCount = data.total || 0;
    document.getElementById('totalBadge').textContent = '共 ' + totalCount + ' 张';
    renderGrid(data.items || []);
    renderPagination(data.total || 0, page);
  } catch(e) { if (e.message !== '未授权') toast('加载失败', 'err'); }
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
  navigator.clipboard.writeText(links.join(NL)).then(function() { toast('已复制 ' + links.length + ' 条链接', 'ok'); });
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
  for (var i = 0; i < ids.length; i++) {
    try { var r = await apiFetch('/gallery/delete?id=' + ids[i], 'DELETE'); if (r.ok) ok++; else fail++; }
    catch(e) { fail++; }
  }
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
var lbImg = document.getElementById('lbImg');
var lbImgWrap = document.getElementById('lbImgWrap');
var vbScale = document.getElementById('vbScale');
var lbScale = 1, lbRotate = 0, lbTx = 0, lbTy = 0;
var lbDragging = false, lbDragStartX = 0, lbDragStartY = 0, lbDragTx = 0, lbDragTy = 0;

function applyTransform() {
  lbImg.style.transform = 'translate(' + lbTx + 'px,' + lbTy + 'px) rotate(' + lbRotate + 'deg) scale(' + lbScale + ')';
  vbScale.textContent = Math.round(lbScale * 100) + '%';
}
function resetViewer() { lbScale = 1; lbRotate = 0; lbTx = 0; lbTy = 0; applyTransform(); }

document.getElementById('vbZoomIn').addEventListener('click',  function() { lbScale = Math.min(lbScale * 1.25, 8); applyTransform(); });
document.getElementById('vbZoomOut').addEventListener('click', function() { lbScale = Math.max(lbScale / 1.25, 0.1); applyTransform(); });
document.getElementById('vbReset').addEventListener('click',   resetViewer);
document.getElementById('vbRotateL').addEventListener('click', function() { lbRotate -= 90; applyTransform(); });
document.getElementById('vbRotateR').addEventListener('click', function() { lbRotate += 90; applyTransform(); });

lbImgWrap.addEventListener('wheel', function(e) {
  e.preventDefault();
  var factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  lbScale = Math.min(Math.max(lbScale * factor, 0.1), 8);
  applyTransform();
}, { passive: false });

lbImgWrap.addEventListener('mousedown', function(e) {
  if (e.button !== 0) return;
  lbDragging = true; lbImgWrap.classList.add('dragging');
  lbDragStartX = e.clientX; lbDragStartY = e.clientY;
  lbDragTx = lbTx; lbDragTy = lbTy;
});
window.addEventListener('mousemove', function(e) {
  if (!lbDragging) return;
  lbTx = lbDragTx + (e.clientX - lbDragStartX);
  lbTy = lbDragTy + (e.clientY - lbDragStartY);
  applyTransform();
});
window.addEventListener('mouseup', function() {
  if (!lbDragging) return;
  lbDragging = false; lbImgWrap.classList.remove('dragging');
});

var lbTouchDist = 0;
lbImgWrap.addEventListener('touchstart', function(e) {
  if (e.touches.length === 2) {
    lbTouchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  }
}, { passive: true });
lbImgWrap.addEventListener('touchmove', function(e) {
  if (e.touches.length === 2) {
    e.preventDefault();
    var d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    lbScale = Math.min(Math.max(lbScale * (d / lbTouchDist), 0.1), 8);
    lbTouchDist = d;
    applyTransform();
  }
}, { passive: false });

function openLightbox(item) {
  curItem = item;
  resetViewer();
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
    { k: '种子', v: item.seed || '-' },
    { k: '增强', v: item.enhance ? '已开启' : '未开启' }, { k: '时间', v: new Date(item.ts).toLocaleString('zh-CN') },
  ];
  fields.forEach(function(f) {
    var d = document.createElement('div'); d.className = 'lm';
    d.innerHTML = '<span class="lk">' + f.k + '</span><span class="lv" title="' + f.v + '">' + f.v + '</span>';
    metaEl.appendChild(d);
  });
  // 先清除旧的描述段落，再插入新的
  var oldDesc = document.getElementById('lbAiDesc');
  if (oldDesc) oldDesc.parentNode.removeChild(oldDesc);
  if (item.aiDesc) {
    var desc = document.createElement('p');
    desc.id = 'lbAiDesc';
    desc.style.cssText = 'font-size:12px;color:var(--muted);margin-bottom:12px;line-height:1.5;padding:8px 10px;background:var(--surface2);border-radius:var(--r-sm);border:1px solid var(--border)';
    desc.textContent = '✦ ' + item.aiDesc;
    metaEl.parentNode.insertBefore(desc, metaEl.nextSibling);
  }
  // 更新翻页按钮状态和计数器
  var idx = allItems.findIndex(function(i) { return i.id === item.id; });
  var prevBtn = document.getElementById('lbPrev');
  var nextBtn = document.getElementById('lbNext');
  var counter = document.getElementById('lbCounter');
  prevBtn.disabled = idx <= 0;
  nextBtn.disabled = idx >= allItems.length - 1;
  counter.textContent = (idx + 1) + ' / ' + allItems.length;

  lb.classList.add('show');
}
document.getElementById('lbClose').addEventListener('click', function() { lb.classList.remove('show'); });
lb.addEventListener('click', function(e) { if (e.target === lb) lb.classList.remove('show'); });

// 上一张 / 下一张
function lbNavigate(dir) {
  if (!curItem) return;
  var idx = allItems.findIndex(function(i) { return i.id === curItem.id; });
  var next = idx + dir;
  if (next >= 0 && next < allItems.length) openLightbox(allItems[next]);
}
document.getElementById('lbPrev').addEventListener('click', function(e) { e.stopPropagation(); lbNavigate(-1); });
document.getElementById('lbNext').addEventListener('click', function(e) { e.stopPropagation(); lbNavigate(1); });

// 键盘：← → 翻页，Esc 关闭
document.addEventListener('keydown', function(e) {
  if (!lb.classList.contains('show')) return;
  if (e.key === 'Escape')     { lb.classList.remove('show'); }
  else if (e.key === 'ArrowLeft')  { lbNavigate(-1); }
  else if (e.key === 'ArrowRight') { lbNavigate(1); }
});
document.getElementById('lbDel').addEventListener('click', async function() {
  if (!curItem) return;
  if (!confirm('确认删除这张图片的记录？（图床原图不受影响）')) return;
  try {
    var res = await apiFetch('/gallery/delete?id=' + curItem.id, 'DELETE');
    if (res.ok) { lb.classList.remove('show'); toast('已删除', 'ok'); loadPage(curPage, curQ); }
    else toast('删除失败', 'err');
  } catch(e) {}
});

// ── AI 打标签 ───────────────────────────────────────────────────────────────
document.getElementById('lbRetag').addEventListener('click', async function() {
  if (!curItem) return;
  var btn = this;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 识别中…';
  try {
    var res = await apiFetch('/gallery/retag?id=' + curItem.id, 'POST');
    var data = await res.json();
    if (res.ok && data.ok) {
      toast('AI 打标签完成', 'ok');
      // 更新当前 curItem 并刷新 Lightbox 显示
      curItem.aiTags   = data.aiTags   || [];
      curItem.aiDesc   = data.aiDesc   || '';
      curItem.prompt   = data.prompt   || curItem.prompt;
      curItem.searchText = data.searchText || curItem.searchText;
      openLightbox(curItem);
      // 刷新卡片标签
      var card = document.querySelector('.gcard[data-id="' + curItem.id + '"]');
      if (card) {
        var tagsEl = card.querySelector('.gcard-tags');
        if (tagsEl) {
          tagsEl.innerHTML = '';
          (curItem.aiTags || []).slice(0, 4).forEach(function(t) {
            var s = document.createElement('span'); s.className = 'tag ai'; s.textContent = t; tagsEl.appendChild(s);
          });
        }
      }
    } else {
      toast(data.error || 'AI 识别失败', 'err');
    }
  } catch(e) { toast('请求失败', 'err'); }
  finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> AI 打标签';
  }
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
      form.append('file', f, f.name); form.append('prompt', '');
      // 注意：ingest 接口使用 Cookie 认证，无需手动传密码
      var res = await fetch(API_BASE + '/gallery/ingest', { method: 'POST', credentials: 'include', body: form });
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
  var urls = raw.split(NL).map(function(u) { return u.trim(); }).filter(Boolean);
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
      var res = await apiFetch('/gallery/import', 'POST', { urls: batch });
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

// ═══════════════════════════════════════════════════════════════════════════
//  常量
// ═══════════════════════════════════════════════════════════════════════════

const PAGE_SIZE   = 24;
const SESSION_COOKIE = 'gallery_session';
const SESSION_TTL    = 86400; // 24 小时（秒）

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ═══════════════════════════════════════════════════════════════════════════
//  工具函数
// ═══════════════════════════════════════════════════════════════════════════

function jsonResp(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', ...extraHeaders },
  });
}

// ── HMAC-SHA256 签名（用于 Cookie 防伪造）────────────────────────────────
async function hmacSign(secret, data) {
  const enc  = new TextEncoder();
  const key  = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig  = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function hmacVerify(secret, data, sig) {
  const expected = await hmacSign(secret, data);
  return expected === sig;
}

// ── Session Cookie 工具 ───────────────────────────────────────────────────
// Cookie 格式：base64(payload).signature
// payload = { exp: <unix秒> }

async function createSession(secret) {
  const exp     = Math.floor(Date.now() / 1000) + SESSION_TTL;
  const payload = btoa(JSON.stringify({ exp }));
  const sig     = await hmacSign(secret, payload);
  return `${payload}.${sig}`;
}

async function verifySession(secret, cookie) {
  if (!cookie) return false;
  const dot = cookie.lastIndexOf('.');
  if (dot < 0) return false;
  const payload = cookie.slice(0, dot);
  const sig     = cookie.slice(dot + 1);
  if (!(await hmacVerify(secret, payload, sig))) return false;
  try {
    const { exp } = JSON.parse(atob(payload));
    return Math.floor(Date.now() / 1000) < exp;
  } catch { return false; }
}

function getSessionFromRequest(request) {
  const cookieHeader = request.headers.get('Cookie') || '';
  for (const part of cookieHeader.split(';')) {
    const [k, ...vs] = part.trim().split('=');
    if (k.trim() === SESSION_COOKIE) return vs.join('=');
  }
  return null;
}

function makeSessionCookieHeader(value, maxAge) {
  return `${SESSION_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

// ── KV 缓存工具 ───────────────────────────────────────────────────────────
async function kvCacheGet(kv, key) {
  try {
    const raw = await kv.get(`cache:${key}`);
    if (!raw) return null;
    const { data, exp } = JSON.parse(raw);
    if (Date.now() / 1000 > exp) { kv.delete(`cache:${key}`).catch(() => {}); return null; }
    return data;
  } catch { return null; }
}

async function kvCacheSet(kv, key, data, ttl = 60) {
  const exp = Math.floor(Date.now() / 1000) + ttl;
  await kv.put(`cache:${key}`, JSON.stringify({ data, exp }), { expirationTtl: ttl + 10 });
}

async function kvCacheInvalidate(kv, pattern) {
  // 批量清除分页缓存（只清 list 前 5 页）
  const keys = [];
  for (let i = 1; i <= 5; i++) keys.push(`list:${i}`);
  if (pattern) keys.push(pattern);
  await Promise.allSettled(keys.map(k => kv.delete(`cache:${k}`)));
}

// ── AI 视觉打标签 ─────────────────────────────────────────────────────────
async function runAIVision(env, imgArr) {
  let aiTags = [], aiDesc = '';
  try {
    if (!env.AI) return { aiTags, aiDesc };
    const vision = await env.AI.run('@cf/llava-hf/llava-1.5-7b-hf', {
      image: imgArr,
      prompt: 'Describe this image briefly. List 6-10 tags for subject, style, colors, mood. Format: DESCRIPTION: <text> | TAGS: tag1, tag2, tag3',
      max_tokens: 200,
    });
    const raw = (vision && vision.description) ? vision.description : '';
    const dm  = raw.match(/DESCRIPTION:\s*(.+?)\s*\|/);
    const tm  = raw.match(/TAGS:\s*(.+)/);
    const engDesc = dm ? dm[1].trim() : raw.slice(0, 120);
    const engTags = tm ? tm[1].split(',').map(t => t.trim()).filter(Boolean).slice(0, 10) : [];

    const llama = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: '将以下英文翻译成中文，只输出翻译结果，格式为两行：\n描述：xxx\n标签：标签1，标签2，标签3' },
        { role: 'user',   content: 'DESC: ' + engDesc + '\nTAGS: ' + engTags.join(', ') },
      ],
      max_tokens: 200,
    });
    const tr  = (llama && llama.response) ? llama.response.trim() : '';
    const tdm = tr.match(/描述[：:]\s*(.+)/);
    const ttm = tr.match(/标签[：:]\s*(.+)/);
    aiDesc = tdm ? tdm[1].trim() : engDesc;
    const tagStr = ttm ? ttm[1] : engTags.join('，');
    aiTags = tagStr.split(/[,，]/).map(t => t.trim()).filter(Boolean).slice(0, 10);
  } catch (e) { console.error('[AI vision]', e.message); }
  return { aiTags, aiDesc };
}

// ── 上传图片到图床 ────────────────────────────────────────────────────────
async function uploadToImageHost(imageHost, imgBytes, contentType) {
  const ext = contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg'
            : contentType.includes('webp') ? 'webp' : 'png';
  const form = new FormData();
  form.append('file', new Blob([imgBytes], { type: contentType }), `upload.${ext}`);
  const res = await fetch(`${imageHost}/upload`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`图床返回 ${res.status}`);
  const json = await res.json();
  const src  = Array.isArray(json) ? json[0]?.src : json?.src;
  if (!src) throw new Error('图床未返回 src');
  return src.startsWith('http') ? src : imageHost + src;
}

// ── 保存记录到 D1 + KV 双写 ───────────────────────────────────────────────
async function saveRecord(env, record) {
  // 写入 D1 主库
  await env.GALLERY_DB.prepare(`
    INSERT OR REPLACE INTO images
      (id, image_url, prompt, original_prompt, model, width, height, seed, enhance,
       ai_desc, ai_tags, prompt_tags, search_text, ts, source, metadata)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    record.id,
    record.imageUrl,
    record.prompt || '',
    record.originalPrompt || record.prompt || '',
    record.model || '',
    record.width || 0,
    record.height || 0,
    record.seed || 0,
    record.enhance ? 1 : 0,
    record.aiDesc || '',
    JSON.stringify(record.aiTags || []),
    JSON.stringify(record.promptTags || []),
    record.searchText || '',
    record.ts,
    record.source || 'generated',
    JSON.stringify(record),  // 完整 JSON 备份在 metadata 字段
  ).run();

  // 异步备份到 KV（不阻塞响应）
  const kvKey = `img:${String(record.ts).padStart(16, '0')}:${record.id.slice(0, 8)}`;
  env.GALLERY_KV.put(kvKey, JSON.stringify(record)).catch(e => console.error('[KV backup]', e));
}

// ── 从 D1 行还原前端所需对象 ──────────────────────────────────────────────
function rowToRecord(row) {
  // 优先使用完整 metadata 字段，兼容旧数据
  if (row.metadata) {
    try { return JSON.parse(row.metadata); } catch {}
  }
  return {
    id:             row.id,
    imageUrl:       row.image_url,
    prompt:         row.prompt,
    originalPrompt: row.original_prompt,
    model:          row.model,
    width:          row.width,
    height:         row.height,
    seed:           row.seed,
    enhance:        !!row.enhance,
    aiDesc:         row.ai_desc,
    aiTags:         JSON.parse(row.ai_tags  || '[]'),
    promptTags:     JSON.parse(row.prompt_tags || '[]'),
    searchText:     row.search_text,
    ts:             row.ts,
    source:         row.source,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Worker 主入口
// ═══════════════════════════════════════════════════════════════════════════

export default {
  async fetch(request, env) {

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url  = new URL(request.url);
    const path = url.pathname;

    const SECRET   = env.SESSION_SECRET || 'change-me-in-env';
    const CACHE_TTL = parseInt(env.CACHE_TTL || '60');

    // ── 身份认证（Cookie Session 优先，兼容旧 X-Password 头）────────────
    // Cookie Session：浏览器登录后使用
    // X-Password：文生图等 Worker 间调用时使用（无法携带 Cookie）
    async function isAuthed() {
      const PASSWORDS = env.PASSWORD
        ? env.PASSWORD.split(',').map(p => p.trim()).filter(Boolean)
        : [];
      if (!PASSWORDS.length) return true;

      // 方式一：Cookie Session（浏览器）
      const token = getSessionFromRequest(request);
      if (await verifySession(SECRET, token)) return true;

      // 方式二：X-Password 头（Worker 间调用兼容）
      const xpwd = request.headers.get('X-Password') || '';
      if (xpwd && PASSWORDS.includes(xpwd)) return true;

      return false;
    }

    function unauth() {
      return jsonResp({ error: '未授权，请先登录' }, 401);
    }

    try {

      // ── POST /gallery/login ─────────────────────────────────────────────
      if (path === '/gallery/login' && request.method === 'POST') {
        const PASSWORDS = env.PASSWORD
          ? env.PASSWORD.split(',').map(p => p.trim()).filter(Boolean)
          : [];

        // 没设置密码，直接放行
        if (!PASSWORDS.length) {
          const token = await createSession(SECRET);
          return jsonResp({ ok: true }, 200, {
            'Set-Cookie': makeSessionCookieHeader(token, SESSION_TTL),
          });
        }

        const body = await request.json().catch(() => ({}));
        const pwd  = (body.password || '').trim();

        if (!PASSWORDS.includes(pwd)) {
          return jsonResp({ error: '密码错误' }, 401);
        }

        const token = await createSession(SECRET);
        return jsonResp({ ok: true }, 200, {
          'Set-Cookie': makeSessionCookieHeader(token, SESSION_TTL),
        });
      }

      // ── POST /gallery/logout ────────────────────────────────────────────
      if (path === '/gallery/logout' && request.method === 'POST') {
        return jsonResp({ ok: true }, 200, {
          'Set-Cookie': makeSessionCookieHeader('', 0),
        });
      }

      // ── GET / ───────────────────────────────────────────────────────────
      if (request.method === 'GET' && (path === '/' || path === '/gallery')) {
        const html = HTML.replace('YOUR_TEXT2IMG_URL', env.TEXT2IMG_URL || '#');
        return new Response(html, {
          status: 200,
          headers: { ...CORS, 'Content-Type': 'text/html; charset=utf-8' },
        });
      }

      // ── POST /gallery/ingest ────────────────────────────────────────────
      if (path === '/gallery/ingest' && request.method === 'POST') {
        if (!(await isAuthed())) return unauth();

        const form       = await request.formData();
        const file       = form.get('file');
        const prompt     = form.get('prompt')          || '';
        const origPrompt = form.get('originalPrompt')  || prompt;
        const model      = form.get('model')           || '';
        const width      = parseInt(form.get('width'))  || 0;
        const height     = parseInt(form.get('height')) || 0;
        const seed       = parseInt(form.get('seed'))   || 0;
        const enhance    = form.get('enhance') === 'true';
        const imageHost  = form.get('imageHost') || env.IMAGE_HOST || '';

        if (!file)       return jsonResp({ error: '缺少图片文件' }, 400);
        if (!imageHost)  return jsonResp({ error: '未配置 IMAGE_HOST' }, 400);

        const imgBytes   = await file.arrayBuffer();
        const imgArr     = [...new Uint8Array(imgBytes)];
        const contentType = file.type || 'image/png';

        // AI 视觉
        const { aiTags, aiDesc } = await runAIVision(env, imgArr);

        // 上传图床
        let imageUrl = '';
        try {
          imageUrl = await uploadToImageHost(imageHost, imgBytes, contentType);
        } catch (e) {
          console.error('[ingest] imageHost upload error:', e.message);
          return jsonResp({ error: '图床上传失败：' + e.message }, 502);
        }

        const promptTags = prompt.toLowerCase()
          .replace(/[,，。.!！?？]/g, ' ').split(/\s+/)
          .filter(w => w.length > 2 && w.length < 20).slice(0, 8);

        const record = {
          id: crypto.randomUUID(), imageUrl, prompt,
          originalPrompt: origPrompt, model, width, height, seed, enhance,
          aiDesc, aiTags, promptTags,
          searchText: [prompt, origPrompt, model, ...aiTags, ...promptTags].join(' ').toLowerCase(),
          ts: Date.now(), source: 'generated',
        };

        await saveRecord(env, record);
        await kvCacheInvalidate(env.GALLERY_KV);

        return jsonResp({ ok: true, imageUrl, aiTags, aiDesc, id: record.id });
      }

      // ── POST /gallery/save ──────────────────────────────────────────────
      if (path === '/gallery/save' && request.method === 'POST') {
        if (!(await isAuthed())) return unauth();

        const body = await request.json();
        const { imageUrl, prompt, model, width, height, seed, enhance, originalPrompt } = body;
        if (!imageUrl || !prompt) return jsonResp({ error: '缺少 imageUrl 或 prompt' }, 400);

        let aiTags = [], aiDesc = '';
        try {
          if (env.AI) {
            const imgRes = await fetch(imageUrl);
            if (imgRes.ok) {
              const imgArr = [...new Uint8Array(await imgRes.arrayBuffer())];
              const result = await runAIVision(env, imgArr);
              aiTags = result.aiTags; aiDesc = result.aiDesc;
            }
          }
        } catch (e) { console.error('[save] AI vision failed:', e); }

        const promptTags = prompt.toLowerCase()
          .replace(/[,，。.!！?？]/g, ' ').split(/\s+/)
          .filter(w => w.length > 2 && w.length < 20).slice(0, 8);

        const record = {
          id: crypto.randomUUID(), imageUrl, prompt,
          originalPrompt: originalPrompt || prompt,
          model: model || '', width: width || 0, height: height || 0,
          seed: seed || 0, enhance: !!enhance, aiDesc, aiTags, promptTags,
          searchText: [prompt, originalPrompt, model, ...aiTags, ...promptTags].join(' ').toLowerCase(),
          ts: Date.now(),
        };

        await saveRecord(env, record);
        await kvCacheInvalidate(env.GALLERY_KV);

        return jsonResp({ ok: true, id: record.id, aiTags, aiDesc });
      }

      // ── GET /gallery/list（分页，走 KV 缓存）────────────────────────────
      if (path === '/gallery/list' && request.method === 'GET') {
        if (!(await isAuthed())) return unauth();

        const page     = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
        const cacheKey = `list:${page}`;

        // 尝试读缓存
        const cached = await kvCacheGet(env.GALLERY_KV, cacheKey);
        if (cached) return jsonResp(cached);

        const offset = (page - 1) * PAGE_SIZE;
        const [countResult, rowsResult] = await Promise.all([
          env.GALLERY_DB.prepare('SELECT COUNT(*) as cnt FROM images').first(),
          env.GALLERY_DB.prepare('SELECT * FROM images ORDER BY ts DESC LIMIT ? OFFSET ?')
            .bind(PAGE_SIZE, offset).all(),
        ]);

        const total = countResult?.cnt ?? 0;
        const items = (rowsResult?.results || []).map(rowToRecord);
        const payload = { total, page, items };

        // 写缓存
        await kvCacheSet(env.GALLERY_KV, cacheKey, payload, CACHE_TTL);

        return jsonResp(payload);
      }

      // ── GET /gallery/search（SQL LIKE，不走缓存）─────────────────────────
      if (path === '/gallery/search' && request.method === 'GET') {
        if (!(await isAuthed())) return unauth();

        const q    = (url.searchParams.get('q') || '').toLowerCase().trim();
        const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));

        if (!q) {
          // 无关键词时走 list 逻辑（带缓存）
          url.searchParams.set('page', String(page));
          const newReq = new Request(request.url.replace('/gallery/search', '/gallery/list'), request);
          return this.fetch(new Request(
            url.origin + '/gallery/list?page=' + page,
            { method: 'GET', headers: request.headers }
          ), env);
        }

        const offset  = (page - 1) * PAGE_SIZE;
        const like    = `%${q}%`;
        const [countResult, rowsResult] = await Promise.all([
          env.GALLERY_DB.prepare('SELECT COUNT(*) as cnt FROM images WHERE search_text LIKE ?').bind(like).first(),
          env.GALLERY_DB.prepare('SELECT * FROM images WHERE search_text LIKE ? ORDER BY ts DESC LIMIT ? OFFSET ?')
            .bind(like, PAGE_SIZE, offset).all(),
        ]);

        const total = countResult?.cnt ?? 0;
        const items = (rowsResult?.results || []).map(rowToRecord);
        return jsonResp({ total, page, items });
      }

      // ── POST /gallery/import ─────────────────────────────────────────────
      if (path === '/gallery/import' && request.method === 'POST') {
        if (!(await isAuthed())) return unauth();

        const body    = await request.json();
        const urlList = body.urls ? body.urls : (body.imageUrl ? [body.imageUrl] : []);
        if (!urlList.length) return jsonResp({ error: '缺少 imageUrl 或 urls' }, 400);

        const imageHost = env.IMAGE_HOST || '';
        const results   = [];

        for (const imageUrl of urlList.slice(0, 20)) {
          const trimmed = imageUrl.trim();
          if (!trimmed) continue;

          // 用 D1 检查重复（一条 SQL，不再全量扫描）
          const exists = await env.GALLERY_DB
            .prepare('SELECT 1 FROM images WHERE image_url = ? LIMIT 1')
            .bind(trimmed).first();
          if (exists) { results.push({ imageUrl: trimmed, status: 'skipped', reason: '已存在' }); continue; }

          // 下载图片
          let imgBytes, contentType;
          try {
            const imgRes = await fetch(trimmed);
            if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status}`);
            imgBytes    = await imgRes.arrayBuffer();
            contentType = imgRes.headers.get('content-type') || 'image/png';
          } catch (e) {
            results.push({ imageUrl: trimmed, status: 'error', reason: '下载失败：' + e.message });
            continue;
          }

          // AI 打标签
          const imgArr = [...new Uint8Array(imgBytes)];
          const { aiTags, aiDesc } = await runAIVision(env, imgArr);

          // 转存到图床
          let finalUrl = trimmed;
          if (imageHost) {
            try {
              finalUrl = await uploadToImageHost(imageHost, imgBytes, contentType);
            } catch (e) { console.error('[import] imageHost upload error:', e.message); }
          }

          const record = {
            id: crypto.randomUUID(), imageUrl: finalUrl,
            prompt: aiDesc || '手动导入', originalPrompt: '手动导入',
            model: 'manual', width: 0, height: 0, seed: 0, enhance: false,
            aiDesc, aiTags, promptTags: aiTags.slice(0, 5),
            searchText: [aiDesc, ...aiTags].join(' ').toLowerCase(),
            ts: Date.now(), source: 'manual',
          };

          await saveRecord(env, record);
          results.push({ imageUrl: finalUrl, status: 'ok', id: record.id, aiTags, aiDesc });

          if (urlList.length > 1) await new Promise(r => setTimeout(r, 200));
        }

        await kvCacheInvalidate(env.GALLERY_KV);

        const okCount   = results.filter(r => r.status === 'ok').length;
        const skipCount = results.filter(r => r.status === 'skipped').length;
        return jsonResp({ ok: true, total: results.length, imported: okCount, skipped: skipCount, results });
      }

      // ── POST /gallery/retag ──────────────────────────────────────────────
      if (path === '/gallery/retag' && request.method === 'POST') {
        if (!(await isAuthed())) return unauth();

        const id = url.searchParams.get('id');
        if (!id) return jsonResp({ error: '缺少 id' }, 400);

        // 从 D1 查出记录
        const row = await env.GALLERY_DB.prepare('SELECT * FROM images WHERE id = ?').bind(id).first();
        if (!row) return jsonResp({ error: '记录不存在' }, 404);

        const imageUrl = row.image_url;

        // 下载图片并运行 AI 视觉
        let aiTags = [], aiDesc = '';
        try {
          const imgRes = await fetch(imageUrl);
          if (!imgRes.ok) throw new Error('图片下载失败 ' + imgRes.status);
          const imgArr = [...new Uint8Array(await imgRes.arrayBuffer())];
          const result = await runAIVision(env, imgArr);
          aiTags = result.aiTags;
          aiDesc = result.aiDesc;
        } catch (e) {
          return jsonResp({ error: 'AI 识别失败：' + e.message }, 500);
        }

        // 更新 D1
        const searchText = [row.prompt || '', row.original_prompt || '', row.model || '', ...aiTags].join(' ').toLowerCase();
        await env.GALLERY_DB.prepare(`
          UPDATE images SET ai_desc=?, ai_tags=?, search_text=?, metadata=? WHERE id=?
        `).bind(
          aiDesc,
          JSON.stringify(aiTags),
          searchText,
          JSON.stringify({ ...JSON.parse(row.metadata || '{}'), aiDesc, aiTags, searchText }),
          id
        ).run();

        // 清缓存
        await kvCacheInvalidate(env.GALLERY_KV);

        return jsonResp({ ok: true, aiTags, aiDesc, prompt: row.prompt, searchText });
      }

      // ── DELETE /gallery/delete ───────────────────────────────────────────
      if (path === '/gallery/delete' && request.method === 'DELETE') {
        if (!(await isAuthed())) return unauth();

        const id = url.searchParams.get('id');
        if (!id) return jsonResp({ error: '缺少 id' }, 400);

        // D1 直接按 id 删除（O(1)，不需要全量扫描）
        const result = await env.GALLERY_DB
          .prepare('DELETE FROM images WHERE id = ?')
          .bind(id).run();

        if (!result.meta?.changes) return jsonResp({ error: '记录不存在' }, 404);

        // 同步清理 KV 备份（异步，不阻塞）
        env.GALLERY_KV.list({ prefix: `img:` }).then(listed => {
          for (const k of listed.keys) {
            if (k.name.includes(id.slice(0, 8))) {
              env.GALLERY_KV.delete(k.name).catch(() => {});
              break;
            }
          }
        }).catch(() => {});

        await kvCacheInvalidate(env.GALLERY_KV);
        return jsonResp({ ok: true });
      }

      return new Response('Not Found', { status: 404 });

    } catch (err) {
      console.error('Gallery worker error:', err);
      return jsonResp({ error: '服务器内部错误', details: err.message }, 500);
    }
  },
};
