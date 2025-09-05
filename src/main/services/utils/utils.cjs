// ---------- helpers ----------
function _uniqCase(items) {
    const seen = new Set();
    const out = [];
    for (const s of items) {
        const k = s.toLowerCase();
        if (!seen.has(k)) { seen.add(k); out.push(s); }
    }
    return out;
}

function _clean(s) {
    return s.replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, '').trim();
}

function _pushAll(arr, vals) {
    for (const v of vals) if (v && v.trim()) arr.push(_clean(v));
}

function _matchAll(regex, text) {
    const res = [];
    let m; while ((m = regex.exec(text)) !== null) res.push(m);
    return res;
}

module.exports = {
  _uniqCase,
  _clean,
  _pushAll,
  _matchAll
};
  