"use strict";

const fetch = require("node-fetch");

const CACHE_TTL = 10 * 60 * 1000;
const _cache = new Map();
function cacheGet(key) { const e = _cache.get(key); if (!e) return null; if (Date.now() - e.ts > CACHE_TTL) { _cache.delete(key); return null; } return e.data; }
function cacheSet(key, data) { _cache.set(key, { ts: Date.now(), data }); }
async function timedFetch(url, opts, timeoutMs) { opts=opts||{}; timeoutMs=timeoutMs||10000; const c=new AbortController(); const t=setTimeout(()=>c.abort(),timeoutMs); try{return await fetch(url,Object.assign({},opts,{signal:c.signal}));}finally{clearTimeout(t);} }

function buildMetas(items, rpdbKey, langCode) {
  const seen = new Set(); const out = [];
  for (const item of items) {
    if (!item.imdbId || !item.imdbId.startsWith('tt') || seen.has(item.imdbId)) continue;
    if (langCode && item.language && item.language.toLowerCase() !== langCode.toLowerCase()) continue;
    seen.add(item.imdbId);
    const type = (item.type==='show'||item.type==='series') ? 'series' : 'movie';
    out.push({ id:item.imdbId, type, name:item.title||item.imdbId,
      poster: rpdbKey
        ? 'https://api.ratingposterdb.com/'+rpdbKey+'/imdb/poster-default/'+item.imdbId+'.jpg'
        : 'https://images.metahub.space/poster/medium/'+item.imdbId+'/img' });
  }
  return out;
}

async function fetchTraktList(listType, mediaType, clientId) {
  if (!clientId) throw new Error('Trakt Client ID is required.');
  const traktType = mediaType === 'series' ? 'shows' : 'movies';
  const url = 'https://api.trakt.tv/'+traktType+'/'+listType+'?extended=full&limit=20';
  const cacheKey = 'trakt:'+traktType+':'+listType;
  const cached = cacheGet(cacheKey); if (cached) return cached;
  const resp = await timedFetch(url, { headers: { 'Content-Type':'application/json','trakt-api-version':'2','trakt-api-key':clientId,'User-Agent':'Mozilla/5.0 (compatible; Stremio-Addon/1.0)' } });
  if (!resp.ok) throw new Error('Trakt API returned '+resp.status);
  const data = await resp.json();
  const items = data.map(function(entry) {
    const obj = entry.movie||entry.show||entry;
    const imdbId = (obj.ids&&obj.ids.imdb) ? obj.ids.imdb : null;
    return { imdbId, title:obj.title||null, year:obj.year||null, type:mediaType };
  }).filter(function(i){return i.imdbId;});
  cacheSet(cacheKey, items); return items;
}

