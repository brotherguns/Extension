const mangayomiSources = [
  {
    "name": "AnimePahe",
    "lang": "en",
    "baseUrl": "https://animepahe.ru",
    "apiUrl": "",
    "iconUrl": "https://www.google.com/s2/favicons?sz=64&domain=https://animepahe.ru/",
    "typeSource": "single",
    "isManga": false,
    "version": "1.0.0",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "anime/src/en/animepahe.js"
  }
];

class DefaultExtension extends MProvider {
  constructor() {
    super();
    this.baseUrl = "https://animepahe.ru";
  }

  get supportsLatest() {
    return true;
  }

  getHeaders(url) {
    return {
      "Cookie": "__ddg2_=1234567890",
      "Referer": this.baseUrl + "/",
    };
  }

  // ─── Home / Latest ────────────────────────────────────────────────────────

  async getPopular(page) {
    return this.getLatestUpdates(page);
  }

  async getLatestUpdates(page) {
    const url = `${this.baseUrl}/api?m=airing&page=${page}`;
    const res = await new Client().get(url, this.getHeaders());
    const json = JSON.parse(res.body);
    const list = [];
    for (const item of (json.data || [])) {
      list.push({
        name: item.anime_title,
        imageUrl: item.snapshot || "",
        link: JSON.stringify({ session: item.anime_session, name: item.anime_title }),
      });
    }
    return { list, hasNextPage: true };
  }

  // ─── Search ───────────────────────────────────────────────────────────────

  async search(query, page, filters) {
    const url = `${this.baseUrl}/api?m=search&l=8&q=${encodeURIComponent(query)}`;
    const res = await new Client().get(url, this.getHeaders());
    const json = JSON.parse(res.body);
    const list = [];
    for (const item of (json.data || [])) {
      list.push({
        name: item.title,
        imageUrl: item.poster || "",
        link: JSON.stringify({ session: item.session, name: item.title }),
      });
    }
    return { list, hasNextPage: false };
  }

  // ─── Detail ───────────────────────────────────────────────────────────────

  async getDetail(url) {
    // url is a JSON string { session, name }
    let session;
    try {
      session = JSON.parse(url).session;
    } catch (_) {
      // fallback: raw session string
      session = url;
    }

    const pageUrl = `${this.baseUrl}/anime/${session}`;
    const res = await new Client().get(pageUrl, this.getHeaders());
    const doc = new Document(res.body);

    const name =
      doc.selectFirst("span.sr-only.unselectable")?.text ||
      doc.selectFirst("h2.japanese")?.text ||
      "";

    const imageUrl = doc.selectFirst(".anime-poster a")?.getHref || "";

    const description = doc.selectFirst(".anime-synopsis")?.text || "";

    const statusText = doc.selectFirst("a[href='/anime/airing']")
      ? "0" // Ongoing
      : doc.selectFirst("a[href='/anime/completed']")
      ? "1" // Completed
      : "5";
    const status = parseInt(statusText);

    const genre = [];
    for (const el of doc.select(".anime-genre > ul a")) {
      genre.push(el.text);
    }

    // Episode list — fetch all pages
    const episodes = await this._fetchAllEpisodes(session);

    return {
      name,
      imageUrl,
      description,
      status,
      genre,
      episodes,
    };
  }

  async _fetchAllEpisodes(session) {
    const episodes = [];

    const firstUrl = `${this.baseUrl}/api?m=release&id=${session}&sort=episode_asc&page=1`;
    const firstRes = await new Client().get(firstUrl, this.getHeaders());
    const firstJson = JSON.parse(firstRes.body);

    const lastPage = firstJson.last_page || 1;

    // Collect episodes from first page
    for (const ep of (firstJson.data || [])) {
      episodes.push(this._makeEpisode(session, ep));
    }

    // Fetch remaining pages
    for (let p = 2; p <= lastPage; p++) {
      const pUrl = `${this.baseUrl}/api?m=release&id=${session}&sort=episode_asc&page=${p}`;
      const pRes = await new Client().get(pUrl, this.getHeaders());
      const pJson = JSON.parse(pRes.body);
      for (const ep of (pJson.data || [])) {
        episodes.push(this._makeEpisode(session, ep));
      }
    }

    return episodes;
  }

  _makeEpisode(session, ep) {
    const epData = JSON.stringify({
      session,
      episode_session: ep.session,
      episode: ep.episode,
    });
    return {
      name: ep.title ? ep.title : `Episode ${ep.episode}`,
      url: epData,
      imageUrl: ep.snapshot || "",
      dateUpload: ep.created_at || "",
    };
  }

  // ─── Video List ───────────────────────────────────────────────────────────

