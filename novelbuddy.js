async function searchResults(keyword) {
    try {
        const allResults = [];
        let page = 1;
        let hasNext = true;

        while (hasNext) {
            const url = `https://novelbuddy.com/search?sort=views&q=${encodeURIComponent(keyword)}&page=${page}`;
            console.log(url);

            const responseText = await soraFetch(url);
            const html = await responseText.text();

            const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
            if (!match) {
                console.log(`Could not find __NEXT_DATA__ on page ${page}`);
                break;
            }

            const nextData = JSON.parse(match[1]);
            const items = nextData?.props?.pageProps?.ssrItems || [];
            const pagination = nextData?.props?.pageProps?.ssrPagination || {};

            const pageResults = items.map(item => ({
                title: item.name,
                href: `https://novelbuddy.com${item.url}`,
                image: item.cover
            }));

            allResults.push(...pageResults);

            hasNext = pagination.has_next === true;
            page += 1;
        }

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
        const manga = nextData?.props?.pageProps?.initialManga;

        if (!manga) {
            console.log('Could not find initialManga in __NEXT_DATA__');
            return JSON.stringify([{ description: 'Error loading description', aliases: 'Unknown', airdate: '' }]);
        }

        const description = manga.summary || 'No description available';

        // De-dupe authors (the source data sometimes repeats the same author)
        const seenAuthors = new Set();
        const authors = (manga.authors || [])
            .map(a => a.name)
            .filter(name => {
                if (seenAuthors.has(name)) return false;
                seenAuthors.add(name);
                return true;
            })
            .join(', ') || 'Unknown';

        const status = manga.status || 'Unknown';

        // De-dupe genres (also repeated in the source data)
        const seenGenres = new Set();
        const genres = (manga.genres || [])
            .map(g => g.name)
            .filter(name => {
                if (seenGenres.has(name)) return false;
                seenGenres.add(name);
                return true;
            })
            .join(', ') || 'Unknown';

        const chapters = manga.stats?.chaptersCount ?? 'Unknown';
        const lastUpdate = manga.updatedAt
            ? new Date(manga.updatedAt).toLocaleDateString()
            : 'Unknown';

        const aliases = `
            Author(s): ${authors}
            Status: ${status}
            Genres: ${genres}
            Chapters: ${chapters}
            Last update: ${lastUpdate}
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
        //view-source:https://novelbuddy.com/reverend-insanity
        //https://codebeautify.org/htmlviewer
        if (!nextDataMatch) {
            console.log('Could not find __NEXT_DATA__');
            return JSON.stringify([]);
        }

        
        const nextData = JSON.parse(nextDataMatch[1]);
        
        const manga = nextData?.props?.pageProps?.initialManga;

        if (!manga || !manga.id) {
            console.log('Could not find manga id in __NEXT_DATA__');
            return JSON.stringify([]);
        }

        const mangaId = manga.id;
        console.log(mangaId); //vKY5Lk89
        const cv = manga.cv || Date.now(); // fallback if cv is ever missing
        console.log(cv); //1782613842183

        const apiUrl = `https://api.novelbuddy.com/titles/${mangaId}/chapters?cv=${cv}`;
        console.log(apiUrl);

        const apiResponse = await soraFetch(apiUrl);
        const apiJson = await apiResponse.json();

        if (!apiJson?.success || !apiJson?.data?.chapters) {
            console.log('Unexpected API response shape: ' + JSON.stringify(apiJson).slice(0, 300));
            return JSON.stringify([]);
        }

        const rawChapters = apiJson.data.chapters;

        // API returns newest-first; reverse to oldest-first and number sequentially
        const chapters = rawChapters
            .slice()
            .reverse()
            .map((ch, i) => ({
                href: ch.url.startsWith('http') ? ch.url : `https://novelbuddy.com${ch.url}`,
                title: ch.name,
                number: i + 1
            }));

        return JSON.stringify(chapters);
    } catch (error) {
        console.log('Fetch error in extractChapters: ' + error);
        return JSON.stringify([]);
    }
}

async function extractText(url) {
    try {
        const response = await soraFetch(url);
        const htmlText = await response.text();

        const nextDataMatch = htmlText.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
        if (!nextDataMatch) {
            throw new Error('__NEXT_DATA__ not found');
        }

        const nextData = JSON.parse(nextDataMatch[1]);
        const chapter = nextData?.props?.pageProps?.initialChapter;

        if (!chapter?.content) {
            throw new Error('initialChapter.content not found');
        }

        // chapter.content is raw HTML: <p>...</p><br><p>...</p><br>...
        const pTagRegex = /<p[^>]*>([\s\S]*?)<\/p>/g;
        const paragraphs = [];
        let match;
        while ((match = pTagRegex.exec(chapter.content)) !== null) {
            const text = match[1]
                .replace(/<\/?[^>]+>/g, '')   // strip any nested tags
                .replace(/&quot;/g, '"')
                .replace(/&nbsp;/g, ' ')
                .replace(/&ldquo;/g, '"')
                .replace(/&rdquo;/g, '"')
                .replace(/&rsquo;/g, "'")
                .replace(/&lsquo;/g, "'")
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .trim();

            // Skip empty paragraphs and known boilerplate
            const lower = text.toLowerCase();
            if (
                !text ||
                lower === '©novelbuddy' ||
                lower === 'or login with' ||
                lower === 'or login with mangabuddy account'
            ) continue;

            paragraphs.push(text);
        }

        if (paragraphs.length === 0) {
            throw new Error('No paragraphs extracted from chapter content');
        }

        const content = paragraphs.join('\n\n').trim();
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

(async() => {
    const results = await searchResults('Reverend Insanity');
    const parsedResults = JSON.parse(results);
    console.log("SEARCH RESULTS:", parsedResults);

    const href = parsedResults[0].href;
    console.log("HREF:", href);

    const details = await extractDetails(href);
    console.log("DETAILS:", details);

    const chapters = await extractChapters(href);
    const parsedChapters = JSON.parse(chapters);
    console.log(`Found ${parsedChapters.length} chapters`);

    const firstChapterHref = parsedChapters[1852].href;
    console.log("FIRST CHAPTER HREF:", firstChapterHref);

    const text = await extractText(firstChapterHref);
    console.log("\n===== CHAPTER TEXT =====");
    console.log(text);
})();



// ***** LOCAL TESTING