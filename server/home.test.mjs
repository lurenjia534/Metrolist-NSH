import test from 'node:test';
import assert from 'node:assert/strict';
import { items, sections } from './catalog.mjs';
import { api } from './index.mjs';

const runs = (...values) => ({ runs: values.map(value => typeof value === 'string' ? { text: value } : value) });
const browse = (browseId, params, pageType) => ({ browseEndpoint: {
  browseId, ...(params ? { params } : {}),
  ...(pageType ? { browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType } } } : {}),
} });
const image = url => ({ musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url }] } } });
const song = id => ({ musicResponsiveListItemRenderer: {
  playlistItemData: { videoId: id },
  flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: runs(`Song ${id}`) } }],
} });
const playlist = id => ({ musicTwoRowItemRenderer: {
  title: runs(`Playlist ${id}`), navigationEndpoint: browse(`VL${id}`, 'collection-params'),
  thumbnailRenderer: image('https://example.test/cover.jpg'),
} });
const carousel = (title, contents, header = {}, shelf = {}) => ({ musicCarouselShelfRenderer: {
  header: { musicCarouselShelfBasicHeaderRenderer: { title: runs(title), ...header } }, contents, ...shelf,
} });
const page = (contents, options = {}) => ({
  responseContext: { visitorData: 'home-visitor' },
  contents: { singleColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: {
    contents, ...options,
  } } } }] } },
});

async function request(path, responseData, requests = []) {
  const response = await api(new Request(`https://metrolist.test/api/${path}`), {
    fetch: async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
      return Response.json(responseData);
    },
  });
  assert.equal(response.status, 200);
  return response.json();
}

// Renderer fields follow the pinned upstream HomePage/SectionList models and
// the live WEB_REMIX home response inspected on 2026-11-12.
test('Home returns native chip selection/deselection commands and section actions without changing their params', async () => {
  const chipParams = 'ggNC+/opaque%3D';
  const result = await request('home', page([
    carousel('重新聆听', Array.from({ length: 18 }, (_, index) => song(`song-${index}`)), {
      strapline: runs('根据你的喜好'), thumbnail: image('https://example.test/artist.jpg'),
      moreContentButton: { buttonRenderer: { navigationEndpoint: browse('FEmusic_library_landing', 'more+/=') } },
    }, { numItemsPerColumn: 4 }),
    carousel('为你精选', [playlist('mix')], {
      title: runs({ text: '为你精选', navigationEndpoint: browse('FEmusic_mixed_for_you', 'browse-mix') }),
      moreContentButton: { buttonRenderer: { command: { watchPlaylistEndpoint: {
        playlistId: 'RDCLAK-mix', params: 'play+/=', index: 0,
      } } } },
    }),
  ], { header: { chipCloudRenderer: { chips: [
    { chipCloudChipRenderer: { text: runs('专注'), isSelected: true,
      navigationEndpoint: browse('FEmusic_home', chipParams), onDeselectedCommand: browse('FEmusic_home', 'deselect+/=') } },
    { chipCloudChipRenderer: { onDeselectedCommand: browse('FEmusic_home', 'close') } },
  ] } } }));

  assert.deepEqual(result.chips, [{ title: '专注', selected: true,
    endpoint: { browseId: 'FEmusic_home', params: chipParams },
    deselectEndpoint: { browseId: 'FEmusic_home', params: 'deselect+/=' },
  }]);
  assert.equal(result.sections[0].items.length, 18);
  assert.equal(result.sections[0].label, '根据你的喜好');
  assert.equal(result.sections[0].thumbnail, 'https://example.test/artist.jpg');
  assert.equal(result.sections[0].layout, 'list');
  assert.equal(result.sections[0].rows, 4);
  assert.deepEqual(result.sections[0].endpoint, { browseId: 'FEmusic_library_landing', params: 'more+/=' });
  assert.equal(result.sections[0].playEndpoint, undefined);
  assert.equal(result.sections[1].layout, 'cards');
  assert.deepEqual(result.sections[1].endpoint, { browseId: 'FEmusic_mixed_for_you', params: 'browse-mix' });
  assert.deepEqual(result.sections[1].playEndpoint, { playlistId: 'RDCLAK-mix', params: 'play+/=', index: 0 });
});

test('a Home chip filters browse in place with the original opaque params', async () => {
  const requests = [];
  const params = 'ggNC+/focus%3D';
  const result = await request(`home?id=FEmusic_home&params=${encodeURIComponent(params)}`,
    page([carousel('专注音乐', [playlist('focus')])]), requests);
  assert.equal(new URL(requests[0].url).pathname, '/youtubei/v1/browse');
  assert.equal(requests[0].body.browseId, 'FEmusic_home');
  assert.equal(requests[0].body.params, params);
  assert.equal(requests[0].body.query, undefined);
  assert.equal(result.sections[0].title, '专注音乐');
});

