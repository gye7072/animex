async function searchResults(keyword) {
    try {
        const allResults = [];
        let page = 1;
        let hasMore = true;

        while (hasMore) {
            const url = `https://wtr-lab.com/en/novel-finder?orderBy=view&text=${encodeURIComponent(keyword)}&page=${page}`;
            console.log(url);

            const responseText = await soraFetch(url);
            const html = await responseText.text();

            const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
            if (!match) {
                console.log(`Could not find __NEXT_DATA__ on page ${page}`);
                break;
            }

            const nextData = JSON.parse(match[1]);
            const series = nextData?.props?.pageProps?.series || [];

            if (series.length === 0) {
                hasMore = false;
                break;
            }

            const pageResults = series.map(item => ({
                title: item.data?.title || 'Unknown',
                href: `https://wtr-lab.com/en/novel/${item.raw_id}/${item.slug}`,
                image: item.data?.image || ''
            }));

            allResults.push(...pageResults);

            // WTR-LAB doesn't expose has_next directly in pageProps;
            // use the total count to decide whether to keep paging.
            const totalCount = parseInt(nextData?.props?.pageProps?.count || '0', 10);
            hasMore = allResults.length < totalCount;
            page += 1;
        }

        console.log(allResults);
        return JSON.stringify(allResults);
    } catch (error) {
        console.log('Fetch error in searchResults: ' + error);
        return JSON.stringify([{ title: 'Error', image: '', href: '' }]);
    }
}

async function extractDetails(url) {
    try {
        const response = await soraFetch(url);
        const htmlText = await response.text();

        const nextDataMatch = htmlText.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
        if (!nextDataMatch) {
            console.log('Could not find __NEXT_DATA__');
            return JSON.stringify([{ description: 'Error loading description', aliases: 'Unknown', airdate: '' }]);
        }

        const nextData = JSON.parse(nextDataMatch[1]);
        const serieData = nextData?.props?.pageProps?.serie?.serie_data;

        if (!serieData) {
            console.log('Could not find serie_data in __NEXT_DATA__');
            return JSON.stringify([{ description: 'Error loading description', aliases: 'Unknown', airdate: '' }]);
        }

        const description = serieData.data?.description || 'No description available';
        const author = serieData.data?.author || serieData.author || 'Unknown';
        const status = serieData.status === 1 ? 'Completed' : serieData.status === 0 ? 'Ongoing' : 'Unknown';
        const chapters = serieData.chapter_count ?? 'Unknown';
        const rating = serieData.rating ?? 'Unknown';
        const totalRatings = serieData.total_rate ?? 0;
        const views = serieData.view ?? 'Unknown';

        const aliases = `
            Author(s): ${author}
            Status: ${status}
            Chapters: ${chapters}
            Rating: ${rating} (${totalRatings} ratings)
            Views: ${views}
        `.trim();

        const transformedResults = [{ description, aliases, airdate: '' }];
        console.log(transformedResults);
        return JSON.stringify(transformedResults);
    } catch (error) {
        console.log('Details error: ' + error);
        return JSON.stringify([{ description: 'Error loading description', aliases: 'Unknown', airdate: '' }]);
    }
}


