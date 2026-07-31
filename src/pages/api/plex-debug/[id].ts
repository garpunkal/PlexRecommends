/**
 * Debug endpoint — returns a JSON snapshot of exactly what Plex sends back
 * for an artist's children request, plus what the parser does with it.
 *
 * Usage: GET /api/plex-debug/{artistId}
 * e.g.   /api/plex-debug/4302
 *
 * REMOVE THIS FILE before going to production.
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import { XMLParser } from 'fast-xml-parser';

export const GET: APIRoute = async ({ params }) => {
	const { id } = params;

	if (!id) {
		return new Response(JSON.stringify({ error: 'Missing artist id' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	const plexUrl = import.meta.env.PLEX_URL?.trim();
	const plexToken = import.meta.env.PLEX_TOKEN?.trim();

	if (!plexUrl || !plexToken) {
		return new Response(JSON.stringify({ error: 'PLEX_URL or PLEX_TOKEN not set' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	const url = new URL(`/library/metadata/${encodeURIComponent(id)}/children`, plexUrl);
	url.searchParams.set('X-Plex-Token', plexToken);

	let rawXml: string;
	let httpStatus: number;

	try {
		const response = await fetch(url, { headers: { Accept: 'application/xml' } });
		httpStatus = response.status;
		rawXml = await response.text();
	} catch (err) {
		return new Response(
			JSON.stringify({ error: 'Fetch failed', detail: String(err) }),
			{ status: 502, headers: { 'Content-Type': 'application/json' } },
		);
	}

	// Parse with the same options the app uses.
	const parser = new XMLParser({
		attributeNamePrefix: '',
		ignoreAttributes: false,
		parseAttributeValue: true,
	});

	let parsed: unknown;
	try {
		parsed = parser.parse(rawXml);
	} catch (err) {
		return new Response(
			JSON.stringify({ error: 'XML parse failed', detail: String(err), rawXmlHead: rawXml.slice(0, 500) }),
			{ status: 500, headers: { 'Content-Type': 'application/json' } },
		);
	}

	// Extract the container.
	const container =
		parsed && typeof parsed === 'object' && 'MediaContainer' in parsed
			? (parsed as Record<string, unknown>).MediaContainer
			: null;

	if (!container || typeof container !== 'object') {
		return new Response(
			JSON.stringify({ error: 'No MediaContainer in response', rawXmlHead: rawXml.slice(0, 500) }),
			{ status: 500, headers: { 'Content-Type': 'application/json' } },
		);
	}

	const containerObj = container as Record<string, unknown>;
	const containerKeys = Object.keys(containerObj);

	// Collect candidate nodes the same way the app does.
	function toArr(v: unknown): unknown[] {
		if (v === undefined || v === null) return [];
		return Array.isArray(v) ? v : [v];
	}

	let candidateKey = '(none)';
	let candidateNodes: unknown[] = [];

	for (const key of ['Metadata', 'Directory']) {
		const nodes = toArr(containerObj[key]);
		if (nodes.length > 0) {
			candidateKey = key;
			candidateNodes = nodes;
			break;
		}
	}

	if (candidateNodes.length === 0) {
		for (const [key, value] of Object.entries(containerObj)) {
			const candidates = toArr(value);
			if (
				candidates.length > 0 &&
				candidates.every((c) => c && typeof c === 'object' && 'ratingKey' in (c as object))
			) {
				candidateKey = key;
				candidateNodes = candidates;
				break;
			}
		}
	}

	// Show the first 3 candidate nodes and which fields are present/missing.
	const nodeSnapshots = candidateNodes.slice(0, 3).map((node) => {
		if (!node || typeof node !== 'object') return { error: 'not an object', value: node };
		const n = node as Record<string, unknown>;
		return {
			keys: Object.keys(n),
			ratingKey: n.ratingKey,
			title: n.title,
			type: n.type,
			parentRatingKey: n.parentRatingKey,
			parentTitle: n.parentTitle,
			grandparentRatingKey: n.grandparentRatingKey,
			grandparentTitle: n.grandparentTitle,
			year: n.year,
		};
	});

	// Container-level parent attributes.
	const containerParentFields = {
		parentRatingKey: containerObj.parentRatingKey,
		parentTitle: containerObj.parentTitle,
		grandparentRatingKey: containerObj.grandparentRatingKey,
		grandparentTitle: containerObj.grandparentTitle,
		title1: containerObj.title1,
		title2: containerObj.title2,
		key: containerObj.key,
		size: containerObj.size,
	};

	return new Response(
		JSON.stringify(
			{
				httpStatus,
				artistId: id,
				containerKeys,
				containerParentFields,
				candidateKey,
				candidateCount: candidateNodes.length,
				nodeSnapshots,
				rawXmlHead: rawXml.slice(0, 1000),
			},
			null,
			2,
		),
		{ status: 200, headers: { 'Content-Type': 'application/json' } },
	);
};
