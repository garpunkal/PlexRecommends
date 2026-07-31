import { getAlbumInfo, getSimilarAlbumsFromTags, getSimilarArtists } from './lastfm';
import { getRelatedAlbums as getMusicBrainzRelatedAlbums, getRelatedArtists as getMusicBrainzRelatedArtists } from './musicbrainz';
import { getRelatedArtists as getSpotifyRelatedArtists } from './spotify';
import type { PlexAlbum, PlexArtist } from '../types/plex';
import type {
	AlbumRecommendation,
	ArtistRecommendation,
	RecommendationItem,
	RecommendationSource,
} from '../types/recommendations';

function normalizeKey(value: string): string {
	return value.trim().toLocaleLowerCase();
}

function mergeTags(current: string[], incoming: string[]): string[] {
	return Array.from(
		new Set(
			[...current, ...incoming]
				.map((tag) => tag.trim())
				.filter(Boolean),
		),
	).slice(0, 6);
}

function finalizeItem<T extends RecommendationItem>(item: T): T {
	const sources = Array.from(new Set(item.sources)).sort() as RecommendationSource[];
	const match = item.match ?? 0;

	return {
		...item,
		sources,
		score: Math.round((match + sources.length) * 100) / 100,
	} as T;
}

function sortRecommendations<T extends RecommendationItem>(left: T, right: T) {
	if (right.score !== left.score) {
		return right.score - left.score;
	}

	if (left.kind === 'artist' && right.kind === 'artist') {
		return left.name.localeCompare(right.name);
	}

	if (left.kind === 'album' && right.kind === 'album') {
		return `${left.artistName} ${left.title}`.localeCompare(`${right.artistName} ${right.title}`);
	}

	return 0;
}

function buildLibraryLookup(artists: PlexArtist[]) {
	return new Map(artists.map((artist) => [normalizeKey(artist.name), artist]));
}

export async function getArtistRecommendations(
	artist: PlexArtist,
	libraryArtists: PlexArtist[],
): Promise<ArtistRecommendation[]> {
	const results = await Promise.allSettled([
		getSimilarArtists(artist.name),
		getMusicBrainzRelatedArtists(artist.name),
		getSpotifyRelatedArtists(artist.name),
	]);

	const merged = new Map<string, ArtistRecommendation>();
	const libraryLookup = buildLibraryLookup(libraryArtists);
	const artistKey = normalizeKey(artist.name);
	const successfulResults = results.filter(
		(result): result is PromiseFulfilledResult<ArtistRecommendation[]> => result.status === 'fulfilled',
	);

	if (successfulResults.length === 0) {
		const reason = results.find((result) => result.status === 'rejected');
		throw new Error(
			reason?.status === 'rejected'
				? reason.reason instanceof Error
					? reason.reason.message
					: 'Unable to load artist recommendations.'
				: 'Unable to load artist recommendations.',
		);
	}

	for (const result of successfulResults) {
		for (const recommendation of result.value) {
			const key = normalizeKey(recommendation.name);

			if (key === artistKey) {
				continue;
			}

			const current = merged.get(key);

			if (!current) {
				merged.set(
					key,
					finalizeItem({
						...recommendation,
						plexArtistId: libraryLookup.get(key)?.id,
					}),
				);
				continue;
			}

			merged.set(
				key,
				finalizeItem({
					...current,
					match: Math.max(current.match ?? 0, recommendation.match ?? 0) || undefined,
					imageUrl: current.imageUrl ?? recommendation.imageUrl,
					tags: mergeTags(current.tags, recommendation.tags),
					sources: [...current.sources, ...recommendation.sources],
					mbid: current.mbid ?? recommendation.mbid,
					spotifyId: current.spotifyId ?? recommendation.spotifyId,
					plexArtistId: current.plexArtistId ?? libraryLookup.get(key)?.id,
				}),
			);
		}
	}

	return Array.from(merged.values()).sort(sortRecommendations).slice(0, 10);
}

export async function getAlbumRecommendations(album: PlexAlbum): Promise<AlbumRecommendation[]> {
	const results = await Promise.allSettled([
		getSimilarAlbumsFromTags(album.artistName, album.title),
		getMusicBrainzRelatedAlbums(album.artistName),
	]);

	const merged = new Map<string, AlbumRecommendation>();
	const albumKey = normalizeKey(`${album.artistName}::${album.title}`);
	const successfulResults = results.filter(
		(result): result is PromiseFulfilledResult<AlbumRecommendation[]> => result.status === 'fulfilled',
	);

	if (successfulResults.length === 0) {
		const reason = results.find((result) => result.status === 'rejected');
		throw new Error(
			reason?.status === 'rejected'
				? reason.reason instanceof Error
					? reason.reason.message
					: 'Unable to load album recommendations.'
				: 'Unable to load album recommendations.',
		);
	}

	for (const result of successfulResults) {
		for (const recommendation of result.value) {
			const key = normalizeKey(`${recommendation.artistName}::${recommendation.title}`);

			if (key === albumKey) {
				continue;
			}

			const current = merged.get(key);

			if (!current) {
				merged.set(key, finalizeItem(recommendation));
				continue;
			}

			merged.set(
				key,
				finalizeItem({
					...current,
					match: Math.max(current.match ?? 0, recommendation.match ?? 0) || undefined,
					imageUrl: current.imageUrl ?? recommendation.imageUrl,
					tags: mergeTags(current.tags, recommendation.tags),
					sources: [...current.sources, ...recommendation.sources],
				}),
			);
		}
	}

	return Array.from(merged.values()).sort(sortRecommendations).slice(0, 10);
}

export { getAlbumInfo };
