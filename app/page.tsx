"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

// Brave Pink — client-side duotone color swapper (Pink ↔ Green)
// Fitur: upload/drag-drop, preset, tukar warna, slider (strength/gamma/contrast/brightness),
// download PNG/JPG, dan modal “17+8 Tuntutan Warga”.
// FIX: Guard untuk canvasRef null + defer proses sampai <canvas> mount.

export default function BravePink() {
  // Brand colors
  const PINK_DEFAULT = "#ff3ea5";
  const GREEN_DEFAULT = "#32ff84";

  const [fileName, setFileName] = useState<string | null>(null);
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [shadowHex, setShadowHex] = useState(PINK_DEFAULT);
  const [highlightHex, setHighlightHex] = useState(GREEN_DEFAULT);
  const [strength, setStrength] = useState(90); // 0..100
  const [gamma, setGamma] = useState(1.0);      // 0.2..3
  const [contrast, setContrast] = useState(10); // -100..100
  const [brightness, setBrightness] = useState(0); // -100..100
  const [isDragging, setIsDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showDemands, setShowDemands] = useState(false);

  // simple unit tests state
  type TestResult = { name: string; passed: boolean; details?: string };
  const [tests, setTests] = useState<TestResult[] | null>(null);
  const [lastTestRun, setLastTestRun] = useState<Date | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bufferRef = useRef<HTMLCanvasElement | null>(null);

  // helpers
  function hexToRgb(hex: string) {
    let h = hex.replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const num = parseInt(h, 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }
  function clamp(v: number, min = 0, max = 1) { return Math.min(max, Math.max(min, v)); }
  function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

  function applyDuotone(
    src: ImageData,
    shadowColor: { r: number; g: number; b: number },
    highlightColor: { r: number; g: number; b: number },
    gammaVal: number,
    blendStrength: number,
    contrastPct: number,
    brightnessPct: number
  ) {
    const out = new ImageData(src.width, src.height);
    const s = src.data, d = out.data;

    const cf = (259 * (contrastPct + 255)) / (255 * (259 - contrastPct));
    const bf = brightnessPct / 100;

    for (let i = 0; i < s.length; i += 4) {
      const r = s[i] / 255, g = s[i + 1] / 255, b = s[i + 2] / 255;
      const a = s[i + 3];

      // Rec.709 luma
      let t = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      t = clamp(cf * (t - 0.5) + 0.5 + bf);
      const tg = clamp(Math.pow(t, Math.max(0.01, gammaVal)));

      const rr = lerp(shadowColor.r, highlightColor.r, tg);
      const gg = lerp(shadowColor.g, highlightColor.g, tg);
      const bb = lerp(shadowColor.b, highlightColor.b, tg);

      const dr = lerp(s[i], rr, blendStrength);
      const dg = lerp(s[i + 1], gg, blendStrength);
      const db = lerp(s[i + 2], bb, blendStrength);

      d[i] = Math.round(dr);
      d[i + 1] = Math.round(dg);
      d[i + 2] = Math.round(db);
      d[i + 3] = a;
    }
    return out;
  }

  function drawImageToCanvases(image: HTMLImageElement) {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const maxDim = 3500;
    const { naturalWidth: w, naturalHeight: h } = image;
    const scale = Math.min(1, maxDim / Math.max(w, h));
    const W = Math.max(1, Math.round(w * scale));
    const H = Math.max(1, Math.round(h * scale));

    const buffer = bufferRef.current || document.createElement("canvas");
    buffer.width = W; buffer.height = H;
    const bctx = buffer.getContext("2d", { willReadFrequently: true });
    if (!bctx) return;
    bctx.clearRect(0, 0, W, H);
    bctx.drawImage(image, 0, 0, W, H);
    bufferRef.current = buffer;

    canvas.width = W; canvas.height = H;
  }

  function processCurrent() {
    if (!bufferRef.current || !canvasRef.current) return;
    setBusy(true);
    try {
      const bctx = bufferRef.current.getContext("2d", { willReadFrequently: true });
      const ctx = canvasRef.current.getContext("2d");
      if (!bctx || !ctx) return;

      const src = bctx.getImageData(0, 0, bufferRef.current.width, bufferRef.current.height);
      const out = applyDuotone(
        src, hexToRgb(shadowHex), hexToRgb(highlightHex),
        gamma, strength / 100, contrast, brightness
      );
      ctx.putImageData(out, 0, 0);
    } finally { setBusy(false); }
  }

  // reprocess when controls change
  useEffect(() => { if (imgEl) processCurrent(); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shadowHex, highlightHex, strength, gamma, contrast, brightness]);

  // after image set, wait frame to ensure canvas mounted
  useEffect(() => {
    if (!imgEl) return;
    const raf = requestAnimationFrame(() => {
      if (!canvasRef.current) return;
      drawImageToCanvases(imgEl);
      processCurrent();
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgEl]);

  // handlers
  async function handleFile(file: File) {
    if (!file) return;
    setBusy(true);
    setFileName(file.name);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = reject;
        fr.readAsDataURL(file);
      });
      const img = new Image();
      img.onload = () => setImgEl(img);
      img.onerror = () => alert("Gagal memuat gambar. Coba file lain.");
      img.src = dataUrl;
    } catch (e) {
      console.error(e);
      alert("Tidak bisa membaca file.");
    } finally { setBusy(false); }
  }
  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault(); setIsDragging(false);
    const f = e.dataTransfer.files?.[0]; if (f) handleFile(f);
  }
  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (f) handleFile(f);
  }
  function swapColors() {
    setShadowHex((prev) => { const tmp = highlightHex; setHighlightHex(prev); return tmp; });
  }
  function setPresetBravePink() {
    setShadowHex(PINK_DEFAULT); setHighlightHex(GREEN_DEFAULT);
    setGamma(1.0); setContrast(10); setBrightness(0); setStrength(90);
  }
  function resetAll() {
    if (!imgEl || !bufferRef.current) return;
    setPresetBravePink();
    if (canvasRef.current) { drawImageToCanvases(imgEl); processCurrent(); }
  }
  function download(type: "png" | "jpg") {
    if (!canvasRef.current) return;
    const link = document.createElement("a");
    const nameNoExt = (fileName || "brave-pink").replace(/\.[^.]+$/, "");
    if (type === "png") { link.download = `${nameNoExt}-brave-pink.png`; link.href = canvasRef.current.toDataURL("image/png"); }
    else { link.download = `${nameNoExt}-brave-pink.jpg`; link.href = canvasRef.current.toDataURL("image/jpeg", 0.92); }
    link.click();
  }

  const gradientStyle = useMemo(() => ({
    background: `linear-gradient(90deg, ${shadowHex}, ${highlightHex})`,
  }), [shadowHex, highlightHex]);

  // tests
  function nearlyEqual(a: number, b: number, tol = 2) { return Math.abs(a - b) <= tol; }
  function runTests() {
    const c = document.createElement("canvas"); c.width = 1; c.height = 1;
    const ctx = c.getContext("2d");
    if (!ctx) return setTests([{ name: "Canvas context available", passed: false, details: "getContext returned null" }]);

    const sh = hexToRgb("#ff00aa"), hi = hexToRgb("#00ff88");
    let id = ctx.createImageData(1,1); id.data.set([0,0,0,255]);
    let out = applyDuotone(id, sh, hi, 1.0, 1.0, 0, 0);
    const t1 = nearlyEqual(out.data[0], sh.r) && nearlyEqual(out.data[1], sh.g) && nearlyEqual(out.data[2], sh.b);

    id = ctx.createImageData(1,1); id.data.set([255,255,255,255]);
    out = applyDuotone(id, sh, hi, 1.0, 1.0, 0, 0);
    const t2 = nearlyEqual(out.data[0], hi.r) && nearlyEqual(out.data[1], hi.g) && nearlyEqual(out.data[2], hi.b);

    id = ctx.createImageData(1,1); id.data.set([200,10,5,255]);
    out = applyDuotone(id, sh, hi, 1.0, 0.0, 0, 0);
    const t3 = nearlyEqual(out.data[0], 200) && nearlyEqual(out.data[1], 10) && nearlyEqual(out.data[2], 5);

    const rgb = hexToRgb("#abc");
    const t4 = rgb.r === 170 && rgb.g === 187 && rgb.b === 204;

    setTests([
      { name: "Black maps to shadow (duotone)", passed: t1 },
      { name: "White maps to highlight (duotone)", passed: t2 },
      { name: "Strength 0 preserves original", passed: t3 },
      { name: "hexToRgb handles #abc", passed: t4 },
    ]);
    setLastTestRun(new Date());
  }

  // ESC to close modal
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setShowDemands(false); }
    if (showDemands) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showDemands]);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      {/* Header */}
      <header className="sticky top-0 z-20 backdrop-blur border-b border-white/10 bg-neutral-950/70">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl shadow-inner" style={gradientStyle} />
            <div>
              <h1 className="text-xl font-bold tracking-tight">1312</h1>
              <p className="text-xs text-neutral-400">#WargaJagaWarga</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
              <button
              onClick={() => setShowDemands(true)}
              className="px-3 py-1.5 rounded-xl bg-pink-600/20 hover:bg-pink-600/30 border border-pink-500/40 transition text-sm"
              title="Lihat 17+8 Tuntutan Rakyat"
            >
              17+8 Tuntutan Rakyat
            </button>
            <button
              onClick={setPresetBravePink}
              className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 transition text-sm"
              title="Kembalikan preset Brave Pink"
            >
              Preset
            </button>
            <button
              onClick={runTests}
              className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 transition text-sm"
              title="Jalankan unit tests sederhana"
            >
              Run Tests
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-6xl mx-auto px-4 py-6 grid lg:grid-cols-3 gap-6">
        {/* Left: Controls */}
        <section className="lg:col-span-1">
          <div className="space-y-6">
            {/* Upload / Drop */}
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
              className={`border-2 border-dashed rounded-2xl p-5 transition ${
                isDragging ? "border-pink-500/70 bg-pink-500/5" : "border-white/15 bg-white/5"
              }`}
            >
              <p className="text-sm text-neutral-300">Tarik & letakkan foto ke sini</p>
              <p className="text-xs text-neutral-400">atau</p>
              <label className="inline-flex items-center gap-2 mt-3 cursor-pointer px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-sm">
                <input type="file" accept="image/*" className="hidden" onChange={onInputChange} />
                Pilih Foto
              </label>
              {fileName && <p className="mt-3 text-xs text-neutral-500 truncate">{fileName}</p>}
            </div>

            {/* Colors */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Warna</h2>
                <button onClick={swapColors} className="text-xs px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20">
                  Tukar Pink ⟷ Hijau
                </button>
              </div>

              <div className="grid grid-cols-3 gap-3 items-center">
                <label className="text-sm text-neutral-300">Bayangan</label>
                <input type="color" value={shadowHex} onChange={(e) => setShadowHex(e.target.value)}
                       className="col-span-2 h-10 w-full rounded-lg bg-transparent cursor-pointer" />
              </div>
              <div className="grid grid-cols-3 gap-3 items-center">
                <label className="text-sm text-neutral-300">Sorotan</label>
                <input type="color" value={highlightHex} onChange={(e) => setHighlightHex(e.target.value)}
                       className="col-span-2 h-10 w-full rounded-lg bg-transparent cursor-pointer" />
              </div>

              <div className="rounded-xl h-3" style={gradientStyle} />
              <p className="text-xs text-neutral-400">
                Preset <button onClick={setPresetBravePink} className="underline underline-offset-2">Brave Pink</button>
              </p>
            </div>

            {/* Sliders */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-4">
              <h2 className="font-semibold">Penyesuaian</h2>

              <Slider label="Kekuatan" value={strength} setValue={setStrength} min={0} max={100} step={1} suffix="%" />
              <Slider label="Gamma" value={gamma} setValue={setGamma} min={0.2} max={3.0} step={0.05} />
              <Slider label="Kontras" value={contrast} setValue={setContrast} min={-100} max={100} step={1} />
              <Slider label="Kecerahan" value={brightness} setValue={setBrightness} min={-100} max={100} step={1} />

              <div className="flex gap-2 pt-1">
                <button onClick={resetAll} className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-sm">Reset</button>
                <button onClick={() => { setGamma(0.8); setContrast(15); setBrightness(5); }} className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-sm">Moody</button>
                <button onClick={() => { setGamma(1.3); setContrast(5); setBrightness(10); }} className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-sm">Soft</button>
              </div>
            </div>

            {/* Export */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
              <h2 className="font-semibold">Simpan</h2>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => download("png")} className="px-3 py-1.5 rounded-xl bg-pink-500/20 hover:bg-pink-500/30 border border-pink-500/40">Download PNG</button>
                <button onClick={() => download("jpg")} className="px-3 py-1.5 rounded-xl bg-green-500/20 hover:bg-green-500/30 border border-green-500/40">Download JPG</button>
              </div>
              <p className="text-xs text-neutral-400">Gambar diproses sepenuhnya di perangkatmu.</p>

              {tests && (
                <div className="mt-4 text-xs">
                  <h3 className="font-semibold mb-2">Unit Tests</h3>
                  <ul className="space-y-1">
                    {tests.map((t, i) => (
                      <li key={i} className={`flex items-center gap-2 ${t.passed ? "text-green-400" : "text-red-400"}`}>
                        <span className={`w-2.5 h-2.5 rounded-full ${t.passed ? "bg-green-400" : "bg-red-400"}`} />
                        <span>{t.name}</span>
                        {!t.passed && t.details && <span className="text-neutral-400">— {t.details}</span>}
                      </li>
                    ))}
                  </ul>
                  {lastTestRun && <p className="text-neutral-500 mt-1">Dijalankan: {lastTestRun.toLocaleTimeString()}</p>}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Right: Preview */}
        <section className="lg:col-span-2">
          <div className="aspect-video w-full bg-white/5 border border-white/10 rounded-2xl overflow-hidden flex items-center justify-center relative">
            {!imgEl ? (
              <div className="text-center p-6">
                <h3 className="text-lg font-semibold">Mulai dengan unggah foto</h3>
                <p className="text-sm text-neutral-400">Pilih file atau tarik ke panel kiri, lalu atur warna pink ↔ hijau. ✨</p>
              </div>
            ) : (
              <canvas ref={canvasRef} className="w-full h-full object-contain" />
            )}
            {busy && (
              <div className="absolute bottom-3 right-3 text-xs bg-white/10 px-2 py-1 rounded-md">
                Memproses…
              </div>
            )}
          </div>

          {/* Tips */}
          <div className="mt-4 text-xs text-neutral-400 leading-relaxed">
            <p>
              Tip: Gunakan <span className="text-neutral-200">Gamma</span> untuk menggeser nuansa midtone,
              <span className="text-neutral-200"> Kontras</span> untuk menambah pop, dan
              <span className="text-neutral-200"> Kekuatan</span> untuk mengatur campuran efek vs foto asli.
            </p>
          </div>
        </section>
      </main>

      {/* Modal: 17+8 Tuntutan Warga */}
      {showDemands && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* backdrop */}
          <div className="absolute inset-0 bg-black/70" onClick={() => setShowDemands(false)} />
          {/* modal box */}
          <div className="relative bg-neutral-900 border border-white/10 rounded-2xl shadow-2xl max-w-3xl w-[92vw] max-h-[86vh] flex flex-col">
            {/* header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
              <h3 className="text-lg font-semibold">17+8 Tuntutan Rakyat</h3>
              <button onClick={() => setShowDemands(false)} className="text-sm px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20">
                Tutup
              </button>
            </div>
            {/* content scrollable */}
            <div className="p-5 overflow-y-auto space-y-6 text-sm leading-relaxed flex-1">
              <section><p className="text-green-400 font-semibold">Transparansi. Reformasi. Empati.</p></section>
              <section><p className="text-pink-400 font-semibold">KAMI MENUNGGU.</p> <p className="text-green-400 font-semibold">BUKTIKAN SUARA RAKYAT DIDENGAR.</p></section>

              <section className="space-y-2">
                <h4 className="font-semibold">DALAM 1 MINGGU <span className="text-neutral-400">— Deadline: 5 Sept</span></h4>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Bentuk Tim Investigasi Independen kasus Affan Kurniawan, Umar Amarudin, maupun semua korban kekerasan dan pelanggaran HAM oleh aparat lainnya selama demonstrasi 28-30 Agustus dengan mandat jelas dan transparan.</li>
                  <li>Hentikan keterlibatan TNI dalam pengamanan sipil, kembalikan TNI ke barak.</li>
                  <li>Bebaskan seluruh demonstran yang ditahan dan pastikan tidak ada kriminalisasi demonstran.</li>
                  <li>Tangkap, adili, dan proses hukum secara transparan para anggota dan komandan yang memerintahkan dan melakukan tindakan kekerasan.</li>
                  <li>Hentikan kekerasan oleh kepolisian dan taati SOP pengendalian massa yang sudah tersedia.</li>
                  <li>Bekukan kenaikan gaji/tunjangan anggota DPR dan batalkan fasilitas baru.</li>
                  <li>Publikasikan transparansi anggaran (gaji, tunjangan, rumah, fasilitas DPR) secara proaktif dan dilaporkan secara berkala.</li>
                  <li>Selidiki kepemilikan harta anggota DPR yang bermasalah oleh KPK.</li>
                  <li>Dorong Badan Kehormatan DPR untuk periksa anggota yang melecehkan aspirasi rakyat.</li>
                  <li>Partai harus pecat atau jatuhkan sanksi tegas kepada kader partai yang tidak etis dan memicu kemarahan publik.</li>
                  <li>Umumkan komitmen partai untuk berpihak pada rakyat di tengah krisis.</li>
                  <li>Anggota DPR harus melibatkan diri di ruang dialog publik bersama mahasiswa dan masyarakat sipil guna meningkatkan partisipasi bermakna.</li>
                  <li>Tegakkan disiplin internal agar anggota TNI tidak mengambil alih fungsi Polri.</li>
                  <li>Komitmen publik TNI untuk tidak memasuki ruang sipil selama krisis demokrasi.</li>
                  <li>Pastikan upah layak untuk seluruh angkatan kerja (guru, nakes, buruh, mitra ojol).</li>
                  <li>Ambil langkah darurat untuk mencegah PHK massal dan lindungi buruh kontrak.</li>
                  <li>Buka dialog dengan serikat buruh untuk solusi upah minimum dan outsourcing.</li>
                </ul>
              </section>

              <section className="space-y-2">
                <h4 className="font-semibold">DALAM 1 TAHUN <span className="text-neutral-400">— Deadline: 31/8/2026</span></h4>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Bersihkan dan Reformasi DPR Besar-Besaran.</li>
                  <li>Reformasi partai politik dan kuatkan pengawasan eksekutif.</li>
                  <li>Susun rencana reformasi perpajakan yang lebih adil.</li>
                  <li>Sahkan dan tegakkan UU Perampasan Aset Koruptor, penguatan independensi KPK dan penegakan UU Tipikor.</li>
                  <li>Reformasi kepolisian agar profesional dan humanis.</li>
                  <li>TNI kembali ke barak tanpa pengecualian.</li>
                  <li>Perkuat Komnas HAM dan lembaga pengawas independen.</li>
                  <li>Tinjau ulang kebijakan sektor ekonomi & ketenagakerjaan.</li>
                </ul>
              </section>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="max-w-6xl mx-auto px-4 py-10 text-center text-xs text-neutral-500">
        Made with ❤ — Brave Pink
      </footer>
    </div>
  );
}

function Slider({
  label, value, setValue, min, max, step = 1, suffix = ""
}: {
  label: string;
  value: number;
  setValue: (n: number) => void;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-neutral-300">{label}</span>
        <span className="text-xs text-neutral-400">
          {typeof value === "number" ? value.toFixed(step < 1 ? 2 : 0) : value}{suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => setValue(parseFloat(e.target.value))}
        className="w-full accent-pink-500"
      />
    </div>
  );
}
