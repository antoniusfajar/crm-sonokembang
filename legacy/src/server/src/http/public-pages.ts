import type { forms } from '../db/schema.js';

// Halaman publik tanpa React: form yang bisa dibuka langsung / disematkan (iframe / QR),
// dan skrip livechat widget untuk website.

type Form = typeof forms.$inferSelect;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function renderFormPage(f: Form | null, biz: { name: string; logoPath?: string | null }) {
  const title = f ? (f.settings.title || f.name) : 'Form tidak ditemukan';
  const fields = f
    ? f.fields
        .map((x) => {
          const req = x.required ? ' required' : '';
          const label = `<label for="f_${esc(x.key)}">${esc(x.label)}${x.required ? ' <span class="req">*</span>' : ''}</label>`;
          let input: string;
          if (x.type === 'select') input = `<select id="f_${esc(x.key)}" name="${esc(x.key)}"${req}><option value="">— pilih —</option>${(x.options ?? []).map((o) => `<option>${esc(o)}</option>`).join('')}</select>`;
          else if (x.type === 'textarea') input = `<textarea id="f_${esc(x.key)}" name="${esc(x.key)}" rows="3"${req}></textarea>`;
          else {
            const type = { text: 'text', phone: 'tel', email: 'email', number: 'text', date: 'date' }[x.type] ?? 'text';
            const extra = x.type === 'phone' ? ' inputmode="tel" autocomplete="tel" placeholder="08xx atau 62xx"' : x.type === 'number' ? ' inputmode="numeric"' : x.type === 'email' ? ' autocomplete="email"' : x.mapTo === 'name' ? ' autocomplete="name"' : '';
            input = `<input id="f_${esc(x.key)}" name="${esc(x.key)}" type="${type}"${extra}${req}>`;
          }
          return `<div class="fld">${label}${input}<div class="err" data-for="${esc(x.key)}"></div></div>`;
        })
        .join('\n')
    : '';
  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ${esc(biz.name)}</title>
<meta name="robots" content="noindex">
<style>
:root{--rose:#db6262;--red:#c6040d;--ink:#201c1a;--muted:#6b625c;--line:#ebe3dc;--bg:#fbf7f3}
*{box-sizing:border-box}body{margin:0;background:var(--bg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink)}
main{max-width:560px;margin:0 auto;padding:28px 16px 48px}
.card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:24px;box-shadow:0 8px 24px rgba(32,28,26,.06);border-top:5px solid var(--red)}
.brand{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:13px;margin-bottom:6px}.brand img{width:32px;height:32px;border-radius:8px;object-fit:contain}
h1{font:700 24px/1.25 Georgia,serif;margin:0 0 6px}p.intro{color:var(--muted);margin:0 0 18px}
.fld{margin-bottom:14px}label{display:block;font-weight:600;font-size:13.5px;margin-bottom:5px}.req{color:var(--red)}
input,select,textarea{width:100%;padding:11px 12px;border:1px solid #d9cfc6;border-radius:10px;font:inherit;background:#fff;color:inherit}
input:focus,select:focus,textarea:focus{outline:2px solid var(--rose);outline-offset:1px;border-color:var(--rose)}
.err{color:var(--red);font-size:12.5px;min-height:0;margin-top:3px}
button{width:100%;padding:13px;border:0;border-radius:10px;background:var(--rose);color:#fff;font:600 15px/1 inherit;cursor:pointer;margin-top:4px}button:disabled{opacity:.6}
.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.done{text-align:center;padding:24px 8px}.done .ic{font-size:40px}.foot{text-align:center;color:var(--muted);font-size:12px;margin-top:14px}
.alert{background:#fde8e8;color:#9b1c1c;border-radius:10px;padding:10px 12px;margin-bottom:12px;display:none}
</style></head>
<body><main><div class="card">
<div class="brand">${biz.logoPath ? '<img src="/api/public/logo" alt="">' : ''}<span>${esc(biz.name)}</span></div>
${
  f
    ? `<div id="formwrap"><h1>${esc(title)}</h1>${f.settings.intro ? `<p class="intro">${esc(f.settings.intro)}</p>` : ''}
<div class="alert" id="alert"></div>
<form id="f" novalidate>
${fields}
<div class="hp" aria-hidden="true"><label>Jangan diisi<input name="_hp" tabindex="-1" autocomplete="off"></label></div>
<button type="submit" id="btn">${esc(f.settings.submitLabel || 'Kirim')}</button>
</form></div>
<div class="done" id="done" hidden><div class="ic">✓</div><h1>Terkirim</h1><p class="intro" id="thanks"></p></div>`
    : '<h1>Form tidak ditemukan</h1><p class="intro">Form ini sudah ditutup atau alamatnya salah. Silakan hubungi kami lewat WhatsApp.</p>'
}
</div><div class="foot">Data Anda hanya dipakai untuk menghubungi Anda terkait pesanan.</div></main>
${
  f
    ? `<script>
(function(){
  var form=document.getElementById('f'),btn=document.getElementById('btn'),alertBox=document.getElementById('alert');
  var q=new URLSearchParams(location.search),utm={};['utm_source','utm_medium','utm_campaign','utm_content'].forEach(function(k){if(q.get(k))utm[k]=q.get(k)});
  var page=q.get('page')||document.referrer||'';
  form.addEventListener('submit',function(e){
    e.preventDefault();alertBox.style.display='none';
    document.querySelectorAll('.err').forEach(function(x){x.textContent=''});
    var data={};new FormData(form).forEach(function(v,k){if(k!=='_hp')data[k]=String(v)});
    btn.disabled=true;btn.textContent='Mengirim…';
    fetch(${JSON.stringify(`/api/public/forms/${f.slug}`)},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({answers:data,_hp:form._hp.value,_page:page,_utm:utm})})
      .then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j}})})
      .then(function(res){
        if(res.ok){document.getElementById('formwrap').hidden=true;document.getElementById('thanks').textContent=res.j.thankYou;document.getElementById('done').hidden=false;return}
        var errs=(res.j.details&&res.j.details.errors)||{};var any=false;
        Object.keys(errs).forEach(function(k){var el=document.querySelector('.err[data-for="'+k+'"]');if(el){el.textContent=errs[k];any=true}});
        if(!any){alertBox.textContent=res.j.error||'Gagal mengirim, coba lagi.';alertBox.style.display='block'}
      })
      .catch(function(){alertBox.textContent='Koneksi terputus, coba lagi.';alertBox.style.display='block'})
      .finally(function(){btn.disabled=false;btn.textContent=${JSON.stringify(f.settings.submitLabel || 'Kirim')}});
  });
})();
</script>`
    : ''
}
</body></html>`;
}

/**
 * Skrip widget: <script src="https://crm.../widget.js" defer></script>
 * Tombol di pojok → panel sapaan (+ form pra-chat opsional) → buka WhatsApp hotline dengan penanda halaman.
 * Dirender di Shadow DOM supaya gaya website tidak bertabrakan.
 */
export const WIDGET_JS = `(function(){
  if (window.__skWidget) return; window.__skWidget = true;
  var me = document.currentScript || document.querySelector('script[src*="widget.js"]');
  var base = new URL(me.src).origin;
  fetch(base + '/api/public/widget').then(function(r){return r.json()}).then(function(c){ if (c && c.enabled) mount(c); }).catch(function(){});
  function el(tag, attrs, html){ var e=document.createElement(tag); for (var k in attrs||{}) e.setAttribute(k, attrs[k]); if (html!=null) e.innerHTML=html; return e; }
  function esc(s){ return String(s||'').replace(/[&<>"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]}); }
  function mount(c){
    var host = el('div', {id:'sk-chat-widget'}); document.body.appendChild(host);
    var root = host.attachShadow ? host.attachShadow({mode:'open'}) : host;
    var side = c.position === 'left' ? 'left' : 'right';
    var css = ':host{all:initial}*{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}'+
      '.wrap{position:fixed;bottom:24px;'+side+':24px;z-index:2147483000;display:flex;flex-direction:column;align-items:'+(side==='left'?'flex-start':'flex-end')+';gap:10px}'+
      '.launch{border:0;cursor:pointer;background:'+c.color+';color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.18);display:flex;align-items:center;gap:8px;position:relative}'+
      '.bubble{width:58px;height:58px;border-radius:50%;justify-content:center}.pill{height:50px;border-radius:999px;padding:0 20px;font:600 15px/1 inherit}'+
      '.dot{position:absolute;top:-2px;right:-2px;min-width:20px;height:20px;border-radius:10px;background:#c6040d;color:#fff;font:700 11px/20px inherit;text-align:center;border:2px solid #fff}'+
      '.greet{background:#fff;color:#201c1a;border-radius:14px;padding:10px 14px;box-shadow:0 6px 20px rgba(0,0,0,.14);max-width:260px;font:14px/1.45 inherit;cursor:pointer}'+
      '.panel{width:320px;max-width:calc(100vw - 32px);background:#fff;border-radius:16px;box-shadow:0 12px 36px rgba(0,0,0,.22);overflow:hidden;color:#201c1a}'+
      '.head{background:'+c.color+';color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px}.head b{font-size:15px}.head small{display:block;opacity:.9;font-size:12px}'+
      '.head img{width:34px;height:34px;border-radius:50%;background:#fff;object-fit:contain}.x{margin-left:auto;background:none;border:0;color:#fff;font-size:20px;cursor:pointer}'+
      '.body{padding:14px 16px;font-size:14px;line-height:1.45}.msg{background:#f3eee9;border-radius:12px 12px 12px 2px;padding:9px 12px;margin-bottom:12px}'+
      'label{display:block;font-size:12.5px;font-weight:600;margin:8px 0 4px}input,select{width:100%;padding:9px 10px;border:1px solid #d9cfc6;border-radius:9px;font:inherit;font-size:14px}'+
      '.go{width:100%;margin-top:12px;border:0;border-radius:10px;padding:12px;background:#25d366;color:#fff;font:600 15px/1 inherit;cursor:pointer}.go:disabled{opacity:.6}'+
      '.note{font-size:11.5px;color:#857a72;margin-top:8px;text-align:center}.err{color:#c6040d;font-size:12px;margin-top:6px}.hp{display:none}';
    var icon = '<svg width="28" height="28" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.66 15l-1.3 4.74 4.86-1.27A10 10 0 1 0 12 2zm5.47 14.2c-.23.65-1.35 1.24-1.86 1.3-.48.06-1.08.09-1.75-.11a16 16 0 0 1-1.58-.59 12.4 12.4 0 0 1-4.73-4.18 5.4 5.4 0 0 1-1.13-2.87 3.1 3.1 0 0 1 .97-2.3c.24-.27.53-.34.7-.34h.5c.16 0 .38-.06.6.46.23.53.77 1.83.84 1.97.07.13.11.29.02.47-.09.18-.13.29-.27.45l-.4.47c-.13.13-.27.28-.12.55.16.27.7 1.15 1.5 1.86 1.03.92 1.9 1.2 2.17 1.34.27.13.43.11.58-.07.16-.18.67-.78.85-1.05.18-.27.36-.22.6-.13.25.09 1.57.74 1.84.88.27.13.45.2.52.31.07.11.07.65-.16 1.3z"/></svg>';
    root.innerHTML = '<style>'+css+'</style><div class="wrap"></div>';
    var wrap = root.querySelector('.wrap');
    var open = false, dismissed = false;
    function render(){
      var page = location.pathname;
      if (!open) {
        var html = '';
        if (c.showGreeting && c.greeting && !dismissed) html += '<div class="greet" data-a="open">'+esc(c.greeting)+'</div>';
        html += '<button class="launch '+(c.launcher==='pill'?'pill':'bubble')+'" data-a="open" aria-label="Chat WhatsApp">'+icon+(c.launcher==='pill'?esc(c.label||'Chat kami'):'')+(c.badge&&!dismissed?'<span class="dot">1</span>':'')+'</button>';
        wrap.innerHTML = html;
      } else {
        var form = '';
        if (c.prechat) {
          form += '<label>Nama</label><input name="name" autocomplete="name" required>'+
            '<label>Nomor WhatsApp</label><input name="phone" inputmode="tel" autocomplete="tel" placeholder="08xx" required>';
          if (c.askEvent) form += '<label>Jenis acara</label><select name="eventType"><option value="">— pilih —</option>'+(c.eventOptions||[]).map(function(o){return '<option>'+esc(o)+'</option>'}).join('')+'</select>';
          if (c.askDate) form += '<label>Perkiraan tanggal</label><input name="eventDate" type="date">';
          form += '<input class="hp" name="_hp" tabindex="-1" autocomplete="off">';
        }
        wrap.innerHTML = '<div class="panel" role="dialog" aria-label="Chat '+esc(c.businessName)+'"><div class="head">'+(c.logo?'<img src="'+base+c.logo+'" alt="">':'')+
          '<div><b>'+esc(c.businessName)+'</b><small>'+esc(c.hoursNote||'Biasanya membalas dalam beberapa menit')+'</small></div><button class="x" data-a="close" aria-label="Tutup">×</button></div>'+
          '<div class="body"><div class="msg">'+esc(c.greeting||'Halo! Ada yang bisa kami bantu?')+'</div><form>'+form+
          '<button class="go" type="submit">Lanjut chat di WhatsApp</button><div class="err"></div></form><div class="note">Chat dibuka di WhatsApp</div></div></div>';
        var f = wrap.querySelector('form');
        f.addEventListener('submit', function(e){
          e.preventDefault();
          var data = {page: page}; new FormData(f).forEach(function(v,k){ data[k]=String(v); });
          var btn = f.querySelector('.go'), err = f.querySelector('.err'); btn.disabled = true; err.textContent='';
          fetch(base + '/api/public/widget/lead', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data)})
            .then(function(r){ return r.json().then(function(j){ return {ok:r.ok, j:j}; }); })
            .then(function(res){ if (!res.ok) { err.textContent = res.j.error || 'Coba lagi'; return; } window.open(res.j.waUrl, '_blank', 'noopener'); open=false; dismissed=true; render(); })
            .catch(function(){ err.textContent='Koneksi terputus, coba lagi'; })
            .finally(function(){ btn.disabled=false; });
        });
      }
    }
    wrap.addEventListener('click', function(e){
      var a = e.target.closest && e.target.closest('[data-a]'); if (!a) return;
      if (a.getAttribute('data-a')==='open') { open=true; dismissed=true; } else { open=false; }
      render();
    });
    render();
  }
})();`;
