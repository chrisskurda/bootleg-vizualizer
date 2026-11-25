// Reference implementation of the vis look/FX passes (roto, glitch, scanlines/CRT).
// The functions below are copied VERBATIM from RiffBox (except `hash`, replaced as documented there) (riffbox/crates/app/src/vis_render.rs, MIT, same author), which ported
// them from the racing engine's look/filter shaders. They are the conformance oracle: core/fx.js and core/fx-gl.js must match
// the goldens this program writes (see tests/fx.test.mjs). Regenerate goldens with:  cargo run --release  (from this folder)
#![allow(dead_code)]

/// CONTRACT CHANGE (v1 of the vis FX spec): the original `sin(x*127.1+y*311.7)*43758.5453` hash depends on the platform's sinf
/// (1-ulp differences become different glitch rows), so it is replaced by this integer hash, identical bit for bit in Rust, JS and
/// GLSL ES 3. Inputs are quantised to 1/256; output is a 24-bit fraction in [0, 1).
fn hash(x: f32, y: f32) -> f32 { (ihash(x, y) >> 8) as f32 / 16777216.0 }
fn ihash(x: f32, y: f32) -> u32 {
    let (xi, yi) = ((x * 256.0).floor() as i32 as u32, (y * 256.0).floor() as i32 as u32);
    let mut h = xi.wrapping_mul(0x9E3779B1) ^ yi.wrapping_mul(0x85EBCA6B);
    h ^= h >> 15; h = h.wrapping_mul(0x2C1B3C6D); h ^= h >> 12; h = h.wrapping_mul(0x297A2D39); h ^= h >> 15;
    h
}

fn luma(c: [f32; 3]) -> f32 {
    c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114
}

/// The pixel at (u, v) in 0..1 (nearest, clamped to the edge), as 0..1 RGB.
fn sample(src: &[u8], w: usize, h: usize, u: f32, v: f32) -> [f32; 3] {
    let x = ((u * w as f32) as isize).clamp(0, w as isize - 1) as usize;
    let y = ((v * h as f32) as isize).clamp(0, h as isize - 1) as usize;
    let i = (y * w + x) * 4;
    [src[i] as f32 / 255.0, src[i + 1] as f32 / 255.0, src[i + 2] as f32 / 255.0]
}

