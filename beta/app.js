'use strict';
const $ = id => document.getElementById(({songs:'song-list',language:'language-dropdown'})[id] || id);
const normalize = text => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\w\s]/g, '').trim();
const pref = { get(key, fallback) { try { return localStorage.getItem(`beta-${key}`) || fallback; } catch { return fallback; } }, set(key, value) { try { localStorage.setItem(`beta-${key}`, value); } catch {} } };
let scorePage = null;
let songs = [], mapping = [], manifest = {}, selected, revision = 0, renderer, mode = 'xml';
const key = song => `${song.language}:${song.number}`;
const scorePath = song => manifest[key(song)];
async function json(url) { const response = await fetch(url); if (!response.ok) throw new Error(`Unable to load ${url}`); return response.json(); }
function matches(song, query) { return normalize(song.title).includes(query) || normalize(song.number).includes(/^\d+$/.test(query) ? query.padStart(3, '0') : query); }
function renderList() {
 const language = $('language').value, query = normalize($('search').value);
 const available = songs.filter(s => (language === 'both' || s.language === language));
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
  const number = document.createElement('span'); number.className = 'song-number'; number.textContent = `${song.number} - `;
  const text = document.createElement('span'), title = document.createElement('span'), detail = document.createElement('span');
  title.className = 'song-title'; title.textContent = song.title; detail.className = 'song-detail';
  detail.textContent = `${song.language === 'english' ? 'ENGLISH' : 'SPANISH'} · ${scorePath(song) ? 'MUSICXML' : 'IMAGE & LYRICS'}`;
  text.append(title, detail); button.append(number, text); button.addEventListener('click', () => openSong(song)); li.append(button); $('songs').append(li);
 }
 $('count').hidden = found.size > 0;
 $('count').textContent = `${found.size} ${found.size === 1 ? 'hymn' : 'hymns'}${query ? ' found' : ''}`;
 if (!found.size) { const li = document.createElement('li'); li.textContent = 'No hymns found. Try another number, title or filter.'; li.className = 'muted'; $('songs').append(li); }
}
function openSong(song, updateURL = true) {
 selected = song; mode = 'xml'; $('catalog').hidden = true; $('hymn').hidden = false; window.scrollTo(0,0);
 $('hymn-title').textContent = `${song.number} - ${song.title}`; $('hymn-meta').textContent = `${song.language === 'english' ? 'English' : 'Spanish'} hymnal / ${song.number}`;
 $('xml').disabled = !scorePath(song); $('download').hidden = !scorePath(song);
 if (scorePath(song)) $('download').href = scorePath(song);
 if (updateURL) history.pushState(null, '', `#${song.language}/${encodeURIComponent(song.number)}`);
 renderList(); showView($('dropdown-menu').value === 'lyrics' ? 'lyrics' : 'xml');
}
// Engrave at a stable sheet width. Only the completed sheet scales on narrow screens.
const SHEET_WIDTH = 1100;
function fitScorePage() {
 if (!scorePage) return;
 const available = $('viewer').clientWidth - 20;
 const scale = Math.min(1, Math.max(0.1, available / SHEET_WIDTH));
 scorePage.style.transform = `scale(${scale})`;
 $('viewer').style.height = `${Math.ceil(scorePage.offsetHeight * scale)}px`;
}
function renderScore() {
 if (!renderer) return;
 renderer.render(); fitScorePage();
}
function makeScorePage(content, song) {
 const xml = new DOMParser().parseFromString(content, 'application/xml');
 const fields = Object.fromEntries([...xml.querySelectorAll('miscellaneous-field')].map(el => [el.getAttribute('name'),el.textContent.trim()]));
 const creator = type => [...xml.querySelectorAll('creator')].find(el => el.getAttribute('type') === type)?.textContent.trim();
 const page = document.createElement('div'); page.className = 'score-page';
 const heading = document.createElement('div'); heading.className = 'sheet-heading';
 const title = document.createElement('h2'); title.textContent = xml.querySelector('work-title')?.textContent || song.title;
 const number = document.createElement('span'); number.className = 'sheet-number'; number.textContent = fields['hymn-number'] || String(Number(song.number));
 heading.append(title,number);
 const credits = document.createElement('div'); credits.className = 'sheet-credits';
 const left = document.createElement('div'), right = document.createElement('div');
 for (const line of [fields['scripture-reference'],creator('poet') || creator('lyricist'),creator('translator') && `Tr. by ${creator('translator')}`]) {
  if (line) { const row = document.createElement('div'); row.textContent = line; left.append(row); }
 }
 for (const line of [[fields['tune-name'],fields['metrical-pattern']].filter(Boolean).join(' '),fields['tune-source'],creator('composer'),creator('arranger') && `Harm. by ${creator('arranger')}`]) {
  if (line) { const row = document.createElement('div'); row.textContent = line; right.append(row); }
 }
 credits.append(left,right);
 const notation = document.createElement('div'); notation.className = 'score-notation';
 const category = document.createElement('div'); category.className = 'sheet-category'; category.textContent = fields.category || '';
 page.append(heading,credits,notation,category); $('viewer').append(page); scorePage = page;
 return notation;
}
function cleanRenderer() {
 if (renderer) { renderer.setOptions({autoResize:false}); renderer.clear(); renderer = null; }
 scorePage = null; $('viewer').style.height = '';
}
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
  const target = makeScorePage(content, song);
  instance = new opensheetmusicdisplay.OpenSheetMusicDisplay(target, { autoResize:false, backend:'svg', pageFormat:'Endless', newSystemFromXML:true, newPageFromXML:false, stretchLastSystemLine:true, drawCredits:false, drawLyricist:false, drawTitle:false, drawSubtitle:false, drawComposer:false, drawPartNames:false });
  renderer = instance; await instance.load(content);
  if (ticket !== revision) return;
  instance.Zoom = 0.7; renderScore();
  $('score-tools').hidden = true; $('status').textContent = 'MusicXML score · Use “Load image” to see the original sheet.';
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
function fromHash() { const [language, number] = location.hash.slice(1).split('/'); const song = songs.find(s => s.language === language && s.number === (number || '')); if (song) openSong(song, false); else { ++revision; cleanRenderer(); selected = null; $('hymn').hidden = true; $('catalog').hidden = false; renderList(); } }
$('language').value = pref.get('language','english');
if (!['english','spanish','both'].includes($('language').value)) $('language').value = 'english';
$('search').addEventListener('input', renderList);
$('language').addEventListener('change', () => { pref.set('language',$('language').value); renderList(); });
$('dropdown-menu').value = pref.get('display','music-score');
$('dropdown-menu').addEventListener('change', () => pref.set('display',$('dropdown-menu').value));
$('back-button').addEventListener('click', () => { history.pushState(null,'',location.pathname); fromHash(); });
for (const id of ['xml','image','lyrics']) $(id).addEventListener('click', () => showView(id));
let resizeTimer; window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(fitScorePage, 100); });
window.addEventListener('popstate',fromHash);
(async () => {
 try {
  const [english, spanish, pairs, scores] = await Promise.all([json('../songs.json'),json('../songs_es.json'),json('../song_mapping.json').catch(() => []),json('scores.json')]);
  songs = [...english.map(s => ({...s,language:'english'})),...spanish.map(s => ({...s,language:'spanish'}))]; mapping = pairs; manifest = scores;
  $('coverage').textContent = `${Object.keys(manifest).length} hymn entries currently have MusicXML.`;
  renderList(); if (location.hash) fromHash();
 } catch (error) { console.error(error); $('count').textContent = 'The hymn catalog could not be loaded. Please refresh to try again.'; }
})();
