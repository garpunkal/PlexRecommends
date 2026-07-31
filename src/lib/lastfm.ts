import type { AlbumRecommendation, ArtistRecommendation } from '../types/recommendations';

interface LastFmAlbumInfo {
	imageUrl?: string;
	tags: string[];
}

const LASTFM_API_ROOT = 'https://ws.audioscrobbler.com/2.0/';
const similarArtistCache = new Map<string, Promise<ArtistRecommendation[]>>();
const artistInfoCache = new Map<string, Promise<{ imageUrl?: string; tags: string[] }>>();
const albumInfoCache = new Map<string, Promise<LastFmAlbumInfo>>();
const similarAlbumCache = new Map<string, Promise<AlbumRecommendation[]>>();

function getLastFmApiKey(): string {
	const apiKey = import.meta.env.LASTFM_API_KEY?.trim();

	if (!apiKey) {
		throw new Error('LASTFM_API_KEY is missing. Add it to your .env file.');
	}

	return apiKey;
}

function getCacheKey(...parts: string[]): string {
	return parts.map((part) => part.trim().toLowerCase()).join('::');
}

function toArray<T>(value: T | T[] | undefined | null): T[] {
	if (value === undefined || value === null) {
		return [];
	}

	return Array.isArray(value) ? value : [value];
}

function toMatchPercentage(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return Math.round(value * 10000) / 100;
	}

	if (typeof value === 'string' && value.trim()) {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? Math.round(parsed * 10000) / 100 : undefined;
	}

	return undefined;
}

function largestLastFmImage(imageList: unknown): string | undefined {
	const images = toArray(imageList as Array<{ '#text'?: string }>);

	for (const image of [...images].reverse()) {
		if (typeof image?.['#text'] === 'string' && image['#text'].trim()) {
			return image['#text'].trim();
		}
	}

	return undefined;
}

async function fetchLastFm(method: string, params: Record<string, string>): Promise<unknown> {
	const apiKey = getLastFmApiKey();
	const url = new URL(LASTFM_API_ROOT);

	url.searchParams.set('method', method);
	url.searchParams.set('api_key', apiKey);
	url.searchParams.set('format', 'json');

	for (const [key, value] of Object.entries(params)) {
		url.searchParams.set(key, value);
	}

	const response = await fetch(url);

	if (!response.ok) {
		throw new Error(`Last.fm request failed with ${response.status} ${response.statusText}.`);
	}

	return response.json();
}

export function getArtistInfo(artistName: string): Promise<{ imageUrl?: string; tags: string[] }> {
	const cacheKey = getCacheKey('artist-info', artistName);

	if (!artistInfoCache.has(cacheKey)) {
		artistInfoCache.set(
			cacheKey,
			(async () => {
				const payload = (await fetchLastFm('artist.getInfo', {
					artist: artistName,
					autocorrect: '1',
				})) as {
					artist?: {
						image?: Array<{ '#text'?: string }>;
						tags?: { tag?: Array<{ name?: string }> };
					};
				};

				const tags = toArray(payload.artist?.tags?.tag)
					.map((tag) => tag.name?.trim())
					.filter((tag): tag is string => Boolean(tag));

				return {
					imageUrl: largestLastFmImage(payload.artist?.image),
					tags,
				};
			})(),
		);
	}

	return artistInfoCache.get(cacheKey)!;
}

export function getSimilarArtists(artistName: string): Promise<ArtistRecommendation[]> {
	const cacheKey = getCacheKey(artistName);

	if (!similarArtistCache.has(cacheKey)) {
		similarArtistCache.set(
			cacheKey,
			(async () => {
				const payload = (await fetchLastFm('artist.getSimilar', {
					artist: artistName,
					limit: '12',
					autocorrect: '1',
				})) as {
					similarartists?: {
						artist?: Array<{
							name?: string;
							match?: string;
							image?: Array<{ '#text'?: string }>;
						}>;
					};
				};

				const recommendations: ArtistRecommendation[] = [];

				for (const artist of toArray(payload.similarartists?.artist)) {
					const name = artist.name?.trim();

					if (!name) {
						continue;
					}

					recommendations.push({
						kind: 'artist',
						name,
						score: 0,
						match: toMatchPercentage(artist.match),
						imageUrl: largestLastFmImage(artist.image),
						sources: ['lastfm'],
						tags: [],
					});
				}

				return recommendations;
			})(),
		);
	}

	return similarArtistCache.get(cacheKey)!;
}

