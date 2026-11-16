'use strict';
self.HymnalSearch = (() => {
 const normalize = text => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
 const stop = new Set('a an and are as at be both by english for from how hymn hymnal hymns i in is it language languages me my of on or our section show song songs spanish that the to with abre abrir busca buscar cancion canciones castellano con de del el en encuentra espanol himnario himno himnos ingles la las letra letras los mi mis numero para por que se un una y'.split(' '));
 function tokens(text) { return [...new Set(normalize(text).split(' ').filter(t=>t.length>1&&!stop.has(t)))]; }
 function prepare(song) { return {...song,searchTitle:normalize(song.title),searchLyrics:normalize(song.content),searchTokens:new Set(tokens(song.title+' '+song.content))}; }
 function score(song,query) {
  const q=normalize(query), ts=tokens(q); if (!q) return 0;
  let result=0; const number=q.padStart(3,'0');
  if (song.number===q||song.number===number) result+=200;
  if (song.searchTitle.includes(q)) result+=80;
  if (song.searchLyrics.includes(q)) result+=40;
  for(const token of ts) {
   if(song.number===token||song.number===token.padStart(3,'0'))result+=120;
   if(song.searchTitle.includes(token))result+=20;
   if(song.searchTokens.has(token))result+=8;
   if(song.searchLyrics.includes(token))result+=2;
  }
  return result;
 }
 function search(songs,query) { return songs.map(song=>({song,rank:score(song,query)})).filter(v=>v.rank>0).sort((a,b)=>b.rank-a.rank||a.song.number.localeCompare(b.song.number)).map(v=>v.song); }
 return {normalize,prepare,score,search};
})();

'use strict';
self.HymnalPDF = {
 async create({content,song,offset,options,metadata}) {
  if (!self.jspdf?.jsPDF) throw new Error('PDF export is unavailable. Update the offline download.');
  const staging=document.createElement('div');
  staging.className='pdf-staging';staging.style.cssText='position:absolute;left:-20000px;top:0;width:1600px;background:white;color:black;';
  document.body.append(staging);let engine;
  try {
   engine=new opensheetmusicdisplay.OpenSheetMusicDisplay(staging,{
    backend:'svg',autoResize:false,pageFormat:'Letter_P',newSystemFromXML:true,newSystemFromNewPageInXML:true,
    stretchLastSystemLine:true,drawCredits:false,drawTitle:false,drawSubtitle:false,drawComposer:false,drawLyricist:false,
    drawPartNames:false,drawPartAbbreviations:false,drawLyrics:options.lyrics
   });
   engine.EngravingRules.SystemLeftMargin=0;
   engine.EngravingRules.PageLeftMargin=8;engine.EngravingRules.PageRightMargin=8;
   engine.EngravingRules.PageTopMargin=35;engine.EngravingRules.PageBottomMargin=16;
   engine.EngravingRules.RenderChordSymbols=options.chords;engine.EngravingRules.RenderLyrics=options.lyrics;
   engine.TransposeCalculator=new opensheetmusicdisplay.IntervalTransposeCalculator();
   await engine.load(content);engine.Sheet.Transpose=offset;engine.updateGraphic();engine.render();await document.fonts.ready;
   const pages=[...staging.querySelectorAll('svg')];if(!pages.length)throw new Error('The score has no printable pages.');
   const pdf=new jspdf.jsPDF({unit:'pt',format:'letter',orientation:'portrait',compress:true});
   pdf.setProperties({title:`${song.number} - ${song.title}`,subject:'SDA Hymnal sheet music',creator:'SDA Hymnal'});
   for(let index=0;index<pages.length;index++) {
    if(index)pdf.addPage('letter','portrait');
    const svg=pages[index];const width=parseFloat(svg.getAttribute('width')),height=parseFloat(svg.getAttribute('height'));
    svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
    // OSMD paginates at Letter proportions with header/footer space reserved above.
    await pdf.svg(svg,{x:0,y:0,width:612,height:792});
    pdf.setTextColor(0,0,0);pdf.setFont('times','bold');
    if(index===0) {
     let y=32;
     if(options.heading) {
      pdf.setFontSize(20);const lines=pdf.splitTextToSize(metadata.title,480);
      pdf.text(lines,306,y,{align:'center'});pdf.text(String(Number(song.number)),586,y,{align:'right'});y+=lines.length*23+8;
     }
     if(options.credits) {
      pdf.setFontSize(8);
      const left=metadata.left.flatMap(line=>pdf.splitTextToSize(line,260));
      const right=metadata.right.flatMap(line=>pdf.splitTextToSize(line,260));
      for(let row=0;row<Math.max(left.length,right.length);row++) {
       if(left[row])pdf.text(left[row],26,y+row*10);
       if(right[row])pdf.text(right[row],586,y+row*10,{align:'right'});
      }
     }
    }
    if(index===pages.length-1&&options.copyright&&metadata.footer) {
     pdf.setFontSize(8);pdf.text(pdf.splitTextToSize(metadata.footer,540),306,768,{align:'center'});
    }
   }
   return new File([pdf.output('blob')],`${song.number}-${song.title.replace(/[^\p{L}\p{N} -]/gu,'').trim()}${offset?`-transpose-${offset}`:''}.pdf`,{type:'application/pdf'});
  } finally { if(engine)engine.clear();staging.remove(); }
 }
};

