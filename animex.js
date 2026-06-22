// ════════════════════════════════════════════════════════════════════════
//  animex.js — animex.one extractor (Anilist-backed search/details/episodes
//  + pp.animex.one stream extraction with _amx_id bot-detection bypass)
// ════════════════════════════════════════════════════════════════════════
//
//  ORDERING NOTE: fetchv2, soraFetch, and the rate-limiter are declared
//  FIRST in this file, before anything that calls them. In a standard JS
//  engine, function declarations are hoisted and this wouldn't matter —
//  but this iOS host has shown it does NOT reliably hoist across the file
//  the way a normal engine does (observed: "ReferenceError: Can't find
//  variable: soraFetch" when soraFetch was declared near the bottom of the
//  file but called from code higher up). Keep all foundational helpers at
//  the top of the file, in dependency order, regardless of what a "normal"
//  JS engine would allow.
// ════════════════════════════════════════════════════════════════════════

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Low-level fetch wrapper ───────────────────────────────────────────────
function safeHeadersToObject(headers) {
    if (!headers) return {};
    try {
        if (typeof headers.entries === 'function') {
            return Object.fromEntries(headers.entries());
        }
    } catch (e) {
        console.log("[fetchv2] headers.entries() unavailable/failed: " + e);
    }
    try {
        if (typeof headers.forEach === 'function') {
            const out = {};
            headers.forEach((value, key) => { out[key] = value; });
            return out;
        }
    } catch (e) {
        console.log("[fetchv2] headers.forEach() unavailable/failed: " + e);
    }
    if (typeof headers === 'object') return headers;
    return {};
}

async function fetchv2(url, headers = {}, method = "GET", body = null, redirect = true, encoding = "utf-8") {
    const processedBody = (method !== "GET" && body && typeof body === 'object')
        ? JSON.stringify(body)
        : (method !== "GET" ? body : null); // GET requests should not have a body

    const options = {
        method,
        headers,
        body: processedBody,
        redirect: redirect ? 'follow' : 'manual',
    };

    try {
        const response = await fetch(url, options);

        let decodedText = "";
        try {
            const rawBuffer = await response.arrayBuffer();
            const decoder = new TextDecoder(encoding || "utf-8");
            decodedText = decoder.decode(rawBuffer);
        } catch (decodeErr) {
            try {
                decodedText = await response.text();
            } catch (textErr) {
                console.log("[fetchv2] Could not read response body: " + textErr);
                decodedText = "";
            }
        }

        const result = {
            headers: safeHeadersToObject(response.headers),
            status: response.status,
            _data: decodedText,
            text: function () {
                return Promise.resolve(this._data);
            },
            json: function () {
                try {
                    return Promise.resolve(JSON.parse(this._data));
                } catch (e) {
                    return Promise.reject("JSON parse error: " + e.message);
                }
            }
        };

        return result;
    } catch (err) {
        const message = (err && err.message) ? err.message : String(err);
        return Promise.reject(message || "Unknown error");
    }
}

// ─── SoraFetch (fallback wrapper) ──────────────────────────────────────────
async function soraFetch(url, options = { headers: {}, method: 'GET', body: null, encoding: 'utf-8' }) {
    try {
        return await fetchv2(
            url,
            options.headers ?? {},
            options.method ?? 'GET',
            options.body ?? null,
            true,
            options.encoding ?? 'utf-8'
        );
    } catch (e) {
        console.log("[soraFetch] fetchv2 failed, falling back to raw fetch: " + e);
        try {
            const fallbackInit = {
                method: options.method ?? 'GET',
                headers: options.headers ?? {},
            };
            if (options.body && fallbackInit.method !== 'GET') {
                fallbackInit.body = typeof options.body === 'object'
                    ? JSON.stringify(options.body)
                    : options.body;
            }
            return await fetch(url, fallbackInit);
        } catch (error) {
            console.log("[soraFetch] Raw fetch fallback also failed: " + error);
            return null;
        }
    }
}

