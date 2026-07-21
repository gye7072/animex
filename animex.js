//git init
// git add .
// git commit -m "remove setTimeout rate limiter"
// git remote add origin main
// git push -u origin main

// git add .
// git commit -m "remove setTimeout rate limiter"
// git push

	


class Anilist {
    //All methods inside are static meaning we can can call them directly on the class
    //e.g. Anilist.search() without creating an instance

    //takes a search keyword and optional filters object
    static async search(keyword, filters = {}) {
    
        //https://docs.anilist.co/guide/graphql/
        //https://docs.anilist.co/guide/graphql/pagination (to get multiple objects)
        //https://docs.anilist.co/reference/query

        // Here we define our query as a multi-line string
        // Storing it in a separate .graphql/.gql file is also possible

        //query maps to a filter we can pass in
        //media { } what gets returned per anime
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
        // Define our query variables and values that will be used in the query request
        //the actual values passed into the query
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
            //spread operator unpacks an iterable into individual elements; if share the same key, the property placed last will override the previous ones
            //...filters spreads any extra filters the caller provided, overriding defaults if keys conflict
        }

        return Anilist.anilistFetch(query, variables);
    }

    //designed to fetch one specific anime by its "id" or "idMal"
    //the query is hardcoded to page:1, perPage: 1 since we only want one result
    //media is what gets returned
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

    //fetches all currently airing anime for the current season
    //https://anilist.co/search/anime?year=2026&season=SPRING&airing%20status=RELEASING
    static async getLatest(filters) {
        let page = 0;
        let hasNextPage = true;
        const perPage = 50; //the API returns 50 results per page
        const currentDate = new Date();

        filters.seasonYear = currentDate.getFullYear(); //get current year
        filters.season = Anilist.monthToSeason(currentDate.getMonth()); //get current season using current month
        const results = [];

        //Each iteration fetches the next page
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
            //if hasNextPage == false end loop
            if(fetchResults?.Page?.pageInfo?.hasNextPage !== true) {
                hasNextPage = false;
            }

        } while(hasNextPage);

        //Merge all pages into one single object (one page)

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

            if (response.status !== 200) { //Not Ok
                if (response.status === 429) { //Too many requests
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

    //converts date format {year, month, day} to standard "YYYY-MM-DD" string
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

        //ensures single-digit months/days get a leading zero
        return dateObject.year + "-" + (dateObject.month).toString().padStart(2, '0') + "-" + (dateObject.day).toString().padStart(2, '0');
    }

    //Takes a Unix timestamp (seconds since 1970) and returns a human-readable countdown string.
    static nextAnilistAirDateToCountdown(timestamp) {
        if (timestamp == null) return null;

        const airDate = new Date((timestamp * 1000)); //Multiplies by 1000 because JS Date uses milliseconds but Unix timestamps are in seconds.
        const now = new Date();

        if (now > airDate) return null;

        let [days, hourRemainder] = (((airDate - now) / 1000) / 60 / 60 / 24).toString().split('.'); //Calculates the difference in days as a decimal (e.g. 2.75), then splits on . to get whole days and the fractional remainder separately.
        let [hours, minRemainder] = (parseFloat("0." + hourRemainder) * 24).toString().split('.');
        let minutes = Math.ceil((parseFloat("0." + minRemainder) * 60));

        //Converts the hourRemainder to hours, then the minRemainder to minutes. Math.ceil rounds up so you never show 0 minutes.

        return `Next episode will air in ${days} days, ${hours} hours and ${minutes} minutes at ${airDate.getFullYear()}-${(airDate.getMonth() + 1).toString().padStart(2, '0')}-${(airDate.getDate()).toString().padStart(2, '0')} ${airDate.getHours()}:${airDate.getMinutes()}`;
    }

    static monthToSeason(month) {
        // month is 0-indexed (0 = Jan, 11 = Dec)
        if (month >= 0 && month <= 2) return "WINTER"; // Jan, Feb, Mar
        if (month >= 3 && month <= 5) return "SPRING"; // Apr, May, Jun
        if (month >= 6 && month <= 8) return "SUMMER"; // Jul, Aug, Sep
        return "FALL";                                  // Oct, Nov, Dec
    }
}





