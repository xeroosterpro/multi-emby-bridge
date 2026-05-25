"use strict";

const fetch = require("node-fetch");

const CACHE_TTL = 10 * 60 * 1000;
const _cache = new Map();
function cacheGet(key) { const e = _cache.get(key); if (!e) return null; if (Date.now() - e.ts > CACHE_TTL) { _cache.delete(key); return null; } return e.data; }
function cacheSet(key, data) { _cache.set(key, { ts: Date.now(), data }); }
async function timedFetch(url, opts, timeoutMs) { opts=opts||{}; timeoutMs=timeoutMs||10000; const c=new AbortController(); const t=setTimeout(()=>c.abort(),timeoutMs); try{return await fetch(url,Object.assign({},opts,{signal:c.signal}));}finally{clearTimeout(t);} }

const TMDB_MOVIE_GENRES = {
  'Action':28,'Adventure':12,'Animation':16,'Comedy':35,'Crime':80,
  'Documentary':99,'Drama':18,'Fantasy':14,'History':36,'Horror':27,
  'Music':10402,'Mystery':9648,'Romance':10749,'Science Fiction':878,
  'Thriller':53,'War':10752,'Western':37
};
const TMDB_TV_GENRES = {
  'Action & Adventure':10759,'Animation':16,'Comedy':35,'Crime':80,
  'Documentary':99,'Drama':18,'Fantasy':10765,'Kids':10762,
  'Mystery':9648,'Reality':10764,'Western':37
};

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
  const url = 'https://api.trakt.tv/'+traktType+'/'+listType+'?extended=full&limit=100';
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
  const ir = await timedFetch('https://api.mdblist.com/lists/'+listId+'/items/?apikey='+encodeURIComponent(apiKey)+'&limit=100');
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
  for (const row of rawItems.slice(0,30)) {
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
  url += '?limit=100';
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

async function fetchTmdbImdbIds(tmdbIds, mediaType, apiKey) {
  var ep = mediaType === 'series' ? 'tv' : 'movie';
  var results = {};
  for (var i = 0; i < tmdbIds.length; i += 20) {
    var batch = tmdbIds.slice(i, i + 20);
    var resolved = await Promise.all(batch.map(async function(id) {
      try {
        var r = await timedFetch('https://api.themoviedb.org/3/'+ep+'/'+id+'/external_ids?api_key='+apiKey, {}, 8000);
        if (!r.ok) return null;
        var d = await r.json();
        return d.imdb_id ? { tmdbId: id, imdbId: d.imdb_id } : null;
      } catch(e) { return null; }
    }));
    resolved.forEach(function(r){ if (r) results[r.tmdbId] = r.imdbId; });
  }
  return results;
}

async function fetchTmdbCharts(tmdbChart, mediaType, apiKey) {
  if (!apiKey) throw new Error('TMDB API key is required.');
  var cacheKey = 'tmdb:charts:'+tmdbChart+':'+mediaType;
  var cached = cacheGet(cacheKey); if (cached) return cached;

  var ep = mediaType === 'series' ? 'tv' : 'movie';
  var baseUrl;
  if (tmdbChart === 'trending-day') {
    baseUrl = 'https://api.themoviedb.org/3/trending/'+ep+'/day';
  } else if (tmdbChart === 'trending-week') {
    baseUrl = 'https://api.themoviedb.org/3/trending/'+ep+'/week';
  } else if (tmdbChart === 'now-playing') {
    if (mediaType === 'series') { cacheSet(cacheKey, []); return []; }
    baseUrl = 'https://api.themoviedb.org/3/movie/now_playing';
  } else if (tmdbChart === 'upcoming') {
    if (mediaType === 'series') { cacheSet(cacheKey, []); return []; }
    baseUrl = 'https://api.themoviedb.org/3/movie/upcoming';
  } else if (tmdbChart === 'top-rated') {
    baseUrl = 'https://api.themoviedb.org/3/'+ep+'/top_rated';
  } else {
    // default: popular
    baseUrl = 'https://api.themoviedb.org/3/'+ep+'/popular';
  }

  var allResults = [];
  for (var page = 1; page <= 5; page++) {
    var url = baseUrl+'?api_key='+apiKey+'&page='+page;
    var r = await timedFetch(url, {}, 8000);
    if (!r.ok) {
      if (page === 1) {
        if (r.status === 401) throw new Error('Invalid TMDB API key');
        throw new Error('TMDB API returned '+r.status);
      }
      break;
    }
    var data = await r.json();
    var pageResults = data.results || [];
    if (pageResults.length === 0) break;
    allResults = allResults.concat(pageResults);
  }

  var tmdbIds = allResults.map(function(r){ return r.id; });
  var idMap = await fetchTmdbImdbIds(tmdbIds, mediaType, apiKey);

  var items = allResults.map(function(r) {
    var imdbId = idMap[r.id] || null;
    var dateStr = r.release_date || r.first_air_date || '';
    var year = dateStr ? dateStr.substring(0, 4) : null;
    var title = r.title || r.name || null;
    return { imdbId: imdbId, title: title, year: year, type: mediaType };
  }).filter(function(i){ return i.imdbId; });

  cacheSet(cacheKey, items);
  return items;
}

async function fetchTmdbDiscover(entry, apiKey) {
  if (!apiKey) throw new Error('TMDB API key is required.');
  var mediaType = entry.mediaType === 'series' ? 'series' : 'movie';
  var ep = mediaType === 'series' ? 'tv' : 'movie';

  var cacheKey = 'tmdb:discover:'+ep+':'+(entry.tmdbGenre||'')
    +':'+(entry.tmdbMinRating||'')
    +':'+(entry.tmdbYearFrom||'')
    +':'+(entry.tmdbYearTo||'')
    +':'+(entry.tmdbSortBy||'')
    +':'+(entry.tmdbWatchProvider||'')
    +':'+(entry.tmdbWatchRegion||'');
  var cached = cacheGet(cacheKey); if (cached) return cached;

  var baseUrl = 'https://api.themoviedb.org/3/discover/'+ep;
  var params = '?api_key='+apiKey;
  params += '&sort_by='+(entry.tmdbSortBy||'popularity.desc');

  if (entry.tmdbGenre) params += '&with_genres='+encodeURIComponent(entry.tmdbGenre);
  if (entry.tmdbMinRating) {
    params += '&vote_average.gte='+encodeURIComponent(entry.tmdbMinRating);
    params += '&vote_count.gte=100';
  }
  if (entry.tmdbYearFrom) {
    var dateGte = entry.tmdbYearFrom+'-01-01';
    if (mediaType === 'series') params += '&first_air_date.gte='+encodeURIComponent(dateGte);
    else params += '&primary_release_date.gte='+encodeURIComponent(dateGte);
  }
  if (entry.tmdbYearTo) {
    var dateLte = entry.tmdbYearTo+'-12-31';
    if (mediaType === 'series') params += '&first_air_date.lte='+encodeURIComponent(dateLte);
    else params += '&primary_release_date.lte='+encodeURIComponent(dateLte);
  }
  if (entry.tmdbWatchProvider) {
    params += '&with_watch_providers='+encodeURIComponent(entry.tmdbWatchProvider);
    if (entry.tmdbWatchRegion) params += '&watch_region='+encodeURIComponent(entry.tmdbWatchRegion);
  }

  var allResults = [];
  for (var page = 1; page <= 5; page++) {
    var url = baseUrl+params+'&page='+page;
    var r = await timedFetch(url, {}, 8000);
    if (!r.ok) {
      if (page === 1) {
        if (r.status === 401) throw new Error('Invalid TMDB API key');
        throw new Error('TMDB API returned '+r.status);
      }
      break;
    }
    var data = await r.json();
    var pageResults = data.results || [];
    if (pageResults.length === 0) break;
    allResults = allResults.concat(pageResults);
  }

  var tmdbIds = allResults.map(function(r){ return r.id; });
  var idMap = await fetchTmdbImdbIds(tmdbIds, mediaType, apiKey);

  var items = allResults.map(function(r) {
    var imdbId = idMap[r.id] || null;
    var dateStr = r.release_date || r.first_air_date || '';
    var year = dateStr ? dateStr.substring(0, 4) : null;
    var title = r.title || r.name || null;
    return { imdbId: imdbId, title: title, year: year, type: mediaType };
  }).filter(function(i){ return i.imdbId; });

  cacheSet(cacheKey, items);
  return items;
}

async function fetchExternalCatalog(entry, rpdbKey, traktClientId, catalogLang, tmdbApiKey) {
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
  } else if (entry.provider==='tmdb') {
    if (entry.tmdbMode==='discover') {
      items=await fetchTmdbDiscover(entry, tmdbApiKey);
    } else {
      items=await fetchTmdbCharts(entry.tmdbChart||'trending-week', entry.mediaType==='series'?'series':'movie', tmdbApiKey);
    }
  } else { throw new Error('Unknown catalog provider: '+entry.provider); }
  return buildMetas(items,rpdbKey,catalogLang);
}

module.exports = { fetchExternalCatalog, TMDB_MOVIE_GENRES, TMDB_TV_GENRES };
