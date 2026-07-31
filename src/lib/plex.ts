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

/** Named entity table covering everything Plex is known to embed in text fields. */
const HTML_NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: '\u00a0',
};

/**
 * Decodes HTML/XML character references and named entities in a string so
 * Plex text fields (summary, title, artist name) render correctly in the UI.
 *
 * Handles:
 *   - Hex numeric refs:     &#xD; &#xA; &#x27; …
 *   - Decimal numeric refs: &#13; &#10; &#39; …
 *   - Named entities:       &amp; &lt; &gt; &quot; &apos; &nbsp;
 *   - CRLF normalisation:   &#xD;&#xA; / \r\n / \r → \n
 *
 * Does NOT alter structural values (ids, paths, dates).
 */
function decodeHtmlEntities(value: string): string {
	return value
		// Hex numeric references first so &#xD;&#xA; becomes \r\n before CRLF normalisation.
		.replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
		// Decimal numeric references.
		.replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
		// Named entities.
		.replace(/&([a-zA-Z]+);/g, (match, name: string) => HTML_NAMED_ENTITIES[name.toLowerCase()] ?? match)
		// Normalise all line-ending variants to LF, then trim surrounding whitespace.
		.replace(/\r\n|\r/g, '\n')
		.trim();
}

/**
 * Like asString, but additionally decodes HTML entities.
 * Use for human-readable display fields (title, name, summary).
 * Do NOT use for structural fields (ratingKey, thumb, art, dates).
 */
function asText(value: unknown): string | undefined {
	const raw = asString(value);
	return raw !== undefined ? decodeHtmlEntities(raw) : undefined;
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
	const name = asText(node.title);

	if (!id || !name) {
		throw new Error('Encountered an invalid Plex artist record.');
	}

	return {
		id,
		name,
		summary: asText(node.summary),
		thumbUrl: buildPlexAssetUrl(asString(node.thumb)),
		artUrl: buildPlexAssetUrl(asString(node.art)),
		albumCount: asNumber(node.childCount) ?? 0,
		librarySectionId: asString(node.librarySectionID),
	};
}

function parseAlbum(node: PlexNode): PlexAlbum {
	const id = asString(node.ratingKey);
	const title = asText(node.title);
	const artistId = asString(node.parentRatingKey) ?? asString(node.grandparentRatingKey);
	const artistName = asText(node.parentTitle) ?? asText(node.grandparentTitle);

	if (!id || !title || !artistId || !artistName) {
		throw new Error('Encountered an invalid Plex album record.');
	}

	return {
		id,
		title,
		artistId,
		artistName,
		year: asNumber(node.year),
		summary: asText(node.summary),
		thumbUrl: buildPlexAssetUrl(asString(node.thumb)),
		artUrl: buildPlexAssetUrl(asString(node.art) ?? asString(node.parentArt)),
		trackCount: asNumber(node.leafCount) ?? 0,
		originallyAvailableAt: asString(node.originallyAvailableAt),
		genres: parseGenres(node),
	};
}

/**
 * Like parseAlbum, but returns null for nodes that are missing required fields
 * (e.g. non-album children such as playlists or loose tracks) instead of throwing.
 */
function safeParseAlbum(node: PlexNode): PlexAlbum | null {
	try {
		return parseAlbum(node);
	} catch {
		return null;
	}
}

export interface GetArtistAlbumsResult {
	albums: PlexAlbum[];
	/** Number of child nodes that were skipped because they lacked required album fields. */
	skippedCount: number;
	/**
	 * Populated when albums is empty. Contains the artist id and the actual
	 * top-level keys returned by Plex so the caller can distinguish
	 * "Plex gave us nothing" from "Plex gave us something we couldn't parse".
	 */
	diagnosticMessage?: string;
}

/**
 * Collects every candidate album node from a Plex children container.
 *
 * Plex can return albums under `Metadata`, `Directory`, or (rarely) another key.
 * Strategy:
 *   1. Try the two known keys in order.
 *   2. If both are empty, scan every value in the container that is either
 *      an object array or a single object possessing a `ratingKey` attribute —
 *      those are album-like regardless of their XML element name.
 */