fn put(dst: &mut [u8], i: usize, c: [f32; 3]) {
    dst[i] = (c[0].clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
    dst[i + 1] = (c[1].clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
    dst[i + 2] = (c[2].clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
    dst[i + 3] = 255;
}

/// Run `f(y, row)` over the rows of `dst` on a few threads.
fn par_rows(dst: &mut [u8], w: usize, f: impl Fn(usize, &mut [u8]) + Sync) {
    let rows_per = (dst.len() / (w * 4)).div_ceil(std::thread::available_parallelism().map_or(4, |n| n.get()).min(8)).max(1);
    #[cfg(not(target_arch = "wasm32"))]
    std::thread::scope(|s| {
        for (k, chunk) in dst.chunks_mut(rows_per * w * 4).enumerate() {
            let f = &f;
            s.spawn(move || {
                for (j, row) in chunk.chunks_mut(w * 4).enumerate() {
                    f(k * rows_per + j, row);
                }
            });
        }
    });
    #[cfg(target_arch = "wasm32")] // no threads in the browser
    for (k, chunk) in dst.chunks_mut(rows_per * w * 4).enumerate() {
        for (j, row) in chunk.chunks_mut(w * 4).enumerate() {
            f(k * rows_per + j, row);
        }
    }
}

/// The racing engine's ROTO look: each pixel takes the mean of the quarter of its neighbourhood that varies least (a
/// Kuwahara filter: flat surfaces, edges kept), its light is cut into a few bands with its hue kept, and edges are inked.
fn roto(src: &[u8], w: usize, h: usize, u: f32, v: f32, heavy: bool) -> [f32; 3] {
    let st = (h as f32 / 720.0).max(1.0) * if heavy { 1.7 } else { 1.0 };
    let (px, py) = (st / w as f32, st / h as f32);
    let (mut best, mut low) = ([0.0f32; 3], f32::MAX);
    for s in 0..4 {
        let dx = if s & 1 == 0 { -1.0 } else { 1.0 };
        let dy = if s < 2 { -1.0 } else { 1.0 };
        let (mut sum, mut l1, mut l2) = ([0.0f32; 3], 0.0, 0.0);
        for i in 0..3 {
            for j in 0..3 {
                let c = sample(src, w, h, u + dx * i as f32 * px, v + dy * j as f32 * py);
                let l = luma(c);
                sum = [sum[0] + c[0], sum[1] + c[1], sum[2] + c[2]];
                l1 += l;
                l2 += l * l;
            }
        }
        let mean = l1 / 9.0;
        let var = l2 / 9.0 - mean * mean;
        if var < low {
            low = var;
            best = [sum[0] / 9.0, sum[1] / 9.0, sum[2] / 9.0];
        }
    }
    let l = luma(best);
    let tones = if heavy { 4.0 } else { 6.0 };
    let lg = l.clamp(0.0, 0.999).sqrt(); // banded in gamma, so the dark tones stay apart
    let lq = ((lg * tones).floor() + 0.5) / tones;
    let lq = lq * lq;
    let k = lq / l.max(0.04);
    let flat = [0.1 * lq + 0.9 * best[0] * k, 0.1 * lq + 0.9 * best[1] * k, 0.1 * lq + 0.9 * best[2] * k];
    // ink where the picture changes quickly
    let e = if heavy { 2.0 } else { 1.2 } * st;
    let (qx, qy) = (e / w as f32, e / h as f32);
    let at = |a: f32, b: f32| luma(sample(src, w, h, u + a * qx, v + b * qy));
    let (tl, tc, tr, ml, mr, bl, bc, br) = (at(-1.0, -1.0), at(0.0, -1.0), at(1.0, -1.0), at(-1.0, 0.0), at(1.0, 0.0), at(-1.0, 1.0), at(0.0, 1.0), at(1.0, 1.0));
    let gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
    let gy = (bl + 2.0 * bc + br) - (tl + 2.0 * tc + tr);
    let (e0, e1) = if heavy { (0.22, 0.40) } else { (0.30, 0.50) };
    let g = (gx * gx + gy * gy).sqrt();
    let x = ((g - e0) / (e1 - e0)).clamp(0.0, 1.0);
    let edge = x * x * (3.0 - 2.0 * x) * 0.85;
    let ink = [0.085, 0.06, 0.05];
    [flat[0] + (ink[0] - flat[0]) * edge, flat[1] + (ink[1] - flat[1]) * edge, flat[2] + (ink[2] - flat[2]) * edge]
}

/// The racing engine's look pass: roto (1, or 2 heavy) and glitch bursts (0..1), at time `seconds`.
pub fn look_filter(src: &[u8], dst: &mut [u8], w: usize, h: usize, roto_mode: u8, glitch: f32, seconds: f32) {
    let picture = |u: f32, v: f32| if roto_mode > 0 { roto(src, w, h, u, v, roto_mode >= 2) } else { sample(src, w, h, u, v) };
    let t = (seconds * 11.0).floor();
    let burst = if glitch > 0.0 && hash(t, 1.7) >= 1.0 - 0.30 * glitch { 1.0 } else { 0.0 };
    let rows = 12.0 + (44.0 - 12.0) * hash(t, 3.1);
    par_rows(dst, w, |y, row| {
        let v = (y as f32 + 0.5) / h as f32;
        for x in 0..w {
            let u = (x as f32 + 0.5) / w as f32;
            let c = if glitch > 0.0 {
                let rid = (v * rows).floor();
                let on = burst * if hash(rid, t) >= 0.55 { 1.0 } else { 0.0 };
                let mut uu = (u + on * (hash(rid, t + 9.0) - 0.5) * 0.14 * glitch, v);
                let cell = ((u * 22.0).floor(), (v * 13.0).floor());
                let block = burst * if hash(cell.0 + t * 1.3, cell.1 + t * 1.3) >= 1.0 - 0.07 * glitch { 1.0 } else { 0.0 };
                if block > 0.0 {
                    uu = (((u * 88.0).floor() + 0.5) / 88.0, ((v * 52.0).floor() + 0.5) / 52.0);
                }
                let split = (on * 0.008 + burst * 0.0016) * glitch;
                if split > 0.0 {
                    [picture(uu.0 + split, uu.1)[0], picture(uu.0, uu.1)[1], picture(uu.0 - split, uu.1)[2]]
                } else {
                    picture(uu.0, uu.1)
                }
            } else {
                picture(u, v)
            };
            put(row, x * 4, c);
        }
    });
}

/// The racing engine's screen filter: 1 scanlines, 2 CRT (soft focus, aperture grille, darker corners), 3 CRT with a
/// curved tube. `out_h` is the height the picture is shown at, so the lines fade evenly instead of beating.
pub fn screen_filter(src: &[u8], dst: &mut [u8], w: usize, h: usize, mode: u8, out_h: f32) {
    par_rows(dst, w, |y, row| {
        for x in 0..w {
            let (mut u, mut v) = ((x as f32 + 0.5) / w as f32, (y as f32 + 0.5) / h as f32);
            let mut inside = 1.0;
            if mode == 3 {
                // barrel distortion: the corners pull in; rounded corners, black outside
                let (mut cx, mut cy) = (u * 2.0 - 1.0, v * 2.0 - 1.0);
                let (ox, oy) = (cx, cy);
                cx *= 1.0 + 0.03 * oy * oy;
                cy *= 1.0 + 0.045 * ox * ox;
                u = cx * 0.5 + 0.5;
                v = cy * 0.5 + 0.5;
                let d = (((cx.abs() - 0.94).max(0.0) / 0.06).powi(2) + ((cy.abs() - 0.94).max(0.0) / 0.06).powi(2)).sqrt();
                let s = ((d - 0.85) / 0.15).clamp(0.0, 1.0);
                inside = 1.0 - s * s * (3.0 - 2.0 * s);
                if cx.abs() > 1.0 || cy.abs() > 1.0 {
                    inside = 0.0;
                }
            }
            let mut rgb = if mode >= 2 {
                let dx = 0.35 / (224.0 * w as f32 / h as f32);
                let (a, b, c) = (sample(src, w, h, u - dx, v), sample(src, w, h, u, v), sample(src, w, h, u + dx, v));
                [0.25 * a[0] + 0.5 * b[0] + 0.25 * c[0], 0.25 * a[1] + 0.5 * b[1] + 0.25 * c[1], 0.25 * a[2] + 0.5 * b[2] + 0.25 * c[2]]
            } else {
                sample(src, w, h, u, v)
            };
            if mode >= 1 {
                // 224 lines, bright at their middle and dark between, averaged over the shown pixel
                let lines = v * 224.0;
                let span = 224.0 / out_h.max(1.0) * if mode == 3 { 1.1 } else { 1.0 };
                let tau = std::f32::consts::TAU;
                let (l0, l1) = (tau * (lines - 0.5 * span - 0.5), tau * (lines + 0.5 * span - 0.5));
                let beam = if (l1 - l0).abs() > 1e-6 { (l1.sin() - l0.sin()) / (l1 - l0) } else { l0.cos() };
                let depth = if mode >= 2 { 0.55 } else { 0.45 } * (1.0 - 0.45 * luma(rgb));
                let k = (1.0 - depth * (0.5 - 0.5 * beam)) / (1.0 - depth * 0.5);
                rgb = [rgb[0] * k, rgb[1] * k, rgb[2] * k];
            }
            if mode >= 2 {
                let m = match x % 3 {
                    0 => [1.0, 0.72, 0.72],
                    1 => [0.72, 1.0, 0.72],
                    _ => [0.72, 0.72, 1.0],
                };
                let n = 3.0 / (1.0 + 2.0 * 0.72);
                let (ex, ey) = (u * 2.0 - 1.0, v * 2.0 - 1.0);
                let corner = 1.0 - 0.09 * (ex * ex + ey * ey) * (ex * ex + ey * ey);
                rgb = [rgb[0] * m[0] * n * corner, rgb[1] * m[1] * n * corner, rgb[2] * m[2] * n * corner];
            }
            put(row, x * 4, [rgb[0] * inside, rgb[1] * inside, rgb[2] * inside]);
        }
    });
}

fn test_image(w: usize, h: usize) -> Vec<u8> {
    // smooth gradients + hard-edged shapes + hash noise: exercises flat areas, edges and detail
    let mut px = vec![255u8; w * h * 4];
    for y in 0..h {
        for x in 0..w {
            let (fx, fy) = (x as f32, y as f32);
            let mut c = [0.5 + 0.5 * (fx * 0.05 + fy * 0.03).sin(), 0.5 + 0.5 * (fx * 0.021 - fy * 0.04).cos(), 0.25 + 0.5 * (fy / h as f32)];
            if (30..70).contains(&x) && (15..50).contains(&y) { c = [0.9, 0.15, 0.1]; }
            if ((x as i32 - 90).pow(2) + (y as i32 - 40).pow(2)) < 18 * 18 { c = [0.1, 0.8, 0.9]; }
            if x % 16 < 2 { c = [0.95, 0.95, 0.9]; }
            let n = (hash(fx * 1.0, fy * 1.0) - 0.5) * 0.18;
            let i = (y * w + x) * 4;
            for k in 0..3 { px[i + k] = ((c[k] + n).clamp(0.0, 1.0) * 255.0 + 0.5) as u8; }
        }
    }
    px
}

fn main() {
    let (w, h) = (128usize, 72usize);
    let dir = std::path::Path::new("../golden/fx");
    std::fs::create_dir_all(dir).unwrap();
    let img = test_image(w, h);
    std::fs::write(dir.join("input.rgba"), &img).unwrap();
    // bit-exact hash vectors: [x, y, ihash>>8]  (x,y include fractional values like the t*1.3 cell offsets)
    let mut hv: Vec<String> = Vec::new();
    for t in [0.0f32, 1.0, 8.0, 16.0, 17.0, 25.0, 40.0] { for r in 0..64 { let (x, y) = (r as f32, t); hv.push(format!("[{x}, {y}, {}]", ihash(x, y) >> 8)); } }
    for t in [1.0f32, 8.0, 16.0] { for c in 0..22 { let (x, y) = (c as f32 + t * 1.3, 7.0 + t * 1.3); hv.push(format!("[{x:?}, {y:?}, {}]", ihash(x, y) >> 8)); } }
    for (x, y) in [(-3.0f32, 5.0f32), (-0.5, -0.5), (1000.25, 2.75), (0.0, 0.0)] { hv.push(format!("[{x:?}, {y:?}, {}]", ihash(x, y) >> 8)); }
    std::fs::write(dir.join("hash.json"), format!("[{}]\n", hv.join(", "))).unwrap();
    let mut cases: Vec<String> = Vec::new();
    let mut add = |name: &str, kind: &str, args: String, out: &[u8]| {
        std::fs::write(dir.join(format!("{name}.rgba")), out).unwrap();
        cases.push(format!("    {{\"name\": \"{name}\", \"kind\": \"{kind}\", {args}}}"));
    };
    let mut out = vec![0u8; w * h * 4];
    // look pass. Pick moments that really burst (searching the same rule look_filter uses), plus a couple that do not.
    let bursting = |glitch: f32| -> Vec<f32> { (0..400).map(|k| k as f32 / 11.0 + 0.01).filter(|s| { let t = (s * 11.0).floor(); hash(t, 1.7) >= 1.0 - 0.30 * glitch }).collect() };
    let quiet: Vec<f32> = (0..400).map(|k| k as f32 / 11.0 + 0.01).filter(|s| { let t = (s * 11.0).floor(); hash(t, 1.7) < 1.0 - 0.30 }).take(2).collect();
    for (i, sec) in bursting(1.0).iter().take(6).enumerate() {
        look_filter(&img, &mut out, w, h, 0, 1.0, *sec);
        add(&format!("glitch_burst_{i}"), "look", format!("\"roto\": 0, \"glitch\": 1.0, \"seconds\": {sec}"), &out);
    }
    for (i, sec) in quiet.iter().enumerate() {
        look_filter(&img, &mut out, w, h, 0, 1.0, *sec);
        add(&format!("glitch_quiet_{i}"), "look", format!("\"roto\": 0, \"glitch\": 1.0, \"seconds\": {sec}"), &out);
    }
    let low = bursting(0.35)[1];
    look_filter(&img, &mut out, w, h, 0, 0.35, low);  add("glitch_low", "look", format!("\"roto\": 0, \"glitch\": 0.35, \"seconds\": {low}"), &out);
    let rg = bursting(0.8)[2];
    look_filter(&img, &mut out, w, h, 1, 0.8, rg);    add("roto_glitch", "look", format!("\"roto\": 1, \"glitch\": 0.8, \"seconds\": {rg}"), &out);
    let rh = bursting(1.0)[3];
    look_filter(&img, &mut out, w, h, 2, 1.0, rh);    add("roto_heavy_glitch", "look", format!("\"roto\": 2, \"glitch\": 1.0, \"seconds\": {rh}"), &out);
    look_filter(&img, &mut out, w, h, 1, 0.0, 0.0);   add("roto", "look", "\"roto\": 1, \"glitch\": 0.0, \"seconds\": 0.0".into(), &out);
    look_filter(&img, &mut out, w, h, 2, 0.0, 0.0);   add("roto_heavy", "look", "\"roto\": 2, \"glitch\": 0.0, \"seconds\": 0.0".into(), &out);
    // chained: look pass then screen pass (the order the host applies them) — catches intermediate-buffer bugs
    let ch = bursting(0.8)[2]; let mut mid = vec![0u8; w * h * 4];
    look_filter(&img, &mut mid, w, h, 1, 0.8, ch); screen_filter(&mid, &mut out, w, h, 2, 1080.0);
    add("chain_roto_glitch_crt", "chain", format!("\"roto\": 1, \"glitch\": 0.8, \"seconds\": {ch}, \"mode\": 2, \"outH\": 1080"), &out);
    look_filter(&img, &mut mid, w, h, 0, 1.0, bursting(1.0)[4]); screen_filter(&mid, &mut out, w, h, 3, h as f32);
    add("chain_glitch_curved", "chain", format!("\"roto\": 0, \"glitch\": 1.0, \"seconds\": {}, \"mode\": 3, \"outH\": {}", bursting(1.0)[4], h), &out);
    // screen pass: scanlines, CRT, curved CRT, at the native height and shown at 1080
    for mode in 1u8..=3 {
        screen_filter(&img, &mut out, w, h, mode, h as f32);   add(&format!("screen{mode}"), "screen", format!("\"mode\": {mode}, \"outH\": {}", h), &out);
        screen_filter(&img, &mut out, w, h, mode, 1080.0);     add(&format!("screen{mode}_1080"), "screen", format!("\"mode\": {mode}, \"outH\": 1080"), &out);
    }
    std::fs::write(dir.join("manifest.json"), format!("{{\n  \"width\": {w}, \"height\": {h},\n  \"cases\": [\n{}\n  ]\n}}\n", cases.join(",\n"))).unwrap();
    println!("wrote {} golden cases to {}", cases.len(), dir.display());
}
