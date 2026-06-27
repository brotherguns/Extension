const mangayomiSources = [
  {
    "name": "Miruro",
    "lang": "en",
    "id": 847293651,
    "baseUrl": "https://www.miruro.tv",
    "apiUrl": "",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://www.miruro.tv/",
    "typeSource": "single",
    "itemType": 1,
    "version": "1.1.0",
    "pkgPath": "anime/src/en/miruro.js"
  }
];

// ─── Minimal inflate (DEFLATE/Gzip decoder) ─────────────────────────────
// Ported from tiny-inflate - handles gzip responses from miruro pipe API

var tinf = (function() {
  var TINF_OK = 0, TINF_DATA_ERROR = -3;

  function Tree() { this.table = new Uint16Array(16); this.trans = new Uint16Array(288); }

  var sltree = new Tree(), sdtree = new Tree();
  var length_bits = new Uint8Array(30), length_base = new Uint16Array(30);
  var dist_bits = new Uint8Array(30), dist_base = new Uint16Array(30);
  var clcidx = new Uint8Array([16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15]);
  var code_tree = new Tree(), lengths = new Uint8Array(288 + 32);

  function tinf_build_bits_base(bits, base, delta, first) {
    var i, sum;
    for (i = 0; i < delta; ++i) bits[i] = 0;
    for (i = 0; i < 30 - delta; ++i) bits[i + delta] = (i / delta) | 0;
    for (sum = first, i = 0; i < 30; ++i) { base[i] = sum; sum += 1 << bits[i]; }
  }

  function tinf_build_fixed_trees(lt, dt) {
    var i;
    for (i = 0; i < 7; ++i) lt.table[i] = 0;
    lt.table[7] = 24; lt.table[8] = 152; lt.table[9] = 112;
    for (i = 0; i < 24; ++i) lt.trans[i] = 256 + i;
    for (i = 0; i < 144; ++i) lt.trans[24 + i] = i;
    for (i = 0; i < 8; ++i) lt.trans[24 + 144 + i] = 280 + i;
    for (i = 0; i < 112; ++i) lt.trans[24 + 144 + 8 + i] = 144 + i;
    for (i = 0; i < 5; ++i) dt.table[i] = 0;
    dt.table[5] = 32;
    for (i = 0; i < 32; ++i) dt.trans[i] = i;
  }

  function tinf_build_tree(t, lengths, off, num) {
    var i, sum, offs = new Uint16Array(16);
    for (i = 0; i < 16; ++i) t.table[i] = 0;
    for (i = 0; i < num; ++i) t.table[lengths[off + i]]++;
    t.table[0] = 0;
    for (sum = 0, i = 0; i < 16; ++i) { offs[i] = sum; sum += t.table[i]; }
    for (i = 0; i < num; ++i) { if (lengths[off + i]) t.trans[offs[lengths[off + i]]++] = i; }
  }

  function Data(src, dst) {
    this.source = src; this.sourceIndex = 0;
    this.tag = 0; this.bitcount = 0;
    this.dest = dst; this.destLen = 0;
  }

  function tinf_getbit(d) {
    if (!d.bitcount--) { d.tag = d.source[d.sourceIndex++]; d.bitcount = 7; }
    var bit = d.tag & 1; d.tag >>>= 1; return bit;
  }

  function tinf_read_bits(d, num, base) {
    if (!num) return base;
    var val = 0;
    while (d.bitcount < 24) { d.tag |= d.source[d.sourceIndex++] << d.bitcount; d.bitcount += 8; }
    val = d.tag & (0xffff >>> (16 - num));
    d.tag >>>= num; d.bitcount -= num;
    return val + base;
  }

  function tinf_decode_symbol(d, t) {
    var sum = 0, cur = 0, len = 0;
    while (d.bitcount < 24) { d.tag |= d.source[d.sourceIndex++] << d.bitcount; d.bitcount += 8; }
    do { cur = 2 * cur + ((d.tag >>> len) & 1); ++len; sum += t.table[len]; cur -= t.table[len]; } while (cur >= 0);
    d.tag >>>= len; d.bitcount -= len;
    return t.trans[sum + cur];
  }

  function tinf_decode_trees(d, lt, dt) {
    var hlit, hdist, hclen, i, num, length, clen = new Uint8Array(19);
    hlit = tinf_read_bits(d, 5, 257); hdist = tinf_read_bits(d, 5, 1); hclen = tinf_read_bits(d, 4, 4);
    for (i = 0; i < 19; ++i) clen[i] = 0;
    for (i = 0; i < hclen; ++i) clen[clcidx[i]] = tinf_read_bits(d, 3, 0);
    tinf_build_tree(code_tree, clen, 0, 19);
    for (num = 0; num < hlit + hdist;) {
      var sym = tinf_decode_symbol(d, code_tree);
      if (sym < 16) { lengths[num++] = sym; }
      else if (sym === 16) { var prev = lengths[num - 1]; for (length = tinf_read_bits(d, 2, 3); length; --length) lengths[num++] = prev; }
      else if (sym === 17) { for (length = tinf_read_bits(d, 3, 3); length; --length) lengths[num++] = 0; }
      else { for (length = tinf_read_bits(d, 7, 11); length; --length) lengths[num++] = 0; }
    }
    tinf_build_tree(lt, lengths, 0, hlit);
    tinf_build_tree(dt, lengths, hlit, hdist);
  }

  // Ensure dest has room for `extra` more bytes; grow if needed. Returns d.dest.
  function tinf_ensure(d, extra) {
    if (d.destLen + extra <= d.dest.length) return;
    var newLen = d.dest.length * 2;
    while (newLen < d.destLen + extra) newLen *= 2;
    var newDest = new Uint8Array(newLen);
    newDest.set(d.dest.subarray(0, d.destLen));
    d.dest = newDest;
  }

  function tinf_inflate_block_data(d, lt, dt) {
    for (;;) {
      var sym = tinf_decode_symbol(d, lt);
      if (sym === 256) return TINF_OK;
      if (sym < 256) {
        tinf_ensure(d, 1);
        d.dest[d.destLen++] = sym;
      } else {
        sym -= 257;
        var length = tinf_read_bits(d, length_bits[sym], length_base[sym]);
        var dist = tinf_decode_symbol(d, dt);
        var offs = d.destLen - tinf_read_bits(d, dist_bits[dist], dist_base[dist]);
        tinf_ensure(d, length);
        for (var i = offs; i < offs + length; ++i) d.dest[d.destLen++] = d.dest[i];
      }
    }
  }

  function tinf_inflate_uncompressed(d) {
    var length, invlength;
    while (d.bitcount > 8) { d.sourceIndex--; d.bitcount -= 8; }
    length = d.source[d.sourceIndex + 1]; length = 256 * length + d.source[d.sourceIndex];
    d.sourceIndex += 4;
    tinf_ensure(d, length);
    for (var i = length; i; --i) d.dest[d.destLen++] = d.source[d.sourceIndex++];
    d.bitcount = 0;
  }

  tinf_build_fixed_trees(sltree, sdtree);
  tinf_build_bits_base(length_bits, length_base, 4, 3);
  tinf_build_bits_base(dist_bits, dist_base, 2, 1);
  length_bits[28] = 0; length_base[28] = 258;

  return {
    inflate: function(source, expectedSize) {
      var initial = expectedSize && expectedSize > 0 ? expectedSize : Math.max(source.length * 4, 1024);
      var dest = new Uint8Array(initial);
      var d = new Data(source, dest);
      var bfinal, btype;
      do {
        bfinal = tinf_getbit(d);
        btype = tinf_read_bits(d, 2, 0);
        if (btype === 0) tinf_inflate_uncompressed(d);
        else if (btype === 1) tinf_inflate_block_data(d, sltree, sdtree);
        else if (btype === 2) { var lt = new Tree(), dt = new Tree(); tinf_decode_trees(d, lt, dt); tinf_inflate_block_data(d, lt, dt); }
      } while (!bfinal);
      return d.dest.subarray(0, d.destLen);
    }
  };
})();

