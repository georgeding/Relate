// Plaud transcript parsing — pure functions, no I/O. Handles what Plaud's export/share produces:
//   .txt/.md  "Speaker 1 00:01:23" header + text lines · "[00:01:23] Speaker 1: text" · "Speaker 1: text"
//             (Chinese 说话人1 / 发言人1 too), "# Title", and a Summary / 摘要 / 总结 section
//   .srt/.vtt cues with optional "Speaker 1:" / "[Speaker 1]" / <v Speaker 1> prefixes
//   .json     [{speaker,text,start}] · {segments:[…]} · {transcript: string|[…]} (+ optional title/summary)
// parseTranscript() returns { title, ts, durationMs?, turns:[{speaker,text,offsetMs?}], summary }.

export const SUPPORTED_EXT = ['.txt', '.md', '.srt', '.vtt', '.json'];

// "Speaker 1" / "speaker1" / "说话人 1" / "发言人1" all normalize to "speaker1" so one speakerMap entry covers every spelling
const SPK_NUM = /^(?:speaker|说话人|发言人|讲话人)\s*(\d+)$/i;
const normSpeakerKey = (s) => { const t = String(s || '').trim(); const m = t.match(SPK_NUM); return m ? `speaker${m[1]}` : t.toLowerCase().replace(/\s+/g, ''); };

// accepts ["Speaker 1=Alex", …], "Speaker 1=Alex, Speaker 2=Sam", or { "Speaker 1": "Alex" }
export function parseSpeakerMap(v) {
  const map = new Map();
  if (!v) return map;
  if (typeof v === 'object' && !Array.isArray(v)) { for (const [k, name] of Object.entries(v)) if (String(name).trim()) map.set(normSpeakerKey(k), String(name).trim()); return map; }
  const items = Array.isArray(v) ? v : String(v).split(/[,;\n]+/);
  for (const it of items) {
    const i = String(it).search(/[=:：]/);
    if (i <= 0) continue;
    const k = String(it).slice(0, i).trim(), name = String(it).slice(i + 1).trim();
    if (k && name) map.set(normSpeakerKey(k), name);
  }
  return map;
}
export const applySpeaker = (speaker, map) => map.get(normSpeakerKey(speaker)) || String(speaker || '').trim() || 'Unknown';

// "01:23" → 83000 · "00:01:23,500" → 83500 · "1:02:03.25" → 3723250
export function parseClock(s) {
  const m = String(s || '').trim().match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/);
  if (!m) return null;
  const [, h, mi, se, frac] = m;
  return ((Number(h || 0) * 60 + Number(mi)) * 60 + Number(se)) * 1000 + (frac ? Number(frac.padEnd(3, '0')) : 0);
}

// date in the filename, local time: "2026-09-12 14_30 x", "2026_09_12-1430", "20260912_143000", "20260912"
export function dateFromName(name) {
  const s = String(name || '');
  const pats = [
    /(20\d{2})[-_.](\d{1,2})[-_.](\d{1,2})(?:[ T_-]+(\d{1,2})[_:.-]?(\d{2})(?:[_:.-]?(\d{2}))?)?/,
    /(20\d{2})(\d{2})(\d{2})(?:[ T_-]?(\d{2})(\d{2})(\d{2})?)?/,
  ];
  for (const re of pats) {
    const m = s.match(re);
    if (!m) continue;
    const [y, mo, d, h = 0, mi = 0, se = 0] = m.slice(1).map((x) => (x == null ? undefined : Number(x)));
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) continue;
    const t = new Date(y, mo - 1, d, h, mi, se).getTime();
    if (Number.isFinite(t)) return t;
  }
  return null;
}

// "2026-09-12 14_30 Team sync.txt" → "Team sync"; falls back to the bare filename
export function titleFromName(name) {
  const base = String(name || '').replace(/\.[^.]+$/, '');
  const cleaned = base
    .replace(/(20\d{2})[-_.]\d{1,2}[-_.]\d{1,2}(?:[ T_-]+\d{1,2}[_:.-]?\d{2}(?:[_:.-]?\d{2})?)?/, ' ')
    .replace(/20\d{6}(?:[ T_-]?\d{4,6})?/, ' ')
    .replace(/[_]+/g, ' ').replace(/\s*[-–—]\s*$/, '').replace(/^\s*[-–—]\s*/, '').replace(/\s+/g, ' ').trim();
  return cleaned || base.trim() || 'Untitled recording';
}

