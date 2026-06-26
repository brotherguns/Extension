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
    "version": "1.0.0",
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

  function tinf_inflate_block_data(d, lt, dt) {
    for (;;) {
      var sym = tinf_decode_symbol(d, lt);
      if (sym === 256) return TINF_OK;
      if (sym < 256) { d.dest[d.destLen++] = sym; }
      else {
        sym -= 257;
        var length = tinf_read_bits(d, length_bits[sym], length_base[sym]);
        var dist = tinf_decode_symbol(d, dt);
        var offs = d.destLen - tinf_read_bits(d, dist_bits[dist], dist_base[dist]);
        for (var i = offs; i < offs + length; ++i) d.dest[d.destLen++] = d.dest[i];
      }
    }
  }

  function tinf_inflate_uncompressed(d) {
    var length, invlength;
    while (d.bitcount > 8) { d.sourceIndex--; d.bitcount -= 8; }
    length = d.source[d.sourceIndex + 1]; length = 256 * length + d.source[d.sourceIndex];
    d.sourceIndex += 4;
    for (var i = length; i; --i) d.dest[d.destLen++] = d.source[d.sourceIndex++];
    d.bitcount = 0;
  }

  tinf_build_fixed_trees(sltree, sdtree);
  tinf_build_bits_base(length_bits, length_base, 4, 3);
  tinf_build_bits_base(dist_bits, dist_base, 2, 1);
  length_bits[28] = 0; length_base[28] = 258;

  return {
    inflate: function(source) {
      // Guess output size (4x input)
      var dest = new Uint8Array(source.length * 8);
      var d = new Data(source, dest);
      var bfinal, btype;
      do {
        bfinal = tinf_getbit(d);
        btype = tinf_read_bits(d, 2, 0);
        if (btype === 0) tinf_inflate_uncompressed(d);
        else if (btype === 1) tinf_inflate_block_data(d, sltree, sdtree);
        else if (btype === 2) { var lt = new Tree(), dt = new Tree(); tinf_decode_trees(d, lt, dt); tinf_inflate_block_data(d, lt, dt); }
        if (d.destLen > dest.length - 65536) {
          var newDest = new Uint8Array(dest.length * 2); newDest.set(dest); dest = newDest; d.dest = newDest;
        }
      } while (!bfinal);
      return dest.subarray(0, d.destLen);
    }
  };
})();