test('Home pagination uses the page cursor rather than a nested shelf cursor and retains its visitor', async () => {
  const first = await request('home', page([
    carousel('第一页', [playlist('one')], {}, {
      continuations: [{ nextContinuationData: { continuation: 'shelf-only' } }],
    }),
  ], { continuations: [{ nextContinuationData: { continuation: 'home-page-two' } }] }));
  assert.deepEqual(JSON.parse(atob(first.continuation.slice(4))), { token: 'home-page-two', visitorData: 'home-visitor' });

  const requests = [];
  const next = await request(`home?params=selected-chip&continuation=${encodeURIComponent(first.continuation)}`, {
    continuationContents: { sectionListContinuation: {
      contents: [carousel('第二页', [playlist('two')])],
      continuations: [{ nextContinuationData: { continuation: 'home-page-three' } }],
    } },
  }, requests);
  assert.equal(requests[0].body.continuation, 'home-page-two');
  assert.equal(requests[0].body.browseId, undefined);
  assert.equal(requests[0].body.params, undefined);
  assert.equal(requests[0].body.context.client.visitorData, 'home-visitor');
  assert.equal(requests[0].headers['X-Goog-Visitor-Id'], 'home-visitor');
  assert.deepEqual(next.chips, []);
  assert.equal(next.sections[0].title, '第二页');
  assert.deepEqual(JSON.parse(atob(next.continuation.slice(4))), { token: 'home-page-three', visitorData: 'home-visitor' });

  const last = await request(`home?continuation=${encodeURIComponent(next.continuation)}`, {
    continuationContents: { sectionListContinuation: { contents: [carousel('最后一页', [playlist('three')], {}, {
      continuations: [{ nextContinuationData: { continuation: 'another-shelf-only' } }],
    })] } },
  });
  assert.equal(last.continuation, undefined);
});

test('mood shelves keep their group titles and real browse commands across Home, Explore and Browse', async () => {
  const mood = (title, params, color) => ({ musicNavigationButtonRenderer: {
    buttonText: runs(title), clickCommand: browse('FEmusic_moods_and_genres_category', params), solid: { leftStripeColor: color },
  } });
  const response = page([
    { gridRenderer: { header: { gridHeaderRenderer: { title: runs('心情') } }, items: [mood('专注', 'focus+/=', 0xff12ab34)] } },
    { gridRenderer: { header: { gridHeaderRenderer: { title: runs('流派') } }, items: [mood('爵士', 'jazz+/=', 0xff543210)] } },
  ]);
  const home = await request('home', response);
  assert.deepEqual(home.sections.map(section => section.title), ['心情', '流派']);
  assert.equal(home.sections[0].layout, 'grid');
  assert.deepEqual(home.sections[0].items, []);
  assert.deepEqual(home.sections[0].moods, [{ title: '专注', browseId: 'FEmusic_moods_and_genres_category', params: 'focus+/=', color: '#12ab34' }]);
  const explore = await request('explore?tab=moods', response);
  assert.deepEqual(explore.sections, home.sections);
  assert.deepEqual(explore.moods.map(item => item.title), ['专注', '爵士']);

  const requests = [];
  const detail = await request('browse?id=FEmusic_moods_and_genres_category&params=focus%2B%2F%3D',
    page([carousel('适合专注时听', [playlist('focus')])]), requests);
  assert.equal(requests[0].body.browseId, 'FEmusic_moods_and_genres_category');
  assert.equal(requests[0].body.params, 'focus+/=');
  assert.equal(detail.params, 'focus+/=');
  assert.equal(detail.sections[0].items[0].id, 'VLfocus');
});

test('immersive shelves and podcast episode rows retain playable identity instead of becoming collections', () => {
  const podcast = { text: '节目名称', navigationEndpoint: browse('MPSP-show', undefined, 'MUSIC_PAGE_TYPE_PODCAST_SHOW_DETAIL_PAGE') };
  const episode = { musicTwoRowItemRenderer: {
    title: runs('节目第一集'), subtitle: runs(podcast, ' • ', '2 weeks ago', ' • ', '32:10'),
    navigationEndpoint: browse('MPEP-episode', undefined, 'MUSIC_PAGE_TYPE_NON_MUSIC_AUDIO_TRACK_PAGE'),
    thumbnailRenderer: image('https://example.test/episode.jpg'),
    thumbnailOverlay: { musicItemThumbnailOverlayRenderer: { content: { musicPlayButtonRenderer: {
      playNavigationEndpoint: { watchEndpoint: { videoId: 'episode-one' } },
    } } } },
  } };
  const second = { musicMultiRowListItemRenderer: {
    title: runs('节目第二集'), subtitle: runs('Yesterday', ' • ', '1:02:03'), secondarySubtitle: runs(podcast),
    thumbnail: image('https://example.test/second.jpg'), onTap: { watchEndpoint: { videoId: 'episode-two' } },
  } };
  const shelf = sections({ musicImmersiveCarouselShelfRenderer: {
    header: { musicCarouselShelfBasicHeaderRenderer: { title: runs('最近更新') } }, contents: [episode, second],
  } })[0];
  assert.equal(shelf.title, '最近更新');
  assert.equal(shelf.layout, 'cards');
  assert.deepEqual(shelf.items.map(item => [item.id, item.source, item.duration]), [
    ['episode-one', 'youtube', 1930], ['episode-two', 'youtube', 3723],
  ]);
  assert.deepEqual(shelf.items.map(item => [item.artist, item.albumId]), [['节目名称', 'MPSP-show'], ['节目名称', 'MPSP-show']]);
  const withoutByline = structuredClone(second);
  delete withoutByline.musicMultiRowListItemRenderer.secondarySubtitle;
  assert.equal(items(withoutByline)[0].artist, '');
});

