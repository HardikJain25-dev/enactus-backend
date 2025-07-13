const mongoose = require('mongoose');

const TeamMemberSchema = new mongoose.Schema({
  name: { type: String, required: true },
  collegeRollNumber: { type: String },
  year: { type: String },
  role: String,
  image: {
    type: String,
    required: false,
    set: function (url) {
      const match = url?.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
      return match ? `https://drive.google.com/uc?export=view&id=${match[1]}` : url;
    },
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