// ─── Rate-limiter for all animex.one requests ──────────────────────────────
// Strategy: burst optimistically up to a generous per-minute ceiling, and
// only slow down REACTIVELY when the server actually returns 429. The
// ceiling is a safety cap against runaway loops — the real protection is the
// Retry-After backoff, not a tiny preemptive budget.
const ANIMEX_MAX_REQUESTS = 60;        // ceiling per window (≈1 req/s average)
const ANIMEX_WINDOW_MS = 60000;        // rolling 60s window
const ANIMEX_MAX_429_RETRIES = 3;

let animexRequestTimes = [];
let animexAdmission = Promise.resolve();

async function animexReserveSlot(depth = 0) {
    if (depth > 20) {
        console.log("[RateLimit] Exceeded max wait depth, admitting request anyway to avoid hanging.");
        animexRequestTimes.push(Date.now());
        return;
    }

    const now = Date.now();
    animexRequestTimes = animexRequestTimes.filter(t => now - t < ANIMEX_WINDOW_MS);
    if (animexRequestTimes.length >= ANIMEX_MAX_REQUESTS) {
        const waitTime = Math.max(50, Math.min(ANIMEX_WINDOW_MS, ANIMEX_WINDOW_MS - (now - animexRequestTimes[0]) + 50));
        console.log("[RateLimit] Window full (" + ANIMEX_MAX_REQUESTS + "/" + (ANIMEX_WINDOW_MS / 1000) + "s), waiting " + waitTime + "ms.");
        await sleep(waitTime);
        return animexReserveSlot(depth + 1);
    }
    animexRequestTimes.push(Date.now());
}

async function animexFetch(url, options = {}, attempt = 0) {
    const ticket = animexAdmission.then(() => animexReserveSlot());
    animexAdmission = ticket.catch(() => {});
    await ticket;

    let response;
    try {
        response = await soraFetch(url, options);
    } catch (e) {
        console.log("[animexFetch] soraFetch threw: " + e);
        return null;
    }

    if (response && response.status === 429 && attempt < ANIMEX_MAX_429_RETRIES) {
        const parsedRetry = parseInt(response.headers?.['retry-after'], 10);
        const retryAfter = Number.isFinite(parsedRetry) && parsedRetry > 0 ? parsedRetry : 5;
        const waitMs = Math.min(retryAfter * 1000 + 250, 30000);
        console.log("[RateLimit] 429 from server, backing off " + waitMs + "ms (attempt " + (attempt + 1) + ").");
        await sleep(waitMs);
        return animexFetch(url, options, attempt + 1);
    }

    return response;
}

// ════════════════════════════════════════════════════════════════════════
//  Anilist GraphQL client
// ════════════════════════════════════════════════════════════════════════
class Anilist {
    static async search(keyword, filters = {}) {
        const query = `query (
                $search: String,
                $page: Int,
                $perPage: Int,
                $sort: [MediaSort],
                $genre_in: [String],
                $tag_in: [String],
                $type: MediaType,
                $format: MediaFormat,
                $status: MediaStatus,
                $countryOfOrigin: CountryCode,
                $isAdult: Boolean,
                $season: MediaSeason,
                $startDate_like: String,
                $source: MediaSource,
                $averageScore_greater: Int,
                $averageScore_lesser: Int
            ) {
                Page(page: $page, perPage: $perPage) {
                media(
                    search: $search,
                    type: $type,
                    sort: $sort,
                    genre_in: $genre_in,
                    tag_in: $tag_in,
                    format: $format,
                    status: $status,
                    countryOfOrigin: $countryOfOrigin,
                    isAdult: $isAdult,
                    season: $season,
                    startDate_like: $startDate_like,
                    source: $source,
                    averageScore_greater: $averageScore_greater,
                    averageScore_lesser: $averageScore_lesser
                ) {
                    id
                    idMal
                    averageScore
                    title { romaji english native }
                    episodes
                    nextAiringEpisode { airingAt timeUntilAiring episode }
                    status
                    genres
                    format
                    description
                    startDate { year month day }
                    endDate { year month day }
                    popularity
                    coverImage { color large extraLarge }
                }
            }
        }`;

        const variables = {
            "page": 1,
            "perPage": 50,
            "sort": ["SEARCH_MATCH", "TITLE_ENGLISH_DESC", "TITLE_ROMAJI_DESC"],
            "search": keyword,
            "type": "ANIME",
            ...filters
        };

        return Anilist.anilistFetch(query, variables);
    }

