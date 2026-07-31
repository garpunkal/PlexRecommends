# PlexRecommends

PlexRecommends is an Astro SSR app that connects to a local Plex Media Server, reads your music library, and surfaces related artist and album recommendations from Last.fm, MusicBrainz, and Spotify.

## Stack

- Astro in SSR mode with the Node adapter
- Tailwind CSS v4
- Strict TypeScript
- Plex XML API integration via `fast-xml-parser`

## Getting started

1. Copy the example environment file:

   ```sh
   copy .env.example .env
   ```

2. Fill in the required Plex and Last.fm credentials in `.env`.
3. Install dependencies and start the app:

   ```sh
   npm install
   npm run dev
   ```

4. Open `http://localhost:4321`.

## Environment variables

```env
PLEX_URL=http://192.168.1.x:32400
PLEX_TOKEN=your_plex_token_here
LASTFM_API_KEY=your_lastfm_api_key
SPOTIFY_CLIENT_ID=optional
SPOTIFY_CLIENT_SECRET=optional
```

## How to get a Plex token

1. Sign in to Plex in your browser.
2. Open your Plex server web app and inspect any authenticated request for the `X-Plex-Token` query parameter.
3. Or browse to **Settings > Account > Authorized Devices** and use a device session token from an active authenticated session.
4. Paste the token value into `PLEX_TOKEN`.

## How to get a Last.fm API key

1. Go to the [Last.fm API account page](https://www.last.fm/api/account/create).
2. Create an API application.
3. Copy the generated API key into `LASTFM_API_KEY`.

## How to set up Spotify credentials (optional)

1. Open the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Create an app.
3. Copy the client ID and client secret into `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`.
4. The app uses the client credentials flow, so no user login or redirect URI is required.

If Spotify credentials are omitted, Spotify recommendations are skipped automatically.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local development server |
| `npm run build` | Build the SSR app |
| `npm run preview` | Preview the production build locally |
| `npm run check` | Run `astro check` |
| `npm run start` | Run the built standalone Node server |

## Project structure

```text
src/
  components/
    AlbumCard.astro
    ArtistCard.astro
    Header.astro
    LibraryGrid.astro
    RecommendationPanel.astro
  lib/
    lastfm.ts
    musicbrainz.ts
    plex.ts
    recommendations.ts
    spotify.ts
  pages/
    album/[id].astro
    artist/[id].astro
    index.astro
  styles/
    global.css
  types/
    plex.ts
    recommendations.ts
  env.d.ts
```

## Notes

- Plex artwork and metadata are fetched server-side from your local Plex instance.
- Artist recommendations merge data from Last.fm, MusicBrainz, and Spotify with source attribution.
- Album recommendations blend Last.fm tag discovery with MusicBrainz artist relationships.
