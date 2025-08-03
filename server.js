require('dotenv').config();
const express = require('express');
const fs = require('fs');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const csv = require("csvtojson");
const TeamMember = require('./models/TeamMember');
const Meeting = require('./models/Meeting');  // Added Meeting model

// Cloudinary setup
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_API_SECRET,
});

const downloadImage = require('./download');

const app = express();
app.use(cors({
  origin: ['https://enactusslc.com', 'http://localhost:3000'],
  credentials: true,
}));
app.use(express.json());

// Multer memory storage for direct Cloudinary upload
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit

// Upload endpoint using Cloudinary
app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  try {
    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        { resource_type: 'image', folder: 'enactus', format: 'webp', overwrite: true },
        (error, uploadResult) => (error ? reject(error) : resolve(uploadResult))
      ).end(req.file.buffer);
    });
    res.json({ url: result.secure_url });
  } catch (err) {
    console.error('❌ Cloudinary upload failed:', err);
    res.status(500).json({ error: 'Failed to upload image to Cloudinary' });
  }
});

// Normalize Google Drive URLs to direct download links
function normalizeDriveUrl(url) {
  const match = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (match) {
    return `https://drive.google.com/uc?export=view&id=${match[1]}`;
  }
  return url;
}

// Team Member APIs
app.post('/api/team', async (req, res) => {
  // Only normalize if it's a Google Drive URL, otherwise keep Cloudinary URL as is
  if (req.body.image?.includes("drive.google.com")) {
    req.body.image = normalizeDriveUrl(req.body.image);
  }
  console.log(`📥 Adding or updating member: ${req.body.name}`);
  try {
    const existing = await TeamMember.findOne({ name: req.body.name });
    if (existing) {
      const updated = await TeamMember.findOneAndUpdate({ name: req.body.name }, req.body, { new: true });
      return res.status(200).json(updated);
    }
    const member = new TeamMember(req.body);
    await member.save();
    res.status(201).json(member);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/team', async (req, res) => {
  const members = await TeamMember.find();
  res.json(members);
});

app.put('/api/team/update-by-name', async (req, res) => {
  const { name, ...updates } = req.body;
  if (!name) {
    return res.status(400).json({ success: false, message: "Name is required." });
  }
  try {
    const updated = await TeamMember.findOneAndUpdate({ name }, updates, { new: true });
    if (!updated) {
      return res.status(404).json({ success: false, message: "Team member not found." });
    }
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: "Update failed.", error: err.message });
  }
});

app.delete('/api/team/:name', async (req, res) => {
  const name = req.params.name;
  try {
    const deleted = await TeamMember.findOneAndDelete({ name });
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Team member not found." });
    }
    if (deleted.image) {
      try {
        const publicId = deleted.image.split('/').slice(-1)[0].replace('.webp', '');
        await cloudinary.uploader.destroy(`enactus/${publicId}`);
        console.log(`🗑️ Deleted image from Cloudinary: ${publicId}`);
      } catch (err) {
        console.warn("Failed to delete image from Cloudinary:", err.message);
      }
    }
    res.json({ success: true, message: "Team member deleted." });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error deleting team member." });
  }
});

app.delete('/api/team', async (req, res) => {
  try {
    await TeamMember.deleteMany({});
    // Optionally remove all images from Cloudinary in the 'enactus' folder
    try {
      const { resources } = await cloudinary.api.resources({ type: 'upload', prefix: 'enactus/' });
      for (const resource of resources) {
        await cloudinary.uploader.destroy(resource.public_id);
        console.log(`🗑️ Deleted ${resource.public_id} from Cloudinary.`);
      }
    } catch (err) {
      console.warn("Failed to bulk delete images from Cloudinary:", err.message);
    }
    res.json({ success: true, message: "All team members deleted." });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error deleting team members." });
  }
});

// Login API
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (
    email === process.env.ADMIN_EMAIL &&
    password === process.env.ADMIN_PASSWORD
  ) {
    return res.json({ success: true });
  }
  res.status(401).json({ success: false, message: "Invalid credentials" });
});

