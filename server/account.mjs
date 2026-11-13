// Google / YouTube Music account APIs, following Metrolist and InnertubeX.
// SPDX-License-Identifier: GPL-3.0-only
import { ApiError, innertube, find, text, artwork, items, continuation, acceptLanguage, freshVisitorData, WEB_USER_AGENT } from './catalog.mjs';
import { normalizeAccount, authenticationHeaders, sapisid } from './auth.mjs';

const ACCOUNT_ORIGIN = 'https://music.youtube.com';
const LIBRARY_IDS = {
  playlists: 'FEmusic_liked_playlists', liked: 'VLLM', songs: 'FEmusic_liked_videos',
  albums: 'FEmusic_liked_albums', artists: 'FEmusic_library_corpus_artists',
};

function requireAccount(account) {
  if (!account || !sapisid(account)) throw new ApiError('请先登录 Google / YouTube Music。', 401);
  return account;
}

function pageConfig(html, key) {
  const match = html.match(new RegExp(`"${key}"\\s*:\\s*("(?:\\\\.|[^"\\\\])*"|\\d+)`));
  return match ? String(JSON.parse(match[1])) : '';
}

export async function completeAccountSession(input, options = {}) {
  const account = requireAccount(normalizeAccount(input));
  if (account.visitorData && account.dataSyncId) return account;
  const url = new URL(ACCOUNT_ORIGIN);
  url.searchParams.set('authuser', account.authUser);
  // A bare user agent gets YouTube Music's "browser not supported" page,
  // which carries neither the visitor nor the data sync id.
  const response = await (options.fetch || fetch)(url, { headers: {
    'User-Agent': WEB_USER_AGENT, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': acceptLanguage(options.hl, options.gl), ...await authenticationHeaders(account),
  } });
  if (!response.ok) throw new ApiError(`YouTube Music 登录页面返回 HTTP ${response.status}`, response.status);
  const html = await response.text();
  return { ...account,
    visitorData: account.visitorData || pageConfig(html, 'VISITOR_DATA') || await freshVisitorData(options) || '',
    dataSyncId: account.dataSyncId || pageConfig(html, 'DATASYNC_ID').split('||')[0] };
}

export function parseAccountInfo(data, account = {}) {
  const header = find(data, 'activeAccountHeaderRenderer');
  if (!header || !text(header.accountName)) throw new ApiError('无法读取当前 Google 账号；请重新登录 YouTube Music。', 401);
  const channelId = header.channelId || header.navigationEndpoint?.browseEndpoint?.browseId;
  const email = text(header.email);
  const name = text(header.accountName);
  return {
    id: channelId || account.dataSyncId || `${account.authUser || '0'}:${email || name}`,
    name, email, channelHandle: text(header.channelHandle), avatar: artwork(header.accountPhoto),
    ...(channelId ? { channelId } : {}),
  };
}

export async function accountInfo(account, options = {}) {
  const data = await innertube('account/account_menu', {}, { ...options, account: requireAccount(account) });
  return parseAccountInfo(data, account);
}

export async function loginAccount(input, options = {}) {
  const account = await completeAccountSession(input, options);
  const profile = await accountInfo(account, options);
  const { cookie, ...session } = account;
  return { account: profile, session };
}

export function parseAccounts(data, account = {}) {
  const output = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    const item = node.accountItem || node.accountItemRenderer;
    if (item) {
      const endpoint = find(item, 'selectActiveIdentityEndpoint');
      const tokens = endpoint?.supportedTokens || [];
      const token = (name, key) => tokens.map(value => value[name]?.[key]).find(Boolean);
      const signinUrl = token('accountSigninToken', 'signinUrl');
      const pageId = token('pageIdToken', 'pageId');
      const dataSyncId = token('datasyncIdToken', 'datasyncIdToken')?.split('||')[0];
      const name = text(item.accountName), byline = text(item.accountByline);
      const authUser = signinUrl ? new URL(signinUrl, ACCOUNT_ORIGIN).searchParams.get('authuser') : null;
      if (name) output.push({ name, byline, avatar: artwork(item.accountPhoto),
        channelHandle: text(item.channelHandle),
        ...(byline.includes('@') && !byline.startsWith('@') ? { email: byline } : {}),
        pageId, dataSyncId, signinUrl, authUser: authUser || account.authUser || '0', selected: !!item.isSelected });
    }
    Object.values(node).forEach(visit);
  }
  visit(data);
  return [...new Map(output.map(item => [item.pageId || item.dataSyncId || item.signinUrl || item.channelHandle || item.name, item])).values()];
}

export async function accountChannels(account, options = {}) {
  const data = await innertube('account/accounts_list', {
    requestType: 'ACCOUNTS_LIST_REQUEST_TYPE_CHANNEL_SWITCHER', callCircumstance: 'SWITCHING_USERS_FULL',
  }, { ...options, account: { ...requireAccount(account), dataSyncId: '' } });
  return { accounts: parseAccounts(data, account) };
}

