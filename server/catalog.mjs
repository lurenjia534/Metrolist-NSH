/**
 * YouTube Music catalog transport for Metrolist NSH.
 * Request profiles and renderer semantics follow Metrolist / InnertubeX.
 * SPDX-License-Identifier: GPL-3.0-only
 */
import { authenticationHeaders, accountUser } from './auth.mjs';

export const CLIENT_VERSION = '1.20260707.12.00';
export const WEB_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0';
const ORIGIN = 'https://music.youtube.com';
const anonymousVisitors = new WeakMap();
const VISITOR_TTL_MS = 3 * 60 * 60 * 1000;
const FILTERS = {
  songs: 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D',
  albums: 'EgWKAQIYAWoKEAkQChAFEAMQBA%3D%3D',
  artists: 'EgWKAQIgAWoKEAkQChAFEAMQBA%3D%3D',
  playlists: 'EgeKAQQoAEABagoQAxAEEAoQCRAF',
};

export class ApiError extends Error {
  constructor(message, status = 502, details = {}) {
    super(message);
    this.status = status;
    this.code = status === 429 ? 'rate-limited' : `http-${status}`;
    Object.assign(this, details);
  }
}

export function getAnonymousVisitor(options = {}) {
  const context = anonymousVisitors.get(options.fetch || fetch);
  return context?.expiresAt > Date.now() ? context : undefined;
}

export function rememberAnonymousVisitor(visitorData, options = {}) {
  if (options.account || !visitorData) return undefined;
  const existing = getAnonymousVisitor(options);
  if (existing) return existing;
  const context = { visitorData, expiresAt: Date.now() + VISITOR_TTL_MS };
  anonymousVisitors.set(options.fetch || fetch, context);
  return context;
}

export function retryAfterMilliseconds(value, now = Date.now()) {
  if (!value) return undefined;
  const delay = /^\d+$/.test(value.trim()) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.max(0, delay) : undefined;
}

export function upstreamError(response, stage, message) {
  const retryAfterMs = retryAfterMilliseconds(response.headers.get('Retry-After'));
  return new ApiError(message, response.status, { stage,
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  });
}

// Only playback setup retries a short, explicit server delay. Catalog requests
// and account mutations never wait behind a playback retry.
export async function playbackRequest(url, init, options, stage) {
  const transport = options.fetch || fetch;
  let response = await transport(url, init);
  const retryAfterMs = response.status === 429 ? retryAfterMilliseconds(response.headers.get('Retry-After')) : undefined;
  if (retryAfterMs !== undefined && retryAfterMs <= 5000) {
    await response.body?.cancel();
    await new Promise(resolve => setTimeout(resolve, retryAfterMs));
    response = await transport(url, init);
  }
  if (!response.ok) throw upstreamError(response, stage,
    `YouTube ${stage === 'visitor' ? '播放配置请求' : '音频解析'}失败（HTTP ${response.status}）`);
  return response;
}

export async function innertube(endpoint, body, options = {}) {
  let visitorData = options.account?.visitorData;
  if (body.continuation?.startsWith('nsh:')) {
    const state = JSON.parse(atob(body.continuation.slice(4)));
    body = { ...body, continuation: state.token };
    visitorData = state.visitorData || visitorData;
  }
  const url = new URL(`${ORIGIN}/youtubei/v1/${endpoint}`);
  url.searchParams.set('prettyPrint', 'false');
  if (endpoint === 'search' && body.continuation) {
    url.searchParams.set('continuation', body.continuation);
    url.searchParams.set('ctoken', body.continuation);
  }
  const init = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': WEB_USER_AGENT,
      'Origin': ORIGIN,
      'X-Origin': ORIGIN,
      'X-Goog-Api-Format-Version': '1',
      'X-YouTube-Client-Name': '67',
      'X-YouTube-Client-Version': CLIENT_VERSION,
      'Referer': `${ORIGIN}/`,
      ...await authenticationHeaders(options.account, ORIGIN),
      ...(visitorData ? { 'X-Goog-Visitor-Id': visitorData } : {}),
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'WEB_REMIX', clientVersion: CLIENT_VERSION,
          gl: options.gl || 'US', hl: options.hl || 'zh-CN',
          ...(visitorData ? { visitorData } : {}),
        },
        user: { lockedSafetyMode: false, ...accountUser(options.account) },
      },
      ...body,
    }),
  };
  const response = endpoint === 'player' ? await playbackRequest(url, init, options, 'player') :
    await (options.fetch || fetch)(url, init);
  if (!response.ok) throw upstreamError(response, 'catalog', `YouTube Music returned HTTP ${response.status}`);
  const result = await response.json();
  if (result.error) throw new ApiError(result.error.message, result.error.code || 502);
  if (options.account && result.responseContext?.mainAppWebResponseContext?.loggedOut === true) {
    throw new ApiError('YouTube Music 登录会话已失效，请重新登录。', 401);
  }
  // An already loaded anonymous catalog page can supply the first player request's visitor.
  rememberAnonymousVisitor(result.responseContext?.visitorData, options);
  return result;
}