// ─── _amx_id bot-detection bypass ──────────────────────────────────────────
// The token is bound to (ip, ua) at issuance time, so this interceptor:
//   1. Pins ONE User-Agent for its entire lifetime and uses it on every
//      request — including the warm-up.
//   2. Warms up by hitting the human-facing watch page first (the page a
//      real browser would load before any /rest/api/* call), to receive
//      the `_amx_id` cookie under realistic conditions.
//   3. Stores and resends every cookie set by the server (not just
//      `_amx_id`) on subsequent requests to the same origin.
class AmxBotInterceptor {
    constructor(userAgent) {
        this.cookieStore = {};
        // Pin a single UA for the whole session since _amx_id embeds it.
        this.userAgent = userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:152.0) Gecko/20100101 Firefox/152.0";
        this.warmedUp = false;
    }
 
    // Call once per slug/episode session before hitting /rest/api/*.
    // domainUrl should be the human-facing watch page, e.g.
    // https://animex.one/watch/crest-of-the-stars-290-episode-6

    
    async warmUp(domainUrl) {
        if (this.warmedUp) return;
        console.log("[Amx] Warming up via watch page: " + domainUrl);
 
        const resp = await this.fetchWithCookies(domainUrl, {
            headers: {
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Host": "animex.one",
            }
        });

 
        if (resp && this.cookieStore["_amx_id"]) {
            console.log("[Amx] Warm-up succeeded, _amx_id acquired.");
        } else {
            // console.log(resp);
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
 
        // If we never warmed up (or our cookie is stale), try a fresh
        // warm-up against this same origin and retry once.
        // const originMatch = url.match(/^(https?:\/\/[^\/]+)/);
        // // console.log(originMatch);
        // if (originMatch) {
        //     await this.fetchWithCookies(originMatch[1] + "/", {});
        //     if (this.cookieStore["_amx_id"]) {
        //         console.log("[Amx] Retrying original request with refreshed _amx_id...");
        //         return this.fetchWithCookies(url, options);
        //     }
        // }
 

        await this.fetchWithCookies(url, {});
        if (this.cookieStore["_amx_id"]) {
            console.log("[Amx] Retrying original request with refreshed _amx_id...");
            return this.fetchWithCookies(url, options);
        }
    
 
 
        console.log("[Amx] Could not acquire a valid _amx_id — request will likely keep failing. " +
                     "If this persists even with a fresh cookie, the block is probably TLS/JA3 fingerprinting " +
                     "at the Cloudflare layer, which requires a server-side client with a real-browser TLS " +
                     "signature (e.g. curl-impersonate) rather than fetch().");
        return response;
    }
 
    async fetchWithCookies(url, options) {
        const cookieHeader = this.getCookieHeader();
        const headers = { ...(options.headers || {}) };
        headers["User-Agent"] = this.userAgent; // always pinned, never overridden per-call
        if (cookieHeader) headers.Cookie = cookieHeader;
 
        const response = await animexFetch(url, { ...options, headers });
        if (!response) return response;


        // Every request URL, its status, and exactly what set-cookie value comes back
        // console.log(response);
        console.log("[Amx] " + url + " → " + response.status + " | set-cookie: " + 
            JSON.stringify(response.headers?.["set-cookie"] || response.headers?.["Set-Cookie"] || "NONE")
        );
    
        try {
            const setCookie = response.headers?.["set-cookie"] || response.headers?.["Set-Cookie"];
            if (setCookie) this.storeCookies(setCookie);
        } catch (e) {}
 
        return response;
    }
 
    looksBotBlocked(response) {
        if (!response) return true;
        // if(response.status === 429) return true; //too many requests
        if (response.status !== 403) return false; 
        const body = response._data || "";
        // Specifically the origin app's bot_detected error, not a generic 403.
        return body.includes('bot_detected');
    }
 
    storeCookies(setCookieString) {
        const cookies = Array.isArray(setCookieString) ? setCookieString : [setCookieString];
        cookies.forEach(c => {
            const [kv] = c.split(";");
            const [key, value] = kv.split("=");
            if (key) this.cookieStore[key.trim()] = value?.trim() || "";
        });
    }
 
    getCookieHeader() {
        return Object.entries(this.cookieStore)
            .map(([k, v]) => `${k}=${v}`)
            .join("; ");
    }
}





