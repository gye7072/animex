#!/usr/bin/env node
// animex-dl.mjs — download any animex.one episode
// Usage: node animex-dl.mjs <slug> <episode> [sub|dub] [output.mp4]
//
// Examples:
//   node animex-dl.mjs "crest-of-the-stars-290" 6
//   node animex-dl.mjs "crest-of-the-stars-290" 6 dub episode6.mp4
//
// Requirements: Node 18+ (built-in fetch), curl in PATH

import { execSync, spawn } from "child_process";
import { createWriteStream, existsSync } from "fs";
import { pipeline } from "stream/promises";

// ── Config ────────────────────────────────────────────────────────────────────
const API_BASE   = "https://pp.animex.one/rest/api";
const REFERER    = "https://animex.one";
const CDN_HOST   = "mp4.24stream.xyz";
const UA         = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:151.0) Gecko/20100101 Firefox/151.0";

const HEADERS = {
  "Referer":    REFERER,
  "Origin":     REFERER,
  "User-Agent": UA,
};

// ── CDN rewrite ───────────────────────────────────────────────────────────────
// tools.fast4speed.rsvp/media6/... → mp4.24stream.xyz/storage/media6/...
function rewriteCdn(url) {
  try {
    const u = new URL(url);
    if (u.hostname === CDN_HOST) return url; // already correct
    u.hostname = CDN_HOST;
    if (!u.pathname.startsWith("/storage")) {
      u.pathname = "/storage" + u.pathname;
    }
    return u.toString();
  } catch {
    return url;
  }
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────
async function apiFetch(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

// ── Pick best subtitle (CDN-preferred) ───────────────────────────────────────
const CDN_PREFERRED = ["cdn.", "zaza."];
function cdnPriority(url) {
  for (let i = 0; i < CDN_PREFERRED.length; i++)
    if (url.includes(CDN_PREFERRED[i])) return i;
  return CDN_PREFERRED.length;
}
function bestSubtitle(tracks = []) {
  if (!tracks.length) return null;
  return [...tracks]
    .filter(t => t.url)
    .sort((a, b) => cdnPriority(a.url) - cdnPriority(b.url))[0]?.url ?? null;
}

// ── Core logic ────────────────────────────────────────────────────────────────
async function getStream(slug, episode, type = "sub") {
  // 1. Servers
  const serversUrl = `${API_BASE}/servers?id=${encodeURIComponent(slug)}&epNum=${episode}`;
  console.log(`[1/3] Fetching providers → ${serversUrl}`);
  const serversData = await apiFetch(serversUrl);

  const providerKey = type === "dub" ? "dubProviders" : "subProviders";
  const providers   = serversData[providerKey] || [];

  if (!providers.length) {
    throw new Error(`No ${type} providers found for "${slug}" ep ${episode}`);
  }
  console.log(`      Providers: ${providers.map(p => p.id).join(", ")}`);

  // 2. Try each provider
  for (const provider of providers) {
    const sourcesUrl = `${API_BASE}/sources?id=${encodeURIComponent(slug)}&epNum=${episode}&type=${type}&providerId=${provider.id}`;
    console.log(`\n[2/3] Trying provider "${provider.id}" → ${sourcesUrl}`);

    let data;
    try { data = await apiFetch(sourcesUrl); }
    catch (e) { console.warn(`      Skipping (${e.message})`); continue; }

    const sources = data.sources || [];
    if (!sources.length) { console.warn("      No sources, trying next..."); continue; }

    const rawUrl     = sources[0].url;
    const finalUrl   = rewriteCdn(rawUrl);
    const subtitle   = bestSubtitle(data.tracks || []);
    const refHeader  = data.headers?.Referer || REFERER;

    console.log(`      Raw URL:  ${rawUrl}`);
    if (finalUrl !== rawUrl)
      console.log(`      CDN fix:  ${finalUrl}`);
    console.log(`      Subtitle: ${subtitle ?? "none"}`);

    return { provider: provider.id, streamUrl: finalUrl, subtitle, referer: refHeader };
  }

  throw new Error("All providers failed — no stream URL found.");
}

// ── Download: curl for direct MP4, yt-dlp for HLS ────────────────────────────
function downloadCurl(url, output) {
  return new Promise((resolve, reject) => {
    console.log(`\n[3/3] curl → ${output}`);
    const args = [
      "-L", "--progress-bar",
      "-H", `Referer: ${REFERER}`,
      "-H", `Origin: ${REFERER}`,
      "-H", `User-Agent: ${UA}`,
      "--output", output,
      url,
    ];
    const proc = spawn("curl", args, { stdio: "inherit" });
    proc.on("close", code => code === 0 ? resolve() : reject(new Error(`curl exited ${code}`)));
  });
}

function downloadYtDlp(url, output, referer = REFERER) {
  return new Promise((resolve, reject) => {
    console.log(`\n[3/3] yt-dlp (HLS) → ${output}`);
    const args = [
      "-m", "yt_dlp",
      `--add-header`, `Referer:${referer}`,
      `--add-header`, `Origin:${REFERER}`,
      "--downloader", "ffmpeg",
      "--hls-use-mpegts",
      "-o", output,
      url,
    ];
    const proc = spawn("python", args, { stdio: "inherit" });
    proc.on("close", code => code === 0 ? resolve() : reject(new Error(`yt-dlp exited ${code}`)));
  });
}

async function downloadSubtitle(url, output) {
  console.log(`\nDownloading subtitles → ${output}`);
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) { console.warn(`  Subtitle fetch failed: HTTP ${res.status}`); return; }
  await pipeline(res.body, createWriteStream(output));
  console.log(`✓ Subtitles: ${output}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
const [,, slug, episode, type = "sub", output = "output.mp4"] = process.argv;

if (!slug || !episode) {
  console.error("Usage: node animex-dl.mjs <slug> <episode> [sub|dub] [output.mp4]");
  console.error('  e.g. node animex-dl.mjs "crest-of-the-stars-290" 6');
  process.exit(1);
}

console.log("=== animex-dl ===");
console.log(`Slug: ${slug}  Episode: ${episode}  Type: ${type}  Output: ${output}\n`);

try {
  const { provider, streamUrl, subtitle, referer } = await getStream(slug, episode, type);

  console.log(`\n=== Downloading via provider: ${provider} ===`);
  console.log(`Stream: ${streamUrl}`);

  const isHls = /\.m3u8/i.test(streamUrl);
  if (isHls) {
    await downloadYtDlp(streamUrl, output, referer);
  } else {
    await downloadCurl(streamUrl, output);
  }
  console.log(`\n✓ Video saved: ${output}`);

  if (subtitle) {
    const subOut = output.replace(/\.[^.]+$/, "") + ".vtt";
    await downloadSubtitle(subtitle, subOut);
  }
} catch (err) {
  console.error(`\nERROR: ${err.message}`);
  process.exit(1);
}