export const text = value => typeof value === 'string' ? value :
  value?.runs?.map(run => run.text).join('') || value?.simpleText || '';

export function find(root, key) {
  if (!root || typeof root !== 'object') return undefined;
  if (root[key] !== undefined) return root[key];
  for (const value of Object.values(root)) {
    const match = find(value, key);
    if (match !== undefined) return match;
  }
}

export function artwork(root) {
  const thumbnails = find(root, 'thumbnails');
  const image = thumbnails?.[thumbnails.length - 1];
  return image?.url?.replace(/=w\d+-h\d+/, '=w544-h544') || '';
}

export function seconds(value) {
  const candidate = String(value || '').match(/(?:\d+:)?\d+:\d{2}/)?.[0];
  return candidate ? candidate.split(':').reduce((total, part) => total * 60 + Number(part), 0) : 0;
}

function pageType(endpoint) {
  return endpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType || '';
}

function metadata(runs) {
  const artists = runs.filter(run => pageType(run.navigationEndpoint).includes('ARTIST'));
  const album = runs.find(run => pageType(run.navigationEndpoint).includes('ALBUM'));
  const duration = runs.map(run => seconds(run.text)).find(value => value > 0) || 0;
  return {
    artist: artists.map(run => run.text).join(' / '),
    artistId: artists[0]?.navigationEndpoint.browseEndpoint.browseId,
    album: album?.text || '',
    albumId: album?.navigationEndpoint.browseEndpoint.browseId,
    duration,
  };
}

function unlinkedArtist(subtitle) {
  return subtitle.split(' • ').find(part => part && !/^(歌曲|视频|专辑|单曲|音乐人|播放列表|Song|Video|Album|Single|Artist|Playlist|\d+:\d+|播放次数|\d+.*views)/i.test(part)) || '';
}

function collection(endpoint, title, subtitle, image) {
  const browse = endpoint?.browseEndpoint;
  const playlist = endpoint?.watchPlaylistEndpoint?.playlistId;
  const id = browse?.browseId || (playlist ? `VL${playlist}` : '');
  if (!id) return null;
  const type = pageType(endpoint);
  return {
    id, browseId: id, title, subtitle, artwork: image,
    ...(id.startsWith('VL') ? { playlistId: id.slice(2) } : {}),
    ...(browse?.params ? { params: browse.params } : {}),
    type: type.includes('ARTIST') || id.startsWith('UC') ? 'artist' :
      type.includes('ALBUM') || id.startsWith('MPRE') ? 'album' : 'playlist',
  };
}

function collectionActions(value, row) {
  if (!value) return value;
  const playlistId = value.playlistId || find(row, 'playlistEditEndpoint')?.playlistId ||
    find(row, 'watchPlaylistEndpoint')?.playlistId;
  const menu = row.menu?.menuRenderer?.items || [];
  return { ...value, ...(playlistId ? { playlistId } : {}),
    editable: row.isEditable === true || !!find(row, 'playlistEditEndpoint') ||
      menu.some(item => item.menuNavigationItemRenderer?.icon?.iconType === 'EDIT') };
}