test('track thumbnail proportions come from the renderer enum or image dimensions, not URL names', () => {
  const video = { musicTwoRowItemRenderer: {
    title: runs('音乐视频'), navigationEndpoint: { watchEndpoint: { videoId: 'video' } },
    aspectRatio: 'MUSIC_TWO_ROW_ITEM_THUMBNAIL_ASPECT_RATIO_RECTANGLE_16_9',
    thumbnailRenderer: image('https://example.test/image.jpg'),
  } };
  assert.equal(items(video)[0].thumbnailAspectRatio, 16 / 9);
  const episode = { musicMultiRowListItemRenderer: {
    title: runs('视频节目'), onTap: { watchEndpoint: { videoId: 'episode' } },
    thumbnail: { thumbnails: [{ url: 'https://example.test/image.jpg', width: 800, height: 450 }] },
  } };
  assert.equal(items(episode)[0].thumbnailAspectRatio, 16 / 9);
  const unknown = structuredClone(video);
  delete unknown.musicTwoRowItemRenderer.aspectRatio;
  unknown.musicTwoRowItemRenderer.thumbnailRenderer = image('https://i.ytimg.com/vi/video/hq720.jpg');
  assert.equal(items(unknown)[0].thumbnailAspectRatio, undefined);
});

test('playlist Play All resolves the real next endpoint with params and a zero index, without a synthetic seed', async () => {
  const requests = [];
  const result = await request('next?playlistId=RDCLAK-mix&params=play%2B%2F%3D&index=0', {
    contents: { playlistPanelRenderer: { contents: [{ playlistPanelVideoRenderer: {
      videoId: 'selected', title: runs('完整播放队列'), lengthText: runs('3:20'), selected: true,
    } }] } },
  }, requests);
  assert.equal(new URL(requests[0].url).pathname, '/youtubei/v1/next');
  assert.equal(requests[0].body.playlistId, 'RDCLAK-mix');
  assert.equal(requests[0].body.videoId, undefined);
  assert.equal(requests[0].body.params, 'play+/=');
  assert.equal(requests[0].body.index, 0);
  assert.equal(result.currentIndex, 0);
  assert.equal(result.tracks[0].id, 'selected');
});

test('endpoint queues preserve duplicate occurrences, selected-row position and radio continuations', async () => {
  const row = (id, selected = false) => ({ playlistPanelVideoRenderer: { videoId: id, title: runs(id), selected } });
  const first = await request('next?playlistId=PL-repeat&index=4', {
    responseContext: { visitorData: 'queue-visitor' },
    contents: { playlistPanelRenderer: {
      contents: [row('same'), { automixPreviewVideoRenderer: {} }, row('middle'), row('same', true)],
      continuations: [{ nextRadioContinuationData: { continuation: 'queue-page-two' } }],
    } },
  });
  assert.deepEqual(first.tracks.map(track => track.id), ['same', 'middle', 'same']);
  assert.equal(first.currentIndex, 2);
  assert.deepEqual(JSON.parse(atob(first.continuation.slice(4))), { token: 'queue-page-two', visitorData: 'queue-visitor' });
  const requests = [];
  const more = await request(`next?playlistId=PL-repeat&continuation=${encodeURIComponent(first.continuation)}`, {
    continuationContents: { playlistPanelContinuation: {
      contents: [row('tail')], continuations: [{ nextRadioContinuationData: { continuation: 'queue-page-three' } }],
    } },
  }, requests);
  assert.equal(requests[0].body.continuation, 'queue-page-two');
  assert.equal(requests[0].headers['X-Goog-Visitor-Id'], 'queue-visitor');
  assert.deepEqual(more.tracks.map(track => track.id), ['tail']);
  assert.deepEqual(JSON.parse(atob(more.continuation.slice(4))), { token: 'queue-page-three', visitorData: 'queue-visitor' });
});

test('song radio keeps its existing seed and explicit endpoint queues preserve playlist and index', async () => {
  const requests = [];
  await request('next?id=song', {}, requests);
  await request('next?id=song&playlistId=PL-real&params=selected&index=2', {}, requests);
  assert.equal(requests[0].body.videoId, 'song');
  assert.equal(requests[0].body.playlistId, 'RDAMVMsong');
  assert.equal(requests[1].body.videoId, 'song');
  assert.equal(requests[1].body.playlistId, 'PL-real');
  assert.equal(requests[1].body.params, 'selected');
  assert.equal(requests[1].body.index, 2);
});