function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function animexFetch(url, options = {}) {
    return soraFetch(url, options);
}



// function sleep(ms) {
//         return new Promise((resolve) => setTimeout(resolve, ms));
// }

// // ─── Rate‑limiter for all animex.one requests ───
// // Strategy: burst optimistically up to a generous per‑minute ceiling, and only
// // slow down REACTIVELY when the server actually returns 429 (see below). The
// // ceiling is just a safety cap against runaway loops — the real protection is
// // the Retry‑After backoff, not a tiny preemptive budget. One episode load costs
// // ~1 (servers) + N (providers) requests, so the ceiling must comfortably fit
// // several episodes per minute.
// const ANIMEX_MAX_REQUESTS = 60;       // ceiling per window (≈1 req/s average)
// const ANIMEX_WINDOW_MS = 60000;        // rolling 60s window
// const ANIMEX_MAX_429_RETRIES = 3;      //three retries
// let animexRequestTimes = [];
// let animexAdmission = Promise.resolve();

// async function animexFetch(url, options = {}, attempt = 0) {
//     // Serialize only the admission decision so parallel callers don't grab the
//     // same slot; the actual network requests still run concurrently.
//     const ticket = animexAdmission.then(() => animexReserveSlot());
//     animexAdmission = ticket.catch(() => {});
//     await ticket;

//     const response = await soraFetch(url, options);

//     // Reactive backoff: respect the server's own throttle if (and only if) it
//     // actually pushes back, instead of crawling preemptively.
//     if (response && response.status === 429 && attempt < ANIMEX_MAX_429_RETRIES) {
//         const retryAfter = parseInt(response.headers?.get?.('Retry-After')) || 5;
//         const waitMs = retryAfter * 1000 + 250;
//         console.log("[RateLimit] 429 from server, backing off " + waitMs + "ms (attempt " + (attempt + 1) + ").");
//         await sleep(waitMs);
//         return animexFetch(url, options, attempt + 1);
//     }

//     return response;
// }

// async function animexReserveSlot() {
//     const now = Date.now();
//     // Forget timestamps that have aged out of the rolling window.
//     animexRequestTimes = animexRequestTimes.filter(t => now - t < ANIMEX_WINDOW_MS);

//     if (animexRequestTimes.length >= ANIMEX_MAX_REQUESTS) {
//         const waitTime = ANIMEX_WINDOW_MS - (now - animexRequestTimes[0]) + 50;
//         console.log("[RateLimit] Window full (" + ANIMEX_MAX_REQUESTS + "/" + (ANIMEX_WINDOW_MS / 1000) + "s), waiting " + waitTime + "ms.");
//         await sleep(waitTime);
//         return animexReserveSlot();
//     }

//     animexRequestTimes.push(Date.now());
// }





// ***** LOCAL TESTING

//3_20260601165107_35979d636e3fab19a98113c2_30fde646501cf62e3590b08b944947acaf1a8b2e_000_20260604165107_0041_dnld
//curl -L -H "Referer: https://animex.one" -H "Origin: https://animex.one" -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:151.0) Gecko/20100101 Firefox/151.0" --output "output.mp4" "https://mp4.24stream.xyz/storage/media6/videos/bndqfD6H7DyHeumFL/sub/6?Authorization=3_20260601165107_35979d636e3fab19a98113c2_30fde646501cf62e3590b08b944947acaf1a8b2e_000_20260604165107_0041_dnld"

// (async() => {
//     const results = await searchResults('Erased');
//     const href = JSON.parse(results)[0].href;
//     console.log("HREF:", href);

//     const details = await extractDetails(href);
//     console.log("Details: ", details);
 
//     const episodes = await extractEpisodes(href);
//     const firstEpisodeHref = JSON.parse(episodes)[1].href;
//     console.log("EPISODE HREF:", firstEpisodeHref);
 
//     const streamUrl = await extractStreamUrl(firstEpisodeHref);
//     const parsed = JSON.parse(streamUrl);
//     const streams = parsed.streams;
//     const subtitles = parsed.subtitles;