async function fetchMdblistItems(listUrl, apiKey) {
  if (!apiKey) throw new Error('MDbList API key is required.');
  if (!listUrl) throw new Error('MDbList list URL is required.');
  const cacheKey = 'mdblist:'+listUrl; const cached = cacheGet(cacheKey); if (cached) return cached;
  // Extract username and slug from URL: https://mdblist.com/lists/{username}/{slug}
  const urlMatch = listUrl.match(/mdblist\.com\/lists\/([^/?#]+)\/([^/?#]+)/);
  if (!urlMatch) throw new Error('Could not parse MDbList URL. Expected: mdblist.com/lists/username/list-slug');
  const username = urlMatch[1], slug = urlMatch[2];
  // Get user lists to resolve slug -> numeric ID
  const ulr = await timedFetch('https://api.mdblist.com/lists/user/'+encodeURIComponent(username)+'/?apikey='+encodeURIComponent(apiKey));
  if (!ulr.ok) throw new Error('MDbList user lists returned '+ulr.status);
  const userLists = await ulr.json();
  if (!Array.isArray(userLists)) throw new Error('MDbList user lists unexpected response: '+JSON.stringify(userLists).substring(0,100));
  const listMeta = userLists.find(function(l){ return l.slug === slug; });
  if (!listMeta) throw new Error('MDbList list not found for slug: '+slug+' (user has '+userLists.length+' lists)');
  const listId = listMeta.id;
  const ir = await timedFetch('https://api.mdblist.com/lists/'+listId+'/items/?apikey='+encodeURIComponent(apiKey)+'&limit=50');
  if (!ir.ok) throw new Error('MDbList items returned '+ir.status);
  const id2 = await ir.json();
  const rows = [].concat(id2.movies||[]).concat(id2.shows||[]).concat(id2.items||[]);
  const items = rows.map(function(item){
    return { imdbId:item.imdb_id||null, title:item.title||null, year:item.release_year||item.year||null, type:item.mediatype==='show'?'series':'movie', language:item.language||null };
  }).filter(function(i){return i.imdbId;});
  cacheSet(cacheKey, items); return items;
}

async function fetchImdbRssList(listUrl) {
  if (!listUrl) throw new Error('IMDb list URL is required.');
  const cacheKey = 'imdb:'+listUrl; const cached = cacheGet(cacheKey); if (cached) return cached;
  const match = listUrl.match(/ls(\d+)/);
  if (!match) throw new Error('Could not find a list ID (ls...) in the URL.');
  const resp = await timedFetch('https://rss.imdb.com/list/ls'+match[1]+'/', { headers: { Accept:'application/rss+xml, text/xml' } });
  if (!resp.ok) throw new Error('IMDb RSS returned '+resp.status);
  const xml = await resp.text();
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  const items = []; let m;
  while ((m=itemRegex.exec(xml))!==null) {
    const block=m[1];
    const lm=block.match(/https?:\/\/www\.imdb\.com\/title\/(tt\d+)\//);
    const tm=block.match(/<title>([\s\S]*?)<\/title>/);
    if (lm) items.push({ imdbId:lm[1], title:tm?tm[1].replace(/&#\d+;/g,'').replace(/<[^>]+>/g,'').trim():null, year:null, type:'movie' });
  }
  cacheSet(cacheKey, items); return items;
}

async function resolveImdbIdByTitle(title, year) {
  if (!title) return null;
  const query = encodeURIComponent(title.toLowerCase().replace(/[^a-z0-9 ]/g,' ').trim());
  try {
    const resp = await timedFetch('https://v2.sg.media-imdb.com/suggestion/t/'+query+'.json',{},5000);
    if (!resp.ok) return null;
    const data = await resp.json(); const results = data.d||[];
    for (const r of results) {
      if (!r.id||!r.id.startsWith('tt')) continue;
      if (r.l&&r.l.toLowerCase()===title.toLowerCase()&&(!year||!r.y||Math.abs(Number(r.y)-Number(year))<=1)) return r.id;
    }
    const first=results.find(function(r){return r.id&&r.id.startsWith('tt');}); return first?first.id:null;
  } catch(e) { return null; }
}

async function fetchLetterboxdRssList(listUrl) {
  if (!listUrl) throw new Error('Letterboxd list URL is required.');
  const cacheKey='letterboxd:'+listUrl; const cached=cacheGet(cacheKey); if (cached) return cached;
  const rssUrl=listUrl.replace(/\/?$/,'/rss/');
  const resp=await timedFetch(rssUrl,{headers:{Accept:'application/rss+xml, text/xml'}});
  if (!resp.ok) throw new Error('Letterboxd RSS returned '+resp.status);
  const xml=await resp.text();
  const itemRegex=/<item>([\s\S]*?)<\/item>/g; const rawItems=[]; let m;
  while ((m=itemRegex.exec(xml))!==null) {
    const block=m[1];
    const tm=block.match(/<letterboxd:filmTitle>([\s\S]*?)<\/letterboxd:filmTitle>/);
    const ym=block.match(/<letterboxd:filmYear>([\s\S]*?)<\/letterboxd:filmYear>/);
    const title=tm?tm[1].trim():null; const year=ym?ym[1].trim():null;
    if (title) rawItems.push({title,year});
  }
  const items=[];
  for (const row of rawItems.slice(0,20)) {
    const imdbId=await resolveImdbIdByTitle(row.title,row.year);
    if (imdbId) items.push({imdbId,title:row.title,year:row.year,type:'movie'});
  }
  cacheSet(cacheKey,items); return items;
}

async function fetchTraktUserList(username, slug, mediaType, clientId) {
  if (!clientId) throw new Error('Trakt Client ID is required.');
  var cacheKey = 'trakt:user:'+username+':'+slug+':'+mediaType;
  var cached = cacheGet(cacheKey); if (cached) return cached;
  var url;
  if (slug === 'watchlist') {
    url = 'https://api.trakt.tv/users/'+encodeURIComponent(username)+'/watchlist';
    if (mediaType === 'series') url += '/shows';
    else if (mediaType === 'movie') url += '/movies';
  } else {
    url = 'https://api.trakt.tv/users/'+encodeURIComponent(username)+'/lists/'+encodeURIComponent(slug)+'/items';
  }
  url += '?limit=50';
  var resp = await timedFetch(url, { headers: { 'Content-Type':'application/json','trakt-api-version':'2','trakt-api-key':clientId,'User-Agent':'Mozilla/5.0 (compatible; Stremio-Addon/1.0)' } });
  if (!resp.ok) throw new Error('Trakt user list returned '+resp.status);
  var data = await resp.json();
  var items = data.map(function(entry) {
    var obj = entry.movie||entry.show||entry;
    var imdbId = (obj.ids&&obj.ids.imdb) ? obj.ids.imdb : null;
    var type = entry.show ? 'series' : 'movie';
    return { imdbId:imdbId, title:obj.title||null, year:obj.year||null, type:type };
  }).filter(function(i){return i.imdbId;});
  cacheSet(cacheKey, items); return items;
}

async function fetchExternalCatalog(entry, rpdbKey, traktClientId, catalogLang) {
  let items=[];
  if (entry.provider==='trakt') {
    var lt = entry.listType||'trending';
    if (lt.startsWith('user:')) {
      var parts = lt.split(':');
      items=await fetchTraktUserList(parts[1], parts[2], entry.mediaType==='series'?'series':'movie', traktClientId);
    } else {
      items=await fetchTraktList(lt, entry.mediaType==='series'?'series':'movie', traktClientId);
    }
  } else if (entry.provider==='mdblist') {
    items=await fetchMdblistItems(entry.listUrl,entry.apiKey);
  } else if (entry.provider==='imdb') {
    items=await fetchImdbRssList(entry.listUrl);
  } else if (entry.provider==='letterboxd') {
    items=await fetchLetterboxdRssList(entry.listUrl);
  } else { throw new Error('Unknown catalog provider: '+entry.provider); }
  return buildMetas(items,rpdbKey,catalogLang);
}

module.exports = { fetchExternalCatalog };
