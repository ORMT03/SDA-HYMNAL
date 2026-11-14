'use strict';
const $ = id => document.getElementById(id);
const normalize = text => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\w\s]/g, '').trim();
const pref = { get(key, fallback) { try { return localStorage.getItem(`beta-${key}`) || fallback; } catch { return fallback; } }, set(key, value) { try { localStorage.setItem(`beta-${key}`, value); } catch {} } };
let songs = [], mapping = [], manifest = {}, selected, revision = 0, renderer, mode = 'xml';
const key = song => `${song.language}:${song.number}`;
const scorePath = song => manifest[key(song)];
async function json(url) { const response = await fetch(url); if (!response.ok) throw new Error(`Unable to load ${url}`); return response.json(); }
function matches(song, query) { return normalize(song.title).includes(query) || normalize(song.number).includes(/^\d+$/.test(query) ? query.padStart(3, '0') : query); }
function renderList() {
 const language = $('language').value, query = normalize($('search').value);
 const available = songs.filter(s => (language === 'both' || s.language === language) && ($('availability').value !== 'xml' || scorePath(s)));
 const found = new Set(available.filter(s => matches(s, query)));
 if (query && language === 'both') for (const song of [...found]) {
  const own = song.language, other = own === 'english' ? 'spanish' : 'english';
  for (const pair of mapping) if ([pair[own]].flat().includes(song.number)) for (const number of [pair[other]].flat()) {
   const match = available.find(s => s.language === other && s.number === number); if (match) found.add(match);
  }
 }
 $('songs').replaceChildren();
 for (const song of found) {
  const li = document.createElement('li'), button = document.createElement('button');
  button.className = 'song'; button.type = 'button'; button.setAttribute('aria-current', String(selected === song));
  const number = document.createElement('span'); number.className = 'song-number'; number.textContent = song.number;
  const text = document.createElement('span'), title = document.createElement('span'), detail = document.createElement('span');
  title.className = 'song-title'; title.textContent = song.title; detail.className = 'song-detail';
  detail.textContent = `${song.language === 'english' ? 'ENGLISH' : 'SPANISH'} · ${scorePath(song) ? 'MUSICXML' : 'IMAGE & LYRICS'}`;
  text.append(title, detail); button.append(number, text); button.addEventListener('click', () => openSong(song)); li.append(button); $('songs').append(li);
 }
 $('count').textContent = `${found.size} ${found.size === 1 ? 'hymn' : 'hymns'}${query ? ' found' : ''}`;
 if (!found.size) { const li = document.createElement('li'); li.textContent = 'No hymns found. Try another number, title or filter.'; li.className = 'muted'; $('songs').append(li); }
}
function openSong(song, updateURL = true) {
 selected = song; mode = 'xml'; $('empty').hidden = true; $('hymn').hidden = false;
 $('hymn-title').textContent = song.title; $('hymn-meta').textContent = `${song.language === 'english' ? 'English' : 'Spanish'} hymnal / ${song.number}`;
 $('xml').disabled = !scorePath(song); $('download').hidden = !scorePath(song);
 if (scorePath(song)) $('download').href = scorePath(song);
 if (updateURL) history.pushState(null, '', `#${song.language}/${encodeURIComponent(song.number)}`);
 renderList(); showView('xml');
}
function cleanRenderer() { if (renderer) { renderer.setOptions({autoResize:false}); renderer.clear(); renderer = null; } }
async function showView(requested) {
 if (!selected) return;
 const song = selected, ticket = ++revision, xml = scorePath(song);
 mode = requested; cleanRenderer(); $('viewer').replaceChildren(); $('viewer').setAttribute('aria-busy', 'false');
 $('score-tools').hidden = true;
 for (const id of ['xml','image','lyrics']) $(id).setAttribute('aria-pressed', String(id === requested));
 if (requested === 'lyrics') { $('status').textContent = 'Hymn lyrics'; const text = document.createElement('pre'); text.textContent = song.content || 'Lyrics are not available for this hymn.'; $('viewer').append(text); return; }
 if (requested === 'image' || !xml) {
  mode = 'image'; $('image').setAttribute('aria-pressed','true'); $('xml').setAttribute('aria-pressed','false');
  $('status').textContent = requested === 'image' ? 'Original sheet image' : 'MusicXML is not available for this hymn yet. Showing the original sheet image.';
  showImage(song, ticket); return;
 }
 $('status').textContent = 'Loading MusicXML score…'; $('viewer').setAttribute('aria-busy','true');
 let instance;
 try {
  if (!window.opensheetmusicdisplay) throw new Error('Score library unavailable');
  const response = await fetch(xml); if (!response.ok) throw new Error('Score file unavailable'); const content = await response.text();
  if (ticket !== revision) return;
  const target = document.createElement('div'); target.style.minWidth = '600px'; $('viewer').append(target);
  instance = new opensheetmusicdisplay.OpenSheetMusicDisplay(target, { autoResize:false, backend:'svg', drawTitle:false, drawSubtitle:false, drawComposer:false, drawPartNames:false });
  renderer = instance; await instance.load(content);
  if (ticket !== revision) return;
  instance.Zoom = Number($('zoom').value) / 100; instance.render();
  $('score-tools').hidden = false; $('status').textContent = 'MusicXML score · Use “Load image” to see the original sheet.';
 } catch (error) {
  if (ticket !== revision) return;
  console.error(error); cleanRenderer(); $('viewer').replaceChildren(); mode = 'image';
  $('xml').setAttribute('aria-pressed','false'); $('image').setAttribute('aria-pressed','true');
  $('status').textContent = 'The MusicXML score could not be displayed. Showing the original image. You can retry with the MusicXML button.';
  showImage(song, ticket);
 } finally { if (ticket === revision) $('viewer').setAttribute('aria-busy','false'); }
}
function showImage(song, ticket) {
 if (!navigator.onLine) {
  mode = 'lyrics'; $('image').setAttribute('aria-pressed','false'); $('xml').setAttribute('aria-pressed','false'); $('lyrics').setAttribute('aria-pressed','true');
  $('status').textContent = 'Images are online-only. Showing saved lyrics instead.';
  const text = document.createElement('pre'); text.textContent = song.content || 'Lyrics are not available for this hymn.'; $('viewer').append(text); return;
 }
 const image = new Image(); image.alt = `${song.number} — ${song.title}, original sheet music`;
 image.src = `../src/Hymnal.XF/Resources/Assets/MusicSheets/${encodeURIComponent(song.image)}`;
 image.onerror = () => { if (ticket === revision) $('status').textContent = 'The original image could not be loaded. Please try again or open Lyrics only.'; };
 $('viewer').append(image);
}
function fromHash() { const [language, number] = location.hash.slice(1).split('/'); const song = songs.find(s => s.language === language && s.number === (number || '')); if (song) openSong(song, false); else { ++revision; cleanRenderer(); selected = null; $('hymn').hidden = true; $('empty').hidden = false; renderList(); } }
$('language').value = pref.get('language','english');
if (!['english','spanish','both'].includes($('language').value)) $('language').value = 'english';
$('search').addEventListener('input', renderList);
$('language').addEventListener('change', () => { pref.set('language',$('language').value); renderList(); });
$('availability').addEventListener('change',renderList);
for (const id of ['xml','image','lyrics']) $(id).addEventListener('click', () => showView(id));
$('zoom').addEventListener('input', () => { $('zoom-value').textContent = `${$('zoom').value}%`; if (renderer && mode === 'xml') { renderer.Zoom = Number($('zoom').value)/100; renderer.render(); } });
let resizeTimer; window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (renderer && mode === 'xml' && $('viewer').getAttribute('aria-busy') === 'false') renderer.render(); }, 200); });
window.addEventListener('popstate',fromHash);
(async () => {
 try {
  const [english, spanish, pairs, scores] = await Promise.all([json('../songs.json'),json('../songs_es.json'),json('../song_mapping.json').catch(() => []),json('scores.json')]);
  songs = [...english.map(s => ({...s,language:'english'})),...spanish.map(s => ({...s,language:'spanish'}))]; mapping = pairs; manifest = scores;
  $('coverage').textContent = `${Object.keys(manifest).length} hymn entries currently have MusicXML.`;
  renderList(); if (location.hash) fromHash();
 } catch (error) { console.error(error); $('count').textContent = 'The hymn catalog could not be loaded. Please refresh to try again.'; }
})();