//     console.log(streams)


//     // console.log("\n===== STREAMS =====");
//     // streams.forEach(s => {
//     //     const subUrl = s.subtitleUrl || subtitles || null;
//     //     const refHeader = s.headers?.Referer || "https://animex.one";
//     //     const originHeader = s.headers?.Origin || "https://animex.one";
//     //     const uaHeader = s.headers?.["User-Agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:151.0) Gecko/20100101 Firefox/151.0";

//     //     console.log(`\n[${s.title}]`);
//     //     console.log(`\n# 1. Download video:`);
//     //     // console.log(`curl -L -H "Referer: ${refHeader}" -H "Origin: ${originHeader}" -H "User-Agent: ${uaHeader}" --output "output.mp4" "${s.streamUrl}"`);
//     //     console.log(`python -m yt_dlp --add-header "Referer: ${refHeader}" --add-header "Origin:${originHeader}" --add-header "User-Agent:${uaHeader}" --no-check-certificate --extractor-args "generic:impersonate" --downloader curl -o "output.mp4" "${s.streamUrl}"`);

//     //     console.log(`\n# 2. Download subtitles separately:`);
//     //     if (s.subtitleUrl) {
//     //         console.log(`python -m yt_dlp "${subUrl}" -o "subs.vtt"`);
//     //     } else {
//     //         console.log(`# No subtitles available for this stream`);
//     //     }

//     //     console.log(`\n# 3. Merge video + subtitles:`);
//     //     if (subUrl) {
//     //         console.log(`ffmpeg -i "output.mp4" -i "subs.vtt" -c copy -c:s mov_text -metadata:s:s:0 language=eng output_with_subs.mp4`);
//     //     } else {
//     //         console.log(`# Skip merge — no subs`);
//     //     }
//     // });
 
//     console.log("\n===== SUBTITLES =====");
//     console.log(subtitles || "No subtitles found");
// })();

// ***** LOCAL TESTING


