//git init
// git add .
// git commit -m "remove setTimeout rate limiter"
// git remote add origin main
// git push -u origin main

// git add .
// git commit -m "remove setTimeout rate limiter"
// git push


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
                    title {
                        romaji
                        english
                        native
                    }
                    episodes
                    nextAiringEpisode {
                        airingAt
                        timeUntilAiring
                        episode
                    }
                    status
                    genres
                    format
                    description
                    startDate {
                        year
                        month
                        day
                    }
                    endDate {
                        year
                        month
                        day
                    }
                    popularity
                    coverImage {
                        color
                        large
                        extraLarge
                    }
                }
            }
        }`;

        const variables = {
            "page": 1,
            "perPage": 50,
            "sort": [
                "SEARCH_MATCH",
                "TITLE_ENGLISH_DESC",
                "TITLE_ROMAJI_DESC"
            ],
            "search": keyword,
            "type": "ANIME",
            ...filters
        }

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
                    title {
                        romaji
                        english
                        native
                    }
                    episodes
                    nextAiringEpisode {
                        airingAt
                        timeUntilAiring
                        episode
                    }
                    status
                    genres
                    format
                    description
                    startDate {
                        year
                        month
                        day
                    }
                    endDate {
                        year
                        month
                        day
                    }
                    popularity
                    coverImage {
                        color
                        large
                        extraLarge
                    }
                }
            }
        }`;

        const variables = {
            "type": "ANIME",
            ...filters
        }

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
                        title {
                            romaji
                            english
                            native
                        }
                        episodes
                        nextAiringEpisode {
                            airingAt
                            timeUntilAiring
                            episode
                        }
                        status
                        genres
                        format
                        description
                        startDate {
                            year
                            month
                            day
                        }
                        endDate {
                            year
                            month
                            day
                        }
                        popularity
                        coverImage {
                            color
                            large
                            extraLarge
                        }
                    }
                    pageInfo {
                        hasNextPage
                    }
                }
            }`;

            const variables = {
                "page": page,
                "perPage": perPage,
                "sort": [
                    "POPULARITY_DESC"
                ],
                "type": "ANIME",
                "status": "RELEASING",
                ...filters
            }

            const fetchResults = await Anilist.anilistFetch(query, variables);
            results.push(fetchResults);

            if(fetchResults?.Page?.pageInfo?.hasNextPage !== true) {
                hasNextPage = false;
            }

        } while(hasNextPage);

        const mergedObject = { Page: { media: []}};

        for(let page of results) {
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
                body: JSON.stringify({
                    query: query,
                    variables: variables
                })
            });

            if (response.status !== 200) {
                if (response.status === 429) {
                    console.info('=== RATE LIMIT EXCEEDED, SLEEPING AND RETRYING ===');
                    const retryTimeout = response.headers.get('Retry-After');
                    const timeout = Math.ceil((parseInt(retryTimeout))) * 1000 + extraTimeoutMs;
                    await sleep(timeout);
                    return await Anilist.anilistFetch(query, variables);
                }

                console.error('Error fetching Anilist data:', response.statusText);
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
        const seasons = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
        if(month == 11) return seasons[0];
        if(month <= 1) return seasons[0];
        if(month <= 4) return seasons[1];
        if(month <= 7) return seasons[2];
        return seasons[3];
    }
}





// ***** LOCAL TESTING

//3_20260601165107_35979d636e3fab19a98113c2_30fde646501cf62e3590b08b944947acaf1a8b2e_000_20260604165107_0041_dnld
//curl -L -H "Referer: https://animex.one" -H "Origin: https://animex.one" -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:151.0) Gecko/20100101 Firefox/151.0" --output "output.mp4" "https://mp4.24stream.xyz/storage/media6/videos/bndqfD6H7DyHeumFL/sub/6?Authorization=3_20260601165107_35979d636e3fab19a98113c2_30fde646501cf62e3590b08b944947acaf1a8b2e_000_20260604165107_0041_dnld"

// (async() => {
//     const results = await searchResults('Crest of Stars');
//     const href = JSON.parse(results)[0].href;
//     console.log("HREF:", href);
 
//     const episodes = await extractEpisodes(href);
//     const firstEpisodeHref = JSON.parse(episodes)[5].href;
//     console.log("EPISODE HREF:", firstEpisodeHref);
 
//     const streamUrl = await extractStreamUrl(firstEpisodeHref);
//     const parsed = JSON.parse(streamUrl);
//     const streams = parsed.streams;
//     const subtitles = parsed.subtitles;
 
//     console.log("\n===== STREAMS =====");
//     streams.forEach(s => {
//         const subUrl = s.subtitleUrl || subtitles || null;
//         const refHeader = s.headers?.Referer || "https://animex.one";
//         const originHeader = s.headers?.Origin || "https://animex.one";
//         const uaHeader = s.headers?.["User-Agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:151.0) Gecko/20100101 Firefox/151.0";

//         console.log(`\n[${s.title}]`);
//         console.log(`\n# 1. Download video:`);
//         console.log(`curl -L -H "Referer: ${refHeader}" -H "Origin: ${originHeader}" -H "User-Agent: ${uaHeader}" --output "output.mp4" "${s.streamUrl}"`);
//         console.log(`python -m yt_dlp --add-header "Referer: ${refHeader}" --add-header "Origin:${originHeader}" --add-header "User-Agent:${uaHeader}" --no-check-certificate --extractor-args "generic:impersonate" --downloader curl -o "output.mp4" "${s.streamUrl}"`);

