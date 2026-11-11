// Request-scoped Google / YouTube Music credentials, matching InnertubeX.
// SPDX-License-Identifier: GPL-3.0-only

export const ACCOUNT_HEADER = 'X-Metrolist-Account';

export function normalizeAccount(value) {
  if (!value?.cookie?.trim()) return null;
  return {
    cookie: value.cookie.trim(), visitorData: value.visitorData || '',
    dataSyncId: String(value.dataSyncId || '').split('||')[0],
    authUser: /^\d+$/.test(String(value.authUser ?? '0')) ? String(value.authUser ?? '0') : '0',
  };
}

export function accountFromRequest(request) {
  const value = request.headers.get(ACCOUNT_HEADER);
  return value ? normalizeAccount(JSON.parse(decodeURIComponent(value))) : null;
}

export async function sha1(value) {
  const bytes = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function sapisid(account) {
  const cookies = Object.fromEntries((account?.cookie || '').split(';').map(part => {
    const at = part.indexOf('=');
    return [part.slice(0, at).trim(), part.slice(at + 1).trim()];
  }));
  return cookies.SAPISID || cookies['__Secure-3PAPISID'] || cookies['__Secure-1PAPISID'];
}

export async function authenticationHeaders(account, origin = 'https://music.youtube.com', now = Date.now()) {
  if (!account) return {};
  const value = sapisid(account);
  if (!value) throw Object.assign(new Error('Google 会话缺少 SAPISID，请重新登录 YouTube Music。'), { status: 401 });
  const timestamp = Math.floor(now / 1000);
  return {
    Cookie: account.cookie,
    Authorization: `SAPISIDHASH ${timestamp}_${await sha1(`${timestamp} ${value} ${origin}`)}`,
    'X-Goog-AuthUser': account.authUser || '0',
    ...(account.visitorData ? { 'X-Goog-Visitor-Id': account.visitorData } : {}),
  };
}

export function accountUser(account) {
  return account?.dataSyncId ? { onBehalfOfUser: account.dataSyncId } : {};
}

export async function accountIdentity(account) {
  return account ? sha1(`${account.cookie}\n${account.authUser || '0'}\n${account.dataSyncId || ''}\n${account.visitorData || ''}`) : 'anonymous';
}
