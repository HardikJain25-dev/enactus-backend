const mongoose = require('mongoose');

const meetingSchema = new mongoose.Schema({
  title: { type: String, required: true },
  date: { type: String, required: true }, // e.g., '2025-07-05' or ISO string
  time: { type: String, required: true }, // e.g., '14:30'
  description: { type: String },
  participants: { type: String },
  location: { type: String },
  color: { type: String, required: true },
  type: { type: String, required: true },
}, {
  timestamps: true,
});

module.exports = mongoose.model('Meeting', meetingSchema);
