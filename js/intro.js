// The site introduces itself — using only what your browser already says about you.

import { memory } from './state.js';

function os() {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Mac/.test(ua)) return navigator.maxTouchPoints > 1 ? 'iPadOS' : 'macOS';
  if (/Win/.test(ua)) return 'Windows';
  if (/Linux/.test(ua)) return 'Linux';
  return 'une machine que je ne connais pas';
}

function browser() {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\//.test(ua)) return 'Opera';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'un navigateur discret';
}

export function city() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    const c = tz.split('/').pop().replace(/_/g, ' ');
    return c && c !== 'UTC' ? c : '';
  } catch { return ''; }
}

export function clock() {
  return new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function since(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 2) return "il y a un instant";
  if (m < 60) return `il y a ${m} minutes`;
  const h = Math.round(m / 60);
  if (h < 48) return `il y a ${h} heure${h > 1 ? 's' : ''}`;
  return `il y a ${Math.round(h / 24)} jours`;
}

async function lines() {
  const h = new Date().getHours();
  const c = city();
  const out = ['bonjour.'];
  out.push(`il est ${clock()}${c ? ` à ${c}` : ''}.${h < 5 ? ' tu ne dors pas ?' : ''}`);
  out.push(`tu es sur ${os()}, avec ${browser()}.`);

  let hw = `ton écran fait ${screen.width}×${screen.height}`;
  if (navigator.hardwareConcurrency) hw += `, ton processeur a ${navigator.hardwareConcurrency} cœurs`;
  try {
    const b = await Promise.race([navigator.getBattery?.(), new Promise((r) => setTimeout(r, 300))]);
    if (b) hw += `, ta batterie est à ${Math.round(b.level * 100)} %${b.charging ? ' (en charge)' : ''}`;
  } catch { /* no battery API */ }
  out.push(hw + '.');

  if (memory.visits > 1) {
    out.push(`ce n'est pas ta première visite, c'est la ${memory.visits}e. la dernière, c'était ${since(memory.last)}.`);
    out.push('je me souviens de toi.');
  } else {
    out.push("c'est ta première visite. je m'en souviendrai.");
  }
  out.push("je t'attendais.");
  return out;
}

export async function runIntro(onEnter) {
  const el = document.getElementById('intro-text');
  const btn = document.getElementById('enter');
  const all = await lines();
  let fast = false, done = false;

  const skip = () => { fast = true; };
  document.getElementById('intro').addEventListener('pointerdown', skip);

  const wait = (ms) => new Promise((r) => setTimeout(r, fast ? 0 : ms));
  let html = '';
  for (const line of all) {
    html += '<span class="p">›</span> ';
    for (const ch of line) {
      html += ch === '<' ? '&lt;' : ch;
      el.innerHTML = html + '<span class="caret">&nbsp;</span>';
      await wait(ch === '.' || ch === ',' ? 140 : 22 + Math.random() * 30);
    }
    html += '\n';
    await wait(380);
  }
  el.innerHTML = html + '<span class="p">›</span> <span class="caret">&nbsp;</span>';
  btn.hidden = false;
  btn.focus({ preventScroll: true });

  const enter = () => {
    if (done) return;
    done = true;
    document.getElementById('intro').classList.add('gone');
    onEnter();
  };
  btn.addEventListener('click', enter);
  addEventListener('keydown', (e) => { if (e.key === 'Enter' && !btn.hidden) enter(); });
}
