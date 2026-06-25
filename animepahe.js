const mangayomiSources = [
  {
    "name": "AnimePahe",
    "lang": "en",
    "id": 482964175,
    "baseUrl": "https://animepahe.com",
    "apiUrl": "",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://animepahe.com/",
    "typeSource": "single",
    "itemType": 1,
    "version": "1.0.0",
    "pkgPath": "anime/src/en/animepahe.js"
  }
];

class DefaultExtension extends MProvider {
  constructor() {
    super();
    this.client = new Client();
  }

  getHeaders(url) {
    return {
      "Cookie": "__ddg2_=1234567890",
      "Referer": this.source.baseUrl + "/"
    };
  }

  async req(path) {
    var url = this.source.baseUrl + path;
    var res = await this.client.get(url, this.getHeaders());
    return res.body;
  }

  // ─── Popular / Latest ─────────────────────────────────────────────────

  async getPopular(page) {
    return await this.getLatestUpdates(page);
  }

  get supportsLatest() {
    return true;
  }

  async getLatestUpdates(page) {
    var body = await this.req("/api?m=airing&page=" + page);
    var json = JSON.parse(body);
    var list = [];
    var data = json.data || [];
    for (var i = 0; i < data.length; i++) {
      var item = data[i];
      list.push({
        name: item.anime_title,
        imageUrl: item.snapshot || "",
        link: "/anime/" + item.anime_session
      });
    }
    return { list: list, hasNextPage: true };
  }

  // ─── Search ───────────────────────────────────────────────────────────

  async search(query, page, filters) {
    var body = await this.req("/api?m=search&l=8&q=" + encodeURIComponent(query));
    var json = JSON.parse(body);
    var list = [];
    var data = json.data || [];
    for (var i = 0; i < data.length; i++) {
      var item = data[i];
      list.push({
        name: item.title,
        imageUrl: item.poster || "",
        link: "/anime/" + item.session
      });
    }
    return { list: list, hasNextPage: false };
  }

  // ─── Detail ───────────────────────────────────────────────────────────

  async getDetail(url) {
    var baseUrl = this.source.baseUrl;
    var slug = url.replace(baseUrl, "");
    var session = slug.replace("/anime/", "");

    var body = await this.req(slug);
    var doc = new Document(body);

    var title = doc.selectFirst("span.sr-only.unselectable").text;
    if (!title || title.length < 1) {
      title = doc.selectFirst("h2.japanese").text;
    }
    var imageUrl = doc.selectFirst(".anime-poster a").attr("href");
    var description = doc.selectFirst(".anime-synopsis").text;

    var genreEls = doc.select(".anime-genre > ul a");
    var genre = [];
    for (var i = 0; i < genreEls.length; i++) {
      genre.push(genreEls[i].text);
    }

    var status = 5;
    if (doc.select("a[href='/anime/airing']").length > 0) {
      status = 0;
    } else if (doc.select("a[href='/anime/completed']").length > 0) {
      status = 1;
    }

    var chapters = await this.fetchEpisodes(session);

    return {
      title: title,
      imageUrl: imageUrl,
      description: description,
      status: status,
      genre: genre,
      chapters: chapters,
      link: slug
    };
  }

  async fetchEpisodes(session) {
    var chapters = [];
    try {
      var body = await this.req("/api?m=release&id=" + session + "&sort=episode_asc&page=1");
      var json = JSON.parse(body);
      var lastPage = json.last_page || 1;

      this.addEpisodes(chapters, json.data, session);

      for (var p = 2; p <= lastPage; p++) {
        try {
          var pageBody = await this.req("/api?m=release&id=" + session + "&sort=episode_asc&page=" + p);
          var pageJson = JSON.parse(pageBody);
          this.addEpisodes(chapters, pageJson.data, session);
        } catch (e) {
          console.log("Episode page error: " + e);
        }
      }
    } catch (e) {
      console.log("Episodes error: " + e);
    }
    return chapters;
  }