const HEADING = /^#{1,6}\s+(.+?)\s*#*\s*$/;
const SUMMARY_HEAD = /^(?:#{1,6}\s*)?(?:ai\s*)?(?:summary|摘要|总结|会议总结|内容摘要)\s*[:：]?\s*$/i;
const TRANSCRIPT_HEAD = /^(?:#{1,6}\s*)?(?:transcript(?:ion)?|full\s+transcript|转录|转写|文字记录|录音文字|逐字稿|原文)\s*[:：]?\s*$/i;
const SPK_NAME = String.raw`(?:speaker|说话人|发言人|讲话人)\s*\d+`;
const CLOCK = String.raw`\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?`;
// "Speaker 1 00:01:23" (text follows on the next lines); also accepts "Speaker 1  (00:01:23)" and names like "Alex 00:01:23"
const HDR_RE = new RegExp(String.raw`^(${SPK_NAME}|[\p{L}\p{N}_.'-]{1,24})\s*[(\[]?(${CLOCK})[)\]]?\s*$`, 'iu');
// "[00:01:23] Speaker 1: text" / "00:01:23 Speaker 1: text"
const TS_LINE_RE = new RegExp(String.raw`^\[?(${CLOCK})\]?\s+(.{1,40}?)\s*[:：]\s*(.+)$`, 'u');
// "Speaker 1: text" / "说话人1：text"
const SPK_LINE_RE = new RegExp(String.raw`^(${SPK_NAME})\s*[:：]\s*(.*)$`, 'iu');
// generic "Name: text" — only trusted when the same name is used as a speaker on ≥2 lines
const NAME_LINE_RE = /^([\p{L}\p{N}_.' -]{1,20}?)\s*[:：]\s*(.+)$/u;

function parseTextTranscript(text, speakerMap) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  let title = '', summary = [], turns = [], section = 'body', cur = null, hadSpeakers = false;
  const loose = [];

  // pre-scan: which generic "Name:" prefixes repeat enough to count as speakers
  const nameCounts = new Map();
  const hdrCounts = new Map();
  for (const l of lines) {
    const t = l.trim();
    const m = t.match(NAME_LINE_RE); if (m && !/^https?$/i.test(m[1])) nameCounts.set(m[1].trim(), (nameCounts.get(m[1].trim()) || 0) + 1);
    const h = t.match(HDR_RE); if (h) hdrCounts.set(h[1].trim(), (hdrCounts.get(h[1].trim()) || 0) + 1);
  }
  const isName = (n) => (nameCounts.get(n.trim()) || 0) >= 2 || speakerMap.has(normSpeakerKey(n));
  const isHdrName = (n) => (hdrCounts.get(n.trim()) || 0) >= 2 || speakerMap.has(normSpeakerKey(n));

  const push = (speaker, t, offsetMs) => {
    hadSpeakers = true;
    cur = { speaker: applySpeaker(speaker, speakerMap), text: String(t || '').trim(), ...(offsetMs != null ? { offsetMs } : {}) };
    turns.push(cur);
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { if (section === 'summary') summary.push(''); continue; }
    if (SUMMARY_HEAD.test(line)) { section = 'summary'; cur = null; continue; }
    if (TRANSCRIPT_HEAD.test(line)) { section = 'transcript'; cur = null; continue; }
    const h = line.match(HEADING);
    if (h) {
      if (!title) { title = h[1].trim(); if (section === 'summary') section = 'body'; continue; }
      if (section === 'summary') section = 'body';   // any other heading ends the summary
      continue;
    }
    if (section === 'summary') { summary.push(line); continue; }

    let m;
    if ((m = line.match(HDR_RE)) && (new RegExp(`^${SPK_NAME}$`, 'iu').test(m[1]) || isHdrName(m[1]))) { push(m[1], '', parseClock(m[2])); continue; }
    if ((m = line.match(TS_LINE_RE))) { push(m[2], m[3], parseClock(m[1])); continue; }
    if ((m = line.match(SPK_LINE_RE))) { push(m[1], m[2]); continue; }
    if ((m = line.match(NAME_LINE_RE)) && isName(m[1])) { push(m[1], m[2]); continue; }
    if (cur) { cur.text = cur.text ? `${cur.text}\n${line}` : line; continue; }
    loose.push(line);
  }
  turns = turns.filter((t) => t.text);
  if (!turns.length && loose.length) turns = [{ speaker: 'Unknown', text: loose.join('\n') }];
  return { title, summary: summary.join('\n').trim(), turns };
}

function parseSubtitles(text, speakerMap) {
  const blocks = String(text).replace(/\r\n?/g, '\n').replace(/^﻿/, '').split(/\n{2,}/);
  const turns = []; let durationMs;
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue;   // WEBVTT header, NOTE, STYLE blocks
    const [a, b] = lines[ti].split('-->').map((x) => x.trim().split(/\s+/)[0]);
    const start = parseClock(a), end = parseClock(b);
    if (end != null) durationMs = Math.max(durationMs || 0, end);
    let body = lines.slice(ti + 1).join('\n');
    if (!body) continue;
    let speaker = 'Unknown', m;
    if ((m = body.match(/^<v(?:\.[^\s>]+)?\s+([^>]+)>([\s\S]*?)(?:<\/v>)?$/i))) { speaker = m[1].trim(); body = m[2]; }
    else if ((m = body.match(/^\[([^\]]{1,40})\]\s*([\s\S]+)$/))) { speaker = m[1]; body = m[2]; }
    else if ((m = body.match(/^([^:：\n]{1,40}?)\s*[:：]\s*([\s\S]+)$/)) && (new RegExp(`^${SPK_NAME}$`, 'iu').test(m[1].trim()) || speakerMap.has(normSpeakerKey(m[1])) || /^[\p{L}\p{N}_.' -]{1,24}$/u.test(m[1].trim()))) { speaker = m[1]; body = m[2]; }
    body = body.replace(/<[^>]+>/g, '').trim();
    if (!body) continue;
    const name = applySpeaker(speaker, speakerMap);
    const prev = turns[turns.length - 1];
    if (prev && prev.speaker === name) prev.text += `\n${body}`;   // merge consecutive cues from one speaker
    else turns.push({ speaker: name, text: body, ...(start != null ? { offsetMs: start } : {}) });
  }
  return { title: '', summary: '', turns, durationMs };
}

function parseJsonTranscript(text, speakerMap) {
  let d;
  try { d = JSON.parse(String(text).replace(/^﻿/, '')); } catch { return null; }
  let segs = Array.isArray(d) ? d : d.segments || d.utterances || d.sentences || (Array.isArray(d.transcript) ? d.transcript : null) || d.data?.segments;
  const title = !Array.isArray(d) ? String(d.title || d.name || d.filename || '').trim() : '';
  const summary = !Array.isArray(d) ? (typeof d.summary === 'string' ? d.summary : d.summary?.text || d.ai_summary || '') : '';
  if (!segs && typeof d.transcript === 'string') return { ...parseTextTranscript(d.transcript, speakerMap), title: title || '', summary: String(summary || '').trim() };
  if (!Array.isArray(segs)) segs = [];

  // time units: explicit *_ms keys are ms; clock strings parse; bare numbers are seconds unless clearly ms
  const startKey = (s) => ['start_ms', 'startMs', 'start', 'start_time', 'startTime', 'begin', 'begin_time', 'offset'].find((k) => s[k] != null);
  const nums = segs.map((s) => { const k = startKey(s); return k && typeof s[k] === 'number' ? s[k] : null; }).filter((x) => x != null);
  const msUnits = nums.length && Math.max(...nums) > 100000;
  const toMs = (s) => {
    const k = startKey(s); if (!k) return undefined;
    const v = s[k];
    if (typeof v === 'string') { const c = parseClock(v); return c != null ? c : (Number.isFinite(Number(v)) ? Number(v) * (/ms/i.test(k) || msUnits ? 1 : 1000) : undefined); }
    return /ms/i.test(k) || msUnits ? v : Math.round(v * 1000);
  };
  const turns = [];
  let durationMs;
  for (const s of segs) {
    const t = String(s.text ?? s.content ?? s.sentence ?? s.transcript ?? '').trim();
    if (!t) continue;
    const off = toMs(s);
    const endK = ['end_ms', 'endMs', 'end', 'end_time', 'endTime'].find((k) => s[k] != null);
    if (endK) { const e = typeof s[endK] === 'string' ? parseClock(s[endK]) : (/ms/i.test(endK) || msUnits ? s[endK] : Math.round(s[endK] * 1000)); if (e != null) durationMs = Math.max(durationMs || 0, e); }
    turns.push({ speaker: applySpeaker(s.speaker ?? s.speaker_name ?? s.speakerName ?? s.spk ?? 'Unknown', speakerMap), text: t, ...(off != null ? { offsetMs: off } : {}) });
  }
  return { title, summary: String(summary || '').trim(), turns, durationMs };
}

/**
 * @param {string} text   file contents
 * @param {{filename?:string, mtimeMs?:number, speakerMap?:any}} opts
 */
export function parseTranscript(text, { filename = '', mtimeMs, speakerMap } = {}) {
  const map = speakerMap instanceof Map ? speakerMap : parseSpeakerMap(speakerMap);
  const ext = (String(filename).match(/\.[^.]+$/)?.[0] || '.txt').toLowerCase();
  const src = String(text ?? '').replace(/^﻿/, '');
  let r;
  if (ext === '.json') r = parseJsonTranscript(src, map) || parseTextTranscript(src, map);
  else if (ext === '.srt' || ext === '.vtt') r = parseSubtitles(src, map);
  else r = parseTextTranscript(src, map);
  const lastOff = [...(r.turns || [])].reverse().find((t) => t.offsetMs != null)?.offsetMs;
  return {
    title: r.title || titleFromName(filename),
    ts: dateFromName(filename) ?? (mtimeMs != null ? Number(mtimeMs) : Date.now()),
    durationMs: Math.max(r.durationMs || 0, lastOff || 0) || undefined,   // a segment can start after the last recorded end
    turns: r.turns || [],
    summary: r.summary || '',
  };
}
