const fetch = require("node-fetch");
const sharp = require("sharp");
const heicConvert = require("heic-convert");
const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_API_SECRET,
});

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

    // Convert HEIC to JPEG before WebP
    if (filename.toLowerCase().endsWith(".heic")) {
      try {
        imageBuffer = await heicConvert({ buffer, format: "JPEG", quality: 1 });
      } catch (err) {
        console.warn("⚠️ HEIC conversion failed, using original buffer.");
      }
    }

    // Convert to WebP
    const webpBuffer = await sharp(imageBuffer).sharpen().webp({ quality: 80 }).toBuffer();

    // Upload to Cloudinary
    const safeName = filename.replace(/\s+/g, "_").replace(/\.[^/.]+$/, "");
    const uploadResult = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        { resource_type: "image", public_id: safeName, format: "webp", overwrite: true },
        (err, result) => (err ? reject(err) : resolve(result))
      ).end(webpBuffer);
    });

    console.log(`✅ Uploaded ${filename} to Cloudinary: ${uploadResult.secure_url}`);
    return uploadResult.secure_url; // Return Cloudinary URL
  } catch (err) {
    console.error("Download error:", err.message);
    return "";
  }
}

module.exports = downloadImage;