  addEpisodes(chapters, data, session) {
    if (!data) return;
    for (var i = 0; i < data.length; i++) {
      var ep = data[i];
      var name = ep.title && ep.title.length > 0 ? ep.title : "Episode " + ep.episode;
      chapters.push({
        name: name,
        url: "/play/" + session + "/" + ep.session,
        dateUpload: ep.created_at ? new Date(ep.created_at).getTime().toString() : null,
        scanlator: "Ep " + ep.episode
      });
    }
  }

  // ─── Video List ───────────────────────────────────────────────────────

  async getVideoList(url) {
    var baseUrl = this.source.baseUrl;
    var slug = url.replace(baseUrl, "");
    var body = await this.req(slug);
    var doc = new Document(body);
    var videos = [];

    var buttons = doc.select("#resolutionMenu button");
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      var href = btn.attr("data-src");
      if (!href || href.indexOf("kwik") === -1) continue;

      var spanEl = btn.selectFirst("span");
      var spanText = spanEl ? spanEl.text.toLowerCase() : "";
      var type = spanText.indexOf("eng") > -1 ? "DUB" : "SUB";

      var text = btn.text;
      var qMatch = text.match(/(.+?)\s+·\s+(\d{3,4}p)/);
      var source = qMatch ? qMatch[1].trim() : "Unknown";
      var quality = qMatch ? qMatch[2] : "";

      var extracted = await this.extractKwik(href, "AnimePahe " + source + " [" + type + "] " + quality);
      for (var j = 0; j < extracted.length; j++) {
        videos.push(extracted[j]);
      }
    }

    var dlLinks = doc.select("div#pickDownload > a");
    for (var i = 0; i < dlLinks.length; i++) {
      var a = dlLinks[i];
      var href = a.attr("href");
      if (!href || href.indexOf("kwik") === -1) continue;

      var spanEl = a.selectFirst("span");
      var spanText = spanEl ? spanEl.text.toLowerCase() : "";
      var type = spanText.indexOf("eng") > -1 ? "DUB" : "SUB";

      var text = a.text;
      var qMatch = text.match(/(.+?)\s+·\s+(\d{3,4}p)/);
      var source = qMatch ? qMatch[1].trim() : "Unknown";
      var quality = qMatch ? qMatch[2] : "";

      var extracted = await this.extractKwik(href, "AnimePahe Pahe " + source + " [" + type + "] " + quality);
      for (var j = 0; j < extracted.length; j++) {
        videos.push(extracted[j]);
      }
    }

    return videos;
  }

  async extractKwik(kwikUrl, label) {
    var videos = [];
    try {
      var headers = {
        "Referer": this.source.baseUrl + "/",
        "Cookie": "__ddg2_=1234567890"
      };
      var res = await this.client.get(kwikUrl, headers);
      var html = res.body;

      var unpacked = unpackJsAndCombine(html);
      if (!unpacked || unpacked.length < 10) {
        var evalMatch = html.match(/(eval\(function\(p,a,c,k,e,d\)[\s\S]*?\)\))/);
        if (evalMatch) {
          unpacked = unpackJs(evalMatch[1]);
        }
      }

      if (!unpacked || unpacked.length < 10) {
        console.log("Kwik unpack failed for: " + kwikUrl);
        return videos;
      }

      var m3u8Match = unpacked.match(/source\s*=\s*'(https?:[^']+\.m3u8[^']*)'/);
      if (m3u8Match) {
        videos.push({
          url: m3u8Match[1],
          originalUrl: m3u8Match[1],
          quality: label,
          headers: {
            "Referer": "https://kwik.cx/",
            "Origin": "https://kwik.cx"
          }
        });
      }
    } catch (e) {
      console.log("Kwik error: " + e);
    }
    return videos;
  }

  // ─── Stubs ────────────────────────────────────────────────────────────

  async getPageList(url) { return []; }
  getFilterList() { return []; }
  getSourcePreferences() { return []; }
}
