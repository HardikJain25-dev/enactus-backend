const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const sharp = require("sharp");
const heicConvert = require("heic-convert");

async function downloadImage(driveUrl, filename = "image.jpg") {
  if (!driveUrl || typeof driveUrl !== "string") return "";

  const match = driveUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!match || !match[1]) {
    console.warn("No valid Google Drive ID found in:", driveUrl);
    return "";
  }

  const fileId = match[1];
  const directUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

  try {
    const response = await fetch(directUrl);
    if (!response.ok) {
      console.warn(`❌ Failed to download ${filename}, status: ${response.status}`);
      return "";
    }

    const buffer = await response.buffer();

    let imageBuffer = buffer;

    // Convert HEIC to JPEG before webp
    if (filename.toLowerCase().endsWith(".heic")) {
      try {
        imageBuffer = await heicConvert({
          buffer,
          format: "JPEG",
          quality: 1
        });
      } catch (err) {
        console.warn("⚠️ HEIC conversion failed, using original buffer.");
      }
    }

    const parsed = path.parse(filename);
    const safeName = parsed.name.replace(/\s+/g, "_");
    const webpFilename = `${safeName}.webp`;
    const destPath = path.join(__dirname, "uploads", webpFilename);

    await sharp(imageBuffer)
      .sharpen()
      .webp({ quality: 80 })
      .toFile(destPath);

    return `/uploads/${webpFilename}`;
  } catch (err) {
    console.error("Download error:", err.message);
    return "";
  }
}

module.exports = downloadImage;