function b64ToBytes(b64) {
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var lookup = new Uint8Array(128);
  for (var i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;
  var len = b64.length, pads = 0;
  if (b64[len - 1] === "=") pads++;
  if (b64[len - 2] === "=") pads++;
  var byteLen = (len * 3 / 4) - pads;
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
  var pad = b64.length % 4;
  if (pad) b64 += "====".substring(pad);
  // decode base64 to bytes
  var compressed = b64ToBytes(b64);
  // skip gzip header (10 bytes minimum)
  var offset = 10;
  if (compressed[3] & 4) { offset += 2 + compressed[offset] + (compressed[offset+1] << 8); }
  if (compressed[3] & 8) { while (compressed[offset++] !== 0); }
  if (compressed[3] & 16) { while (compressed[offset++] !== 0); }
  if (compressed[3] & 2) offset += 2;
  // inflate the deflate stream
  var deflateData = compressed.subarray(offset, compressed.length - 8);
  var inflated = tinf.inflate(deflateData);
  // convert bytes to string
  var str = "";
  for (var i = 0; i < inflated.length; i += 4096) {
    var chunk = inflated.subarray(i, Math.min(i + 4096, inflated.length));
    for (var j = 0; j < chunk.length; j++) str += String.fromCharCode(chunk[j]);
  }
  // Handle UTF-8 multi-byte
  try { return decodeURIComponent(escape(str)); } catch(e) { return str; }
}

// ─── Extension ──────────────────────────────────────────────────────────

class DefaultExtension extends MProvider {
  constructor() {
    super();
    this.client = new Client();
    this.anilistUrl = "https://graphql.anilist.co";
    this.provOrder = ["kiwi", "bonk", "ally", "moo", "hop", "pewe", "bee"];
  }

  getHeaders(url) {
    return { "Referer": this.source.baseUrl + "/" };
  }

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
    if (body && body.indexOf("H4sI") === 0) {
      var decoded = deobfuscate(body);
      return JSON.parse(decoded);
    }
    return JSON.parse(body);
  }

  async anilist(query, vars) {
    var res = await this.client.post(
      this.anilistUrl,
      { "Content-Type": "application/json", "Accept": "application/json" },
      JSON.stringify({ query: query, variables: vars })
    );
    return JSON.parse(res.body);
  }

  _makeLink(m) {
    var slug = (m.title.romaji || "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return "/info/" + m.id + "/" + slug;
  }

  _mapList(media) {
    var list = [];
    for (var i = 0; i < media.length; i++) {
      var m = media[i];
      list.push({
        name: m.title.english || m.title.romaji,
        imageUrl: m.coverImage.large,
        link: this._makeLink(m)
      });
    }
    return list;
  }

  // ─── Popular / Latest ─────────────────────────────────────────────────

  async getPopular(page) {
    var q = "query($p:Int){Page(page:$p,perPage:20){pageInfo{hasNextPage}media(type:ANIME,sort:TRENDING_DESC){id title{romaji english}coverImage{large}}}}";
    var d = await this.anilist(q, { p: page });
    return { list: this._mapList(d.data.Page.media), hasNextPage: d.data.Page.pageInfo.hasNextPage };
  }

  get supportsLatest() { return true; }

  async getLatestUpdates(page) {
    var q = "query($p:Int){Page(page:$p,perPage:20){pageInfo{hasNextPage}media(type:ANIME,sort:UPDATED_AT_DESC,status:RELEASING){id title{romaji english}coverImage{large}}}}";
    var d = await this.anilist(q, { p: page });
    return { list: this._mapList(d.data.Page.media), hasNextPage: d.data.Page.pageInfo.hasNextPage };
  }

  // ─── Search ───────────────────────────────────────────────────────────

  async search(query, page, filters) {
    var q = "query($p:Int,$s:String){Page(page:$p,perPage:20){pageInfo{hasNextPage}media(type:ANIME,search:$s){id title{romaji english}coverImage{large}}}}";
    var d = await this.anilist(q, { p: page, s: query });
    return { list: this._mapList(d.data.Page.media), hasNextPage: d.data.Page.pageInfo.hasNextPage };
  }

  // ─── Detail ───────────────────────────────────────────────────────────

  async getDetail(url) {
    var cleanUrl = url.replace(this.source.baseUrl, "");
    var match = cleanUrl.match(/\/info\/(\d+)/);
    if (!match) return { chapters: [] };
    var aniId = match[1];

    // AniList info
    var q = "query($id:Int){Media(id:$id,type:ANIME){id title{romaji english native}coverImage{large extraLarge}description(asHtml:false)status genres studios(isMain:true){nodes{name}}}}";
    var alData = await this.anilist(q, { id: parseInt(aniId) });
    var info = alData.data.Media;
    var name = info.title.english || info.title.romaji;
    var desc = (info.description || "").replace(/<[^>]+>/g, "");
    var studio = info.studios && info.studios.nodes && info.studios.nodes.length > 0 ? info.studios.nodes[0].name : "";
    var status = info.status === "RELEASING" ? 0 : info.status === "FINISHED" ? 1 : 5;

    // Episodes from Miruro
    var epData = await this.pipe("episodes", { anilistId: aniId });
    var chapters = [];

    if (epData && epData.providers) {
      for (var pi = 0; pi < this.provOrder.length; pi++) {
        var pn = this.provOrder[pi];
        var prov = epData.providers[pn];
        if (!prov || !prov.episodes) continue;

        var subEps = prov.episodes["sub"] || [];
        var ssubEps = prov.episodes["ssub"] || [];
        var dubEps = prov.episodes["dub"] || [];
        var eps = subEps.length > 0 ? subEps : (ssubEps.length > 0 ? ssubEps : dubEps);

        if (eps.length > 0) {
          for (var i = 0; i < eps.length; i++) {
            var ep = eps[i];
            var epName = ep.title && ep.title.length > 0 ? ep.title : "Episode " + ep.number;
            chapters.push({
              name: "E" + ep.number + " - " + epName,
              url: JSON.stringify({
                aid: aniId, eid: ep.id, prov: pn,
                cat: ep.audio || "sub", num: ep.number
              }),
              scanlator: pn + " [" + (ep.audio || "sub").toUpperCase() + "]"
            });
          }

          // Also add dub episodes if we picked sub
          if (subEps.length > 0 && dubEps.length > 0) {
            for (var i = 0; i < dubEps.length; i++) {
              var ep = dubEps[i];
              var epName = ep.title && ep.title.length > 0 ? ep.title : "Episode " + ep.number;
              chapters.push({
                name: "E" + ep.number + " - " + epName + " [DUB]",
                url: JSON.stringify({
                  aid: aniId, eid: ep.id, prov: pn,
                  cat: "dub", num: ep.number
                }),
                scanlator: pn + " [DUB]"
              });
            }
          }
          break;
        }
      }
    }

    console.log("Miruro: " + chapters.length + " eps for " + aniId);

    return {
      name: name,
      imageUrl: info.coverImage.extraLarge || info.coverImage.large,
      description: desc,
      author: studio,
      status: status,
      genre: info.genres || [],
      chapters: chapters,
      link: cleanUrl
    };
  }

  // ─── Video List ───────────────────────────────────────────────────────

  async getVideoList(url) {
    var ep;
    try { ep = JSON.parse(url); } catch(e) { return []; }

    var videos = [];

    // Try primary provider
    try {
      var srcData = await this.pipe("sources", {
        episodeId: ep.eid, provider: ep.prov,
        category: ep.cat || "", anilistId: ep.aid
      });
      if (srcData && srcData.streams) {
        for (var i = 0; i < srcData.streams.length; i++) {
          var s = srcData.streams[i];
          if (s.type === "hls" && s.url && s.isActive !== false) {
            var label = ep.prov + " " + (s.quality || "") + " [" + (s.audio || "sub").toUpperCase() + "]";
            if (s.fansub) label += " " + s.fansub;
            var hdrs = {};
            if (s.referer) hdrs["Referer"] = s.referer;
            videos.push({ url: s.url, originalUrl: s.url, quality: label, headers: hdrs });
          }
        }
      }
    } catch(e) { console.log("Miruro source error: " + e); }

    return videos;
  }

  // ─── Stubs ────────────────────────────────────────────────────────────

  async getPageList(url) { return []; }
  getFilterList() { return []; }
  getSourcePreferences() { return []; }
}
