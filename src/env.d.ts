/// <reference types="astro/client" />

interface ImportMetaEnv {
	readonly PLEX_URL: string;
	readonly PLEX_TOKEN: string;
	readonly LASTFM_API_KEY: string;
	readonly SPOTIFY_CLIENT_ID?: string;
	readonly SPOTIFY_CLIENT_SECRET?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