function collectAlbumCandidateNodes(container: PlexNode): { nodes: PlexNode[]; sourceKey: string } {
	// Well-known keys first.
	for (const key of ['Metadata', 'Directory']) {
		const nodes = toArray(container[key] as PlexNode | PlexNode[]);

		if (nodes.length > 0) {
			return { nodes, sourceKey: key };
		}
	}

	// Fallback: any container value that looks like an album (has ratingKey).
	const NON_CHILD_KEYS = new Set([
		'size', 'allowSync', 'art', 'identifier', 'key', 'librarySectionID',
		'librarySectionTitle', 'librarySectionUUID', 'mediaTagPrefix', 'mediaTagVersion',
		'nocache', 'parentIndex', 'parentTitle', 'parentYear', 'thumb', 'title1', 'title2',
		'viewGroup', 'viewMode',
	]);

	for (const [key, value] of Object.entries(container)) {
		if (NON_CHILD_KEYS.has(key)) {
			continue;
		}

		const candidates = toArray(value as PlexNode | PlexNode[]);

		if (candidates.length > 0 && candidates.every((c) => c && typeof c === 'object' && 'ratingKey' in c)) {
			return { nodes: candidates, sourceKey: key };
		}
	}

	return { nodes: [], sourceKey: '(none)' };
}

function parseTrack(node: PlexNode): PlexTrack {
	const id = asString(node.ratingKey);
	const title = asText(node.title);
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

/**
 * Injects container-level parent attributes into a child node as fallback values.
 *
 * Plex often puts parentRatingKey / parentTitle (and grandparent equivalents) on
 * the MediaContainer element rather than on each child node. Spreading them first
 * means the node's own attributes always win when present.
 */
function withContainerFallbacks(node: PlexNode, container: PlexNode): PlexNode {
	return {
		// Container-level breadcrumb attributes as fallbacks.
		parentRatingKey: container.parentRatingKey,
		parentTitle: container.parentTitle,
		grandparentRatingKey: container.grandparentRatingKey,
		grandparentTitle: container.grandparentTitle,
		// Node's own attributes take priority by spreading last.
		...node,
	};
}

export async function getArtistAlbums(artistId: string): Promise<GetArtistAlbumsResult> {
	const container = await fetchPlex(`/library/metadata/${encodeURIComponent(artistId)}/children`);

	// When child nodes are missing parentRatingKey / parentTitle, fall back to
	// the container's own attributes (which carry the parent artist's info) or
	// the artistId we already know.
	const containerWithArtistFallback: PlexNode = {
		...container,
		parentRatingKey: asString(container.parentRatingKey) ?? artistId,
	};

	const { nodes, sourceKey } = collectAlbumCandidateNodes(container);

	const albums: PlexAlbum[] = [];
	let skippedCount = 0;

	for (const node of nodes) {
		const album = safeParseAlbum(withContainerFallbacks(node, containerWithArtistFallback));

		if (album) {
			albums.push(album);
		} else {
			skippedCount += 1;
		}
	}

	albums.sort((left, right) => {
		const yearDelta = (right.year ?? 0) - (left.year ?? 0);
		return yearDelta === 0 ? left.title.localeCompare(right.title) : yearDelta;
	});

	if (albums.length === 0) {
		const containerKeys = Object.keys(container).join(', ') || '(empty)';
		const diagnosticMessage =
			skippedCount > 0
				? `Artist ${artistId}: Plex returned ${skippedCount} child node(s) under key "${sourceKey}" but none could be parsed as albums. Container keys: [${containerKeys}].`
				: `Artist ${artistId}: Plex returned no recognisable child nodes. Container keys: [${containerKeys}].`;

		return { albums, skippedCount, diagnosticMessage };
	}

	return { albums, skippedCount };
}

export async function getAlbum(albumId: string): Promise<PlexAlbum> {
	const container = await fetchPlex(`/library/metadata/${encodeURIComponent(albumId)}`);
	const albumNode = toArray((container.Metadata ?? container.Directory) as PlexNode | PlexNode[]).at(0);

	if (!albumNode) {
		throw new Error(`Album ${albumId} was not found in Plex.`);
	}

	return parseAlbum(withContainerFallbacks(albumNode, container));
}

export async function getAlbumTracks(albumId: string): Promise<PlexTrack[]> {
	const container = await fetchPlex(`/library/metadata/${encodeURIComponent(albumId)}/children`);
	// Plex returns tracks under Metadata, Track, or Video depending on server version.
	const nodes = toArray(
		(container.Metadata ?? container.Track ?? container.Video) as PlexNode | PlexNode[],
	);
	const tracks = nodes.map((node) => parseTrack(withContainerFallbacks(node, container)));

	return tracks.sort((left, right) => {
		const discDelta = (left.parentIndex ?? 0) - (right.parentIndex ?? 0);
		return discDelta === 0 ? left.index - right.index : discDelta;
	});
}