async function extractChapters(url) {
    try {
        const response = await soraFetch(url);
        const htmlText = await response.text();

        const nextDataMatch = htmlText.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
        if (!nextDataMatch) {
            console.log('Could not find __NEXT_DATA__');
            return JSON.stringify([]);
        }

        const nextData = JSON.parse(nextDataMatch[1]);
        const serieData = nextData?.props?.pageProps?.serie?.serie_data;

        if (!serieData) {
            console.log('Could not find serie_data in __NEXT_DATA__');
            return JSON.stringify([]);
        }

        const totalChapters = serieData.chapter_count;
        const novelUrl = url.replace(/\/$/, ''); // strip trailing slash if any

        if (!totalChapters) {
            console.log('No chapter_count found');
            return JSON.stringify([]);
        }

        // Build sequential chapter URLs based on the site's /chapter-N pattern.
        // NOTE: titles here are generic placeholders, not the real per-chapter
        // titles, since the full chapter list isn't present in this page's
        // __NEXT_DATA__ (only the last 5 are, under last_chapters).
        const chapters = [];
        for (let i = 1; i <= totalChapters; i++) {
            chapters.push({
                href: `${novelUrl}/chapter-${i}`,
                title: `Chapter ${i}`,
                number: i
            });
        }

        console.log(`Built ${chapters.length} chapter URLs (pattern-based, not scraped)`);
        return JSON.stringify(chapters);
    } catch (error) {
        console.log('Fetch error in extractChapters: ' + error);
        return JSON.stringify([]);
    }
}
async function extractText(url) {
    try {
        // Parse raw_id and chapter_no directly from the URL pattern:
        // https://wtr-lab.com/en/novel/{raw_id}/{slug}/chapter-{n}
        const match = url.match(/\/novel\/(\d+)\/[^/]+\/chapter-(\d+)/);
        if (!match) {
            throw new Error('Could not parse raw_id/chapter_no from URL: ' + url);
        }

        const rawId = parseInt(match[1], 10);
        const chapterNo = parseInt(match[2], 10);

        const contentResponse = await soraFetch('https://wtr-lab.com/api/reader/get', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chapter_no: chapterNo,
                force_retry: false,
                language: 'en',
                raw_id: rawId,
                retry: false,
                translate: 'ai'
            })
        });

        const contentJson = await contentResponse.json();

        if (!contentJson?.success || !contentJson?.data?.data?.body) {
            throw new Error('Unexpected response shape: ' + JSON.stringify(contentJson).slice(0, 300));
        }

        const paragraphs = contentJson.data.data.body;
        const terms = contentJson.data.data.glossary_data?.terms || [];

        const resolvedParagraphs = paragraphs.map(line =>
            line.replace(/※(\d+)[⛬〓]/g, (fullMatch, indexStr) => {
                const idx = parseInt(indexStr, 10);
                const term = terms[idx];
                return term ? term[0] : fullMatch;
            })
        );

        const content = resolvedParagraphs.join('\n\n').trim();
        console.log(`Extracted ${resolvedParagraphs.length} paragraphs for raw_id=${rawId}, chapter_no=${chapterNo}`);
        return content;
    } catch (error) {
        console.log('Fetch error in extractText: ' + error);
        return JSON.stringify({ text: 'Error extracting text' });
    }
}

// searchResults("classroom of")
// extractDetails("https://novelbuddy.com/novel/classroom-of-the-elite");
// extractChapters("https://novelbuddy.com/novel/re-zero-kara-hajimeru-isekai-seikatsu");
// extractText("https://novelbuddy.com/novel/classroom-of-the-elite/vol-0-chapter-0-prologue");
// extractText("https://novelbuddy.com/novel/classroom-of-the-elite/chapter-1vol-welcome-to-my-dream-like-school-life-intro");

async function soraFetch(url, options = { headers: {}, method: 'GET', body: null }) {
    try {
        return await fetchv2(url, options.headers ?? {}, options.method ?? 'GET', options.body ?? null);
    } catch(e) {
        try {
            return await fetch(url, options);
        } catch(error) {
            return null;
        }
    }
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
// ***** LOCAL TESTING

// (async() => {
//     const results = await searchResults('Reverend Insanity');
//     const parsedResults = JSON.parse(results);
//     console.log("SEARCH RESULTS:", parsedResults);

//     const href = parsedResults[0].href;
//     console.log("HREF:", href);

//     const details = await extractDetails(href);
//     console.log("DETAILS:", details);

//     const chapters = await extractChapters(href);
//     const parsedChapters = JSON.parse(chapters);
//     console.log(`Found ${parsedChapters.length} chapters`);

//     const firstChapterHref = parsedChapters[0].href;
//     console.log("FIRST CHAPTER HREF:", firstChapterHref);

//     const text = await extractText(firstChapterHref);
//     console.log("\n===== CHAPTER TEXT =====");
//     console.log(text);
// })();



// ***** LOCAL TESTING