// SPDX-License-Identifier: GPL-3.0-only
import { ApiError, CLIENT_VERSION, home, search, browse, next, lyrics, suggestions, explore } from './catalog.mjs';
import { resolveWorkerAudio, streamMetadata, proxyAudio, audioRequestHeaders } from './streaming.mjs';
import { accountFromRequest } from './auth.mjs';
import { loginAccount, accountInfo, accountChannels, accountLibrary, accountLike, accountSubscribe, accountSaveSong, accountPlaylist } from './account.mjs';

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Range, X-Metrolist-Account',
  'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length, Content-Type',
};

export function json(body, status = 200) {
  return Response.json(body, { status, headers: { ...cors, 'Cache-Control': 'no-store' } });
}

export async function api(request, env = {}) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  try {
    const params = { ...Object.fromEntries(url.searchParams), account: accountFromRequest(request), ...(env.fetch ? { fetch: env.fetch } : {}) };
    const input = async () => {
      if (request.method !== 'POST') throw new ApiError('此操作需要 POST 请求。', 405);
      return request.json();
    };
    switch (url.pathname) {
      case '/api/health': return json({ ok: true, service: 'metrolist-nsh', catalog: 'youtube-music',
        clientVersion: CLIENT_VERSION, nativeStreams: true,
        audioEngine: env.audioEngine || (env.resolveAudio && env.resolveAudio !== resolveWorkerAudio ? 'custom' : 'innertube-visionos') });
      case '/api/home': return json(await home(params));
      case '/api/explore': return json(await explore(params));
      case '/api/suggestions': return json(await suggestions(params.q || '', params));
      case '/api/search': return json(await search(params.q || '', params.type || 'all', params));
      case '/api/browse': {
        if (!params.id) throw new ApiError('A browse id is required', 400);
        return json(await browse(params.id, params));
      }
      case '/api/next': {
        if (!params.id) throw new ApiError('A video id is required', 400);
        return json(await next(params.id, params));
      }
      case '/api/lyrics': return json(await lyrics(params.title || '', params.artist || '', Number(params.duration || 0)));
      case '/api/account/login': return json(await loginAccount(await input(), params));
      case '/api/account': return json(await accountInfo(params.account, params));
      case '/api/account/channels': return json(await accountChannels(params.account, params));
      case '/api/account/library': return json(await accountLibrary(params.account, params));
      case '/api/account/like': return json(await accountLike(params.account, await input(), params));
      case '/api/account/subscribe': return json(await accountSubscribe(params.account, await input(), params));
      case '/api/account/song': return json(await accountSaveSong(params.account, await input(), params));
      case '/api/account/playlist': return json(await accountPlaylist(params.account, await input(), params));
      case '/api/stream': {
        if (!params.id) throw new ApiError('A video id is required', 400);
        const media = await (env.resolveAudio || resolveWorkerAudio)(params.id, params);
        return json(streamMetadata(media, request, params, !!env.directStreams));
      }
      case '/api/audio': {
        if (params.source) return await proxyAudio(request, { url: params.source, mimeType: params.mime || 'audio/mp4', headers: audioRequestHeaders(params.client) }, cors);
        if (!params.id) throw new ApiError('A video id is required', 400);
        const media = await (env.resolveAudio || resolveWorkerAudio)(params.id, params);
        return await proxyAudio(request, media, cors);
      }
      case '/api/download':
      case '/api/offline': return json({ error: '本地文件下载由 Node gateway 提供；网页版的离线音频保存在浏览器中。' }, 501);
      default: return json({ error: 'Unknown API endpoint' }, 404);
    }
  } catch (error) {
    return json({ error: error.message }, error.status || 502);
  }
}

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return api(request, env);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Metrolist NSH gateway. GET /api/health', { headers: { 'Content-Type': 'text/plain' } });
  },
};
