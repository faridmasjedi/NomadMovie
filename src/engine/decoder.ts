// Sequential frame decoding for export: demux MP4/MOV with mp4box and decode with WebCodecs.
// Seeking an <video> element costs ~50-60ms per frame; decoding in order is ~10× faster.
import MP4Box from "mp4box";

interface Sample {
  cts: number;
  duration: number;
  timescale: number;
  is_sync: boolean;
  data: Uint8Array;
}

interface Demuxed {
  config: VideoDecoderConfig;
  samples: Sample[]; // decode order
  t0: number; // first presentation time (s), so the stream starts at 0
}

const demuxCache = new Map<string, Promise<Demuxed | null>>();

function demux(blob: Blob): Promise<Demuxed | null> {
  return new Promise(async (resolve) => {
    const file = MP4Box.createFile();
    const samples: Sample[] = [];
    let config: VideoDecoderConfig | null = null;
    let expected = 0;
    file.onError = () => resolve(null);
    file.onReady = (info: any) => {
      const track = info.videoTracks?.[0];
      if (!track) return resolve(null);
      const trak = file.getTrackById(track.id);
      let description: Uint8Array | undefined;
      for (const entry of trak.mdia.minf.stbl.stsd.entries) {
        const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
        if (box) {
          const stream = new MP4Box.DataStream(undefined, 0, MP4Box.DataStream.BIG_ENDIAN);
          box.write(stream);
          description = new Uint8Array(stream.buffer, 8); // skip the box header
          break;
        }
      }
      config = { codec: track.codec, codedWidth: track.video.width, codedHeight: track.video.height, description };
      expected = track.nb_samples;
      file.setExtractionOptions(track.id, null, { nbSamples: Infinity });
      file.start();
    };
    file.onSamples = (_id: number, _user: unknown, s: Sample[]) => {
      samples.push(...s);
      if (samples.length >= expected && config) {
        const t0 = Math.min(...samples.map((x) => x.cts / x.timescale));
        resolve({ config, samples, t0 });
      }
    };
    try {
      const buf = (await blob.arrayBuffer()) as ArrayBuffer & { fileStart: number };
      buf.fileStart = 0;
      file.appendBuffer(buf);
      file.flush();
      // files whose sample count never matches (fragmented etc.) resolve with what we have
      setTimeout(() => (config && samples.length ? resolve({ config, samples, t0: Math.min(...samples.map((x) => x.cts / x.timescale)) }) : resolve(null)), 50);
    } catch {
      resolve(null);
    }
  });
}

/** Decodes a video forward in time; `frameAt(t)` must be called with non-decreasing t. */
export class FrameSource {
  private decoder: VideoDecoder | null = null;
  private queue: VideoFrame[] = [];
  private next = 0; // next sample index to feed
  private current: VideoFrame | null = null;
  private error: unknown = null;

  private constructor(private d: Demuxed) {}

  static async open(key: string, blob: Blob | undefined, name: string): Promise<FrameSource | null> {
    if (!blob || !("VideoDecoder" in window) || !/\.(mp4|m4v|mov)$/i.test(name) && !/mp4|quicktime/.test(blob.type)) return null;
    let p = demuxCache.get(key);
    if (!p) demuxCache.set(key, (p = demux(blob)));
    const d = await p;
    if (!d) return null;
    try {
      const sup = await VideoDecoder.isConfigSupported(d.config);
      if (!sup.supported) return null;
    } catch {
      return null;
    }
    return new FrameSource(d);
  }

  private start(t: number) {
    const s = this.d.samples;
    // last keyframe at or before t
    let k = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i].is_sync && s[i].cts / s[i].timescale - this.d.t0 <= t + 1e-4) k = i;
      if (s[i].cts / s[i].timescale - this.d.t0 > t + 1) break;
    }
    this.next = k;
    this.decoder = new VideoDecoder({
      output: (f) => this.queue.push(f),
      error: (e) => (this.error = e),
    });
    this.decoder.configure({ ...this.d.config, hardwareAcceleration: "prefer-hardware", optimizeForLatency: false });
  }

  private feed(n: number) {
    const s = this.d.samples;
    for (let i = 0; i < n && this.next < s.length; i++, this.next++) {
      const x = s[this.next];
      this.decoder!.decode(
        new EncodedVideoChunk({
          type: x.is_sync ? "key" : "delta",
          timestamp: Math.round(((x.cts / x.timescale) - this.d.t0) * 1e6),
          duration: Math.round((x.duration / x.timescale) * 1e6),
          data: x.data,
        }),
      );
    }
  }

  async frameAt(t: number): Promise<VideoFrame | null> {
    if (!this.decoder) this.start(t);
    const target = Math.round(t * 1e6) + 500; // tolerance: 0.5ms
    for (let guard = 0; guard < 2000; guard++) {
      if (this.error) throw this.error;
      // drop frames that are already in the past
      while (this.queue.length && this.queue[0].timestamp <= target) {
        this.current?.close();
        this.current = this.queue.shift()!;
      }
      if (this.queue.length) return this.current ?? this.queue[0]; // next frame is in the future → current is right
      if (this.next >= this.d.samples.length) {
        if (this.decoder!.state === "configured" && this.decoder!.decodeQueueSize === 0) {
          await this.decoder!.flush().catch(() => {});
          if (!this.queue.length) return this.current; // end of stream: hold last frame
          continue;
        }
      } else if (this.decoder!.decodeQueueSize < 8) {
        this.feed(8);
      }
      await new Promise((r) => setTimeout(r, 0));
      if (this.decoder!.decodeQueueSize > 0 && !this.queue.length) {
        await new Promise((r) => this.decoder!.addEventListener("dequeue", r, { once: true }));
      }
    }
    return this.current;
  }

  close() {
    this.current?.close();
    this.queue.forEach((f) => f.close());
    this.queue = [];
    if (this.decoder && this.decoder.state !== "closed") this.decoder.close();
  }
}