'use strict';
const $ = id => document.getElementById(({songs:'song-list',language:'language-dropdown'})[id] || id);
const normalize = text => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\w\s]/g, '').trim();
const pref = { get(key, fallback) { try { return localStorage.getItem(`beta-${key}`) || fallback; } catch { return fallback; } }, set(key, value) { try { localStorage.setItem(`beta-${key}`, value); } catch {} } };
let scorePage = null, scoreContent = null, scoreMetadata = null, transposeOffset = 0, originalFifths = null, originalMinor = false, scoreBusy = false, pdfFile = null, pdfURL = null;
const settings = { appearance:pref.get('appearance','light-scores'), fontSize:Number(pref.get('lyrics-font-size','18')), smart:pref.get('smart-search','false')==='true' };
const scoreFields = [['chords','Show chords'],['credits','Show credits / lyricists'],['lyrics','Show lyrics'],['heading','Show title & hymn number'],['copyright','Show copyright footer']];
const scoreOptions = scope => Object.fromEntries(scoreFields.map(([field])=>[field,pref.get(`score-${scope}-${field}`,'true')==='true']));
let songs = [], mapping = [], manifest = {}, selected, revision = 0, renderer, mode = 'xml';
const key = song => `${song.language}:${song.number}`;
const scorePath = song => manifest[key(song)];
async function json(url) { const response = await fetch(url); if (!response.ok) throw new Error(`Unable to load ${url}`); return response.json(); }
function matches(song, query) { return normalize(song.title).includes(query) || normalize(song.number).includes(/^\d+$/.test(query) ? query.padStart(3, '0') : query); }
function renderList() {
 const language = $('language').value, query = normalize($('search').value);
 const available = songs.filter(s => (language === 'both' || s.language === language));
 const found = new Set(settings.smart && query ? HymnalSearch.search(available,$('search').value) : available.filter(s => matches(s, query)));
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
 selected = song; mode = 'xml'; transposeOffset=0; clearPDF(); $('catalog').hidden = true; $('hymn').hidden = false; applyAppearance(); window.scrollTo(0,0);
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
function readScoreMetadata(content,song) {
 const xml=new DOMParser().parseFromString(content,'application/xml');
 if(xml.querySelector('parsererror'))throw new Error('Invalid MusicXML');
 const fields=Object.fromEntries([...xml.querySelectorAll('miscellaneous-field')].map(el=>[el.getAttribute('name'),el.textContent.trim()]));
 const creator=type=>[...xml.querySelectorAll('creator')].find(el=>el.getAttribute('type')===type)?.textContent.trim();
 const credits=[...xml.querySelectorAll('credit')].filter(el=>el.querySelector('credit-type')?.textContent==='rights').map(el=>[...el.querySelectorAll('credit-words')].map(v=>v.textContent).join('')).join('\n').trim();
 return {title:xml.querySelector('work-title')?.textContent||song.title,
  left:[fields['scripture-reference'],creator('poet')||creator('lyricist'),creator('translator')&&`Tr. by ${creator('translator')}`].filter(Boolean),
  right:[[fields['tune-name'],fields['metrical-pattern']].filter(Boolean).join(' '),fields['tune-source'],creator('composer'),creator('arranger')&&`Harm. by ${creator('arranger')}`].filter(Boolean),footer:credits||fields.category||''};
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
 const category = document.createElement('div'); category.className = 'sheet-category'; category.textContent = scoreMetadata.footer;
 page.append(heading,credits,notation,category); $('viewer').append(page); scorePage = page;
 return notation;
}
function cleanRenderer() {
 if (renderer) { renderer.setOptions({autoResize:false}); renderer.clear(); renderer = null; }
 scorePage = null; scoreContent=null; $('viewer').style.height = ''; $('transposition').hidden=true; $('export-pdf').disabled=true;
}
async function showView(requested) {
 if (!selected) return;
 clearPDF();
 const song = selected, ticket = ++revision, xml = scorePath(song);
 mode = requested; applyAppearance(); cleanRenderer(); $('viewer').replaceChildren(); $('viewer').setAttribute('aria-busy', 'false');
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
  scoreContent=content;scoreMetadata=readScoreMetadata(content,song);
  const documentXML=new DOMParser().parseFromString(content,'application/xml');
  const fifths=documentXML.querySelector('key fifths');originalFifths=fifths?Number(fifths.textContent):null;originalMinor=documentXML.querySelector('key mode')?.textContent==='minor';
  const target = makeScorePage(content, song);
  instance = new opensheetmusicdisplay.OpenSheetMusicDisplay(target, { autoResize:false, backend:'svg', pageFormat:'Endless', newSystemFromXML:true, newPageFromXML:false, stretchLastSystemLine:true, drawCredits:false, drawLyricist:false, drawTitle:false, drawSubtitle:false, drawComposer:false, drawPartNames:false });
  instance.TransposeCalculator=new opensheetmusicdisplay.IntervalTransposeCalculator();
  renderer = instance; await instance.load(content);
  if (ticket !== revision) return;
  instance.Zoom = 0.7; instance.Sheet.Transpose=transposeOffset; applyViewingOptions(); updateKeys(); $('export-pdf').disabled=false; $('transposition').hidden=originalFifths===null;
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
  $('status').textContent = 'Images are online-only. Showing saved lyrics instead.'; applyAppearance();
  const text = document.createElement('pre'); text.textContent = song.content || 'Lyrics are not available for this hymn.'; $('viewer').append(text); return;
 }
 const image = new Image(); image.alt = `${song.number} — ${song.title}, original sheet music`;
 image.src = `../src/Hymnal.XF/Resources/Assets/MusicSheets/${encodeURIComponent(song.image)}`;
 image.onerror = () => { if (ticket === revision) $('status').textContent = 'The original image could not be loaded. Please try again or open Lyrics only.'; };
 $('viewer').append(image);
}
function fromHash() { const [language, number] = location.hash.slice(1).split('/'); const song = songs.find(s => s.language === language && s.number === (number || '')); if (song) openSong(song, false); else { ++revision; cleanRenderer(); selected = null; $('hymn').hidden = true; $('catalog').hidden = false; applyAppearance(); renderList(); } }
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
  songs = [...english.map(s => HymnalSearch.prepare({...s,language:'english'})),...spanish.map(s => HymnalSearch.prepare({...s,language:'spanish'}))]; mapping = pairs; manifest = scores;
  $('coverage').textContent = `${Object.keys(manifest).length} hymn entries currently have MusicXML.`;
  renderList(); if (location.hash) fromHash();
 } catch (error) { console.error(error); $('count').textContent = 'The hymn catalog could not be loaded. Please refresh to try again.'; }
})();

