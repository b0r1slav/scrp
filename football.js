const COMPETITIONS={PL:'Premier League',PD:'La Liga',BL1:'Bundesliga',SA:'Serie A'};
const FOOTBALL_PROXY='https://raspy-frog-d6b6.borislav-madzharov.workers.dev/api/football-data';
const STORE='baseline_football_results_v1';
let matches=load(), apiMatches=[], TEAMS=[], selected=new Set(), activeFilter='all', sortDesc=true, apiUpdatedAt='';
function load(){try{return JSON.parse(localStorage.getItem(STORE)||'[]')}catch{return []}}
function save(){localStorage.setItem(STORE,JSON.stringify(matches));render()}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function stats(team){const found=[...apiMatches,...matches].filter(m=>(m.home_team===team.name||m.away_team===team.name)&&m.status==='finished').sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,50).map(m=>{const goals=Number(m.home_goals)+Number(m.away_goals);return {...m,goals,parity:goals%2?'odd':'even'}});const even=found.filter(x=>x.parity==='even').length,latest=found[0]?.parity||null;let strike=0;if(latest)for(const m of found){if(m.parity!==latest)break;strike++}return {found,even,odd:found.length-even,latest,strike}}
function renderOptions(){const q=document.getElementById('team-picker-search').value.trim().toLowerCase();document.getElementById('team-picker-options').innerHTML=TEAMS.filter(t=>`${t.name} ${t.league}`.toLowerCase().includes(q)).map(t=>`<label class="player-option"><input type="checkbox" value="${esc(t.name)}" ${selected.has(t.name)?'checked':''}><span>${esc(t.name)}</span><small>${esc(t.league)}</small></label>`).join('');document.querySelectorAll('#team-picker-options input').forEach(i=>i.onchange=()=>{i.checked?selected.add(i.value):selected.delete(i.value);renderOptions();render()});document.getElementById('team-picker-label').textContent=selected.size?`${selected.size} selected`:'All teams'}
function render(){
  const q=document.getElementById('search').value.trim().toLowerCase();
  let rows=TEAMS.map((t,i)=>({t,i,s:stats(t)}));
  if(selected.size)rows=rows.filter(x=>selected.has(x.t.name));
  if(q)rows=rows.filter(x=>`${x.t.name} ${x.t.league}`.toLowerCase().includes(q));
  if(activeFilter!=='all')rows=rows.filter(x=>x.s.latest===activeFilter);
  rows.sort((a,b)=>sortDesc?b.s.strike-a.s.strike||a.t.name.localeCompare(b.t.name):a.t.name.localeCompare(b.t.name));
  const rowHtml=rows.map(({t,i,s},rank)=>{
    const tiles=s.found.map(m=>`<i class="${m.parity==='odd'?'odd':''}" title="${esc(m.date)} · ${m.goals} goals"></i>`).join('')||'<span class="team-empty">Awaiting results</span>';
    const latest=s.latest?`<span class="latest-pill ${s.latest}"><i></i>${s.latest.toUpperCase()}</span>`:'<span class="latest-pill empty">NO DATA</span>';
    const mini=Array.from({length:Math.min(s.strike,8)},()=>'<i></i>').join('');
    const initials=t.name.split(/\s+/).map(x=>x[0]).slice(0,2).join('');
    return `<tr class="player-row"><td class="rank">${String(rank+1).padStart(2,'0')}</td><td><div class="team-cell"><div class="team-avatar tone-${i%4}">${esc(initials)}</div><span class="team-name">${esc(t.name)}</span></div></td><td class="team-league">${esc(t.league)}</td><td><div class="streak-cell"><span class="streak-number">${s.strike||'—'}</span><span class="streak-mini">${mini}</span></div></td><td class="metric">${s.even}</td><td class="metric">${s.odd}</td><td>${latest}</td><td><div class="match-tiles" aria-label="Latest matches, newest first">${tiles}</div></td></tr>`;
  }).join('');
  document.getElementById('team-rows').innerHTML=rowHtml||'<tr><td colspan="8" class="empty-state">No team data yet. Check API setup or refresh.</td></tr>';
  document.getElementById('team-total').textContent=TEAMS.length;
  document.getElementById('side-count').textContent=TEAMS.length;
  document.getElementById('row-count').textContent=`${rows.length} TEAM${rows.length===1?'':'S'}`;
  document.getElementById('showing').textContent=`Showing ${rows.length} of ${TEAMS.length} teams`;
  const all=TEAMS.map(stats);
  document.getElementById('streak-total').textContent=all.length?Math.max(0,...all.map(x=>x.strike)):'—';
  document.getElementById('latest-even').textContent=`${all.filter(x=>x.latest==='even').length} / ${all.filter(x=>x.latest).length}`;
  const status=apiMatches.length?'LIVE':matches.length?'IMPORTED':'EMPTY';
  document.getElementById('data-status').textContent=status;
  document.getElementById('data-status').style.color=status==='EMPTY'?'#b17a43':'#438259';
  document.getElementById('updated-note').textContent=apiUpdatedAt?`Updated ${new Date(apiUpdatedAt).toLocaleString()}`:matches.length?`${matches.length} imported matches`:'Connect the API to load results';
  renderOptions();
}
function mapApiPayload(payload){
  const teams=new Map(),list=[];
  const competitions=payload.competitions&&typeof payload.competitions==='object'?Object.entries(payload.competitions):[];
  // Also accept the upstream API's direct {matches:[...]} response, which is useful
  // when the proxy is replaced or the endpoint is inspected during local setup.
  const sources=competitions.length?competitions:[['', {name:'',matches:Array.isArray(payload.matches)?payload.matches:[]}]];
  for(const [code,entry] of sources){
    const league=entry?.name||COMPETITIONS[code]||code||'Football';
    for(const match of Array.isArray(entry?.matches)?entry.matches:[]){
      const homeTeam=match.homeTeam||match.home_team||match.home||{},awayTeam=match.awayTeam||match.away_team||match.away||{};
      const home=typeof homeTeam==='string'?homeTeam:homeTeam.name||homeTeam.shortName;
      const away=typeof awayTeam==='string'?awayTeam:awayTeam.name||awayTeam.shortName;
      if(home)teams.set(home,{name:home,league,slug:String(homeTeam.id||home)});
      if(away)teams.set(away,{name:away,league,slug:String(awayTeam.id||away)});
      const score=match.score?.fullTime||match.score?.full_time||match.score||{};
      const status=String(match.status||'').toUpperCase();
      const homeGoals=Number(score.home??match.home_goals),awayGoals=Number(score.away??match.away_goals);
      if(['FINISHED','FT','COMPLETE','COMPLETED'].includes(status)&&home&&away&&Number.isInteger(homeGoals)&&Number.isInteger(awayGoals))list.push({date:match.utcDate||match.date||'',league,home_team:home,away_team:away,home_goals:homeGoals,away_goals:awayGoals,status:'finished',id:match.id});
    }
  }
  TEAMS=[...teams.values()].sort((a,b)=>a.league.localeCompare(b.league)||a.name.localeCompare(b.name));
  return list;
}
async function refreshData(){const button=document.getElementById('refresh-data'),message=document.getElementById('fetch-message');button.disabled=true;message.textContent='Loading league results…';try{const response=await fetch(FOOTBALL_PROXY,{cache:'no-store'}),payload=await response.json().catch(()=>({}));if(!response.ok)throw Error(payload.error||`API proxy returned HTTP ${response.status}`);if(!payload.competitions&&!Array.isArray(payload.matches))throw Error('Football API proxy returned no data. Check the Cloudflare Worker setup.');apiMatches=mapApiPayload(payload);if(!TEAMS.length)throw Error('The football data response contained no recognizable teams. Check the Worker response format.');apiUpdatedAt=payload.updatedAt||new Date().toISOString();render();message.textContent=`Loaded ${apiMatches.length} completed matches across ${Object.keys(payload.competitions||{}).length||1} leagues.`}catch(error){message.textContent=error.message||'Could not load football data.';render()}finally{button.disabled=false}}
function parseCSV(text){const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(x=>x.trim());if(lines.length<2)return [];const split=line=>{let out=[],v='',q=false;for(let i=0;i<line.length;i++){let c=line[i];if(c==='"'&&line[i+1]==='"'&&q){v+='"';i++}else if(c==='"')q=!q;else if(c===','&&!q){out.push(v.trim());v=''}else v+=c}out.push(v.trim());return out};const heads=split(lines.shift()).map(x=>x.toLowerCase());return lines.map(line=>{let o={};split(line).forEach((v,i)=>o[heads[i]]=v);return o})}
function normalize(raw){const lookup=s=>TEAMS.find(t=>t.name.toLowerCase()===String(s||'').trim().toLowerCase())?.name;const rawStatus=String(raw.status??'completed').toLowerCase();return {date:String(raw.date??raw.match_date??''),league:String(raw.league??raw.competition??''),home_team:lookup(raw.home_team??raw.home??raw.hometeam),away_team:lookup(raw.away_team??raw.away??raw.awayteam),home_goals:Number(raw.home_goals??raw.home_score??raw.fthg),away_goals:Number(raw.away_goals??raw.away_score??raw.ftag),status:['completed','complete','ft','finished','full time'].includes(rawStatus)?'finished':rawStatus}}
function importData(rawRows){const incoming=rawRows.map(normalize).filter(m=>m.home_team&&m.away_team&&Number.isFinite(m.home_goals)&&Number.isFinite(m.away_goals)&&['finished','complete','ft','full time'].includes(m.status));if(!incoming.length)throw Error('No completed matches found. Check team names, scores, and status values.');const seen=new Set(matches.map(m=>`${m.date}|${m.home_team}|${m.away_team}`));const unique=incoming.filter(m=>!seen.has(`${m.date}|${m.home_team}|${m.away_team}`));matches=[...unique,...matches];save();return unique.length}
const modal=document.getElementById('import-modal'),help=document.getElementById('help-modal');document.getElementById('import-button').onclick=()=>modal.classList.remove('hidden');document.getElementById('close-modal').onclick=()=>modal.classList.add('hidden');document.getElementById('help-button').onclick=()=>help.classList.remove('hidden');document.querySelectorAll('[data-close-help]').forEach(b=>b.onclick=()=>help.classList.add('hidden'));[modal,help].forEach(el=>el.addEventListener('click',e=>{if(e.target===el)el.classList.add('hidden')}));document.getElementById('team-picker-button').onclick=()=>document.getElementById('team-picker').classList.toggle('open');document.getElementById('team-picker-search').oninput=renderOptions;document.getElementById('select-all').onclick=()=>{TEAMS.forEach(t=>selected.add(t.name));renderOptions();render()};document.getElementById('clear-selection').onclick=()=>{selected.clear();renderOptions();render()};document.addEventListener('click',e=>{if(!document.getElementById('team-picker').contains(e.target))document.getElementById('team-picker').classList.remove('open')});document.getElementById('search').oninput=render;document.getElementById('sort-button').onclick=()=>{sortDesc=!sortDesc;render()};document.getElementById('filter-button').onclick=()=>document.getElementById('filter-menu').classList.toggle('hidden');document.querySelectorAll('#filter-menu button').forEach(b=>b.onclick=()=>{activeFilter=b.dataset.filter;document.getElementById('filter-label').textContent=({all:'All teams',even:'Latest even',odd:'Latest odd'})[activeFilter];document.getElementById('filter-menu').classList.add('hidden');render()});
function handleFile(file){if(!file)return;const msg=document.getElementById('import-message');if(file.size>5*1024*1024){msg.textContent='File is larger than 5 MB.';return}const reader=new FileReader();reader.onload=()=>{try{const text=reader.result;let data;if(file.name.toLowerCase().endsWith('.json')){const j=JSON.parse(text);data=Array.isArray(j)?j:j.matches||[]}else data=parseCSV(text);const n=importData(data);msg.textContent=`Imported ${n} match${n===1?'':'es'}.`;setTimeout(()=>modal.classList.add('hidden'),900)}catch(e){msg.textContent=e.message||'Could not read that file.'}};reader.readAsText(file)}
const input=document.getElementById('file-input');input.onchange=()=>handleFile(input.files[0]);document.getElementById('choose-file').onclick=()=>input.click();const zone=document.getElementById('dropzone');zone.ondragover=e=>{e.preventDefault();zone.style.background='#f0f6f0'};zone.ondragleave=()=>zone.style.background='';zone.ondrop=e=>{e.preventDefault();zone.style.background='';handleFile(e.dataTransfer.files[0])};document.getElementById('download-template').onclick=()=>{const blob=new Blob(['date,league,home_team,away_team,home_goals,away_goals,status\n2026-10-12,Premier League,Arsenal,Chelsea,2,1,completed\n'],{type:'text/csv'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='baseline-football-results-template.csv';a.click();URL.revokeObjectURL(a.href)};document.getElementById('refresh-data').onclick=refreshData;render();refreshData();document.getElementById('print-table').addEventListener('click',()=>window.print());
