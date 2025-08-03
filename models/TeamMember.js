const mongoose = require('mongoose');

const TeamMemberSchema = new mongoose.Schema({
  name: { type: String, required: true },
  collegeRollNumber: { type: String },
  year: { type: String },
  role: String,
  image: {
    type: String,
    required: false, // Now stores direct Cloudinary URL
  },
  description: String,
  socials: [
    {
      label: String,
      href: String,
    },
  ],
});

module.exports = mongoose.model('TeamMember', TeamMemberSchema);