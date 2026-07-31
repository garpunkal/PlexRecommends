export interface PlexArtist {
	id: string;
	name: string;
	summary?: string;
	thumbUrl?: string;
	artUrl?: string;
	albumCount: number;
	librarySectionId?: string;
}

export interface PlexAlbum {
	id: string;
	title: string;
	artistId: string;
	artistName: string;
	year?: number;
	summary?: string;
	thumbUrl?: string;
	artUrl?: string;
	trackCount: number;
	originallyAvailableAt?: string;
	genres: string[];
}

export interface PlexTrack {
	id: string;
	title: string;
	index: number;
	parentIndex?: number;
	durationMs?: number;
	originallyAvailableAt?: string;
}
