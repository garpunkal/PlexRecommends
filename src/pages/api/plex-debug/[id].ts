export const prerender = false;
import type { APIRoute } from "astro";
import { XMLParser } from "fast-xml-parser";
const parser = new XMLParser({ attributeNamePrefix: "", ignoreAttributes: false, parseAttributeValue: false });
function toArr(v: unknown): unknown[] { if (v == null) return []; return Array.isArray(v) ? v : [v]; }
function snap(nodes: unknown[]) { return nodes.slice(0, 3).map((n) => { if (!n || typeof n !== "object") return { error: "not an object" }; const node = n as Record<string, unknown>; return { keys: Object.keys(node), ratingKey: node.ratingKey, title: node.title, type: node.type, parentRatingKey: node.parentRatingKey, parentTitle: node.parentTitle, year: node.year }; }); }
async function fx(pu: string, pt: string, path: string) { const u = new URL(path, pu); u.searchParams.set("X-Plex-Token", pt); const r = await fetch(u, { headers: { Accept: "application/xml" } }); const xml = await r.text(); const p = parser.parse(xml) as Record<string, unknown>; const c = (p.MediaContainer as Record<string, unknown>) ?? {}; return { status: r.status, container: c, rawHead: xml.slice(0, 600) }; }
export const GET: APIRoute = async ({ params }) => {
  const { id } = params;
  if (!id) return new Response(JSON.stringify({ error: "Missing id" }), { status: 400, headers: { "Content-Type": "application/json" } });
  const pu = import.meta.env.PLEX_URL?.trim() ?? ""; const pt = import.meta.env.PLEX_TOKEN?.trim() ?? "";
  if (!pu || !pt) return new Response(JSON.stringify({ error: "env missing" }), { status: 500, headers: { "Content-Type": "application/json" } });
  let sid = "";
  try { const { container: sc } = await fx(pu, pt, "/library/sections"); const secs = toArr(sc.Directory) as Record<string, unknown>[]; sid = String(secs.find((s) => s.type === "artist")?.key ?? ""); } catch {}
  let cr: unknown; try { const { status, container, rawHead } = await fx(pu, pt, "/library/metadata/" + id + "/children"); const k = container.Metadata != null ? "Metadata" : container.Directory != null ? "Directory" : "(none)"; const ns = toArr(container.Metadata ?? container.Directory); cr = { status, keys: Object.keys(container), candidateKey: k, nodeCount: ns.length, nodes: snap(ns), rawHead }; } catch (e) { cr = { error: String(e) }; }
  let sr: unknown; if (sid) { try { const { status, container, rawHead } = await fx(pu, pt, "/library/sections/" + sid + "/all?type=9&parentRatingKey=" + id); const k = container.Metadata != null ? "Metadata" : container.Directory != null ? "Directory" : "(none)"; const ns = toArr(container.Metadata ?? container.Directory); sr = { status, keys: Object.keys(container), candidateKey: k, nodeCount: ns.length, nodes: snap(ns), rawHead }; } catch (e) { sr = { error: String(e) }; } } else { sr = { skipped: "no sectionId" }; }
  return new Response(JSON.stringify({ id, sectionId: sid, children: cr, sectionQuery: sr }, null, 2), { status: 200, headers: { "Content-Type": "application/json" } });
};