// base64 decode lookup table — built once at module load
var B64_LOOKUP = (function() {
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var lookup = new Uint8Array(128);
  for (var i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;
  return lookup;
})();

function b64ToBytes(b64) {
  var lookup = B64_LOOKUP;
  var len = b64.length, pads = 0;
  if (len === 0) return new Uint8Array(0);
  if (b64[len - 1] === "=") pads++;
  if (b64[len - 2] === "=") pads++;
  var byteLen = ((len * 3) >> 2) - pads;
  var bytes = new Uint8Array(byteLen);
  var p = 0;
  for (var i = 0; i < len; i += 4) {
    var a = lookup[b64.charCodeAt(i)], b = lookup[b64.charCodeAt(i+1)];
    var c = lookup[b64.charCodeAt(i+2)], d = lookup[b64.charCodeAt(i+3)];
    bytes[p++] = (a << 2) | (b >> 4);
    if (p < byteLen) bytes[p++] = ((b & 15) << 4) | (c >> 2);
    if (p < byteLen) bytes[p++] = ((c & 3) << 6) | d;
  }
  return bytes;
}

function deobfuscate(body) {
  // base64url -> base64
  var b64 = body.replace(/-/g, "+").replace(/_/g, "/");
  var rem = b64.length % 4;
  if (rem === 2) b64 += "==";
  else if (rem === 3) b64 += "=";
  else if (rem === 1) throw new Error("deobfuscate: invalid base64 length");
  // decode base64 to bytes
  var compressed = b64ToBytes(b64);
  if (compressed.length < 18) throw new Error("deobfuscate: body too short for gzip");
  // skip gzip header (10 bytes minimum)
  var offset = 10;
  if (compressed[3] & 4) { offset += 2 + compressed[offset] + (compressed[offset+1] << 8); }
  if (compressed[3] & 8) { while (offset < compressed.length && compressed[offset++] !== 0); }
  if (compressed[3] & 16) { while (offset < compressed.length && compressed[offset++] !== 0); }
  if (compressed[3] & 2) offset += 2;
  // Read expected decompressed size from gzip footer (ISIZE, last 4 bytes)
  var isize = compressed[compressed.length-4] | (compressed[compressed.length-3]<<8) | (compressed[compressed.length-2]<<16) | ((compressed[compressed.length-1]<<24)>>>0);
  // inflate the deflate stream
  var deflateData = compressed.subarray(offset, compressed.length - 8);
  if (deflateData.length === 0) throw new Error("deobfuscate: empty deflate stream");
  var inflated = tinf.inflate(deflateData, isize + 64);
  return utf8Decode(inflated).replace(/\0+$/, "");
}

// UTF-8 byte array -> string. Prefers native TextDecoder (orders of magnitude
// faster than a hand-rolled loop in QuickJS), falls back to manual decode.
var utf8Decode = (function() {
  if (typeof TextDecoder !== "undefined") {
    var dec = new TextDecoder("utf-8");
    return function(bytes) { return dec.decode(bytes); };
  }
  // ES5 fallback. Bulk-decodes ASCII runs with fromCharCode.apply (far faster
  // than per-byte concat in QuickJS); only multi-byte sequences go char-by-char.
  return function(inflated) {
    var parts = [];
    var code = [];
    var i = 0;
    var n = inflated.length;
    while (i < n) {
      var c = inflated[i];
      if (c < 128) {
        code.push(c);
        i++;
      } else if (c < 224) {
        code.push(((c & 31) << 6) | (inflated[i+1] & 63));
        i += 2;
      } else if (c < 240) {
        code.push(((c & 15) << 12) | ((inflated[i+1] & 63) << 6) | (inflated[i+2] & 63));
        i += 3;
      } else {
        var cp = ((c & 7) << 18) | ((inflated[i+1] & 63) << 12) | ((inflated[i+2] & 63) << 6) | (inflated[i+3] & 63);
        cp -= 0x10000;
        code.push(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
        i += 4;
      }
      // Flush in bounded slices — apply() on huge arrays can overflow the stack.
      if (code.length >= 8192) {
        parts.push(String.fromCharCode.apply(null, code));
        code.length = 0;
      }
    }
    if (code.length) parts.push(String.fromCharCode.apply(null, code));
    return parts.join("");
  };
})();

// ─── Extension ──────────────────────────────────────────────────────────

class DefaultExtension extends MProvider {
  constructor() {
    super();
    this.client = new Client();
    this.anilistUrl = "https://graphql.anilist.co";
    // Default provider order — verified live for HLS reachability + speed.
    // hop is dead (HTTP 444 on every request); moo returns mp4 only, not HLS.
    this.provOrder = ["kiwi", "ally", "pewe", "bee", "bonk"];
    // Session caches (cleared on extension reload).
    this._epCache = {};
    this._detailCache = {};
  }

  getHeaders(url) {
    return { "Referer": this.source.baseUrl + "/" };
  }

  // ─── Preferences ──────────────────────────────────────────────────────

  _pref(key, def) {
    try {
      var v = new SharedPreferences().get(key);
      return (v === null || v === undefined || v === "") ? def : v;
    } catch (e) { return def; }
  }

  getSourcePreferences() {
    return [
      {
        key: "preferred_quality",
        listPreference: {
          title: "Preferred quality",
          summary: "Streams matching this quality are sorted first",
          valueIndex: 0,
          entries: ["1080p", "720p", "480p", "360p", "Auto"],
          entryValues: ["1080", "720", "480", "360", "auto"]
        }
      },
      {
        key: "preferred_provider",
        listPreference: {
          title: "Preferred provider",
          summary: "Tried first when fetching streams",
          valueIndex: 0,
          entries: ["kiwi", "ally", "pewe", "bee", "bonk"],
          entryValues: ["kiwi", "ally", "pewe", "bee", "bonk"]
        }
      },
      {
        key: "default_category",
        listPreference: {
          title: "Default audio",
          summary: "Preferred sub/dub when both exist",
          valueIndex: 0,
          entries: ["Sub", "Dub"],
          entryValues: ["sub", "dub"]
        }
      },
      {
        key: "title_lang",
        listPreference: {
          title: "Title language",
          summary: "Display titles in this language",
          valueIndex: 0,
          entries: ["English", "Romaji"],
          entryValues: ["english", "romaji"]
        }
      }
    ];
  }

  // ─── Network helpers ──────────────────────────────────────────────────

  _b64url(str) {
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var b64 = "";
    var bytes = [];
    for (var i = 0; i < str.length; i++) bytes.push(str.charCodeAt(i));
    for (var i = 0; i < bytes.length; i += 3) {
      var a = bytes[i], b = bytes[i+1], c = bytes[i+2];
      b64 += chars[a >> 2];
      b64 += chars[((a & 3) << 4) | ((b || 0) >> 4)];
      b64 += (b !== undefined) ? chars[((b & 15) << 2) | ((c || 0) >> 6)] : "";
      b64 += (c !== undefined) ? chars[c & 63] : "";
    }
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  }

  async pipe(path, query) {
    var req = JSON.stringify({ path: path, method: "GET", query: query, body: null });
    var encoded = this._b64url(req);
    var url = this.source.baseUrl + "/api/secure/pipe?e=" + encoded;
    var res = await this.client.get(url, this.getHeaders());
    var body = res.body;
    if (!body) return null;
    // Gzipped+base64url responses start with the gzip magic in base64 ("H4sI").
    if (body.indexOf("H4sI") === 0) {
      return JSON.parse(deobfuscate(body));
    }
    return JSON.parse(body);
  }

  async anilist(query, vars) {
    var res = await this.client.post(
      this.anilistUrl,
      { "Content-Type": "application/json", "Accept": "application/json" },
      { query: query, variables: vars }
    );
    return JSON.parse(res.body);
  }

  // ─── Mapping helpers ──────────────────────────────────────────────────

  _title(m) {
    var t = m.title || {};
    if (this._pref("title_lang", "english") === "romaji") {
      return t.romaji || t.english || t.native || "Unknown";
    }
    return t.english || t.romaji || t.native || "Unknown";
  }

  _makeLink(m) {
    var t = m.title || {};
    var slug = (t.romaji || t.english || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return "/info/" + m.id + "/" + slug;
  }

  _mapList(media) {
    var list = [];
    for (var i = 0; i < media.length; i++) {
      var m = media[i];
      if (!m) continue;
      var img = m.coverImage ? (m.coverImage.large || m.coverImage.extraLarge || "") : "";
      list.push({
        name: this._title(m),
        imageUrl: img,
        link: this._makeLink(m)
      });
    }
    return list;
  }

  _status(s) {
    // Mangayomi enum: 0 ongoing, 1 completed, 2 onHiatus, 3 canceled, 4 publishingFinished, 5 unknown
    if (s === "RELEASING") return 0;
    if (s === "FINISHED") return 1;
    if (s === "HIATUS") return 2;
    if (s === "CANCELLED") return 3;
    return 5;
  }

  // ─── Popular / Latest ─────────────────────────────────────────────────

  async getPopular(page) {
    var q = "query($p:Int){Page(page:$p,perPage:20){pageInfo{hasNextPage}media(type:ANIME,sort:TRENDING_DESC){id title{romaji english native}coverImage{large extraLarge}}}}";
    var d = await this.anilist(q, { p: page });
    return { list: this._mapList(d.data.Page.media), hasNextPage: d.data.Page.pageInfo.hasNextPage };
  }

  get supportsLatest() { return true; }

  async getLatestUpdates(page) {
    var q = "query($p:Int){Page(page:$p,perPage:20){pageInfo{hasNextPage}media(type:ANIME,sort:UPDATED_AT_DESC,status:RELEASING){id title{romaji english native}coverImage{large extraLarge}}}}";
    var d = await this.anilist(q, { p: page });
    return { list: this._mapList(d.data.Page.media), hasNextPage: d.data.Page.pageInfo.hasNextPage };
  }

  // ─── Search + Filters ─────────────────────────────────────────────────

  async search(query, page, filters) {
    var genreIn = [];
    var sort = "SEARCH_MATCH";
    if (filters && filters.length) {
      for (var fi = 0; fi < filters.length; fi++) {
        var f = filters[fi];
        if (f.type === "GroupFilter" && f.name === "Genres" && f.state) {
          for (var gi = 0; gi < f.state.length; gi++) {
            if (f.state[gi].state === true) genreIn.push(f.state[gi].name);
          }
        } else if (f.type === "SelectFilter" && f.name === "Sort" && f.values) {
          var sv = f.values[f.state];
          if (sv && sv.value) sort = sv.value;
        }
      }
    }
    // If no text query, default sort to TRENDING for a useful browse experience.
    if ((!query || query.length === 0) && sort === "SEARCH_MATCH") sort = "TRENDING_DESC";

    var q = "query($p:Int,$s:String,$g:[String],$sort:[MediaSort]){Page(page:$p,perPage:20){pageInfo{hasNextPage}media(type:ANIME" +
            (query && query.length ? ",search:$s" : "") +
            (genreIn.length ? ",genre_in:$g" : "") +
            ",sort:$sort){id title{romaji english native}coverImage{large extraLarge}}}}";
    var vars = { p: page, sort: [sort] };
    if (query && query.length) vars.s = query;
    if (genreIn.length) vars.g = genreIn;
    var d = await this.anilist(q, vars);
    return { list: this._mapList(d.data.Page.media), hasNextPage: d.data.Page.pageInfo.hasNextPage };
  }

  getFilterList() {
    var genres = ["Action","Adventure","Comedy","Drama","Ecchi","Fantasy","Horror","Mahou Shoujo",
      "Mecha","Music","Mystery","Psychological","Romance","Sci-Fi","Slice of Life","Sports",
      "Supernatural","Thriller"];
    var genreFilters = [];
    for (var i = 0; i < genres.length; i++) {
      genreFilters.push({ type: "CheckBoxFilter", name: genres[i], value: false, state: false });
    }
    return [
      {
        type: "SelectFilter",
        name: "Sort",
        state: 0,
        values: [
          { type: "SelectOption", name: "Default", value: "SEARCH_MATCH" },
          { type: "SelectOption", name: "Trending", value: "TRENDING_DESC" },
          { type: "SelectOption", name: "Popular", value: "POPULARITY_DESC" },
          { type: "SelectOption", name: "Score", value: "SCORE_DESC" },
          { type: "SelectOption", name: "Newest", value: "START_DATE_DESC" },
          { type: "SelectOption", name: "Title", value: "TITLE_ROMAJI" }
        ]
      },
      { type: "GroupFilter", name: "Genres", state: genreFilters }
    ];
  }

  // ─── Detail ───────────────────────────────────────────────────────────

  async getDetail(url) {
    var cleanUrl = url.replace(this.source.baseUrl, "");
    var match = cleanUrl.match(/\/info\/(\d+)/);
    if (!match) return { chapters: [] };
    var aniId = match[1];

    if (this._detailCache[aniId]) return this._detailCache[aniId];

    // AniList info first (small, fast), then Miruro episodes. Kept sequential for
    // engine portability — Promise.all timing isn't the bottleneck here.
    var q = "query($id:Int){Media(id:$id,type:ANIME){id title{romaji english native}coverImage{large extraLarge}description(asHtml:false)status genres studios(isMain:true){nodes{name}}nextAiringEpisode{episode airingAt}}}";
    var alData = await this.anilist(q, { id: parseInt(aniId) });

    var epData = null;
    try {
      epData = await this.pipe("episodes", { anilistId: aniId });
    } catch (e) {
      console.log("Miruro: episodes fetch failed: " + e);
    }

    var info = alData.data.Media;
    var name = this._title(info);
    var desc = (info.description || "").replace(/<[^>]+>/g, "");
    var studio = info.studios && info.studios.nodes && info.studios.nodes.length > 0 ? info.studios.nodes[0].name : "";
    var status = this._status(info.status);

    var chapters = this._buildChapters(aniId, epData);

    var result = {
      name: name,
      imageUrl: (info.coverImage && (info.coverImage.extraLarge || info.coverImage.large)) || "",
      description: desc,
      author: studio,
      status: status,
      genre: info.genres || [],
      chapters: chapters,
      link: cleanUrl
    };
    this._detailCache[aniId] = result;
    return result;
  }

  _buildChapters(aniId, epData) {
    var chapters = [];
    if (!epData || !epData.providers) return chapters;

    var epMap = {};
    var useProvs = this.provOrder;

    for (var pi = 0; pi < useProvs.length; pi++) {
      var pn = useProvs[pi];
      var prov = epData.providers[pn];
      if (!prov || !prov.episodes) continue;

      var catKeys = Object.keys(prov.episodes);
      for (var ci = 0; ci < catKeys.length; ci++) {
        var cat = catKeys[ci];
        if (cat !== "sub" && cat !== "dub" && cat !== "ssub") continue;
        var eps = prov.episodes[cat];
        if (!eps || !eps.length) continue;

        var isDub = (cat === "dub");

        for (var i = 0; i < eps.length; i++) {
          var ep = eps[i];
          // Guard against missing/invalid episode numbers — they corrupt keying & sorting.
          var num = ep.number;
          if (num === null || num === undefined) continue;
          var numF = parseFloat(num);
          if (isNaN(numF)) continue;
          var key = String(numF);

          if (!epMap[key]) {
            epMap[key] = { num: numF, title: "", sub: [], dub: [] };
          }
          if (ep.title && ep.title.length > 0 && epMap[key].title.length === 0) {
            epMap[key].title = ep.title;
          }
          // Preserve the original category (ssub kept distinct from sub).
          var srcEntry = { prov: pn, eid: ep.id, cat: cat };
          if (isDub) epMap[key].dub.push(srcEntry);
          else epMap[key].sub.push(srcEntry);
        }
      }
    }

    // Sort by numeric episode number.
    var keys = Object.keys(epMap);
    var entries = [];
    for (var k = 0; k < keys.length; k++) entries.push(epMap[keys[k]]);
    entries.sort(function(a, b) { return a.num - b.num; });

    var topProvs = this.provOrder;
    var pickTop = function(arr, max) {
      var picked = [];
      for (var p = 0; p < topProvs.length && picked.length < max; p++) {
        for (var a = 0; a < arr.length; a++) {
          if (arr[a].prov === topProvs[p]) { picked.push(arr[a]); break; }
        }
      }
      for (var a = 0; a < arr.length && picked.length < max; a++) {
        var dup = false;
        for (var dd = 0; dd < picked.length; dd++) { if (picked[dd].prov === arr[a].prov) { dup = true; break; } }
        if (!dup) picked.push(arr[a]);
      }
      return picked;
    };

    for (var ni = 0; ni < entries.length; ni++) {
      var data = entries[ni];
      if (data.sub.length === 0 && data.dub.length === 0) continue;

      var epTitle = data.title || ("Episode " + data.num);
      var bestSub = pickTop(data.sub, 3);
      var bestDub = pickTop(data.dub, 2);
      var allSources = bestSub.concat(bestDub);

      var tags = [];
      if (bestSub.length > 0) tags.push("SUB");
      if (bestDub.length > 0) tags.push("DUB");

      chapters.push({
        name: "E" + data.num + " - " + epTitle,
        url: JSON.stringify({ aid: aniId, num: data.num, sources: allSources }),
        scanlator: tags.join("+") + " · " + allSources.length + " sources"
      });
    }

    return chapters;
  }

  // ─── Video List ───────────────────────────────────────────────────────

  async getVideoList(url) {
    var ep;
    try { ep = JSON.parse(url); } catch(e) { return []; }

    var sources = ep.sources || [];
    if (!sources.length) return [];

    var prefProv = this._pref("preferred_provider", "");
    var prefCat = this._pref("default_category", "sub");

    // Order sources: user-preferred provider first, then verified reliability order.
    var order = [];
    if (prefProv) order.push(prefProv);
    for (var o = 0; o < this.provOrder.length; o++) {
      if (this.provOrder[o] !== prefProv) order.push(this.provOrder[o]);
    }
    var sorted = [];
    for (var ri = 0; ri < order.length; ri++) {
      for (var si = 0; si < sources.length; si++) {
        if (sources[si].prov === order[ri]) sorted.push(sources[si]);
      }
    }
    for (var si = 0; si < sources.length; si++) {
      var seen = false;
      for (var ti = 0; ti < sorted.length; ti++) { if (sorted[ti] === sources[si]) { seen = true; break; } }
      if (!seen) sorted.push(sources[si]);
    }

    // Prefer the user's audio choice ordering within the same provider priority.
    sorted.sort(function(a, b) {
      var aPref = (a.cat === prefCat || (prefCat === "sub" && a.cat === "ssub")) ? 0 : 1;
      var bPref = (b.cat === prefCat || (prefCat === "sub" && b.cat === "ssub")) ? 0 : 1;
      return aPref - bPref;
    });

    // Fetch up to 5 providers CONCURRENTLY — verified safe (~0.32s for 5 parallel,
    // no rate-limiting), ~5x faster than sequential. 5 covers all reliable providers
    // so subtitle-carrying sources (e.g. bee) stay in the fetch window.
    var maxTries = Math.min(sorted.length, 5);
    var batch = [];
    var self = this;
    for (var si = 0; si < maxTries; si++) {
      (function(src) {
        batch.push(
          self.pipe("sources", {
            episodeId: src.eid, provider: src.prov,
            category: src.cat || "", anilistId: ep.aid
          }).then(
            function(data) { return { src: src, data: data }; },
            function(e) { console.log("Miruro: " + src.prov + " failed: " + e); return null; }
          )
        );
      })(sorted[si]);
    }

    var settled = await Promise.all(batch);

    var videos = [];
    var prefQuality = this._pref("preferred_quality", "auto");
    for (var r = 0; r < settled.length; r++) {
      var item = settled[r];
      if (!item || !item.data || !item.data.streams) continue;
      var src = item.src;
      var sd = item.data;

      // Collect subtitle tracks once per source (shared across its streams).
      var subs = [];
      var subArr = sd.subtitles || sd.tracks || sd.captions || [];
      for (var su = 0; su < subArr.length; su++) {
        var t = subArr[su];
        var file = t.url || t.file || t.src;
        if (!file) continue;
        var lbl = t.lang || t.label || t.language || t.name || "Subtitle";
        if (t.kind === "thumbnails" || lbl === "thumbnails") continue;
        subs.push({ file: file, label: lbl });
      }

      for (var i = 0; i < sd.streams.length; i++) {
        var s = sd.streams[i];
        if (s.type === "hls" && s.url && s.isActive !== false) {
          var qual = s.quality || "";
          var label = src.prov + " " + qual + " [" + (s.audio || src.cat || "sub").toUpperCase() + "]";
          if (s.fansub) label += " " + s.fansub;
          var hdrs = {};
          if (s.referer) hdrs["Referer"] = s.referer;
          var vid = { url: s.url, originalUrl: s.url, quality: label, headers: hdrs };
          if (subs.length) vid.subtitles = subs;
          videos.push(vid);
        }
      }
    }

    // Sort streams by the user's preferred quality (matching quality first).
    if (prefQuality && prefQuality !== "auto") {
      videos.sort(function(a, b) {
        var am = a.quality.indexOf(prefQuality) !== -1 ? 0 : 1;
        var bm = b.quality.indexOf(prefQuality) !== -1 ? 0 : 1;
        return am - bm;
      });
    }

    return videos;
  }

  // ─── Stubs ────────────────────────────────────────────────────────────

  async getPageList(url) { return []; }
}