  async getVideoList(url) {
    let epInfo;
    try {
      epInfo = JSON.parse(url);
    } catch (_) {
      return [];
    }

    const playUrl = `${this.baseUrl}/play/${epInfo.session}/${epInfo.episode_session}`;
    const res = await new Client().get(playUrl, this.getHeaders());
    const doc = new Document(res.body);

    const videos = [];

    // Stream buttons (#resolutionMenu)
    for (const btn of doc.select("#resolutionMenu button")) {
      const dubSpan = btn.selectFirst("span")?.text?.toLowerCase() || "";
      const type = dubSpan.includes("eng") ? "DUB" : "SUB";
      const text = btn.text;
      const qualityMatch = text.match(/(.+?)\s+·\s+(\d{3,4}p)/);
      const source = qualityMatch ? qualityMatch[1].trim() : "Unknown";
      const quality = qualityMatch ? qualityMatch[2] : "";
      const href = btn.attr("data-src");

      if (href && href.includes("kwik")) {
        const kwikVideos = await this._extractKwik(href, `AnimePahe ${source} [${type}] ${quality}`);
        videos.push(...kwikVideos);
      }
    }

    // Download links (#pickDownload)
    for (const a of doc.select("div#pickDownload > a")) {
      const href = a.attr("href");
      if (!href) continue;
      const dubSpan = a.selectFirst("span")?.text?.toLowerCase() || "";
      const type = dubSpan.includes("eng") ? "DUB" : "SUB";
      const text = a.text;
      const qualityMatch = text.match(/(.+?)\s+·\s+(\d{3,4}p)/);
      const source = qualityMatch ? qualityMatch[1].trim() : "Unknown";
      const quality = qualityMatch ? qualityMatch[2] : "";

      if (href.includes("kwik")) {
        const kwikVideos = await this._extractKwik(href, `AnimePahe ${source} [${type}] ${quality}`);
        videos.push(...kwikVideos);
      }
    }

    return videos;
  }

  // ─── Kwik extractor ───────────────────────────────────────────────────────

  async _extractKwik(kwikUrl, label) {
    const videos = [];
    try {
      const res = await new Client().get(kwikUrl, {
        "Referer": this.baseUrl + "/",
        "Cookie": "__ddg2_=1234567890",
      });
      const html = res.body;

      // Find p,a,c,k,e,d packed JS
      const scriptMatch = html.match(/\(function\(p,a,c,k,e,d\)[\s\S]*?<\/script>/);
      if (!scriptMatch) return videos;

      const packed = scriptMatch[0].replace(/<\/script>$/, "");
      const unpacked = this._unpack(packed);
      if (!unpacked) return videos;

      // Extract m3u8 URL
      const m3u8Match = unpacked.match(/source=\s*'(.*?\.m3u8.*?)'/);
      if (!m3u8Match) return videos;
      const m3u8Url = m3u8Match[1];

      const title = (html.match(/<title>(.*?)<\/title>/) || [])[1] || label;

      videos.push({
        url: m3u8Url,
        originalUrl: m3u8Url,
        quality: label,
        headers: {
          "Referer": "https://kwik.cx/",
          "Origin": "https://kwik.cx",
        },
      });

      // Also produce a direct MP4 download link
      const mp4Url = m3u8Url
        .replace("/stream/", "/mp4/")
        .replace(/\/[^/]+$/, "");
      const fileName = title.replace(/\.mp4$/, "") + ".mp4";
      videos.push({
        url: `${mp4Url}?file=${encodeURIComponent(fileName)}`,
        originalUrl: `${mp4Url}?file=${encodeURIComponent(fileName)}`,
        quality: `${label} [Download]`,
        headers: {
          "Referer": kwikUrl,
          "Origin": "https://kwik.cx",
        },
      });
    } catch (e) {
      // swallow per-extractor errors
    }
    return videos;
  }

  // Dean Edwards p,a,c,k,e,d unpacker (JS port)
  _unpack(source) {
    try {
      const match = source.match(
        /\}\('(.*)',(\d+),(\d+),'(.*?)'\.split\('\|'\)/
      );
      if (!match) return null;
      let [, payload, radix, count, symtab] = match;
      radix = parseInt(radix);
      symtab = symtab.split("|");

      const unbase = (str) => {
        const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
        let result = 0;
        for (const ch of str) {
          result = result * radix + alphabet.indexOf(ch);
        }
        return result;
      };

      const lookup = (word) => {
        const idx = unbase(word);
        return symtab[idx] || word;
      };

      return payload.replace(/\b\w+\b/g, lookup);
    } catch (_) {
      return null;
    }
  }

  // ─── Unused for anime ─────────────────────────────────────────────────────

  async getPageList(url) {
    return [];
  }

  getFilterList() {
    return [];
  }

  getSourcePreferences() {
    return [
      {
        key: "animepahe_server",
        listPreference: {
          title: "Server",
          summary: "",
          valueIndex: 0,
          entries: ["animepahe.ru", "animepahe.com", "animepahe.org"],
          entryValues: [
            "https://animepahe.ru",
            "https://animepahe.com",
            "https://animepahe.org",
          ],
        },
      },
    ];
  }
}
