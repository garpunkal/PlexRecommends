export type RecommendationSource = 'lastfm' | 'musicbrainz' | 'spotify';

export interface ArtistRecommendation {
	kind: 'artist';
	name: string;
	score: number;
	sources: RecommendationSource[];
	match?: number;
	imageUrl?: string;
	tags: string[];
	mbid?: string;
	spotifyId?: string;
	plexArtistId?: string;
}

export interface AlbumRecommendation {
	kind: 'album';
	title: string;
	artistName: string;
	score: number;
	sources: RecommendationSource[];
	match?: number;
	imageUrl?: string;
	tags: string[];
}

export type RecommendationItem = ArtistRecommendation | AlbumRecommendation;