    static async lookup(filters) {
        const query = `query (
                $id: Int,
                $idMal: Int
            ) {
                Page(page: 1, perPage: 1) {
                media(
                    id: $id,
                    idMal: $idMal
                ) {
                    id
                    idMal
                    averageScore
                    title { romaji english native }
                    episodes
                    nextAiringEpisode { airingAt timeUntilAiring episode }
                    status
                    genres
                    format
                    description
                    startDate { year month day }
                    endDate { year month day }
                    popularity
                    coverImage { color large extraLarge }
                }
            }
        }`;

        const variables = {
            "type": "ANIME",
            ...filters
        };

        return Anilist.anilistFetch(query, variables);
    }

    static async getLatest(filters) {
        let page = 0;
        let hasNextPage = true;
        const perPage = 50;
        const currentDate = new Date();

        filters.seasonYear = currentDate.getFullYear();
        filters.season = Anilist.monthToSeason(currentDate.getMonth());
        const results = [];

        do {
            page++;

            const query = `query (
                $page: Int,
                $perPage: Int,
                $sort: [MediaSort],
                $type: MediaType,
                $status: MediaStatus,
                $isAdult: Boolean,
                $seasonYear: Int,
                $season: MediaSeason
            ) {
                Page(page: $page, perPage: $perPage) {
                    media(
                        type: $type,
                        sort: $sort,
                        status: $status,
                        isAdult: $isAdult,
                        seasonYear: $seasonYear,
                        season: $season
                    ) {
                        id
                        idMal
                        averageScore
                        title { romaji english native }
                        episodes
                        nextAiringEpisode { airingAt timeUntilAiring episode }
                        status
                        genres
                        format
                        description
                        startDate { year month day }
                        endDate { year month day }
                        popularity
                        coverImage { color large extraLarge }
                    }
                    pageInfo { hasNextPage }
                }
            }`;

            const variables = {
                "page": page,
                "perPage": perPage,
                "sort": ["POPULARITY_DESC"],
                "type": "ANIME",
                "status": "RELEASING",
                ...filters
            };
            const fetchResults = await Anilist.anilistFetch(query, variables);
            results.push(fetchResults);
            if (fetchResults?.Page?.pageInfo?.hasNextPage !== true) {
                hasNextPage = false;
            }
        } while (hasNextPage);

        const mergedObject = { Page: { media: [] } };
        for (let page of results) {
            mergedObject.Page.media = mergedObject.Page.media.concat(page.Page.media);
        }

        return mergedObject;
    }

    static async anilistFetch(query, variables) {
        const url = 'https://graphql.anilist.co/';
        const extraTimeoutMs = 250;

        try {
            const response = await soraFetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                body: JSON.stringify({ query, variables })
            });

            if (!response) {
                console.error('Error fetching Anilist data: no response');
                return null;
            }

            if (response.status !== 200) {
                if (response.status === 429) {
                    console.info('=== RATE LIMIT EXCEEDED, SLEEPING AND RETRYING ===');
                    const retryTimeout = response.headers?.['retry-after'];
                    const parsed = parseInt(retryTimeout, 10);
                    const timeout = (Number.isFinite(parsed) && parsed > 0 ? parsed : 5) * 1000 + extraTimeoutMs;
                    await sleep(timeout);
                    return await Anilist.anilistFetch(query, variables);
                }

                console.error('Error fetching Anilist data, status:', response.status);
                return null;
            }

            const json = await response.json();
            if (json?.errors) {
                console.error('Error fetching Anilist data:', json.errors);
            }