export function getAlbumInfo(artistName: string, albumTitle: string): Promise<LastFmAlbumInfo> {
	const cacheKey = getCacheKey(artistName, albumTitle);

	if (!albumInfoCache.has(cacheKey)) {
		albumInfoCache.set(
			cacheKey,
			(async () => {
				const payload = (await fetchLastFm('album.getInfo', {
					artist: artistName,
					album: albumTitle,
					autocorrect: '1',
				})) as {
					album?: {
						image?: Array<{ '#text'?: string }>;
						tags?: { tag?: Array<{ name?: string }> };
					};
				};

				const tags = toArray(payload.album?.tags?.tag)
					.map((tag) => tag.name?.trim())
					.filter((tag): tag is string => Boolean(tag));

				return {
					imageUrl: largestLastFmImage(payload.album?.image),
					tags,
				};
			})(),
		);
	}

	return albumInfoCache.get(cacheKey)!;
}

export function getSimilarAlbumsFromTags(
	artistName: string,
	albumTitle: string,
): Promise<AlbumRecommendation[]> {
	const cacheKey = getCacheKey(artistName, albumTitle);

	if (!similarAlbumCache.has(cacheKey)) {
		similarAlbumCache.set(
			cacheKey,
			(async () => {
				const albumInfo = await getAlbumInfo(artistName, albumTitle);
				const tags = albumInfo.tags.slice(0, 3);

				if (tags.length === 0) {
					return [];
				}

				const responses = await Promise.all(
					tags.map((tag) =>
						fetchLastFm('tag.getTopAlbums', {
							tag,
							limit: '6',
						}).then((payload) => ({ tag, payload })),
					),
				);

				const results: AlbumRecommendation[] = [];

				for (const [tagIndex, response] of responses.entries()) {
					const payload = response.payload as {
						albums?: {
							album?: Array<{
								name?: string;
								artist?: { name?: string };
								image?: Array<{ '#text'?: string }>;
							}>;
						};
					};

					for (const [albumIndex, album] of toArray(payload.albums?.album).entries()) {
						const title = album.name?.trim();
						const relatedArtistName = album.artist?.name?.trim();

						if (!title || !relatedArtistName) {
							continue;
						}

						results.push({
							kind: 'album',
							title,
							artistName: relatedArtistName,
							score: 0,
							match: Math.max(20, 100 - albumIndex * 10 - tagIndex * 8),
							imageUrl: largestLastFmImage(album.image),
							sources: ['lastfm'],
							tags: [response.tag],
						});
					}
				}

				return results;
			})(),
		);
	}

	return similarAlbumCache.get(cacheKey)!;
}

const topChartArtistsCache = new Map<string, Promise<string[]>>();

/**
 * Returns the top N Last.fm chart artists for a given period.
 * Used as discovery seeds for the /discover page.
 */
export function getTopChartArtists(limit = 10): Promise<string[]> {
	const cacheKey = getCacheKey('chart', String(limit));

	if (!topChartArtistsCache.has(cacheKey)) {
		topChartArtistsCache.set(
			cacheKey,
			(async () => {
				const payload = (await fetchLastFm('chart.getTopArtists', {
					limit: String(limit),
				})) as {
					artists?: {
						artist?: Array<{ name?: string }>;
					};
				};

				const names: string[] = [];

				for (const artist of toArray(payload.artists?.artist)) {
					const name = artist.name?.trim();

					if (name) {
						names.push(name);
					}
				}

				return names;
			})(),
		);
	}

	return topChartArtistsCache.get(cacheKey)!;
}
