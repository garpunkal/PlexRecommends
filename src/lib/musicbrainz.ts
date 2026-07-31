import type { AlbumRecommendation, ArtistRecommendation } from '../types/recommendations';

type MusicBrainzArtistRelation = {
	type?: string;
	artist?: {
		id?: string;
		name?: string;
		disambiguation?: string;
	};
};

const MUSICBRAINZ_ROOT = 'https://musicbrainz.org/ws/2/';
const USER_AGENT = 'PlexRecommends/0.1.0 (https://github.com/garpunkal/PlexRecommends)';
const relatedArtistCache = new Map<string, Promise<ArtistRecommendation[]>>();
const relatedAlbumCache = new Map<string, Promise<AlbumRecommendation[]>>();
const artistSearchCache = new Map<string, Promise<string | null>>();

let queue: Promise<void> = Promise.resolve();
let nextRequestAt = 0;

function sleep(milliseconds: number) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getCacheKey(value: string): string {
	return value.trim().toLowerCase();
}

async function scheduleMusicBrainzRequest<T>(task: () => Promise<T>): Promise<T> {
	const scheduled = queue.then(async () => {
		const waitTime = Math.max(0, nextRequestAt - Date.now());

		if (waitTime > 0) {
			await sleep(waitTime);
		}

		nextRequestAt = Date.now() + 1000;
	});

	queue = scheduled.then(
		() => undefined,
		() => undefined,
	);

	await scheduled;
	return task();
}

async function fetchMusicBrainz(path: string, searchParams: Record<string, string>): Promise<unknown> {
	const url = new URL(path, MUSICBRAINZ_ROOT);
	url.searchParams.set('fmt', 'json');

	for (const [key, value] of Object.entries(searchParams)) {
		url.searchParams.set(key, value);
	}

	return scheduleMusicBrainzRequest(async () => {
		const response = await fetch(url, {
			headers: {
				Accept: 'application/json',
				'User-Agent': USER_AGENT,
			},
		});

		if (!response.ok) {
			throw new Error(`MusicBrainz request failed with ${response.status} ${response.statusText}.`);
		}

		return response.json();
	});
}

function toArray<T>(value: T | T[] | undefined | null): T[] {
	if (value === undefined || value === null) {
		return [];
	}

	return Array.isArray(value) ? value : [value];
}

function getMusicallyRelevantRelations(relations: MusicBrainzArtistRelation[]) {
	const preferredTypes = new Set([
		'collaboration',
		'influenced by',
		'influencer',
		'member of band',
		'tribute',
		'subgroup',
		'supporting musician',
	]);

	const preferred = relations.filter((relation) => relation.type && preferredTypes.has(relation.type));
	return preferred.length > 0 ? preferred : relations.filter((relation) => relation.artist?.name);
}

async function searchArtistId(artistName: string): Promise<string | null> {
	const cacheKey = getCacheKey(artistName);

	if (!artistSearchCache.has(cacheKey)) {
		artistSearchCache.set(
			cacheKey,
			(async () => {
				const payload = (await fetchMusicBrainz('artist', {
					query: `artist:"${artistName}"`,
					limit: '1',
				})) as {
					artists?: Array<{ id?: string }>;
				};

				return payload.artists?.[0]?.id ?? null;
			})(),
		);
	}

	return artistSearchCache.get(cacheKey)!;
}

export function getRelatedArtists(artistName: string): Promise<ArtistRecommendation[]> {
	const cacheKey = getCacheKey(artistName);

	if (!relatedArtistCache.has(cacheKey)) {
		relatedArtistCache.set(
			cacheKey,
			(async () => {
				const artistId = await searchArtistId(artistName);

				if (!artistId) {
					return [];
				}

				const payload = (await fetchMusicBrainz(`artist/${artistId}`, {
					inc: 'artist-rels+tags',
				})) as {
					relations?: MusicBrainzArtistRelation[];
				};

				const recommendations: ArtistRecommendation[] = [];

				for (const relation of getMusicallyRelevantRelations(toArray(payload.relations))) {
					const relatedArtist = relation.artist;
					const name = relatedArtist?.name?.trim();

					if (!name) {
						continue;
					}

					recommendations.push({
						kind: 'artist',
						name,
						score: 0,
						sources: ['musicbrainz'],
						tags: relation.type ? [relation.type] : [],
						mbid: relatedArtist?.id,
					});
				}

				return recommendations;
			})(),
		);
	}

	return relatedArtistCache.get(cacheKey)!;
}

export function getRelatedAlbums(artistName: string): Promise<AlbumRecommendation[]> {
	const cacheKey = getCacheKey(artistName);

	if (!relatedAlbumCache.has(cacheKey)) {
		relatedAlbumCache.set(
			cacheKey,
			(async () => {
				const relatedArtists = await getRelatedArtists(artistName);
				const artistSeed = relatedArtists.slice(0, 4);

				const releases = await Promise.all(
					artistSeed.map(async (artist) => {
						const payload = (await fetchMusicBrainz('release-group', {
							query: `artist:"${artist.name}" AND primarytype:Album`,
							limit: '1',
						})) as {
							'release-groups'?: Array<{
								title?: string;
								'first-release-date'?: string;
								'primary-type'?: string;
							}>;
						};

						return {
							artistName: artist.name,
							releaseGroup: payload['release-groups']?.[0],
						};
					}),
				);

				const recommendations: AlbumRecommendation[] = [];

				for (const { artistName: relatedArtistName, releaseGroup } of releases) {
					const title = releaseGroup?.title?.trim();

					if (!title) {
						continue;
					}

					const tags = [releaseGroup?.['primary-type']].filter(
						(value): value is string => Boolean(value),
					);

					recommendations.push({
						kind: 'album',
						title,
						artistName: relatedArtistName,
						score: 0,
						sources: ['musicbrainz'],
						tags,
					});
				}

				return recommendations;
			})(),
		);
	}

	return relatedAlbumCache.get(cacheKey)!;
}
