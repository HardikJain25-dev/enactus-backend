require('dotenv').config();
const express = require('express');
const fs = require('fs');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const csv = require("csvtojson");
const TeamMember = require('./models/TeamMember');
const downloadImage = require('./download');

const app = express();
app.use(cors());
app.use(express.json());

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/'); // Save to 'uploads' folder
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit

// Upload endpoint
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  // Return the URL to access the uploaded file
  const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
  res.json({ url: fileUrl });
});

// Helper to normalize Google Drive URLs to direct image links
function normalizeDriveUrl(url) {
  const match = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (match) {
    return `https://drive.google.com/uc?export=view&id=${match[1]}`;
  }
  return url;
}

// Add or update a team member by name (no duplicates)
app.post('/api/team', async (req, res) => {
  req.body.image = normalizeDriveUrl(req.body.image);
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

// Get all team members
app.get('/api/team', async (req, res) => {
  const members = await TeamMember.find();
  const updatedMembers = members.map(member => {
    if (member.image && !member.image.startsWith('http')) {
      member.image = `${req.protocol}://${req.get('host')}/uploads/${member.image}`;
    }
    return member;
  });
  res.json(updatedMembers);
});

// Update team member by name
app.put('/api/team/update-by-name', async (req, res) => {
  const { name, ...updates } = req.body;
  if (!name) {
    return res.status(400).json({ success: false, message: "Name is required to identify the team member." });
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

// Delete a specific team member by name
app.delete('/api/team/:name', async (req, res) => {
  const name = req.params.name;
  try {
    const deleted = await TeamMember.findOneAndDelete({ name });
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Team member not found." });
    }
    if (deleted.image) {
      const imagePath = path.join(__dirname, 'uploads', path.basename(deleted.image));
      fs.unlink(imagePath, (err) => {
        if (err) console.warn("Failed to delete image:", imagePath);
      });
    }
    res.json({ success: true, message: "Team member deleted." });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error deleting team member." });
  }
});

// Delete all team members
app.delete('/api/team', async (req, res) => {
  try {
    await TeamMember.deleteMany({});
    // Remove all uploaded files from uploads/ folder
    const uploadDir = path.join(__dirname, 'uploads');
    fs.readdir(uploadDir, (err, files) => {
      if (!err) {
        for (const file of files) {
          fs.unlink(path.join(uploadDir, file), (err) => {
            if (err) console.warn("Failed to delete image:", file);
          });
        }
      }
    });
    res.json({ success: true, message: "All team members deleted." });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error deleting team members." });
  }
});

// Login endpoint
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

// Import team members from a CSV file
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

    for (const row of rows) {
      if (!row.name || row.name.trim() === "") {
        console.warn("Skipping row with missing name:", row);
        continue;
      }

      const exists = await TeamMember.findOne({ name: row.name });
      if (exists) {
        console.warn("Skipping duplicate member:", row.name);
        continue;
      }

      let socials = [];
      try {
        socials = JSON.parse(row.socials || "[]");
      } catch {}
      
      const rawImage = row.image?.trim();
      const localImagePath = rawImage ? await downloadImage(rawImage, `${row.name.replace(/\s+/g, "_")}.webp`) : "";

      await TeamMember.create({
        name: row.name,
        role: row.role,
        image: localImagePath,
        description: row.description,
        collegeRollNumber: row.collegeRollNumber,
        year: row.year,
        socials,
      });
    }
    res.json({ success: true, count: rows.length });
  } catch (err) {
    res.status(500).json({ success: false, message: "Import failed.", error: err.message });
  }
});

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