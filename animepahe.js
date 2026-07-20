async function searchResults(keyword) {
    try {
        const encodedKeyword = encodeURIComponent(keyword);
        const ddosInterceptor = new DdosGuardInterceptor();
        const responseText = await ddosInterceptor.fetchWithBypass(`https://animepahe.pw/api?m=search&q=${encodedKeyword}`);
        const dataText = await responseText.text();
        const data = JSON.parse(dataText);
        const transformedResults = data.data.map(result => {
            return {
                title: result.title,
                image: `https://tmdbproxy22.simplepostrequest.workers.dev/images?url=${encodeURIComponent(result.poster)}&cache=1h`,
                href: `https://animepahe.pw/anime/${result.session}`
            };
        });

        return JSON.stringify(transformedResults);
    } catch (error) {
        console.log("Fetch error in searchResults: " + error);
        return JSON.stringify([{ title: "Please wait a bit then try again!", image: "", href: "" }]);
    }
}

async function extractDetails(url) {
    try {
        const ddosInterceptor = new DdosGuardInterceptor();
        const responseText = await ddosInterceptor.fetchWithBypass(url);
        const dataText = await responseText.text();

        const descMatch = dataText.match(/<div class="anime-synopsis">(.*?)<\/div>/s);
        const description = descMatch ? descMatch[1].replace(/<br\s*\/?>/gi, '\n').trim() : 'N/A';

        const aliasMatch = dataText.match(/<strong>Synonyms: <\/strong>(.*?)<\/p>/);
        const aliases = aliasMatch ? aliasMatch[1].trim() : 'N/A';

        const airMatch = dataText.match(/<strong>Aired:<\/strong>(.*?)<\/p>/s);
        const airdate = airMatch ? airMatch[1].replace(/\s+/g, ' ').trim() : 'N/A';

        return JSON.stringify([{
            description,
            aliases,
            airdate
        }]);
    } catch (err) {
        return JSON.stringify([{
            description: "Error",
            aliases: "Error",
            airdate: "Error"
        }]);
    }
}

async function extractEpisodes(url) {
    const results = [];
    try {
        const uuidMatch = url.match(/\/anime\/([^\/]+)/);
        if (!uuidMatch) throw new Error("Invalid URL");
        const id = uuidMatch[1];

        const ddosInterceptor = new DdosGuardInterceptor();

        let page = 1;
        const apiUrl1 = `https://animepahe.pw/api?m=release&id=${id}&sort=episode_asc&page=${page}`;
        const response1 = await ddosInterceptor.fetchWithBypass(apiUrl1);
        const dataText1 = await response1.text();
        const data1 = JSON.parse(dataText1);

        for (const item of data1.data) {
            results.push({
                href: `https://animepahe.pw/play/${id}/${item.session}`,
                number: item.episode
            });
        }

        const lastPage = data1.last_page;
        if (lastPage > 1) {
            const pagePromises = [];
            for (let p = 2; p <= lastPage; p++) {
                pagePromises.push((async (pageNum) => {
                    let pageData = null;
                    let retries = 0;
                    while (!pageData && retries < 3) {
                        try {
                            const apiUrl = `https://animepahe.pw/api?m=release&id=${id}&sort=episode_asc&page=${pageNum}`;
                            const response = await ddosInterceptor.fetchWithBypass(apiUrl);
                            const dataText = await response.text();
                            pageData = JSON.parse(dataText);
                        } catch (pageErr) {
                            retries++;
                            if (retries < 3) {
                                await new Promise(resolve => setTimeout(resolve, 500));
                            }
                        }
                    }
                    return pageData;
                })(p));
            }

            const allPagesData = await Promise.all(pagePromises);
            for (const pageData of allPagesData) {
                if (pageData && pageData.data) {
                    for (const item of pageData.data) {
                        results.push({
                            href: `https://animepahe.pw/play/${id}/${item.session}`,
                            number: item.episode
                        });
                    }
                }
            }
        }

        return JSON.stringify(results);
    } catch (err) {
        return JSON.stringify([{
            href: "Error",
            number: "Error"
        }]);
    }
}

