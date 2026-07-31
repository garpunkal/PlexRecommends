const AMAZON_MUSIC_UK_SEARCH = 'https://music.amazon.co.uk/search/';
const YOUTUBE_MUSIC_SEARCH = 'https://music.youtube.com/search';

/**
 * Builds an Amazon Music UK search URL for an artist name.
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

/**
 * Builds a YouTube Music search URL for an artist name.
 */
export function youtubeMusicArtistUrl(artistName: string): string {
	const url = new URL(YOUTUBE_MUSIC_SEARCH);
	url.searchParams.set('q', artistName);
	return url.toString();
}

/**
 * Builds a YouTube Music search URL for an album.
 */
export function youtubeMusicAlbumUrl(artistName: string, albumTitle: string): string {
	const url = new URL(YOUTUBE_MUSIC_SEARCH);
	url.searchParams.set('q', `${artistName} ${albumTitle}`.trim());
	return url.toString();
}
