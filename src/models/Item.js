const mongoose = require('mongoose')

const contributorSchema = new mongoose.Schema(
  { contributions: Number, email: String, name: String },
  { noId: true }
)

const itemSchema = new mongoose.Schema(
  {
    filename: {
      type: String,
      unique: true,
    },
    title: {
      type: String,
      required: true,
    },
    contentType: {
      type: String,
      enum: ['multi', 'graphic', 'link', 'video', 'podcast'],
      required: true,
    },
    tags: {
      type: Array,
      required: true,
    },
    image: {
      type: String,
      required: false,
    },
    imageText: {
      type: String,
      required: false,
    },
    url: {
      type: String,
      required: false,
    },
    bodyContent: {
      type: String,
      required: false,
    },
    strippedContent: {
      type: String,
      required: false,
    },
    authorName: {
      type: String,
      required: true,
    },
    authorEmail: {
      type: String,
      required: false,
    },
    contributors: [contributorSchema],
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
  }
)

const Item = mongoose.model('Item', itemSchema)

module.exports = { Item }
