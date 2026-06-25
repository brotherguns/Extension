const mangayomiSources = [
  {
    "name": "AnimePahe",
    "lang": "en",
    "baseUrl": "https://animepahe.ru",
    "apiUrl": "",
    "iconUrl": "https://www.google.com/s2/favicons?sz=64&domain=https://animepahe.ru/",
    "typeSource": "single",
    "isManga": false,
    "version": "1.0.1",
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

  get supportsLatest() { return true; }

  get headers() {
    return {
      "Cookie": "__ddg2_=1234567890",
      "Referer": this.baseUrl + "/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    };
  }

  // ─── Latest / Popular ─────────────────────────────────────────────────────

  async getPopular(page) { return this.getLatestUpdates(page); }

  async getLatestUpdates(page) {
    const res = await new Client().get(`${this.baseUrl}/api?m=airing&page=${page}`, this.headers);
    const json = JSON.parse(res.body);
    const list = (json.data || []).map(item => ({
      name: item.anime_title,
      imageUrl: item.snapshot || "",
      link: JSON.stringify({ session: item.anime_session, name: item.anime_title, ts: Date.now() }),
    }));
    return { list, hasNextPage: true };
  }

  // ─── Search ───────────────────────────────────────────────────────────────

  async search(query, page, filters) {
    const res = await new Client().get(
      `${this.baseUrl}/api?m=search&l=8&q=${encodeURIComponent(query)}`,
      this.headers
    );
    const json = JSON.parse(res.body);
    const list = (json.data || []).map(item => ({
      name: item.title,
      imageUrl: item.poster || "",
      link: JSON.stringify({ session: item.session, name: item.title, ts: Date.now() }),
    }));
    return { list, hasNextPage: false };
  }

  // ─── Detail ───────────────────────────────────────────────────────────────

  async getDetail(url) {
    let parsed;
    try { parsed = JSON.parse(url); } catch (_) { parsed = { session: url, name: "", ts: 0 }; }

    let session = parsed.session;
    const name = parsed.name || "";
    const ts = parsed.ts || 0;

    // Re-search if session is older than 10 minutes (mirrors Kotlin logic)
    if (name && ts && (Date.now() - ts) > 10 * 60 * 1000) {
      try {
        const refreshed = await this.search(name, 1, null);
        if (refreshed.list && refreshed.list.length > 0) {
          const match = refreshed.list[0];
          session = JSON.parse(match.link).session;
        }
      } catch (_) {}
    }

    // Fetch anime detail page
    const res = await new Client().get(`${this.baseUrl}/anime/${session}`, this.headers);
    const doc = new Document(res.body);

    const name2 =
      doc.selectFirst("span.sr-only.unselectable")?.text ||
      doc.selectFirst("h2.japanese")?.text ||
      name;

    const imageUrl = doc.selectFirst(".anime-poster a")?.attr("href") || "";
    const description = doc.selectFirst(".anime-synopsis")?.text || "";

    const status =
      doc.selectFirst("a[href='/anime/airing']") ? 0 :
      doc.selectFirst("a[href='/anime/completed']") ? 1 : 5;

    const genre = doc.select(".anime-genre > ul a").map(el => el.text);

    const episodes = await this._fetchAllEpisodes(session);

    return { name: name2, imageUrl, description, status, genre, episodes };
  }

  async _fetchAllEpisodes(session) {
    const episodes = [];
    let lastPage = 1;

    try {
      const firstRes = await new Client().get(
        `${this.baseUrl}/api?m=release&id=${session}&sort=episode_asc&page=1`,
        this.headers
      );
      const firstJson = JSON.parse(firstRes.body);
      lastPage = firstJson.last_page || 1;

      for (const ep of (firstJson.data || [])) {
        episodes.push(this._makeEpisode(session, ep));
      }
    } catch (e) {
      return episodes;
    }

    // Fetch remaining pages concurrently (up to 5 at a time to avoid hammering)
    for (let p = 2; p <= lastPage; p++) {
      try {
        const res = await new Client().get(
          `${this.baseUrl}/api?m=release&id=${session}&sort=episode_asc&page=${p}`,
          this.headers
        );
        const json = JSON.parse(res.body);
        for (const ep of (json.data || [])) {
          episodes.push(this._makeEpisode(session, ep));
        }
      } catch (_) {}
    }

    return episodes;
  }

  _makeEpisode(session, ep) {
    return {
      name: ep.title ? ep.title : `Episode ${ep.episode}`,
      url: JSON.stringify({
        session,
        episode_session: ep.session,
        episode: ep.episode,
      }),
      imageUrl: ep.snapshot || "",
      dateUpload: ep.created_at || "",
      episodeNumber: ep.episode,
    };
  }

  // ─── Video List ───────────────────────────────────────────────────────────

  async getVideoList(url) {
    let epInfo;
    try { epInfo = JSON.parse(url); } catch (_) { return []; }

    const playUrl = `${this.baseUrl}/play/${epInfo.session}/${epInfo.episode_session}`;
    const res = await new Client().get(playUrl, this.headers);
    const doc = new Document(res.body);

    const videos = [];

    for (const btn of doc.select("#resolutionMenu button")) {
      const dubText = (btn.selectFirst("span")?.text || "").toLowerCase();
      const type = dubText.includes("eng") ? "DUB" : "SUB";
      const text = btn.text;
      const m = text.match(/(.+?)\s+·\s+(\d{3,4}p)/);
      const source = m ? m[1].trim() : "Unknown";
      const quality = m ? m[2] : "";
      const href = btn.attr("data-src") || "";

      if (href.includes("kwik")) {
        const kwikVids = await this._extractKwik(href, `AnimePahe ${source} [${type}] ${quality}`);
        videos.push(...kwikVids);
      }
    }

    for (const a of doc.select("div#pickDownload > a")) {
      const href = a.attr("href") || "";
      const dubText = (a.selectFirst("span")?.text || "").toLowerCase();
      const type = dubText.includes("eng") ? "DUB" : "SUB";
      const text = a.text;
      const m = text.match(/(.+?)\s+·\s+(\d{3,4}p)/);
      const source = m ? m[1].trim() : "Unknown";
      const quality = m ? m[2] : "";

      if (href.includes("kwik")) {
        const kwikVids = await this._extractKwik(href, `AnimePahe Pahe ${source} [${type}] ${quality}`);
        videos.push(...kwikVids);
      }
    }

    return videos;
  }

  // ─── Kwik extractor ───────────────────────────────────────────────────────

  async _extractKwik(kwikUrl, label) {
    try {
      const res = await new Client().get(kwikUrl, {
        "Referer": this.baseUrl + "/",
        "User-Agent": this.headers["User-Agent"],
        "Cookie": "__ddg2_=1234567890",
      });
      const html = res.body;

      const scriptMatch = html.match(/\(function\(p,a,c,k,e,d\)[\s\S]+?(?=<\/script>)/);
      if (!scriptMatch) return [];

      const unpacked = this._unpack(scriptMatch[0]);
      if (!unpacked) return [];

      const m3u8Match = unpacked.match(/source=\s*'(https?:[^']+\.m3u8[^']*)'/);
      if (!m3u8Match) return [];

      return [{
        url: m3u8Match[1],
        originalUrl: m3u8Match[1],
        quality: label,
        headers: {
          "Referer": "https://kwik.cx/",
          "Origin": "https://kwik.cx",
          "User-Agent": this.headers["User-Agent"],
        },
      }];
    } catch (_) {
      return [];
    }
  }

  _unpack(source) {
    try {
      const match = source.match(/\}\s*\(\s*'([\s\S]+?)',\s*(\d+),\s*(\d+),\s*'([\s\S]+?)'\.split\('\|'\)/);
      if (!match) return null;
      let [, payload, radixStr, , symtabStr] = match;
      const radix = parseInt(radixStr);
      const symtab = symtabStr.split("|");
      const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

      const unbase = str => {
        let n = 0;
        for (const ch of str) n = n * radix + alphabet.indexOf(ch);
        return n;
      };

      return payload.replace(/\b(\w+)\b/g, word => {
        const idx = unbase(word);
        return (idx < symtab.length && symtab[idx]) ? symtab[idx] : word;
      });
    } catch (_) { return null; }
  }

  // ─── Stubs ────────────────────────────────────────────────────────────────

  async getPageList(url) { return []; }
  getFilterList() { return []; }
  getSourcePreferences() { return []; }
}