export function libraryTokens(row) {
  const result = {};
  const menu = row.menu?.menuRenderer?.items || [];
  for (const item of menu) {
    const toggle = item.toggleMenuServiceItemRenderer;
    if (!toggle) continue;
    const icon = toggle.defaultIcon?.iconType;
    const add = ['LIBRARY_ADD', 'BOOKMARK_BORDER'].includes(icon);
    const saved = ['LIBRARY_SAVED', 'LIBRARY_REMOVE', 'BOOKMARK'].includes(icon);
    if (!add && !saved) continue;
    result.saved = saved;
    result.libraryAddToken = (add ? toggle.defaultServiceEndpoint : toggle.toggledServiceEndpoint)?.feedbackEndpoint?.feedbackToken;
    result.libraryRemoveToken = (saved ? toggle.defaultServiceEndpoint : toggle.toggledServiceEndpoint)?.feedbackEndpoint?.feedbackToken;
  }
  return result;
}

function responsiveItem(row) {
  const columns = row.flexColumns?.map(column => column.musicResponsiveListItemFlexColumnRenderer.text) || [];
  const title = text(columns[0]);
  const subtitle = text(columns[1]);
  const endpoint = row.navigationEndpoint || columns[0]?.runs?.[0]?.navigationEndpoint;
  const browse = endpoint?.browseEndpoint;
  if (browse) return collectionActions(collection(endpoint, title, subtitle, artwork(row.thumbnail)), row);
  const id = row.playlistItemData?.videoId || endpoint?.watchEndpoint?.videoId ||
    row.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId;
  if (!id) return null;
  const meta = metadata(columns.slice(1).flatMap(column => column?.runs || []));
  const fixed = row.fixedColumns?.map(column => text(column.musicResponsiveListItemFixedColumnRenderer.text)).join(' ');
  const setVideoId = row.playlistItemData?.playlistSetVideoId ||
    row.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.playlistSetVideoId;
  return {
    id, title, ...meta,
    artist: meta.artist || unlinkedArtist(subtitle),
    duration: seconds(fixed) || meta.duration,
    artwork: artwork(row.thumbnail) || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    source: 'youtube', type: 'song',
    ...(setVideoId ? { setVideoId } : {}),
    ...libraryTokens(row),
  };
}

function twoRowItem(row) {
  const title = text(row.title);
  const subtitle = text(row.subtitle);
  const endpoint = row.navigationEndpoint || row.title?.runs?.[0]?.navigationEndpoint;
  if (endpoint?.browseEndpoint || endpoint?.watchPlaylistEndpoint) {
    return collectionActions(collection(endpoint, title, subtitle, artwork(row.thumbnailRenderer)), row);
  }
  const id = endpoint?.watchEndpoint?.videoId;
  if (!id) return null;
  const meta = metadata(row.subtitle?.runs || []);
  return {
    id, title, ...meta, artist: meta.artist || unlinkedArtist(subtitle),
    artwork: artwork(row.thumbnailRenderer), source: 'youtube', type: 'song', ...libraryTokens(row),
  };
}

function panelItem(row) {
  const meta = metadata(row.longBylineText?.runs || row.shortBylineText?.runs || []);
  return {
    id: row.videoId, title: text(row.title), ...meta,
    artist: meta.artist || text(row.shortBylineText),
    artwork: artwork(row.thumbnail), duration: seconds(text(row.lengthText)),
    source: 'youtube', type: 'song',
    ...(row.playlistSetVideoId ? { setVideoId: row.playlistSetVideoId } : {}), ...libraryTokens(row),
  };
}

/** Only content renderers produce items; action menus cannot accidentally add songs. */
export function items(root) {
  const result = [];
  const seen = new Set();
  function visit(node, inheritedArtist = '') {
    if (!node || typeof node !== 'object') return;
    let item;
    if (node.musicResponsiveListItemRenderer) item = responsiveItem(node.musicResponsiveListItemRenderer);
    else if (node.musicTwoRowItemRenderer) item = twoRowItem(node.musicTwoRowItemRenderer);
    else if (node.playlistPanelVideoRenderer) item = panelItem(node.playlistPanelVideoRenderer);
    else if (node.musicCardShelfRenderer) {
      const card = node.musicCardShelfRenderer;
      item = twoRowItem({ ...card, thumbnailRenderer: card.thumbnail });
      visit(card.contents, pageType(card.title?.runs?.[0]?.navigationEndpoint).includes('ARTIST') ? text(card.title) : inheritedArtist);
    } else {
      Object.values(node).forEach(value => visit(value, inheritedArtist));
      return;
    }
    const key = item?.setVideoId || item?.id;
    if (item && !seen.has(key)) {
      if (item.source === 'youtube' && !item.artist) item.artist = inheritedArtist;
      seen.add(key);
      result.push(item);
    }
  }
  visit(root);
  return result;
}