            return json?.data;

        } catch (error) {
            console.error('Error fetching Anilist data:', error);
            return null;
        }
    }

    static convertAnilistDateToDateStr(dateObject) {
        if (dateObject.year == null) {
            return null;
        }
        if (dateObject.month == null || parseInt(dateObject.month) < 1) {
            dateObject.month = 1;
        }
        if (dateObject.day == null || parseInt(dateObject.day) < 1) {
            dateObject.day = 1;
        }

        return dateObject.year + "-" + (dateObject.month).toString().padStart(2, '0') + "-" + (dateObject.day).toString().padStart(2, '0');
    }

    static nextAnilistAirDateToCountdown(timestamp) {
        if (timestamp == null) return null;

        const airDate = new Date((timestamp * 1000));
        const now = new Date();

        if (now > airDate) return null;

        let [days, hourRemainder] = (((airDate - now) / 1000) / 60 / 60 / 24).toString().split('.');
        let [hours, minRemainder] = (parseFloat("0." + hourRemainder) * 24).toString().split('.');
        let minutes = Math.ceil((parseFloat("0." + minRemainder) * 60));

        return `Next episode will air in ${days} days, ${hours} hours and ${minutes} minutes at ${airDate.getFullYear()}-${(airDate.getMonth() + 1).toString().padStart(2, '0')}-${(airDate.getDate()).toString().padStart(2, '0')} ${airDate.getHours()}:${airDate.getMinutes()}`;
    }

    static monthToSeason(month) {
        if (month >= 0 && month <= 2) return "WINTER";
        if (month >= 3 && month <= 5) return "SPRING";
        if (month >= 6 && month <= 8) return "SUMMER";
        return "FALL";
    }
}

// ════════════════════════════════════════════════════════════════════════
//  animex.one GraphQL search
// ════════════════════════════════════════════════════════════════════════
async function searchAnimex(keyword, limit = 24) {
    limit = Math.min(24, Math.max(1, limit));
    console.log("[searchAnimex] Called with keyword: " + keyword + " limit: " + limit);

    const query = `
        query FastSearch($query: String, $limit: Int) {
            catalogAnime(filter: { query: $query }, limit: $limit) {
                items {
                    id
                    anilistId
                    malId
                    titleRomaji
                    titleEnglish
                    coverImage
                    format
                    status
                    episodeCount
                    seasonYear
                    season
                    color
                    genres
                    bannerImage
                }
            }
        }
    `;

    const variables = { query: keyword, limit: limit };

    console.log("[searchAnimex] GraphQL variables: " + JSON.stringify(variables));

    const response = await animexFetch('https://graphql.animex.one/graphql', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        body: JSON.stringify({ query, variables })
    });

    console.log("[searchAnimex] Response status: " + response?.status);

    if (!response || response.status !== 200) {
        console.error("[searchAnimex] Fetch failed or non-200 status");
        return null;
    }

    let json;
    try {
        json = await response.json();
        console.log("[searchAnimex] Raw JSON response: " + JSON.stringify(json).substring(0, 300));
    } catch (parseError) {
        console.error("[searchAnimex] Failed to parse JSON: " + parseError);
        return null;
    }

    if (json?.errors) {
        console.error("[searchAnimex] GraphQL errors: " + JSON.stringify(json.errors));
        return null;
    }

    const items = json?.data?.catalogAnime?.items;
    console.log("[searchAnimex] Items count: " + (items?.length || 0));

    return items || [];
}

// ─── Search Results ────────────────────────────────────────────────────────
async function searchResults(keyword) {
    try {
        console.log("[searchResults] Keyword: " + keyword);
        let items = [];

        if (keyword.startsWith('!anime') || keyword.startsWith('!a') || keyword.startsWith('!')) {
            console.log("[searchResults] Trending mode, using Anilist.getLatest");
            const aniData = await Anilist.getLatest({ isAdult: false });
            if (aniData?.Page?.media?.length > 0) {
                items = aniData.Page.media.map(result => ({
                    anilistId: result.id,
                    titleEnglish: result.title.english,
                    titleRomaji: result.title.romaji,
                    coverImage: result.coverImage?.extraLarge || result.coverImage?.large || result.coverImage?.medium || ""
                }));
            }
        } else {
            console.log("[searchResults] Normal search, calling searchAnimex");
            items = await searchAnimex(keyword, 24);
            if (!items) items = [];
        }

        console.log("[searchResults] Items before transformation: " + (items?.length || 0) + " items");

        const transformedResults = items.map((item, index) => {
            let imageUrl = "";
            if (item.coverImage) {
                if (typeof item.coverImage === 'object') {
                    imageUrl = item.coverImage.large || item.coverImage.extraLarge || item.coverImage.medium || "";
                } else {
                    imageUrl = item.coverImage;
                }
            }
            const result = {
                title: item.titleEnglish || item.titleRomaji || "Untitled",
                image: imageUrl,
                href: "anime/" + item.anilistId + "/" + item.id
            };
            if (index === 0) console.log("[searchResults] First transformed item: " + JSON.stringify(result));
            return result;
        });

        console.log("Transformed Results: " + JSON.stringify(transformedResults));
        return JSON.stringify(transformedResults);
    } catch (error) {
        console.log("[searchResults] Fetch error: " + error);
        return JSON.stringify([{ title: "Error", image: "", href: "" }]);
    }
}