export async function accountLibrary(account, params = {}) {
  const type = params.type || 'playlists';
  if (!LIBRARY_IDS[type]) throw new ApiError('未知的账号音乐库分类。', 400);
  const data = await innertube('browse', params.continuation ? { continuation: params.continuation } : {
    browseId: LIBRARY_IDS[type],
  }, { ...params, account: requireAccount(account) });
  return { type, items: items(data), continuation: continuation(data) };
}

function mutationResult(data) {
  const alert = find(data, 'alertRenderer');
  if (data.status === 'STATUS_FAILED' || alert?.type === 'ERROR') {
    throw new ApiError(text(alert?.text) || 'YouTube Music 未完成这次修改。');
  }
  return data;
}

async function mutate(endpoint, body, account, options) {
  return mutationResult(await innertube(endpoint, body, { ...options, account: requireAccount(account) }));
}

export async function accountLike(account, input, options = {}) {
  if (!input.id) throw new ApiError('缺少歌曲或歌单 id。', 400);
  const target = input.kind === 'playlist' ? { playlistId: input.id.replace(/^VL/, '') } : { videoId: input.id };
  await mutate(input.liked ? 'like/like' : 'like/removelike', { target }, account, options);
  return { ok: true, id: input.id, liked: !!input.liked };
}

export async function accountSubscribe(account, input, options = {}) {
  if (!input.id) throw new ApiError('缺少歌手频道 id。', 400);
  await mutate(input.subscribed ? 'subscription/subscribe' : 'subscription/unsubscribe', {
    channelIds: [input.id], ...(input.params ? { params: input.params } : {}),
  }, account, options);
  return { ok: true, id: input.id, subscribed: !!input.subscribed };
}

export async function accountSaveSong(account, input, options = {}) {
  if (!input.id) throw new ApiError('缺少歌曲 id。', 400);
  const data = await innertube('next', { videoId: input.id, isAudioOnly: true, enablePersistentPlaylistPanel: true },
    { ...options, account: requireAccount(account) });
  const song = items(data).find(item => item.id === input.id);
  const feedbackToken = input.saved ? song?.libraryAddToken : song?.libraryRemoveToken;
  if (!feedbackToken) {
    if (song?.saved === !!input.saved) return { ok: true, id: input.id, saved: !!input.saved };
    throw new ApiError('YouTube Music 没有为这首歌曲提供音乐库操作。');
  }
  const result = await mutate('feedback', { feedbackTokens: [feedbackToken] }, account, options);
  if (result.feedbackResponses?.some(value => value.isProcessed === false)) throw new ApiError('YouTube Music 没有保存这次音乐库修改。');
  return { ok: true, id: input.id, saved: !!input.saved };
}

export async function accountPlaylist(account, input, options = {}) {
  requireAccount(account);
  const playlistId = String(input.playlistId || '').replace(/^VL/, '');
  if (input.action === 'create') {
    if (!input.title?.trim()) throw new ApiError('请输入歌单名称。', 400);
    const result = await mutate('playlist/create', { title: input.title, privacyStatus: input.privacy || 'PRIVATE',
      ...(input.videoIds?.length ? { videoIds: input.videoIds } : {}),
    }, account, options);
    if (!result.playlistId) throw new ApiError('YouTube Music 未返回新歌单 id。');
    if (input.description) await mutate('browse/edit_playlist', {
      playlistId: result.playlistId,
      actions: [{ action: 'ACTION_SET_PLAYLIST_DESCRIPTION', playlistDescription: input.description }],
    }, account, options);
    return { ok: true, playlistId: result.playlistId, browseId: `VL${result.playlistId}`, title: input.title };
  }
  if (!playlistId) throw new ApiError('缺少歌单 id。', 400);
  if (input.action === 'delete') {
    await mutate('playlist/delete', { playlistId }, account, options);
  } else {
    let actions;
    switch (input.action) {
      case 'rename': actions = [{ action: 'ACTION_SET_PLAYLIST_NAME', playlistName: input.title }]; break;
      case 'description': actions = [{ action: 'ACTION_SET_PLAYLIST_DESCRIPTION', playlistDescription: input.description || '' }]; break;
      case 'add': actions = (input.videoIds || [input.videoId]).filter(Boolean).map(addedVideoId => ({ action: 'ACTION_ADD_VIDEO', addedVideoId })); break;
      case 'remove':
        if (!input.videoId || !input.setVideoId) throw new ApiError('移除歌曲需要 videoId 与歌单条目的 setVideoId。', 400);
        actions = [{ action: 'ACTION_REMOVE_VIDEO', removedVideoId: input.videoId, setVideoId: input.setVideoId }]; break;
      case 'move':
        if (!input.setVideoId) throw new ApiError('移动歌曲需要歌单条目的 setVideoId。', 400);
        actions = [{ action: 'ACTION_MOVE_VIDEO_BEFORE', setVideoId: input.setVideoId, movedSetVideoIdSuccessor: input.successorSetVideoId || null }]; break;
      default: throw new ApiError('未知的歌单操作。', 400);
    }
    if (!actions.length) throw new ApiError('请选择要加入歌单的歌曲。', 400);
    await mutate('browse/edit_playlist', { playlistId, actions }, account, options);
  }
  return { ok: true, playlistId, browseId: `VL${playlistId}`, ...(input.title ? { title: input.title } : {}) };
}
