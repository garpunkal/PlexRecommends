import type { ArtistRecommendation } from '../types/recommendations';

interface SpotifyToken {
	accessToken: string;
	expiresAt: number;
}

const SPOTIFY_API_ROOT = 'https://api.spotify.com/v1/';
const relatedArtistCache = new Map<string, Promise<ArtistRecommendation[]>>();

let tokenCache: SpotifyToken | null = null;

function getSpotifyCredentials() {
	const clientId = import.meta.env.SPOTIFY_CLIENT_ID?.trim();
	const clientSecret = import.meta.env.SPOTIFY_CLIENT_SECRET?.trim();

	if (!clientId || !clientSecret) {
		return null;
	}

	return { clientId, clientSecret };
}

function getCacheKey(value: string): string {
	return value.trim().toLowerCase();
}

async function getSpotifyAccessToken(): Promise<string | null> {
	const credentials = getSpotifyCredentials();

	if (!credentials) {
		return null;
	}

	if (tokenCache && tokenCache.expiresAt > Date.now() + 30_000) {
		return tokenCache.accessToken;
	}

	const response = await fetch('https://accounts.spotify.com/api/token', {
		method: 'POST',
		headers: {
			Authorization: `Basic ${btoa(`${credentials.clientId}:${credentials.clientSecret}`)}`,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams({
			grant_type: 'client_credentials',
		}),
	});

	if (!response.ok) {
		throw new Error(`Spotify token request failed with ${response.status} ${response.statusText}.`);
	}

	const payload = (await response.json()) as {
		access_token: string;
		expires_in: number;
	};

	tokenCache = {
		accessToken: payload.access_token,
		expiresAt: Date.now() + payload.expires_in * 1000,
	};

	return tokenCache.accessToken;
}

async function fetchSpotify(path: string, searchParams: Record<string, string> = {}): Promise<unknown> {
	const token = await getSpotifyAccessToken();

	if (!token) {
		return null;
	}

	const url = new URL(path, SPOTIFY_API_ROOT);

	for (const [key, value] of Object.entries(searchParams)) {
		url.searchParams.set(key, value);
	}

	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${token}`,
		},
	});

	if (!response.ok) {
		throw new Error(`Spotify request failed with ${response.status} ${response.statusText}.`);
	}

	return response.json();
}

function chooseSpotifyImage(images: Array<{ url?: string }> | undefined): string | undefined {
	return images?.[0]?.url;
}

export function getRelatedArtists(artistName: string): Promise<ArtistRecommendation[]> {
	const cacheKey = getCacheKey(artistName);

	if (!relatedArtistCache.has(cacheKey)) {
		relatedArtistCache.set(
			cacheKey,
			(async () => {
				const searchPayload = (await fetchSpotify('search', {
					q: artistName,
					type: 'artist',
					limit: '1',
				})) as
					| {
							artists?: {
								items?: Array<{ id?: string }>;
							};
					  }
					| null;

				const artistId = searchPayload?.artists?.items?.[0]?.id;

				if (!artistId) {
					return [];
				}

				const relatedPayload = (await fetchSpotify(`artists/${artistId}/related-artists`)) as {
					artists?: Array<{
						id?: string;
						name?: string;
						images?: Array<{ url?: string }>;
						genres?: string[];
					}>;
				};

				const recommendations: ArtistRecommendation[] = [];

				for (const artist of relatedPayload.artists ?? []) {
					const name = artist.name?.trim();

					if (!name) {
						continue;
					}

					recommendations.push({
						kind: 'artist',
						name,
						score: 0,
						sources: ['spotify'],
						imageUrl: chooseSpotifyImage(artist.images),
						tags: artist.genres ?? [],
						spotifyId: artist.id,
					});
				}

				return recommendations;
			})(),
		);
	}

	return relatedArtistCache.get(cacheKey)!;
}