// ─── Extract Details ───────────────────────────────────────────────────────
async function extractDetails(url) {
    try {
        if (url.includes('anime')) {
            const match = url.match(/anime\/(\d+)(?:\/([^\/]+))?/);
            if (!match) throw new Error("Invalid URL format");

            const anilistId = parseInt(match[1]);

            const aniData = await Anilist.lookup({ id: anilistId });
            const anime = aniData?.Page?.media?.[0];
            if (!anime) throw new Error("No Anilist result found");

            const cleanDescription = anime.description
                ? anime.description.replace(/<[^>]+>/g, '').trim()
                : 'No description available';

            const transformedResults = [{
                description: cleanDescription,
                aliases: `Duration: ${anime.episodes ? anime.episodes + " episodes" : 'Unknown'}`,
                airdate: `Aired: ${anime.startDate?.year ? Anilist.convertAnilistDateToDateStr(anime.startDate) : 'Unknown'}`
            }];

            console.log(JSON.stringify(transformedResults));
            return JSON.stringify(transformedResults);
        } else {
            throw new Error("Invalid URL format");
        }
    } catch (error) {
        console.log('Details error: ' + error);
        return JSON.stringify([{
            description: 'Error loading description',
            aliases: 'Duration: Unknown',
            airdate: 'Aired/Released: Unknown'
        }]);
    }
}

// ─── Extract Episodes ───────────────────────────────────────────────────────
async function extractEpisodes(url) {
    try {
        if (url.includes('anime')) {
            const match = url.match(/anime\/(\d+)(?:\/([^\/]+))?/);
            if (!match) throw new Error("Invalid URL format");

            const anilistId = parseInt(match[1]);
            const aniData = await Anilist.lookup({ id: anilistId });
            const anime = aniData?.Page?.media?.[0];

            console.log("Anime: ", anime);

            if (!anime) return JSON.stringify([]);

            const episodesCount = anime.episodes || (anime.nextAiringEpisode?.episode - 1) || 1;
            const episodesArray = [];
            for (let i = 1; i <= episodesCount; i++) {
                episodesArray.push({
                    href: `anime/${anilistId}/${match[2] || ''}/${i}`,
                    number: i,
                    title: `Episode ${i}`
                });
            }

            console.log(episodesArray);
            return JSON.stringify(episodesArray);
        } else {
            throw new Error("Invalid URL format");
        }
    } catch (error) {
        console.log('Fetch error in extractEpisodes: ' + error);
        return JSON.stringify([]);
    }
}

function slugify(title) {
    return title
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-");
}

function rewriteMochiCdn(url) {
    try {
        console.log("[rewriteMochiCdn] called with: " + url);
        if (url.includes("tools.fast4speed.rsvp/media6/")) {
            const result = url.replace(
                "tools.fast4speed.rsvp/media6/",
                "mp4.24stream.xyz/storage/media6/"
            );
            console.log("[rewriteMochiCdn] rewritten to: " + result);
            return result;
        }
        console.log("[rewriteMochiCdn] no rewrite needed");
        return url;
    } catch (e) {
        console.log("[rewriteMochiCdn] error: " + e);
        return url;
    }
}