export function sections(root) {
  const result = [];
  const pageTitle = text(find(root, 'musicHeaderRenderer')?.title);
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    const shelf = node.musicCarouselShelfRenderer || node.musicShelfRenderer || node.musicPlaylistShelfRenderer || node.gridRenderer ||
      node.musicShelfContinuation || node.musicPlaylistShelfContinuation || node.gridContinuation;
    if (shelf) {
      const content = items(shelf.contents || shelf.items);
      if (content.length) result.push({
        title: text(shelf.title) || text(shelf.header?.musicCarouselShelfBasicHeaderRenderer?.title) ||
          text(shelf.header?.gridHeaderRenderer?.title) || pageTitle || '歌曲',
        items: content,
      });
      return;
    }
    Object.values(node).forEach(visit);
  }
  visit(root);
  return result;
}

export function continuation(root) {
  const token = find(root, 'nextContinuationData')?.continuation || find(root, 'continuationCommand')?.token;
  return token ? 'nsh:' + btoa(JSON.stringify({ token, visitorData: root.responseContext?.visitorData })) : undefined;
}

export async function home(params = {}) {
  const data = await innertube('browse', params.continuation ?
    { continuation: params.continuation } : { browseId: params.id || 'FEmusic_home' }, params);
  return { sections: sections(data), continuation: continuation(data) };
}

export async function search(query, type = 'all', params = {}) {
  if (!query && !params.continuation) return { query, type, items: [] };
  const data = await innertube('search', {
    query, ...(FILTERS[type] ? { params: FILTERS[type] } : {}),
    ...(params.continuation ? { continuation: params.continuation } : {}),
  }, params);
  return { query, type, items: items(data), continuation: continuation(data) };
}

export function parseBrowse(data, id) {
  const header = find(data, 'musicResponsiveHeaderRenderer') || find(data, 'musicDetailHeaderRenderer') ||
    find(data, 'musicImmersiveHeaderRenderer') || find(data, 'musicVisualHeaderRenderer') || find(data, 'musicHeaderRenderer') || {};
  const title = text(header.title);
  const image = artwork(header.thumbnail || header.foregroundThumbnail || {});
  const content = sections(data);
  if (!content.length && items(data).length) content.push({ title: '歌曲', items: items(data) });
  const tracks = content.flatMap(section => section.items.filter(item => item.source === 'youtube'));
  const unique = [...new Map(tracks.map(track => [track.setVideoId || track.id, track])).values()];
  const artist = text(header.straplineTextOne);
  const subtitle = [artist, text(header.subtitle), text(header.secondSubtitle)].filter(Boolean).join(' · ');
  const year = subtitle.match(/(?:19|20)\d{2}/)?.[0];
  const canonical = find(data, 'microformatDataRenderer')?.urlCanonical;
  const playlistId = id.startsWith('VL') ? id.slice(2) :
    (canonical ? new URL(canonical, ORIGIN).searchParams.get('list') : '') ||
    find(header, 'watchPlaylistEndpoint')?.playlistId || find(header, 'watchEndpoint')?.playlistId;
  return {
    id, title,
    ...(playlistId ? { playlistId } : {}),
    editable: !!find(data, 'musicEditablePlaylistDetailHeaderRenderer') || header.isEditable === true ||
      collectionActions({}, header).editable,
    subtitle,
    artwork: image,
    description: text(header.description) || text(find(data, 'musicDescriptionShelfRenderer')?.description),
    subscriberCount: text(find(header, 'longSubscriberCountText')) || text(find(header, 'subscriberCountText')),
    ...(year ? { year: Number(year) } : {}),
    tracks: unique.map(track => ({ ...track,
      artwork: id.startsWith('MPRE') ? image || track.artwork : track.artwork,
      artist: track.artist || artist,
      album: track.album || (id.startsWith('MPRE') ? title : ''),
    })),
    sections: content,
    continuation: continuation(data),
  };
}

