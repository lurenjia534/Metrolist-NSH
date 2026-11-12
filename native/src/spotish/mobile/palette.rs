// SPDX-License-Identifier: GPL-3.0-only
//! Spotish's cover palette algorithm applied to the actual image pixels.

use base64::{Engine, engine::general_purpose::STANDARD};

pub async fn cover_colors(url: String) -> Result<Vec<String>, String> {
    if url.is_empty() { return Ok(Vec::new()); }
    let bytes = if url.starts_with("data:") {
        let (_, encoded) = url.split_once(',').ok_or("E_IMAGE: invalid data image")?;
        STANDARD.decode(encoded).map_err(|e| format!("E_IMAGE: {e}"))?
    } else {
        reqwest::get(url).await.map_err(|e| format!("E_IMAGE: {e}"))?
            .error_for_status().map_err(|e| format!("E_IMAGE: {e}"))?
            .bytes().await.map_err(|e| format!("E_IMAGE: {e}"))?.to_vec()
    };
    let image = image::load_from_memory(&bytes).map_err(|e| format!("E_IMAGE: {e}"))?
        .resize_exact(24, 24, image::imageops::FilterType::Triangle).to_rgba8();
    Ok(palette(image.as_raw()))
}

fn distance(a: &[f64; 3], b: &[f64; 3]) -> f64 {
    (0..3).map(|i| (a[i] - b[i]).powi(2)).sum()
}

fn palette(pixels: &[u8]) -> Vec<String> {
    let points: Vec<[f64; 3]> = pixels.chunks_exact(4).filter(|p| p[3] >= 128)
        .map(|p| [p[0] as f64, p[1] as f64, p[2] as f64]).collect();
    if points.is_empty() { return Vec::new(); }
    let k = 8.min(points.len());
    let mut centers: Vec<_> = (0..k).map(|j| points[((j as f64 + 0.5) * points.len() as f64 / k as f64) as usize]).collect();
    let mut counts = vec![0usize; k];
    for _ in 0..10 {
        let mut sums = vec![[0.0; 3]; k];
        counts.fill(0);
        for point in &points {
            let best = (0..k).min_by(|a, b| distance(point, &centers[*a]).total_cmp(&distance(point, &centers[*b]))).unwrap();
            for i in 0..3 { sums[best][i] += point[i]; }
            counts[best] += 1;
        }
        for j in 0..k {
            if counts[j] > 0 { centers[j] = sums[j].map(|value| value / counts[j] as f64); }
        }
    }
    let mut scored: Vec<_> = centers.into_iter().zip(counts).filter(|(_, count)| *count > 0)
        .map(|(color, count)| {
            let hi = color.iter().copied().fold(0.0_f64, f64::max);
            let lo = color.iter().copied().fold(255.0_f64, f64::min);
            let saturation = if hi == 0.0 { 0.0 } else { (hi - lo) / hi };
            (color, count as f64 / points.len() as f64 * (0.25 + saturation))
        }).collect();
    scored.sort_by(|a, b| b.1.total_cmp(&a.1));
    let mut picked: Vec<[f64; 3]> = Vec::new();
    for (color, _) in scored {
        if picked.iter().all(|p| distance(p, &color) >= 1600.0) { picked.push(color); }
        if picked.len() == 5 { break; }
    }
    picked.iter().map(|c| format!("#{:02x}{:02x}{:02x}", c[0].round() as u8, c[1].round() as u8, c[2].round() as u8)).collect()
}

#[cfg(test)]
mod tests {
    use super::palette;
    #[test]
    fn dominant_cover_colors_preserve_actual_pixels_and_ignore_transparency() {
        let mut pixels = [220, 40, 40, 255].repeat(40);
        pixels.extend([40, 90, 220, 255].repeat(20));
        pixels.extend([0, 255, 0, 0].repeat(100));
        assert_eq!(palette(&pixels), vec!["#dc2828", "#285adc"]);
        assert!(palette(&[255, 0, 0, 0]).is_empty());
    }
}