// ════════════════════════════════════════════════════════════════════════
//  _amx_id bot-detection bypass
// ════════════════════════════════════════════════════════════════════════
//
//  pp.animex.one sits behind Cloudflare, but a 403 { error: "bot_detected" }
//  response is issued by the ORIGIN APPLICATION itself, not Cloudflare's
//  challenge page. The mechanism: the server sets a cookie called
//  `_amx_id`, a JWT containing { ip, ua, exp, iat, nonce }, issued tied to
//  the IP + User-Agent of whatever request first hit the server, and
//  re-validated against IP+UA on subsequent requests. A request with no
//  `_amx_id` cookie at all is trivially flagged as a bot.
//
//  AmxBotInterceptor:
//    1. Pins ONE User-Agent for its entire lifetime and uses it on every
//       request — including the warm-up — since the token is UA-bound.
//    2. Warms up by hitting the human-facing watch page first (the page a
//       real browser would load before any /rest/api/* call).
//    3. Stores and resends every cookie set by the server on subsequent
//       requests to the same origin.
//
//  If bot_detected persists even after a successful warm-up, the next
//  suspect is TLS/JA3 fingerprinting, which cannot be solved from a
//  fetch()-only environment and would require a server-side HTTP client
//  with a real-browser TLS signature (e.g. curl-impersonate).
class AmxBotInterceptor {
    constructor(userAgent) {
        this.cookieStore = {};
        this.userAgent = userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:152.0) Gecko/20100101 Firefox/152.0";
        this.warmedUp = false;
    }

    async warmUp(domainUrl) {
        if (this.warmedUp) return;
        console.log("[Amx] Warming up via watch page: " + domainUrl);

        const resp = await this.fetchWithCookies(domainUrl, {
            headers: {
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            }
        });

        if (resp && this.cookieStore["_amx_id"]) {
            console.log("[Amx] Warm-up succeeded, _amx_id acquired.");
        } else {
            console.log("[Amx] Warm-up did not yield an _amx_id cookie (status " + resp?.status + "). Continuing anyway — API calls may still be flagged.");
        }

        this.warmedUp = true;
    }

    async fetchWithBypass(url, options = {}) {
        let response = await this.fetchWithCookies(url, options);

        if (!this.looksBotBlocked(response)) {
            return response;
        }

        console.log("[Amx] bot_detected on " + url + " — _amx_id missing/stale or IP+UA mismatch.");

        const originMatch = url.match(/^(https?:\/\/[^\/]+)/);
        if (originMatch) {
            await this.fetchWithCookies(originMatch[1] + "/", {});
            if (this.cookieStore["_amx_id"]) {
                console.log("[Amx] Retrying original request with refreshed _amx_id...");
                return this.fetchWithCookies(url, options);
            }
        }

        console.log("[Amx] Could not acquire a valid _amx_id — request will likely keep failing. " +
                     "If this persists even with a fresh cookie, the block is probably TLS/JA3 fingerprinting.");
        return response;
    }

    async fetchWithCookies(url, options) {
        const cookieHeader = this.getCookieHeader();
        const headers = { ...(options.headers || {}) };
        headers["User-Agent"] = this.userAgent;
        if (cookieHeader) headers.Cookie = cookieHeader;

        const response = await animexFetch(url, { ...options, headers });
        if (!response) return response;

        try {
            const setCookie = response.headers?.["set-cookie"] || response.headers?.["Set-Cookie"];
            if (setCookie) this.storeCookies(setCookie);
        } catch (e) {}

        return response;
    }

    looksBotBlocked(response) {
        if (!response) return true;
        if (response.status !== 403) return false;
        const body = response._data || "";
        return body.includes('bot_detected');
    }

    storeCookies(setCookieString) {
        try {
            const cookies = Array.isArray(setCookieString) ? setCookieString : [setCookieString];
            cookies.forEach(c => {
                if (typeof c !== 'string' || c.length === 0) return;
                const [kv] = c.split(";");
                const [key, value] = kv.split("=");
                if (key) this.cookieStore[key.trim()] = value?.trim() || "";
            });
        } catch (e) {
            console.log("[Amx] storeCookies failed: " + e);
        }
    }

    getCookieHeader() {
        return Object.entries(this.cookieStore)
            .map(([k, v]) => `${k}=${v}`)
            .join("; ");
    }
}