// Import from Google Sheet CSV
app.post("/api/team/import-sheet", async (req, res) => {
  const { sheetUrl } = req.body;
  try {
    const match = sheetUrl.match(/\/d\/([^\/]+)/);
    if (!match) {
      return res.status(400).json({ success: false, message: "Invalid Google Sheet URL" });
    }
    const sheetId = match[1];
    const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;

    const response = await fetch(csvUrl);
    const csvText = await response.text();
    const rows = await csv().fromString(csvText);

    for (const [index, row] of rows.entries()) {
      console.log(`[${index + 1}/${rows.length}] Importing: ${row.name}`);

      if (!row.name || row.name.trim() === "") {
        console.warn(`Skipping row with missing name at index ${index}`);
        continue;
      }

      let socials = [];
      try {
        socials = JSON.parse(row.socials || "[]");
      } catch (err) {
        console.warn(`Invalid socials JSON for ${row.name}:`, row.socials);
        socials = [];
      }

      const rawImage = row.image?.trim();
      let uploadedImageUrl = "";
      if (rawImage && rawImage.includes("drive.google.com")) {
        try {
          const match = rawImage.match(/\/d\/([a-zA-Z0-9_-]+)/);
          if (match) {
            const directUrl = `https://drive.google.com/uc?export=download&id=${match[1]}`;
            const driveResp = await fetch(directUrl);
            const buffer = Buffer.from(await driveResp.arrayBuffer());

            const safeName = row.name.replace(/\s+/g, "_");
            const uploadResult = await new Promise((resolve, reject) => {
              cloudinary.uploader.upload_stream(
                { resource_type: "image", folder: "enactus", public_id: safeName, format: "webp", overwrite: true },
                (error, result) => (error ? reject(error) : resolve(result))
              ).end(buffer);
            });
            console.log(`✅ Uploaded image for ${row.name} to Cloudinary: ${uploadResult.secure_url}`);
            uploadedImageUrl = uploadResult.secure_url;
          }
        } catch (err) {
          console.warn(`Failed to upload image for ${row.name}:`, err.message);
        }
      }

      await TeamMember.findOneAndUpdate(
        { name: row.name },
        {
          role: row.role,
          image: uploadedImageUrl,
          description: row.description,
          collegeRollNumber: row.collegeRollNumber,
          year: row.year,
          socials,
        },
        { upsert: true, new: true }
      );

      await new Promise((res) => setTimeout(res, 200)); // Throttle
    }
    res.json({ success: true, count: rows.length });
  } catch (err) {
    res.status(500).json({ success: false, message: "Import failed.", error: err.message });
  }
});

// Root health check
app.get('/', (req, res) => {
  res.send("✅ Enactus backend is running!");
});

// --- NEW MEETING API ROUTES ---

// Get all meetings (filtered optionally by date)
app.get('/api/meetings', async (req, res) => {
  try {
    const { date } = req.query;
    const filter = {};
    if (date) filter.date = date;
    const meetings = await Meeting.find(filter).sort({ date: 1, time: 1 });
    res.json(meetings);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch meetings', error: err.message });
  }
});

// Post new meeting
app.post('/api/meetings', async (req, res) => {
  try {
    const meeting = new Meeting(req.body);
    await meeting.save();
    res.status(201).json(meeting);
  } catch (err) {
    res.status(400).json({ success: false, message: 'Failed to add meeting', error: err.message });
  }
});

// Update meeting by ID
app.put('/api/meetings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await Meeting.findByIdAndUpdate(id, req.body, { new: true });
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Meeting not found' });
    }
    res.json(updated);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update meeting', error: err.message });
  }
});

// Delete meeting by ID
app.delete('/api/meetings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Meeting.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Meeting not found' });
    }
    res.json({ success: true, message: 'Meeting deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete meeting', error: err.message });
  }
});


// Connect to MongoDB and start server
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.clear();
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   ███╗   ██╗███████╗██████╗ ██████╗ ██╗██╗  ██╗               ║
║   ████╗  ██║██╔════╝██╔══██╗██╔══██╗██║╚██╗██╔╝               ║
║   ██╔██╗ ██║█████╗  ██║  ██║██████╔╝██║ ╚███╔╝                ║
║   ██║╚██╗██║██╔══╝  ██║  ██║██╔═══╝ ██║ ██╔██╗                ║
║   ██║ ╚████║███████╗██████╔╝██║     ██║██╔╝ ██╗               ║
║   ╚═╝  ╚═══╝╚══════╝╚═════╝ ╚═╝     ╚═╝╚═╝  ╚═╝               ║
║                                                               ║
║   👨‍💻 Hardik Jain                                              ║
║   🔗 Portfolio: https://portfolio-psi-gold-50.vercel.app/about║
║   🐙 GitHub:    https://github.com/creepolite                 ║
║                                                               ║
║   💡 Type hardik.sayHi() in this console to say hi!           ║
╚══════════════════════════════════════════════════════════════╝
  `);

  global.hardik = {
    sayHi: () => console.log("👋 Hey there! Thanks for checking out Hardik's server!")
  };
});
