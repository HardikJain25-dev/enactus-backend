const fetch = require("node-fetch");
const cloudinary = require("cloudinary").v2;

async function downloadImage(driveUrl, filename = "image") {
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
      console.warn(`❌ Failed to fetch ${filename}: ${response.status}`);
      return "";
    }

    const buffer = await response.buffer();
    const safeName = filename.replace(/\s+/g, "_");

    // Directly upload to Cloudinary
    const uploadResult = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        { folder: "enactus", public_id: safeName, format: "webp", overwrite: true },
        (error, result) => (error ? reject(error) : resolve(result))
      ).end(buffer);
    });

    return uploadResult.secure_url;
  } catch (err) {
    console.error("❌ Error downloading/uploading image:", err.message);
    return "";
  }
}

module.exports = downloadImage;