export async function browse(id, params = {}) {
  const data = await innertube('browse', params.continuation ?
    { continuation: params.continuation } : { browseId: id, ...(params.params ? { params: params.params } : {}) }, params);
  return { ...parseBrowse(data, id), ...(params.params ? { params: params.params } : {}) };
}

export async function suggestions(query, params = {}) {
  if (!query.trim()) return { query, suggestions: [] };
  const data = await innertube('music/get_search_suggestions', { input: query }, params);
  const values = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    const renderer = node.searchSuggestionRenderer || node.historySuggestionRenderer;
    if (renderer) values.push(renderer.navigationEndpoint?.searchEndpoint?.query || text(renderer.suggestion));
    else Object.values(node).forEach(visit);
  }
  visit(data);
  return { query, suggestions: [...new Set(values.filter(Boolean))] };
}

export function moodCategories(root) {
  const result = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    const renderer = node.musicNavigationButtonRenderer;
    if (renderer) {
      const endpoint = renderer.clickCommand?.browseEndpoint;
      if (endpoint) result.push({
        title: text(renderer.buttonText), browseId: endpoint.browseId, params: endpoint.params,
        ...(renderer.solid?.leftStripeColor ? { color: '#' + (renderer.solid.leftStripeColor & 0xffffff).toString(16).padStart(6, '0') } : {}),
      });
    } else Object.values(node).forEach(visit);
  }
  visit(root);
  return result;
}

export async function explore(params = {}) {
  const tab = params.tab || 'all';
  const ids = { all: 'FEmusic_explore', new: 'FEmusic_new_releases_albums', charts: 'FEmusic_charts', moods: 'FEmusic_moods_and_genres' };
  const [data, moods] = await Promise.all([
    innertube('browse', params.continuation ? { continuation: params.continuation } : { browseId: ids[tab] || ids.all }, params),
    tab === 'all' ? innertube('browse', { browseId: ids.moods }, params) : Promise.resolve(null),
  ]);
  return { tab, sections: sections(data), moods: moodCategories(moods || (tab === 'moods' ? data : {})), continuation: continuation(data) };
}

export async function next(id, params = {}) {
  const data = await innertube('next', {
    videoId: id, playlistId: params.playlistId || `RDAMVM${id}`,
    isAudioOnly: true, enablePersistentPlaylistPanel: true,
    ...(params.continuation ? { continuation: params.continuation } : {}),
  }, params);
  const tabs = find(data, 'watchNextTabbedResultsRenderer')?.tabs || [];
  const lyricsId = tabs.map(tab => tab.tabRenderer?.endpoint?.browseEndpoint?.browseId)
    .find(value => value?.startsWith('MPLY'));
  return { tracks: items(data).filter(item => item.source === 'youtube'), lyricsId, continuation: continuation(data) };
}

export function parseLrc(value) {
  const lines = [];
  for (const line of (value || '').split('\n')) {
    const stamps = [...line.matchAll(/\[(\d+):(\d{2}(?:\.\d+)?)\]/g)];
    const content = line.replace(/\[[^\]]*\]/g, '').trim();
    for (const stamp of stamps) lines.push({ time: Number(stamp[1]) * 60 + Number(stamp[2]), text: content });
  }
  return lines.sort((a, b) => a.time - b.time);
}

export async function lyrics(title, artist, duration = 0) {
  const url = new URL('https://lrclib.net/api/search');
  url.searchParams.set('track_name', title);
  if (artist) url.searchParams.set('artist_name', artist.split(' / ')[0]);
  const response = await fetch(url, { headers: { 'User-Agent': 'Metrolist-NSH/0.1.0' } });
  if (!response.ok) throw new ApiError(`LRCLIB returned HTTP ${response.status}`);
  const matches = await response.json();
  const score = candidate => (candidate.syncedLyrics ? 0 : 1000) +
    (duration ? Math.abs(candidate.duration - duration) : 0);
  const match = matches.sort((a, b) => score(a) - score(b))[0];
  return {
    plainLyrics: match?.plainLyrics || '', syncedLyrics: match?.syncedLyrics || '',
    lines: parseLrc(match?.syncedLyrics), instrumental: !!match?.instrumental,
    ...(match ? { source: 'LRCLIB', id: match.id } : {}),
  };
}