function clearPDF() {
 if(pdfURL)URL.revokeObjectURL(pdfURL);
 pdfURL=null;pdfFile=null;$('pdf-ready').hidden=true;
}
function applyAppearance() {
 const darkSystem=window.matchMedia('(prefers-color-scheme: dark)').matches;
 const dark=settings.appearance==='dark'||(['system','light-scores'].includes(settings.appearance)&&darkSystem);
 const lightScore=settings.appearance==='light-scores'&&mode!=='lyrics'&&!$('hymn').hidden;
 document.body.classList.toggle('theme-dark',dark);
 document.body.classList.toggle('dark-scores',dark&&!lightScore);
 document.documentElement.style.setProperty('--lyrics-size',`${settings.fontSize}px`);
 document.querySelector('meta[name="theme-color"]').content=dark?'#171717':'#ffffff';
 $('lyrics-size').value=settings.fontSize;$('lyrics-size-value').textContent=`${settings.fontSize} pt`;
}
function applyViewingOptions() {
 if(!renderer||!scorePage)return;
 const options=scoreOptions('view');
 scorePage.querySelector('.sheet-heading').hidden=!options.heading;
 scorePage.querySelector('.sheet-credits').hidden=!options.credits;
 scorePage.querySelector('.sheet-category').hidden=!options.copyright;
 renderer.EngravingRules.RenderChordSymbols=options.chords;
 renderer.EngravingRules.RenderLyrics=options.lyrics;
 renderer.updateGraphic();renderScore();
}
function keyNameAt(value) {
 const key=new opensheetmusicdisplay.KeyInstruction(undefined,originalFifths,originalMinor?opensheetmusicdisplay.KeyEnum.minor:opensheetmusicdisplay.KeyEnum.major);
 new opensheetmusicdisplay.IntervalTransposeCalculator().transposeKey(key,value);
 const names=originalMinor?['A♭','E♭','B♭','F','C','G','D','A','E','B','F♯','C♯','G♯','D♯','A♯']:['C♭','G♭','D♭','A♭','E♭','B♭','F','C','G','D','A','E','B','F♯','C♯'];
 return (names[key.Key+7]||'Unknown')+(originalMinor?' minor':'');
}
function updateKeys() {
 const picker=$('musical-key');picker.replaceChildren();
 if(originalFifths===null)return;
 const mod=value=>((value%12)+12)%12,tonic=mod(originalFifths*7+(originalMinor?9:0));
 for(let note=0;note<12;note++) {
  const offsets=[];for(let value=-12;value<=12;value++)if(mod(tonic+value)===note)offsets.push(value);
  offsets.sort((a,b)=>Math.abs(a-transposeOffset)-Math.abs(b-transposeOffset)||Math.abs(a)-Math.abs(b));
  const value=offsets[0];picker.add(new Option(keyNameAt(value)+(value===0?' (original)':''),String(value),false,value===transposeOffset));
 }
 picker.disabled=scoreBusy;
 $('transpose-down').disabled=scoreBusy||transposeOffset<=-12;$('transpose-up').disabled=scoreBusy||transposeOffset>=12;
 $('transpose-reset').disabled=scoreBusy||transposeOffset===0;
 $('transpose-offset').textContent=transposeOffset===0?'Original key':`${transposeOffset>0?'+':''}${transposeOffset} ${Math.abs(transposeOffset)===1?'semitone':'semitones'}`;
}
async function transposeScore(value) {
 value=Number(value);if(!renderer||scoreBusy||!Number.isInteger(value)||value < -12||value>12)return;
 const previous=transposeOffset;scoreBusy=true;updateKeys();
 try {
  renderer.Sheet.Transpose=value;renderer.updateGraphic();renderScore();transposeOffset=value;clearPDF();
  $('status').textContent=`MusicXML score · Key: ${keyNameAt(value)}`;
 } catch(error) {
  console.error(error);renderer.Sheet.Transpose=previous;renderer.updateGraphic();renderScore();
  $('status').textContent='Unable to transpose. The previous key has been kept.';
 } finally {scoreBusy=false;updateKeys();}
}
function setLyricsSize(value) {
 settings.fontSize=Math.max(12,Math.min(40,Number(value)||18));pref.set('lyrics-font-size',String(settings.fontSize));applyAppearance();
}
function initializeSettings() {
 if(!['system','light','dark','light-scores'].includes(settings.appearance))settings.appearance='light-scores';
 if(!Number.isFinite(settings.fontSize)||settings.fontSize<12||settings.fontSize>40)settings.fontSize=18;
 $('appearance').value=settings.appearance;$('smart-search').checked=settings.smart;
 for(const scope of ['view','share'])for(const [field,title]of scoreFields) {
  const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=scoreOptions(scope)[field];input.id=`score-${scope}-${field}`;
  label.append(input,document.createTextNode(' '+title));$(scope==='view'?'view-preferences':'share-preferences').append(label);
  input.addEventListener('change',()=>{pref.set(`score-${scope}-${field}`,String(input.checked));if(scope==='view')applyViewingOptions();else clearPDF();});
 }
 const openSettings=()=>{$('settings-dialog').showModal();};
 $('open-settings').addEventListener('click',openSettings);$('score-settings').addEventListener('click',openSettings);
 $('appearance').addEventListener('change',()=>{settings.appearance=$('appearance').value;pref.set('appearance',settings.appearance);applyAppearance();});
 $('lyrics-size').addEventListener('input',()=>setLyricsSize($('lyrics-size').value));
 for(const button of document.querySelectorAll('[data-size]'))button.addEventListener('click',()=>setLyricsSize(button.dataset.size));
 $('reset-preferences').addEventListener('click',()=>{
  settings.appearance='light-scores';pref.set('appearance',settings.appearance);$('appearance').value=settings.appearance;setLyricsSize(18);
  for(const scope of ['view','share'])for(const [field]of scoreFields){pref.set(`score-${scope}-${field}`,'true');$(`score-${scope}-${field}`).checked=true;}
  clearPDF();applyViewingOptions();applyAppearance();
 });
 $('smart-search').addEventListener('change',()=>{settings.smart=$('smart-search').checked;pref.set('smart-search',String(settings.smart));renderList();});
 window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',applyAppearance);
 $('musical-key').addEventListener('change',()=>transposeScore($('musical-key').value));
 $('transpose-down').addEventListener('click',()=>transposeScore(transposeOffset-1));$('transpose-up').addEventListener('click',()=>transposeScore(transposeOffset+1));$('transpose-reset').addEventListener('click',()=>transposeScore(0));
 applyAppearance();
}
$('share-lyrics').addEventListener('click',async()=>{
 if(!selected)return;
 const text=`${selected.number} - ${selected.title}\n\n${selected.content||''}`;
 try {
  if(navigator.share)await navigator.share({title:`${selected.number} - ${selected.title}`,text});
  else {
   const link=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));link.href=url;link.download=`${selected.number}-lyrics.txt`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   $('status').textContent='Lyrics saved as a text file. You can share that file.';
  }
 } catch(error){if(error.name!=='AbortError')$('status').textContent='Unable to share lyrics. Please try again.';}
});
$('export-pdf').addEventListener('click',async()=>{
 if(!scoreContent||scoreBusy)return;
 const ticket=revision,song=selected,content=scoreContent,options=scoreOptions('share'),metadata=scoreMetadata,offset=transposeOffset;
 scoreBusy=true;updateKeys();$('export-pdf').disabled=true;$('status').textContent='Preparing letter-size score PDF…';
 try {
  const file=await HymnalPDF.create({content,song,offset,options,metadata});
  if(ticket!==revision)return;
  if(JSON.stringify(options)!==JSON.stringify(scoreOptions('share'))){$('status').textContent='Sharing settings changed. Prepare the PDF again.';return;}
  clearPDF();pdfFile=file;pdfURL=URL.createObjectURL(file);$('download-pdf').href=pdfURL;$('download-pdf').download=file.name;$('pdf-ready').hidden=false;
  $('share-pdf').hidden=!(navigator.canShare&&navigator.canShare({files:[file]}));
  $('pdf-description').textContent='8.5 × 11 in · '+(offset===0?'original key':keyNameAt(offset));
  $('status').textContent='PDF ready. Tap Share PDF or Download PDF.';
 } catch(error){console.error(error);if(ticket===revision)$('status').textContent='Unable to create the PDF. Please retry or update the offline download.';}
 finally{scoreBusy=false;updateKeys();$('export-pdf').disabled=!renderer;}
});
$('share-pdf').addEventListener('click',async()=>{
 if(!pdfFile)return;
 try{await navigator.share({files:[pdfFile],title:`${selected.number} - ${selected.title}`});}
 catch(error){if(error.name!=='AbortError')$('status').textContent='Unable to share the PDF. Use Download PDF instead.';}
});
initializeSettings();
