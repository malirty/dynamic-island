// Re-packs the Opus audio that Chromium's MediaRecorder writes (WebM) into an Ogg file,
// which is what Telegram expects for a voice message. The sound itself is not re-encoded.

// ---- WebM (EBML) reading: just enough to find the track's OpusHead and the audio packets ----
function readVint(buf, pos, keepMarker) {
  const first = buf[pos];
  let len = 1, mask = 0x80;
  while (len <= 8 && !(first & mask)) { len++; mask >>= 1; }
  if (len > 8) throw new Error('bad EBML');
  let value = keepMarker ? first : first & (mask - 1);
  let allOnes = (first & (mask - 1)) === mask - 1;
  for (let i = 1; i < len; i++) { value = value * 256 + buf[pos + i]; if (buf[pos + i] !== 0xff) allOnes = false; }
  return { value, len, unknown: allOnes };
}
const MASTER = new Set([0x18538067 /* Segment */, 0x1f43b675 /* Cluster */, 0x1654ae6b /* Tracks */, 0xae /* TrackEntry */, 0xa0 /* BlockGroup */]);

function parseWebm(buf) {
  const packets = [];
  let opusHead = null;
  let pos = 0;
  while (pos < buf.length - 2) {
    const id = readVint(buf, pos, true);
    const size = readVint(buf, pos + id.len, false);
    const dataStart = pos + id.len + size.len;
    if (MASTER.has(id.value)) { pos = dataStart; continue; } // step inside (works for "unknown size" too)
    const end = size.unknown ? buf.length : dataStart + size.value;
    if (id.value === 0x63a2) opusHead = buf.subarray(dataStart, end); // CodecPrivate
    else if (id.value === 0xa3 || id.value === 0xa1) { // SimpleBlock / Block
      const tn = readVint(buf, dataStart, false);
      const flags = buf[dataStart + tn.len + 2];
      if ((flags & 0x06) !== 0) throw new Error('laced blocks are not supported');
      packets.push(buf.subarray(dataStart + tn.len + 3, end));
    }
    pos = end;
  }
  return { opusHead, packets };
}

// samples (at 48 kHz) in one Opus packet, from its first byte
function opusSamples(p) {
  if (!p.length) return 0;
  const toc = p[0], config = toc >> 3;
  let ms;
  if (config < 12) ms = [10, 20, 40, 60][config & 3];
  else if (config < 16) ms = [10, 20][config & 1];
  else ms = [2.5, 5, 10, 20][config & 3];
  const c = toc & 3;
  const frames = c === 0 ? 1 : c === 3 ? (p[1] || 0) & 0x3f : 2;
  return Math.round(frames * ms * 48);
}

// ---- Ogg writing ----
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let r = i << 24; for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1; t[i] = r >>> 0; }
  return t;
})();
function crc32(b) { let c = 0; for (let i = 0; i < b.length; i++) c = ((c << 8) ^ CRC[((c >>> 24) ^ b[i]) & 0xff]) >>> 0; return c; }

function page(packet, { granule, serial, seq, flags }) {
  const lacing = [];
  let n = packet.length;
  while (n >= 255) { lacing.push(255); n -= 255; }
  lacing.push(n);
  const head = Buffer.alloc(27 + lacing.length);
  head.write('OggS', 0, 'ascii');
  head[4] = 0; head[5] = flags;
  head.writeBigUInt64LE(BigInt(granule), 6);
  head.writeUInt32LE(serial, 14);
  head.writeUInt32LE(seq, 18);
  head.writeUInt32LE(0, 22);
  head[26] = lacing.length;
  Buffer.from(lacing).copy(head, 27);
  const out = Buffer.concat([head, packet]);
  out.writeUInt32LE(crc32(out), 22);
  return out;
}

function webmToOgg(input) {
  const buf = Buffer.from(input);
  const { opusHead, packets } = parseWebm(buf);
  if (!packets.length) throw new Error('no audio in the recording');
  let head = opusHead && opusHead.subarray(0, 8).toString('ascii') === 'OpusHead' ? Buffer.from(opusHead) : null;
  if (!head) { // build one: mono, 48 kHz
    head = Buffer.alloc(19);
    head.write('OpusHead', 0, 'ascii'); head[8] = 1; head[9] = 1; head.writeUInt16LE(312, 10); head.writeUInt32LE(48000, 12); head.writeInt16LE(0, 16); head[18] = 0;
  }
  const preSkip = head.readUInt16LE(10);
  const vendor = Buffer.from('Island');
  const tags = Buffer.alloc(8 + 4 + vendor.length + 4);
  tags.write('OpusTags', 0, 'ascii'); tags.writeUInt32LE(vendor.length, 8); vendor.copy(tags, 12); tags.writeUInt32LE(0, 12 + vendor.length);
  const serial = (Math.random() * 0xffffffff) >>> 0;
  const pages = [page(head, { granule: 0, serial, seq: 0, flags: 2 }), page(tags, { granule: 0, serial, seq: 1, flags: 0 })];
  let granule = 0, seq = 2;
  packets.forEach((p, i) => {
    granule += opusSamples(p);
    pages.push(page(Buffer.from(p), { granule, serial, seq: seq++, flags: i === packets.length - 1 ? 4 : 0 }));
  });
  return { ogg: Buffer.concat(pages), duration: Math.max(0, (granule - preSkip) / 48000) };
}

module.exports = { webmToOgg };
