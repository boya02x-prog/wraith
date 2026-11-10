// Client only. Re-encodes a picked photo to a small JPEG/PNG data URL before it is posted, so a 5 MB phone screenshot does not become
// a 1 MB string that every feed request then has to carry. Falls back to the original file when the browser cannot decode it.
export async function shrinkImage(file: File, maxSide = 1280, quality = 0.82): Promise<string> {
  const original = () =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("read failed"));
      r.readAsDataURL(file);
    });
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return await original();
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    // photos compress far better as JPEG; keep PNG only when the source was a PNG with transparency-friendly flat art
    const out = file.type === "image/png" && file.size < 200_000 ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", quality);
    return out.length < 420_000 ? out : canvas.toDataURL("image/jpeg", 0.6);
  } catch {
    return await original();
  }
}