// ─── Extract Stream URL ─────────────────────────────────────────────────────
async function extractStreamUrl(url) {
    console.log("[extractStreamUrl] ENTERED with url: " + url);
    try {
        if (typeof url !== 'string' || url.length === 0) {
            throw new Error('Invalid URL format (received: ' + typeof url + ')');
        }

        const match = url.match(/anime\/(\d+)\/([^\/]+)\/(\d+)/); // captures anime/290/crest-of-the-stars-vee16/6
        if (!match) throw new Error('Invalid URL format');

        const id = match[1];             // 290
        const slug = match[2];           // crest-of-the-stars-vee16
        const episodeNumber = match[3];  // 6
        const name = slug.replace(/-[^-]+$/, ''); // crest-of-the-stars

        console.log("[extractStreamUrl] Slug: " + slug + " Episode: " + episodeNumber);

        const CDN_PREFERRED_HOSTS = ['cdn.', 'zaza.'];

        function getCdnPriority(u) {
            for (let i = 0; i < CDN_PREFERRED_HOSTS.length; i++) {
                if (u.includes(CDN_PREFERRED_HOSTS[i])) return i;
            }
            return CDN_PREFERRED_HOSTS.length;
        }

        function getBestSubtitleUrl(urls) {
            if (!urls || urls.length === 0) return null;
            return [...urls].sort((a, b) => getCdnPriority(a) - getCdnPriority(b))[0];
        }

        async function resolveStreamUrl(rawUrl, headers) {
            if (!rawUrl.includes('.m3u8')) return rawUrl;

            try {
                const resp = await animexFetch(rawUrl, { headers });
                if (!resp || resp.status !== 200) return rawUrl;

                const text = await resp.text();

                const hasJpgSegments = /^(?!#)[^\s]+\.jpg/m.test(text);
                if (!hasJpgSegments) {
                    console.log("[resolveStreamUrl] Standard HLS, no rewrite needed for: " + rawUrl);
                    return rawUrl;
                }

                console.log("[resolveStreamUrl] Detected .jpg-segment HLS, rewriting manifest...");

                const base = rawUrl.substring(0, rawUrl.lastIndexOf('/') + 1);

                const rewritten = text.replace(
                    /^(?!#)([^\s]+\.jpg)/gm,
                    (seg) => (seg.startsWith('http') ? seg : base + seg)
                );

                const encoded = btoa(unescape(encodeURIComponent(rewritten)));
                return `data:application/vnd.apple.mpegurl;base64,${encoded}`;

            } catch (e) {
                console.warn("[resolveStreamUrl] Manifest rewrite failed, falling back: " + e);
                return rawUrl;
            }
        }

        const amx = new AmxBotInterceptor();

        const domainUrl = `https://animex.one/watch/${name}-${id}-episode-${episodeNumber}`;
        await amx.warmUp(domainUrl);

        const serversUrl = `https://pp.animex.one/rest/api/servers?id=${encodeURIComponent(slug)}&epNum=${episodeNumber}`;
        console.log("[extractStreamUrl] Fetching servers: " + serversUrl);

        const baseHeaders = {
            "Host": "pp.animex.one",
            "Origin": "https://animex.one",
            "Referer": domainUrl,
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate",
        };

        let serversResp = await amx.fetchWithBypass(serversUrl, { headers: baseHeaders });

        if (!serversResp || serversResp.status !== 200) {
            console.error("[extractStreamUrl] Failed to fetch servers, status: " + serversResp?.status);
            return JSON.stringify({ streams: [], subtitles: null });
        }

        const serversData = await serversResp.json();
        const subProviders = serversData.subProviders || [];
        const dubProviders = serversData.dubProviders || [];

        console.log("[extractStreamUrl] Sub providers: " + JSON.stringify(subProviders.map(p => p.id)));
        console.log("[extractStreamUrl] Dub providers: " + JSON.stringify(dubProviders.map(p => p.id)));

        async function fetchProviderStream(provider, type) {
            const providerId = provider.id;
            const sourcesUrl = `https://pp.animex.one/rest/api/sources?id=${encodeURIComponent(slug)}&epNum=${episodeNumber}&type=${type}&providerId=${providerId}`;
            console.log("[extractStreamUrl] Fetching sources: " + sourcesUrl);

            const sourcesResp = await amx.fetchWithBypass(sourcesUrl, { headers: baseHeaders });
            if (!sourcesResp || sourcesResp.status !== 200) {
                console.error("[extractStreamUrl] Failed to fetch sources for " + providerId + ", status: " + sourcesResp?.status);
                return null;
            }

            const sourcesData = await sourcesResp.json();
            if (!sourcesData.sources || sourcesData.sources.length === 0) {
                console.warn("[extractStreamUrl] No sources for " + providerId);
                return null;
            }

            const source = sourcesData.sources[0];
            const apiHeaders = sourcesData.headers || {};

            const rawUrl = source.url;
            const isMochi = providerId.toLowerCase() === "mochi";
            const resolvedUrl = isMochi ? rewriteMochiCdn(rawUrl) : rawUrl;

            if (resolvedUrl !== rawUrl) {
                console.log("[extractStreamUrl] CDN rewrite for " + providerId + ": " + rawUrl + " → " + resolvedUrl);
            }

            console.log("[extractStreamUrl] Raw API headers for " + providerId + ": " + JSON.stringify(apiHeaders));

            const referer = (typeof apiHeaders.Referer === 'string' ? apiHeaders.Referer : null)
                || (typeof apiHeaders.referer === 'string' ? apiHeaders.referer : null)
                || null;

            const origin = (typeof apiHeaders.Origin === 'string' ? apiHeaders.Origin : null)
                || (typeof apiHeaders.origin === 'string' ? apiHeaders.origin : null)
                || null;

            const userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

            const finalReferer = referer || "https://animex.one/";
            const finalOrigin = origin || finalReferer.match(/^(https?:\/\/[^\/]+)/)?.[1] || "https://animex.one";

            const outHeaders = {
                "Referer": finalReferer,
                "Origin": finalOrigin,
                "User-Agent": userAgent,
            };

            console.log("[extractStreamUrl] Final headers for " + providerId + ": " + JSON.stringify(outHeaders));

            const isDirectMp4 = !resolvedUrl.includes('.m3u8') && !resolvedUrl.includes('.mpd');
            const streamUrl = isDirectMp4
                ? resolvedUrl
                : await resolveStreamUrl(resolvedUrl, outHeaders);

            if (isDirectMp4) {
                console.log("[extractStreamUrl] Direct MP4 detected for " + providerId + ", skipping manifest fetch");
            }

            const rawTracks = (sourcesData.tracks || [])
                .filter(t => t.url && (t.kind === "captions" || t.kind === "subtitles"))
                .map(t => t.url);

            const subtitleUrl = rawTracks.length > 0
                ? getBestSubtitleUrl(rawTracks)
                : null;

            if (subtitleUrl) {
                console.log("[extractStreamUrl] Subtitle for " + providerId + ": " + subtitleUrl);
            } else {
                console.log("[extractStreamUrl] No subtitle tracks for " + providerId);
            }

            const tip = provider.tip ? ` (${provider.tip})` : '';
            const title = `${providerId.toUpperCase()} - ${type.toUpperCase()}${tip}`;

            return { title, streamUrl, headers: outHeaders, subtitleUrl };
        }

        const streams = [];

        for (const provider of subProviders) {
            const stream = await fetchProviderStream(provider, 'sub');
            if (stream) streams.push(stream);
        }

        for (const provider of dubProviders) {
            const stream = await fetchProviderStream(provider, 'dub');
            if (stream) streams.push(stream);
        }

        const allSubtitleUrls = streams.map(s => s.subtitleUrl).filter(Boolean);
        const bestSubtitle = getBestSubtitleUrl(allSubtitleUrls) || null;

        const cleanStreams = streams.map(({ subtitleUrl, ...rest }) => ({
            ...rest,
            subtitleUrl: subtitleUrl || null
        }));

        console.log("[extractStreamUrl] Total streams found: " + cleanStreams.length);
        console.log("[extractStreamUrl] Best global subtitle: " + bestSubtitle);

        const result = JSON.stringify({
            streams: cleanStreams,
            subtitles: bestSubtitle
        });

        console.log("[extractStreamUrl] Result: " + result.substring(0, 300));
        return result;

    } catch (error) {
        console.log('[extractStreamUrl] Fetch error: ' + error);
        return JSON.stringify({ streams: [], subtitles: null });
    }
}