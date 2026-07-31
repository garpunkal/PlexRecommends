const AMAZON_MUSIC_UK_SEARCH = 'https://music.amazon.co.uk/search/';

/**
 * Builds an Amazon Music UK search URL for an artist name.
 * Links to Amazon Music UK's search page, pre-filtered to the Artist entity type.
 */
export function amazonArtistUrl(artistName: string): string {
	const url = new URL(encodeURIComponent(artistName), AMAZON_MUSIC_UK_SEARCH);
	return url.toString();
}

/**
 * Builds an Amazon Music UK search URL for an album, combining the artist name
 * and album title for the best search match.
 */
export function amazonAlbumUrl(artistName: string, albumTitle: string): string {
	const query = `${artistName} ${albumTitle}`.trim();
	const url = new URL(encodeURIComponent(query), AMAZON_MUSIC_UK_SEARCH);
	return url.toString();
}