//https://graphql.animex.one/graphql
//FastSearch is just a semantic name
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
            const match = url.match(/anime\/(\d+)(?:\/([^\/]+))?/); //captures anime/290/crest-of-the-stars-vee16
            if (!match) throw new Error("Invalid URL format");

            const anilistId = parseInt(match[1]); //captures 290

            const aniData = await Anilist.lookup({ id: anilistId });
            const anime = aniData.Page.media[0]; //the ONE result

            const cleanDescription = anime.description
                ? anime.description.replace(/<[^>]+>/g, '').trim() //removes all HTML tags (e.g <b> and </b>)
                : 'No description available';

            const transformedResults = [{
                description: cleanDescription,
                aliases: `Duration: ${anime.episodes ? anime.episodes + " episodes" : 'Unknown'}`,
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
            const match = url.match(/anime\/(\d+)(?:\/([^\/]+))?/); //captures anime/290/crest-of-the-stars-vee16
            if (!match) throw new Error("Invalid URL format");

            const anilistId = parseInt(match[1]); //captures 290
            const aniData = await Anilist.lookup({ id: anilistId });
            const anime = aniData.Page.media[0];

            console.log("Anime: ", anime);

            if (!anime) return JSON.stringify([]);

            const episodesCount = anime.episodes || (anime.nextAiringEpisode?.episode - 1) || 1;
            //13 || airing-1 || 1 (default)
            const episodesArray = [];
            for (let i = 1; i <= episodesCount; i++) {
                episodesArray.push({
                    href: `anime/${anilistId}/${match[2] || ''}/${i}`, 
                   //anime/290/crest-of-the-stars-vee16/6 or anime/290/6
                    number: i,
                    //episode 6
                    title: `Episode ${i}`
                    //Episode 6
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
      .toLowerCase() //lowercase
      .normalize("NFKD") //breaks accented letters into base letters + accent marks
      .replace(/[\u0300-\u036f]/g, "") //remove accent marks
      .replace(/[^a-z0-9\s-]/g, "") //remove invalid chars
      .trim() //remove whitespace
      .replace(/\s+/g, "-") //replace spaces with hyphens
      .replace(/-+/g, "-"); //if repeated hyphens, reduce to one
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

 
// ─── Extract Stream URL ─────────────────────────────────────────────────────
async function extractStreamUrl(url) {
    try {
        const match = url.match(/anime\/(\d+)\/([^\/]+)\/(\d+)/); // captures anime/290/crest-of-the-stars-vee16/6
        if (!match) throw new Error('Invalid URL format');
 
        const id = match[1];             // 290
        const slug = match[2];           // crest-of-the-stars-vee16
        const episodeNumber = match[3];  // 6
        const name = slug.replace(/-[^-]+$/, ''); // crest-of-the-stars (drop trailing provider suffix)
 
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
 
        const amx = new AmxBotInterceptor(); // pins its own default UA internally
 
        // Warm up against the human-facing watch page first — this is what
        // issues the `_amx_id` cookie under realistic conditions, before we
        // ever touch the /rest/api/* endpoints.


        const domainUrl = `https://animex.one/watch/${name}-${id}-episode-${episodeNumber}`;
        // await amx.warmUp(domainUrl);
 
        // 1. Fetch available servers
        const serversUrl = `https://pp.animex.one/rest/api/servers?id=${encodeURIComponent(slug)}&epNum=${episodeNumber}`;
        console.log("[extractStreamUrl] Fetching servers: " + serversUrl);
 
        const baseHeaders = {
            "Host": "pp.animex.one",
            "Origin": "https://animex.one",
            "Referer": domainUrl,
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.9",
            // "Accept-Encoding": "gzip, deflate",
            // Note: User-Agent is set internally by AmxBotInterceptor on every
            // call (pinned to whatever UA it warmed up with) — don't override
            // it here, since the _amx_id token is bound to that exact UA.
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
            // ***
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
            const resolvedUrl = isMochi && typeof rewriteMochiCdn === 'function'
                ? rewriteMochiCdn(rawUrl)
                : rawUrl;
 
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

            // ***
            console.log("[extractStreamUrl] Final headers for " + providerId + ": " + JSON.stringify(outHeaders));
 
            // Skip resolveStreamUrl for direct MP4 — never pre-fetch it
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
        //returns status, headers, body
    } catch(e) {
        try {
            return await fetch(url, options);
        } catch(error) {
            return null;
        }
    }
}


// async function fetchv2(url, headers = {}, method = "GET", body = null, redirect = true, encoding = "utf-8") {
//     const processedBody = (method !== "GET" && body && typeof body === 'object') 
//         ? JSON.stringify(body)
//         : (method !== "GET" ? body : null); //GET request should not have a body

//     const options = {
//         method,
//         headers,
//         body: processedBody,
//         redirect: redirect ? 'follow' : 'manual', 
// 		//follow: atuomatically follows HTTP redirects
// 		//manual: don't follow them, you'll handle it
//     };

//     try {
//         const response = await fetch(url, options);
// 		//sends the HTTP request
// 		//waits for the fetch() promise to resolve
// 		//contains metadata about the HTTP response

//         const rawBuffer = await response.arrayBuffer();
// 		//reads the response body as binary data
// 		//useful when the response is not plain text (like files, images, etc)

//         const decoder = new TextDecoder(encoding || "utf-8");
// 		//converts an ArrayBuffer string using specified encoding 
// 		//if no encoding is specified it will use "utf-8"

//         const decodedText = decoder.decode(rawBuffer);
// 		//raw response body text
// 		//Example: '{"success":true,"data":[1,2,3]}'

//         const result = {
//             headers: Object.fromEntries(response.headers.entries()),
// 			//response.headers.entries() gives an iterator of key-value pairs
// 			//Object.fromEntries converts it to a plain object
// 			// E.g., [["content-type", "application/json"]] → { "content-type": "application/json" }

//             status: response.status,
// 			//HTTP status code
//             _data: decodedText,
//             text: function () {
//                 return Promise.resolve(this._data);
//             },
// 			//returns a promise that resolves to a string

//             json: function () {
//                 try {
//                     return Promise.resolve(JSON.parse(this._data));
//                 } catch (e) {
//                     return Promise.reject("JSON parse error: " + e.message);
//                 }
//             }
//         };

//         return result;

//     } catch (err) {
//         return Promise.reject(err.message || "Unknown error");
//     }
// }