//         console.log(`\n# 2. Download subtitles separately:`);
//         if (s.subtitleUrl) {
//             console.log(`python -m yt_dlp "${subUrl}" -o "subs.vtt"`);
//         } else {
//             console.log(`# No subtitles available for this stream`);
//         }

//         console.log(`\n# 3. Merge video + subtitles:`);
//         if (subUrl) {
//             console.log(`ffmpeg -i "output.mp4" -i "subs.vtt" -c copy -c:s mov_text -metadata:s:s:0 language=eng output_with_subs.mp4`);
//         } else {
//             console.log(`# Skip merge — no subs`);
//         }
//     });
 
//     console.log("\n===== SUBTITLES =====");
//     console.log(subtitles || "No subtitles found");
// })();

// ***** LOCAL TESTING

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function animexFetch(url, options = {}) {
    return soraFetch(url, options);
}

// // ─── Rate‑limiter for all animex.one requests ───
// let lastAnimexRequest = 0;

// async function animexFetch(url, options = {}) {
//     const now = Date.now();
//     const minInterval = 6000; // 6 seconds to stay under 10 req/min
//     const timeSinceLast = now - lastAnimexRequest;
//     if (timeSinceLast < minInterval) {
//         const waitTime = minInterval - timeSinceLast;
//         console.log("[RateLimit] Waiting " + waitTime + "ms before next animex request.");
//         await sleep(waitTime);
//     }
//     lastAnimexRequest = Date.now();
//     return soraFetch(url, options);
// }

// ─── AnimeX Search (now rate‑limited) ───
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

    const variables = {
        query: keyword,
        limit: limit
    };

    console.log("[searchAnimex] GraphQL variables: " + JSON.stringify(variables));

    // Rate‑limited fetch
    const response = await animexFetch('https://graphql.animex.one/graphql', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        body: JSON.stringify({ query, variables })
    });

    console.log("[searchAnimex] Response status: " + response?.status + " OK: " + response?.ok);
    
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
    if (items && items.length > 0) {
        console.log("[searchAnimex] First item sample: " + JSON.stringify(items[0]).substring(0, 300));
    }

    return items || [];
}

// ─── Search Results (unchanged logic) ───
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

