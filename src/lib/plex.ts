import { XMLParser } from 'fast-xml-parser';
import type { PlexAlbum, PlexArtist, PlexTrack } from '../types/plex';

type PlexNode = Record<string, unknown>;

const parser = new XMLParser({
	attributeNamePrefix: '',
	ignoreAttributes: false,
	parseAttributeValue: true,
});

function getPlexConfig() {
	const plexUrl = import.meta.env.PLEX_URL?.trim();
	const plexToken = import.meta.env.PLEX_TOKEN?.trim();

	if (!plexUrl) {
		throw new Error('PLEX_URL is missing. Add it to your .env file.');
	}

	if (!plexToken) {
		throw new Error('PLEX_TOKEN is missing. Add it to your .env file.');
	}

	return { plexUrl, plexToken };
}

function toArray<T>(value: T | T[] | undefined | null): T[] {
	if (value === undefined || value === null) {
		return [];
	}

	return Array.isArray(value) ? value : [value];
}

function asString(value: unknown): string | undefined {
	if (typeof value === 'string' && value.trim()) {
		return value.trim();
	}

	if (typeof value === 'number') {
		return String(value);
	}

	return undefined;
}

function asNumber(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}

	if (typeof value === 'string' && value.trim()) {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}

	return undefined;
}

function getMediaContainer(parsed: unknown): PlexNode {
	if (!parsed || typeof parsed !== 'object' || !('MediaContainer' in parsed)) {
		throw new Error('Unexpected Plex XML response.');
	}

	const container = (parsed as { MediaContainer?: PlexNode }).MediaContainer;

	if (!container) {
		throw new Error('Unexpected Plex XML response.');
	}

	return container;
}

function buildPlexAssetUrl(assetPath: string | undefined): string | undefined {
	if (!assetPath) {
		return undefined;
	}

	const { plexUrl, plexToken } = getPlexConfig();
	const url = new URL(assetPath, plexUrl);
	url.searchParams.set('X-Plex-Token', plexToken);
	return url.toString();
}

async function fetchPlex(pathname: string): Promise<PlexNode> {
	const { plexUrl, plexToken } = getPlexConfig();
	const url = new URL(pathname, plexUrl);
	url.searchParams.set('X-Plex-Token', plexToken);

	const response = await fetch(url, {
		headers: {
			Accept: 'application/xml',
		},
	});

	if (!response.ok) {
		throw new Error(`Plex request failed with ${response.status} ${response.statusText}.`);
	}

	const rawXml = await response.text();
	return getMediaContainer(parser.parse(rawXml));
}

function parseGenres(node: PlexNode): string[] {
	return toArray(node.Genre as PlexNode | PlexNode[])
		.map((genre) => asString(genre.tag))
		.filter((value): value is string => Boolean(value));
}

function parseArtist(node: PlexNode): PlexArtist {
	const id = asString(node.ratingKey);
	const name = asString(node.title);

	if (!id || !name) {
		throw new Error('Encountered an invalid Plex artist record.');
	}

	return {
		id,
		name,
		summary: asString(node.summary),
		thumbUrl: buildPlexAssetUrl(asString(node.thumb)),
		artUrl: buildPlexAssetUrl(asString(node.art)),
		albumCount: asNumber(node.childCount) ?? 0,
		librarySectionId: asString(node.librarySectionID),
	};
}

function parseAlbum(node: PlexNode): PlexAlbum {
	const id = asString(node.ratingKey);
	const title = asString(node.title);
	const artistId = asString(node.parentRatingKey) ?? asString(node.grandparentRatingKey);
	const artistName = asString(node.parentTitle) ?? asString(node.grandparentTitle);

	if (!id || !title || !artistId || !artistName) {
		throw new Error('Encountered an invalid Plex album record.');
	}

	return {
		id,
		title,
		artistId,
		artistName,
		year: asNumber(node.year),
		summary: asString(node.summary),
		thumbUrl: buildPlexAssetUrl(asString(node.thumb)),
		artUrl: buildPlexAssetUrl(asString(node.art) ?? asString(node.parentArt)),
		trackCount: asNumber(node.leafCount) ?? 0,
		originallyAvailableAt: asString(node.originallyAvailableAt),
		genres: parseGenres(node),
	};
}

function parseTrack(node: PlexNode): PlexTrack {
	const id = asString(node.ratingKey);
	const title = asString(node.title);
	const index = asNumber(node.index);

	if (!id || !title || index === undefined) {
		throw new Error('Encountered an invalid Plex track record.');
	}

	return {
		id,
		title,
		index,
		parentIndex: asNumber(node.parentIndex),
		durationMs: asNumber(node.duration),
		originallyAvailableAt: asString(node.originallyAvailableAt),
	};
}

export async function getMusicSectionId(): Promise<string> {
	const container = await fetchPlex('/library/sections');
	const sections = toArray(container.Directory as PlexNode | PlexNode[]);
	const musicSection = sections.find((section) => asString(section.type) === 'artist');

	if (!musicSection) {
		throw new Error('No Plex music library section with type="artist" was found.');
	}

	const id = asString(musicSection.key);

	if (!id) {
		throw new Error('Plex music library section is missing its key.');
	}

	return id;
}

export async function getAllArtists(): Promise<PlexArtist[]> {
	const sectionId = await getMusicSectionId();
	const container = await fetchPlex(`/library/sections/${sectionId}/all?type=8`);
	const artists = toArray(container.Directory as PlexNode | PlexNode[]).map(parseArtist);
	return artists.sort((left, right) => left.name.localeCompare(right.name));
}

export async function getArtist(artistId: string): Promise<PlexArtist> {
	const container = await fetchPlex(`/library/metadata/${encodeURIComponent(artistId)}`);
	const artistNode = toArray((container.Metadata ?? container.Directory) as PlexNode | PlexNode[]).at(0);

	if (!artistNode) {
		throw new Error(`Artist ${artistId} was not found in Plex.`);
	}

	return parseArtist(artistNode);
}

export async function getArtistAlbums(artistId: string): Promise<PlexAlbum[]> {
	const container = await fetchPlex(`/library/metadata/${encodeURIComponent(artistId)}/children`);
	// Plex returns album children as Metadata on most servers but as Directory on others.
	const albums = toArray((container.Metadata ?? container.Directory) as PlexNode | PlexNode[]).map(parseAlbum);
	return albums.sort((left, right) => {
		const yearDelta = (right.year ?? 0) - (left.year ?? 0);
		return yearDelta === 0 ? left.title.localeCompare(right.title) : yearDelta;
	});
}

export async function getAlbum(albumId: string): Promise<PlexAlbum> {
	const container = await fetchPlex(`/library/metadata/${encodeURIComponent(albumId)}`);
	const albumNode = toArray(container.Metadata as PlexNode | PlexNode[]).at(0);

	if (!albumNode) {
		throw new Error(`Album ${albumId} was not found in Plex.`);
	}

	return parseAlbum(albumNode);
}

export async function getAlbumTracks(albumId: string): Promise<PlexTrack[]> {
	const container = await fetchPlex(`/library/metadata/${encodeURIComponent(albumId)}/children`);
	const tracks = toArray((container.Metadata ?? container.Track) as PlexNode | PlexNode[]).map(parseTrack);

	return tracks.sort((left, right) => {
		const discDelta = (left.parentIndex ?? 0) - (right.parentIndex ?? 0);
		return discDelta === 0 ? left.index - right.index : discDelta;
	});
}