async function extractStreamUrl(url) {
    console.log("========================================");
    console.log("[Animepahe] extractStreamUrl START:", url);
    try {
        const ddosInterceptor = new DdosGuardInterceptor();
        const responseText = await ddosInterceptor.fetchWithBypass(url);
        console.log("[Animepahe] Play page fetch status:", responseText.status);

        const dataText = await responseText.text();
        console.log("[Animepahe] Play page HTML length:", dataText.length);
        console.log("[Animepahe] Play page HTML snippet (first 500 chars):\n", dataText.substring(0, 500));

        // Quick sanity check: are we even getting the real page, or a challenge page?
        if (dataText.includes('ddos-guard') || dataText.includes('DDoS-Guard') || dataText.includes('data-ddg-origin')) {
            console.warn("[Animepahe] WARNING: play page looks like a DDoS-Guard challenge page, not the real content.");
        }

        const buttonRegex = /<button[^>]*data-src="([^"]+)"[^>]*data-fansub="([^"]+)"[^>]*data-resolution="([^"]+)"[^>]*data-audio="([^"]+)"[^>]*>/g;
        const buttons = [];
        let match;
        while ((match = buttonRegex.exec(dataText)) !== null) {
            buttons.push({
                src: match[1],
                fansub: match[2],
                resolution: match[3],
                audio: match[4]
            });
        }
        console.log("[Animepahe] Strict buttonRegex matched:", buttons.length, "buttons");
        if (buttons.length > 0) {
            console.log("[Animepahe] Buttons found:", JSON.stringify(buttons, null, 2));
        }

        if (buttons.length === 0) {
            const buttonMatches = dataText.match(/<button[^>]*data-src="([^"]*)"[^>]*>/g);
            console.log("[Animepahe] Fallback loose button match count:", buttonMatches ? buttonMatches.length : 0);
            if (buttonMatches) {
                console.log("[Animepahe] Fallback raw button tags found (but NOT parsed/used):");
                buttonMatches.forEach((tag, i) => console.log(`  [${i}] ${tag}`));
                console.warn("[Animepahe] NOTE: fallback found button tags but the strict regex failed to parse them (likely attribute-order mismatch). Returning empty result anyway — this is the bug.");
            } else {
                console.warn("[Animepahe] No <button data-src=...> tags found in HTML at all. Either the page didn't render the resolution menu, or it's a challenge/blocked page.");
            }
            return JSON.stringify({ streams: [], subtitle: "" });
        }

        const deepUnpack = (source) => {
            let decoded = source;
            let safety = 0;
            while (/eval\(function\(p,a,c,k,e,d\)/.test(decoded) && safety < 5) {
                try {
                    decoded = unpack(decoded);
                    safety++;
                    console.log(`[Animepahe] deepUnpack layer ${safety} success`);
                } catch (e) {
                    console.warn("[Animepahe] Unpack error at depth " + safety + ": " + e.message);
                    break;
                }
            }
            return decoded;
        };

        const streamPromises = buttons.map(async (btn, idx) => {
            const kwikUrl = btn.src;
            const audioType = btn.audio === "jpn" ? "Hardsub" : "Dub";
            const title = btn.resolution + "p • " + audioType;
            console.log(`[Animepahe] [btn ${idx}] Fetching kwik URL: ${kwikUrl} (title: ${title})`);

            try {
                const headers = {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
                    "Referer": "https://animepahe.pw/",
                    "Origin": "https://kwik.cx",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
                };
                const resp = await fetchv2(kwikUrl, headers);
                console.log(`[Animepahe] [btn ${idx}] kwik fetch status:`, resp.status);

                const html = await resp.text();
                console.log(`[Animepahe] [btn ${idx}] kwik HTML length:`, html.length);
                console.log(`[Animepahe] [btn ${idx}] kwik HTML snippet (first 300 chars):\n`, html.substring(0, 300));

                const evalRegex = /eval\(function\(p,a,c,k,e,d\)\{[^}]*\}\('[^']*',\d+,\d+,'[^']*'\.split\('\|'\)[^)]*\)/g;
                const evalBlocks = [...html.matchAll(evalRegex)].map(m => m[0]);
                console.log(`[Animepahe] [btn ${idx}] evalBlocks found:`, evalBlocks.length);

                if (evalBlocks.length === 0) {
                    console.log(`[Animepahe] [btn ${idx}] No direct eval blocks — trying <script> fallback`);
                    const scriptMatch = html.match(/<script>(.*?)<\/script>/s);
                    console.log(`[Animepahe] [btn ${idx}] <script> tag found:`, !!scriptMatch);

                    if (scriptMatch) {
                        const scriptContent = scriptMatch[1];
                        console.log(`[Animepahe] [btn ${idx}] script content length:`, scriptContent.length);
                        let unpacked = null;

                        if (scriptContent.includes('));eval(')) {
                            console.log(`[Animepahe] [btn ${idx}] Detected double-layer eval pattern`);
                            const parts = scriptContent.split('));eval(');
                            console.log(`[Animepahe] [btn ${idx}] split parts count:`, parts.length);
                            if (parts.length === 2) {
                                const layer2Packed = parts[1].substring(0, parts[1].length - 1);
                                try {
                                    unpacked = unpack(layer2Packed);
                                    console.log(`[Animepahe] [btn ${idx}] layer2 unpack success, length:`, unpacked.length);
                                } catch (e) {
                                    console.warn(`[Animepahe] [btn ${idx}] layer2 unpack failed:`, e.message);
                                }
                            }
                        } else {
                            try {
                                unpacked = unpack(scriptContent);
                                console.log(`[Animepahe] [btn ${idx}] direct script unpack success, length:`, unpacked.length);
                            } catch (e) {
                                console.warn(`[Animepahe] [btn ${idx}] direct script unpack failed:`, e.message);
                            }
                        }

                        if (unpacked) {
                            console.log(`[Animepahe] [btn ${idx}] unpacked snippet:`, unpacked.substring(0, 200));
                            const urlMatch = unpacked.match(/const source=\\?['"]([^'"]+)['"]/) ||
                                unpacked.match(/https:\/\/[^\s'";]+\.m3u8/);
                            console.log(`[Animepahe] [btn ${idx}] urlMatch found:`, !!urlMatch);
                            if (urlMatch) {
                                let hlsUrl = (urlMatch[1] || urlMatch[0]).replace(/\\+$/, '');
                                hlsUrl = hlsUrl.replace("/stream/", "/hls/").replace("uwu.m3u8", "owo.m3u8");
                                console.log(`[Animepahe] [btn ${idx}] FINAL hlsUrl (script path):`, hlsUrl);
                                return {
                                    title: title,
                                    streamUrl: hlsUrl,
                                    headers: { "Referer": "https://kwik.cx/", "Origin": "https://kwik.cx" }
                                };
                            }
                        }
                    }
                    console.warn(`[Animepahe] [btn ${idx}] Failed to extract stream via script fallback — returning null for this button`);
                    return null;
                }

                let hlsUrl = null;
                for (let b = 0; b < evalBlocks.length; b++) {
                    const block = evalBlocks[b];
                    try {
                        const unpacked = deepUnpack(block);
                        console.log(`[Animepahe] [btn ${idx}] evalBlock[${b}] unpacked snippet:`, unpacked.substring(0, 150));
                        const sourceMatch = unpacked.match(/(?:source\s*=\s*['"]([^'"]+\.m3u8)['"])/i);
                        if (sourceMatch) {
                            hlsUrl = sourceMatch[1];
                            console.log(`[Animepahe] [btn ${idx}] evalBlock[${b}] matched via 'source=' pattern:`, hlsUrl);
                            break;
                        }
                        const directMatch = unpacked.match(/https?:\/\/[^\s'"<>]+\.m3u8[^\s'"<>]*/i);
                        if (directMatch) {
                            hlsUrl = directMatch[0];
                            console.log(`[Animepahe] [btn ${idx}] evalBlock[${b}] matched via direct .m3u8 pattern:`, hlsUrl);
                            break;
                        }
                        console.log(`[Animepahe] [btn ${idx}] evalBlock[${b}] no m3u8 match found in this block`);
                    } catch (e) {
                        console.warn(`[Animepahe] [btn ${idx}] evalBlock[${b}] processing error:`, e.message);
                    }
                }

                if (!hlsUrl) {
                    console.warn(`[Animepahe] [btn ${idx}] No hlsUrl found across all evalBlocks — returning null for this button`);
                    return null;
                }

                hlsUrl = hlsUrl.replace(/\\+$/, '');
                hlsUrl = hlsUrl.replace("/stream/", "/hls/").replace("uwu.m3u8", "owo.m3u8");
                console.log(`[Animepahe] [btn ${idx}] FINAL hlsUrl (evalBlock path):`, hlsUrl);
                return {
                    title: title,
                    streamUrl: hlsUrl,
                    headers: { "Referer": "https://kwik.cx/", "Origin": "https://kwik.cx" }
                };
            } catch (e) {
                console.error(`[Animepahe] [btn ${idx}] EXCEPTION during kwik processing:`, e.message || e);
                return null;
            }
        });

        const results = await Promise.allSettled(streamPromises);
        results.forEach((r, i) => {
            if (r.status === "rejected") {
                console.error(`[Animepahe] [btn ${i}] promise rejected:`, r.reason);
            } else {
                console.log(`[Animepahe] [btn ${i}] promise fulfilled with:`, r.value ? r.value.title : "null");
            }
        });

        const streams = results
            .filter(r => r.status === "fulfilled" && r.value)
            .map(r => r.value);

        console.log("[Animepahe] Total successful streams extracted:", streams.length);

        streams.sort((a, b) => {
            const aIsSub = a.title.includes("Hardsub") ? 0 : 1;
            const bIsSub = b.title.includes("Hardsub") ? 0 : 1;
            if (aIsSub !== bIsSub) return aIsSub - bIsSub;
            const aRes = parseInt(a.title.match(/(\d+)p/)?.[1] || 0);
            const bRes = parseInt(b.title.match(/(\d+)p/)?.[1] || 0);
            return bRes - aRes;
        });

        console.log("[Animepahe] Final sorted streams:", JSON.stringify(streams, null, 2));

        const finalResult = JSON.stringify({ streams: streams, subtitle: "" });
        return finalResult;

    } catch (err) {
        console.error("[Animepahe] TOP-LEVEL EXCEPTION in extractStreamUrl:", err && err.stack ? err.stack : err);
        return JSON.stringify({ streams: [], subtitle: "" });
    } finally {
        console.log("[Animepahe] extractStreamUrl END:", url);
        console.log("========================================");
    }
}
// Fixed Bypass
class DdosGuardInterceptor {
    constructor() {
        this.errorCodes = [403];
        this.serverCheck = ["ddos-guard"];
        this.cookieStore = {};
    }

    async fetchWithBypass(url, options = {}) {
        const solverUrl = `https://tmdbproxy22.simplepostrequest.workers.dev/solver?url=${encodeURIComponent(url)}&cache=1h`;
        return fetchv2(solverUrl, options.headers || {});
    }

    async fetchWithBypassDdos(url, options = {}) {
        let response = await this.fetchWithCookies(url, options);
        let responseText = null;

        if (this.errorCodes.includes(response.status)) {
            const newCookie = await this.getNewCookie(url);
            if (newCookie || this.cookieStore["__ddg2_"]) {
                return this.fetchWithCookies(url, options);
            }
            return response;
        }

        try {
            responseText = await response.text();
        } catch (e) {
            return response;
        }

        const isBlocked = responseText.includes('ddos-guard/js-challenge') ||
            responseText.includes('DDoS-Guard') ||
            responseText.includes('data-ddg-origin');

        if (!isBlocked) {
            response.text = async () => responseText;
            return response;
        }

        if (this.cookieStore["__ddg2_"]) {
            return this.fetchWithCookies(url, options);
        }

        const newCookie = await this.getNewCookie(url);
        if (!newCookie) {
            response.text = async () => responseText;
            return response;
        }

        return this.fetchWithCookies(url, options);
    }

    async fetchWithCookies(url, options) {
        const cookieHeader = this.getCookieHeader();
        const headers = options.headers || {};
        if (cookieHeader) {
            headers.Cookie = cookieHeader;
        }

        const response = await fetchv2(url, headers);

        try {
            const setCookieHeader = response.headers ? response.headers["Set-Cookie"] || response.headers["set-cookie"] : null;
            if (setCookieHeader) {
                this.storeCookies(setCookieHeader);
            }
        } catch (e) {
        }

        return response;
    }

    isDdosGuard(response) {
        const serverHeader = response.headers["Server"];
        return serverHeader && this.serverCheck.includes(serverHeader.toLowerCase());
    }

    storeCookies(setCookieString) {
        const cookies = Array.isArray(setCookieString) ? setCookieString : [setCookieString];

        cookies.forEach(cookieHeader => {
            const parts = cookieHeader.split(";");
            if (parts.length > 0) {
                const [key, value] = parts[0].split("=");
                if (key) {
                    this.cookieStore[key.trim()] = value?.trim() || "";
                }
            }
        });
    }

    getCookieHeader() {
        return Object.entries(this.cookieStore)
            .map(([key, value]) => `${key}=${value}`)
            .join("; ");
    }

    async getNewCookie(targetUrl) {
        try {
            const wellKnownResponse = await fetchv2("https://check.ddos-guard.net/check.js");
            const wellKnownText = await wellKnownResponse.text();

            const paths = wellKnownText.match(/['"](\/\.well-known\/ddos-guard\/[^'"]+)['"]/g);
            const checkPaths = wellKnownText.match(/['"]https:\/\/check\.ddos-guard\.net\/[^'"]+['"]/g);

            if (!paths || paths.length === 0) {
                return null;
            }

            const localPath = paths[0].replace(/['"]/g, '');

            const match = targetUrl.match(/^(https?:\/\/[^\/]+)/);
            if (!match) {
                return null;
            }
            const baseUrl = match[1];

            const localUrl = `${baseUrl}${localPath}`;

            const localResponse = await fetchv2(localUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                    'Referer': targetUrl
                }
            });

            let setCookie = null;
            try {
                setCookie = localResponse.headers ? localResponse.headers["set-cookie"] || localResponse.headers["Set-Cookie"] : null;
            } catch (e) {
            }
            if (setCookie) {
                this.storeCookies(setCookie);
            }

            if (checkPaths && checkPaths.length > 0) {
                const checkUrl = checkPaths[0].replace(/['"]/g, '');

                const checkResponse = await fetchv2(checkUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                        'Referer': targetUrl
                    }
                });

                try {
                    setCookie = checkResponse.headers ? checkResponse.headers["set-cookie"] || checkResponse.headers["Set-Cookie"] : null;
                } catch (e) {
                }
                if (setCookie) {
                    this.storeCookies(setCookie);
                }
            }

            if (this.cookieStore["__ddg2_"]) {
                return this.cookieStore["__ddg2_"];
            }

            return null;
        } catch (error) {
            return null;
        }
    }
}

// Fixed deobfuscator:
class Unbaser {
    constructor(base) {
        this.ALPHABET = {
            62: "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
            95: "' !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~'",
        };
        this.dictionary = {};
        this.base = base;
        if (36 < base && base < 62) {
            this.ALPHABET[base] = this.ALPHABET[base] || this.ALPHABET[62].substr(0, base);
        }
        if (2 <= base && base <= 36) {
            this.unbase = (value) => parseInt(value, base);
        } else {
            try {
                [...this.ALPHABET[base]].forEach((cipher, index) => {
                    this.dictionary[cipher] = index;
                });
            } catch (er) {
                throw Error("Unsupported base encoding.");
            }
            this.unbase = this._dictunbaser;
        }
    }

    _dictunbaser(value) {
        let ret = 0;
        [...value].reverse().forEach((cipher, index) => {
            ret = ret + ((Math.pow(this.base, index)) * this.dictionary[cipher]);
        });
        return ret;
    }
}

function unpack(source) {
    function _filterargs(source) {
        const juicers = [
            /}\('(.*)', *(\d+|\[\]), *(\d+), *'(.*)'\.split\('\|'\), *(\d+), *(.*)\)\)/,
            /}\('(.*)', *(\d+|\[\]), *(\d+), *'(.*)'\.split\('\|'\)/,
        ];
        for (const juicer of juicers) {
            const args = juicer.exec(source);
            if (args) {
                let a = args;
                try {
                    return {
                        payload: a[1],
                        symtab: a[4].split("|"),
                        radix: parseInt(a[2]),
                        count: parseInt(a[3]),
                    };
                } catch (ValueError) {
                    throw Error("Corrupted p.a.c.k.e.r. data.");
                }
            }
        }
        throw Error("Could not make sense of p.a.c.k.e.r data (unexpected code structure)");
    }

    let { payload, symtab, radix, count } = _filterargs(source);

    if (count != symtab.length) {
        throw Error("Malformed p.a.c.k.e.r. symtab.");
    }

    let unbase;
    try {
        unbase = new Unbaser(radix);
    } catch (e) {
        throw Error("Unknown p.a.c.k.e.r. encoding.");
    }

    function lookup(match) {
        const word = match;
        let word2;
        if (radix == 1) {
            word2 = symtab[parseInt(word)];
        } else {
            word2 = symtab[unbase.unbase(word)];
        }
        return word2 || word;
    }

    source = payload.replace(/\b\w+\b/g, lookup);
    return source;
}


async function fetchv2(url, headers = {}, method = "GET", body = null, redirect = true, encoding = "utf-8") {
    const processedBody = (method !== "GET" && body && typeof body === 'object') 
        ? JSON.stringify(body)
        : (method !== "GET" ? body : null); //GET request should not have a body

    const options = {
        method,
        headers,
        body: processedBody,
        redirect: redirect ? 'follow' : 'manual', 
		//follow: atuomatically follows HTTP redirects
		//manual: don't follow them, you'll handle it
    };

    try {
        const response = await fetch(url, options);
		//sends the HTTP request
		//waits for the fetch() promise to resolve
		//contains metadata about the HTTP response

        const rawBuffer = await response.arrayBuffer();
		//reads the response body as binary data
		//useful when the response is not plain text (like files, images, etc)

        const decoder = new TextDecoder(encoding || "utf-8");
		//converts an ArrayBuffer string using specified encoding 
		//if no encoding is specified it will use "utf-8"

        const decodedText = decoder.decode(rawBuffer);
		//raw response body text
		//Example: '{"success":true,"data":[1,2,3]}'

        const result = {
            headers: Object.fromEntries(response.headers.entries()),
			//response.headers.entries() gives an iterator of key-value pairs
			//Object.fromEntries converts it to a plain object
			// E.g., [["content-type", "application/json"]] → { "content-type": "application/json" }

            status: response.status,
			//HTTP status code
            _data: decodedText,
            text: function () {
                return Promise.resolve(this._data);
            },
			//returns a promise that resolves to a string

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
        return Promise.reject(err.message || "Unknown error");
    }
}

// ***** LOCAL TESTING

//3_20260601165107_35979d636e3fab19a98113c2_30fde646501cf62e3590b08b944947acaf1a8b2e_000_20260604165107_0041_dnld
//curl -L -H "Referer: https://animex.one" -H "Origin: https://animex.one" -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:151.0) Gecko/20100101 Firefox/151.0" --output "output.mp4" "https://mp4.24stream.xyz/storage/media6/videos/bndqfD6H7DyHeumFL/sub/6?Authorization=3_20260601165107_35979d636e3fab19a98113c2_30fde646501cf62e3590b08b944947acaf1a8b2e_000_20260604165107_0041_dnld"

(async() => {
    try {
        const results = await searchResults('Erased');
        const searchList = JSON.parse(results);
        if (!searchList.length || !searchList[0].href) {
            throw new Error("No search results found for query");
        }
        const href = searchList[0].href;
        console.log("HREF:", href);

        const details = await extractDetails(href);
        console.log("Details: ", details);

        const episodes = await extractEpisodes(href);
        const episodeList = JSON.parse(episodes);
        console.log("Episode List: ", episodeList);

        if (!episodeList.length || episodeList[0].href === "Error") {
            throw new Error("No episodes found (or extractEpisodes failed)");
        }
        
        const firstEpisodeHref = episodeList[5].href;
        console.log("EPISODE HREF:", firstEpisodeHref);

        const streamUrl = await extractStreamUrl(firstEpisodeHref);
        const parsed = JSON.parse(streamUrl);

        const streams = parsed.streams || [];
        const subtitle = parsed.subtitle || null; // NOTE: key is "subtitle", not "subtitles"

        if (!streams.length) {
            console.log("No streams were extracted — nothing to download.");
            return;
        }

        console.log("\n===== STREAMS =====");
        streams.forEach(s => {
            const subUrl = s.subtitleUrl || subtitle || null;
            const refHeader = s.headers?.Referer || "https://animex.one";
            const originHeader = s.headers?.Origin || "https://animex.one";
            const uaHeader = s.headers?.["User-Agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:151.0) Gecko/20100101 Firefox/151.0";

            console.log(`\n[${s.title}]`);
            console.log(`\n# 1. Download video:`);
            console.log(`curl -L -H "Referer: ${refHeader}" -H "Origin: ${originHeader}" -H "User-Agent: ${uaHeader}" --output "output.mp4" "${s.streamUrl}"`);
            console.log(`python -m yt_dlp --add-header "Referer: ${refHeader}" --add-header "Origin:${originHeader}" --add-header "User-Agent:${uaHeader}" --no-check-certificate --extractor-args "generic:impersonate" --downloader curl -o "output.mp4" "${s.streamUrl}"`);

            console.log(`\n# 2. Download subtitles separately:`);
            if (subUrl) {
                console.log(`python -m yt_dlp "${subUrl}" -o "subs.vtt"`);
            } else {
                console.log(`# No subtitles available for this stream`);
            }

            console.log(`\n# 3. Merge video + subtitles:`);
            if (subUrl) {
                console.log(`ffmpeg -i "output.mp4" -i "subs.vtt" -c copy -c:s mov_text -metadata:s:s:0 language=eng output_with_subs.mp4`);
            } else {
                console.log(`# Skip merge — no subs`);
            }
        });

        console.log("\n===== SUBTITLE =====");
        console.log(subtitle || "No subtitle found");
    } catch (err) {
        console.error("Local test failed:", err.message || err);
    }
})();

// ***** LOCAL TESTING