// ─── Extract Details (unchanged) ───
async function extractDetails(url) {
    try {
        if (url.includes('anime')) {
            const match = url.match(/anime\/(\d+)(?:\/([^\/]+))?/);
            if (!match) throw new Error("Invalid URL format");

            const anilistId = parseInt(match[1]);

            const aniData = await Anilist.lookup({ id: anilistId });
            const anime = aniData.Page.media[0];

            const cleanDescription = anime.description
                ? anime.description.replace(/<[^>]+>/g, '').trim()
                : 'No description available';

            const transformedResults = [{
                description: cleanDescription,
                aliases: `Duration: ${anime.episodes ? 24 + " minutes" : 'Unknown'}`,
                airdate: `Aired: ${anime.startDate.year ? Anilist.convertAnilistDateToDateStr(anime.startDate) : 'Unknown'}`
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

// ─── Extract Episodes (unchanged) ───
async function extractEpisodes(url) {
    try {
        if(url.includes('anime')) {
            const match = url.match(/anime\/(\d+)(?:\/([^\/]+))?/);
            if (!match) throw new Error("Invalid URL format");

            const anilistId = parseInt(match[1]);
            const aniData = await Anilist.lookup({ id: anilistId });
            const anime = aniData.Page.media[0];

            console.log(anime);

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


// ─── Extract Stream URL ────────────────────────────────────────────────────
async function extractStreamUrl(url) {
    try {
        const match = url.match(/anime\/(\d+)\/([^\/]+)\/(\d+)/);
        if (!match) throw new Error('Invalid URL format');

        const slug = match[2];
        const episodeNumber = match[3];

        console.log("[extractStreamUrl] Slug: " + slug + " Episode: " + episodeNumber);

        const CDN_PREFERRED_HOSTS = [
            'cdn.',
            'zaza.',
        ];

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

        // ─── Rewrite JPG-segment HLS playlists ──────────────────────────────
        // Only called for .m3u8 streams — never for direct MP4s.
        // If segments use .jpg extensions instead of .ts/.m4s, rewrites the
        // manifest as a base64 data URI so the player handles it correctly.
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

        // 1. Fetch available servers
        const serversUrl = `https://pp.animex.one/rest/api/servers?id=${encodeURIComponent(slug)}&epNum=${episodeNumber}`;
        console.log("[extractStreamUrl] Fetching servers: " + serversUrl);

        const serversResp = await animexFetch(serversUrl);
        if (!serversResp || serversResp.status !== 200) {
            console.error("[extractStreamUrl] Failed to fetch servers, status: " + serversResp?.status);
            return JSON.stringify({ streams: [], subtitle: null });
        }

        const serversData = await serversResp.json();
        const subProviders = serversData.subProviders || [];
        const dubProviders = serversData.dubProviders || [];

        console.log("[extractStreamUrl] Sub providers: " + JSON.stringify(subProviders.map(p => p.id)));
        console.log("[extractStreamUrl] Dub providers: " + JSON.stringify(dubProviders.map(p => p.id)));

        // Helper to fetch a stream from a provider
        async function fetchProviderStream(provider, type) {
            const providerId = provider.id;
            const sourcesUrl = `https://pp.animex.one/rest/api/sources?id=${encodeURIComponent(slug)}&epNum=${episodeNumber}&type=${type}&providerId=${providerId}`;
            console.log("[extractStreamUrl] Fetching sources: " + sourcesUrl);

            const sourcesResp = await animexFetch(sourcesUrl);
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

            // Rewrite CDN host for Mochi direct MP4 streams
            const rawUrl = source.url;
            const isMochi = providerId.toLowerCase() === "mochi";
            const resolvedUrl = isMochi ? rewriteMochiCdn(rawUrl) : rawUrl;

            if (resolvedUrl !== rawUrl) {
                console.log("[extractStreamUrl] CDN rewrite for " + providerId + ": " + rawUrl + " → " + resolvedUrl);
            }

            // Log exactly what the API gave us
            console.log("[extractStreamUrl] Raw API headers for " + providerId + ": " + JSON.stringify(apiHeaders));

            // Safely extract Referer and Origin — try all casing variants
            const referer = (typeof apiHeaders.Referer === 'string' ? apiHeaders.Referer : null)
                || (typeof apiHeaders.referer === 'string' ? apiHeaders.referer : null)
                || null;

            const origin = (typeof apiHeaders.Origin === 'string' ? apiHeaders.Origin : null)
                || (typeof apiHeaders.origin === 'string' ? apiHeaders.origin : null)
                || null;

            const userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

            // Derive origin from referer if missing — never fall back to stream host
            const finalReferer = referer || "https://animex.one/";
            const finalOrigin  = origin  || finalReferer.match(/^(https?:\/\/[^\/]+)/)?.[1] || "https://animex.one";

            const headers = {
                "Referer":    finalReferer,
                "Origin":     finalOrigin,
                "User-Agent": userAgent,
            };

            console.log("[extractStreamUrl] Final headers for " + providerId + ": " + JSON.stringify(headers));

            // ─── Skip resolveStreamUrl for direct MP4 — never pre-fetch it ───
            // Pre-fetching a direct MP4 with an Authorization token burns the
            // token before the player can use it, causing playback failure.
            const isDirectMp4 = !resolvedUrl.includes('.m3u8') && !resolvedUrl.includes('.mpd');
            const streamUrl = isDirectMp4
                ? resolvedUrl
                : await resolveStreamUrl(resolvedUrl, headers);

            if (isDirectMp4) {
                console.log("[extractStreamUrl] Direct MP4 detected for " + providerId + ", skipping manifest fetch");
            }

            // Collect subtitle from tracks, pick best CDN URL
            const rawTracks = (sourcesData.tracks || []).map(t => ({ url: t.url }));
            const subtitleUrl = rawTracks.length > 0
                ? getBestSubtitleUrl(rawTracks.map(t => t.url))
                : null;

            if (subtitleUrl) {
                console.log("[extractStreamUrl] Subtitle for " + providerId + ": " + subtitleUrl);
            }

            const tip = provider.tip ? ` (${provider.tip})` : '';
            const title = `${providerId.toUpperCase()} - ${type.toUpperCase()}${tip}`;

            return { title, streamUrl, headers, subtitleUrl };
        }

        // Build all streams sequentially
        const streams = [];

        for (const provider of subProviders) {
            const stream = await fetchProviderStream(provider, 'sub');
            if (stream) streams.push(stream);
        }

        for (const provider of dubProviders) {
            const stream = await fetchProviderStream(provider, 'dub');
            if (stream) streams.push(stream);
        }

        // Pick the single best subtitle URL across all streams
        const allSubtitleUrls = streams.map(s => s.subtitleUrl).filter(Boolean);
        const bestSubtitle = getBestSubtitleUrl(allSubtitleUrls) || null;

        // Include subtitle in each stream AND at top level
        const cleanStreams = streams.map(({ subtitleUrl, ...rest }) => ({
            ...rest,
            subtitle: bestSubtitle || subtitleUrl || null
        }));

        console.log("[extractStreamUrl] Total streams found: " + cleanStreams.length);
        console.log("[extractStreamUrl] Best global subtitle: " + bestSubtitle);

        const result = JSON.stringify({
            streams: cleanStreams,
            subtitle: bestSubtitle
        });

        console.log("[extractStreamUrl] Result: " + result.substring(0, 300));
        console.log(JSON.parse(result));
        return result;

    } catch (error) {
        console.log('[extractStreamUrl] Fetch error: ' + error);
        return JSON.stringify({ streams: [], subtitle: null });
    }
}
// ─── SoraFetch (fallback wrapper, unchanged) ───
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
    } catch(e) {
        try {
            return await fetch(url, options);
        } catch(error) {
            return null;
        }
    }
}